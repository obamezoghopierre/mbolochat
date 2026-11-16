export const VOICE_SPEEDS = [1, 1.5, 2] as const;
export type VoiceSpeed = (typeof VOICE_SPEEDS)[number];

/**
 * Vitesse de lecture des notes vocales.
 *
 * La vitesse est volontairement **locale à chaque bulle** : le module ne garde
 * aucun état partagé et ne persiste rien. Changer « 1x » sur un message ne doit
 * ni toucher les autres bulles ni rejouer une préférence sur une note ancienne.
 * Le lecteur natif, lui, est unique (`voicePlayback.ts`) : chaque note démarre
 * à 1x et reçoit la vitesse de sa propre pastille.
 */

const STORAGE_KEY = 'mbolo.voice.playback-speed.v1';

/** Vitesse de démarrage de toute note vocale. */
export const DEFAULT_VOICE_SPEED: VoiceSpeed = 1;

function isVoiceSpeed(value: unknown): value is VoiceSpeed {
  return typeof value === 'number' && VOICE_SPEEDS.includes(value as VoiceSpeed);
}

/** Valeur normalisée ; toute valeur absente ou invalide retombe à 1x. */
export function parseVoiceSpeed(value: unknown): VoiceSpeed {
  if (isVoiceSpeed(value)) return value;
  if (typeof value !== 'string') return DEFAULT_VOICE_SPEED;
  const parsed = Number(value.trim().replace(',', '.'));
  return isVoiceSpeed(parsed) ? parsed : DEFAULT_VOICE_SPEED;
}

/** Vitesse suivante dans la boucle 1x → 1,5x → 2x → 1x. */
export function nextVoiceSpeed(speed: VoiceSpeed): VoiceSpeed {
  const index = VOICE_SPEEDS.indexOf(speed);
  return VOICE_SPEEDS[(index + 1) % VOICE_SPEEDS.length];
}

/**
 * Ancienne préférence globale (clé `mbolo.voice.playback-speed.v1`).
 * Conservée uniquement pour effacer la valeur laissée par les versions qui
 * partageaient la vitesse entre tous les messages.
 */
export const LEGACY_SPEED_STORAGE_KEY = STORAGE_KEY;
