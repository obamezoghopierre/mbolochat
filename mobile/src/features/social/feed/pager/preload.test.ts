import { describe, expect, it } from 'vitest';

import {
  isPageActive,
  planPrefetch,
  PREFETCH_POSTER_AHEAD,
  videoPageMode,
} from './preload';

describe('isPageActive', () => {
  it('n’active que la page visible quand l’écran est au premier plan', () => {
    expect(isPageActive(2, 2, true)).toBe(true);
    expect(isPageActive(1, 2, true)).toBe(false);
  });

  it('n’active rien quand l’écran est en arrière-plan', () => {
    expect(isPageActive(2, 2, false)).toBe(false);
  });
});

describe('videoPageMode', () => {
  it('ne donne une vue native qu’à la page active', () => {
    expect(videoPageMode(0, true)).toBe('play');
    expect(videoPageMode(0, false)).toBe('play');
  });

  it('précharge la voisine sans vue quand c’est autorisé', () => {
    expect(videoPageMode(1, true)).toBe('prefetch');
    expect(videoPageMode(-1, true)).toBe('prefetch');
  });

  it('se rabat sur le poster sans préchargement', () => {
    expect(videoPageMode(1, false)).toBe('poster');
    expect(videoPageMode(-1, false)).toBe('poster');
  });

  it('n’a jamais deux pages actives voisines', () => {
    const modes = [-2, -1, 0, 1, 2].map((distance) => videoPageMode(distance, true));
    expect(modes.filter((mode) => mode === 'play')).toHaveLength(1);
  });
});

describe('planPrefetch', () => {
  const allVideos = () => true;

  it('précharge deux vidéos en avance et la précédente sur Wi-Fi', () => {
    expect(planPrefetch(5, 20, 'unmetered', allVideos).videos).toEqual([
      { index: 6, low: false },
      { index: 7, low: false },
      { index: 4, low: false },
    ]);
  });

  it('ne précharge qu’une vidéo basse qualité sur réseau mobile', () => {
    expect(planPrefetch(5, 20, 'cellular', allVideos).videos).toEqual([
      { index: 6, low: true },
    ]);
  });

  it('ne précharge jamais la page active', () => {
    for (const network of ['unmetered', 'cellular'] as const) {
      const plan = planPrefetch(5, 20, network, allVideos);
      expect(plan.videos.some((target) => target.index === 5)).toBe(false);
      expect(plan.posters).not.toContain(5);
    }
  });

  it('précharge les posters plus loin que les vidéos, même sur réseau mobile', () => {
    const plan = planPrefetch(0, 20, 'cellular', allVideos);
    expect(plan.posters).toHaveLength(PREFETCH_POSTER_AHEAD);
    expect(plan.posters).toEqual([1, 2, 3, 4]);
  });

  it('respecte les bornes de la liste', () => {
    expect(planPrefetch(0, 20, 'unmetered', allVideos).videos).toEqual([
      { index: 1, low: false },
      { index: 2, low: false },
    ]);
    expect(planPrefetch(19, 20, 'unmetered', allVideos)).toEqual({
      videos: [{ index: 18, low: false }],
      posters: [],
    });
  });

  it('ignore les pages qui ne sont pas des vidéos', () => {
    const onlyEven = (index: number) => index % 2 === 0;
    const plan = planPrefetch(0, 10, 'unmetered', onlyEven);
    expect(plan.videos).toEqual([{ index: 2, low: false }]);
    expect(plan.posters).toEqual([2, 4]);
  });

  it('ne fait rien quand le préchargement est interdit ou la liste invalide', () => {
    const none = { videos: [], posters: [] };
    expect(planPrefetch(3, 20, 'unmetered', allVideos, false)).toEqual(none);
    expect(planPrefetch(0, 0, 'unmetered', allVideos)).toEqual(none);
    expect(planPrefetch(25, 20, 'unmetered', allVideos)).toEqual(none);
    expect(planPrefetch(-1, 20, 'unmetered', allVideos)).toEqual(none);
  });
});
