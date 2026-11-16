import { beforeEach, describe, expect, it } from 'vitest';

import {
  assertActiveE2eeUser,
  getActiveE2eeUser,
  resetActiveE2eeUserForTests,
  setActiveE2eeUser,
  waitForActiveE2eeUser,
} from './activeUser';

describe('identité E2EE active', () => {
  beforeEach(() => {
    resetActiveE2eeUserForTests();
  });

  it('accepte uniquement le compte de la session', () => {
    setActiveE2eeUser('user-a');
    expect(getActiveE2eeUser()).toBe('user-a');
    expect(assertActiveE2eeUser('user-a', 'open')).toBe('user-a');
  });

  it('refuse un autre compte, même valide', () => {
    setActiveE2eeUser('user-a');
    expect(() => assertActiveE2eeUser('user-b', 'open')).toThrow(
      'e2ee_account_mismatch:open',
    );
  });

  it('refuse toute opération après déconnexion', () => {
    setActiveE2eeUser(null);
    expect(() => assertActiveE2eeUser('user-a', 'open')).toThrow('e2ee_no_active_user:open');
    expect(() => assertActiveE2eeUser(undefined, 'open')).toThrow('e2ee_user_missing:open');
  });

  it('attend l’attachement asynchrone de la session', async () => {
    const waiting = waitForActiveE2eeUser('user-a', 'open', 500);
    setActiveE2eeUser('user-a');
    await expect(waiting).resolves.toBe('user-a');
  });

  it('refuse un autre compte pendant l’attente', async () => {
    const waiting = waitForActiveE2eeUser('user-a', 'open', 500);
    setActiveE2eeUser('user-b');
    await expect(waiting).rejects.toThrow('e2ee_account_mismatch:open');
  });

  it('échoue vite après une déconnexion', async () => {
    const waiting = waitForActiveE2eeUser('user-a', 'open', 500);
    setActiveE2eeUser(null);
    await expect(waiting).rejects.toThrow('e2ee_no_active_user:open');
  });

  it('échoue au délai si la session ne vient pas', async () => {
    await expect(waitForActiveE2eeUser('user-a', 'open', 10)).rejects.toThrow(
      'e2ee_no_active_user:open',
    );
  });
});
