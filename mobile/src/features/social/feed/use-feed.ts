import { useCallback, useEffect, useRef, useState } from 'react';

import { applyReaction, mergeFeedPage, toggleRepost, toggleSave } from './feed-model';
import { ApiError, api } from '@/lib/api';
import { connectSocket } from '@/lib/socket';
import { fr } from '@/i18n/fr';
import type { FeedPost, FeedTab, SocialReaction } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import { readFeedSnapshot, saveFeedSnapshot } from './feed-snapshot';

export type FeedStatus = 'loading' | 'ready' | 'error';

/** Message court affiché en haut du fil (erreur d'action, retour de geste). */
export interface FeedNotice {
  message: string;
  tone: 'error' | 'info';
}

/**
 * Mémoire des fils chargés, clé par (session, onglet).
 *
 * Le feed ne recharge pas un onglet déjà visité : il garde sa liste et son
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
type FeedChange = (items: FeedPost[]) => FeedPost[];
const feedChangeListeners = new Set<(token: string, change: FeedChange) => void>();
const feedInvalidationListeners = new Set<(token: string) => void>();
const feedOperationVersions = new Map<string, number>();
const feedRooms = new Map<
  string,
  { socket: ReturnType<typeof connectSocket>; subscribers: number }
>();

function retainFeedRoom(token: string, publicationId: string): () => void {
  const key = `${token}:${publicationId}`;
  const existing = feedRooms.get(key);
  if (existing) {
    existing.subscribers += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      existing.subscribers -= 1;
      if (existing.subscribers === 0) {
        feedRooms.delete(key);
      }
    };
  }

  const socket = connectSocket(token);
  const join = () => {
    if (socket.connected) {
      socket.emit('feed:join', { publicationId });
    }
  };
  feedRooms.set(key, { socket, subscribers: 1 });
  socket.on('connect', join);
  join();

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    feedRooms.delete(key);
    socket.off('connect', join);
    if (socket.connected) {
      socket.emit('feed:leave', { publicationId });
    }
  };
}

function emitFeedChange(token: string, change: FeedChange): void {
  for (const [key, entry] of feedCache) {
    if (key.startsWith(`${token}:`)) {
      feedCache.set(key, { ...entry, items: change(entry.items) });
    }
  }
  for (const listener of feedChangeListeners) {
    listener(token, change);
  }
}

function beginFeedOperation(key: string): number {
  const version = (feedOperationVersions.get(key) ?? 0) + 1;
  feedOperationVersions.set(key, version);
  return version;
}

function isCurrentFeedOperation(key: string, version: number): boolean {
  return feedOperationVersions.get(key) === version;
}

function finishFeedOperation(key: string, version: number): void {
  if (isCurrentFeedOperation(key, version)) {
    feedOperationVersions.delete(key);
  }
}

/**
 * Oublie les fils mis en cache d'une session et demande leur rechargement aux
 * onglets encore montés (création, édition ou citation).
 */
export function invalidateFeedCache(token: string): void {
  for (const key of [...feedCache.keys()]) {
    if (key.startsWith(`${token}:`)) {
      feedCache.delete(key);
    }
  }
  for (const listener of feedInvalidationListeners) {
    listener(token);
  }
}

/** Au-delà, le fil est requêté à nouveau (le classement a pu bouger). */
const FEED_CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(token: string, tab: FeedTab, format?: 'video'): string {
  return format ? `${token}:${tab}:${format}` : `${token}:${tab}`;
}

/**
 * État du fil : chargement initial, pagination par curseur, rafraîchissement et
 * actions optimistes avec retour arrière en cas d'échec réseau.
 *
 * Chaque action renvoie l'état attendu pour que l'écran puisse afficher un
 * retour immédiat (toast, pastille) sans relire la liste.
 */
