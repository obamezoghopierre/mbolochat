import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import type { FeedPost, SearchResult } from '@/lib/types';
import { mergeFeedPage } from '../feed/feed-model';
import {
  hydrateSearchPublication,
  type DiscoverPostHydration,
} from './discover-feed-model';
import {
  blockForFilter,
  mergeSearchResult,
  normalizeSearchQuery,
  SEARCH_DEBOUNCE_MS,
  SEARCH_PAGE_SIZE,
  type SearchFilter,
} from './search-model';
import {
  usePostListActions,
  type DiscoverFeedActions,
} from './use-post-list-actions';

/** Réponse d'une requête de recherche, rangée sous la clé qui l'a demandée. */
interface SettledSearch {
  key: string;
  result: SearchResult | null;
  failed: boolean;
}

export interface UseSearchResultsResult {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Blocs comptes et hashtags ; les publications sont dans `posts`. */
  result: SearchResult | null;
  /** Publications trouvées, hydratées comme celles de la grille. */
  posts: FeedPost[];
  /** Curseur de la page suivante des publications (`null` = fin). */
  postsCursor: string | null;
  /** Mêmes actions que la grille : la visionneuse les partage. */
  actions: DiscoverFeedActions;
  loadingMore: boolean;
  moreError: boolean;
  /** Charge la page suivante de l'onglet actif (sans effet sur « Tous »). */
  loadMore: () => void;
  /** Relance la recherche courante après une erreur. */
  retry: () => void;
}

/**
 * Recherche unifiée de Découvrir : comptes, publications et hashtags.
 *
 * - « Tous » demande un aperçu de chaque bloc ; un onglet précis demande son
 *   seul type, par pages de `SEARCH_PAGE_SIZE`, avec un curseur.
 * - La frappe est débouncée ; un changement d'onglet part tout de suite. La
 *   réponse la plus récente gagne.
 * - L'état « chargement / prêt / erreur » se déduit de la clé de la dernière
 *   réponse, sans setState synchrone dans un effet.
 * - Les publications trouvées vivent dans une liste à elles, avec les mêmes
 *   actions optimistes que la grille : la visionneuse ouverte sur un résultat
 *   se met à jour comme sur la grille.
 */
export function useSearchResults({
  token,
  query,
  filter,
  hydrate,
  onError,
}: {
  token: string;
  query: string;
  filter: SearchFilter;
  /** Contexte du lecteur (réaction, signet, abonnement) pour l'hydratation. */
  hydrate: DiscoverPostHydration;
  onError?: (message: string) => void;
}): UseSearchResultsResult {
  const normalized = normalizeSearchQuery(query);
  const [reloadKey, setReloadKey] = useState(0);
  const key = normalized === '' ? null : `${normalized}|${filter}|${reloadKey}`;

  const [settled, setSettled] = useState<SettledSearch | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);

  const postsRef = useRef(posts);
  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);
  const requestId = useRef(0);
  const loadingMoreRef = useRef(false);
  const lastQuery = useRef('');

  const actions = usePostListActions({
    token,
    itemsRef: postsRef,
    setItems: setPosts,
    onError,
  });

  useEffect(() => {
    // Chaque passage invalide les réponses en vol, y compris quand la saisie
    // se vide : une réponse tardive ne ressuscite pas une recherche annulée.
    const current = ++requestId.current;
    if (!token || key === null) {
      return;
    }
    // Frappe : on attend la fin de la saisie ; onglet ou « Réessayer » : tout de suite.
    const typing = lastQuery.current !== normalized;
    lastQuery.current = normalized;
    const timer = setTimeout(
      () => {
        api
          .search(
            token,
            normalized,
            filter,
            filter === 'all' ? undefined : { limit: SEARCH_PAGE_SIZE },
          )
          .then((value) => {
            if (current !== requestId.current) {
              return;
            }
            setPosts(
              value.publications.items.map((item) =>
                hydrateSearchPublication(item, hydrate),
              ),
            );
            setSettled({ key, result: value, failed: false });
            setMoreError(false);
            setLoadingMore(false);
          })
          .catch(() => {
            if (current === requestId.current) {
              setSettled({ key, result: null, failed: true });
            }
          });
      },
      typing ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [token, key, normalized, filter, hydrate]);

  const answered = key !== null && settled?.key === key ? settled : null;
  const status: UseSearchResultsResult['status'] =
    key === null ? 'idle' : answered ? (answered.failed ? 'error' : 'ready') : 'loading';
  const result = answered?.result ?? null;

  const loadMore = useCallback(() => {
    const block = blockForFilter(filter);
    if (!token || block === null || key === null || !answered?.result) {
      return;
    }
    const cursor = answered.result[block].nextCursor;
    if (!cursor || loadingMoreRef.current) {
      return;
    }
    const seq = requestId.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setMoreError(false);
    api
      .search(token, normalized, block, { cursor, limit: SEARCH_PAGE_SIZE })
      .then((page) => {
        if (seq !== requestId.current) {
          return;
        }
        setSettled((previous) =>
          previous && previous.key === key && previous.result
            ? {
                ...previous,
                result: mergeSearchResult(previous.result, page, block),
              }
            : previous,
        );
        if (block === 'publications') {
          setPosts(
            (current) =>
              mergeFeedPage(current, {
                items: page.publications.items.map((item) =>
                  hydrateSearchPublication(item, hydrate),
                ),
                nextCursor: page.publications.nextCursor,
              }).items,
          );
        }
      })
      .catch(() => {
        if (seq === requestId.current) {
          setMoreError(true);
        }
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [token, key, normalized, filter, answered, hydrate]);

  const retry = useCallback(() => setReloadKey((value) => value + 1), []);

  return {
    status,
    result,
    posts,
    postsCursor: result?.publications.nextCursor ?? null,
    actions,
    loadingMore,
    moreError,
    loadMore,
    retry,
  };
}
