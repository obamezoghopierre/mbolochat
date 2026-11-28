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


/** Contexte réseau du préchargement, déduit de `expo-network`. */
export type PrefetchNetwork = 'unmetered' | 'cellular';

/** Vidéos préchargées en avance sur réseau non facturé (Wi-Fi). */
export const PREFETCH_VIDEO_AHEAD_UNMETERED = 2;
/** Sur réseau mobile : une seule vidéo d'avance, en variante basse qualité. */
export const PREFETCH_VIDEO_AHEAD_CELLULAR = 1;
/** Page précédente : utile seulement pour un retour en arrière immédiat. */
export const PREFETCH_VIDEO_BEHIND = 1;
/** Posters (images légères) préchargés en avance, quel que soit le réseau. */
export const PREFETCH_POSTER_AHEAD = 4;

/** Une cible de préchargement : l'index dans la liste et la qualité voulue. */
export interface PrefetchTarget {
  index: number;
  /** `true` : variante basse qualité (`lowUrl`), pour limiter les données. */
  low: boolean;
}

/** Ce que le pager précharge autour de la page active. */
export interface PrefetchPlan {
  /** Vidéos à préchauffer sans `VideoView`, par ordre de priorité. */
  videos: PrefetchTarget[];
  /** Index dont le poster est à précharger (image légère). */
  posters: number[];
}

/**
 * Plan de préchargement autour de la page active, extrait pour être testable.
 *
 * - Wi-Fi : `PREFETCH_VIDEO_AHEAD_UNMETERED` vidéos en avance en qualité
 *   normale, plus la précédente pour un retour en arrière.
 * - Réseau mobile : **une** vidéo en avance, en variante basse qualité (le
 *   premier swipe est ce qui compte ; le reste coûterait des données), jamais
 *   la précédente.
 * - Les posters sont préchargés plus loin dans les deux cas : ils pèsent peu et
 *   suppriment l'écran noir pendant que la vidéo démarre.
 * - Seuls les index existants et vidéo (`isVideo`) sont retenus ; la page
 *   active en est exclue, elle a déjà son propre lecteur.
 * - `allowed` coupe tout (écran en arrière-plan, par exemple).
 */
export function planPrefetch(
  activeIndex: number,
  count: number,
  network: PrefetchNetwork,
  isVideo: (index: number) => boolean,
  allowed = true,
): PrefetchPlan {
  if (!allowed || count <= 0 || activeIndex < 0 || activeIndex >= count) {
    return { videos: [], posters: [] };
  }
  const cellular = network === 'cellular';
  const ahead = cellular ? PREFETCH_VIDEO_AHEAD_CELLULAR : PREFETCH_VIDEO_AHEAD_UNMETERED;
  const behind = cellular ? 0 : PREFETCH_VIDEO_BEHIND;
  const playable = (index: number) => index >= 0 && index < count && isVideo(index);

  const videos: PrefetchTarget[] = [];
  for (let step = 1; step <= ahead; step += 1) {
    if (playable(activeIndex + step)) {
      videos.push({ index: activeIndex + step, low: cellular });
    }
  }
  for (let step = 1; step <= behind; step += 1) {
    if (playable(activeIndex - step)) {
      videos.push({ index: activeIndex - step, low: cellular });
    }
  }

  const posters: number[] = [];
  for (let step = 1; step <= PREFETCH_POSTER_AHEAD; step += 1) {
    if (playable(activeIndex + step)) {
      posters.push(activeIndex + step);
    }
  }
  return { videos, posters };
}
