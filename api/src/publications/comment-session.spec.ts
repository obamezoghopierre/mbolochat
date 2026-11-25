import { describe, expect, it } from 'vitest';

import {
  decodeCommentSessionCursor,
  encodeCommentSessionCursor,
} from './comment-session.js';

describe('curseur de session de commentaires', () => {
  it('fait un aller-retour avec un identifiant contenant des deux-points', () => {
    const cursor = encodeCommentSessionCursor('session:123', 12);
    expect(decodeCommentSessionCursor(cursor)).toEqual({
      sessionId: 'session:123',
      offset: 12,
    });
  });

  it('refuse les sessions vides et les décalages invalides', () => {
    expect(() => decodeCommentSessionCursor('pas-un-curseur')).toThrow();
    expect(() =>
      decodeCommentSessionCursor(encodeCommentSessionCursor('', 0)),
    ).toThrow();
    expect(() =>
      decodeCommentSessionCursor(encodeCommentSessionCursor('s', -1)),
    ).toThrow();
    expect(() =>
      decodeCommentSessionCursor(encodeCommentSessionCursor('s', 1.5)),
    ).toThrow();
    expect(() =>
      decodeCommentSessionCursor(
        encodeCommentSessionCursor('s', Number.MAX_SAFE_INTEGER + 1),
      ),
    ).toThrow();
  });
});
