import type {
  FeedPost,
  PublicationMedia,
  SocialAuthor,
  SocialReaction,
} from '@/lib/types';

import type { DiscoverPublication } from './discover-api';

/**
 * Contexte du lecteur absent de la section Découvrir : l'API de la grille
 * renvoie du contenu média sans l'état du visitateur (réaction, signet,
 * republication, abonnement). Le hydratant les complète pour que la grille
 * et le visionneuse plein écran partagent exactement le même `FeedPost`.
 */
export interface DiscoverPostViewer {
  reaction: SocialReaction | null;
  followingAuthor: boolean;
  followRequestPending?: boolean;
  saved?: boolean;
  reposted?: boolean;
}

export interface DiscoverPostHydration {
  viewer: DiscoverPostViewer;
  quoted?: FeedPost['quoted'];
  repostedBy?: SocialAuthor | null;
  likedBy?: SocialAuthor | null;
}

/**
 * Conversion d'une vignette Découvrir en publication du fil.
 *
 * La grille et le visionneuse s'appuient sur les mêmes champs que le fil :
 * l'hydratation est la seule passe de transformation, donc une interaction
 * (réaction, signet) appliquée dans le visionneuse se retrouve telle quelle
 * sur la vignette au retour.
 */
export function hydrateDiscoverPost(
  item: DiscoverPublication,
  base: DiscoverPostHydration,
): FeedPost {
  return {
    ...item,
    // La section Découvrir ne renvoie pas la visibilité : tout le contenu de
    // la grille est public (les publications privées n'y circulent pas).
    visibility: 'public',
    media: item.media ?? [],
    counters: {
      ...item.counters,
      // La section Découvrir ne renvoie pas les signets : le compteur suit
      // l'état du lecteur plutôt que de simuler un zéro.
      saves: base.viewer.saved ? 1 : 0,
    },
    viewer: base.viewer,
    quoted: base.quoted ?? null,
    repostedBy: base.repostedBy ?? null,
    likedBy: base.likedBy ?? null,
  };
}

/** Largeur d'une vignette d'une grille à 3 colonnes. */
export const EXPLORE_COLUMNS = 3;

/**
 * Ratio d'aspect en-deçà duquel une vignette est considérée comme « haute » :
 * une image portrait (9:16, 4:5) justifie une rangée double, comme sur la
 * grille Explorer d'Instagram.
 */
export const TALL_TILE_ASPECT = 0.7;

/** Rythme des rangées doubles sur un contenu sans image portrait. */
export const TALL_ROW_EVERY = 5;
export const TALL_ROW_INDEX = 2;

export interface ExploreRow {
  /** Clé stable, pour le rendu de la liste. */
  key: string;
  items: FeedPost[];
  /** Hauteur de la rangée en pixels : largeur de vignette × multiple. */
  height: number;
  /** 1 = rangée simple, 2 = rangée double (vignette haute). */
  multiple: 1 | 2;
}

/**
 * Ratio d'aspect du premier média d'une publication.
 * Une vidéo sans dimensions connues est traitée comme un portrait 9:16 :
 * c'est le format dominant des Reels, et cela évite une grille uniforme.
 */
export function mediaAspect(post: FeedPost): number {
  const media: PublicationMedia | undefined = post.media?.[0];
  if (!media) {
    return 1;
  }
  const { width, height } = media;
  if (!width || !height) {
    return post.kind === 'reel' ? 9 / 16 : 1;
  }
  return width / height;
}

/**
 * Organisement de la grille Explorer : rangées de trois vignettes, dont la
 * hauteur est soit simple, soit double.
 *
 * Instagram mélange les tailles de vignettes au lieu d'utiliser une grille
 * carrée unique : une rangée double allonge la grille et donne du rythme.
 * Une rangée est double quand l'un de ses médias est portrait ; sinon un
 * rythme régulier (une rangée double toutes les cinq) reproduit ce mélange
 * sur un contenu qui serait autrement uniforme.
 */
export function buildExploreRows(
  items: FeedPost[],
  tileWidth: number,
): ExploreRow[] {
  const rows: ExploreRow[] = [];
  for (let start = 0; start < items.length; start += EXPLORE_COLUMNS) {
    const rowItems = items.slice(start, start + EXPLORE_COLUMNS);
    const index = start / EXPLORE_COLUMNS;
    const portrait = rowItems.some(
      (post) => mediaAspect(post) < TALL_TILE_ASPECT,
    );
    const multiple: 1 | 2 = portrait
      ? 2
      : index % TALL_ROW_EVERY === TALL_ROW_INDEX
        ? 2
        : 1;
    rows.push({
      key: `explore-row-${index}`,
      items: rowItems,
      height: tileWidth * multiple,
      multiple,
    });
  }
  return rows;
}
