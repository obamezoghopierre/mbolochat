import { describe, expect, it } from 'vitest';

import {
  buildSessionOrder,
  decodeFeedTimeCursor,
  decodeSessionCursor,
  diversifyAuthors,
  encodeFeedTimeCursor,
  encodeSessionCursor,
  interleaveExploration,
  type RankedCandidate,
} from './feed-ranking.js';

const item = (id: string, authorId = `author-${id}`): RankedCandidate => ({ id, authorId });

describe('interleaveExploration', () => {
  it('insère une publication d’exploration tous les N éléments', () => {
    const ranked = ['1', '2', '3', '4', '5', '6'].map((id) => item(id));
    const exploration = ['x1', 'x2'].map((id) => item(id));
    const merged = interleaveExploration(ranked, exploration, 3).map((entry) => entry.id);
    expect(merged).toEqual(['1', '2', '3', 'x1', '4', '5', '6', 'x2']);
  });

  it('ne duplique jamais une publication déjà classée', () => {
    const ranked = [item('a'), item('b')];
    const exploration = [item('a'), item('c')];
    const merged = interleaveExploration(ranked, exploration, 1).map((entry) => entry.id);
    expect(merged).toEqual(['a', 'c', 'b']);
  });

  it('rend le classement inchangé sans réserve d’exploration', () => {
    const ranked = [item('a'), item('b')];
    expect(interleaveExploration(ranked, []).map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('ajoute le reste de la réserve à la fin', () => {
    const merged = interleaveExploration(
      [item('a')],
      [item('x'), item('y'), item('z')],
      7,
    ).map((entry) => entry.id);
    expect(merged).toEqual(['a', 'x', 'y', 'z']);
  });
});

describe('diversifyAuthors', () => {
  it('limite les publications consécutives du même auteur', () => {
    const items = [
      item('1', 'a'),
      item('2', 'a'),
      item('3', 'a'),
      item('4', 'b'),
      item('5', 'a'),
    ];
    const ids = diversifyAuthors(items, 2).map((entry) => entry.id);
    expect(ids).toEqual(['1', '2', '4', '3', '5']);
  });

  it('ne perd aucune publication, même quand tout vient du même auteur', () => {
    const items = ['1', '2', '3', '4'].map((id) => item(id, 'a'));
    const ids = diversifyAuthors(items, 2).map((entry) => entry.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it('laisse l’ordre intact quand les auteurs alternent', () => {
    const items = [item('1', 'a'), item('2', 'b'), item('3', 'a')];
    expect(diversifyAuthors(items, 2).map((entry) => entry.id)).toEqual(['1', '2', '3']);
  });
});

describe('buildSessionOrder', () => {
  it('est déterministe pour les mêmes entrées', () => {
    const ranked = [item('1', 'a'), item('2', 'a'), item('3', 'a'), item('4', 'b')];
    const exploration = [item('x', 'z')];
    expect(buildSessionOrder(ranked, exploration)).toEqual(buildSessionOrder(ranked, exploration));
  });

  it('contient chaque publication une seule fois', () => {
    const ranked = [item('1', 'a'), item('2', 'a'), item('3', 'a'), item('4', 'b')];
    const exploration = [item('2', 'a'), item('x', 'z')];
    const order = buildSessionOrder(ranked, exploration);
    expect(new Set(order).size).toBe(order.length);
    expect(order).toContain('x');
  });
});

describe('curseurs', () => {
  it('fait un aller-retour sur le curseur de session', () => {
    const cursor = encodeSessionCursor('session-1', 42);
    expect(decodeSessionCursor(cursor)).toEqual({ sessionId: 'session-1', offset: 42 });
  });

  it('refuse un curseur de session invalide', () => {
    // Sans séparateur, offset négatif, ou session vide : jamais interprété.
    expect(() => decodeSessionCursor('pas-un-curseur')).toThrow();
    expect(() => decodeSessionCursor(encodeSessionCursor('s', -1))).toThrow();
    expect(() => decodeSessionCursor(encodeSessionCursor('', 0))).toThrow();
  });

  it('fait un aller-retour sur le curseur chronologique', () => {
    const at = new Date('2026-11-16T12:34:56.000Z');
    expect(decodeFeedTimeCursor(encodeFeedTimeCursor(at, 'post-1'))).toEqual({
      createdAt: at,
      id: 'post-1',
    });
  });

  it('refuse un curseur chronologique invalide', () => {
    expect(() => decodeFeedTimeCursor('n-importe-quoi')).toThrow();
  });
});
