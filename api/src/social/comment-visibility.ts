import { and, inArray, isNull, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { comments, users } from '../db/schema.js';

/**
 * Visibilité d'un commentaire pour tous les lecteurs, y compris son auteur.
 * `pending` reste visible pendant le contrôle automatique ; `flagged` et
 * `removed` sont exclus jusqu'à une éventuelle remise en revue.
 */
export function visibleCommentCondition() {
  return and(
    isNull(comments.deletedAt),
    inArray(comments.moderationStatus, ['pending', 'approved']),
  )!;
}

/** L'auteur doit exister et ne pas être bloqué dans l'un ou l'autre sens. */
export function visibleCommentAuthorCondition(
  viewerId: string | AnyPgColumn,
  author: { id: AnyPgColumn; deletedAt: AnyPgColumn } = users,
) {
  return and(
    isNull(author.deletedAt),
    sql`not exists (
      select 1 from blocks b
      where (b.blocker_id = ${viewerId} and b.blocked_id = ${author.id})
         or (b.blocker_id = ${author.id} and b.blocked_id = ${viewerId})
    )`,
  )!;
}
