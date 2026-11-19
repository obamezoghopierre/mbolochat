import type { CommentReactionKind } from '@/lib/types';

/** Kinds de réaction emoji sur un commentaire, dans l'ordre d'affichage. */
export const COMMENT_REACTION_KINDS: CommentReactionKind[] = [
  'heart',
  'laugh',
  'wow',
  'fire',
  'clap',
];

/** Emoji affiché pour chaque kind. */
export const COMMENT_REACTION_EMOJI: Record<CommentReactionKind, string> = {
  heart: '❤️',
  laugh: '😂',
  wow: '😮',
  fire: '🔥',
  clap: '👏',
};
