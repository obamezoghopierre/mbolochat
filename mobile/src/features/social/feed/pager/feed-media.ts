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

/**
 * Au-delà de ce ratio (largeur / hauteur), une vidéo n'est plus « verticale » :
 * même seuil que le cadrage des Reels (`video-page.tsx`).
 */
export const REELS_MAX_ASPECT = 3 / 4;

/**
 * La publication se lit-elle en plein écran vidéo (Reels) ? Seulement une
 * vidéo seule et **verticale** (hauteur > largeur), comme Instagram :
 * - un carrousel, même s'il commence par une vidéo, s'affiche en carte ;
 * - une vidéo carrée ou paysage s'affiche en carte au fil, à son format,
 *   au lieu d'un plein écran avec de larges bandes noires.
 * Sans dimensions connues, on garde le plein écran (cas le plus courant).
 */
export function isVideoPost(post: FeedPost): boolean {
  const playable = (post.media ?? []).filter((media) => Boolean(media.url));
  if (playable.length !== 1 || playable[0].kind !== 'video') {
    return false;
  }
  const { width, height } = playable[0];
  return !(width && height) || width < height;
}

/**
 * La publication a-t-elle une vidéo unique, lisible en plein écran ?
 *
 * Contrairement à `isVideoPost`, le format n'importe pas : une vidéo carrée ou
 * paysage est acceptée et affichée en entier (`contain`, voir `video-page`).
 *
 * Sans cette distinction, l'onglet Reels filtrait les vidéos non verticales
 * que le serveur lui envoyait (`?format=video` ne présume pas de l'orientation)
 * : ses pages pouvaient devenir vides, ce qui relançait le chargement en
 * boucle — fil vide et requêtes répétées.
 */
export function isPlayableVideo(post: FeedPost): boolean {
  const playable = (post.media ?? []).filter((media) => Boolean(media.url));
  return playable.length === 1 && playable[0].kind === 'video';
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
