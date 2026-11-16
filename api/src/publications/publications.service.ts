import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import { computeHotScore, hotScoreSql } from '../feed/hot-score.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  comments,
  mediaAssets,
  publicationMedia,
  publicationReactions,
  publications,
  userSocialSettings,
  users,
} from '../db/schema.js';
import { FollowsService } from '../follows/follows.service.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { SocialNotificationsService } from '../social-notifications/social-notifications.service.js';
import { canInteract, canViewPublication, type SocialViewer } from '../users/visibility.js';
import type { CreateCommentDto, ReactDto } from './dto/interactions.dto.js';
import { loadPublicationMedia, type PublicationMediaView } from './publication-media.js';
import type { CreatePublicationDto } from './dto/create-publication.dto.js';

/** Carte d'auteur réduite au strict public : aucune donnée personnelle. */
export interface AuthorCard {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
}

export interface PublicationView {
  id: string;
  /** Médias attachés, dans l'ordre du carrousel. */
  media: PublicationMediaView[];
  kind: 'post' | 'reel';
  format: 'text' | 'image' | 'carousel' | 'video';
  caption: string | null;
  visibility: 'public' | 'followers' | 'private';
  createdAt: Date;
  author: AuthorCard;
  counters: {
    likes: number;
    comments: number;
    reposts: number;
    saves: number;
    views: number;
  };
  viewer: {
    /** Réaction du visiteur, `null` s'il n'a pas réagi. */
    reaction: 'like' | 'love' | 'fire' | 'clap' | null;
  };
}

export interface CommentView {
  id: string;
  publicationId: string;
  parentId: string | null;
  body: string;
  createdAt: Date;
  author: AuthorCard;
  likeCount: number;
}

export interface CommentPage {
  items: CommentView[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
/** Valeur par défaut des listes de commentaires, partagée avec le contrôleur. */
export const COMMENT_LIST_DEFAULT_LIMIT = DEFAULT_LIMIT;

type PublicationRow = typeof publications.$inferSelect;
type PublicationCommentNotification = NonNullable<
  Awaited<ReturnType<SocialNotificationsService['create']>>
>;

/**
 * Publications et interactions de base (ADR-0001, plan phase 1).
 *
 * Les règles de visibilité sont celles de `users/visibility.ts`. Les compteurs
 * sont incrémentés dans la même transaction que l'action et jamais lus depuis le
 * client. Toutes les créations clientes sont idempotentes par `clientId`.
 */
@Injectable()
export class PublicationsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly follows: FollowsService,
    private readonly notifications: SocialNotificationsService,
    private readonly moderation: ModerationService,
    private readonly config: ConfigService,
  ) {}

