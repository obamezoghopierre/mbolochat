import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { Database } from '../db/db.module.js';
import { mediaAssets, publicationMedia } from '../db/schema.js';
import type { MediaVariant } from '../db/schema.js';

/** Média tel que le client le reçoit : URL prête à lire, jamais la clé S3. */
export interface PublicationMediaView {
  assetId: string;
  kind: 'image' | 'video' | 'audio';
  mime: string;
  position: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  url: string | null;
  /** Image fixe d'une vidéo (variante `poster`). */
  posterUrl: string | null;
  altText: string | null;
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;
type AssetRow = typeof mediaAssets.$inferSelect;

/** Variantes préférées selon le type, de la meilleure à la plus légère. */
const IMAGE_PREFERENCE = ['medium', 'thumb'];
const VIDEO_PREFERENCE = ['mp4'];

function variantUrl(asset: AssetRow, labels: string[]): string | null {
  for (const label of labels) {
    const found = (asset.variants ?? []).find((variant: MediaVariant) => variant.label === label);
    if (found?.url) {
      return found.url;
    }
  }
  return null;
}

/**
 * Résout l'URL servie au client : variante adaptée si le worker en a produit
 * une, sinon l'original (chemin public du stockage). `null` si aucun stockage
 * public n'est configuré : le client ne doit pas recevoir une clé S3.
 */
export function mediaView(
  asset: AssetRow,
  position: number,
  baseUrl: string | null,
  altText: string | null = null,
): PublicationMediaView {
  const preferred =
    asset.kind === 'video' ? variantUrl(asset, VIDEO_PREFERENCE) : variantUrl(asset, IMAGE_PREFERENCE);
  const fallback =
    baseUrl && asset.status === 'ready'
      ? `${baseUrl.replace(/\/$/, '')}/${asset.storageKey}`
      : null;
  const poster = asset.kind === 'video' ? variantUrl(asset, ['poster']) : null;

  return {
    assetId: asset.id,
    kind: asset.kind,
    mime: asset.mime,
    position,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    url: preferred ?? fallback,
    posterUrl: poster,
    altText,
  };
}

/**
 * Charge les médias d'un lot de publications, en une requête par table.
 * Utilisé par le détail et par le fil pour éviter une requête par publication.
 */
export async function loadPublicationMedia(
  db: Executor,
  publicationIds: string[],
  baseUrl: string | null,
): Promise<Map<string, PublicationMediaView[]>> {
  const result = new Map<string, PublicationMediaView[]>();
  if (publicationIds.length === 0) {
    return result;
  }

  const rows = await db
    .select({
      publicationId: publicationMedia.publicationId,
      position: publicationMedia.position,
      altText: publicationMedia.altText,
      asset: mediaAssets,
    })
    .from(publicationMedia)
    .innerJoin(mediaAssets, eq(mediaAssets.id, publicationMedia.assetId))
    .where(
      and(
        inArray(publicationMedia.publicationId, publicationIds),
        isNull(mediaAssets.deletedAt),
      ),
    )
    .orderBy(publicationMedia.position);

  for (const row of rows) {
    const list = result.get(row.publicationId) ?? [];
    list.push(mediaView(row.asset, row.position, baseUrl, row.altText));
    result.set(row.publicationId, list);
  }
  return result;
}
