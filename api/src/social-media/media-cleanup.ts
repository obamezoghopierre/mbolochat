import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Database } from '../db/db.module.js';
import { mediaJobs, publicationMedia } from '../db/schema.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Met en file la purge des objets d'un lot d'assets.
 *
 * Le job `cleanup` supprime l'original, les variantes et le poster du stockage,
 * puis marque l'asset supprimé. Sans lui, une publication retirée reste
 * téléchargeable par son URL : la suppression n'est que logique côté base.
 *
 * Idempotent : l'index unique `(asset_id, kind)` absorbe les demandes répétées,
 * et une purge déjà terminée est réarmée si l'asset redevient orphelin plus tard
 * (un média partagé par deux publications, par exemple).
 */
export async function enqueueAssetCleanup(
  tx: Transaction,
  assetIds: string[],
): Promise<number> {
  const unique = [...new Set(assetIds)].filter((id) => id.length > 0);
  if (unique.length === 0) {
    return 0;
  }
  const inserted = await tx
    .insert(mediaJobs)
    .values(unique.map((assetId) => ({ assetId, kind: 'cleanup' as const })))
    .onConflictDoNothing()
    .returning({ id: mediaJobs.id });

  if (inserted.length < unique.length) {
    // Une purge déjà passée (job `done`) doit pouvoir être rejouée ; on ne
    // touche jamais à un job en cours, en attente ou en échec.
    await tx
      .update(mediaJobs)
      .set({
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
        claimToken: null,
        lockedUntil: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mediaJobs.kind, 'cleanup'),
          eq(mediaJobs.status, 'done'),
          inArray(mediaJobs.assetId, unique),
        ),
      );
  }
  return unique.length;
}

/**
 * Purge les médias attachés à une publication (suppression par l'auteur ou
 * décision de modération). À appeler dans la transaction qui masque la
 * publication, pour ne jamais purger un contenu encore visible.
 *
 * Un asset peut être partagé par plusieurs publications : on ne met en file que
 * ceux qui ne sont plus référencés par un contenu vivant (non supprimé, non
 * retiré par la modération).
 */
export async function enqueuePublicationCleanup(
  tx: Transaction,
  publicationId: string,
): Promise<number> {
  const rows = await tx
    .select({ assetId: publicationMedia.assetId })
    .from(publicationMedia)
    .where(
      and(
        eq(publicationMedia.publicationId, publicationId),
        sql`not exists (
          select 1
          from publication_media pm2
          inner join publications p2 on p2.id = pm2.publication_id
          where pm2.asset_id = ${publicationMedia.assetId}
            and p2.deleted_at is null
            and p2.moderation_status <> 'removed'
        )`,
      ),
    );
  return enqueueAssetCleanup(
    tx,
    rows.map((row) => row.assetId),
  );
}

/**
 * Purge des médias retirés d'une publication encore visible (retouche d'un
 * carrousel) : seuls ceux que plus aucun contenu vivant n'utilise partent.
 * À appeler dans la transaction qui réécrit `publication_media`.
 */
export async function enqueueOrphanAssetCleanup(
  tx: Transaction,
  assetIds: string[],
): Promise<number> {
  const unique = [...new Set(assetIds)].filter((id) => id.length > 0);
  if (unique.length === 0) {
    return 0;
  }
  const stillUsed = await tx
    .select({ assetId: publicationMedia.assetId })
    .from(publicationMedia)
    .where(
      and(
        inArray(publicationMedia.assetId, unique),
        sql`exists (
          select 1 from publications p2
          where p2.id = ${publicationMedia.publicationId}
            and p2.deleted_at is null
            and p2.moderation_status <> 'removed'
        )`,
      ),
    );
  const used = new Set(stillUsed.map((row) => row.assetId));
  return enqueueAssetCleanup(
    tx,
    unique.filter((assetId) => !used.has(assetId)),
  );
}