  async create(authorId: string, dto: CreatePublicationDto): Promise<PublicationView> {
    const assetIds = dto.assetIds ?? [];
    if (new Set(assetIds).size !== assetIds.length) {
      throw new BadRequestException('Média fourni deux fois.');
    }
    const caption = (dto.caption ?? '').trim();
    if (caption.length === 0 && assetIds.length === 0) {
      throw new BadRequestException('La légende ne peut pas être vide sans média.');
    }
    const kind = dto.kind ?? 'post';
    // Auto-flag : un contenu qui contient un mot bloqué part en revue humaine
    // au lieu d'être publié directement.
    const flagged = caption.length > 0 ? await this.moderation.hasBlockedWord(caption) : false;

    const inserted = await this.db.transaction(async (tx) => {
      const assets =
        assetIds.length === 0
          ? []
          : await tx
              .select()
              .from(mediaAssets)
              .where(
                and(
                  inArray(mediaAssets.id, assetIds),
                  eq(mediaAssets.ownerId, authorId),
                  eq(mediaAssets.status, 'ready'),
                  isNull(mediaAssets.deletedAt),
                ),
              );
      if (assets.length !== assetIds.length) {
        throw new BadRequestException('Média introuvable ou pas encore prêt.');
      }
      // L'ordre du carrousel est celui fourni par le client.
      const ordered = assetIds.map(
        (assetId) => assets.find((asset) => asset.id === assetId)!,
      );
      const kinds = new Set(ordered.map((asset) => asset.kind));
      if (kinds.size > 1) {
        throw new BadRequestException('Une publication ne mélange pas images et vidéos.');
      }
      const mediaKind = ordered[0]?.kind;
      if (mediaKind === 'video' && ordered.length > 1) {
        throw new BadRequestException('Une seule vidéo par publication.');
      }
      if (mediaKind === 'audio') {
        throw new BadRequestException('Le son seul n’est pas une publication.');
      }
      const format: 'text' | 'image' | 'carousel' | 'video' =
        mediaKind === 'video'
          ? 'video'
          : ordered.length > 1
            ? 'carousel'
            : ordered.length === 1
              ? 'image'
              : 'text';

      const now = new Date();
      const [row] = await tx
        .insert(publications)
        .values({
          authorId,
          kind,
          format,
          caption: caption.length > 0 ? caption : null,
          visibility: dto.visibility ?? 'public',
          moderationStatus: flagged ? 'flagged' : 'pending',
          clientId: dto.clientId,
          createdAt: now,
          // Score matérialisé dès la création : le feed pagine dessus.
          hotScore: computeHotScore({ likes: 0, comments: 0, reposts: 0, saves: 0 }, now, now),
        })
        .onConflictDoNothing()
        .returning();

      if (!row) {
        return null;
      }
      if (ordered.length > 0) {
        await tx.insert(publicationMedia).values(
          ordered.map((asset, position) => ({
            publicationId: row.id,
            assetId: asset.id,
            position,
          })),
        );
      }
      await tx
        .update(users)
        .set({
          publicationCount: sql`${users.publicationCount} + 1`,
          ...(kind === 'reel' ? { reelCount: sql`${users.reelCount} + 1` } : {}),
        })
        .where(eq(users.id, authorId));
      return row;
    });

    if (inserted) {
      return this.view(inserted, authorId);
    }
    // Rejeu : on rend la publication déjà enregistrée pour ce `clientId`.
    const [existing] = await this.db
      .select()
      .from(publications)
      .where(and(eq(publications.authorId, authorId), eq(publications.clientId, dto.clientId)));
    if (!existing) {
      throw new ForbiddenException('Publication en conflit.');
    }
    return this.view(existing, authorId);
  }

  async get(publicationId: string, viewerId: string): Promise<PublicationView> {
    const { row } = await this.assertVisible(publicationId, viewerId);
    return this.view(row, viewerId);
  }

