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
 * Point d'extraction du poster, en secondes. La frame 0 est souvent noire
 * (fondu d'ouverture) : on vise un dixième de la durée, borné pour rester près
 * du début, et on saute le noir initial détecté par `blackdetect`.
 */
const POSTER_SEEK_FRACTION = 0.1;
const POSTER_MAX_SEEK_S = 5;
const POSTER_MIN_SEEK_S = 0.25;
/** Marge au-delà de la fin du noir initial pour ne pas retomber dans le fondu. */
const POSTER_BLACK_MARGIN_S = 0.5;
/** Borne haute relative à la durée : ne jamais viser la fin d'un clip court. */
const POSTER_END_FRACTION = 0.9;

/**
 * Choisit le point d'extraction du poster : légèrement entré dans la vidéo,
 * au-delà du fondu noir initial s'il est détecté, sans dépasser la fin.
 * Fonction pure (testable sans ffmpeg) ; `initialBlackEndS` vient de
 * `detectInitialBlackEnd`, `null` si aucun noir initial n'a été détecté.
 */
export function computePosterSeekSeconds(
  durationS: number,
  initialBlackEndS: number | null,
): number {
  let seek = Math.min(
    POSTER_MAX_SEEK_S,
    Math.max(POSTER_MIN_SEEK_S, durationS * POSTER_SEEK_FRACTION),
  );
  if (initialBlackEndS !== null) {
    seek = Math.max(seek, initialBlackEndS + POSTER_BLACK_MARGIN_S);
  }
  if (durationS > 0) {
    seek = Math.min(seek, durationS * POSTER_END_FRACTION);
  }
  return Math.max(0, seek);
}
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
  // GIF / WebP animés : toutes les images sont conservées (`animated`), la
  // variante reste une WebP animée que l'app lit en boucle, comme Instagram.
  const probeMeta = await sharp(original).metadata();
  const animated = (probeMeta.pages ?? 1) > 1;
  const metadata = probeMeta;
  // Dimensions **affichées** : une photo prise en portrait au téléphone est
  // souvent stockée en paysage avec une orientation EXIF de 5 à 8 (rotation
  // de 90°). Les variantes sont tournées (`.rotate()`), les dimensions
  // annoncées au fil doivent l'être aussi, sinon le cadre est faux.
  const [sourceWidth, sourceHeight] = displayedImageSize(
    metadata.width ?? null,
    // Animation : `height` additionne toutes les images, `pageHeight` en donne une.
    (animated ? metadata.pageHeight : metadata.height) ?? null,
    metadata.orientation,
  );

  const produced: MediaVariant[] = [];
  for (const target of IMAGE_VARIANTS) {
    const width = sourceWidth ? Math.min(target.width, sourceWidth) : target.width;
    const buffer = await sharp(original, animated ? { animated: true } : undefined)
      .rotate() // applique l'orientation EXIF avant de la supprimer
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY, ...(animated ? { loop: 0, effort: 2 } : {}) })
      .toBuffer({ resolveWithObject: true });
    const key = `social/variants/${options.assetId}/${target.label}.webp`;
    await options.storage.put(key, buffer.data, 'image/webp');
    produced.push({
      label: target.label,
      width: buffer.info.width,
      // Animation : hauteur d'une image, pas de la pile.
      height: animated ? (buffer.info.pageHeight ?? buffer.info.height) : buffer.info.height,
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
      // La frame 0 est souvent noire (fondu d'ouverture) : on extrait un peu
      // plus loin, au-delà du noir initial s'il est détecté, pour une vignette
      // exploitable plutôt qu'un aplat noir.
      const initialBlackEnd = await detectInitialBlackEnd(
        inputPath,
        options.ffmpegPath,
        probe.durationMs,
        timeoutMs,
      );
      const seekS = computePosterSeekSeconds((probe.durationMs ?? 0) / 1000, initialBlackEnd);
      await runFfmpeg(
        options.ffmpegPath,
        [
          '-y',
          '-ss',
          String(seekS),
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

/**
 * Largeur et hauteur telles qu'affichées, après l'orientation EXIF : les
 * orientations 5 à 8 font pivoter l'image d'un quart de tour.
 */
export function displayedImageSize(
  width: number | null,
  height: number | null,
  orientation: number | undefined,
): [number | null, number | null] {
  return orientation !== undefined && orientation >= 5 && orientation <= 8
    ? [height, width]
    : [width, height];
}

/**
 * Rotation d'un flux vidéo en degrés : tag `rotate` (anciens fichiers) ou
 * matrice d'affichage (`side_data_list`, iPhone et Android récents).
 */
export function videoRotation(stream: {
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number | string }>;
}): number {
  const fromSideData = stream.side_data_list?.find((entry) => entry.rotation !== undefined);
  const raw = fromSideData?.rotation ?? stream.tags?.rotate ?? 0;
  const degrees = Number(raw);
  return Number.isFinite(degrees) ? ((Math.round(degrees) % 360) + 360) % 360 : 0;
}

async function probeVideo(
  path: string,
  ffprobePath: string,
): Promise<{ width: number | null; height: number | null; durationMs: number | null }> {
  const { stdout: output } = await run(
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
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      tags?: { rotate?: string };
      side_data_list?: Array<{ rotation?: number | string }>;
    }>;
    format?: { duration?: string };
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
  const seconds = Number(parsed.format?.duration ?? Number.NaN);
  // Une vidéo verticale filmée au téléphone est souvent codée en 1920×1080
  // avec une rotation de 90° : ffmpeg la redresse à l'encodage (autorotate),
  // les dimensions annoncées doivent donc être celles affichées.
  const quarterTurn = video ? videoRotation(video) % 180 === 90 : false;
  const width = video?.width ?? null;
  const height = video?.height ?? null;
  return {
    width: quarterTurn ? height : width,
    height: quarterTurn ? width : height,
    durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
  };
}

/**
 * Détecte la fin du noir initial (fondu d'ouverture) via `blackdetect`.
 *
 * N'analyse que les premières secondes : seul le noir qui ouvre la vidéo compte
 * pour le poster. Renvoie `null` si la vidéo ne commence pas par du noir (ou si
 * la détection échoue — le poster retombe alors sur le point d'extraction usuel).
 */
async function detectInitialBlackEnd(
  path: string,
  ffmpegPath: string,
  durationMs: number | null,
  timeoutMs: number,
): Promise<number | null> {
  const analyzeS = Math.min((durationMs ?? 10_000) / 1000, 10);
  try {
    const { stderr } = await run(
      ffmpegPath,
      [
        '-hide_banner',
        '-t',
        String(analyzeS),
        '-i',
        path,
        '-vf',
        'blackdetect=d=0.1:pix_th=0.10',
        '-an',
        '-f',
        'null',
        '-',
      ],
      timeoutMs,
    );
    const match = stderr.match(/black_start:0(?:\.0+)?\s+black_end:([0-9.]+)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function runFfmpeg(ffmpegPath: string, args: string[], timeoutMs: number): Promise<void> {
  return run(ffmpegPath, args, timeoutMs).then(() => undefined);
}

/** Exécute un binaire et rend ses sorties ; rejette avec stderr. */
function run(
  binary: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
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
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${binary} a échoué (code ${code}) : ${stderr.slice(-500)}`));
    });
  });
}
