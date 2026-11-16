import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';

import {
  markReadLocally,
  mergeNotificationPage,
} from './notifications-model';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { SocialNotification } from '@/lib/types';

export function useNotifications() {
  const { token } = useAuth();
  const [items, setItems] = useState<SocialNotification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
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
        const page = await api.notifications(
          token,
          options.reset ? undefined : (cursor ?? undefined),
        );
        setItems((current) =>
          options.reset ? page.items : mergeNotificationPage(current, page).items,
        );
        setCursor(page.nextCursor);
        setError(null);
        setStatus('ready');
      } catch {
        setError('Impossible de charger ton activité. Vérifie ta connexion.');
        setStatus((current) => (current === 'ready' ? 'ready' : 'error'));
      } finally {
        inFlight.current = false;
        setLoadingMore(false);
        setRefreshing(false);
      }
    },
    [cursor, token],
  );

  useEffect(() => {
    // Les états sont posés après la réponse réseau, pas pendant le montage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load({ reset: true });
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load({ reset: true });
  }, [load]);

  const loadMore = useCallback(() => {
    if (cursor && status === 'ready' && !loadingMore) {
      void load({ reset: false });
    }
  }, [cursor, load, loadingMore, status]);

  /** Marque une notification comme lue puis ouvre la cible si elle existe. */
  const open = useCallback(
    async (notification: SocialNotification) => {
      if (token && notification.readAt === null) {
        setItems((current) => markReadLocally(current, [notification.id]));
        try {
          await api.markNotificationsRead(token, [notification.id]);
        } catch {
          // L'échec n'empêche pas d'ouvrir le contenu ; le serveur rattrapera
          // au prochain marquage global.
        }
      }
      if (notification.publicationId) {
        router.push(`/post/${notification.publicationId}`);
      }
    },
    [token],
  );

  const markAllRead = useCallback(async () => {
    if (!token) {
      return;
    }
    setItems((current) => markReadLocally(current));
    try {
      await api.markNotificationsRead(token);
      setError(null);
    } catch {
      setError('Marquage impossible. Réessaie.');
    }
  }, [token]);

  return {
    items,
    status,
    error,
    refreshing,
    loadingMore,
    hasMore: cursor !== null,
    refresh,
    loadMore,
    open,
    markAllRead,
    retry: () => void load({ reset: true }),
  };
}
