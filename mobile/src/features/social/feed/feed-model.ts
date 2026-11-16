import type { FeedPage, FeedPost, SocialReaction } from '@/lib/types';

/**
 * Fusionne une page de fil avec ce qui est déjà affiché.
 *
 * L'API pagine par `(hot_score, id)` ; le curseur ne doit jamais produire de
 * doublon si une publication remonte entre deux chargements (interaction
 * récente). On déduplique par id en gardant l'élément le plus frais.
 */
export function mergeFeedPage(
  current: FeedPost[],
  page: FeedPage,
): { items: FeedPost[]; nextCursor: string | null } {
  const byId = new Map<string, FeedPost>();
  for (const post of current) {
    byId.set(post.id, post);
  }
  for (const post of page.items) {
    byId.set(post.id, post);
  }
  return { items: [...byId.values()], nextCursor: page.nextCursor };
}

/**
 * Applique une réaction optimiste sans attendre le serveur.
 *
 * Même règle que l'API : la première réaction incrémente, un changement de type
 * ne change pas le total, un retrait décrémente sans passer sous zéro.
 */
export function applyReaction(
  items: FeedPost[],
  publicationId: string,
  reaction: SocialReaction | null,
): FeedPost[] {
  return items.map((post) => {
    if (post.id !== publicationId) {
      return post;
    }
    const previous = post.viewer.reaction;
    let likes = post.counters.likes;
    if (previous === null && reaction !== null) {
      likes += 1;
    } else if (previous !== null && reaction === null) {
      likes = Math.max(0, likes - 1);
    }
    return {
      ...post,
      counters: { ...post.counters, likes },
      viewer: { ...post.viewer, reaction },
    };
  });
}
