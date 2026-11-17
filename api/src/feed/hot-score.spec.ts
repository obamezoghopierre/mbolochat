import { describe, expect, it } from 'vitest';

import { computeHotScore, HOT_SCORE_MAX } from './hot-score.js';

const NOW = new Date('2026-11-16T12:00:00.000Z');
const counts = { likes: 0, comments: 0, reposts: 0, saves: 0 };

describe('computeHotScore', () => {
  it('amortit un même engagement avec l’âge', () => {
    const fresh = computeHotScore({ ...counts, likes: 100 }, NOW, NOW);
    const day = computeHotScore({ ...counts, likes: 100 }, new Date(NOW.getTime() - 86_400_000), NOW);
    const week = computeHotScore({ ...counts, likes: 100 }, new Date(NOW.getTime() - 604_800_000), NOW);
    expect(fresh).toBeGreaterThan(day);
    expect(day).toBeGreaterThan(week);
    expect(week).toBeGreaterThan(0);
  });

  it('donne un score non nul à une publication neuve sans interaction', () => {
    expect(computeHotScore(counts, NOW, NOW)).toBeGreaterThan(0);
  });

  it('compte la portée (vues) sans écraser l’engagement', () => {
    const withViews = computeHotScore({ ...counts, views: 1_000 }, NOW, NOW);
    const withLikes = computeHotScore({ ...counts, likes: 1_000 }, NOW, NOW);
    expect(withViews).toBeGreaterThan(computeHotScore(counts, NOW, NOW));
    expect(withLikes).toBeGreaterThan(withViews);
  });

  it('ne dépasse jamais la borne de la colonne integer', () => {
    const viral = computeHotScore(
      { likes: 50_000_000, comments: 10_000_000, reposts: 5_000_000, saves: 20_000_000, views: 900_000_000 },
      NOW,
      NOW,
    );
    expect(viral).toBe(HOT_SCORE_MAX);
    expect(viral).toBeLessThanOrEqual(2_147_483_647);
  });

  it('traite une horodatage futur comme un âge nul', () => {
    const future = new Date(NOW.getTime() + 86_400_000);
    expect(computeHotScore({ ...counts, likes: 10 }, future, NOW)).toBe(
      computeHotScore({ ...counts, likes: 10 }, NOW, NOW),
    );
  });
});
