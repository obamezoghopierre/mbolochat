import type { FeedPost, PublicationMedia } from '@/lib/types';

/**
 * Média principal d'une publication : le premier du carrousel.
 *
 * Le pager plein écran n'affiche qu'un média à la fois ; les autres restent
 * accessibles depuis le détail. Un média sans URL exploitable est ignoré.
 */
export function primaryMedia(post: FeedPost): PublicationMedia | null {
  return (post.media ?? []).find((media) => Boolean(media.url)) ?? null;
}

/** La publication se lit-elle en plein écran vidéo ? */
export function isVideoPost(post: FeedPost): boolean {
  const media = primaryMedia(post);
  return media?.kind === 'video';
}

/** Nombre de médias supplémentaires, affiché en pastille si > 0. */
export function extraMediaCount(post: FeedPost): number {
  return Math.max(0, (post.media ?? []).length - 1);
}

/** Libellé compact des compteurs, façon Mbolo (1.2k). */
export function compactCount(value: number): string {
  if (value <= 0) {
    return '0';
  }
  if (value < 1000) {
    return String(value);
  }
  return `${(value / 1000).toFixed(1).replace('.0', '')}k`;
}
