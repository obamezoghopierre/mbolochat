import { describe, expect, it } from 'vitest';

import { appendComment, mergeCommentPage } from './comments-model';
import type { PublicationComment } from '@/lib/types';

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
    ...overrides,
  };
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

describe('mergeCommentPage', () => {
  it('conserve l’ordre et le curseur', () => {
    const merged = mergeCommentPage([comment({ id: 'a' })], {
      items: [comment({ id: 'b' })],
      nextCursor: 'suite',
    });
    expect(merged.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(merged.nextCursor).toBe('suite');
  });

  it('ne duplique pas un commentaire déjà chargé', () => {
    const merged = mergeCommentPage([comment({ id: 'a' })], {
      items: [comment({ id: 'a' })],
      nextCursor: null,
    });
    expect(merged.items).toHaveLength(1);
  });
});
