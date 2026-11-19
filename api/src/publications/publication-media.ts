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
  /** Variante basse qualité d'une vidéo, pour les réseaux mobiles. */
  lowUrl: string | null;
  /** Image fixe d'une vidéo (variante `poster`). */
  posterUrl: string | null;
  altText: string | null;
}

/**
 * Ce dont la résolution d'URL a besoin côté stockage. Interface étroite à
 * dessein : `loadPublicationMedia` reste testable sans S3, et la signature des
 * URL n'est jamais décidée dans la couche de lecture.
 */
export interface MediaUrlResolver {
  /** URL publique immuable (contenu réellement public uniquement). */
  publicUrl(key: string): string | null;
  /** URL signée courte, pour tout contenu qui ne doit pas rester public. */
  presignGet(key: string): Promise<string>;
  /** Clé d'objet déduite d'une URL publique (variantes historiques). */
  keyFromPublicUrl(url: string): string | null;
}

/**
 * Niveau de diffusion d'une publication :
 * - `public` : le média peut être servi par le CDN (publication publique d'un
 *   compte public, non supprimée, non retirée par la modération) ;
 * - `signed` : tout le reste (abonnés, privé, compte privé, `flagged`,
 *   supprimé). Un contenu non public ne doit jamais être atteignable par une
 *   URL qui ne peut pas être révoquée.
 */
export type MediaAccess = 'public' | 'signed';

export type MediaAccessFor = (publicationId: string) => MediaAccess;

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;
type AssetRow = typeof mediaAssets.$inferSelect;

/** Variantes préférées selon le type, de la meilleure à la plus légère. */
const IMAGE_PREFERENCE = ['medium', 'thumb'];
const VIDEO_PREFERENCE = ['mp4'];
const VIDEO_LOW_PREFERENCE = ['mp4-low'];
const POSTER_PREFERENCE = ['poster'];

function findVariant(asset: AssetRow, labels: string[]): MediaVariant | null {
  for (const label of labels) {
    const found = (asset.variants ?? []).find((variant) => variant.label === label);
    if (found?.url) {
      return found;
    }
  }
  return null;
}

/** Clé de stockage d'une variante, avec repli pour les lignes sans `key`. */
function variantKey(variant: MediaVariant, resolver: MediaUrlResolver): string | null {
  return variant.key ?? resolver.keyFromPublicUrl(variant.url);
}

/**
 * Résout les deux URL d'un asset selon le niveau de diffusion.
 *
 * Aucun repli d'un contenu `signed` vers son URL publique : si la clé n'est pas
 * retrouvable, le média est rendu sans URL et le client affiche son état
 * d'erreur, plutôt que d'exposer une adresse non révocable.
 */
async function resolveUrls(
  asset: AssetRow,
  resolver: MediaUrlResolver,
  access: MediaAccess,
): Promise<{ url: string | null; lowUrl: string | null; posterUrl: string | null }> {
  const main =
    asset.kind === 'video' ? findVariant(asset, VIDEO_PREFERENCE) : findVariant(asset, IMAGE_PREFERENCE);
  const low = asset.kind === 'video' ? findVariant(asset, VIDEO_LOW_PREFERENCE) : null;
  const poster = asset.kind === 'video' ? findVariant(asset, POSTER_PREFERENCE) : null;
  // Sans variante (image sans worker, vidéo non transcodée) : l'original.
  const mainKey = main ? variantKey(main, resolver) : asset.storageKey;
  const lowKey = low ? variantKey(low, resolver) : null;
  const posterKey = poster ? variantKey(poster, resolver) : null;
  const ready = asset.status === 'ready';

  if (access === 'public') {
    return {
      url: ready && mainKey ? resolver.publicUrl(mainKey) : null,
      lowUrl: ready && lowKey ? resolver.publicUrl(lowKey) : null,
      posterUrl: posterKey ? resolver.publicUrl(posterKey) : null,
    };
  }

  const [url, lowUrl, posterUrl] = await Promise.all([
    ready && mainKey ? resolver.presignGet(mainKey) : Promise.resolve(null),
    ready && lowKey ? resolver.presignGet(lowKey) : Promise.resolve(null),
    posterKey ? resolver.presignGet(posterKey) : Promise.resolve(null),
  ]);
  return { url, lowUrl, posterUrl };
}

/**
 * Charge les médias d'un lot de publications, en une requête par table.
 * Utilisé par le détail et par le fil pour éviter une requête par publication.
 *
 * `accessFor` décide, publication par publication, si l'URL peut être publique
 * ou doit être signée. L'appelant connaît la visibilité, la modération et le
 * statut du compte auteur : cette couche ne les devine pas.
 */
export async function loadPublicationMedia(
  db: Executor,
  publicationIds: string[],
  resolver: MediaUrlResolver | null,
  accessFor: MediaAccessFor = () => 'public',
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
    const access = resolver ? accessFor(row.publicationId) : 'signed';
    const urls = resolver
      ? await resolveUrls(row.asset, resolver, access)
      : { url: null, lowUrl: null, posterUrl: null };
    const list = result.get(row.publicationId) ?? [];
    list.push({
      assetId: row.asset.id,
      kind: row.asset.kind,
      mime: row.asset.mime,
      position: row.position,
      width: row.asset.width,
      height: row.asset.height,
      durationMs: row.asset.durationMs,
      url: urls.url,
      lowUrl: urls.lowUrl,
      posterUrl: urls.posterUrl,
      altText: row.altText,
    });
    result.set(row.publicationId, list);
  }
  return result;
}
