import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';

import { discoverFr } from '@/i18n/discover-fr';
import { api } from '@/lib/api';
import type { FeedPost, SocialReaction } from '@/lib/types';
import {
  applyReaction as applyReactionToItems,
  toggleRepost as toggleRepostInList,
  toggleSave as toggleSaveInList,
} from '../feed/feed-model';

/**
 * Actions d'une liste de publications de Découvrir (grille ou résultats de
 * recherche) : la grille, la recherche et la visionneuse plein écran les
 * partagent, donc une interaction prise dans la visionneuse met à jour la
 * liste d'où elle vient — et la vignette au retour.
 *
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
  /** « Pas intéressé » : la publication quitte la liste. */
  dismiss(post: FeedPost): void;
  /** Masque les publications de l'auteur (reste dans la liste). */
  muteAuthor(post: FeedPost): void;
  /** Supprime la publication (publications propres uniquement). */
  remove(post: FeedPost): void;
  /** Publication remplacée par le serveur (édition, statistiques). */
  replacePost(post: FeedPost): void;
  /** Message d'erreur à afficher (le ton dépend de l'appelant). */
  notifyError(message: string): void;
}

/** Repose la publication telle qu'elle était avant une action optimiste. */
function restorePost(items: FeedPost[], previous: FeedPost): FeedPost[] {
  return items.map((post) => (post.id === previous.id ? previous : post));
}

export function usePostListActions({
  token,
  itemsRef,
  setItems,
  onError,
}: {
  token: string;
  /** Copie de la liste lue par les actions optimistes, hors rendu React. */
  itemsRef: { readonly current: FeedPost[] };
  setItems: Dispatch<SetStateAction<FeedPost[]>>;
  onError?: (message: string) => void;
}): DiscoverFeedActions {
  const notifyError = useCallback(
    (message: string) => {
      onError?.(message);
    },
    [onError],
  );

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
          notifyError(discoverFr.deleteFailed);
        });
    },
    [token, itemsRef, setItems, notifyError],
  );

  const replacePost = useCallback(
    (post: FeedPost) => {
      setItems((current) =>
        current.map((item) => (item.id === post.id ? post : item)),
      );
    },
    [setItems],
  );

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
              ? discoverFr.reactRemoveFailed
              : discoverFr.reactFailed,
          );
        });
    },
    [token, setItems, notifyError],
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
          notifyError(discoverFr.saveFailed);
        });
    },
    [token, itemsRef, setItems, notifyError],
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
          notifyError(discoverFr.repostFailed);
        });
    },
    [token, itemsRef, setItems, notifyError],
  );

  /** Marque l'auteur comme suivi (ou en attente pour un compte privé). */
  const markFollow = useCallback(
    (post: FeedPost, following: boolean, pending: boolean) => {
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
    },
    [setItems],
  );

  const follow = useCallback(
    (post: FeedPost) => {
      const previous = post;
      markFollow(post, true, false);
      void api
        .followUser(token, post.author.id)
        .then((result) => {
          // Compte privé : le serveur attend l'accord de l'auteur, donc
          // l'abonnement n'est acquis que sur `accepted`.
          markFollow(
            post,
            result.status === 'accepted',
            result.status === 'pending',
          );
        })
        .catch(() => {
          setItems((current) => restorePost(current, previous));
          notifyError(discoverFr.followFailed);
        });
    },
    [token, markFollow, setItems, notifyError],
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
        notifyError(discoverFr.unfollowFailed);
        return false;
      }
    },
    [token, markFollow, setItems, notifyError],
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
          notifyError(discoverFr.dismissFailed);
        });
    },
    [token, setItems, notifyError],
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
          notifyError(discoverFr.muteAuthorFailed);
        });
    },
    [token, markFollow, setItems, notifyError],
  );

  // Objet stable : les fenêtres qui le reçoivent (pager, visionneuse) le
  // mettent en dépendance sans relancer leurs effets à chaque rendu.
  return useMemo<DiscoverFeedActions>(
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
}
