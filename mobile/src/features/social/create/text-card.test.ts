import { describe, expect, it } from 'vitest';

import {
  FEED_TEXT_FONT,
  TEXT_CARD_FONT,
  autoFitTextSize,
  cleanPages,
  estimateLines,
  fitFeedTypography,
} from './text-card';

const CARD_WIDTH = 343;

describe('estimateLines', () => {
  it('compte une ligne par paragraphe vide', () => {
    expect(estimateLines('', 20, 300)).toBe(1);
    expect(estimateLines('a\n\nb', 20, 300)).toBe(3);
  });

  it('découpe les paragraphes selon la largeur disponible', () => {
    const perLine = Math.floor(300 / (20 * 0.52));
    const text = 'x'.repeat(perLine * 2);
    expect(estimateLines(text, 20, 300)).toBe(2);
  });
});

describe('autoFitTextSize', () => {
  it('donne la taille maximale à un texte court', () => {
    expect(autoFitTextSize('Bonjour', CARD_WIDTH)).toEqual({
      fontSize: TEXT_CARD_FONT.max,
      lineHeight: Math.round(TEXT_CARD_FONT.max * 1.32),
    });
  });

  it('réduit la police quand le texte s’allonge', () => {
    const short = autoFitTextSize('Un mot', CARD_WIDTH).fontSize;
    const medium = autoFitTextSize('mot '.repeat(60), CARD_WIDTH).fontSize;
    const long = autoFitTextSize('mot '.repeat(400), CARD_WIDTH).fontSize;
    expect(medium).toBeLessThan(short);
    expect(long).toBeLessThanOrEqual(medium);
  });

  it('ne descend jamais sous le plancher', () => {
    const huge = autoFitTextSize('mot '.repeat(5000), CARD_WIDTH).fontSize;
    expect(huge).toBe(TEXT_CARD_FONT.min);
  });

  it('reste lisible sur une carte étroite', () => {
    const narrow = autoFitTextSize('mot '.repeat(60), 200);
    expect(narrow.fontSize).toBeGreaterThanOrEqual(TEXT_CARD_FONT.min);
    expect(narrow.lineHeight).toBeGreaterThan(narrow.fontSize);
  });

  it('traite un texte vide comme une ligne', () => {
    expect(autoFitTextSize('   ', CARD_WIDTH).fontSize).toBe(TEXT_CARD_FONT.max);
  });
});

describe('fitFeedTypography', () => {
  const WIDTH = 343;
  const HEIGHT = 420;

  it('agrandit le texte d’un post court, comme Instagram', () => {
    const fit = fitFeedTypography([{ title: 'Salut', body: 'Ça va ?' }], WIDTH, HEIGHT);
    expect(fit).not.toBeNull();
    expect(fit!.bodySize).toBeGreaterThan(18);
    expect(fit!.titleSize).toBeGreaterThan(fit!.bodySize);
  });

  it('réduit la police quand le texte est long', () => {
    const short = fitFeedTypography([{ title: '', body: 'Salut' }], WIDTH, HEIGHT)!;
    const long = fitFeedTypography(
      [{ title: '', body: 'mot '.repeat(300) }],
      WIDTH,
      HEIGHT,
    )!;
    expect(long.bodySize).toBeLessThan(short.bodySize);
    expect(long.bodySize).toBeGreaterThanOrEqual(FEED_TEXT_FONT.min);
  });

  it('tient la page la plus longue d’un multi-pages', () => {
    const fit = fitFeedTypography(
      [
        { title: '', body: 'court' },
        { title: '', body: 'mot '.repeat(300) },
      ],
      WIDTH,
      HEIGHT,
    )!;
    expect(fit.bodySize).toBeLessThanOrEqual(
      fitFeedTypography([{ title: '', body: 'court' }], WIDTH, HEIGHT)!.bodySize,
    );
  });

  it('respecte la taille manuelle comme plafond sans jamais la dépasser', () => {
    const short = fitFeedTypography(
      [{ title: '', body: 'Salut' }],
      WIDTH,
      HEIGHT,
      0.52,
      30,
    )!;
    expect(short.bodySize).toBe(30);
    // Un texte long descend sous la taille manuelle au lieu d'être coupé.
    const long = fitFeedTypography(
      [{ title: '', body: 'mot '.repeat(300) }],
      WIDTH,
      HEIGHT,
      0.52,
      30,
    )!;
    expect(long.bodySize).toBeLessThan(30);
    expect(long.bodySize).toBeGreaterThanOrEqual(FEED_TEXT_FONT.min);
  });

  it('renvoie null sans texte et le plancher pour un texte immense', () => {
    expect(fitFeedTypography([{ title: '', body: null }], WIDTH, HEIGHT)).toBeNull();
    const huge = fitFeedTypography(
      [{ title: 't'.repeat(500), body: 'mot '.repeat(2000) }],
      WIDTH,
      HEIGHT,
    )!;
    expect(huge.bodySize).toBe(FEED_TEXT_FONT.min);
  });
});

describe('cleanPages', () => {
  it('retire les pages vides et les espaces de bord', () => {
    expect(cleanPages(['  Bonjour ', '', '   ', 'Suite\n'])).toEqual(['Bonjour', 'Suite']);
  });

  it('garde une page dont le texte contient un retour à la ligne', () => {
    expect(cleanPages(['a\n\nb'])).toEqual(['a\n\nb']);
  });
});
