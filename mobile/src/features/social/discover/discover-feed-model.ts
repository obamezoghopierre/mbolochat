import type {
  FeedPost,
  PublicationMedia,
  SearchPublication,
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

/**
 * Conversion d'un résultat publication de recherche en publication du fil.
 *
 * La recherche renvoie la même carte que la grille Découvrir (format, médias,
 * compteurs) : la vignette s'affiche tout de suite, et la visionneuse récupère
 * le détail complet (état du lecteur, signets) à l'ouverture. Comme pour la
 * grille, l'état du lecteur est complété par l'hydratation.
 */
export function hydrateSearchPublication(
  item: SearchPublication,
  base: DiscoverPostHydration,
): FeedPost {
  return {
    id: item.id,
    kind: item.kind,
    format: item.format,
    caption: item.caption,
    visibility: 'public',
    createdAt: item.createdAt,
    author: item.author,
    media: item.media ?? [],
    counters: {
      ...item.counters,
      saves: base.viewer.saved ? 1 : 0,
    },
    viewer: base.viewer,
    quoted: null,
    repostedBy: null,
    likedBy: null,
  };
}

/**
 * Remplace la liste par une première page fraîche : un rafraîchissement
 * ramène les nouveautés en tête, et la suite se pagine depuis le curseur de
 * cette page (la liste ne peut donc pas garder d'anciennes pages).
 *
 * L'API de la grille ne renvoie pas l'état du lecteur : pour une publication
 * déjà connue, on garde sa réaction, son signet et son abonnement plutôt que
 * de les remettre à zéro, ainsi que les champs de détail déjà reçus.
 */
export function replaceFirstPage(
  current: FeedPost[],
  page: DiscoverPublication[],
  base: DiscoverPostHydration,
): FeedPost[] {
  const known = new Map(current.map((post) => [post.id, post]));
  return page.map((item) => {
    const hydrated = hydrateDiscoverPost(item, base);
    const previous = known.get(item.id);
    if (!previous) {
      return hydrated;
    }
    return {
      ...previous,
      ...hydrated,
      viewer: previous.viewer,
      counters: { ...hydrated.counters, saves: previous.counters.saves },
    };
  });
}

/** Colonnes de la mosaïque, comme la grille Explorer. */
export const EXPLORE_COLUMNS = 3;

/**
 * Ratio d'aspect en-deçà duquel une vignette est considérée comme « haute » :
 * une image portrait (9:16, 4:5) occupe deux hauteurs de rangée, comme sur
 * la grille Explorer d'Instagram.
 */
export const TALL_TILE_ASPECT = 0.7;

/** Vignette de la mosaïque, avec sa position dans la liste source. */
export interface ExploreTile {
  post: FeedPost;
  /** Position dans la liste source (`feed.items`) : ouverture et retour. */
  index: number;
  /** Hauteur de la vignette en pixels. */
  height: number;
}

/**
 * Rangée de la mosaïque : trois colonnes de largeur égale, dont certaines
 * empilent deux vignettes courtes à côté d'une vignette haute.
 */
export interface ExploreRow {
  /** Clé stable, pour le rendu de la liste. */
  key: string;
  /** Contenu de chaque colonne, de haut en bas (1 ou 2 vignettes). */
  columns: ExploreTile[][];
  /** Hauteur de la rangée en pixels. */
  height: number;
  /** 1 = rangée simple, 2 = rangée contenant une vignette haute. */
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

/** Première vignette haute de la fenêtre de trois à partir de `start`. */
function findTallTile(items: FeedPost[], start: number): number | null {
  const end = Math.min(start + EXPLORE_COLUMNS, items.length);
  for (let index = start; index < end; index += 1) {
    if (mediaAspect(items[index]) < TALL_TILE_ASPECT) {
      return index;
    }
  }
  return null;
}

/**
 * Organisation de la mosaïque Explorer, comme Instagram : colonnes de largeur
 * égale, où une vignette portrait occupe toute la hauteur de la rangée et où
 * les deux colonnes voisines empilent chacune deux vignettes carrées.
 *
 * La rangée entière n'est jamais étirée : une publication paysage garde une
 * vignette carrée, donc un recadrage raisonnable. Une rangée à vignette haute
 * consomme cinq entrées (la haute et quatre courtes) ; avec moins de contenu
 * restant, la rangée reste simple pour ne pas laisser de trou dans la mosaïque.
 *
 * `gutter` est la gouttière entre vignettes : la vignette haute la compte une
 * fois de plus, pour que les deux vignettes empilées d'une colonne voisine
 * s'alignent exactement sur sa hauteur.
 */
export function buildExploreRows(
  items: FeedPost[],
  tileWidth: number,
  gutter = 0,
): ExploreRow[] {
  const rows: ExploreRow[] = [];
  const tallHeight = tileWidth * 2 + gutter;
  let start = 0;

  while (start < items.length) {
    const rowKey = `explore-row-${rows.length}`;
    const tall = findTallTile(items, start);

    if (tall !== null && items.length - start >= EXPLORE_COLUMNS + 2) {
      // Colonne occupée par la vignette haute dans la rangée.
      const tallColumn = tall - start;
      // Vignettes courtes restantes, dans l'ordre de la liste.
      let next = start;
      const takeShort = (): ExploreTile => {
        while (next === tall) {
          next += 1;
        }
        const index = next;
        next += 1;
        return { post: items[index], index, height: tileWidth };
      };

      const columns: ExploreTile[][] = [];
      for (let column = 0; column < EXPLORE_COLUMNS; column += 1) {
        columns.push(
          column === tallColumn
            ? [{ post: items[tall], index: tall, height: tallHeight }]
            : [takeShort(), takeShort()],
        );
      }
      rows.push({ key: rowKey, columns, height: tallHeight, multiple: 2 });
      start += EXPLORE_COLUMNS + 2;
      continue;
    }

    const columns: ExploreTile[][] = [];
    for (
      let column = 0;
      column < EXPLORE_COLUMNS && start + column < items.length;
      column += 1
    ) {
      const index = start + column;
      columns.push([{ post: items[index], index, height: tileWidth }]);
    }
    rows.push({ key: rowKey, columns, height: tileWidth, multiple: 1 });
    start += EXPLORE_COLUMNS;
  }

  return rows;
}

/**
 * Décalage vertical de la rangée qui contient la vignette d'index : sert au
 * retour depuis le visionneuse, qui doit retrouver la vignette ouverte.
 */
export function exploreRowOffset(
  rows: ExploreRow[],
  index: number,
  gutter = 0,
): number {
  let offset = 0;
  for (const row of rows) {
    const holds = row.columns.some((column) =>
      column.some((tile) => tile.index === index),
    );
    if (holds) {
      return offset;
    }
    offset += row.height + gutter;
  }
  return 0;
}


/** Position d'une rangée dans la liste virtualisée : hauteur utile + gouttière. */
export interface ExploreRowLayout {
  length: number;
  offset: number;
}

/**
 * Mise en page de chaque rangée (`getItemLayout` de la liste) : les hauteurs
 * sont connues d'avance, donc la liste n'a rien à mesurer et un retour à une
 * vignette lointaine ne dépend d'aucun rendu préalable.
 */
export function exploreRowLayouts(
  rows: ExploreRow[],
  gutter = 0,
): ExploreRowLayout[] {
  let offset = 0;
  return rows.map((row) => {
    const layout = { length: row.height + gutter, offset };
    offset += layout.length;
    return layout;
  });
}
