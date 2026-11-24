import type { FriendSearchResult } from './friends-api';

/** Déduplique les résultats et retire les personnes déjà visibles en discussion directe. */
export function friendsWithoutDisplayedDirectChats(
  friends: FriendSearchResult[],
  displayedPeerIds: ReadonlySet<string>,
): FriendSearchResult[] {
  const seen = new Set<string>();
  return friends.filter((friend) => {
    if (displayedPeerIds.has(friend.id) || seen.has(friend.id)) return false;
    seen.add(friend.id);
    return true;
  });
}
