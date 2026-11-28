import { describe, expect, it } from 'vitest';

import {
  buildExploreRows,
  exploreRowLayouts,
  exploreRowOffset,
  hydrateDiscoverPost,
  hydrateSearchPublication,
  mediaAspect,
  replaceFirstPage,
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
      format: 'image',
      caption: 'Un résultat de recherche',
      createdAt: '2026-11-16T10:00:00.000Z',
      author: {
        id: 'u1',
        username: 'auteur',
        displayName: 'Auteur',
        avatarUrl: null,
        verified: false,
      },
      media: [media()],
      counters: { likes: 4, comments: 2, reposts: 1, views: 9 },
      ...overrides,
    };
  }

  it('crée une publication exploitable par la grille et la visionneuse', () => {
    const hydrated = hydrateSearchPublication(searchPost(), hydration);

    expect(hydrated.id).toBe('sp1');
    expect(hydrated.kind).toBe('post');
    expect(hydrated.format).toBe('image');
    expect(hydrated.caption).toBe('Un résultat de recherche');
    expect(hydrated.visibility).toBe('public');
    // La recherche renvoie la même carte que la grille : la vignette a son
    // média tout de suite, sans requête de détail.
    expect(hydrated.media).toHaveLength(1);
    expect(hydrated.counters).toMatchObject({ likes: 4, comments: 2, views: 9 });
    expect(hydrated.viewer).toEqual({ reaction: null, followingAuthor: false });
  });

  it('garde le format renvoyé par le serveur', () => {
    const hydrated = hydrateSearchPublication(
      searchPost({ kind: 'reel', format: 'video' }),
      hydration,
    );

    expect(hydrated.format).toBe('video');
    expect(hydrated.kind).toBe('reel');
  });

  it('garde le contexte du lecteur fourni', () => {
    const hydrated = hydrateSearchPublication(searchPost(), {
      viewer: { reaction: 'like', followingAuthor: true, saved: true },
    });

    expect(hydrated.viewer.reaction).toBe('like');
    expect(hydrated.viewer.followingAuthor).toBe(true);
    expect(hydrated.counters.saves).toBe(1);
  });
});

