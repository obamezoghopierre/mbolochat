export interface PendingMediaShare {
  /** Fichier local déjà téléchargé (file://). */
  uri: string;
  mime: string | null;
}

let pending: PendingMediaShare | null = null;

/** Transfert ponctuel d'un média vers l'écran de conversation qui va le consommer. */
export function setPendingMediaShare(share: PendingMediaShare | null): void {
  pending = share;
}

export function consumePendingMediaShare(): PendingMediaShare | null {
  const value = pending;
  pending = null;
  return value;
}
