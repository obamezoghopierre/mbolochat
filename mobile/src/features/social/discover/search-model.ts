import type { SearchResult } from '@/lib/types';

/** Longueur minimale imposée par l'API (trigrammes). */
export const MIN_SEARCH_LENGTH = 2;

/** Requête normalisée : espaces réduits, coquille vide si trop courte. */
export function normalizeSearchQuery(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, ' ');
  return trimmed.length >= MIN_SEARCH_LENGTH ? trimmed : '';
}

/** Un hashtag se cherche sans son `#`. */
export function hashtagQuery(tag: string): string {
  return tag.replace(/^#+/, '');
}

export function totalResults(result: SearchResult): number {
  return (
    result.users.items.length +
    result.publications.items.length +
    result.hashtags.items.length
  );
}

export function emptySearchResult(): SearchResult {
  return {
    users: { items: [], nextCursor: null },
    publications: { items: [], nextCursor: null },
    hashtags: { items: [], nextCursor: null },
  };
}
