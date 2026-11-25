import { inArray, isNull, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { publications, users } from '../db/schema.js';

/**
 * Conditions d'autorisation d'une liste de publications, partagées par le feed
 * et la recherche. Elles sont appliquées **en SQL** : visibilité, abonnement
 * accepté, blocages dans les deux sens, modération et suppression logique.
 *
 * Une publication `pending` reste visible (contrôle automatique en cours) ;
 * `flagged` et `removed` sont exclus des listes publiques.
 *
 * Deux règles portent sur l'**auteur** et supposent donc que l'appelant joint
 * `users` sur l'auteur (`innerJoin(users, eq(users.id, publications.authorId))`) :
 * - un compte privé ne diffuse rien hors de ses abonnés acceptés, y compris ses
 *   publications marquées `public` (`canViewProfile` l'exige, le SQL doit le
 *   traduire, sinon le profil est fermé mais le contenu fuit par le feed) ;
 * - un compte en cours de suppression (`users.deleted_at`) n'apparaît plus.
 */
export function visiblePublicationConditions(
  viewerId: string | AnyPgColumn,
  publication: {
    authorId: AnyPgColumn;
    deletedAt: AnyPgColumn;
    moderationStatus: AnyPgColumn;
    visibility: AnyPgColumn;
  } = publications,
  author: { deletedAt: AnyPgColumn; privateAccount: AnyPgColumn } = users,
) {
  const followsAuthor = sql`exists (
    select 1 from follows f
    where f.follower_id = ${viewerId}
      and f.following_id = ${publication.authorId}
      and f.status = 'accepted'
  )`;

  return [
    isNull(publication.deletedAt),
    sql`${author.deletedAt} is null`,
    inArray(publication.moderationStatus, ['pending', 'approved']),
    sql`(
      ${publication.visibility} = 'public'
      or (${publication.visibility} = 'followers' and ${followsAuthor})
      or ${publication.authorId} = ${viewerId}
    )`,
    // Compte privé : `public` ne suffit pas, il faut un abonnement accepté.
    sql`(
      ${author.privateAccount} = false
      or ${publication.authorId} = ${viewerId}
      or ${followsAuthor}
    )`,
    sql`not exists (
      select 1 from blocks b
      where (b.blocker_id = ${viewerId} and b.blocked_id = ${publication.authorId})
         or (b.blocker_id = ${publication.authorId} and b.blocked_id = ${viewerId})
    )`,
  ];
}
