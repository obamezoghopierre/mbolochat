import type { PickedAttachment } from '@/features/media/pickMedia';

/**
 * Transfert ponctuel entre les écrans de création : la caméra et la galerie
 * déposent les médias choisis (et le filtre courant), l'écran de publication
 * les consomme une fois. Même pattern que `pending-post-share`.
 */
export interface PendingCreation {
  assets: PickedAttachment[];
  /** Clé de `MEDIA_FILTERS`, `null` = rendu brut. */
  filter: string | null;
}

let pending: PendingCreation | null = null;

export function setPendingCreation(creation: PendingCreation | null): void {
  pending = creation;
}

export function consumePendingCreation(): PendingCreation | null {
  const value = pending;
  pending = null;
  return value;
}
