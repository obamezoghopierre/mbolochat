import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/lib/api';
import type { FeedPost, SocialReaction } from '@/lib/types';
import {
  applyReaction as applyReactionToItems,
  mergeFeedPage,
  toggleRepost as toggleRepostInList,
  toggleSave as toggleSaveInList,
} from '../feed/feed-model';
import {
  hydrateDiscoverPost,
  type DiscoverPostHydration,
} from './discover-feed-model';
import {
  loadDiscoverSection,
  type DiscoverSectionPage,
} from './discover-api';

/** Vignettes par page ; l'API de section borne la limite à 50. */
export const DISCOVER_PAGE_SIZE = 30;

/**
 * État de la grille Découvrir : une seule liste de publications hydratées,
 * partagée entre la grille et le visionneuse plein écran.
 *
 * Une interaction lancée dans le visionneuse modifie la liste ici, donc la
 * vignette d'origine est à jour au retour — le même comportement que le fil.
 * Les mises à jour optimistes sont annulées si l'appel réseau échoue.
 */
export interface DiscoverFeedActions {
  /** J'aime / j'aime pas (double-tap ou bouton cœur). */
  toggleLike(post: FeedPost): void;
  /** Réaction explicite (feuille de réactions) ; `null` retire la réaction. */
  setReaction(post: FeedPost, kind: SocialReaction | null): void;
  /** Signet (enregistrement). */
  toggleSave(post: FeedPost): void;
  /** Republication. */
  toggleRepost(post: FeedPost): void;
  /** Abonnement à l'auteur de la publication. */
  follow(post: FeedPost): void;
  /** Désinscription ; `true` quand l'auteur a été retiré de la liste. */
  unfollow(post: FeedPost): Promise<boolean>;
  /** « Pas intéressé » : la publication quitte la grille. */
  dismiss(post: FeedPost): void;
  /** Masque les publications de l'auteur (reste dans la grille). */
  muteAuthor(post: FeedPost): void;
  /** Supprime la publication (publications propres uniquement). */
  remove(post: FeedPost): void;
  /** Publication remplacée par le serveur (édition, statistiques). */
  replacePost(post: FeedPost): void;
  /** Message d'erreur à afficher (le ton dépend de l'appelant). */
  notifyError(message: string): void;
}

export interface UseDiscoverFeedResult {
  items: FeedPost[];
  cursor: string | null;
  status: 'loading' | 'ready' | 'error';
  refreshing: boolean;
  loadingMore: boolean;
  moreError: boolean;
  /** Publications arrivées depuis le dernier rafraîchissement. */
  freshCount: number;
  actions: DiscoverFeedActions;
  /** Recharge la première page (défilement en haut de la grille). */
  refresh: () => void;
  /** Charge la page suivante (défilement vers le bas). */
  loadMore: () => void;
  /** Réessaiie après une erreur de première page. */
  retryFirst: () => void;
}

