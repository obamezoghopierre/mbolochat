import { describe, expect, it } from 'vitest';

import { isPageActive, videoPageMode } from './preload';

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
