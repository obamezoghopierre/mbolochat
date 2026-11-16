import { detectImageKind } from '../common/image-signature.js';

/** Types acceptés à l'upload social. Volontairement court pour la v1. */
export type SocialMediaKind = 'image' | 'video';

export const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/webm'] as const;

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
