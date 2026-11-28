import { useCallback, useEffect, useRef, useState } from 'react';

import type { FeedPost } from '@/lib/types';
import { mergeFeedPage } from '../feed/feed-model';
import {
  hydrateDiscoverPost,
  replaceFirstPage,
  type DiscoverPostHydration,
} from './discover-feed-model';
import {
  loadDiscoverSection,
  type DiscoverSectionPage,
} from './discover-api';
import {
  usePostListActions,
  type DiscoverFeedActions,
} from './use-post-list-actions';

export type { DiscoverFeedActions } from './use-post-list-actions';

/** Vignettes par page ; l'API de section borne la limite à 50. */
export const DISCOVER_PAGE_SIZE = 30;

/** Durée d'affichage de la pastille « nouvelles publications » après un rafraîchissement. */
export const FRESH_PILL_MS = 4000;

/**
 * État de la grille Découvrir : une seule liste de publications hydratées,
 * partagée entre la grille et le visionneuse plein écran.
 *
 * Une interaction lancée dans le visionneuse modifie la liste ici, donc la
 * vignette d'origine est à jour au retour — le même comportement que le fil.
 */
export interface UseDiscoverFeedResult {
  items: FeedPost[];
  cursor: string | null;
  status: 'loading' | 'ready' | 'error';
  refreshing: boolean;
  loadingMore: boolean;
  moreError: boolean;
  /** Publications arrivées avec le dernier rafraîchissement (pastille). */
  freshCount: number;
  /** Masque la pastille (appui, ou délai écoulé). */
  clearFresh: () => void;
  actions: DiscoverFeedActions;
  /** Recharge la première page (défilement en haut de la grille). */
  refresh: () => void;
  /** Charge la page suivante (défilement vers le bas). */
  loadMore: () => void;
  /** Réessaie après une erreur de première page. */
  retryFirst: () => void;
}

export function useDiscoverFeed({
  token,
  initialPage,
  hydrate,
  onError,
}: {
  token: string;
  /** Première page mise en cache, affichée avant le réseau. */
  initialPage: DiscoverSectionPage | null;
  /** Contexte du lecteur (réaction, signet, abonnement) pour l'hydratation. */
  hydrate: DiscoverPostHydration;
  onError?: (message: string) => void;
}): UseDiscoverFeedResult {
  const [items, setItems] = useState<FeedPost[]>(() =>
    (initialPage?.items ?? []).map((item) => hydrateDiscoverPost(item, hydrate)),
  );
  const [cursor, setCursor] = useState<string | null>(
    initialPage?.nextCursor ?? null,
  );
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    initialPage ? 'ready' : 'loading',
  );
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  // Nombre de publications nouvelles en tête de grille après un
  // rafraîchissement, pour la pastille « nouvelles publications ».
  const [freshCount, setFreshCount] = useState(0);
  // Identifiant de requête : la réponse la plus récente gagne (un
  // rafraîchissement pendant un « charger plus » ne mélange pas les pages).
  const requestSeq = useRef(0);
  // Copie de la liste pour les actions optimistes : elles lisent l'état
  // courant sans passer par le rendu React (le serveur répond vite, la
  // mise à jour officielle arrive après).
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // La pastille s'efface seule : les nouveautés sont déjà en tête de grille.
  useEffect(() => {
    if (freshCount === 0) {
      return;
    }
    const timer = setTimeout(() => setFreshCount(0), FRESH_PILL_MS);
    return () => clearTimeout(timer);
  }, [freshCount]);

  const actions = usePostListActions({
    token,
    itemsRef,
    setItems,
    onError,
  });

  const requestFirst = useCallback((): Promise<DiscoverSectionPage | null> => {
    const seq = ++requestSeq.current;
    return loadDiscoverSection(token, 'popular', undefined, DISCOVER_PAGE_SIZE)
      .then((page) => {
        if (seq !== requestSeq.current) {
          return null;
        }
        // La première page remplace la liste : un rafraîchissement ramène les
        // nouveautés en tête, et l'état déjà connu des publications (réaction,
        // signet) est conservé.
        setItems((current) => replaceFirstPage(current, page.items, hydrate));
        setCursor(page.nextCursor);
        setMoreError(false);
        setStatus('ready');
        return page;
      })
      .catch(() => {
        if (seq === requestSeq.current) {
          // Une grille déjà affichée (instantané) reste préférable à l'erreur.
          setStatus((current) => (current === 'ready' ? current : 'error'));
        }
        return null;
      });
  }, [token, hydrate]);

  useEffect(() => {
    void requestFirst();
  }, [requestFirst]);

  const refresh = useCallback(() => {
    const known = new Set(itemsRef.current.map((item) => item.id));
    setRefreshing(true);
    void requestFirst()
      .then((page) => {
        // Compte les publications qui n'étaient pas dans la grille avant le
        // rafraîchissement : c'est ce qui alimente la pastille.
        if (page) {
          setFreshCount(page.items.filter((item) => !known.has(item.id)).length);
        }
      })
      .finally(() => setRefreshing(false));
  }, [requestFirst]);

  const retryFirst = useCallback(() => {
    setStatus('loading');
    void requestFirst();
  }, [requestFirst]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore || refreshing) {
      return;
    }
    const seq = requestSeq.current;
    setLoadingMore(true);
    setMoreError(false);
    void loadDiscoverSection(token, 'popular', cursor, DISCOVER_PAGE_SIZE)
      .then((page) => {
        if (seq !== requestSeq.current) {
          return;
        }
        setItems((current) =>
          mergeFeedPage(current, {
            items: page.items.map((item) => hydrateDiscoverPost(item, hydrate)),
            nextCursor: page.nextCursor,
          }).items,
        );
        setCursor(page.nextCursor);
      })
      .catch(() => {
        if (seq === requestSeq.current) {
          setMoreError(true);
        }
      })
      .finally(() => {
        if (seq === requestSeq.current) {
          setLoadingMore(false);
        }
      });
  }, [cursor, loadingMore, refreshing, token, hydrate]);

  const clearFresh = useCallback(() => setFreshCount(0), []);

  return {
    items,
    cursor,
    status,
    refreshing,
    loadingMore,
    moreError,
    freshCount,
    clearFresh,
    actions,
    refresh,
    loadMore,
    retryFirst,
  };
}
