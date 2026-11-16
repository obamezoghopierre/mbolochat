import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

import type { MediaVariant } from '../db/schema.js';
import type { ObjectStorageService } from './object-storage.service.js';

/** Variantes d'image produites par le worker. Jamais d'agrandissement. */
export const IMAGE_VARIANTS = [
  { label: 'thumb', width: 320 },
  { label: 'medium', width: 1080 },
] as const;

export const POSTER_LABEL = 'poster';
export const TRANSCODED_LABEL = 'mp4';

const WEBP_QUALITY = 80;
const POSTER_MAX_WIDTH = 720;
const FFMPEG_TIMEOUT_MS = 120_000;

export interface ProcessedMedia {
  variants: MediaVariant[];
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface ProcessorOptions {
  storage: ObjectStorageService;
  assetId: string;
  storageKey: string;
  /** Variantes déjà présentes (`media_assets.variants`). */
  existing: MediaVariant[] | null;
  ffmpegPath: string;
  ffprobePath: string;
}

/** Fusionne par libellé : rejouer un job ne duplique pas une variante. */
function mergeVariants(existing: MediaVariant[] | null, produced: MediaVariant[]): MediaVariant[] {
  const byLabel = new Map<string, MediaVariant>();
  for (const variant of existing ?? []) {
    byLabel.set(variant.label, variant);
  }
  for (const variant of produced) {
    byLabel.set(variant.label, variant);
  }
  return [...byLabel.values()];
}

/**
 * Variantes d'image : vignette et rendu moyen en WebP.
 *
 * L'original n'est jamais modifié. Une image plus petite que la cible n'est pas
 * agrandie : la variante garde la largeur d'origine.
 */
export async function processImageVariants(
  options: ProcessorOptions,
): Promise<ProcessedMedia> {
  const original = await options.storage.download(options.storageKey);
  if (!original) {
    throw new Error('Objet source introuvable dans le stockage.');
  }
  const metadata = await sharp(original).metadata();
  const sourceWidth = metadata.width ?? null;
  const sourceHeight = metadata.height ?? null;

  const produced: MediaVariant[] = [];
  for (const target of IMAGE_VARIANTS) {
    const width = sourceWidth ? Math.min(target.width, sourceWidth) : target.width;
    const buffer = await sharp(original)
      .rotate() // applique l'orientation EXIF avant de la supprimer
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    const key = `social/variants/${options.assetId}/${target.label}.webp`;
    await options.storage.put(key, buffer.data, 'image/webp');
    produced.push({
      label: target.label,
      width: buffer.info.width,
      height: buffer.info.height,
      url: options.storage.publicUrl(key) ?? key,
      sizeBytes: buffer.data.length,
    });
  }

  return {
    variants: mergeVariants(options.existing, produced),
    width: sourceWidth,
    height: sourceHeight,
    durationMs: null,
  };
}

/**
 * Artefacts vidéo. `poster` extrait une image fixe, `transcode` produit un MP4
 * H.264/AAC progressif (pas de HLS en v1, cf. plan §7).
 */
export async function processVideo(
  options: ProcessorOptions & { step: 'poster' | 'transcode' },
): Promise<ProcessedMedia> {
  const original = await options.storage.download(options.storageKey);
  if (!original) {
    throw new Error('Objet source introuvable dans le stockage.');
  }

  const directory = await mkdtemp(join(tmpdir(), 'mbolo-media-'));
  const inputPath = join(directory, 'input');
  try {
    await writeFile(inputPath, original);
    const probe = await probeVideo(inputPath, options.ffprobePath);
    const produced: MediaVariant[] = [];

    if (options.step === 'poster') {
      const posterPath = join(directory, 'poster.jpg');
      await runFfmpeg(options.ffmpegPath, [
        '-y',
        '-ss',
        '0',
        '-i',
        inputPath,
        '-frames:v',
        '1',
        '-vf',
        `scale='min(${POSTER_MAX_WIDTH},iw)':-2`,
        '-q:v',
        '3',
        posterPath,
      ]);
      const poster = await readFile(posterPath);
      const key = `social/posters/${options.assetId}.jpg`;
      await options.storage.put(key, poster, 'image/jpeg');
      produced.push({
        label: POSTER_LABEL,
        width: Math.min(POSTER_MAX_WIDTH, probe.width ?? POSTER_MAX_WIDTH),
        height: probe.height
          ? Math.round((probe.height * Math.min(POSTER_MAX_WIDTH, probe.width ?? POSTER_MAX_WIDTH)) /
              (probe.width || 1))
          : 0,
        url: options.storage.publicUrl(key) ?? key,
        sizeBytes: poster.length,
      });
    } else {
      const outputPath = join(directory, 'output.mp4');
      await runFfmpeg(options.ffmpegPath, [
        '-y',
        '-i',
        inputPath,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        outputPath,
      ]);
      const transcoded = await readFile(outputPath);
      const key = `social/videos/${options.assetId}.mp4`;
      await options.storage.put(key, transcoded, 'video/mp4');
      produced.push({
        label: TRANSCODED_LABEL,
        width: probe.width ?? 0,
        height: probe.height ?? 0,
        url: options.storage.publicUrl(key) ?? key,
        sizeBytes: transcoded.length,
      });
    }

    return {
      variants: mergeVariants(options.existing, produced),
      width: probe.width,
      height: probe.height,
      durationMs: probe.durationMs,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function probeVideo(
  path: string,
  ffprobePath: string,
): Promise<{ width: number | null; height: number | null; durationMs: number | null }> {
  const output = await run(ffprobePath, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    path,
  ]);
  const parsed = JSON.parse(output) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
  const seconds = Number(parsed.format?.duration ?? Number.NaN);
  return {
    width: video?.width ?? null,
    height: video?.height ?? null,
    durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
  };
}

function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  return run(ffmpegPath, args).then(() => undefined);
}

/** Exécute un binaire et rend sa sortie standard ; rejette avec stderr. */
function run(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${binary} a dépassé ${FFMPEG_TIMEOUT_MS} ms.`));
    }, FFMPEG_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`${binary} a échoué (code ${code}) : ${stderr.slice(-500)}`));
    });
  });
}
