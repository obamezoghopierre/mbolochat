import type { SocialNotification, SocialNotificationType } from '@/lib/types';

/**
 * Libellé d'une notification. Le serveur ne stocke pas de texte : il envoie le
 * type et l'acteur, le client compose la phrase dans la langue de l'app.
 */
export function notificationLabel(
  type: SocialNotificationType,
  actorName: string,
): string {
  switch (type) {
    case 'like':
      return `${actorName} a réagi à ta publication`;
    case 'comment':
      return `${actorName} a commenté ta publication`;
    case 'reply':
      return `${actorName} a répondu à ton commentaire`;
    case 'mention':
      return `${actorName} t’a mentionné`;
    case 'repost':
      return `${actorName} a repartagé ta publication`;
    case 'follow':
      return `${actorName} s’est abonné à toi`;
    case 'follow_request':
      return `${actorName} demande à te suivre`;
    case 'follow_accepted':
      return `${actorName} a accepté ta demande`;
    case 'story_reply':
      return `${actorName} a répondu à ta story`;
    case 'moderation':
      return 'Décision de modération';
    default:
      return 'Nouvelle activité';
  }
}

/** Marque localement comme lues les notifications ciblées (ou toutes). */
export function markReadLocally(
  items: SocialNotification[],
  ids?: string[],
  now: Date = new Date(),
): SocialNotification[] {
  const stamp = now.toISOString();
  const target = ids ? new Set(ids) : null;
  return items.map((item) =>
    item.readAt !== null || (target && !target.has(item.id))
      ? item
      : { ...item, readAt: stamp },
  );
}

/** Nombre de notifications encore non lues dans la liste affichée. */
export function countUnread(items: SocialNotification[]): number {
  return items.filter((item) => item.readAt === null).length;
}

/** Fusionne une page sans doublon, en gardant l'ordre du serveur. */
export function mergeNotificationPage(
  current: SocialNotification[],
  page: { items: SocialNotification[]; nextCursor: string | null },
): { items: SocialNotification[]; nextCursor: string | null } {
  const seen = new Set(current.map((item) => item.id));
  return {
    items: [...current, ...page.items.filter((item) => !seen.has(item.id))],
    nextCursor: page.nextCursor,
  };
}
