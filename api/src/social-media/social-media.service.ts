import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { mediaAssets, mediaJobs } from '../db/schema.js';
import {
  ALLOWED_AUDIO_MIMES,
  ALLOWED_IMAGE_MIMES,
  ALLOWED_VIDEO_MIMES,
  acceptDetected,
  canonicalAudioMime,
  detectAudioMedia,
  detectSocialMedia,
  type SocialMediaKind,
} from './media-signature.js';
import { ObjectStorageService, UPLOAD_URL_TTL_SECONDS } from './object-storage.service.js';

/** Plafonds v1, en octets. Le client les affiche, l'API les impose. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
/** Commentaire vocal : quelques minutes en AAC suffisent largement. */
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
/** Octets lus pour la détection binaire : les signatures tiennent en 16. */
const SIGNATURE_PROBE_BYTES = 32;

export interface UploadTicket {
  id: string;
  status: 'pending';
  uploadUrl: string;
  /** Durée de validité de l'URL, en secondes. */
  expiresIn: number;
  /** Type attendu par l'objet : le PUT doit envoyer exactement celui-ci. */
  contentType: string;
  maxBytes: number;
}

export interface MediaAssetView {
  id: string;
  kind: SocialMediaKind;
  mime: string;
  sizeBytes: number;
  status: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  publicUrl: string | null;
  createdAt: Date;
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'video/3gpp': '3gp',
  'video/3gpp2': '3g2',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
};

/**
 * Pipeline média social, première marche (plan §7, phase 0) : le serveur crée
 * l'asset et l'autorisation d'écriture, le client téléverse directement dans le
 * stockage, puis la confirmation vérifie les octets réels.
 *
 * Les variantes et le transcodage (`sharp`/`ffmpeg`) restent au worker de la
 * phase 1 : la confirmation laisse l'asset en `uploaded`.
 */
