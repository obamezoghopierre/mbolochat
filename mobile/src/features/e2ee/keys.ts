import { MboloCrypto } from '../../../modules/mbolo-crypto/src';
import { assertActiveE2eeUser } from './activeUser';

/**
 * Point d'entrée unique des opérations de clé.
 *
 * Chaque appel vérifie d'abord que `userId` est **le compte actif** de la
 * session, puis utilise les clés propres à ce compte. Un build natif antérieur
 * aux clés par compte est refusé hors développement : en production, mieux
 * vaut ne pas chiffrer que chiffrer avec une clé partagée entre identités.
 */

const DEV =
  typeof __DEV__ === 'undefined'
    ? process.env.NODE_ENV !== 'production'
    : __DEV__;

let warnedLegacy = false;

export function perUserKeysSupported(): boolean {
  return MboloCrypto.supportsPerUserKeys === true;
}

function requirePerUser(operation: string): void {
  if (perUserKeysSupported()) return;
  if (!DEV) {
    throw new Error(`e2ee_native_outdated:${operation}`);
  }
  if (!warnedLegacy) {
    warnedLegacy = true;
    console.warn(
      '[e2ee] build natif sans clés par compte : repli sur la clé globale en développement',
    );
  }
}

type Crypto = typeof MboloCrypto;
type AccountCreated = Awaited<ReturnType<Crypto['secureCreateAccount']>>;
type OneTimeKeysSigned = Awaited<ReturnType<Crypto['secureGenerateOneTimeKeysSigned']>>;
type FallbackKeySigned = Awaited<ReturnType<Crypto['secureGenerateFallbackKey']>>;
type OutboundCreated = Awaited<ReturnType<Crypto['secureCreateOutbound']>>;
type OlmEnvelope = Awaited<ReturnType<Crypto['secureEncrypt']>>;
type InboundCreated = Awaited<ReturnType<Crypto['secureCreateInbound']>>;
type PlaintextDecrypted = Awaited<ReturnType<Crypto['secureDecrypt']>>;

/** Clés (et éventuelle récupération) du compte, jamais d'un autre. */
export async function ensureE2eeKeys(
  userId: string,
  existingDatabase: boolean,
): Promise<{ recovered: boolean }> {
  assertActiveE2eeUser(userId, 'ensure_keys');
  requirePerUser('ensure_keys');
  return perUserKeysSupported()
    ? await MboloCrypto.ensureKeysForUser!(userId, existingDatabase)
    : await MboloCrypto.ensureKeys();
}

/** Clé SQLCipher du compte, liée à la même matérialisation que ses pickles. */
export async function e2eeSqlCipherKey(
  userId: string,
  existingDatabase: boolean,
): Promise<{ key: string }> {
  assertActiveE2eeUser(userId, 'sqlcipher_key');
  requirePerUser('sqlcipher_key');
  return perUserKeysSupported()
    ? await MboloCrypto.sqlCipherKeyForUser!(userId, existingDatabase)
    : await MboloCrypto.sqlCipherKey();
}

export async function createE2eeAccount(userId: string): Promise<AccountCreated> {
  assertActiveE2eeUser(userId, 'create_account');
  requirePerUser('create_account');
  return perUserKeysSupported()
    ? await MboloCrypto.secureCreateAccountForUser!(userId)
    : await MboloCrypto.secureCreateAccount();
}

export async function generateSignedOneTimeKeys(
  userId: string,
  accountPickle: string,
  count: number,
): Promise<OneTimeKeysSigned> {
  assertActiveE2eeUser(userId, 'generate_prekeys');
  requirePerUser('generate_prekeys');
  return perUserKeysSupported()
    ? await MboloCrypto.secureGenerateOneTimeKeysSignedForUser!(userId, accountPickle, count)
    : await MboloCrypto.secureGenerateOneTimeKeysSigned(accountPickle, count);
}

export async function generateFallbackKey(
  userId: string,
  accountPickle: string,
): Promise<FallbackKeySigned> {
  assertActiveE2eeUser(userId, 'generate_fallback');
  requirePerUser('generate_fallback');
  return perUserKeysSupported()
    ? await MboloCrypto.secureGenerateFallbackKeyForUser!(userId, accountPickle)
    : await MboloCrypto.secureGenerateFallbackKey(accountPickle);
}

export async function encryptWithAccount(
  userId: string,
  sessionPickle: string,
  plaintextB64: string,
): Promise<OlmEnvelope> {
  assertActiveE2eeUser(userId, 'encrypt');
  requirePerUser('encrypt');
  return perUserKeysSupported()
    ? await MboloCrypto.secureEncryptForUser!(userId, sessionPickle, plaintextB64)
    : await MboloCrypto.secureEncrypt(sessionPickle, plaintextB64);
}

export async function createOutboundSession(
  userId: string,
  accountPickle: string,
  identityKey: string,
  oneTimeKey: string,
  plaintextB64: string,
): Promise<OutboundCreated> {
  assertActiveE2eeUser(userId, 'create_outbound');
  requirePerUser('create_outbound');
  return perUserKeysSupported()
    ? await MboloCrypto.secureCreateOutboundForUser!(
        userId,
        accountPickle,
        identityKey,
        oneTimeKey,
        plaintextB64,
      )
    : await MboloCrypto.secureCreateOutbound(accountPickle, identityKey, oneTimeKey, plaintextB64);
}

export async function createInboundSession(
  userId: string,
  accountPickle: string,
  identityKey: string,
  prekeyMessage: string,
): Promise<InboundCreated> {
  assertActiveE2eeUser(userId, 'create_inbound');
  requirePerUser('create_inbound');
  return perUserKeysSupported()
    ? await MboloCrypto.secureCreateInboundForUser!(userId, accountPickle, identityKey, prekeyMessage)
    : await MboloCrypto.secureCreateInbound(accountPickle, identityKey, prekeyMessage);
}

export async function decryptWithSession(
  userId: string,
  sessionPickle: string,
  messageType: string,
  messageB64: string,
): Promise<PlaintextDecrypted> {
  assertActiveE2eeUser(userId, 'decrypt');
  requirePerUser('decrypt');
  return perUserKeysSupported()
    ? await MboloCrypto.secureDecryptForUser!(userId, sessionPickle, messageType, messageB64)
    : await MboloCrypto.secureDecrypt(sessionPickle, messageType, messageB64);
}

/** Outil de développement : ne touche que les clés du compte actif. */
export async function simulateKeyLoss(userId: string): Promise<{ simulated: boolean }> {
  assertActiveE2eeUser(userId, 'simulate_key_loss');
  requirePerUser('simulate_key_loss');
  return perUserKeysSupported()
    ? await MboloCrypto.simulateKeyLossForUser!(userId)
    : await MboloCrypto.simulateKeyLoss();
}

/** Propriétaire d'un compte local, obligatoire pour toute opération de clé. */
export function accountUserId(account: { user_id?: string | null }): string {
  const userId = account.user_id;
  if (!userId) {
    throw new Error('e2ee_account_owner_missing');
  }
  return assertActiveE2eeUser(userId, 'account_owner');
}
