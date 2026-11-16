import { describe, expect, it } from 'vitest';

import {
  countUnread,
  markReadLocally,
  mergeNotificationPage,
  notificationLabel,
} from './notifications-model';
import type { SocialNotification } from '@/lib/types';

function notification(overrides: Partial<SocialNotification> = {}): SocialNotification {
  return {
    id: 'n1',
    type: 'like',
    publicationId: 'p1',
    commentId: null,
    storyId: null,
    readAt: null,
    createdAt: '2026-11-16T10:00:00.000Z',
    actor: {
      id: 'u1',
      username: 'fan',
      displayName: 'Fan',
      avatarUrl: null,
      verified: false,
    },
    ...overrides,
  };
}

describe('notificationLabel', () => {
  it('compose une phrase par type', () => {
    expect(notificationLabel('like', 'Awa')).toBe('Awa a réagi à ta publication');
    expect(notificationLabel('follow_request', 'Awa')).toBe('Awa demande à te suivre');
    expect(notificationLabel('follow_accepted', 'Awa')).toBe('Awa a accepté ta demande');
    expect(notificationLabel('moderation', 'Awa')).toBe('Décision de modération');
  });
});

describe('markReadLocally', () => {
  it('marque tout comme lu', () => {
    const items = markReadLocally([notification(), notification({ id: 'n2' })]);
    expect(items.every((item) => item.readAt !== null)).toBe(true);
  });

  it('ne marque que les identifiants demandés', () => {
    const items = markReadLocally(
      [notification(), notification({ id: 'n2' })],
      ['n2'],
    );
    expect(items[0].readAt).toBeNull();
    expect(items[1].readAt).not.toBeNull();
  });

  it('ne modifie pas une notification déjà lue', () => {
    const read = notification({ readAt: '2026-01-01T00:00:00.000Z' });
    const items = markReadLocally([read]);
    expect(items[0].readAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('countUnread', () => {
  it('compte uniquement les non-lues', () => {
    expect(
      countUnread([
        notification(),
        notification({ id: 'n2', readAt: '2026-01-01T00:00:00.000Z' }),
        notification({ id: 'n3' }),
      ]),
    ).toBe(2);
  });
});

describe('mergeNotificationPage', () => {
  it('ajoute sans doublon et conserve le curseur', () => {
    const merged = mergeNotificationPage([notification({ id: 'a' })], {
      items: [notification({ id: 'a' }), notification({ id: 'b' })],
      nextCursor: 'suite',
    });
    expect(merged.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(merged.nextCursor).toBe('suite');
  });
});
