import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';

import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  mediaAssets,
  mediaJobs,
  publicationMedia,
  publications,
  type MediaVariant,
} from '../db/schema.js';
import { processImageVariants, processVideo, type ProcessedMedia } from './media-processors.js';
import { ObjectStorageService } from './object-storage.service.js';

/** Nombre de tentatives avant d'abandonner un job. */
export const MAX_JOB_ATTEMPTS = 3;
/** Espacement entre deux tentatives (progressif). */
const RETRY_DELAY_MS = 5_000;
/** Bail d'un job en cours : au-delà, il peut être repris par un autre worker. */
export const JOB_LOCK_TTL_MS = 60_000;
const DEFAULT_BATCH_SIZE = 2;

export interface WorkerRunResult {
  claimed: number;
  done: number;
  failed: number;
}

type ClaimedJob = {
  id: string;
  assetId: string;
  kind: 'image_variants' | 'video_poster' | 'video_transcode' | 'cleanup';
  attempts: number;
  claimToken: string;
};

/**
 * Worker média (plan §7.3-4, phase 1).
 *
 * La file vit dans `media_jobs` (pas de Redis en v1). Chaque job est pris avec
 * `FOR UPDATE SKIP LOCKED` et un jeton de fencing : un worker dont le bail a
 * expiré ne peut ni clore ni replanifier un job repris par un autre.
 */
