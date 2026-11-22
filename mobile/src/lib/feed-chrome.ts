import { makeMutable, withTiming } from 'react-native-reanimated';

/**
 * Barres du fil (haut et bas) masquées au défilement, comme Instagram,
 * Facebook ou X : elles glissent hors de l'écran quand on descend dans le
 * fil et reviennent dès qu'on remonte un peu.
 *
 * Une seule valeur partagée, lue sur le thread UI par la barre du haut (fil)
 * et la barre d'onglets du bas : 0 = visibles, 1 = masquées. Aucune des deux
 * ne se re-rend pendant le défilement.
 */
export const feedChromeHidden = makeMutable(0);

/** Durée du glissement des barres. */
const CHROME_SLIDE_MS = 200;
/** Déplacement minimal (px) avant de basculer : ignore les micro-mouvements. */
const DIRECTION_THRESHOLD = 8;
/** Près du haut du fil, les barres restent toujours visibles. */
const TOP_ZONE = 24;

let hidden = false;
let lastOffset = 0;
/** Point de départ du mouvement en cours dans une même direction. */
let anchor = 0;

function apply(next: boolean): void {
  if (next === hidden) {
    return;
  }
  hidden = next;
  feedChromeHidden.value = withTiming(next ? 1 : 0, { duration: CHROME_SLIDE_MS });
}

/** Ré-affiche les barres (changement d'onglet, Reels, commentaires…). */
export function showFeedChrome(): void {
  apply(false);
}

/** Repart de zéro, par exemple quand une autre liste prend la main. */
export function resetFeedChromeTracking(offset = 0): void {
  lastOffset = offset;
  anchor = offset;
}

/**
 * À appeler à chaque événement de défilement du fil libre. Descendre dans le
 * fil (doigt vers le haut) masque les barres ; remonter, même un peu, les
 * ré-affiche.
 */
export function trackFeedScroll(offset: number): void {
  if (offset <= TOP_ZONE) {
    anchor = offset;
    lastOffset = offset;
    apply(false);
    return;
  }
  const goingDown = offset > lastOffset;
  const wasGoingDown = lastOffset > anchor;
  // Changement de direction : le mouvement repart de la position actuelle.
  if (goingDown !== wasGoingDown) {
    anchor = lastOffset;
  }
  lastOffset = offset;
  const travelled = offset - anchor;
  if (travelled > DIRECTION_THRESHOLD) {
    apply(true);
  } else if (travelled < -DIRECTION_THRESHOLD) {
    apply(false);
  }
}
