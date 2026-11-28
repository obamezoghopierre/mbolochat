import type {
  FeedPost,
  SearchBlock,
  SearchHashtag,
  SearchResult,
  SearchUser,
} from '@/lib/types';

/** Longueur minimale imposée par l'API (trigrammes). */
export const MIN_SEARCH_LENGTH = 2;

/** Délai de frappe avant d'interroger l'API : la réponse la plus récente gagne. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Résultats par page quand un onglet précis se pagine (l'aperçu « Tous » reste à 10 par bloc). */
export const SEARCH_PAGE_SIZE = 24;

/** Taille des aperçus de l'onglet « Tous » ; au-delà, « Voir tout » ouvre l'onglet du type. */
export const SEARCH_PREVIEW_USERS = 5;
export const SEARCH_PREVIEW_TILES = 9;
export const SEARCH_PREVIEW_HASHTAGS = 5;

/** Onglet de filtre des résultats : l'aperçu ou un seul type, paginable. */
export type SearchFilter = 'all' | 'users' | 'publications' | 'hashtags';

/** Bloc du résultat qu'un onglet précis pagine par curseur. */
export type SearchBlockKey = Exclude<SearchFilter, 'all'>;

/** Requête normalisée : espaces réduits, coquille vide si trop courte. */
export function normalizeSearchQuery(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, ' ');
  return trimmed.length >= MIN_SEARCH_LENGTH ? trimmed : '';
}

/** Un hashtag se cherche sans son `#`. */
export function hashtagQuery(tag: string): string {
  return tag.replace(/^#+/, '');
}

export function totalResults(result: SearchResult): number {
  return (
    result.users.items.length +
    result.publications.items.length +
    result.hashtags.items.length
  );
}

export function emptySearchResult(): SearchResult {
  return {
    users: { items: [], nextCursor: null },
    publications: { items: [], nextCursor: null },
    hashtags: { items: [], nextCursor: null },
  };
}

/**
 * Ajoute une page à un bloc déjà affiché, sans doublon : un score qui bouge
 * entre deux pages peut renvoyer une ligne déjà vue. Le curseur retenu est
 * celui de la dernière page.
 */
export function mergeSearchBlock<T extends { id: string }>(
  current: SearchBlock<T>,
  page: SearchBlock<T>,
): SearchBlock<T> {
  const seen = new Set(current.items.map((item) => item.id));
  const fresh = page.items.filter((item) => !seen.has(item.id));
  return {
    items: [...current.items, ...fresh],
    nextCursor: page.nextCursor,
  };
}

/** Fusionne la page d'un type précis dans le bloc correspondant du résultat. */
export function mergeSearchResult(
  current: SearchResult,
  page: SearchResult,
  key: SearchBlockKey,
): SearchResult {
  if (key === 'users') {
    return { ...current, users: mergeSearchBlock(current.users, page.users) };
  }
  if (key === 'publications') {
    return {
      ...current,
      publications: mergeSearchBlock(current.publications, page.publications),
    };
  }
  return {
    ...current,
    hashtags: mergeSearchBlock(current.hashtags, page.hashtags),
  };
}

/** Un onglet de type précis pagine son bloc ; « Tous » n'en pagine aucun. */
export function blockForFilter(filter: SearchFilter): SearchBlockKey | null {
  return filter === 'all' ? null : filter;
}


/** État du bouton « Suivre » d'une ligne de résultat. */
export type SearchFollowUi = 'idle' | 'following' | 'pending';

/** Part de l'abonnement réel renvoyé par l'API, pas d'un « Suivre » présumé. */
export function followUiState(
  status: 'none' | 'pending' | 'accepted',
): SearchFollowUi {
  if (status === 'accepted') {
    return 'following';
  }
  return status === 'pending' ? 'pending' : 'idle';
}


/** Colonnes de la grille de publications trouvées, comme la mosaïque. */
export const SEARCH_TILE_COLUMNS = 3;

/**
 * Ligne de la liste de résultats. Une seule liste virtualisée porte toute la
 * recherche (titres, comptes, vignettes, hashtags) : un onglet précis peut
 * donc se paginer sans que la liste entière se rende.
 */
export type SearchEntry =
  | { kind: 'section'; key: string; block: SearchBlockKey; seeAll: boolean }
  | { kind: 'user'; key: string; account: SearchUser }
  | {
      kind: 'tiles';
      key: string;
      /** `index` = position dans la liste des publications (ouverture de la visionneuse). */
      tiles: { post: FeedPost; index: number }[];
    }
  | { kind: 'hashtag'; key: string; tag: SearchHashtag };

/**
 * Lignes affichées pour l'onglet actif.
 *
 * « Tous » donne un aperçu court de chaque type, avec « Voir tout » quand il
 * y en a davantage ; un onglet précis déroule tous les résultats chargés.
 * Les publications viennent de la liste vivante (`posts`), pas du bloc
 * d'origine : une réaction ou un « Pas intéressé » y est tout de suite pris
 * en compte.
 */
export function buildSearchEntries(
  result: SearchResult,
  posts: FeedPost[],
  filter: SearchFilter,
  columns: number = SEARCH_TILE_COLUMNS,
): SearchEntry[] {
  const preview = filter === 'all';
  const entries: SearchEntry[] = [];

  if ((filter === 'all' || filter === 'users') && result.users.items.length > 0) {
    const items = preview
      ? result.users.items.slice(0, SEARCH_PREVIEW_USERS)
      : result.users.items;
    entries.push({
      kind: 'section',
      key: 'section-users',
      block: 'users',
      seeAll:
        preview &&
        (result.users.items.length > SEARCH_PREVIEW_USERS ||
          result.users.nextCursor !== null),
    });
    for (const account of items) {
      entries.push({ kind: 'user', key: `user-${account.id}`, account });
    }
  }

  if ((filter === 'all' || filter === 'publications') && posts.length > 0) {
    const shown = preview ? posts.slice(0, SEARCH_PREVIEW_TILES) : posts;
    entries.push({
      kind: 'section',
      key: 'section-publications',
      block: 'publications',
      seeAll:
        preview &&
        (posts.length > SEARCH_PREVIEW_TILES ||
          result.publications.nextCursor !== null),
    });
    for (let start = 0; start < shown.length; start += columns) {
      const tiles = shown
        .slice(start, start + columns)
        .map((post, offset) => ({ post, index: start + offset }));
      entries.push({ kind: 'tiles', key: `tiles-${tiles[0].post.id}`, tiles });
    }
  }

  if (
    (filter === 'all' || filter === 'hashtags') &&
    result.hashtags.items.length > 0
  ) {
    const items = preview
      ? result.hashtags.items.slice(0, SEARCH_PREVIEW_HASHTAGS)
      : result.hashtags.items;
    entries.push({
      kind: 'section',
      key: 'section-hashtags',
      block: 'hashtags',
      seeAll:
        preview &&
        (result.hashtags.items.length > SEARCH_PREVIEW_HASHTAGS ||
          result.hashtags.nextCursor !== null),
    });
    for (const tag of items) {
      entries.push({ kind: 'hashtag', key: `hashtag-${tag.id}`, tag });
    }
  }

  return entries;
}

/** Aucune ligne de contenu (les titres de section ne comptent pas). */
export function hasSearchContent(entries: SearchEntry[]): boolean {
  return entries.some((entry) => entry.kind !== 'section');
}
