import { afterEach, describe, expect, it } from 'vitest';

import { readFeedMuted, writeFeedMuted } from './sound-preference';

describe('préférence de son du feed', () => {
  afterEach(() => {
    // Mémoire de module : on la remet à son état par défaut entre deux tests.
    writeFeedMuted(false);
  });

  it('démarre avec le son, comme les Reels d’Instagram', () => {
    expect(readFeedMuted()).toBe(false);
  });

  it('garde le son coupé d’un pager à l’autre', () => {
    writeFeedMuted(true);

    // Un second pager (Reel ouvert depuis une carte, remontage de l’onglet)
    // relit la même valeur au lieu de repartir avec du son.
    expect(readFeedMuted()).toBe(true);
  });

  it('remet le son quand l’utilisateur le réactive', () => {
    writeFeedMuted(true);
    writeFeedMuted(false);

    expect(readFeedMuted()).toBe(false);
  });
});
