import { useCallback, useEffect, useRef, useState } from 'react';

import { applyReaction, mergeFeedPage, toggleRepost, toggleSave } from './feed-model';
import { ApiError, api } from '@/lib/api';
import type { FeedPost, FeedTab, SocialReaction } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';

export type FeedStatus = 'loading' | 'ready' | 'error';

/** Message court affiché en haut du fil (erreur d'action, retour de geste). */
export interface FeedNotice {
  message: string;
  tone: 'error' | 'info';
}

/**
 * Mémoire des fils chargés, clé par (session, onglet).
 *
 * TikTok ne recharge pas un onglet déjà visité : il garde sa liste et son
 * curseur en mémoire et ne rajoute que de nouveaux éléments. On reproduit ce
 * comportement ici — sinon changer d'onglet repart d'un écran de chargement et
 * referme le fil courant.
 */
interface CachedFeed {
  items: FeedPost[];
  cursor: string | null;
  status: FeedStatus;
  loadedAt: number;
}

const feedCache = new Map<string, CachedFeed>();

/** Au-delà, le fil est requêté à nouveau (le classement a pu bouger). */
const FEED_CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(token: string, tab: FeedTab): string {
  return `${token}:${tab}`;
}

/**
 * État du fil : chargement initial, pagination par curseur, rafraîchissement et
 * actions optimistes avec retour arrière en cas d'échec réseau.
 *
 * Chaque action renvoie l'état attendu pour que l'écran puisse afficher un
 * retour immédiat (toast, pastille) sans relire la liste.
 */
