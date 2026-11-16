import { inArray, isNull, sql } from 'drizzle-orm';

import { publications } from '../db/schema.js';

/**
 * Conditions d'autorisation d'une liste de publications, partagées par le feed
 * et la recherche. Elles sont appliquées **en SQL** : visibilité, abonnement
 * accepté, blocages dans les deux sens, modération et suppression logique.
 *
 * Une publication `pending` reste visible (contrôle automatique en cours) ;
 * `flagged` et `removed` sont exclus des listes publiques.
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
    inArray(publications.moderationStatus, ['pending', 'approved']),
    sql`(
      ${publications.visibility} = 'public'
      or (${publications.visibility} = 'followers' and ${followsAuthor})
      or ${publications.authorId} = ${viewerId}
    )`,
    sql`not exists (
      select 1 from blocks b
      where (b.blocker_id = ${viewerId} and b.blocked_id = ${publications.authorId})
         or (b.blocker_id = ${publications.authorId} and b.blocked_id = ${viewerId})
    )`,
  ];
}
