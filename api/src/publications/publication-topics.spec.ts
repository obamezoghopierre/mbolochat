import { describe, expect, it } from 'vitest';

import {
  MIN_EXPLICIT_HASHTAGS,
  topicsForText,
} from './publication-topics.js';

describe('topicsForText', () => {
  it('ne garde que les hashtags quand l’auteur en met assez', () => {
    const text = '#football #match #libreville Un super derby ce soir';
    const result = topicsForText(text);
    expect(result.hashtags).toEqual(['football', 'match', 'libreville']);
    expect(result.topics).toEqual([]);
    expect(result.hashtags.length).toBeGreaterThanOrEqual(MIN_EXPLICIT_HASHTAGS);
  });

  it('complète avec des mots-clés quand les hashtags sont rares', () => {
    const result = topicsForText('Belle plage à Libreville #voyage');
    expect(result.hashtags).toEqual(['voyage']);
    expect(result.topics).toEqual(['belle', 'plage', 'libreville']);
  });

  it('n’extrait que des mots-clés pour un texte sans hashtag', () => {
    const result = topicsForText('Recette de cuisine gabonaise, cuisine du dimanche');
    expect(result.hashtags).toEqual([]);
    expect(result.topics[0]).toBe('cuisine');
  });

  it('ne répète pas en sujet un mot déjà présent comme hashtag', () => {
    const result = topicsForText('Voyage en famille #voyage');
    expect(result.topics).not.toContain('voyage');
    expect(result.topics).toContain('famille');
  });

  it('rend des listes vides pour un texte vide', () => {
    expect(topicsForText('')).toEqual({ hashtags: [], topics: [] });
  });
});
