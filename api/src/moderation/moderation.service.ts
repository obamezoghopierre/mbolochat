import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  blockedWords,
  comments,
  moderationActions,
  publications,
  reports,
  stories,
  users,
} from '../db/schema.js';
import { enqueuePublicationCleanup } from '../social-media/media-cleanup.js';

export const QUEUE_DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export const MODERATION_ACTIONS = [
  'hide',
  'remove',
  'restore',
  'warn',
  'suspend',
  'dismiss',
] as const;
export type ModerationActionKind = (typeof MODERATION_ACTIONS)[number];

export const REPORT_TARGET_TYPES = ['publication', 'comment', 'story', 'user'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_REASONS = [
  'spam',
  'harassment',
  'hate',
  'nudity',
  'violence',
  'misinformation',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export interface ReportView {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  createdAt: Date;
  reporter: { id: string; username: string; displayName: string } | null;
  /** Aperçu court de la cible, jamais son contenu complet. */
  targetPreview: string | null;
  targetAuthorId: string | null;
}

export interface ReportPage {
  items: ReportView[];
  nextCursor: string | null;
}

/**
 * Signalements et modération (plan §9).
 *
 * Les décisions sont humaines : le serveur ne supprime rien automatiquement,
 * sauf le marquage `flagged` d'un contenu qui contient un mot bloqué. Chaque
 * décision écrit une ligne d'audit dans `moderation_actions`.
 */
@Injectable()
export class ModerationService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Abonnés à la validation d'une publication qui était en revue (`flagged`).
   * Les publications s'y inscrivent pour notifier les mentions retenues à la
   * création — sans dépendance circulaire entre les deux modules.
   */
  private readonly approvalListeners = new Set<(publicationId: string) => Promise<void>>();

  onPublicationApproved(listener: (publicationId: string) => Promise<void>): () => void {
    this.approvalListeners.add(listener);
    return () => {
      this.approvalListeners.delete(listener);
    };
  }

  /** Dépose un signalement. Rejouer la même requête ne crée pas de doublon. */
  async report(
    reporterId: string,
    input: {
      targetType: ReportTargetType;
      targetId: string;
      reason: ReportReason;
      details?: string;
    },
  ): Promise<{ id: string; status: string }> {
    const target = await this.loadTarget(input.targetType, input.targetId);
    if (target.authorId === reporterId) {
      throw new BadRequestException('Impossible de signaler son propre contenu.');
    }

    const [inserted] = await this.db
      .insert(reports)
      .values({
        reporterId,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        details: input.details?.trim() || null,
      })
      .onConflictDoNothing()
      .returning({ id: reports.id, status: reports.status });
    if (inserted) {
      return inserted;
    }
    const [existing] = await this.db
      .select({ id: reports.id, status: reports.status })
      .from(reports)
      .where(
        and(
          eq(reports.reporterId, reporterId),
          eq(reports.targetType, input.targetType),
          eq(reports.targetId, input.targetId),
        ),
      );
    if (!existing) {
      throw new BadRequestException('Signalement impossible.');
    }
    return existing;
  }

  /** File de signalements, du plus ancien au plus récent (ordre de traitement). */
  async queue(status: ReportStatus, limit: number, cursor?: string): Promise<ReportPage> {
    const bounded = Math.min(Math.max(1, limit), MAX_LIMIT);
    const conditions = [eq(reports.status, status)];
    if (cursor) {
      const decoded = decodeKeysetCursor(cursor);
      conditions.push(
        sql`(${reports.createdAt}, ${reports.id}) > (${decoded.raw}::timestamptz, ${decoded.id})`,
      );
    }

    const rows = await this.db
      .select({
        id: reports.id,
        targetType: reports.targetType,
        targetId: reports.targetId,
        reason: reports.reason,
        details: reports.details,
        status: reports.status,
        createdAt: reports.createdAt,
        createdAtText: sql<string>`${reports.createdAt}::text`,
        reporter: {
          id: users.id,
          username: users.username,
          displayName: users.displayName,
        },
      })
      .from(reports)
      .leftJoin(users, eq(users.id, reports.reporterId))
      .where(and(...conditions))
      .orderBy(sql`${reports.createdAt} asc`, sql`${reports.id} asc`)
      .limit(bounded + 1);

    const page = rows.slice(0, bounded);
    const previews = await this.previewsFor(page);
    const last = page.at(-1);
    return {
      items: page.map(({ createdAtText: _text, ...row }) => {
        const preview = previews.get(`${row.targetType}:${row.targetId}`);
        return {
          ...row,
          targetPreview: preview?.text ?? null,
          targetAuthorId: preview?.authorId ?? null,
        };
      }),
      nextCursor:
        rows.length > bounded && last
          ? encodeKeysetCursor(last.createdAtText, last.id)
          : null,
    };
  }

  /**
   * Décision de modération : applique l'action à la cible, clôt le signalement
   * et journalise. Idempotent : un signalement déjà clos n'est pas retraité.
   */
  async decide(
    moderatorId: string,
    reportId: string,
    action: ModerationActionKind,
    notes?: string,
  ): Promise<{ status: string; applied: ModerationActionKind }> {
    const [report] = await this.db.select().from(reports).where(eq(reports.id, reportId));
    if (!report) {
      throw new NotFoundException('Signalement introuvable.');
    }
    // Un signalement clos ne se rejoue pas… sauf pour rétablir un contenu
    // (appel ou erreur de modération), qui doit rester possible sans nouveau
    // signalement.
    if ((report.status === 'resolved' || report.status === 'dismissed') && action !== 'restore') {
      return { status: report.status, applied: action };
    }

    const approved = await this.db.transaction(async (tx) => {
      const wasApproved = await this.applyAction(tx, report.targetType, report.targetId, action);

      // Une restauration ne rouvre pas le signalement : elle corrige la
      // décision précédente et laisse le dossier clos.
      const status =
        action === 'restore' && (report.status === 'resolved' || report.status === 'dismissed')
          ? report.status
          : action === 'dismiss'
            ? 'dismissed'
            : 'resolved';
      await tx
        .update(reports)
        .set({ status, resolvedById: moderatorId, resolvedAt: new Date() })
        .where(eq(reports.id, reportId));

      await tx.insert(moderationActions).values({
        reportId,
        moderatorId,
        targetType: report.targetType,
        targetId: report.targetId,
        action,
        notes: notes?.trim() || null,
      });
      return wasApproved;
    });

    // Après validation de la transaction seulement : une notification ne doit
    // jamais pointer vers un contenu dont la décision a été annulée. Un échec
    // d'envoi ne remet pas la décision en cause.
    if (approved) {
      for (const listener of this.approvalListeners) {
        await listener(report.targetId).catch(() => undefined);
      }
    }

    return {
      status: action === 'dismiss' ? 'dismissed' : 'resolved',
      applied: action,
    };
  }

  /** Historique d'audit, du plus récent au plus ancien. */
  async audit(limit: number, cursor?: string) {
    const bounded = Math.min(Math.max(1, limit), MAX_LIMIT);
    const conditions = [];
    if (cursor) {
      const decoded = decodeKeysetCursor(cursor);
      conditions.push(
        sql`(${moderationActions.createdAt}, ${moderationActions.id}) < (${decoded.raw}::timestamptz, ${decoded.id})`,
      );
    }
    const rows = await this.db
      .select({
        id: moderationActions.id,
        targetType: moderationActions.targetType,
        targetId: moderationActions.targetId,
        action: moderationActions.action,
        notes: moderationActions.notes,
        createdAt: moderationActions.createdAt,
        createdAtText: sql<string>`${moderationActions.createdAt}::text`,
        moderatorId: moderationActions.moderatorId,
      })
      .from(moderationActions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(sql`${moderationActions.createdAt} desc`, sql`${moderationActions.id} desc`)
      .limit(bounded + 1);

    const page = rows.slice(0, bounded);
    const last = page.at(-1);
    return {
      items: page.map(({ createdAtText: _text, ...row }) => row),
      nextCursor:
        rows.length > bounded && last
          ? encodeKeysetCursor(last.createdAtText, last.id)
          : null,
    };
  }

  /** Catalogue des mots bloqués (auto-flag à la publication). */
  async listBlockedWords() {
    return this.db
      .select({
        id: blockedWords.id,
        word: blockedWords.word,
        active: blockedWords.active,
        createdAt: blockedWords.createdAt,
      })
      .from(blockedWords)
      .orderBy(desc(blockedWords.createdAt));
  }

  async addBlockedWord(word: string, createdById: string) {
    const normalized = normalizeWord(word);
    if (normalized.length < 2) {
      throw new BadRequestException('Le mot bloqué est trop court.');
    }
    const [row] = await this.db
      .insert(blockedWords)
      .values({ word: normalized, createdById })
      .onConflictDoNothing()
      .returning();
    if (row) {
      return row;
    }
    const [existing] = await this.db
      .select()
      .from(blockedWords)
      .where(eq(blockedWords.word, normalized));
    if (!existing) {
      throw new BadRequestException('Mot bloqué impossible à enregistrer.');
    }
    return existing;
  }

  async removeBlockedWord(id: string): Promise<{ deleted: true }> {
    await this.db.delete(blockedWords).where(eq(blockedWords.id, id));
    return { deleted: true };
  }

  /** Un texte contient-il un mot bloqué actif ? */
  async hasBlockedWord(text: string): Promise<boolean> {
    const rows = await this.db
      .select({ word: blockedWords.word })
      .from(blockedWords)
      .where(eq(blockedWords.active, true));
    if (rows.length === 0) {
      return false;
    }
    const haystack = ` ${normalizeWord(text)} `;
    return rows.some((row) => haystack.includes(` ${row.word} `));
  }

  /** Recherche d'un compte pour le back-office. Aucune PII sensible. */
  async findUsers(query: string, limit = 20) {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      throw new BadRequestException('Recherche trop courte.');
    }
    return this.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        verified: users.verified,
        privateAccount: users.privateAccount,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(
        sql`(${users.username} ilike ${`%${trimmed}%`} or ${users.displayName} ilike ${`%${trimmed}%`})`,
      )
      .limit(Math.min(Math.max(1, limit), MAX_LIMIT));
  }

  private async applyAction(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    targetType: ReportTargetType,
    targetId: string,
    action: ModerationActionKind,
  ): Promise<boolean> {
    // Renvoie vrai quand une publication en revue (`flagged`) devient visible.
    if (action === 'warn' || action === 'dismiss') {
      return false;
    }
    if (action === 'suspend') {
      throw new BadRequestException('La suspension de compte arrive avec la phase 5.');
    }

    if (targetType === 'publication' || targetType === 'comment') {
      const status =
        action === 'remove' ? 'removed' : action === 'hide' ? 'flagged' : 'approved';
      if (targetType === 'publication') {
        const [previous] = await tx
          .select({ status: publications.moderationStatus })
          .from(publications)
          .where(eq(publications.id, targetId));
        await tx
          .update(publications)
          .set({ moderationStatus: status })
          .where(eq(publications.id, targetId));
        if (action === 'restore') {
          return previous?.status === 'flagged';
        }
        if (action === 'remove') {
          // Un retrait définitif doit aussi retirer les octets du stockage :
          // sinon l'URL du média reste valable après la décision.
          await enqueuePublicationCleanup(tx, targetId);
        }
      } else {
        await tx
          .update(comments)
          .set({ moderationStatus: status })
          .where(eq(comments.id, targetId));
      }
      return false;
    }

    if (targetType === 'story') {
      if (action !== 'remove') {
        throw new BadRequestException('Une story ne peut qu’être retirée ou rétablie.');
      }
      await tx.update(stories).set({ deletedAt: new Date() }).where(eq(stories.id, targetId));
      return false;
    }

    // Comptes : les actions de contenu n'ont pas de sens ici.
    throw new BadRequestException('Action non applicable à un compte.');
  }

  private async loadTarget(
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<{ authorId: string }> {
    if (targetType === 'publication') {
      const [row] = await this.db
        .select({ authorId: publications.authorId })
        .from(publications)
        .where(eq(publications.id, targetId));
      if (!row) throw new NotFoundException('Publication introuvable.');
      return row;
    }
    if (targetType === 'comment') {
      const [row] = await this.db
        .select({ authorId: comments.authorId })
        .from(comments)
        .where(and(eq(comments.id, targetId), isNull(comments.deletedAt)));
      if (!row) throw new NotFoundException('Commentaire introuvable.');
      return row;
    }
    if (targetType === 'story') {
      const [row] = await this.db
        .select({ authorId: stories.authorId })
        .from(stories)
        .where(and(eq(stories.id, targetId), isNull(stories.deletedAt)));
      if (!row) throw new NotFoundException('Story introuvable.');
      return row;
    }
    const [row] = await this.db
      .select({ authorId: users.id })
      .from(users)
      .where(eq(users.id, targetId));
    if (!row) throw new NotFoundException('Compte introuvable.');
    return row;
  }

  /** Aperçus groupés : une requête par type de cible, jamais une par ligne. */
  private async previewsFor(
    rows: Array<{ targetType: ReportTargetType; targetId: string }>,
  ): Promise<Map<string, { text: string | null; authorId: string | null }>> {
    const map = new Map<string, { text: string | null; authorId: string | null }>();
    const idsOf = (type: ReportTargetType) =>
      rows.filter((row) => row.targetType === type).map((row) => row.targetId);

    const publicationIds = idsOf('publication');
    if (publicationIds.length > 0) {
      const found = await this.db
        .select({
          id: publications.id,
          caption: publications.caption,
          authorId: publications.authorId,
        })
        .from(publications)
        .where(inArray(publications.id, publicationIds));
      for (const row of found) {
        map.set(`publication:${row.id}`, {
          text: row.caption?.slice(0, 160) ?? null,
          authorId: row.authorId,
        });
      }
    }

    const commentIds = idsOf('comment');
    if (commentIds.length > 0) {
      const found = await this.db
        .select({ id: comments.id, body: comments.body, authorId: comments.authorId })
        .from(comments)
        .where(inArray(comments.id, commentIds));
      for (const row of found) {
        map.set(`comment:${row.id}`, { text: row.body.slice(0, 160), authorId: row.authorId });
      }
    }

    const storyIds = idsOf('story');
    if (storyIds.length > 0) {
      const found = await this.db
        .select({
          id: stories.id,
          caption: stories.caption,
          authorId: stories.authorId,
        })
        .from(stories)
        .where(inArray(stories.id, storyIds));
      for (const row of found) {
        map.set(`story:${row.id}`, {
          text: row.caption?.slice(0, 160) ?? null,
          authorId: row.authorId,
        });
      }
    }

    const userIds = idsOf('user');
    if (userIds.length > 0) {
      const found = await this.db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(inArray(users.id, userIds));
      for (const row of found) {
        map.set(`user:${row.id}`, { text: `@${row.username}`, authorId: row.id });
      }
    }

    return map;
  }
}

/** Minuscules, sans accents, espaces normalisés : base de comparaison unique. */
export function normalizeWord(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
