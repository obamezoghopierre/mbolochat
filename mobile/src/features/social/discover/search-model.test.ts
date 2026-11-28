import { describe, expect, it } from 'vitest';

import {
  blockForFilter,
  buildSearchEntries,
  emptySearchResult,
  followUiState,
  hashtagQuery,
  hasSearchContent,
  mergeSearchBlock,
  mergeSearchResult,
  normalizeSearchQuery,
  SEARCH_PREVIEW_HASHTAGS,
  SEARCH_PREVIEW_TILES,
  SEARCH_PREVIEW_USERS,
  totalResults,
} from './search-model';
import type { FeedPost, SearchHashtag, SearchResult, SearchUser } from '@/lib/types';

function user(id: string): SearchUser {
  return {
    id,
    username: `${id}_user`,
    displayName: `Compte ${id}`,
    avatarUrl: null,
    verified: false,
    privateAccount: false,
    followStatus: 'none',
  };
}

function tag(id: string): SearchHashtag {
  return { id, tag: `tag${id}`, usageCount: 3, trendScore: 3 };
}

function post(id: string): FeedPost {
  return {
    id,
    kind: 'post',
    format: 'image',
    caption: null,
    visibility: 'public',
    createdAt: '2026-11-16T10:00:00.000Z',
    author: {
      id: 'u1',
      username: 'auteur',
      displayName: 'Auteur',
      avatarUrl: null,
      verified: false,
    },
    media: [],
    counters: { likes: 0, comments: 0, reposts: 0, saves: 0, views: 0 },
    viewer: { reaction: null, followingAuthor: false },
  };
}

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
      users: { items: [user('u1')], nextCursor: null },
      hashtags: { items: [tag('h1')], nextCursor: null },
    });
    expect(totalResults(value)).toBe(2);
    expect(totalResults(emptySearchResult())).toBe(0);
  });
});

describe('followUiState', () => {
  it('part de l’abonnement réel renvoyé par l’API', () => {
    expect(followUiState('accepted')).toBe('following');
    expect(followUiState('pending')).toBe('pending');
    expect(followUiState('none')).toBe('idle');
  });
});

describe('blockForFilter', () => {
  it('ne pagine que les onglets d’un seul type', () => {
    expect(blockForFilter('all')).toBeNull();
    expect(blockForFilter('users')).toBe('users');
    expect(blockForFilter('publications')).toBe('publications');
    expect(blockForFilter('hashtags')).toBe('hashtags');
  });
});

describe('mergeSearchBlock', () => {
  it('ajoute la page sans doublon et retient le dernier curseur', () => {
    const merged = mergeSearchBlock(
      { items: [user('u1'), user('u2')], nextCursor: 'a' },
      { items: [user('u2'), user('u3')], nextCursor: null },
    );

    expect(merged.items.map((item) => item.id)).toEqual(['u1', 'u2', 'u3']);
    expect(merged.nextCursor).toBeNull();
  });

  it('fusionne la page dans le bloc demandé', () => {
    const current = result({ users: { items: [user('u1')], nextCursor: 'c1' } });
    const page = result({ users: { items: [user('u2')], nextCursor: null } });

    const merged = mergeSearchResult(current, page, 'users');

    expect(merged.users.items.map((item) => item.id)).toEqual(['u1', 'u2']);
    expect(merged.publications.items).toEqual([]);
  });
});

describe('buildSearchEntries', () => {
  it('donne un aperçu borné de chaque type dans « Tous »', () => {
    const users = Array.from({ length: SEARCH_PREVIEW_USERS + 2 }, (_, i) =>
      user(`u${i}`),
    );
    const posts = Array.from({ length: SEARCH_PREVIEW_TILES + 3 }, (_, i) =>
      post(`p${i}`),
    );
    const tags = Array.from({ length: SEARCH_PREVIEW_HASHTAGS + 1 }, (_, i) =>
      tag(`h${i}`),
    );
    const entries = buildSearchEntries(
      result({
        users: { items: users, nextCursor: 'c' },
        publications: { items: [], nextCursor: 'c' },
        hashtags: { items: tags, nextCursor: null },
      }),
      posts,
      'all',
    );

    const sections = entries.filter((entry) => entry.kind === 'section');
    // Un titre par type, chacun avec « Voir tout » (il reste des résultats).
    expect(sections).toHaveLength(3);
    expect(sections.every((entry) => entry.kind === 'section' && entry.seeAll)).toBe(
      true,
    );
    expect(entries.filter((entry) => entry.kind === 'user')).toHaveLength(
      SEARCH_PREVIEW_USERS,
    );
    expect(entries.filter((entry) => entry.kind === 'hashtag')).toHaveLength(
      SEARCH_PREVIEW_HASHTAGS,
    );
    // Les vignettes sont rangées en lignes de trois, avec l'index de la
    // visionneuse (position dans la liste des publications).
    const tileRows = entries.filter((entry) => entry.kind === 'tiles');
    expect(tileRows).toHaveLength(Math.ceil(SEARCH_PREVIEW_TILES / 3));
    const firstRow = tileRows[0];
    expect(firstRow.kind === 'tiles' && firstRow.tiles.map((t) => t.index)).toEqual([
      0, 1, 2,
    ]);
  });

  it('déroule tout le type d’un onglet précis, sans « Voir tout »', () => {
    const posts = Array.from({ length: 5 }, (_, i) => post(`p${i}`));
    const entries = buildSearchEntries(
      result({
        users: { items: [user('u1')], nextCursor: null },
        publications: { items: [], nextCursor: null },
      }),
      posts,
      'publications',
    );

    expect(entries.filter((entry) => entry.kind === 'user')).toHaveLength(0);
    expect(entries.filter((entry) => entry.kind === 'hashtag')).toHaveLength(0);
    const sections = entries.filter((entry) => entry.kind === 'section');
    expect(sections).toHaveLength(1);
    expect(sections[0].kind === 'section' && sections[0].seeAll).toBe(false);
    const tiles = entries.flatMap((entry) =>
      entry.kind === 'tiles' ? entry.tiles : [],
    );
    expect(tiles).toHaveLength(5);
    expect(tiles.map((tile) => tile.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('ne rend rien sans résultat', () => {
    const entries = buildSearchEntries(emptySearchResult(), [], 'all');

    expect(entries).toEqual([]);
    expect(hasSearchContent(entries)).toBe(false);
  });

  it('distingue les titres du contenu', () => {
    const entries = buildSearchEntries(
      result({ users: { items: [user('u1')], nextCursor: null } }),
      [],
      'users',
    );

    expect(hasSearchContent(entries)).toBe(true);
  });
});
