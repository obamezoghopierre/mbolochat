import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { DRIZZLE, type Database } from '../db/db.module.js';
import { blocks, socialNotifications, users, type SocialNotification, type SocialNotificationType } from '../db/schema.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../common/keyset-cursor.js';
import { PushService } from '../push/push.service.js';

export const NOTIFICATION_DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export interface NotificationActor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
}

export interface NotificationView {
  id: string;
  type: SocialNotificationType;
  publicationId: string | null;
  commentId: string | null;
  storyId: string | null;
  readAt: Date | null;
  createdAt: Date;
  actor: NotificationActor | null;
}

export interface NotificationPage {
  items: NotificationView[];
  unreadCount: number;
  nextCursor: string | null;
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Connexion Drizzle d'une transaction en cours, ou la base elle-même. */
type Executor = Database | Transaction;

/**
 * Notifications sociales (plan §8).
 *
 * Elles sont écrites **côté serveur** dans la transaction de l'interaction qui
 * les provoque, dédupliquées par `(destinataire, dedupe_key)`. Le push est un
 * effet séparé, déclenché après commit : un échec d'Expo ne défait jamais
 * l'interaction.
 */
@Injectable()
export class SocialNotificationsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly push: PushService,
  ) {}

  /**
   * Enregistre la notification si elle est légitime : jamais pour soi-même, et
   * jamais entre comptes dont l'un a bloqué l'autre. Le rejeu est inoffensif
   * grâce à la clé de déduplication.
   */
  async create(
    executor: Executor,
    input: {
      recipientId: string;
      actorId: string;
      type: SocialNotificationType;
      dedupeKey: string;
      publicationId?: string | null;
      commentId?: string | null;
      storyId?: string | null;
    },
  ): Promise<SocialNotification | null> {
    if (input.recipientId === input.actorId) {
      return null;
    }
    const [blocked] = await executor
      .select({ blockerId: blocks.blockerId })
      .from(blocks)
      .where(
        or(
          and(eq(blocks.blockerId, input.actorId), eq(blocks.blockedId, input.recipientId)),
          and(eq(blocks.blockerId, input.recipientId), eq(blocks.blockedId, input.actorId)),
        ),
      )
      .limit(1);
    if (blocked) {
      return null;
    }

    const [row] = await executor
      .insert(socialNotifications)
      .values({
        userId: input.recipientId,
        actorId: input.actorId,
        type: input.type,
        publicationId: input.publicationId ?? null,
        commentId: input.commentId ?? null,
        storyId: input.storyId ?? null,
        dedupeKey: input.dedupeKey,
      })
      .onConflictDoNothing()
      .returning();
    return row ?? null;
  }

  /**
   * Effet push, après commit. Ne lève jamais : la notification in-app existe
   * déjà et un incident réseau ne doit pas remonter à l'utilisateur.
   */
  async deliver(notification: SocialNotification | null): Promise<void> {
    if (!notification || !notification.actorId) {
      return;
    }
    const [actor] = await this.db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, notification.actorId));
    if (!actor) {
      return;
    }
    await this.push.notifySocial({
      userId: notification.userId,
      notificationId: notification.id,
      kind: notification.type,
      title: notificationTitle(notification.type, actor.displayName),
      body: notificationTitle(notification.type, actor.displayName),
      publicationId: notification.publicationId,
      commentId: notification.commentId,
      actorId: notification.actorId,
      actorName: actor.displayName,
    });
  }

  /** Fil de notifications du visiteur, du plus récent au plus ancien. */
  async list(viewerId: string, limit: number, cursor?: string): Promise<NotificationPage> {
    const bounded = Math.min(Math.max(1, limit), MAX_LIMIT);

    const conditions = [eq(socialNotifications.userId, viewerId)];
    if (cursor) {
      const decoded = decodeKeysetCursor(cursor);
      conditions.push(
        sql`(${socialNotifications.createdAt}, ${socialNotifications.id}) < (${decoded.raw}::timestamptz, ${decoded.id})`,
      );
    }

    const rows = await this.db
      .select({
        id: socialNotifications.id,
        type: socialNotifications.type,
        publicationId: socialNotifications.publicationId,
        commentId: socialNotifications.commentId,
        storyId: socialNotifications.storyId,
        readAt: socialNotifications.readAt,
        createdAt: socialNotifications.createdAt,
        createdAtText: sql<string>`${socialNotifications.createdAt}::text`,
        actor: {
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          verified: users.verified,
        },
      })
      .from(socialNotifications)
      .leftJoin(users, eq(users.id, socialNotifications.actorId))
      .where(and(...conditions))
      .orderBy(sql`${socialNotifications.createdAt} desc`, sql`${socialNotifications.id} desc`)
      .limit(bounded + 1);

    const [unread] = await this.db
      .select({ value: count() })
      .from(socialNotifications)
      .where(and(eq(socialNotifications.userId, viewerId), isNull(socialNotifications.readAt)));

    const page = rows.slice(0, bounded);
    const last = page.at(-1);
    return {
      items: page.map(({ createdAtText: _text, ...item }) => item),
      unreadCount: unread?.value ?? 0,
      nextCursor:
        rows.length > bounded && last
          ? encodeKeysetCursor(last.createdAtText, last.id)
          : null,
    };
  }

  /** Marque comme lues toutes les notifications, ou seulement celles listées. */
  async markRead(viewerId: string, ids?: string[]): Promise<{ updated: number }> {
    const conditions = [eq(socialNotifications.userId, viewerId), isNull(socialNotifications.readAt)];
    if (ids && ids.length > 0) {
      conditions.push(inArray(socialNotifications.id, ids.slice(0, MAX_LIMIT)));
    }
    const updated = await this.db
      .update(socialNotifications)
      .set({ readAt: new Date() })
      .where(and(...conditions))
      .returning({ id: socialNotifications.id });
    return { updated: updated.length };
  }
}

/** Libellé français, aligné sur ce que verra l'utilisateur. */
export function notificationTitle(type: SocialNotificationType, actorName: string): string {
  switch (type) {
    case 'like':
      return `${actorName} a réagi à ta publication`;
    case 'comment':
      return `${actorName} a commenté ta publication`;
    case 'reply':
      return `${actorName} a répondu à ton commentaire`;
    case 'follow':
      return `${actorName} s’est abonné à toi`;
    case 'follow_request':
      return `${actorName} demande à te suivre`;
    case 'follow_accepted':
      return `${actorName} a accepté ta demande`;
    case 'repost':
      return `${actorName} a repartagé ta publication`;
    case 'mention':
      return `${actorName} t’a mentionné`;
    case 'story_reply':
      return `${actorName} a répondu à ta story`;
    case 'moderation':
      return 'Décision de modération';
    default:
      return 'Nouvelle activité';
  }
}