@Injectable()
export class MediaWorkerService {
  private readonly batchSize: number;
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: ObjectStorageService,
    config: ConfigService,
  ) {
    this.batchSize = Number(config.get<string>('MEDIA_WORKER_BATCH') ?? DEFAULT_BATCH_SIZE);
    this.ffmpegPath = config.get<string>('FFMPEG_PATH') ?? 'ffmpeg';
    this.ffprobePath = config.get<string>('FFPROBE_PATH') ?? 'ffprobe';
  }

  /** Traite au plus `limit` jobs ; rend le bilan. Idempotent par construction. */
  async runOnce(limit = this.batchSize): Promise<WorkerRunResult> {
    const jobs = await this.claim(limit);
    let done = 0;
    let failed = 0;

    for (const job of jobs) {
      try {
        await this.process(job);
        const closed = await this.db
          .update(mediaJobs)
          .set({
            status: 'done',
            claimToken: null,
            lockedUntil: null,
            lastError: null,
            updatedAt: new Date(),
          })
          .where(and(eq(mediaJobs.id, job.id), eq(mediaJobs.claimToken, job.claimToken)))
          .returning({ id: mediaJobs.id });
        if (closed.length > 0) {
          done += 1;
        }
      } catch (error) {
        failed += 1;
        await this.releaseAfterFailure(job, error);
      }
    }

    return { claimed: jobs.length, done, failed };
  }

  /**
   * Prend un lot de jobs prêts. La sélection verrouille les lignes
   * (`FOR UPDATE SKIP LOCKED`) : deux workers ne prennent jamais le même job.
   */
  private async claim(limit: number): Promise<ClaimedJob[]> {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const candidates = await tx
        .select({ id: mediaJobs.id, kind: mediaJobs.kind, assetId: mediaJobs.assetId })
        .from(mediaJobs)
        .where(
          or(
            and(eq(mediaJobs.status, 'pending'), lte(mediaJobs.nextAttemptAt, now)),
            and(eq(mediaJobs.status, 'running'), lt(mediaJobs.lockedUntil, now)),
          ),
        )
        .orderBy(asc(mediaJobs.nextAttemptAt))
        .limit(Math.max(1, limit))
        .for('update', { skipLocked: true });

      const claimed: ClaimedJob[] = [];
      for (const candidate of candidates) {
        const claimToken = crypto.randomUUID();
        const [row] = await tx
          .update(mediaJobs)
          .set({
            status: 'running',
            claimToken,
            lockedUntil: new Date(Date.now() + JOB_LOCK_TTL_MS),
            attempts: sql`${mediaJobs.attempts} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(mediaJobs.id, candidate.id))
          .returning({ attempts: mediaJobs.attempts });
        if (row) {
          claimed.push({
            id: candidate.id,
            assetId: candidate.assetId,
            kind: candidate.kind,
            attempts: row.attempts,
            claimToken,
          });
        }
      }
      return claimed;
    });
  }

  private async process(job: ClaimedJob): Promise<void> {
    const [asset] = await this.db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, job.assetId));
    if (!asset) {
      throw new Error('Média introuvable.');
    }
    if (job.kind === 'cleanup') {
      // La purge s'applique précisément à un asset supprimé : elle précède le
      // marquage `deleted_at`, donc elle est traitée avant le contrôle ci-dessous.
      // Si un autre contenu vivant référence encore ce média, il n'y a rien à
      // purger : le job se clôt sans toucher au stockage, et une suppression
      // ultérieure le réarmera.
      if (!(await this.isReferenced(asset.id))) {
        await this.cleanup(asset);
      }
      return;
    }
    if (asset.deletedAt) {
      throw new Error('Média supprimé.');
    }

    const options = {
      storage: this.storage,
      assetId: asset.id,
      storageKey: asset.storageKey,
      ffmpegPath: this.ffmpegPath,
      ffprobePath: this.ffprobePath,
    };

    let processed: ProcessedMedia;
    // Libellés sans lesquels l'asset n'est pas publiable. Une vidéo est
    // utilisable dès que son MP4 transcode existe : le poster est un confort de
    // chargement, il ne doit pas bloquer la publication s'il échoue.
    let required: readonly string[];
    if (job.kind === 'image_variants') {
      processed = await processImageVariants(options);
      required = ['medium', 'thumb'];
    } else if (job.kind === 'video_poster' || job.kind === 'video_transcode') {
      processed = await processVideo({
        ...options,
        step: job.kind === 'video_poster' ? 'poster' : 'transcode',
      });
      required = job.kind === 'video_transcode' ? ['mp4'] : [];
    } else {
      throw new Error(`Type de job non pris en charge : ${String(job.kind)}.`);
    }

    await this.persist(asset.id, processed, required);
  }

  /**
   * Fusionne et écrit les variantes sous verrou de ligne.
   *
   * Deux jobs d'un même asset (poster et transcodage) peuvent être traités par
   * deux workers : sans `FOR UPDATE`, chacun relit un `variants` périmé et le
   * dernier écrase la variante de l'autre.
   */
  private async persist(
    assetId: string,
    processed: ProcessedMedia,
    required: readonly string[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          variants: mediaAssets.variants,
          width: mediaAssets.width,
          height: mediaAssets.height,
          durationMs: mediaAssets.durationMs,
          status: mediaAssets.status,
          deletedAt: mediaAssets.deletedAt,
        })
        .from(mediaAssets)
        .where(eq(mediaAssets.id, assetId))
        .for('update');
      if (!current) {
        throw new Error('Média introuvable.');
      }
      if (current.deletedAt) {
        throw new Error('Média supprimé.');
      }

      const merged = mergeVariants(current.variants ?? null, processed.variants);
      const labels = new Set(merged.map((variant) => variant.label));
      const complete = required.every((label) => labels.has(label));
      await tx
        .update(mediaAssets)
        .set({
          variants: merged,
          width: processed.width ?? current.width,
          height: processed.height ?? current.height,
          durationMs: processed.durationMs ?? current.durationMs,
          status: complete || current.status === 'ready' ? 'ready' : 'uploaded',
          updatedAt: new Date(),
        })
        .where(eq(mediaAssets.id, assetId));
    });
  }

  /** Un contenu vivant (non supprimé, non retiré) utilise-t-il encore l'asset ? */
  private async isReferenced(assetId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: publicationMedia.id })
      .from(publicationMedia)
      .innerJoin(publications, eq(publications.id, publicationMedia.publicationId))
      .where(
        and(
          eq(publicationMedia.assetId, assetId),
          isNull(publications.deletedAt),
          ne(publications.moderationStatus, 'removed'),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  /**
   * Purge les objets d'un asset (original, variantes, poster) puis le marque
   * supprimé. `DeleteObject` est idempotent : rejouer la purge est sans effet.
   */
  private async cleanup(asset: typeof mediaAssets.$inferSelect): Promise<void> {
    const keys = new Set<string>([asset.storageKey]);
    for (const variant of asset.variants ?? []) {
      const key = variant.key ?? this.storage.keyFromPublicUrl(variant.url);
      if (key) {
        keys.add(key);
      }
    }
    for (const key of keys) {
      await this.storage.delete(key);
    }
    await this.db
      .update(mediaAssets)
      .set({ deletedAt: new Date(), variants: null, updatedAt: new Date() })
      .where(eq(mediaAssets.id, asset.id));
  }

  /** Réessaie avec un délai, ou abandonne après le plafond de tentatives. */
  private async releaseAfterFailure(job: ClaimedJob, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const exhausted = job.attempts >= MAX_JOB_ATTEMPTS;
    await this.db
      .update(mediaJobs)
      .set({
        status: exhausted ? 'failed' : 'pending',
        lastError: message.slice(0, 1000),
        nextAttemptAt: new Date(Date.now() + RETRY_DELAY_MS * Math.max(1, job.attempts)),
        claimToken: null,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      // Fencing : un worker au bail expiré ne peut pas écraser l'état d'un autre.
      .where(and(eq(mediaJobs.id, job.id), eq(mediaJobs.claimToken, job.claimToken)));
  }
}

/** Fusionne par libellé : rejouer un job ne duplique pas une variante. */
function mergeVariants(
  existing: MediaVariant[] | null,
  produced: MediaVariant[],
): MediaVariant[] {
  const byLabel = new Map<string, MediaVariant>();
  for (const variant of existing ?? []) {
    byLabel.set(variant.label, variant);
  }
  for (const variant of produced) {
    byLabel.set(variant.label, variant);
  }
  return [...byLabel.values()];
}
