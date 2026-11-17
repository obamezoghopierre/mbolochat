import { describe, expect, it } from 'vitest';

import { applyReaction, mergeFeedPage, toggleRepost, toggleSave } from './feed-model';
import type { FeedPost } from '@/lib/types';

function post(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: 'post-1',
    kind: 'post',
    format: 'text',
    caption: 'Bonjour',
    visibility: 'public',
    createdAt: '2026-11-16T10:00:00.000Z',
    author: {
      id: 'author-1',
      username: 'auteur',
      displayName: 'Auteur',
      avatarUrl: null,
      verified: false,
    },
    counters: { likes: 0, comments: 0, reposts: 0, saves: 0, views: 0 },
    viewer: { reaction: null, followingAuthor: false },
    ...overrides,
  };
}

describe('mergeFeedPage', () => {
  it('ajoute la page suivante et conserve le curseur', () => {
    const merged = mergeFeedPage([post({ id: 'a' })], {
      items: [post({ id: 'b' })],
      nextCursor: 'curseur',
    });
    expect(merged.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(merged.nextCursor).toBe('curseur');
  });

  it('ne duplique pas une publication déjà affichée', () => {
    const merged = mergeFeedPage([post({ id: 'a' })], {
      items: [post({ id: 'a' })],
      nextCursor: null,
    });
    expect(merged.items).toHaveLength(1);
  });

  it('garde la version la plus récente pour un même identifiant', () => {
    const merged = mergeFeedPage([post({ id: 'a', caption: 'ancien' })], {
      items: [post({ id: 'a', caption: 'récent' })],
      nextCursor: null,
    });
    expect(merged.items[0].caption).toBe('récent');
  });
});

describe('applyReaction', () => {
  it('incrémente au premier like et décrémente au retrait', () => {
    const liked = applyReaction([post()], 'post-1', 'like');
    expect(liked[0].viewer.reaction).toBe('like');
    expect(liked[0].counters.likes).toBe(1);

    const removed = applyReaction(liked, 'post-1', null);
    expect(removed[0].viewer.reaction).toBeNull();
    expect(removed[0].counters.likes).toBe(0);
  });

  it('ne change pas le total quand le type de réaction change', () => {
    const liked = applyReaction([post()], 'post-1', 'like');
    const loved = applyReaction(liked, 'post-1', 'love');
    expect(loved[0].viewer.reaction).toBe('love');
    expect(loved[0].counters.likes).toBe(1);
  });

  it('ne descend jamais sous zéro', () => {
    const removed = applyReaction([post()], 'post-1', null);
    expect(removed[0].counters.likes).toBe(0);
  });

  it('ne touche pas les autres publications', () => {
    const items = applyReaction([post({ id: 'a' }), post({ id: 'b' })], 'a', 'fire');
    expect(items[1].viewer.reaction).toBeNull();
    expect(items[1].counters.likes).toBe(0);
  });
});

describe('toggleSave', () => {
  it('enregistre puis retire, en suivant le compteur', () => {
    const saved = toggleSave([post()], 'post-1');
    expect(saved.saved).toBe(true);
    expect(saved.items[0].viewer.saved).toBe(true);
    expect(saved.items[0].counters.saves).toBe(1);

    const removed = toggleSave(saved.items, 'post-1');
    expect(removed.saved).toBe(false);
    expect(removed.items[0].viewer.saved).toBe(false);
    expect(removed.items[0].counters.saves).toBe(0);
  });

  it('ne descend jamais sous zéro', () => {
    const removed = toggleSave([post({ viewer: { reaction: null, followingAuthor: false, saved: false } })], 'post-1');
    expect(removed.items[0].viewer.saved).toBe(true);
    const again = toggleSave(removed.items, 'post-1');
    expect(again.items[0].counters.saves).toBe(0);
  });
});

describe('toggleRepost', () => {
  it('republie puis retire, en suivant le compteur', () => {
    const reposted = toggleRepost([post()], 'post-1');
    expect(reposted.reposted).toBe(true);
    expect(reposted.items[0].viewer.reposted).toBe(true);
    expect(reposted.items[0].counters.reposts).toBe(1);

    const removed = toggleRepost(reposted.items, 'post-1');
    expect(removed.reposted).toBe(false);
    expect(removed.items[0].viewer.reposted).toBe(false);
    expect(removed.items[0].counters.reposts).toBe(0);
  });
});

