import { describe, expect, it } from 'vitest';

import { friendsWithoutDisplayedDirectChats } from './friend-search';
import type { FriendSearchResult } from './friends-api';

const friend = (id: string): FriendSearchResult => ({
  id,
  username: `${id}_user`,
  displayName: `${id} user`,
  avatarUrl: null,
  gender: null,
});

describe('friendsWithoutDisplayedDirectChats', () => {
  it('exclut les amis déjà affichés et déduplique les résultats serveur', () => {
    const results = [friend('already-open'), friend('new'), friend('new'), friend('another')];

    expect(friendsWithoutDisplayedDirectChats(results, new Set(['already-open']))).toEqual([
      friend('new'),
      friend('another'),
    ]);
  });

  it('ne modifie ni les résultats ni l’ensemble des discussions', () => {
    const results = [friend('visible'), friend('new')];
    const displayed = new Set(['visible']);

    friendsWithoutDisplayedDirectChats(results, displayed);

    expect(results).toHaveLength(2);
    expect(displayed).toEqual(new Set(['visible']));
  });
});