export function useFeed(tab: FeedTab) {
  const { token } = useAuth();
  const key = token ? cacheKey(token, tab) : '';
  const cached = key ? feedCache.get(key) : undefined;

  const [items, setItems] = useState<FeedPost[]>(cached?.items ?? []);
  const [cursor, setCursor] = useState<string | null>(cached?.cursor ?? null);
  const [status, setStatus] = useState<FeedStatus>(cached ? 'ready' : 'loading');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<FeedNotice | null>(null);
  const inFlight = useRef(false);

  // Toute mutation (chargement, pagination, action optimiste) est conservée
  // pour que le retour sur l'onglet soit immédiat, sans requête réseau.
  useEffect(() => {
    if (key && status === 'ready') {
      feedCache.set(key, { items, cursor, status, loadedAt: Date.now() });
    }
  }, [cursor, items, key, status]);

  const notifyError = useCallback((message: string) => {
    setNotice({ message, tone: 'error' });
  }, []);

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
        setNotice(null);
        setStatus('ready');
      } catch (cause) {
        setNotice({
          message:
            cause instanceof ApiError
              ? cause.message
              : 'Impossible de charger le fil. Vérifie ta connexion.',
          tone: 'error',
        });
        setStatus((current) => (current === 'ready' ? 'ready' : 'error'));
      } finally {
        inFlight.current = false;
        setLoadingMore(false);
        setRefreshing(false);
      }
    },
    [cursor, tab, token],
  );

  // Un onglet déjà visité garde sa liste : on ne requête que s'il n'y a rien
  // en cache, ou si le cache a périmé. Le pull-to-refresh force le rechargement.
  useEffect(() => {
    if (!token) {
      return;
    }
    const entry = feedCache.get(cacheKey(token, tab));
    if (!entry || Date.now() - entry.loadedAt >= FEED_CACHE_TTL_MS) {
      // Les états sont posés après l'appel réseau, pas pendant le montage.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load({ reset: true });
    }
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
      setItems((current) => applyReaction(current, post.id, removing ? null : 'like'));
      try {
        if (removing) {
          await api.removeReaction(token, post.id);
        } else {
          await api.reactToPublication(token, post.id, 'like');
        }
      } catch {
        // Le serveur fait foi : on rend l'état d'avant l'optimisme, pour cette
        // publication seulement — une page chargée entre-temps reste en place.
        setItems((current) => restorePost(current, post));
        notifyError('Réaction non enregistrée. Vérifie ta connexion.');
      }
    },
    [notifyError, token],
  );

  /**
   * Change la réaction (ou la retire). Un seul type par compte : l'API met à
   * jour la ligne existante, le compteur ne bouge que sur `null` ↔ type.
   */
  const setReaction = useCallback(
    async (post: FeedPost, kind: SocialReaction | null) => {
      if (!token || post.viewer.reaction === kind) {
        return;
      }
      setItems((current) => applyReaction(current, post.id, kind));
      try {
        if (kind === null) {
          await api.removeReaction(token, post.id);
        } else {
          await api.reactToPublication(token, post.id, kind);
        }
      } catch {
        setItems((current) => restorePost(current, post));
        notifyError('Réaction non enregistrée. Vérifie ta connexion.');
      }
    },
    [notifyError, token],
  );

  /** Écarte une publication du fil (« Pas intéressé »), avec retour arrière. */
  const dismiss = useCallback(
    async (post: FeedPost) => {
      if (!token) {
        return;
      }
      const previous = items;
      setItems((current) => current.filter((entry) => entry.id !== post.id));
      try {
        await api.notInterested(token, post.id);
        setNotice({ message: 'Moins de contenus comme celui-ci', tone: 'info' });
      } catch {
        setItems((current) => restoreItems(current, previous));
        notifyError('Action impossible. Réessaie.');
      }
    },
    [items, notifyError, token],
  );

  /** Masque toutes les publications d'un auteur, avec retour arrière. */
  const muteAuthorAction = useCallback(
    async (post: FeedPost) => {
      if (!token) {
        return;
      }
      const previous = items;
      setItems((current) => current.filter((entry) => entry.author.id !== post.author.id));
      try {
        await api.muteAuthor(token, post.author.id);
        setNotice({ message: 'Auteur masqué dans ton fil', tone: 'info' });
      } catch {
        setItems((current) => restoreItems(current, previous));
        notifyError('Action impossible. Réessaie.');
      }
    },
    [items, notifyError, token],
  );

  const toggleSaveAction = useCallback(
    async (post: FeedPost) => {
      if (!token) {
        return;
      }
      const next = toggleSave(items, post.id);
      setItems(next.items);
      try {
        if (next.saved) {
          await api.savePublication(token, post.id);
        } else {
          await api.unsavePublication(token, post.id);
        }
        setNotice({
          message: next.saved ? 'Publication enregistrée' : 'Enregistrement retiré',
          tone: 'info',
        });
      } catch {
        setItems((current) => restorePost(current, post));
        notifyError('Enregistrement impossible. Vérifie ta connexion.');
      }
    },
    [items, notifyError, token],
  );

  const toggleRepostAction = useCallback(
    async (post: FeedPost) => {
      if (!token) {
        return;
      }
      const next = toggleRepost(items, post.id);
      setItems(next.items);
      try {
        if (next.reposted) {
          await api.repostPublication(token, post.id);
        } else {
          await api.unrepostPublication(token, post.id);
        }
        setNotice({
          message: next.reposted ? 'Publication republiée' : 'Republication retirée',
          tone: 'info',
        });
      } catch {
        setItems((current) => restorePost(current, post));
        notifyError('Republication impossible. Vérifie ta connexion.');
      }
    },
    [items, notifyError, token],
  );

  const follow = useCallback(
    async (post: FeedPost) => {
      if (!token) {
        return;
      }
      setItems((current) => markFollowing(current, post.author.id));
      try {
        const result = await api.followUser(token, post.author.id);
        if (result.status !== 'accepted') {
          setItems((current) => markFollowing(current, post.author.id, false));
          setNotice({ message: 'Demande d’abonnement envoyée', tone: 'info' });
        }
      } catch {
        setItems((current) => markFollowing(current, post.author.id, post.viewer.followingAuthor));
        notifyError('Abonnement impossible. Réessaie.');
      }
    },
    [notifyError, token],
  );

  const remove = useCallback(
    async (post: FeedPost) => {
      if (!token) {
        return;
      }
      const index = items.findIndex((entry) => entry.id === post.id);
      setItems((current) => current.filter((entry) => entry.id !== post.id));
      try {
        await api.deletePublication(token, post.id);
        setNotice({ message: 'Publication supprimée', tone: 'info' });
      } catch {
        // Réinsertion à sa place d'origine, sans écraser les autres pages.
        setItems((current) => {
          if (current.some((entry) => entry.id === post.id)) {
            return current;
          }
          const next = [...current];
          next.splice(Math.max(0, Math.min(index, next.length)), 0, post);
          return next;
        });
        notifyError('Suppression impossible.');
      }
    },
    [items, notifyError, token],
  );

  return {
    items,
    status,
    notice,
    refreshing,
    loadingMore,
    hasMore: cursor !== null,
    refresh,
    loadMore,
    toggleLike,
    setReaction,
    dismiss,
    muteAuthor: muteAuthorAction,
    toggleSave: toggleSaveAction,
    toggleRepost: toggleRepostAction,
    follow,
    remove,
    notifyError,
    dismissNotice: () => setNotice(null),
    retry: () => void load({ reset: true }),
  };
}

/**
 * Réinsère les publications retirées par une action optimiste, à leur place
 * d'origine, sans écraser ce qui a été chargé entre-temps.
 */
function restoreItems(items: FeedPost[], previous: FeedPost[]): FeedPost[] {
  const present = new Set(items.map((post) => post.id));
  const result = [...items];
  previous.forEach((post, index) => {
    if (!present.has(post.id)) {
      result.splice(Math.min(index, result.length), 0, post);
    }
  });
  return result;
}

/**
 * Rend l'état d'avant l'optimisme pour **une** publication.
 *
 * L'ancienne version restaurait le tableau entier capturé avant l'appel : une
 * page chargée entre-temps, ou une autre action réussie sur une autre
 * publication, disparaissait au passage.
 */
function restorePost(items: FeedPost[], previous: FeedPost): FeedPost[] {
  return items.map((post) => (post.id === previous.id ? previous : post));
}

/** Applique l'abonnement à toutes les publications du même auteur. */
function markFollowing(items: FeedPost[], authorId: string, value = true): FeedPost[] {
  return items.map((post) =>
    post.author.id === authorId
      ? { ...post, viewer: { ...post.viewer, followingAuthor: value } }
      : post,
  );
}