/** Repose la publication telle qu'elle était avant une action optimiste. */
function restorePost(items: FeedPost[], previous: FeedPost): FeedPost[] {
  return items.map((post) => (post.id === previous.id ? previous : post));
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
  // Nombre de publications nouvelles affichées après un rafraîchissement,
  // pour la pastille « nouvelles publications » de la grille.
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

  const notifyError = useCallback(
    (message: string) => {
      onError?.(message);
    },
    [onError],
  );

  const requestFirst = useCallback((): Promise<DiscoverSectionPage | null> => {
    const seq = ++requestSeq.current;
    return loadDiscoverSection(token, 'popular', undefined, DISCOVER_PAGE_SIZE)
      .then((page) => {
        if (seq !== requestSeq.current) {
          return null;
        }
        // Le serveur peut renvoyer une publication déjà affichée (elle est
        // remontée par une interaction récente) : on déduplique par id.
        setItems((current) =>
          mergeFeedPage(current, {
            items: page.items.map((item) => hydrateDiscoverPost(item, hydrate)),
            nextCursor: page.nextCursor,
          }).items,
        );
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
        // rafraîchissement : c'est ce qui alimente la pastille « nouvelles
        // publications », comme sur Instagram.
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

  const remove = useCallback(
    (post: FeedPost) => {
      const previous = post;
      const index = itemsRef.current.findIndex((entry) => entry.id === post.id);
      setItems((current) => current.filter((item) => item.id !== post.id));
      void api
        .deletePublication(token, post.id)
        .then(() => undefined)
        .catch(() => {
          setItems((current) => {
            // La publication reprend sa place d'origine, sauf si une
            // autre action l'a déjà remise (ou retirée) entre-temps.
            if (current.some((item) => item.id === post.id)) {
              return current;
            }
            const next = [...current];
            next.splice(Math.min(index, next.length), 0, previous);
            return next;
          });
          notifyError('Suppression impossible.');
        });
    },
    [token, notifyError],
  );

  const replacePost = useCallback((post: FeedPost) => {
    setItems((current) =>
      current.map((item) => (item.id === post.id ? post : item)),
    );
  }, []);

  const setReaction = useCallback(
    (post: FeedPost, kind: SocialReaction | null) => {
      const previous = post;
      setItems((current) => applyReactionToItems(current, post.id, kind));
      void (kind === null
        ? api.removeReaction(token, post.id)
        : api.reactToPublication(token, post.id, kind))
        .then(() => undefined)
        .catch(() => {
          setItems((current) => restorePost(current, previous));
          notifyError(
            kind === null
              ? 'Réaction retirée impossible. Vérifie ta connexion.'
              : 'Réaction non enregistrée. Vérifie ta connexion.',
          );
        });
    },
    [token, notifyError],
  );

  const toggleLike = useCallback(
    (post: FeedPost) => {
      setReaction(post, post.viewer.reaction === null ? 'like' : null);
    },
    [setReaction],
  );

  const toggleSave = useCallback(
    (post: FeedPost) => {
      const previous = post;
      const { items: next, saved } = toggleSaveInList(itemsRef.current, post.id);
      setItems(next);
      void (saved
        ? api.savePublication(token, post.id)
        : api.unsavePublication(token, post.id))
        .then(() => undefined)
        .catch(() => {
          setItems((current) => restorePost(current, previous));
          notifyError('Enregistrement impossible. Vérifie ta connexion.');
        });
    },
    [token, notifyError],
  );

  const toggleRepost = useCallback(
    (post: FeedPost) => {
      const previous = post;
      const { items: next, reposted } = toggleRepostInList(
        itemsRef.current,
        post.id,
      );
      setItems(next);
      void (reposted
        ? api.repostPublication(token, post.id)
        : api.unrepostPublication(token, post.id))
        .then(() => undefined)
        .catch(() => {
          setItems((current) => restorePost(current, previous));
          notifyError('Republication impossible. Vérifie ta connexion.');
        });
    },
    [token, notifyError],
  );

  /** Marque l'auteur comme suivi (ou en attente pour un compte privé). */
  const markFollow = useCallback((post: FeedPost, following: boolean, pending: boolean) => {
    setItems((current) =>
      current.map((item) =>
        item.author.id === post.author.id
          ? {
              ...item,
              viewer: {
                ...item.viewer,
                followingAuthor: following,
                followRequestPending: pending ? true : undefined,
              },
            }
          : item,
      ),
    );
  }, []);

  const follow = useCallback(
    (post: FeedPost) => {
      const previous = post;
      markFollow(post, true, false);
      void api
        .followUser(token, post.author.id)
        .then((result) => {
          // Compte privé : le serveur attend l'accord de l'auteur.
          markFollow(post, false, result.status === 'pending');
        })
        .catch(() => {
          setItems((current) => restorePost(current, previous));
          notifyError('Abonnement impossible. Vérifie ta connexion.');
        });
    },
    [token, markFollow, notifyError],
  );

  const unfollow = useCallback(
    async (post: FeedPost) => {
      const previous = post;
      markFollow(post, false, false);
      try {
        await api.unfollowUser(token, post.author.id);
        return true;
      } catch {
        setItems((current) => restorePost(current, previous));
        notifyError('Abonnement impossible. Réessaie.');
        return false;
      }
    },
    [token, markFollow, notifyError],
  );

  const dismiss = useCallback(
    (post: FeedPost) => {
      const previous = post;
      setItems((current) => current.filter((item) => item.id !== post.id));
      void api
        .notInterested(token, post.id)
        .then(() => undefined)
        .catch(() => {
          setItems((current) => restorePost(current, previous));
          notifyError('Impossible de masquer cette publication.');
        });
    },
    [token, notifyError],
  );

  const muteAuthor = useCallback(
    (post: FeedPost) => {
      const previous = post;
      markFollow(post, false, false);
      void api
        .muteAuthor(token, post.author.id)
        .then(() => undefined)
        .catch(() => {
          setItems((current) => restorePost(current, previous));
          notifyError('Impossible de masquer cet auteur.');
        });
    },
    [token, markFollow, notifyError],
  );

  // Objet stable : les fenêtres qui le reçoivent (pager, visionneuse) le
  // mettent en dépendance sans relancer leurs effets à chaque rendu.
  const actions = useMemo<DiscoverFeedActions>(
    () => ({
      toggleLike,
      setReaction,
      toggleSave,
      toggleRepost,
      follow,
      unfollow,
      dismiss,
      muteAuthor,
      remove,
      replacePost,
      notifyError,
    }),
    [
      toggleLike,
      setReaction,
      toggleSave,
      toggleRepost,
      follow,
      unfollow,
      dismiss,
      muteAuthor,
      remove,
      replacePost,
      notifyError,
    ],
  );

  return {
    items,
    cursor,
    status,
    refreshing,
    loadingMore,
    moreError,
    freshCount,
    actions,
    refresh,
    loadMore,
    retryFirst,
  };
}
