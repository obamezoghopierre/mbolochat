import { describe, expect, it } from 'vitest';

import {
  actionForView,
  decayedScore,
  INTEREST_FLOOR,
  INTEREST_HALF_LIFE_DAYS,
  INTEREST_SCORE_MAX,
  INTEREST_SCORE_MIN,
  INTEREST_WEIGHTS,
  nextScore,
  SKIP_MAX_MS,
  WATCH_INTEREST_MIN_MS,
} from './user-interests.js';

const DAY = 86_400_000;

describe('INTEREST_WEIGHTS', () => {
  it('classe les actions comme Instagram : envoi > enregistrement > like', () => {
    expect(INTEREST_WEIGHTS.share).toBeGreaterThan(INTEREST_WEIGHTS.save);
    expect(INTEREST_WEIGHTS.save).toBeGreaterThan(INTEREST_WEIGHTS.like);
    expect(INTEREST_WEIGHTS.like).toBeGreaterThan(INTEREST_WEIGHTS.watch);
  });

  it('valorise une vue terminée plus qu’un like', () => {
    expect(INTEREST_WEIGHTS.complete).toBeGreaterThan(INTEREST_WEIGHTS.like);
  });

  it('ne rend négatif que le zap', () => {
    expect(INTEREST_WEIGHTS.skip).toBeLessThan(0);
    for (const [action, weight] of Object.entries(INTEREST_WEIGHTS)) {
      if (action !== 'skip') {
        expect(weight).toBeGreaterThan(0);
      }
    }
  });

  it('pénalise un zap moins qu’un seul like ne récompense', () => {
    // Un swipe peut n'être qu'un mauvais moment : il ne doit pas annuler un
    // intérêt construit par un like.
    expect(Math.abs(INTEREST_WEIGHTS.skip)).toBeLessThan(INTEREST_WEIGHTS.like);
  });
});

describe('actionForView', () => {
  it('reconnaît une vue terminée, quelle que soit sa durée', () => {
    expect(actionForView(500, true)).toBe('complete');
    expect(actionForView(60_000, true)).toBe('complete');
  });

  it('compte une vue assez longue comme un intérêt', () => {
    expect(actionForView(WATCH_INTEREST_MIN_MS, false)).toBe('watch');
    expect(actionForView(20_000, false)).toBe('watch');
  });

  it('compte une vue très courte comme un zap', () => {
    expect(actionForView(0, false)).toBe('skip');
    expect(actionForView(SKIP_MAX_MS, false)).toBe('skip');
  });

  it('ignore la zone grise entre zap et intérêt', () => {
    expect(actionForView(SKIP_MAX_MS + 1, false)).toBeNull();
    expect(actionForView(WATCH_INTEREST_MIN_MS - 1, false)).toBeNull();
  });
});

describe('decayedScore', () => {
  it('divise par deux après une demi-vie', () => {
    expect(
      decayedScore(10, INTEREST_HALF_LIFE_DAYS * DAY),
    ).toBeCloseTo(5, 6);
    expect(
      decayedScore(10, 2 * INTEREST_HALF_LIFE_DAYS * DAY),
    ).toBeCloseTo(2.5, 6);
  });

  it('ne change pas une valeur sans temps écoulé', () => {
    expect(decayedScore(7, 0)).toBe(7);
  });

  it('traite un temps négatif comme nul', () => {
    expect(decayedScore(7, -5 * DAY)).toBe(7);
  });

  it('décroît aussi les scores négatifs vers zéro', () => {
    expect(decayedScore(-8, INTEREST_HALF_LIFE_DAYS * DAY)).toBeCloseTo(-4, 6);
  });

  it('tombe à zéro sous le seuil de négligeabilité', () => {
    expect(decayedScore(1, 10 * INTEREST_HALF_LIFE_DAYS * DAY)).toBe(0);
    expect(Math.abs(decayedScore(INTEREST_FLOOR, 0))).toBe(INTEREST_FLOOR);
  });

  it('rend 0 pour un score nul ou invalide', () => {
    expect(decayedScore(0, DAY)).toBe(0);
    expect(decayedScore(Number.NaN, DAY)).toBe(0);
  });
});

describe('nextScore', () => {
  it('ajoute le poids de l’action', () => {
    expect(nextScore(0, 0, 'like')).toBe(INTEREST_WEIGHTS.like);
    expect(nextScore(0, 0, 'share')).toBe(INTEREST_WEIGHTS.share);
  });

  it('cumule des actions rapprochées', () => {
    const afterLike = nextScore(0, 0, 'like');
    expect(nextScore(afterLike, 0, 'save')).toBe(
      INTEREST_WEIGHTS.like + INTEREST_WEIGHTS.save,
    );
  });

  it('applique la décroissance avant d’ajouter', () => {
    const value = nextScore(10, INTEREST_HALF_LIFE_DAYS * DAY, 'like');
    expect(value).toBeCloseTo(5 + INTEREST_WEIGHTS.like, 6);
  });

  it('ne dépasse jamais le plafond', () => {
    expect(nextScore(INTEREST_SCORE_MAX, 0, 'share')).toBe(INTEREST_SCORE_MAX);
    expect(nextScore(INTEREST_SCORE_MAX - 1, 0, 'share')).toBe(INTEREST_SCORE_MAX);
  });

  it('ne descend jamais sous le plancher', () => {
    let value = 0;
    for (let index = 0; index < 100; index += 1) {
      value = nextScore(value, 0, 'skip');
    }
    expect(value).toBe(INTEREST_SCORE_MIN);
  });

  it('n’efface pas un sujet aimé sur un seul zap', () => {
    const loved = nextScore(0, 0, 'save');
    expect(nextScore(loved, 0, 'skip')).toBeGreaterThan(0);
  });
});
