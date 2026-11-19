import type { CommentPage, CommentReactionKind, PublicationComment } from '@/lib/types';

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
 * Les réponses sont regroupées par parent pour un affichage en fil
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
  // Les réponses d'un fil sont chronologiques (plus ancienne en haut), comme
  // la liste principale arrive triée par score, pas par date.
  for (const replies of repliesByParent.values()) {
    replies.sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
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

/**
 * Applique une réaction emoji de façon optimiste : retire l'ancienne réaction
 * du visiteur, ajuste les compteurs et pose la nouvelle. `kind: null` retire
 * simplement la réaction. Le serveur reste l'autorité : la réponse fait foi.
 */
export function applyCommentReaction(
  comment: PublicationComment,
  kind: CommentReactionKind | null,
): PublicationComment {
  const previous = comment.viewerReaction;
  if (previous === kind) {
    return comment;
  }
  const reactions = comment.reactions
    .map((reaction) => ({
      ...reaction,
      count: reaction.kind === previous ? reaction.count - 1 : reaction.count,
    }))
    .filter((reaction) => reaction.count > 0);
  if (kind !== null) {
    const existing = reactions.find((reaction) => reaction.kind === kind);
    if (existing) {
      reactions[reactions.indexOf(existing)] = { ...existing, count: existing.count + 1 };
    } else {
      reactions.push({ kind, count: 1 });
    }
  }
  return { ...comment, viewerReaction: kind, reactions };
}

/** Remplace un commentaire par identifiant dans une liste, ou l'ajoute. */
export function upsertComment(
  current: PublicationComment[],
  comment: PublicationComment,
): PublicationComment[] {
  const index = current.findIndex((item) => item.id === comment.id);
  if (index === -1) {
    return [...current, comment];
  }
  const next = [...current];
  next[index] = comment;
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
