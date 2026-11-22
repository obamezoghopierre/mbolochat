import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

import type { Database } from '../db/db.module.js';
import { blocks, follows, publicationReactions, users } from '../db/schema.js';

/** Carte publique du compte affiché dans « Aimé par X et N autres ». */
export interface LikedByCard {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
}

/**
 * Pour chaque publication, le compte suivi par le visiteur qui y a réagi le
 * plus récemment (« Aimé par X »). Une seule requête (`DISTINCT ON`) quel que
 * soit le nombre de publications. Exclus : le visiteur lui-même, les comptes
 * non suivis ou en attente, supprimés, ou bloqués dans un sens ou dans l'autre.
 *
 * Partagé par le fil et le détail d'une publication pour garder une seule
 * règle de confidentialité.
 */
export async function loadLikedByFollowed(
  db: Database,
  publicationIds: readonly string[],
  viewerId: string,
): Promise<Map<string, LikedByCard>> {
  if (publicationIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectDistinctOn([publicationReactions.publicationId], {
      publicationId: publicationReactions.publicationId,
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      verified: users.verified,
    })
    .from(publicationReactions)
    .innerJoin(
      follows,
      and(
        eq(follows.followingId, publicationReactions.userId),
        eq(follows.followerId, viewerId),
        eq(follows.status, 'accepted'),
      ),
    )
    .innerJoin(users, eq(users.id, publicationReactions.userId))
    .where(
      and(
        inArray(publicationReactions.publicationId, [...publicationIds]),
        ne(publicationReactions.userId, viewerId),
        isNull(users.deletedAt),
        sql`not exists (
          select 1 from ${blocks}
          where (${blocks.blockerId} = ${viewerId} and ${blocks.blockedId} = ${publicationReactions.userId})
             or (${blocks.blockerId} = ${publicationReactions.userId} and ${blocks.blockedId} = ${viewerId})
        )`,
      ),
    )
    .orderBy(publicationReactions.publicationId, desc(publicationReactions.createdAt));
  return new Map(rows.map(({ publicationId, ...card }) => [publicationId, card]));
}
