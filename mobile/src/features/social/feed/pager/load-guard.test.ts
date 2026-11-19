import { describe, expect, it } from 'vitest';

import {
  isLoadStalled,
  loadKeyFor,
  showsInitialSpinner,
  VIDEO_STALL_TIMEOUT_MS,
} from './load-guard';

describe('loadKeyFor', () => {
  it('change d’identité à chaque tentative et à chaque source', () => {
    expect(loadKeyFor('a', 0)).not.toBe(loadKeyFor('a', 1));
    expect(loadKeyFor('a', 0)).not.toBe(loadKeyFor('b', 0));
    expect(loadKeyFor('a', 0)).toBe(loadKeyFor('a', 0));
  });

  it('reste stable sans source', () => {
    expect(loadKeyFor(null, 2)).toBe(loadKeyFor(null, 2));
  });
});

describe('isLoadStalled', () => {
  const key = loadKeyFor('a', 0);

  it('signale un chargement bloqué une fois le délai écoulé', () => {
    expect(isLoadStalled('loading', key, key)).toBe(true);
  });

  it('ignore une tentative plus récente', () => {
    expect(isLoadStalled('loading', key, loadKeyFor('a', 1))).toBe(false);
  });

  it('ne signale rien quand la lecture a démarré ou échoué', () => {
    expect(isLoadStalled('readyToPlay', key, key)).toBe(false);
    expect(isLoadStalled('idle', key, key)).toBe(false);
    expect(isLoadStalled('error', key, key)).toBe(false);
  });

  it('laisse le temps de charger avant de conclure', () => {
    expect(VIDEO_STALL_TIMEOUT_MS).toBeGreaterThan(5_000);
  });
});

describe('showsInitialSpinner', () => {
  it('couvre l’attente de la première image', () => {
    expect(showsInitialSpinner('loading', false, false)).toBe(true);
  });

  it('s’efface dès la première image ou quand le chargement est bloqué', () => {
    expect(showsInitialSpinner('loading', true, false)).toBe(false);
    expect(showsInitialSpinner('loading', false, true)).toBe(false);
  });

  it('ne s’affiche pas hors chargement', () => {
    expect(showsInitialSpinner('readyToPlay', false, false)).toBe(false);
  });
});