describe('replaceFirstPage', () => {
  it('remplace la liste par la page fraîche, dans son ordre', () => {
    const current = [
      hydrateDiscoverPost(discoverPost({ id: 'old1' }), hydration),
      hydrateDiscoverPost(discoverPost({ id: 'p1' }), hydration),
    ];
    const page = [discoverPost({ id: 'new' }), discoverPost({ id: 'p1' })];

    const next = replaceFirstPage(current, page, hydration);

    expect(next.map((item) => item.id)).toEqual(['new', 'p1']);
  });

  it('conserve réaction, signet et abonnement d’une publication déjà connue', () => {
    const current: FeedPost[] = [
      {
        ...hydrateDiscoverPost(discoverPost({ id: 'p1' }), hydration),
        viewer: {
          reaction: 'love',
          followingAuthor: true,
          saved: true,
          reposted: true,
        },
        counters: { likes: 3, comments: 1, reposts: 0, saves: 1, views: 0 },
      },
    ];

    const [kept] = replaceFirstPage(current, [discoverPost({ id: 'p1' })], hydration);

    expect(kept.viewer.reaction).toBe('love');
    expect(kept.viewer.followingAuthor).toBe(true);
    expect(kept.viewer.saved).toBe(true);
    expect(kept.counters.saves).toBe(1);
    // Les compteurs viennent bien de la page fraîche.
    expect(kept.counters.likes).toBe(3);
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

/** Publications carrées (ou du ratio demandé) pour la mosaïque. */
function explorePosts(count: number, aspect = 1): FeedPost[] {
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

/** Les mêmes, dont la première est un portrait (vignette haute). */
function withPortraitFirst(count: number): FeedPost[] {
  const [first, ...rest] = explorePosts(count);
  return [{ ...first, media: [media({ width: 56, height: 100 })] }, ...rest];
}

describe('buildExploreRows', () => {
  it('groupe par rangées de trois', () => {
    const rows = buildExploreRows(explorePosts(7), 100);

    expect(rows).toHaveLength(3);
    expect(rows[0].columns).toHaveLength(3);
    expect(rows[2].columns).toHaveLength(1);
    expect(rows[0].key).toBe('explore-row-0');
  });

  it('donne une hauteur simple en contenu carré', () => {
    const rows = buildExploreRows(explorePosts(3), 120);

    expect(rows[0].height).toBe(120);
    expect(rows[0].multiple).toBe(1);
  });

  it('installe une vignette portrait sur deux hauteurs, voisines empilées', () => {
    const rows = buildExploreRows(withPortraitFirst(5), 120);

    expect(rows).toHaveLength(1);
    expect(rows[0].multiple).toBe(2);
    expect(rows[0].height).toBe(240);
    // La vignette haute occupe une colonne entière…
    expect(rows[0].columns[0]).toHaveLength(1);
    expect(rows[0].columns[0][0].height).toBe(240);
    // … et les deux autres empilent chacune deux vignettes carrées.
    expect(rows[0].columns[1]).toHaveLength(2);
    expect(rows[0].columns[2]).toHaveLength(2);
    expect(rows[0].columns[2][1].height).toBe(120);
    // Les cinq entrées sont placées une fois chacune, dans l'ordre.
    const indexes = rows[0].columns.flat().map((tile) => tile.index);
    expect(indexes.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('compte la gouttière dans la vignette haute', () => {
    const rows = buildExploreRows(withPortraitFirst(5), 100, 2);

    expect(rows[0].height).toBe(202);
    const stacked = rows[0].columns[1];
    // Deux vignettes + la gouttière qui les sépare = la hauteur de la haute.
    expect(stacked[0].height + stacked[1].height + 2).toBe(rows[0].height);
  });

  it('ne laisse pas de trou quand le contenu restant est trop court', () => {
    const rows = buildExploreRows(withPortraitFirst(4), 100);

    expect(rows.map((row) => row.multiple)).toEqual([1, 1]);
    expect(rows[0].columns[0][0].height).toBe(100);
  });

  it('garde des rangées simples sur un contenu uniforme', () => {
    const rows = buildExploreRows(explorePosts(45), 100);

    expect(rows).toHaveLength(15);
    expect(rows.every((row) => row.multiple === 1)).toBe(true);
  });

  it('retourne une liste vide sans publication', () => {
    expect(buildExploreRows([], 100)).toEqual([]);
  });
});

describe('exploreRowOffset', () => {
  it('cumule les hauteurs et les gouttières des rangées précédentes', () => {
    const rows = buildExploreRows(explorePosts(6), 100);

    expect(exploreRowOffset(rows, 0, 2)).toBe(0);
    expect(exploreRowOffset(rows, 3, 2)).toBe(102);
  });

  it('suit une rangée qui contient une vignette haute', () => {
    const rows = buildExploreRows(withPortraitFirst(6), 100, 2);

    // Rangée haute (202 px) puis gouttière : la vignette 5 est dans la suivante.
    expect(rows[1].multiple).toBe(1);
    expect(exploreRowOffset(rows, 5, 2)).toBe(204);
  });

  it('revient à zéro pour un index absent', () => {
    const rows = buildExploreRows(explorePosts(3), 100);

    expect(exploreRowOffset(rows, 99, 2)).toBe(0);
  });
});


describe('exploreRowLayouts', () => {
  it('enchaîne les hauteurs avec la gouttière de chaque rangée', () => {
    const rows = buildExploreRows(withPortraitFirst(6), 100, 2);
    const layouts = exploreRowLayouts(rows, 2);

    // Rangée haute (202) puis gouttière, puis rangée simple.
    expect(layouts).toHaveLength(2);
    expect(layouts[0]).toEqual({ length: 204, offset: 0 });
    expect(layouts[1].offset).toBe(204);
    expect(layouts[1].length).toBe(102);
  });

  it('accorde ses offsets avec ceux du retour depuis le visionneuse', () => {
    const rows = buildExploreRows(explorePosts(9), 100, 2);
    const layouts = exploreRowLayouts(rows, 2);

    expect(exploreRowOffset(rows, 3, 2)).toBe(layouts[1].offset);
    expect(exploreRowOffset(rows, 6, 2)).toBe(layouts[2].offset);
  });
});
