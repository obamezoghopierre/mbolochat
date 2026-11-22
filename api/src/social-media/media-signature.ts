import { detectImageKind } from '../common/image-signature.js';

/** Types acceptés à l'upload social. */
export type SocialMediaKind = 'image' | 'video' | 'audio';

/**
 * Formats acceptés, comme Instagram / TikTok / Facebook : tout ce qu'un
 * téléphone produit. Le worker convertit ensuite (images → WebP, vidéos →
 * MP4 H.264), le fil ne voit donc jamais que des formats universels.
 */
export const ALLOWED_IMAGE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
  'image/gif',
] as const;
export const ALLOWED_VIDEO_MIMES = [
  'video/mp4',
  'video/quicktime',
  'video/x-m4v',
  'video/3gpp',
  'video/3gpp2',
  'video/webm',
  'video/x-matroska',
] as const;
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
  // GIF87a / GIF89a.
  if (startsWith(head, [0x47, 0x49, 0x46, 0x38])) {
    return { kind: 'image', mime: 'image/gif' };
  }
  // Famille ISO-BMFF (boîte « ftyp ») : la marque distingue photo et vidéo.
  if (head.length >= 12 && startsWith(head, [0x66, 0x74, 0x79, 0x70], MP4_BRAND_OFFSET)) {
    const brand = head.subarray(8, 12).toString('latin1');
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx'].includes(brand)) {
      return { kind: 'image', mime: 'image/heic' };
    }
    if (['mif1', 'msf1'].includes(brand)) {
      return { kind: 'image', mime: 'image/heif' };
    }
    if (['avif', 'avis'].includes(brand)) {
      return { kind: 'image', mime: 'image/avif' };
    }
    if (brand === 'qt  ') {
      return { kind: 'video', mime: 'video/quicktime' };
    }
    if (brand.startsWith('3g2')) {
      return { kind: 'video', mime: 'video/3gpp2' };
    }
    if (brand.startsWith('3gp')) {
      return { kind: 'video', mime: 'video/3gpp' };
    }
    if (brand === 'M4V ' || brand === 'M4VH' || brand === 'M4VP') {
      return { kind: 'video', mime: 'video/x-m4v' };
    }
    return { kind: 'video', mime: 'video/mp4' };
  }
  // Anciens QuickTime sans « ftyp » : premier atome « moov », « mdat », « wide » ou « free ».
  if (head.length >= 8) {
    const atom = head.subarray(4, 8).toString('latin1');
    if (['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(atom)) {
      return { kind: 'video', mime: 'video/quicktime' };
    }
  }
  // WebM/Matroska : signature EBML (le type exact n'est lisible que plus loin).
  if (startsWith(head, EBML_SIGNATURE)) {
    return { kind: 'video', mime: 'video/webm' };
  }
  return null;
}

/**
 * Le fichier réel est-il acceptable pour le type de média demandé ?
 *
 * On ne compare plus au MIME annoncé : une galerie (Android, Waydroid…)
 * étiquette souvent mal un fichier (« .PNG » qui est un JPEG, « .mov » d'un
 * iPhone…). Ce sont les octets qui font foi ; le type stocké devient celui
 * détecté, jamais celui déclaré. Un contenu d'une autre famille (HTML, SVG,
 * exécutable, image envoyée comme vidéo) reste refusé.
 */
export function acceptDetected(
  kind: Exclude<SocialMediaKind, 'audio'>,
  detected: DetectedMedia | null,
): DetectedMedia | null {
  if (!detected || detected.kind !== kind) {
    return null;
  }
  const allowed: readonly string[] = kind === 'image' ? ALLOWED_IMAGE_MIMES : ALLOWED_VIDEO_MIMES;
  return allowed.includes(detected.mime) ? detected : null;
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
