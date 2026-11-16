import { useCallback, useEffect, useRef, useState } from 'react';

import { applyReaction, mergeFeedPage } from './feed-model';
import { ApiError, api } from '@/lib/api';
import type { FeedPost, FeedTab } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';

export type FeedStatus = 'loading' | 'ready' | 'error';

/**
 * État du fil : chargement initial, pagination par curseur, rafraîchissement et
 * réaction optimiste avec retour arrière en cas d'échec réseau.
 */
export function useFeed(tab: FeedTab) {
  const { token } = useAuth();
  const [items, setItems] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<FeedStatus>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(
    async (options: { reset: boolean }) => {
      if (!token || inFlight.current) {
        return;
      }
      inFlight.current = true;
      if (!options.reset) {
        setLoadingMore(true);
      }
      try {
        const page = await api.feed(
          token,
          tab,
          options.reset ? undefined : (cursor ?? undefined),
        );
        setItems((current) =>
          options.reset ? page.items : mergeFeedPage(current, page).items,
        );
        setCursor(page.nextCursor);
        setError(null);
        setStatus('ready');
      } catch (cause) {
        setError(
          cause instanceof ApiError
            ? cause.message
            : 'Impossible de charger le fil. Vérifie ta connexion.',
        );
        setStatus((current) => (current === 'ready' ? 'ready' : 'error'));
      } finally {
        inFlight.current = false;
        setLoadingMore(false);
        setRefreshing(false);
      }
    },
    [cursor, tab, token],
  );

  // L'onglet monte un nouveau fil (`key={tab}`) : le curseur d'un classement
  // n'a jamais de sens dans un autre.
  useEffect(() => {
    // Les états sont posés après l'appel réseau, pas pendant la phase de montage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load({ reset: true });
    // `load` change avec le curseur : la relancer à chaque page bouclerait.
  }, [tab, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load({ reset: true });
  }, [load]);

  const loadMore = useCallback(() => {
    if (cursor && status === 'ready' && !loadingMore) {
      void load({ reset: false });
    }
  }, [cursor, load, loadingMore, status]);

  const toggleLike = useCallback(
    async (post: FeedPost) => {
      if (!token) {
        return;
      }
      const removing = post.viewer.reaction !== null;
      const previous = items;
      setItems(applyReaction(items, post.id, removing ? null : 'like'));
      try {
        if (removing) {
          await api.removeReaction(token, post.id);
        } else {
          await api.reactToPublication(token, post.id, 'like');
        }
      } catch {
        // Le serveur fait foi : on rend l'état d'avant l'optimisme.
        setItems(previous);
        setError('Réaction non enregistrée. Vérifie ta connexion.');
      }
    },
    [items, token],
  );

  return {
    items,
    status,
    error,
    refreshing,
    loadingMore,
    hasMore: cursor !== null,
    refresh,
    loadMore,
    toggleLike,
    retry: () => void load({ reset: true }),
  };
}
