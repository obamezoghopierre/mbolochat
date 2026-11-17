/**
 * Décisions de montage du pager, extraites pour être testables sans rendu.
 *
 * Règle de sûreté : une seule `VideoView` existe à un instant donné — celle de
 * la page active. Les voisines n'ont pas de vue native : soit leur poster, soit
 * un lecteur détaché qui ne fait que remplir le cache disque. Un lecteur n'est
 * donc jamais rattaché à deux vues, et la prop `player` d'une vue montée ne
 * change jamais (cause de l'IllegalStateException de `TextureVideoView`).
 */

/** Ce que le pager monte pour la vidéo d'une page. */
export type VideoPageMode = 'play' | 'prefetch' | 'poster';

/** La page joue-t-elle ? Visible, et écran au premier plan. */
export function isPageActive(
  index: number,
  activeIndex: number,
  playbackActive: boolean,
): boolean {
  return index === activeIndex && playbackActive;
}

/**
 * Mode de rendu vidéo pour une page située à `distance` de la page active.
 *
 * - page active : seule à posséder une `VideoView`, elle joue ;
 * - voisine immédiate : lecteur détaché (aucune vue) si le préchargement est
 *   autorisé, poster sinon ;
 * - au-delà : poster seul.
 */
export function videoPageMode(distance: number, allowPrefetch: boolean): VideoPageMode {
  const absolute = Math.abs(distance);
  if (absolute === 0) {
    return 'play';
  }
  if (absolute === 1 && allowPrefetch) {
    return 'prefetch';
  }
  return 'poster';
}