export function useFeed(
  tab: FeedTab,
  options: {
    deferNetwork?: boolean;
    /** `video` : fil dédié des Reels (vidéos seules), sans copie sur l'appareil. */
    format?: 'video';
  } = {},
) {
  const { token, user } = useAuth();
  const userId = user?.id ?? null;
  const format = options.format;
  const key = token ? cacheKey(token, tab, format) : '';
  const cached = key ? feedCache.get(key) : undefined;
  // Démarrage à froid : sans fil en mémoire, on montre celui de la dernière
  // visite (gardé sur l'appareil) le temps que le réseau réponde.
  const snapshot = cached || format ? null : readFeedSnapshot(userId, tab);

  const [items, setItems] = useState<FeedPost[]>(cached?.items ?? snapshot?.items ?? []);
  const [cursor, setCursor] = useState<string | null>(cached?.cursor ?? snapshot?.cursor ?? null);
  const [status, setStatus] = useState<FeedStatus>(cached || snapshot ? 'ready' : 'loading');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<FeedNotice | null>(null);
  const [cacheVersion, setCacheVersion] = useState(0);
  // `createdAt` (horloge serveur) de la plus récente publication chargée au
  // dernier rechargement : la pastille « nouvelles publications » ne compte
  // que ce qui la dépasse. Sans cette base, un ancien post qui remonte dans
  // le classement serait pris pour une nouveauté.
  const [freshBaseline, setFreshBaseline] = useState<string | null>(null);
  const [freshPosts, setFreshPosts] = useState<FeedPost[]>([]);
  const inFlight = useRef(false);
  const reloadRequested = useRef(false);
  const loadRef = useRef<((options: { reset: boolean }) => Promise<void>) | null>(null);
  const itemsRef = useRef(items);
  const roomReleases = useRef(new Map<string, () => void>());
  const loadedAtRef = useRef(cached?.loadedAt ?? snapshot?.savedAt ?? 0);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    const handleInvalidation = (invalidatedToken: string) => {
      if (invalidatedToken === token) {
        setCacheVersion((version) => version + 1);
      }
    };
    const handleChange = (changedToken: string, change: FeedChange) => {
      if (changedToken === token) {
        setItems((current) => change(current));
      }
    };
    feedInvalidationListeners.add(handleInvalidation);
    feedChangeListeners.add(handleChange);
    return () => {
      feedInvalidationListeners.delete(handleInvalidation);
      feedChangeListeners.delete(handleChange);
    };
  }, [token]);

  useEffect(() => {
    const releases = roomReleases.current;
    return () => {
      for (const release of releases.values()) {
        release();
      }
      releases.clear();
    };
  }, []);

  useEffect(() => {
    if (!token) {
      for (const release of roomReleases.current.values()) {
        release();
      }
      roomReleases.current.clear();
      return;
    }
    const wanted = new Set(items.map((post) => `${token}:${post.id}`));
    for (const [key, release] of roomReleases.current) {
      if (!wanted.has(key)) {
        release();
        roomReleases.current.delete(key);
      }
    }
    for (const post of items) {
      const key = `${token}:${post.id}`;
      if (!roomReleases.current.has(key)) {
        roomReleases.current.set(key, retainFeedRoom(token, post.id));
      }
    }
  }, [items, token]);

  // Toute mutation (chargement, pagination, action optimiste) est conservée
  // pour que le retour sur l'onglet soit immédiat, sans requête réseau.
  useEffect(() => {
    if (key && status === 'ready') {
      feedCache.set(key, { items, cursor, status, loadedAt: loadedAtRef.current });
    }
  }, [cursor, items, key, status]);

  const notifyError = useCallback((message: string) => {
    setNotice({ message, tone: 'error' });
  }, []);

  const load = useCallback(
    async (options: { reset: boolean }) => {
      if (!token) {
        return;
      }
      if (inFlight.current) {
        if (options.reset) {
          reloadRequested.current = true;
        }
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
          format,
        );
        loadedAtRef.current = Date.now();
        setItems((current) => {
          if (!options.reset) {
            return mergeFeedPage(current, page).items;
          }
          // Remplacement d'un fil affiché depuis l'appareil : le post à
          // l'écran (le premier) reste en tête s'il est toujours dans la
          // nouvelle page, pour ne jamais sauter sous les yeux de la personne.
          const head = current[0];
          if (head && page.items.some((post) => post.id === head.id)) {
            const fresh = page.items.find((post) => post.id === head.id)!;
            return [fresh, ...page.items.filter((post) => post.id !== head.id)];
          }
          return page.items;
        });
        if (options.reset && !format) {
          saveFeedSnapshot(userId, tab, page.items, page.nextCursor);
        }
        setCursor(page.nextCursor);
        setNotice(null);
        setStatus('ready');
        if (options.reset) {
          const newest = newestPostDate(page.items);
          if (newest) {
            setFreshBaseline(newest);
          }
        }
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
        if (reloadRequested.current) {
          reloadRequested.current = false;
          queueMicrotask(() => void loadRef.current?.({ reset: true }));
        }
      }
    },
    [cursor, format, tab, token, userId],
  );

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  // Un onglet déjà visité garde sa liste : on ne requête que s'il n'y a rien
  // en cache, ou si le cache a périmé. Le pull-to-refresh force le rechargement.
  // `deferNetwork` : les onglets voisins attendent que l'accueil soit affiché,
  // pour que la première requête du démarrage soit celle de « Pour toi ».
  const deferNetwork = options.deferNetwork === true;
  useEffect(() => {
    if (!token || deferNetwork) {
      return;
    }
    const entry = feedCache.get(cacheKey(token, tab, format));
    if (!entry || Date.now() - entry.loadedAt >= FEED_CACHE_TTL_MS) {
      // Les états sont posés après l'appel réseau, pas pendant le montage.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load({ reset: true });
    }
    // `load` change avec le curseur : la relancer à chaque page bouclerait.
  }, [tab, token, deferNetwork, format, cacheVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compteurs temps réel des publications rejointes après contrôle de
  // visibilité. L'auteur reçoit les valeurs brutes, les autres zéro si le
  // nombre de J'aime est masqué ; la réponse serveur remplace l'estimation.
  useEffect(() => {
    if (!token) {
      return;
    }
    const socket = connectSocket(token);
    const handleStats = (payload: {
      publicationId?: string;
      counters?: FeedPost['counters'];
    }) => {
      if (!payload?.publicationId || !payload.counters) {
        return;
      }
      emitFeedChange(token, (current) =>
        current.map((post) =>
          post.id === payload.publicationId
            ? { ...post, counters: { ...post.counters, ...payload.counters } }
            : post,
        ),
      );
    };
    socket.on('publication:stats', handleStats);
    return () => {
      socket.off('publication:stats', handleStats);
    };
  }, [token]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setFreshPosts([]);
    void load({ reset: true });
  }, [load]);

  /**
   * « Nouvelles publications », comme Instagram : relit discrètement la
   * première page et retient ce qui n'est pas encore affiché **et** postérieur
   * à la base du dernier chargement — les posts frais servent à la pastille
   * d'avatars. Un ancien post reclassé dans le top n'y figure pas : il n'est
   * pas nouveau, il était déjà vu ou éligible au fil. Rien n'est inséré sous
   * les yeux de la personne ; le bouton invite à remonter.
   */
  const checkFresh = useCallback(async () => {
    if (!token || format || status !== 'ready' || inFlight.current) {
      return;
    }
    try {
      const page = await api.feed(token, tab, undefined);
      const known = new Set(itemsRef.current.map((post) => post.id));
      // Fil restauré sans rechargement : la base est la plus récente
      // publication déjà chargée, même règle que après un refresh.
      const baseline = freshBaseline ?? newestPostDate(itemsRef.current);
      const fresh = baseline
        ? page.items.filter(
            (post) => !known.has(post.id) && post.createdAt > baseline,
          )
        : [];
      setFreshPosts(fresh);
    } catch {
      // Silencieux : ce n'est qu'une invitation.
    }
  }, [freshBaseline, format, status, tab, token]);

  const loadMore = useCallback(() => {
    if (cursor && status === 'ready' && !loadingMore) {
      void load({ reset: false });
    }
  }, [cursor, load, loadingMore, status]);

  const replacePost = useCallback(
    (post: FeedPost) => {
      if (!token) {
        return;
      }
      emitFeedChange(token, (current) =>
        current.map((entry) => (entry.id === post.id ? post : entry)),
      );
    },
    [token],
  );

  const toggleLike = useCallback(
    async (post: FeedPost) => {
      if (!token) {
        return;
      }
      const previousReaction = post.viewer.reaction;
      const nextReaction = previousReaction === null ? 'like' : null;
      const operationKey = `${token}:${post.id}:reaction`;
      const version = beginFeedOperation(operationKey);
      emitFeedChange(token, (current) => applyReaction(current, post.id, nextReaction));
      try {
        if (nextReaction === null) {
          await api.removeReaction(token, post.id);
        } else {
          await api.reactToPublication(token, post.id, nextReaction);
        }
      } catch {
        if (isCurrentFeedOperation(operationKey, version)) {
          emitFeedChange(token, (current) =>
            restoreReaction(current, post.id, previousReaction),
          );
        }
        notifyError('Réaction non enregistrée. Vérifie ta connexion.');
      } finally {
        finishFeedOperation(operationKey, version);
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
      const previousReaction = post.viewer.reaction;
      const operationKey = `${token}:${post.id}:reaction`;
      const version = beginFeedOperation(operationKey);
      emitFeedChange(token, (current) => applyReaction(current, post.id, kind));
      try {
        if (kind === null) {
          await api.removeReaction(token, post.id);
        } else {
          await api.reactToPublication(token, post.id, kind);
        }
      } catch {
        if (isCurrentFeedOperation(operationKey, version)) {
          emitFeedChange(token, (current) =>
            restoreReaction(current, post.id, previousReaction),
          );
        }
        notifyError('Réaction non enregistrée. Vérifie ta connexion.');
      } finally {
        finishFeedOperation(operationKey, version);
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
      const index = itemsRef.current.findIndex((entry) => entry.id === post.id);
      emitFeedChange(token, (current) => current.filter((entry) => entry.id !== post.id));
      try {
        await api.notInterested(token, post.id);
        setNotice({ message: fr.social.notInterestedDone, tone: 'info' });
      } catch {
        emitFeedChange(token, (current) => restorePublication(current, post, index));
        notifyError('Action impossible. Réessaie.');
      }
    },
    [notifyError, token],
  );

  /** Masque toutes les publications d'un auteur, avec retour arrière. */
  const muteAuthorAction = useCallback(
    async (post: FeedPost) => {
      if (!token) {
        return;
      }
      const removed = itemsRef.current
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.author.id === post.author.id);
      emitFeedChange(token, (current) =>
        current.filter((entry) => entry.author.id !== post.author.id),
      );
      try {
        await api.muteAuthor(token, post.author.id);
        setNotice({ message: fr.social.muteAuthorDone, tone: 'info' });
      } catch {
        emitFeedChange(token, (current) =>
          removed.reduce(
            (result, { entry, index }) => restorePublication(result, entry, index),
            current,
          ),
        );
        notifyError('Action impossible. Réessaie.');
      }
    },
    [notifyError, token],
  );

  const toggleSaveAction = useCallback(
    async (post: FeedPost) => {
      if (!token) {
        return;
      }
      const previousSaved = post.viewer.saved === true;
      const saved = !previousSaved;
      const operationKey = `${token}:${post.id}:save`;
      const version = beginFeedOperation(operationKey);
      emitFeedChange(token, (current) => toggleSave(current, post.id).items);
      try {
        if (saved) {
          await api.savePublication(token, post.id);
        } else {
          await api.unsavePublication(token, post.id);
        }
        if (!saved) {
          setNotice({ message: 'Enregistrement retiré', tone: 'info' });
        }
      } catch {
        if (isCurrentFeedOperation(operationKey, version)) {
          emitFeedChange(token, (current) =>
            restoreViewerFlag(current, post.id, 'saved', previousSaved, 'saves'),
          );
        }
        notifyError('Enregistrement impossible. Vérifie ta connexion.');
      } finally {
        finishFeedOperation(operationKey, version);
      }
    },
    [notifyError, token],
  );

  const toggleRepostAction = useCallback(
    async (post: FeedPost) => {
      if (!token) {
        return;
      }
      const previousReposted = post.viewer.reposted === true;
      const reposted = !previousReposted;
      const operationKey = `${token}:${post.id}:repost`;
      const version = beginFeedOperation(operationKey);
      emitFeedChange(token, (current) => toggleRepost(current, post.id).items);
      try {
        if (reposted) {
          await api.repostPublication(token, post.id);
        } else {
          await api.unrepostPublication(token, post.id);
        }
        setNotice({
          message: reposted ? fr.social.repostDone : fr.social.unrepostDone,
          tone: 'info',
        });
      } catch {
        if (isCurrentFeedOperation(operationKey, version)) {
          emitFeedChange(token, (current) =>
            restoreViewerFlag(current, post.id, 'reposted', previousReposted, 'reposts'),
          );
        }
        notifyError('Republication impossible. Vérifie ta connexion.');
      } finally {
        finishFeedOperation(operationKey, version);
      }
    },
    [notifyError, token],
  );

  const follow = useCallback(
    async (post: FeedPost) => {
      if (!token) {
        return;
      }
      const previous = {
        following: post.viewer.followingAuthor,
        pending: post.viewer.followRequestPending === true,
      };
      const operationKey = `${token}:${post.author.id}:follow`;
      const version = beginFeedOperation(operationKey);
      emitFeedChange(token, (current) => markFollowState(current, post.author.id, true, false));
      try {
        const result = await api.followUser(token, post.author.id);
        const accepted = result.status === 'accepted';
        const pending = result.status === 'pending';
        emitFeedChange(token, (current) =>
          markFollowState(current, post.author.id, accepted, pending),
        );
        if (pending) {
          setNotice({ message: 'Demande d’abonnement envoyée', tone: 'info' });
        }
      } catch {
        if (isCurrentFeedOperation(operationKey, version)) {
          emitFeedChange(token, (current) =>
            markFollowState(current, post.author.id, previous.following, previous.pending),
          );
        }
        notifyError('Abonnement impossible. Réessaie.');
      } finally {
        finishFeedOperation(operationKey, version);
      }
    },
    [notifyError, token],
  );

  const unfollow = useCallback(
    async (post: FeedPost): Promise<boolean> => {
      if (!token) {
        return false;
      }
      const previous = {
        following: post.viewer.followingAuthor,
        pending: post.viewer.followRequestPending === true,
      };
      const operationKey = `${token}:${post.author.id}:follow`;
      const version = beginFeedOperation(operationKey);
      emitFeedChange(token, (current) => markFollowState(current, post.author.id, false, false));
      try {
        await api.unfollowUser(token, post.author.id);
        return true;
      } catch {
        if (isCurrentFeedOperation(operationKey, version)) {
          emitFeedChange(token, (current) =>
            markFollowState(current, post.author.id, previous.following, previous.pending),
          );
        }
        notifyError('Abonnement impossible. Réessaie.');
        return false;
      } finally {
        finishFeedOperation(operationKey, version);
      }
    },
    [notifyError, token],
  );

  const remove = useCallback(
    async (post: FeedPost) => {
      if (!token) {
        return;
      }
      const index = itemsRef.current.findIndex((entry) => entry.id === post.id);
      emitFeedChange(token, (current) => current.filter((entry) => entry.id !== post.id));
      try {
        await api.deletePublication(token, post.id);
        setNotice({ message: 'Publication supprimée', tone: 'info' });
      } catch {
        emitFeedChange(token, (current) => restorePublication(current, post, index));
        notifyError('Suppression impossible.');
      }
    },
    [notifyError, token],
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
    freshPosts,
    checkFresh,
    toggleLike,
    setReaction,
    dismiss,
    muteAuthor: muteAuthorAction,
    toggleSave: toggleSaveAction,
    toggleRepost: toggleRepostAction,
    follow,
    unfollow,
    remove,
    replacePost,
    notifyError,
    dismissNotice: () => setNotice(null),
    retry: () => void load({ reset: true }),
  };
}

/** `createdAt` le plus récent d'une liste, au format ISO comparables. */
function newestPostDate(posts: FeedPost[]): string | null {
  let newest: string | null = null;
  for (const post of posts) {
    if (!newest || post.createdAt > newest) {
      newest = post.createdAt;
    }
  }
  return newest;
}

function restorePublication(items: FeedPost[], post: FeedPost, index: number): FeedPost[] {
  if (items.some((entry) => entry.id === post.id)) {
    return items;
  }
  const result = [...items];
  result.splice(Math.max(0, Math.min(index, result.length)), 0, post);
  return result;
}

function restoreReaction(
  items: FeedPost[],
  publicationId: string,
  previousReaction: SocialReaction | null,
): FeedPost[] {
  return items.map((post) => {
    if (post.id !== publicationId) {
      return post;
    }
    const currentReaction = post.viewer.reaction;
    let likes = post.counters.likes;
    if (currentReaction === null && previousReaction !== null) {
      likes += 1;
    } else if (currentReaction !== null && previousReaction === null) {
      likes = Math.max(0, likes - 1);
    }
    return {
      ...post,
      counters: { ...post.counters, likes },
      viewer: { ...post.viewer, reaction: previousReaction },
    };
  });
}

function restoreViewerFlag(
  items: FeedPost[],
  publicationId: string,
  field: 'saved' | 'reposted',
  previousValue: boolean,
  counter: 'saves' | 'reposts',
): FeedPost[] {
  return items.map((post) => {
    if (post.id !== publicationId) {
      return post;
    }
    const currentValue = post.viewer[field] === true;
    let count = post.counters[counter];
    if (!currentValue && previousValue) {
      count += 1;
    } else if (currentValue && !previousValue) {
      count = Math.max(0, count - 1);
    }
    return {
      ...post,
      counters: { ...post.counters, [counter]: count },
      viewer: { ...post.viewer, [field]: previousValue },
    };
  });
}

/** Applique l'abonnement à toutes les publications du même auteur. */
function markFollowState(
  items: FeedPost[],
  authorId: string,
  following: boolean,
  pending: boolean,
): FeedPost[] {
  return items.map((post) =>
    post.author.id === authorId
      ? {
          ...post,
          viewer: {
            ...post.viewer,
            followingAuthor: following,
            followRequestPending: pending,
          },
        }
      : post,
  );
}
