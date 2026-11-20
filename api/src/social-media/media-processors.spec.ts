import { describe, expect, it } from 'vitest';

import { computePosterSeekSeconds } from './media-processors.js';

/**
 * Le poster ne doit pas être la frame 0 : beaucoup de vidéos s'ouvrent sur un
 * fondu depuis le noir, et la frame 0 est alors noire (vignette inexploitable).
 * On choisit un point d'extraction légèrement entré dans la vidéo, en sautant
 * le noir initial détecté, sans jamais dépasser la fin d'un clip court.
 */
describe('computePosterSeekSeconds', () => {
  it('vise un dixième de la durée, plafonné pour rester près du début', () => {
    // 52 s → 10 % = 5,2 s, plafonné à 5 s.
    expect(computePosterSeekSeconds(52, null)).toBeCloseTo(5, 5);
    // 20 s → 10 % = 2 s.
    expect(computePosterSeekSeconds(20, null)).toBeCloseTo(2, 5);
  });

  it('ne descend pas sous un plancher pour les clips très courts', () => {
    // 1 s → 10 % = 0,1 s, mais plancher 0,25 s (sous 90 % de 1 s).
    expect(computePosterSeekSeconds(1, null)).toBeCloseTo(0.25, 5);
  });

  it('saute le fondu noir initial détecté', () => {
    // Clip de 4 s dont le noir dure 1,5 s : le point de base (0,4 s) est noir,
    // on vise donc au-delà du noir (1,5 + 0,5 = 2 s).
    expect(computePosterSeekSeconds(4, 1.5)).toBeCloseTo(2, 5);
  });

  it('garde le point le plus tardif quand le noir est court', () => {
    // 52 s, noir jusqu'à 1,2 s : 10 % (5 s) est déjà au-delà du noir + marge.
    expect(computePosterSeekSeconds(52, 1.2)).toBeCloseTo(5, 5);
  });

  it('ne dépasse jamais la fin d’un clip court', () => {
    // 2 s avec un noir de 1,9 s : noir + marge = 2,4 s > durée, on borne à 90 %.
    expect(computePosterSeekSeconds(2, 1.9)).toBeCloseTo(1.8, 5);
  });

  it('reste positif et borné même sans durée connue', () => {
    const seek = computePosterSeekSeconds(0, null);
    expect(seek).toBeGreaterThanOrEqual(0);
    expect(seek).toBeLessThanOrEqual(5);
  });
});