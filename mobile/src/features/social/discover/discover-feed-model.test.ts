import { describe, expect, it } from 'vitest';

import {
  buildExploreRows,
  hydrateDiscoverPost,
  hydrateSearchPublication,
  mediaAspect,
  type DiscoverPostHydration,
} from './discover-feed-model';
import type { DiscoverPublication } from './discover-api';
import type { FeedPost, PublicationMedia, SearchPublication } from '@/lib/types';

function media(overrides: Partial<PublicationMedia> = {}): PublicationMedia {
  return {
    assetId: 'a1',
    kind: 'image',
    mime: 'image/png',
    position: 0,
    width: 100,
    height: 100,
    durationMs: null,
    url: 'https://cdn/a.webp',
    posterUrl: null,
    altText: null,
    ...overrides,
  };
}

function discoverPost(
  overrides: Partial<DiscoverPublication> = {},
): DiscoverPublication {
  return {
    id: 'p1',
    kind: 'post',
    format: 'image',
    caption: 'Bonjour',
    createdAt: '2026-11-16T10:00:00.000Z',
    author: {
      id: 'u1',
      username: 'auteur',
      displayName: 'Auteur',
      avatarUrl: null,
      verified: false,
    },
    media: [media()],
    counters: { likes: 3, comments: 1, reposts: 0, views: 0 },
    ...overrides,
  };
}

const hydration: DiscoverPostHydration = {
  viewer: { reaction: null, followingAuthor: false },
};

describe('hydrateDiscoverPost', () => {
  it('complète les champs du lecteur absents de la section', () => {
    const hydrated = hydrateDiscoverPost(discoverPost(), hydration);

    expect(hydrated.visibility).toBe('public');
    expect(hydrated.viewer).toEqual({ reaction: null, followingAuthor: false });
    expect(hydrated.counters.saves).toBe(0);
    expect(hydrated.quoted).toBeNull();
    expect(hydrated.repostedBy).toBeNull();
    expect(hydrated.media).toHaveLength(1);
  });

  it('signe un signet déjà posé dans le compteur des signets', () => {
    const hydrated = hydrateDiscoverPost(discoverPost(), {
      viewer: { reaction: null, followingAuthor: false, saved: true },
    });

    expect(hydrated.counters.saves).toBe(1);
  });

  it('garde le contexte du lecteur fourni (réaction, abonnement)', () => {
    const hydrated = hydrateDiscoverPost(discoverPost(), {
      viewer: { reaction: 'love', followingAuthor: true, reposted: true },
    });

    expect(hydrated.viewer.reaction).toBe('love');
    expect(hydrated.viewer.followingAuthor).toBe(true);
    expect(hydrated.viewer.reposted).toBe(true);
  });
});

describe('hydrateSearchPublication', () => {
  function searchPost(
    overrides: Partial<SearchPublication> = {},
  ): SearchPublication {
    return {
      id: 'sp1',
      kind: 'post',
      caption: 'Un résultat de recherche',
      createdAt: '2026-11-16T10:00:00.000Z',
      author: {
        id: 'u1',
        username: 'auteur',
        displayName: 'Auteur',
        avatarUrl: null,
        verified: false,
      },
      ...overrides,
    };
  }

  it('crée une publication exploitable par le visionneuse', () => {
    const hydrated = hydrateSearchPublication(searchPost(), hydration);

    expect(hydrated.id).toBe('sp1');
    expect(hydrated.kind).toBe('post');
    expect(hydrated.caption).toBe('Un résultat de recherche');
    expect(hydrated.visibility).toBe('public');
    // La recherche ne renvoie pas les médias : le visionneuse les récupère
    // dans le détail de la publication.
    expect(hydrated.media).toEqual([]);
    expect(hydrated.viewer).toEqual({ reaction: null, followingAuthor: false });
  });

  it('garde le contexte du lecteur fourni', () => {
    const hydrated = hydrateSearchPublication(searchPost(), {
      viewer: { reaction: 'like', followingAuthor: true, saved: true },
    });

    expect(hydrated.viewer.reaction).toBe('like');
    expect(hydrated.viewer.followingAuthor).toBe(true);
    expect(hydrated.counters.saves).toBe(0);
  });
});

describe('mediaAspect', () => {
  function postWith(mediaList: PublicationMedia[]): FeedPost {
    return {
      ...hydrateDiscoverPost(discoverPost({ media: mediaList }), hydration),
    };
  }

  it('prend le ratio du premier média', () => {
    expect(mediaAspect(postWith([media({ width: 800, height: 1000 })]))).toBe(
      0.8,
    );
  });

  it('traite une vidéo sans dimensions comme un portrait 9:16', () => {
    const reel = postWith([media({ kind: 'video', width: null, height: null })]);
    expect(mediaAspect({ ...reel, kind: 'reel' })).toBeCloseTo(9 / 16);
  });

  it('revient à 1 sans média', () => {
    expect(mediaAspect(postWith([]))).toBe(1);
  });
});

describe('buildExploreRows', () => {
  function posts(count: number, aspect = 1): FeedPost[] {
    return Array.from({ length: count }, (_, index) =>
      hydrateDiscoverPost(
        discoverPost({
          id: `p${index}`,
          media: [media({ width: 100 * aspect, height: 100 })],
        }),
        hydration,
      ),
    );
  }

  it('groupe par rangées de trois', () => {
    const rows = buildExploreRows(posts(7), 100);

    expect(rows).toHaveLength(3);
    expect(rows[0].items).toHaveLength(3);
    expect(rows[2].items).toHaveLength(1);
    expect(rows[0].key).toBe('explore-row-0');
  });

  it('donne une hauteur simple en contenu carré', () => {
    const rows = buildExploreRows(posts(3), 120);

    expect(rows[0].height).toBe(120);
    expect(rows[0].multiple).toBe(1);
  });

  it('allonge une rangée dont un média est portrait', () => {
    const [portrait, square, square2, square3] = posts(4, 1);
    const rows = buildExploreRows(
      [
        { ...portrait, media: [media({ width: 56, height: 100 })] },
        square,
        square2,
        square3,
      ],
      120,
    );

    expect(rows[0].multiple).toBe(2);
    expect(rows[0].height).toBe(240);
  });

  it('impose un rythme de rangées doubles sur un contenu uniforme', () => {
    // 15 rangées : la 3e (index 2) est double, les autres simples.
    const rows = buildExploreRows(posts(45), 100);

    expect(rows).toHaveLength(15);
    expect(rows[2].multiple).toBe(2);
    expect(rows[7].multiple).toBe(2);
    expect(rows[0].multiple).toBe(1);
    expect(rows[1].multiple).toBe(1);
  });

  it('returne une liste vide sans publication', () => {
    expect(buildExploreRows([], 100)).toEqual([]);
  });
});
