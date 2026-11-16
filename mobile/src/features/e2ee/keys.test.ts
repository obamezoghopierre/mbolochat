import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MboloCrypto } from '../../../modules/mbolo-crypto/src';
import { resetActiveE2eeUserForTests, setActiveE2eeUser } from './activeUser';
import {
  accountUserId,
  createE2eeAccount,
  decryptWithSession,
  encryptWithAccount,
  ensureE2eeKeys,
  e2eeSqlCipherKey,
} from './keys';

vi.mock('../../../modules/mbolo-crypto/src', () => ({
  MboloCrypto: {
    supportsPerUserKeys: true,
    ensureKeysForUser: vi.fn(async () => ({ recovered: false })),
    sqlCipherKeyForUser: vi.fn(async () => ({ key: 'ab'.repeat(32) })),
    secureCreateAccountForUser: vi.fn(async () => ({
      account_pickle: 'pickle',
      curve25519: 'curve',
      ed25519: 'ed',
    })),
    secureEncryptForUser: vi.fn(async () => ({
      session_pickle: 'next',
      message: 'cipher',
      message_type: 'normal',
    })),
    ensureKeys: vi.fn(async () => ({ recovered: false })),
    sqlCipherKey: vi.fn(async () => ({ key: 'cd'.repeat(32) })),
    secureCreateAccount: vi.fn(async () => ({ account_pickle: 'legacy' })),
    secureEncrypt: vi.fn(async () => ({ message: 'legacy-cipher' })),
    secureDecrypt: vi.fn(async () => ({ session_pickle: 'next', plaintext_b64: 'clair' })),
  },
}));


describe('façade de clés par compte', () => {
  beforeEach(() => {
    resetActiveE2eeUserForTests();
    vi.clearAllMocks();
    (MboloCrypto as { supportsPerUserKeys: boolean }).supportsPerUserKeys = true;
  });

  it('refuse toute clé sans compte actif', async () => {
    await expect(ensureE2eeKeys('user-a', true)).rejects.toThrow('e2ee_no_active_user');
    expect(vi.mocked(MboloCrypto.ensureKeysForUser)).not.toHaveBeenCalled();
  });

  it('refuse les clés d’un compte qui n’est plus celui de la session', async () => {
    setActiveE2eeUser('user-a');
    await expect(ensureE2eeKeys('user-b', true)).rejects.toThrow('e2ee_account_mismatch');
    await expect(
      encryptWithAccount('user-b', 'session', 'clair'),
    ).rejects.toThrow('e2ee_account_mismatch');
  });

  it('transmet le compte actif et le drapeau de base existante au natif', async () => {
    setActiveE2eeUser('user-a');
    await ensureE2eeKeys('user-a', true);
    await e2eeSqlCipherKey('user-a', false);
    await createE2eeAccount('user-a');
    await encryptWithAccount('user-a', 'session', 'clair');

    expect(vi.mocked(MboloCrypto.ensureKeysForUser)).toHaveBeenCalledWith('user-a', true);
    expect(vi.mocked(MboloCrypto.sqlCipherKeyForUser)).toHaveBeenCalledWith('user-a', false);
    expect(vi.mocked(MboloCrypto.secureCreateAccountForUser)).toHaveBeenCalledWith('user-a');
    expect(vi.mocked(MboloCrypto.secureEncryptForUser)).toHaveBeenCalledWith(
      'user-a',
      'session',
      'clair',
    );
  });

  it('replie sur les méthodes historiques en développement', async () => {
    (MboloCrypto as { supportsPerUserKeys: boolean }).supportsPerUserKeys = false;
    setActiveE2eeUser('user-a');
    await decryptWithSession('user-a', 'session', 'normal', 'cipher');
    expect(vi.mocked(MboloCrypto.secureDecrypt)).toHaveBeenCalledWith(
      'session',
      'normal',
      'cipher',
    );
  });

  it('exige le propriétaire inscrit dans la ligne de compte', () => {
    setActiveE2eeUser('user-a');
    expect(accountUserId({ user_id: 'user-a' })).toBe('user-a');
    expect(() => accountUserId({ user_id: null })).toThrow('e2ee_account_owner_missing');
    expect(() => accountUserId({ user_id: 'user-b' })).toThrow('e2ee_account_mismatch');
  });
});
