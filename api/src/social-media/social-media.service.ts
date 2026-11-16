import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { mediaAssets } from '../db/schema.js';
import {
  ALLOWED_IMAGE_MIMES,
  ALLOWED_VIDEO_MIMES,
  detectSocialMedia,
  type SocialMediaKind,
} from './media-signature.js';
import { ObjectStorageService, UPLOAD_URL_TTL_SECONDS } from './object-storage.service.js';

/** Plafonds v1, en octets. Le client les affiche, l'API les impose. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
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
  'video/mp4': 'mp4',
  'video/webm': 'webm',
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

  /** Crée un asset `pending` et rend l'URL présignée d'écriture. */
  async createUpload(
    ownerId: string,
    input: { kind: SocialMediaKind; mime: string; sizeBytes: number },
  ): Promise<UploadTicket> {
    if (!this.storage.isConfigured()) {
      throw new ServiceUnavailableException('Stockage média non configuré.');
    }
    const maxBytes = input.kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (input.sizeBytes <= 0 || input.sizeBytes > maxBytes) {
      throw new BadRequestException(
        `Fichier trop volumineux : la limite est de ${maxBytes} octets.`,
      );
    }
    const allowed: readonly string[] =
      input.kind === 'image' ? ALLOWED_IMAGE_MIMES : ALLOWED_VIDEO_MIMES;
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
    const detected = probe ? detectSocialMedia(probe) : null;
    if (!detected || detected.kind !== asset.kind || detected.mime !== asset.mime) {
      await this.storage.delete(asset.storageKey);
      throw new BadRequestException('Le contenu ne correspond pas au type déclaré.');
    }

    const [updated] = await this.db
      .update(mediaAssets)
      .set({ status: 'uploaded', updatedAt: new Date() })
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.status, 'pending')))
      .returning();

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
      kind: asset.kind === 'video' ? 'video' : 'image',
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
