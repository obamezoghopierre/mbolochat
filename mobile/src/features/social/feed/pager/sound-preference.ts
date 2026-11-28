/**
 * Préférence de son du feed, partagée par tous les pagers.
 *
 * Chaque `FeedPager` (onglet Reels, Reels ouverts depuis une carte, visionneuse
 * de la grille) gardait son propre état : couper le son dans l'onglet puis
 * ouvrir un Reel depuis une carte le remettait à plein volume, et un simple
 * remontage repartait avec du son. La préférence vit donc en mémoire de module,
 * comme les positions de lecture — elle survit au démontage, sans store.
 *
 * Défaut à `false` : comme sur Instagram, les Reels démarrent avec le son
 * (le silencieux de l'appareil reste maître, c'est le système qui le gère).
 */
let feedMuted = false;

export function readFeedMuted(): boolean {
  return feedMuted;
}

export function writeFeedMuted(muted: boolean): void {
  feedMuted = muted;
}
