import { describe, expect, it } from 'vitest';

import {
  MAX_HISTORY,
  dedupeRecent,
  filterSuggestions,
} from './search-history';

describe('dedupeRecent', () => {
  it('ajoute la requête au début', () => {
    expect(dedupeRecent(['chat', 'amir'], 'photo')).toEqual([
      'photo',
      'chat',
      'amir',
    ]);
  });

  it('ne crée pas de doublon, même en casse différente', () => {
    expect(dedupeRecent(['Photo', 'chat'], 'photo')).toEqual(['photo', 'chat']);
  });

  it('remonte une recherche répétée en tête', () => {
    expect(dedupeRecent(['chat', 'photo', 'amir'], 'photo')).toEqual([
      'photo',
      'chat',
      'amir',
    ]);
  });

  it('borne la taille à MAX_HISTORY', () => {
    const entries = Array.from({ length: MAX_HISTORY + 3 }, (_, i) => `q${i}`);
    const next = dedupeRecent(entries, 'nouveau');
    expect(next).toHaveLength(MAX_HISTORY);
    expect(next[0]).toBe('nouveau');
  });

  it('ignore une requête vide', () => {
    expect(dedupeRecent(['chat'], '   ')).toEqual(['chat']);
  });
});

describe('filterSuggestions', () => {
  it('garde les entrées contenant la requête', () => {
    expect(
      filterSuggestions(['chat', 'photographe', 'amir'], 'pho'),
    ).toEqual(['photographe']);
  });

  it('est insensible à la casse', () => {
    expect(filterSuggestions(['Chat', 'CHATEUR'], 'chat')).toEqual([
      'Chat',
      'CHATEUR',
    ]);
  });

  it('ne renvoie rien sans requête', () => {
    expect(filterSuggestions(['chat', 'amir'], '')).toEqual([]);
  });
});
