import { describe, expect, it } from 'vitest';

import {
  appendComment,
  appendReply,
  applyCommentReaction,
  groupComments,
  mergeCommentPage,
} from './comments-model';
import type { CommentPage, PublicationComment } from '@/lib/types';

function comment(overrides: Partial<PublicationComment> = {}): PublicationComment {
  return {
    id: 'c1',
    publicationId: 'p1',
    parentId: null,
    body: 'Bonjour',
    createdAt: '2026-11-16T10:00:00.000Z',
    author: {
      id: 'u1',
      username: 'auteur',
      displayName: 'Auteur',
      avatarUrl: null,
      verified: false,
    },
    likeCount: 0,
    replyCount: 0,
    viewerLiked: false,
    viewerDisliked: false,
    dislikeCount: 0,
    score: 0,
    pinned: false,
    reactions: [],
    viewerReaction: null,
    ...overrides,
  };
}

function page(items: PublicationComment[], nextCursor: string | null = null): CommentPage {
  return { pinned: [], items, nextCursor };
}

describe('appendComment', () => {
  it('ajoute un nouveau commentaire à la fin', () => {
    const result = appendComment([comment({ id: 'a' })], comment({ id: 'b' }));
    expect(result.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('remplace au lieu de dupliquer quand le serveur renvoie le même identifiant', () => {
    const result = appendComment(
      [comment({ id: 'a', body: 'local' })],
      comment({ id: 'a', body: 'serveur' }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].body).toBe('serveur');
  });
});

describe('groupComments', () => {
  it('sépare les racines des réponses par parent', () => {
    const { roots, repliesByParent } = groupComments([
      comment({ id: 'a' }),
      comment({ id: 'r1', parentId: 'a' }),
      comment({ id: 'b' }),
      comment({ id: 'r2', parentId: 'a' }),
    ]);
    expect(roots.map((item) => item.id)).toEqual(['a', 'b']);
    expect(repliesByParent.get('a')?.map((item) => item.id)).toEqual(['r1', 'r2']);
    expect(repliesByParent.has('b')).toBe(false);
  });
});

describe('appendReply', () => {
  it('ajoute la réponse et incrémente le compteur du parent', () => {
    const result = appendReply(
      [comment({ id: 'a', replyCount: 1 })],
      comment({ id: 'r', parentId: 'a' }),
    );
    expect(result.map((item) => item.id)).toEqual(['a', 'r']);
    expect(result[0].replyCount).toBe(2);
  });

  it('ne modifie pas le compteur quand la réponse existe déjà', () => {
    const parent = comment({ id: 'a', replyCount: 1 });
    const reply = comment({ id: 'r', parentId: 'a' });
    const result = appendReply([parent, reply], reply);
    expect(result).toHaveLength(2);
    expect(result[0].replyCount).toBe(1);
  });
});

describe('mergeCommentPage', () => {
  it('conserve l’ordre et le curseur', () => {
    const merged = mergeCommentPage([comment({ id: 'a' })], page([comment({ id: 'b' })], 'suite'));
    expect(merged.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(merged.nextCursor).toBe('suite');
  });

  it('ne duplique pas un commentaire déjà chargé', () => {
    const merged = mergeCommentPage([comment({ id: 'a' })], page([comment({ id: 'a' })]));
    expect(merged.items).toHaveLength(1);
  });
});

describe('applyCommentReaction', () => {
  it('ajoute une réaction et incrémente son compteur', () => {
    const result = applyCommentReaction(
      comment({ reactions: [{ kind: 'heart', count: 2 }] }),
      'laugh',
    );
    expect(result.viewerReaction).toBe('laugh');
    expect(result.reactions).toEqual([
      { kind: 'heart', count: 2 },
      { kind: 'laugh', count: 1 },
    ]);
  });

  it('remplace la réaction précédente en déplaçant le vote', () => {
    const result = applyCommentReaction(
      comment({
        viewerReaction: 'heart',
        reactions: [
          { kind: 'heart', count: 2 },
          { kind: 'fire', count: 1 },
        ],
      }),
      'fire',
    );
    expect(result.viewerReaction).toBe('fire');
    expect(result.reactions).toEqual([
      { kind: 'heart', count: 1 },
      { kind: 'fire', count: 2 },
    ]);
  });

  it('retire la réaction quand on repose le même kind', () => {
    const result = applyCommentReaction(
      comment({ viewerReaction: 'wow', reactions: [{ kind: 'wow', count: 1 }] }),
      null,
    );
    expect(result.viewerReaction).toBeNull();
    expect(result.reactions).toEqual([]);
  });
});
