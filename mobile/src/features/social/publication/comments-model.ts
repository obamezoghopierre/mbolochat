import type { CommentPage, PublicationComment } from '@/lib/types';

/**
 * Ajoute un commentaire envoyé à la liste affichée.
 *
 * Rejouer l'envoi (même `clientId`) rend le commentaire déjà créé : on remplace
 * par identifiant au lieu d'ajouter une seconde bulle.
 */
export function appendComment(
  current: PublicationComment[],
  comment: PublicationComment,
): PublicationComment[] {
  const existing = current.findIndex((item) => item.id === comment.id);
  if (existing === -1) {
    return [...current, comment];
  }
  const next = [...current];
  next[existing] = comment;
  return next;
}

/**
 * Sépare les commentaires racines des réponses, en conservant l'ordre reçu.
 * Les réponses sont regroupées par parent pour un affichage façon Instagram
 * (une ligne par fil, réponses repliables en dessous).
 */
export function groupComments(comments: PublicationComment[]): {
  roots: PublicationComment[];
  repliesByParent: Map<string, PublicationComment[]>;
} {
  const roots: PublicationComment[] = [];
  const repliesByParent = new Map<string, PublicationComment[]>();
  for (const item of comments) {
    if (!item.parentId) {
      roots.push(item);
      continue;
    }
    const replies = repliesByParent.get(item.parentId) ?? [];
    replies.push(item);
    repliesByParent.set(item.parentId, replies);
  }
  return { roots, repliesByParent };
}

/** Ajoute une réponse au fil et met à jour le compteur du commentaire parent. */
export function appendReply(
  current: PublicationComment[],
  reply: PublicationComment,
): PublicationComment[] {
  const replay = current.some((item) => item.id === reply.id);
  const next = appendComment(current, reply);
  if (!reply.parentId || replay) {
    return next;
  }
  return next.map((item) =>
    item.id === reply.parentId ? { ...item, replyCount: item.replyCount + 1 } : item,
  );
}

/** Fusionne une page de commentaires sans doublon, en gardant l'ordre reçu. */
export function mergeCommentPage(
  current: PublicationComment[],
  page: CommentPage,
): { items: PublicationComment[]; nextCursor: string | null } {
  const byId = new Map<string, PublicationComment>();
  for (const comment of current) {
    byId.set(comment.id, comment);
  }
  for (const comment of page.items) {
    byId.set(comment.id, comment);
  }
  return { items: [...byId.values()], nextCursor: page.nextCursor };
}
