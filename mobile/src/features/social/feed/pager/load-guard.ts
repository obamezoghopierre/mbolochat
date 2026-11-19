import type { VideoPlayerStatus } from 'expo-video';

/**
 * Garde-fou de lecture du fil vidéo.
 *
 * Un flux peut rester indéfiniment en `loading` sans jamais produire d'image :
 * décodeur bloqué, serveur muet, cache disque incohérent. Sans garde-fou, le
 * poster reste affiché et l'utilisateur n'a aucun moyen d'agir — constaté avec
 * un décodeur H.264 qui ne rendait aucune frame alors que les octets étaient
 * bien téléchargés.
 */

/** Délai au-delà duquel un chargement sans image est considéré comme bloqué. */
export const VIDEO_STALL_TIMEOUT_MS = 12_000;

/** Identité d'une tentative de chargement : source + numéro d'essai. */
export function loadKeyFor(url: string | null, attempt: number): string {
  return `${url ?? 'sans-source'}#${attempt}`;
}

/**
 * Le chargement en cours est-il bloqué ?
 *
 * Comparer la clé mémorisée à la clé courante suffit à réarmer le garde-fou :
 * une nouvelle source ou une reprise change l'identité de la tentative.
 */
export function isLoadStalled(
  status: VideoPlayerStatus,
  stalledKey: string | null,
  loadKey: string,
): boolean {
  return status === 'loading' && stalledKey === loadKey;
}

/**
 * Faut-il montrer l'indicateur du premier chargement ?
 *
 * Le poster sert de fond, mais il ne dit pas si quelque chose progresse : ce
 * témoin couvre le temps avant la première image, jamais le rebuffering (la
 * barre de progression s'en charge alors).
 */
export function showsInitialSpinner(
  status: VideoPlayerStatus,
  firstFrameDrawn: boolean,
  stalled: boolean,
): boolean {
  return status === 'loading' && !firstFrameDrawn && !stalled;
}
