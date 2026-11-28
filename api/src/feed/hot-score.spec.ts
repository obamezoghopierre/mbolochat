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

  it('fait du partage le signal le plus fort', () => {
    const shared = computeHotScore({ ...counts, shares: 10 }, NOW, NOW);
    const liked = computeHotScore({ ...counts, likes: 10 }, NOW, NOW);
    expect(shared).toBeGreaterThan(liked);
  });

  it('classe un Reel regardé jusqu’au bout devant un Reel zappé', () => {
    const watched = computeHotScore(
      { ...counts, views: 100, completions: 60, watchSeconds: 100 * 12 },
      NOW,
      NOW,
    );
    const skipped = computeHotScore(
      { ...counts, views: 100, quickSkips: 80, watchSeconds: 100 * 1.5 },
      NOW,
      NOW,
    );
    expect(watched).toBeGreaterThan(skipped);
  });

  it('ne rend jamais l’engagement négatif à cause des swipes rapides', () => {
    const zapped = computeHotScore({ ...counts, quickSkips: 10_000 }, NOW, NOW);
    expect(zapped).toBe(computeHotScore(counts, NOW, NOW));
    expect(zapped).toBeGreaterThan(0);
  });

  it('compte le temps de visionnage sans écraser les likes', () => {
    const base = computeHotScore(counts, NOW, NOW);
    const watched = computeHotScore({ ...counts, watchSeconds: 30 }, NOW, NOW);
    const liked = computeHotScore({ ...counts, likes: 1 }, NOW, NOW);
    expect(watched).toBeGreaterThan(base);
    // 30 s regardées valent un like : 0,1 × 30 = 3.
    expect(watched).toBe(liked);
  });
});
