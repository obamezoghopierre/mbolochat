import { describe, expect, it } from 'vitest';

import { followAction, followLabelKey } from './follow-state';

describe('followAction', () => {
  it('suit un compte sans relation', () => {
    expect(followAction('none')).toBe('follow');
  });

  it('annule une demande en attente', () => {
    expect(followAction('pending')).toBe('cancel');
  });

  it('se désabonne d’un abonnement accepté', () => {
    expect(followAction('accepted')).toBe('unfollow');
  });
});

describe('followLabelKey', () => {
  it('associe chaque état à son libellé', () => {
    expect(followLabelKey('none')).toBe('follow');
    expect(followLabelKey('pending')).toBe('requested');
    expect(followLabelKey('accepted')).toBe('unfollow');
  });
});
