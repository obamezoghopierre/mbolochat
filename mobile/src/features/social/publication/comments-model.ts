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
