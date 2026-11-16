import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { blocks, follows, users } from '../db/schema.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import { canViewProfile, type SocialViewer } from '../users/visibility.js';
import { SocialNotificationsService } from '../social-notifications/social-notifications.service.js';

/** État d'abonnement rendu au client après une action. */
export interface FollowState {
  /** `none` : aucun lien ; `pending` : demande en attente ; `accepted` : abonné. */
  status: 'none' | 'pending' | 'accepted';
  /** Compteur d'abonnés de la cible, relu en base après l'écriture. */
  followerCount: number;
}

/** Ligne publique d'une liste d'abonnés : aucune donnée personnelle. */
export interface ConnectionUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  verified: boolean;
}

export interface ConnectionPage {
  items: ConnectionUser[];
  /** Curseur opaque pour la page suivante, `null` en fin de liste. */
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Valeur par défaut des listes d'abonnés, partagée avec le contrôleur. */
export const FOLLOW_LIST_DEFAULT_LIMIT = DEFAULT_LIMIT;

/**
 * Graphe social : suivre, ne plus suivre, demandes des comptes privés, listes.
 *
 * Toutes les règles d'autorisation sont appliquées ici, jamais seulement dans
 * l'UI : comptes privés, blocages et compteurs. Les compteurs sont écrits dans
 * la même transaction que la ligne `follows` pour qu'un échec ne laisse jamais
 * un abonnement sans son compteur (ou l'inverse).
 */
@Injectable()
export class FollowsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly notifications: SocialNotificationsService,
  ) {}

  /**
   * Suivre un compte. Idempotent : rejouer la requête ne crée pas de doublon et
   * ne réincrémente pas les compteurs.
   */
  async follow(followerId: string, targetId: string): Promise<FollowState> {
    if (followerId === targetId) {
      throw new BadRequestException('Impossible de s’abonner à son propre compte.');
    }
    const target = await this.loadTarget(targetId);
    if (await this.isBlocked(followerId, targetId)) {
      throw new ForbiddenException('Abonnement impossible avec ce compte.');
    }
    const status = target.privateAccount ? 'pending' : 'accepted';

    await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(follows)
        .values({ followerId, followingId: targetId, status })
        .onConflictDoNothing()
        .returning({ followerId: follows.followerId });

      // Rien inséré : la relation existait déjà (rejeu, ou demande en attente).
      if (inserted.length === 0) {
        return;
      }
      if (status === 'accepted') {
        await tx
          .update(users)
          .set({ followerCount: sql`${users.followerCount} + 1` })
          .where(eq(users.id, targetId));
        await tx
          .update(users)
          .set({ followingCount: sql`${users.followingCount} + 1` })
          .where(eq(users.id, followerId));
      }
    });

    const row = await this.getRow(followerId, targetId);
    // Notification côté serveur : demande ou abonnement, jamais pour soi-même
    // (écarté par le service) et jamais entre comptes bloqués.
    const notification = await this.notifications.create(this.db, {
      recipientId: targetId,
      actorId: followerId,
      type: status === 'pending' ? 'follow_request' : 'follow',
      dedupeKey: `follow:${followerId}`,
    });
    await this.notifications.deliver(notification);

    return { status: row?.status ?? 'none', followerCount: await this.countFollowers(targetId) };
  }

  /** Ne plus suivre. Idempotent, et ne décrémente que ce qui était compté. */
  async unfollow(followerId: string, targetId: string): Promise<FollowState> {
    await this.loadTarget(targetId);

    await this.db.transaction(async (tx) => {
      const deleted = await tx
        .delete(follows)
        .where(and(eq(follows.followerId, followerId), eq(follows.followingId, targetId)))
        .returning({ status: follows.status });

      if (deleted.length === 0 || deleted[0].status !== 'accepted') {
        return;
      }
      await tx
        .update(users)
        .set({ followerCount: sql`greatest(${users.followerCount} - 1, 0)` })
        .where(eq(users.id, targetId));
      await tx
        .update(users)
        .set({ followingCount: sql`greatest(${users.followingCount} - 1, 0)` })
        .where(eq(users.id, followerId));
    });

    return { status: 'none', followerCount: await this.countFollowers(targetId) };
  }

  /** Le propriétaire accepte ou refuse une demande d'abonnement en attente. */
  async respondToRequest(
    ownerId: string,
    followerId: string,
    accept: boolean,
  ): Promise<FollowState> {
    const row = await this.getRow(followerId, ownerId);
    if (!row || row.status !== 'pending') {
      throw new NotFoundException('Aucune demande d’abonnement en attente.');
    }

    await this.db.transaction(async (tx) => {
      if (!accept) {
        await tx
          .delete(follows)
          .where(and(eq(follows.followerId, followerId), eq(follows.followingId, ownerId)));
        return;
      }
      // Le filtre `status = pending` rend l'acceptation idempotente sous course.
      const updated = await tx
        .update(follows)
        .set({ status: 'accepted', acceptedAt: new Date() })
        .where(
          and(
            eq(follows.followerId, followerId),
            eq(follows.followingId, ownerId),
            eq(follows.status, 'pending'),
          ),
        )
        .returning({ followerId: follows.followerId });
      if (updated.length === 0) {
        return;
      }
      await tx
        .update(users)
        .set({ followerCount: sql`${users.followerCount} + 1` })
        .where(eq(users.id, ownerId));
      await tx
        .update(users)
        .set({ followingCount: sql`${users.followingCount} + 1` })
        .where(eq(users.id, followerId));
    });

    if (accept) {
      const notification = await this.notifications.create(this.db, {
        recipientId: followerId,
        actorId: ownerId,
        type: 'follow_accepted',
        dedupeKey: `follow_accepted:${ownerId}`,
      });
      await this.notifications.deliver(notification);
    }

    const after = await this.getRow(followerId, ownerId);
    return {
      status: after?.status ?? 'none',
      followerCount: await this.countFollowers(ownerId),
    };
  }

  /** Statut d'abonnement du visiteur vers la cible, sans les compteurs. */
  async followStatusOf(
    followerId: string,
    targetId: string,
  ): Promise<'none' | 'pending' | 'accepted'> {
    const row = await this.getRow(followerId, targetId);
    return row?.status ?? 'none';
  }

  /** Demandes en attente reçues par le propriétaire (compte privé). */
  async listRequests(ownerId: string): Promise<ConnectionUser[]> {    const rows = await this.db
      .select(this.connectionFields())
      .from(follows)
      .innerJoin(users, eq(users.id, follows.followerId))
      .where(and(eq(follows.followingId, ownerId), eq(follows.status, 'pending')))
      .orderBy(desc(follows.createdAt));
    return rows;
  }

  /** Abonnés de `targetId`, filtrés par la visibilité du profil. */
  async listFollowers(
    targetId: string,
    viewerId: string,
    limit: number,
    cursor?: string,
  ): Promise<ConnectionPage> {
    return this.listConnections('followers', targetId, viewerId, limit, cursor);
  }

  /** Comptes suivis par `targetId`, filtrés par la visibilité du profil. */
  async listFollowing(
    targetId: string,
    viewerId: string,
    limit: number,
    cursor?: string,
  ): Promise<ConnectionPage> {
    return this.listConnections('following', targetId, viewerId, limit, cursor);
  }

  /**
   * Faits nécessaires aux règles de visibilité pour un visiteur donné.
   * Utilisé par les listes et, plus tard, par le feed et le détail de profil.
   */
  async viewerFacts(viewerId: string | null, targetId: string): Promise<SocialViewer> {
    if (viewerId === null) {
      return { viewerId: null, isFollower: false, isFollowedBy: false, blocked: false };
    }
    const [row] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, viewerId));
    const [outgoing, incoming, blocked] = await Promise.all([
      this.getRow(viewerId, targetId),
      this.getRow(targetId, viewerId),
      this.isBlocked(viewerId, targetId),
    ]);
    return {
      viewerId,
      isFollower: outgoing?.status === 'accepted',
      isFollowedBy: incoming?.status === 'accepted',
      blocked,
      isModerator: row?.role === 'moderator' || row?.role === 'admin',
    };
  }

  private async listConnections(
    direction: 'followers' | 'following',
    targetId: string,
    viewerId: string,
    limit: number,
    cursor?: string,
  ): Promise<ConnectionPage> {
    const target = await this.loadTarget(targetId);
    const facts = await this.viewerFacts(viewerId, targetId);
    if (!canViewProfile({ userId: targetId, privateAccount: target.privateAccount }, facts)) {
      throw new ForbiddenException('Ce profil est privé.');
    }

    const bounded = Math.min(Math.max(1, limit), MAX_LIMIT);
    const ownerColumn = direction === 'followers' ? follows.followingId : follows.followerId;
    const otherColumn = direction === 'followers' ? follows.followerId : follows.followingId;

    const conditions = [eq(ownerColumn, targetId), eq(follows.status, 'accepted')];
    if (cursor) {
      const decoded = decodeKeysetCursor(cursor);
      // Comparaison de lignes entières, dans PostgreSQL : la précision des
      // microsecondes est conservée et la ligne du curseur est bien exclue.
      conditions.push(
        sql`(${follows.createdAt}, ${otherColumn}) < (${decoded.raw}::timestamptz, ${decoded.id})`,
      );
    }

    // Une ligne de plus que demandé : sa présence indique qu'une page suit.
    const rows = await this.db
      .select({
        ...this.connectionFields(),
        createdAtText: sql<string>`${follows.createdAt}::text`,
      })
      .from(follows)
      .innerJoin(users, eq(users.id, otherColumn))
      .where(and(...conditions))
      .orderBy(desc(follows.createdAt), desc(otherColumn))
      .limit(bounded + 1);

    const page = rows.slice(0, bounded);
    const last = page.at(-1);
    return {
      items: page.map(({ createdAtText: _createdAtText, ...rest }) => rest),
      nextCursor:
        rows.length > bounded && last
          ? encodeKeysetCursor(last.createdAtText, last.id)
          : null,
    };
  }

  private connectionFields() {
    return {
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      bio: users.bio,
      verified: users.verified,
    };
  }

  private async loadTarget(targetId: string) {
    const [target] = await this.db
      .select({
        id: users.id,
        privateAccount: users.privateAccount,
        followerCount: users.followerCount,
      })
      .from(users)
      .where(eq(users.id, targetId));
    if (!target) {
      throw new NotFoundException('Compte introuvable.');
    }
    return target;
  }

  private async getRow(followerId: string, followingId: string) {
    const [row] = await this.db
      .select({ status: follows.status })
      .from(follows)
      .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)));
    return row ?? null;
  }

  private async isBlocked(firstId: string, secondId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ blockerId: blocks.blockerId })
      .from(blocks)
      .where(
        or(
          and(eq(blocks.blockerId, firstId), eq(blocks.blockedId, secondId)),
          and(eq(blocks.blockerId, secondId), eq(blocks.blockedId, firstId)),
        ),
      );
    return row !== undefined;
  }

  private async countFollowers(targetId: string): Promise<number> {
    const [row] = await this.db
      .select({ followerCount: users.followerCount })
      .from(users)
      .where(eq(users.id, targetId));
    return row?.followerCount ?? 0;
  }
}