  /** Suppression logique par l'auteur, idempotente. */
  async remove(publicationId: string, viewerId: string): Promise<{ deleted: true }> {
    const { row } = await this.load(publicationId);
    if (row.authorId !== viewerId) {
      throw new ForbiddenException('Seul l’auteur peut supprimer sa publication.');
    }
    if (row.deletedAt) {
      return { deleted: true };
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(publications)
        .set({ deletedAt: new Date() })
        .where(eq(publications.id, publicationId));
      await tx
        .update(users)
        .set({
          publicationCount: sql`greatest(${users.publicationCount} - 1, 0)`,
          ...(row.kind === 'reel'
            ? { reelCount: sql`greatest(${users.reelCount} - 1, 0)` }
            : {}),
        })
        .where(eq(users.id, row.authorId));
    });
    return { deleted: true };
  }

  /**
   * Réagit à une publication. Une seule réaction par compte : rejouer la même
   * requête ne réincrémente pas le compteur, changer de type met à jour la ligne.
   */
  async react(publicationId: string, viewerId: string, dto: ReactDto) {
    const { row, facts } = await this.assertVisible(publicationId, viewerId);
    if (facts.blocked) {
      throw new ForbiddenException('Interaction impossible avec ce compte.');
    }
    const kind = dto.kind ?? 'like';
    let notification: Awaited<ReturnType<SocialNotificationsService['create']>> = null;

    await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(publicationReactions)
        .values({ publicationId, userId: viewerId, kind })
        .onConflictDoNothing()
        .returning({ kind: publicationReactions.kind });

      if (inserted.length === 0) {
        await tx
          .update(publicationReactions)
          .set({ kind })
          .where(
            and(
              eq(publicationReactions.publicationId, publicationId),
              eq(publicationReactions.userId, viewerId),
            ),
          );
        return;
      }
      await tx
        .update(publications)
        .set({ likeCount: sql`${publications.likeCount} + 1` })
        .where(eq(publications.id, publicationId));
      await tx
        .update(users)
        .set({ likeReceivedCount: sql`${users.likeReceivedCount} + 1` })
        .where(eq(users.id, row.authorId));
      await this.refreshHotScore(tx, publicationId);
      notification = await this.notifications.create(tx, {
        recipientId: row.authorId,
        actorId: viewerId,
        type: 'like',
        dedupeKey: `like:${publicationId}:${viewerId}`,
        publicationId,
      });
    });

    // Effet push hors transaction : un échec réseau ne défait pas la réaction.
    await this.notifications.deliver(notification);

    return { reaction: kind, likeCount: await this.likeCount(publicationId) };
  }

  /** Retire la réaction, idempotent. */
  async unreact(publicationId: string, viewerId: string) {
    const { row } = await this.assertVisible(publicationId, viewerId);

    await this.db.transaction(async (tx) => {
      const deleted = await tx
        .delete(publicationReactions)
        .where(
          and(
            eq(publicationReactions.publicationId, publicationId),
            eq(publicationReactions.userId, viewerId),
          ),
        )
        .returning({ kind: publicationReactions.kind });

      if (deleted.length === 0) {
        return;
      }
      await tx
        .update(publications)
        .set({ likeCount: sql`greatest(${publications.likeCount} - 1, 0)` })
        .where(eq(publications.id, publicationId));
      await tx
        .update(users)
        .set({ likeReceivedCount: sql`greatest(${users.likeReceivedCount} - 1, 0)` })
        .where(eq(users.id, row.authorId));
      await this.refreshHotScore(tx, publicationId);
    });

    return { reaction: null, likeCount: await this.likeCount(publicationId) };
  }

  /** Commente ou répond. Idempotent par `(auteur, clientId)`. */
  async comment(
    publicationId: string,
    viewerId: string,
    dto: CreateCommentDto,
  ): Promise<CommentView> {
    const body = dto.body.trim();
    if (body.length === 0) {
      throw new BadRequestException('Le commentaire ne peut pas être vide.');
    }
    const { row, facts } = await this.assertVisible(publicationId, viewerId);

    const [settings] = await this.db
      .select({ commentPermission: userSocialSettings.commentPermission })
      .from(userSocialSettings)
      .where(eq(userSocialSettings.userId, row.authorId));
    if (!canInteract(settings?.commentPermission ?? 'everyone', facts)) {
      throw new ForbiddenException('Ce compte n’autorise pas les commentaires.');
    }

    let parentAuthorId: string | null = null;
    if (dto.parentId) {
      const [parent] = await this.db
        .select({
          id: comments.id,
          publicationId: comments.publicationId,
          authorId: comments.authorId,
        })
        .from(comments)
        .where(and(eq(comments.id, dto.parentId), isNull(comments.deletedAt)));
      if (!parent || parent.publicationId !== publicationId) {
        throw new NotFoundException('Commentaire parent introuvable.');
      }
      parentAuthorId = parent.authorId;
    }

    let created: PublicationCommentNotification[] = [];
    const inserted = await this.db.transaction(async (tx) => {
      const [comment] = await tx
        .insert(comments)
        .values({
          publicationId,
          authorId: viewerId,
          parentId: dto.parentId ?? null,
          body,
          clientId: dto.clientId,
        })
        .onConflictDoNothing()
        .returning();

      if (!comment) {
        return null;
      }
      await tx
        .update(publications)
        .set({ commentCount: sql`${publications.commentCount} + 1` })
        .where(eq(publications.id, publicationId));
      if (comment.parentId) {
        await tx
          .update(comments)
          .set({ replyCount: sql`${comments.replyCount} + 1` })
          .where(eq(comments.id, comment.parentId));
      }
      await this.refreshHotScore(tx, publicationId);
      const notifications = [
        await this.notifications.create(tx, {
          recipientId: row.authorId,
          actorId: viewerId,
          type: 'comment',
          dedupeKey: `comment:${comment.id}`,
          publicationId,
          commentId: comment.id,
        }),
      ];
      if (comment.parentId && parentAuthorId && parentAuthorId !== row.authorId) {
        notifications.push(
          await this.notifications.create(tx, {
            recipientId: parentAuthorId,
            actorId: viewerId,
            type: 'reply',
            dedupeKey: `reply:${comment.id}:${parentAuthorId}`,
            publicationId,
            commentId: comment.id,
          }),
        );
      }
      created = notifications.filter((item): item is NonNullable<typeof item> => item !== null);
      return comment;
    });

    for (const notification of created) {
      await this.notifications.deliver(notification);
    }

    if (inserted) {
      return this.loadCommentView(inserted.id);
    }
    const [existing] = await this.db
      .select()
      .from(comments)
      .where(and(eq(comments.authorId, viewerId), eq(comments.clientId, dto.clientId)));
    if (!existing) {
      throw new ForbiddenException('Commentaire en conflit.');
    }
    return this.loadCommentView(existing.id);
  }

  /** Commentaires d'une publication, paginés par curseur (ordre chronologique). */
  async listComments(
    publicationId: string,
    viewerId: string,
    limit: number,
    cursor?: string,
  ): Promise<CommentPage> {
    await this.assertVisible(publicationId, viewerId);
    const bounded = Math.min(Math.max(1, limit), MAX_LIMIT);

    const conditions = [eq(comments.publicationId, publicationId), isNull(comments.deletedAt)];
    if (cursor) {
      // Ordre croissant : on reprend strictement après le curseur, en gardant
      // la précision PostgreSQL (cf. common/keyset-cursor.ts).
      const decoded = decodeKeysetCursor(cursor);
      conditions.push(
        sql`(${comments.createdAt}, ${comments.id}) > (${decoded.raw}::timestamptz, ${decoded.id})`,
      );
    }

    const rows = await this.db
      .select({
        comment: comments,
        author: this.authorFields(),
        createdAtText: sql<string>`${comments.createdAt}::text`,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(and(...conditions))
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .limit(bounded + 1);

    const page = rows.slice(0, bounded);
    const last = page.at(-1);
    return {
      items: page.map(({ comment, author }) => ({
        id: comment.id,
        publicationId: comment.publicationId,
        parentId: comment.parentId,
        body: comment.body,
        createdAt: comment.createdAt,
        author,
        likeCount: comment.likeCount,
      })),
      nextCursor:
        rows.length > bounded && last
          ? encodeKeysetCursor(last.createdAtText, last.comment.id)
          : null,
    };
  }

  /** Suppression logique par l'auteur du commentaire ou de la publication. */
  async removeComment(commentId: string, viewerId: string): Promise<{ deleted: true }> {
    const [row] = await this.db
      .select({
        id: comments.id,
        parentId: comments.parentId,
        publicationId: comments.publicationId,
        authorId: comments.authorId,
        deletedAt: comments.deletedAt,
        publicationAuthorId: publications.authorId,
      })
      .from(comments)
      .innerJoin(publications, eq(publications.id, comments.publicationId))
      .where(eq(comments.id, commentId));
    if (!row) {
      throw new NotFoundException('Commentaire introuvable.');
    }
    if (row.authorId !== viewerId && row.publicationAuthorId !== viewerId) {
      throw new ForbiddenException('Suppression non autorisée.');
    }
    if (row.deletedAt) {
      return { deleted: true };
    }

    await this.db.transaction(async (tx) => {
      await tx.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, commentId));
      await tx
        .update(publications)
        .set({ commentCount: sql`greatest(${publications.commentCount} - 1, 0)` })
        .where(eq(publications.id, row.publicationId));
      if (row.parentId) {
        await tx
          .update(comments)
          .set({ replyCount: sql`greatest(${comments.replyCount} - 1, 0)` })
          .where(eq(comments.id, row.parentId));
      }
      await this.refreshHotScore(tx, row.publicationId);
    });
    return { deleted: true };
  }

  /** Charge la publication et applique la visibilité. 404 pour ne rien fuiter. */
  private async assertVisible(
    publicationId: string,
    viewerId: string,
  ): Promise<{ row: PublicationRow; facts: SocialViewer }> {
    const { row } = await this.load(publicationId);
    const facts = await this.follows.viewerFacts(viewerId, row.authorId);
    const visible = canViewPublication(
      {
        authorId: row.authorId,
        visibility: row.visibility,
        moderationStatus: row.moderationStatus,
        deleted: row.deletedAt !== null,
      },
      facts,
    );
    if (!visible) {
      throw new NotFoundException('Publication introuvable.');
    }
    return { row, facts };
  }

  private async load(publicationId: string): Promise<{ row: PublicationRow }> {
    const [row] = await this.db
      .select()
      .from(publications)
      .where(eq(publications.id, publicationId));
    if (!row) {
      throw new NotFoundException('Publication introuvable.');
    }
    return { row };
  }

  private async view(row: PublicationRow, viewerId: string): Promise<PublicationView> {
    const [author] = await this.db
      .select(this.authorFields())
      .from(users)
      .where(eq(users.id, row.authorId));
    const mediaMap = await loadPublicationMedia(
      this.db,
      [row.id],
      this.config.get<string>('SOCIAL_S3_PUBLIC_BASE_URL') ?? null,
    );
    const [reaction] = await this.db
      .select({ kind: publicationReactions.kind })
      .from(publicationReactions)
      .where(
        and(
          eq(publicationReactions.publicationId, row.id),
          eq(publicationReactions.userId, viewerId),
        ),
      );

    return {
      id: row.id,
      media: mediaMap.get(row.id) ?? [],
      kind: row.kind,
      format: row.format,
      caption: row.caption,
      visibility: row.visibility,
      createdAt: row.createdAt,
      author: author ?? {
        id: row.authorId,
        username: '',
        displayName: '',
        avatarUrl: null,
        verified: false,
      },
      counters: {
        likes: row.likeCount,
        comments: row.commentCount,
        reposts: row.repostCount,
        saves: row.saveCount,
        views: row.viewCount,
      },
      viewer: { reaction: reaction?.kind ?? null },
    };
  }

  private async loadCommentView(commentId: string): Promise<CommentView> {
    const [row] = await this.db
      .select({ comment: comments, author: this.authorFields() })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(eq(comments.id, commentId));
    if (!row) {
      throw new NotFoundException('Commentaire introuvable.');
    }
    return {
      id: row.comment.id,
      publicationId: row.comment.publicationId,
      parentId: row.comment.parentId,
      body: row.comment.body,
      createdAt: row.comment.createdAt,
      author: row.author,
      likeCount: row.comment.likeCount,
    };
  }

  /**
   * Recalcule le score après une interaction. Deuxième instruction de la même
   * transaction : PostgreSQL évalue les `SET` sur l'ancienne ligne, donc un
   * update unique lirait des compteurs périmés.
   */
  private async refreshHotScore(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    publicationId: string,
  ): Promise<void> {
    await tx
      .update(publications)
      .set({ hotScore: hotScoreSql() })
      .where(eq(publications.id, publicationId));
  }

  private authorFields() {
    return {
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      verified: users.verified,
    };
  }

  private async likeCount(publicationId: string): Promise<number> {
    const [row] = await this.db
      .select({ likeCount: publications.likeCount })
      .from(publications)
      .where(eq(publications.id, publicationId));
    return row?.likeCount ?? 0;
  }
}
