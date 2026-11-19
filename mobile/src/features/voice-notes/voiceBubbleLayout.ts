/**
 * Géométrie de la bulle vocale.
 *
 * Ces règles sont pures pour être testées hors rendu : largeur de la bulle
 * proportionnelle à la durée, place réservée à droite de l’onde (durée,
 * transcription, vitesse) et nombre de barres qui tiennent dans l’intervalle.
 * Le composant `VoiceMessageBubble` ne fait que les appliquer, avec les
 * métriques du design system fournies à l’appel.
 *
 * Disposition, sur une seule ligne :
 * `[lecture] [onde] [Aa ?] [durée  1x]`
 */

/** Durée maximale d'un vocal, alignée sur l'enregistreur (`MAX_DURATION_MS`). */
const VOICE_MAX_DURATION_MS = 60_000;

/** Largeur minimale laissée à l'onde, même sur un vocal très court. */
const MIN_WAVE_WIDTH = 40;

/** Métriques de la bulle vocale, dérivées de `ChatMetrics`. */
export interface VoiceLayoutMetrics {
  /** Marge interne gauche et droite de la bulle. */
  bubblePaddingH: number;
  /** Largeur du bouton de lecture. */
  playSize: number;
  /** Largeur d’une pastille (durée, « Aa », vitesse). */
  controlWidth: number;
  /** Écart horizontal entre deux blocs de la ligne. */
  controlGap: number;
  /** Écart resserré entre la durée et la vitesse, qui forment un seul bloc. */
  chipGap: number;
  /** Largeur fixe réservée à la durée. */
  durationMinWidth: number;
  barWidth: number;
  barGap: number;
}

/** Largeur proportionnelle à la durée, bornée. */
export function voiceBubbleWidth(durationMs: number, screenW: number): number {
  const minW = 120;
  const maxW = Math.min(screenW * 0.72, 320);
  const ratio = Math.sqrt(Math.min(1, durationMs / VOICE_MAX_DURATION_MS));
  return Math.round(minW + (maxW - minW) * ratio);
}

/**
 * Somme des éléments posés à droite de l’onde : le bloc « durée + vitesse »,
 * puis « Aa » quand la transcription est disponible.
 */
export function voiceTrailingWidth(
  metrics: VoiceLayoutMetrics,
  speedControl: boolean,
  transcribable: boolean,
): number {
  const cluster =
    metrics.durationMinWidth +
    (speedControl ? metrics.chipGap + metrics.controlWidth : 0);
  const transcribe = transcribable
    ? metrics.controlGap + metrics.controlWidth
    : 0;
  return metrics.controlGap + transcribe + cluster;
}

/**
 * Largeur minimale pour que la ligne tienne sans écraser l’onde : lecture,
 * onde, contrôles et marges internes. Les pastilles ne doivent jamais rogner
 * la forme d’onde jusqu’à la faire disparaître.
 */
export function voiceBubbleMinWidth(
  metrics: VoiceLayoutMetrics,
  speedControl: boolean,
  transcribable: boolean,
): number {
  return Math.round(
    metrics.bubblePaddingH * 2 +
      metrics.playSize +
      metrics.controlGap +
      MIN_WAVE_WIDTH +
      voiceTrailingWidth(metrics, speedControl, transcribable),
  );
}

/** Nombre de barres qui tiennent dans la largeur réelle de la bulle, jamais moins de six. */
export function voiceBarCount(
  metrics: VoiceLayoutMetrics,
  bubbleWidth: number,
  trailingWidth: number,
): number {
  const available =
    bubbleWidth -
    metrics.bubblePaddingH * 2 -
    metrics.playSize -
    metrics.controlGap -
    trailingWidth;
  const slots = Math.floor((available + metrics.barGap) / (metrics.barWidth + metrics.barGap));
  return Math.max(6, slots);
}

/** Largeur réelle de la bulle : la durée, sans jamais écraser l’onde. */
export function voiceBubbleLayoutWidth(
  metrics: VoiceLayoutMetrics,
  durationMs: number,
  screenW: number,
  speedControl: boolean,
  transcribable: boolean,
): number {
  return Math.max(
    voiceBubbleWidth(durationMs, screenW),
    voiceBubbleMinWidth(metrics, speedControl, transcribable),
  );
}
