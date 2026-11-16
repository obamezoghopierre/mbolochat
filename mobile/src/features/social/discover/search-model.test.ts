import { describe, expect, it } from 'vitest';

import {
  emptySearchResult,
  hashtagQuery,
  normalizeSearchQuery,
  totalResults,
} from './search-model';
import type { SearchResult } from '@/lib/types';

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  const base = emptySearchResult();
  return { ...base, ...overrides };
}

describe('normalizeSearchQuery', () => {
  it('refuse une requête trop courte', () => {
    expect(normalizeSearchQuery('')).toBe('');
    expect(normalizeSearchQuery('a')).toBe('');
    expect(normalizeSearchQuery('  a  ')).toBe('');
  });

  it('réduit les espaces et rogne les bords', () => {
    expect(normalizeSearchQuery('  mbolo   chat ')).toBe('mbolo chat');
  });
});

describe('hashtagQuery', () => {
  it('retire les dièses de tête', () => {
    expect(hashtagQuery('#mbolo')).toBe('mbolo');
    expect(hashtagQuery('##Mbolo')).toBe('Mbolo');
    expect(hashtagQuery('mbolo')).toBe('mbolo');
  });
});

describe('totalResults', () => {
  it('additionne les trois blocs', () => {
    const value = result({
      users: {
        items: [
          {
            id: 'u1',
            username: 'a',
            displayName: 'A',
            avatarUrl: null,
            verified: false,
            privateAccount: false,
          },
        ],
        nextCursor: null,
      },
      hashtags: {
        items: [{ id: 'h1', tag: 'mbolo', usageCount: 2, trendScore: 2 }],
        nextCursor: null,
      },
    });
    expect(totalResults(value)).toBe(2);
    expect(totalResults(emptySearchResult())).toBe(0);
  });
});
