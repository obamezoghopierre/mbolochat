export interface PendingPostShare {
  publicationId: string;
}

let pending: PendingPostShare | null = null;

/** Transfert ponctuel d'une publication vers l'écran de conversation. */
export function setPendingPostShare(share: PendingPostShare | null): void {
  pending = share;
}

export function consumePendingPostShare(): PendingPostShare | null {
  const value = pending;
  pending = null;
  return value;
}
