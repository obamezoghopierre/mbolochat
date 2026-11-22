import { describe, expect, it } from 'vitest';

import {
  compactCount,
  extraMediaCount,
  isVideoPost,
  primaryMedia,
} from './feed-media';
import type { FeedPost, PublicationMedia } from '@/lib/types';

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

function post(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: 'p1',
    kind: 'post',
    format: 'text',
    caption: 'Salut',
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
    ...overrides,
  };
}

describe('primaryMedia', () => {
  it('renvoie le premier média avec URL', () => {
    const value = post({
      media: [media({ assetId: 'x', url: null }), media({ assetId: 'y' })],
    });
    expect(primaryMedia(value)?.assetId).toBe('y');
  });

  it('renvoie null pour un post texte', () => {
    expect(primaryMedia(post())).toBeNull();
  });
});

describe('isVideoPost', () => {
  it('détecte une vidéo principale', () => {
    expect(isVideoPost(post({ media: [media({ kind: 'video' })] }))).toBe(true);
    expect(isVideoPost(post({ media: [media({ kind: 'image' })] }))).toBe(false);
    expect(isVideoPost(post())).toBe(false);
  });

  it('affiche un carrousel mixte en carte, même s’il commence par une vidéo', () => {
    expect(
      isVideoPost(
        post({ media: [media({ kind: 'video' }), media({ assetId: 'b', kind: 'image' })] }),
      ),
    ).toBe(false);
    expect(
      isVideoPost(
        post({ media: [media({ kind: 'video' }), media({ assetId: 'b', kind: 'video' })] }),
      ),
    ).toBe(false);
  });
});

describe('extraMediaCount', () => {
  it('compte les médias au-delà du premier', () => {
    expect(extraMediaCount(post())).toBe(0);
    expect(extraMediaCount(post({ media: [media(), media({ assetId: 'b' })] }))).toBe(1);
  });
});

describe('compactCount', () => {
  it('formate les compteurs', () => {
    expect(compactCount(0)).toBe('0');
    expect(compactCount(42)).toBe('42');
    expect(compactCount(1500)).toBe('1.5k');
    expect(compactCount(2000)).toBe('2k');
  });
});
