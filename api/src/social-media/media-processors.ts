import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
/** Variante basse qualité servie sur réseau mobile (flux 3G/4G). */
export const TRANSCODED_LOW_LABEL = 'mp4-low';

const WEBP_QUALITY = 80;
const POSTER_MAX_WIDTH = 720;
/**
 * Largeur maximale du rendu servi au fil. Un portrait 4K (2160 × 3840) devient
 * 1080 × 1920 : c'est la définition utile sur un téléphone, et cela divise le
 * débit par quatre par rapport à l'original.
 */
const VIDEO_MAX_WIDTH = 1080;
/**
 * Largeur de la variante basse qualité. 540 px reste lisible sur un téléphone
 * et divise encore le débit par ~4 par rapport au rendu principal : sur réseau
 * mobile, moins de buffering et moins de données consommées.
 */
const VIDEO_LOW_MAX_WIDTH = 540;
/** Intervalle de keyframes : un seek au doigt doit trouver une image proche. */
const VIDEO_GOP_FRAMES = 30;
/** Borne basse du délai accordé à ffmpeg, même pour un clip très court. */
const FFMPEG_MIN_TIMEOUT_MS = 120_000;
/** Multiplicateur appliqué à la durée source pour la borne haute. */
const FFMPEG_TIMEOUT_FACTOR = 3;
const FFMPEG_MAX_TIMEOUT_MS = 900_000;

export interface ProcessedMedia {
  /** Variantes produites par **cette** exécution, non fusionnées. */
  variants: MediaVariant[];
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface ProcessorOptions {
  storage: ObjectStorageService;
  assetId: string;
  storageKey: string;
  ffmpegPath: string;
  ffprobePath: string;
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
      key,
      sizeBytes: buffer.data.length,
    });
  }

  return {
    variants: produced,
    width: sourceWidth,
    height: sourceHeight,
    durationMs: null,
  };
}

/**
 * Artefacts vidéo. `poster` extrait une image fixe, `transcode` produit un MP4
 * H.264/AAC progressif (pas de HLS en v1, cf. plan §7).
 *
 * Le transcodage **redimensionne** : conserver une source 4K rendrait le fil
 * illisible en 4G et le seek coûteux. Le GOP est fixé pour que le glissement sur
 * la barre trouve une keyframe proche, et `yuv420p` garantit la compatibilité de
 * décodage Android.
 */
export async function processVideo(
  options: ProcessorOptions & { step: 'poster' | 'transcode' },
): Promise<ProcessedMedia> {
  const directory = await mkdtemp(join(tmpdir(), 'mbolo-media-'));
  const inputPath = join(directory, 'input');
  try {
    // Streaming direct vers le disque : une vidéo de 100 Mio ne transite jamais
    // entièrement par la mémoire du worker.
    const downloaded = await options.storage.downloadToFile(options.storageKey, inputPath);
    if (!downloaded) {
      throw new Error('Objet source introuvable dans le stockage.');
    }

    const probe = await probeVideo(inputPath, options.ffprobePath);
    const timeoutMs = Math.min(
      FFMPEG_MAX_TIMEOUT_MS,
      Math.max(
        FFMPEG_MIN_TIMEOUT_MS,
        (probe.durationMs ?? 60_000) * FFMPEG_TIMEOUT_FACTOR,
      ),
    );
    const produced: MediaVariant[] = [];

    if (options.step === 'poster') {
      const posterPath = join(directory, 'poster.jpg');
      await runFfmpeg(
        options.ffmpegPath,
        [
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
        ],
        timeoutMs,
      );
      const poster = await readFile(posterPath);
      const key = `social/posters/${options.assetId}.jpg`;
      await options.storage.put(key, poster, 'image/jpeg');
      produced.push({
        label: POSTER_LABEL,
        width: Math.min(POSTER_MAX_WIDTH, probe.width ?? POSTER_MAX_WIDTH),
        height: probe.height
          ? Math.round(
              (probe.height * Math.min(POSTER_MAX_WIDTH, probe.width ?? POSTER_MAX_WIDTH)) /
                (probe.width || 1),
            )
          : 0,
        url: options.storage.publicUrl(key) ?? key,
        key,
        sizeBytes: poster.length,
      });
    } else {
      const outputPath = join(directory, 'output.mp4');
      await runFfmpeg(
        options.ffmpegPath,
        [
          '-y',
          '-i',
          inputPath,
          '-vf',
          `scale='min(${VIDEO_MAX_WIDTH},iw)':-2`,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '23',
          '-pix_fmt',
          'yuv420p',
          '-g',
          String(VIDEO_GOP_FRAMES),
          '-keyint_min',
          String(VIDEO_GOP_FRAMES),
          '-sc_threshold',
          '0',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
          outputPath,
        ],
        timeoutMs,
      );
      const transcoded = await readFile(outputPath);
      const key = `social/videos/${options.assetId}.mp4`;
      await options.storage.put(key, transcoded, 'video/mp4');
      produced.push({
        label: TRANSCODED_LABEL,
        width: probe.width ? Math.min(VIDEO_MAX_WIDTH, probe.width) : 0,
        height: probe.height
          ? Math.round(
              (probe.height * Math.min(VIDEO_MAX_WIDTH, probe.width ?? VIDEO_MAX_WIDTH)) /
                (probe.width || 1),
            )
          : 0,
        url: options.storage.publicUrl(key) ?? key,
        key,
        sizeBytes: transcoded.length,
      });

      // Variante basse qualité : inutile si la source est déjà plus petite
      // que la cible — la variante principale suffit alors.
      const sourceWidth = Math.min(VIDEO_MAX_WIDTH, probe.width ?? VIDEO_MAX_WIDTH);
      if (probe.width && probe.width > VIDEO_LOW_MAX_WIDTH) {
        const lowPath = join(directory, 'output-low.mp4');
        await runFfmpeg(
          options.ffmpegPath,
          [
            '-y',
            '-i',
            inputPath,
            '-vf',
            `scale='min(${VIDEO_LOW_MAX_WIDTH},iw)':-2`,
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '30',
            '-pix_fmt',
            'yuv420p',
            '-g',
            String(VIDEO_GOP_FRAMES),
            '-keyint_min',
            String(VIDEO_GOP_FRAMES),
            '-sc_threshold',
            '0',
            '-c:a',
            'aac',
            '-b:a',
            '96k',
            '-movflags',
            '+faststart',
            lowPath,
          ],
          timeoutMs,
        );
        const low = await readFile(lowPath);
        const lowKey = `social/videos/${options.assetId}-low.mp4`;
        await options.storage.put(lowKey, low, 'video/mp4');
        produced.push({
          label: TRANSCODED_LOW_LABEL,
          width: VIDEO_LOW_MAX_WIDTH,
          height: probe.height
            ? Math.round((probe.height * VIDEO_LOW_MAX_WIDTH) / sourceWidth)
            : 0,
          url: options.storage.publicUrl(lowKey) ?? lowKey,
          key: lowKey,
          sizeBytes: low.length,
        });
      }
    }

    return {
      variants: produced,
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
  const output = await run(
    ffprobePath,
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      path,
    ],
    FFMPEG_MIN_TIMEOUT_MS,
  );
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

function runFfmpeg(ffmpegPath: string, args: string[], timeoutMs: number): Promise<void> {
  return run(ffmpegPath, args, timeoutMs).then(() => undefined);
}

/** Exécute un binaire et rend sa sortie standard ; rejette avec stderr. */
function run(binary: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`${binary} a dépassé ${timeoutMs} ms.`));
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`${binary} a échoué (code ${code}) : ${stderr.slice(-500)}`));
    });
  });
}
