import { detectImageKind } from '../common/image-signature.js';

/** Types acceptés à l'upload social. Volontairement court pour la v1. */
export type SocialMediaKind = 'image' | 'video' | 'audio';

export const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/webm'] as const;
/** Commentaires vocaux : m4a/mp4, mp3, aac, ogg/opus, wav. */
export const ALLOWED_AUDIO_MIMES = [
  'audio/mp4',
  'audio/x-m4a',
  'audio/mpeg',
  'audio/aac',
  'audio/ogg',
  'audio/wav',
] as const;

export interface DetectedMedia {
  kind: SocialMediaKind;
  mime: string;
}

const MP4_BRAND_OFFSET = 4;
const EBML_SIGNATURE = [0x1a, 0x45, 0xdf, 0xa3];

function startsWith(buffer: Buffer, signature: readonly number[], offset = 0): boolean {
  if (buffer.length < offset + signature.length) return false;
  return signature.every((byte, index) => buffer[offset + index] === byte);
}

/**
 * Détecte la nature réelle d'un média à partir de ses premiers octets.
 *
 * Le MIME déclaré par le client ne sert qu'à choisir les bornes : c'est cette
 * détection qui décide si le fichier est accepté et quel type lui est attribué.
 * On ne décode jamais le contenu (pas de décodeur natif côté serveur).
 */
export function detectSocialMedia(head: Buffer): DetectedMedia | null {
  const image = detectImageKind(head);
  if (image) {
    return { kind: 'image', mime: `image/${image.kind}` };
  }
  // MP4 : boîte « ftyp » à l'offset 4.
  if (head.length >= 8 && startsWith(head, [0x66, 0x74, 0x79, 0x70], MP4_BRAND_OFFSET)) {
    return { kind: 'video', mime: 'video/mp4' };
  }
  // WebM/Matroska : signature EBML.
  if (startsWith(head, EBML_SIGNATURE)) {
    return { kind: 'video', mime: 'video/webm' };
  }
  return null;
}

/**
 * Détecte un conteneur audio. Un `.m4a` partage la boîte `ftyp` avec la
 * vidéo MP4 : pour `kind: 'audio'` on accepte `ftyp` comme `audio/mp4` —
 * le pire cas est un MP4 vidéo mal étiqueté, qui ne se lira simplement pas.
 */
export function detectAudioMedia(head: Buffer): string | null {
  // MP3 : balise ID3 ou trame sync 0xFF 0xFB/F3/F2.
  if (startsWith(head, [0x49, 0x44, 0x33]) || (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) {
    return 'audio/mpeg';
  }
  // Ogg (Vorbis/Opus).
  if (startsWith(head, [0x4f, 0x67, 0x67, 0x53])) {
    return 'audio/ogg';
  }
  // WAV : RIFF....WAVE.
  if (
    head.length >= 12 &&
    startsWith(head, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(head, [0x57, 0x41, 0x56, 0x45], 8)
  ) {
    return 'audio/wav';
  }
  // ADTS AAC : trame sync 0xFF 0xF1/F9.
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xf6) === 0xf0) {
    return 'audio/aac';
  }
  // MP4/M4A : boîte « ftyp » à l'offset 4.
  if (head.length >= 8 && startsWith(head, [0x66, 0x74, 0x79, 0x70], MP4_BRAND_OFFSET)) {
    return 'audio/mp4';
  }
  return null;
}

/** Les alias courants d'un même codec sont ramenés à un MIME canonique. */
export function canonicalAudioMime(mime: string): string {
  if (mime === 'audio/x-m4a') return 'audio/mp4';
  return mime;
}