@Injectable()
export class SocialMediaService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: ObjectStorageService,
  ) {}

  /**
   * Recherche de GIF (GIPHY), relayée par l'API : la clé reste côté serveur
   * et l'appareil ne contacte jamais GIPHY directement. Sans requête : les
   * tendances. Contenu filtré « pg-13 », comme Instagram.
   */
  async searchGifs(query: string, offset = 0): Promise<{
    items: Array<{ id: string; url: string; previewUrl: string; width: number; height: number; title: string }>;
    nextOffset: number | null;
  }> {
    const key = process.env.GIPHY_API_KEY;
    if (!key) {
      throw new ServiceUnavailableException('Recherche de GIF non configurée.');
    }
    const q = query.trim().slice(0, 50);
    const params = new URLSearchParams({
      api_key: key,
      limit: '24',
      offset: String(Math.max(0, Math.min(offset, 4975))),
      rating: 'pg-13',
      lang: 'fr',
      bundle: 'messaging_non_clips',
    });
    if (q) params.set('q', q);
    const response = await fetch(
      `https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}?${params.toString()}`,
      { signal: AbortSignal.timeout(6000) },
    ).catch(() => null);
    if (!response?.ok) {
      throw new ServiceUnavailableException('Recherche de GIF indisponible.');
    }
    const body = (await response.json()) as {
      data?: Array<{
        id: string;
        title?: string;
        images?: Record<string, { url?: string; width?: string; height?: string } | undefined>;
      }>;
      pagination?: { total_count?: number; count?: number; offset?: number };
    };
    const items = (body.data ?? [])
      .map((gif) => {
        const full = gif.images?.downsized_medium ?? gif.images?.original;
        const preview = gif.images?.fixed_width ?? gif.images?.fixed_width_downsampled ?? full;
        if (!full?.url || !preview?.url) return null;
        return {
          id: gif.id,
          url: full.url,
          previewUrl: preview.url,
          width: Number(preview.width) || 200,
          height: Number(preview.height) || 200,
          title: gif.title ?? '',
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    const page = body.pagination;
    const next = (page?.offset ?? 0) + (page?.count ?? items.length);
    return { items, nextOffset: page?.total_count && next < page.total_count ? next : null };
  }

  /**
   * Importe un GIF GIPHY choisi comme média du compte : téléchargé par le
   * serveur (domaine GIPHY seulement), vérifié (vraie signature GIF, taille
   * bornée), puis traité comme une image animée (WebP animée). Le
   * commentaire le référence ensuite par `mediaAssetId`, comme une photo.
   */
  async importGif(ownerId: string, giphyId: string): Promise<MediaAssetView> {
    const key = process.env.GIPHY_API_KEY;
    if (!key) {
      throw new ServiceUnavailableException('Recherche de GIF non configurée.');
    }
    if (!this.storage.isConfigured()) {
      throw new ServiceUnavailableException('Stockage média non configuré.');
    }
    if (!/^[A-Za-z0-9]{1,64}$/.test(giphyId)) {
      throw new BadRequestException('GIF invalide.');
    }
    // L'URL est relue chez GIPHY à partir de l'identifiant : le client ne
    // peut pas faire télécharger une adresse arbitraire au serveur.
    const meta = await fetch(
      `https://api.giphy.com/v1/gifs/${giphyId}?api_key=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(6000) },
    ).catch(() => null);
    const info = meta?.ok
      ? ((await meta.json()) as {
          data?: { images?: Record<string, { url?: string } | undefined> };
        })
      : null;
    const source = info?.data?.images?.downsized_medium?.url ?? info?.data?.images?.original?.url;
    if (!source || !/^https:\/\/media\d*\.giphy\.com\//.test(source)) {
      throw new BadRequestException('GIF introuvable.');
    }
    const download = await fetch(source, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!download?.ok) {
      throw new ServiceUnavailableException('Téléchargement du GIF impossible.');
    }
    const bytes = Buffer.from(await download.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException('GIF trop volumineux.');
    }
    if (detectSocialMedia(bytes.subarray(0, SIGNATURE_PROBE_BYTES))?.mime !== 'image/gif') {
      throw new BadRequestException('Le fichier reçu n’est pas un GIF.');
    }
    const storageKey = `social/image/${ownerId}/${crypto.randomUUID()}.gif`;
    await this.storage.put(storageKey, bytes, 'image/gif');
    const row = await this.db.transaction(async (tx) => {
      const [asset] = await tx
        .insert(mediaAssets)
        .values({
          ownerId,
          bucket: 'social',
          storageKey,
          kind: 'image',
          mime: 'image/gif',
          sizeBytes: bytes.length,
          status: 'uploaded',
        })
        .returning();
      if (!asset) {
        throw new Error('Création du média impossible.');
      }
      await tx.insert(mediaJobs).values({ assetId: asset.id, kind: 'image_variants' });
      return asset;
    });
    return this.view(row);
  }

  /** Crée un asset `pending` et rend l'URL présignée d'écriture. */
  async createUpload(
    ownerId: string,
    input: { kind: SocialMediaKind; mime: string; sizeBytes: number; durationMs?: number },
  ): Promise<UploadTicket> {
    if (!this.storage.isConfigured()) {
      throw new ServiceUnavailableException('Stockage média non configuré.');
    }
    const maxBytes =
      input.kind === 'image'
        ? MAX_IMAGE_BYTES
        : input.kind === 'video'
          ? MAX_VIDEO_BYTES
          : MAX_AUDIO_BYTES;
    if (input.sizeBytes <= 0 || input.sizeBytes > maxBytes) {
      throw new BadRequestException(
        `Fichier trop volumineux : la limite est de ${maxBytes} octets.`,
      );
    }
    const allowed: readonly string[] =
      input.kind === 'image'
        ? ALLOWED_IMAGE_MIMES
        : input.kind === 'video'
          ? ALLOWED_VIDEO_MIMES
          : ALLOWED_AUDIO_MIMES;
    if (!allowed.includes(input.mime)) {
      throw new BadRequestException('Type de fichier non pris en charge.');
    }
    const extension = EXTENSIONS[input.mime] ?? 'bin';
    // La clé est calculée ici : le client ne choisit jamais où il écrit.
    const storageKey = `social/${input.kind}/${ownerId}/${crypto.randomUUID()}.${extension}`;

    const [asset] = await this.db
      .insert(mediaAssets)
      .values({
        ownerId,
        bucket: 'social',
        storageKey,
        kind: input.kind,
        mime: input.mime,
        sizeBytes: input.sizeBytes,
        durationMs: input.kind === 'audio' ? (input.durationMs ?? null) : null,
      })
      .returning();
    if (!asset) {
      throw new Error('Création du média impossible.');
    }

    return {
      id: asset.id,
      status: 'pending',
      uploadUrl: await this.storage.presignPut(storageKey, input.mime),
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      contentType: input.mime,
      maxBytes,
    };
  }

  /**
   * Confirme l'upload : vérifie l'existence, la taille exacte et la signature
   * binaire réelle. Un objet qui ne correspond pas est supprimé du stockage.
   */
  async complete(ownerId: string, assetId: string): Promise<MediaAssetView> {
    const asset = await this.loadOwned(ownerId, assetId);
    if (asset.status !== 'pending') {
      return this.view(asset);
    }

    const head = await this.storage.head(asset.storageKey);
    if (!head) {
      throw new BadRequestException('Aucun fichier téléversé pour ce média.');
    }
    if (head.size !== asset.sizeBytes) {
      await this.storage.delete(asset.storageKey);
      throw new BadRequestException(
        'La taille reçue ne correspond pas à la taille déclarée.',
      );
    }

    const probe = await this.storage.readHead(asset.storageKey, SIGNATURE_PROBE_BYTES);
    // Les octets font foi. Image / vidéo : tout format accepté de la bonne
    // famille passe, même mal étiqueté par la galerie, et le type réel est
    // enregistré. Audio : on garde la comparaison au MIME canonique.
    let realMime: string | null = null;
    if (probe) {
      if (asset.kind === 'audio') {
        const detected = detectAudioMedia(probe);
        realMime = detected && detected === canonicalAudioMime(asset.mime) ? detected : null;
      } else {
        realMime = acceptDetected(asset.kind, detectSocialMedia(probe))?.mime ?? null;
      }
    }
    if (!realMime) {
      await this.storage.delete(asset.storageKey);
      throw new BadRequestException(
        asset.kind === 'audio'
          ? 'Le contenu ne correspond pas au type déclaré.'
          : 'Format non pris en charge : envoie une photo ou une vidéo.',
      );
    }

    const updated = await this.db.transaction(async (tx) => {
      // L'audio n'a besoin d'aucun traitement : il passe directement `ready`,
      // ce qui permet de le référencer immédiatement dans un commentaire.
      const [row] = await tx
        .update(mediaAssets)
        .set({
          status: asset.kind === 'audio' ? 'ready' : 'uploaded',
          // Type réel détecté (un « .PNG » qui est un JPEG devient image/jpeg).
          mime: realMime,
          updatedAt: new Date(),
        })
        // Le filtre `pending` rend la confirmation idempotente sous course.
        .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.status, 'pending')))
        .returning();
      if (!row) {
        return null;
      }
      if (row.kind !== 'audio') {
        // Une seule mise en file : le job n'est créé que par la transition réussie.
        const kinds =
          row.kind === 'video' ? (['video_poster', 'video_transcode'] as const) : (['image_variants'] as const);
        await tx.insert(mediaJobs).values(kinds.map((kind) => ({ assetId: row.id, kind })));
      }
      return row;
    });

    return this.view(updated ?? asset);
  }

  /** Lecture de l'asset par son propriétaire. */
  async get(ownerId: string, assetId: string): Promise<MediaAssetView> {
    return this.view(await this.loadOwned(ownerId, assetId));
  }

  private async loadOwned(ownerId: string, assetId: string) {
    const [asset] = await this.db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, assetId));
    // 404 aussi pour un asset d'un autre compte : pas de fuite d'existence.
    if (!asset || asset.ownerId !== ownerId) {
      throw new NotFoundException('Média introuvable.');
    }
    return asset;
  }

  private view(asset: typeof mediaAssets.$inferSelect): MediaAssetView {
    return {
      id: asset.id,
      kind: asset.kind,
      mime: asset.mime,
      sizeBytes: asset.sizeBytes,
      status: asset.status,
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
      publicUrl: asset.status === 'ready' ? this.storage.publicUrl(asset.storageKey) : null,
      createdAt: asset.createdAt,
    };
  }
}
