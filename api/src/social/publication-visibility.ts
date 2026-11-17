import { inArray, isNull, sql } from 'drizzle-orm';

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
export function visiblePublicationConditions(viewerId: string) {
  const followsAuthor = sql`exists (
    select 1 from follows f
    where f.follower_id = ${viewerId}
      and f.following_id = ${publications.authorId}
      and f.status = 'accepted'
  )`;

  return [
    isNull(publications.deletedAt),
    sql`${users.deletedAt} is null`,
    inArray(publications.moderationStatus, ['pending', 'approved']),
    sql`(
      ${publications.visibility} = 'public'
      or (${publications.visibility} = 'followers' and ${followsAuthor})
      or ${publications.authorId} = ${viewerId}
    )`,
    // Compte privé : `public` ne suffit pas, il faut un abonnement accepté.
    sql`(
      ${users.privateAccount} = false
      or ${publications.authorId} = ${viewerId}
      or ${followsAuthor}
    )`,
    sql`not exists (
      select 1 from blocks b
      where (b.blocker_id = ${viewerId} and b.blocked_id = ${publications.authorId})
         or (b.blocker_id = ${publications.authorId} and b.blocked_id = ${viewerId})
    )`,
  ];
}
