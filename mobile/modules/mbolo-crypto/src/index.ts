import { NativeModule, requireNativeModule } from 'expo-modules-core';

export type AccountCreated = {
  account_pickle: string;
  curve25519: string;
  ed25519: string;
};

export type OneTimeKey = { key_id: string; key: string };
export type OneTimeKeysGenerated = { account_pickle: string; keys: OneTimeKey[] };
export type SignedOneTimeKey = { key_id: string; key: string; signature: string };
export type OneTimeKeysSigned = { account_pickle: string; keys: SignedOneTimeKey[] };
export type FallbackKeySigned = {
  account_pickle: string;
  key_id: string;
  key: string;
  signature: string;
};
export type OutboundCreated = {
  session_pickle: string;
  session_id: string;
  message_type: string;
  message: string;
};
export type OlmEnvelope = OutboundCreated;
export type InboundCreated = OlmEnvelope & {
  account_pickle: string;
  plaintext_b64: string;
};
export type PlaintextDecrypted = { session_pickle: string; plaintext_b64: string };
export type SelfTestStep = { key: string; ms: number };
export type SelfTestReport = {
  file_mb: number;
  plaintext_size: number;
  ciphertext_size: number;
  steps: SelfTestStep[];
};

export type FileEncrypted = {
  file_key_b64: string;
  nonce_b64: string;
  sha256_hex: string;
  plaintext_size: number;
  ciphertext_size: number;
};

declare class MboloCryptoModule extends NativeModule {
  version(): string;
  createAccount(pickleKey: Uint8Array): Promise<string>;
  generateOneTimeKeys(accountPickle: string, pickleKey: Uint8Array, count: number): Promise<string>;
  createOutbound(
    accountPickle: string,
    pickleKey: Uint8Array,
    identityKey: string,
    oneTimeKey: string,
    plaintextB64: string,
  ): Promise<string>;
  encrypt(sessionPickle: string, pickleKey: Uint8Array, plaintextB64: string): Promise<string>;
  createInbound(
    accountPickle: string,
    pickleKey: Uint8Array,
    identityKey: string,
    prekeyMessage: string,
  ): Promise<string>;
  decrypt(
    sessionPickle: string,
    pickleKey: Uint8Array,
    messageType: string,
    messageB64: string,
  ): Promise<string>;
  encryptFile(inputPath: string, outputPath: string): Promise<string>;
  decryptFile(
    inputPath: string,
    outputPath: string,
    key: Uint8Array,
    nonce: Uint8Array,
    expectedSha256: string,
  ): Promise<string>;
  selfTest(workDir: string, fileMb: number): Promise<string>;
  ensureKeys(): Promise<string>;
  sqlCipherKey(): Promise<string>;
  secureCreateAccount(): Promise<string>;
  secureGenerateOneTimeKeys(accountPickle: string, count: number): Promise<string>;
  secureGenerateOneTimeKeysSigned(accountPickle: string, count: number): Promise<string>;
  secureGenerateFallbackKey(accountPickle: string): Promise<string>;
  verifyPrekey(signingKey: string, prekey: string, signature: string): Promise<string>;
  secureCreateOutbound(
    accountPickle: string,
    identityKey: string,
    oneTimeKey: string,
    plaintextB64: string,
  ): Promise<string>;
  secureEncrypt(sessionPickle: string, plaintextB64: string): Promise<string>;
  secureCreateInbound(
    accountPickle: string,
    identityKey: string,
    prekeyMessage: string,
  ): Promise<string>;
  secureDecrypt(sessionPickle: string, messageType: string, messageB64: string): Promise<string>;
  simulateKeyLoss(): Promise<string>;
  // Clés isolées par compte (builds récents). Absentes d'un build antérieur :
  // `supportsPerUserKeys` permet de le détecter sans appeler une méthode absente.
  supportsPerUserKeys?(): boolean;
  ensureKeysForUser?(userId: string, existingDatabase: boolean): Promise<string>;
  sqlCipherKeyForUser?(userId: string, existingDatabase: boolean): Promise<string>;
  secureCreateAccountForUser?(userId: string): Promise<string>;
  secureGenerateOneTimeKeysSignedForUser?(
    userId: string,
    accountPickle: string,
    count: number,
  ): Promise<string>;
  secureGenerateFallbackKeyForUser?(userId: string, accountPickle: string): Promise<string>;
  secureCreateOutboundForUser?(
    userId: string,
    accountPickle: string,
    identityKey: string,
    oneTimeKey: string,
    plaintextB64: string,
  ): Promise<string>;
  secureEncryptForUser?(
    userId: string,
    sessionPickle: string,
    plaintextB64: string,
  ): Promise<string>;
  secureCreateInboundForUser?(
    userId: string,
    accountPickle: string,
    identityKey: string,
    prekeyMessage: string,
  ): Promise<string>;
  secureDecryptForUser?(
    userId: string,
    sessionPickle: string,
    messageType: string,
    messageB64: string,
  ): Promise<string>;
  simulateKeyLossForUser?(userId: string): Promise<string>;
}

type NativeResult<T> = { ok: true; data: T } | { ok: false; error: string };

const native = requireNativeModule<MboloCryptoModule>('MboloCrypto');

async function invoke<T>(pending: Promise<string>): Promise<T> {
  const parsed = JSON.parse(await pending) as NativeResult<T>;
  if (!parsed.ok) {
    throw new Error(`mbolo-crypto: ${parsed.error}`);
  }
  return parsed.data;
}

export const MboloCrypto = {
  version: native.version(),
  createAccount: (pickleKey: Uint8Array) => invoke<AccountCreated>(native.createAccount(pickleKey)),
  generateOneTimeKeys: (accountPickle: string, pickleKey: Uint8Array, count: number) =>
    invoke<OneTimeKeysGenerated>(native.generateOneTimeKeys(accountPickle, pickleKey, count)),
  createOutbound: (
    accountPickle: string,
    pickleKey: Uint8Array,
    identityKey: string,
    oneTimeKey: string,
    plaintextB64: string,
  ) =>
    invoke<OutboundCreated>(
      native.createOutbound(accountPickle, pickleKey, identityKey, oneTimeKey, plaintextB64),
    ),
  encrypt: (sessionPickle: string, pickleKey: Uint8Array, plaintextB64: string) =>
    invoke<OlmEnvelope>(native.encrypt(sessionPickle, pickleKey, plaintextB64)),
  createInbound: (
    accountPickle: string,
    pickleKey: Uint8Array,
    identityKey: string,
    prekeyMessage: string,
  ) =>
    invoke<InboundCreated>(
      native.createInbound(accountPickle, pickleKey, identityKey, prekeyMessage),
    ),
  decrypt: (sessionPickle: string, pickleKey: Uint8Array, messageType: string, messageB64: string) =>
    invoke<PlaintextDecrypted>(native.decrypt(sessionPickle, pickleKey, messageType, messageB64)),
  encryptFile: (inputPath: string, outputPath: string) =>
    invoke<FileEncrypted>(native.encryptFile(inputPath, outputPath)),
  decryptFile: (
    inputPath: string,
    outputPath: string,
    key: Uint8Array,
    nonce: Uint8Array,
    expectedSha256: string,
  ) =>
    invoke<{ plaintext_size: number }>(
      native.decryptFile(inputPath, outputPath, key, nonce, expectedSha256),
    ),
  selfTest: (workDir: string, fileMb: number) =>
    invoke<SelfTestReport>(native.selfTest(workDir, fileMb)),
  ensureKeys: () => invoke<{ recovered: boolean }>(native.ensureKeys()),
  sqlCipherKey: () => invoke<{ key: string }>(native.sqlCipherKey()),
  secureCreateAccount: () => invoke<AccountCreated>(native.secureCreateAccount()),
  secureGenerateOneTimeKeys: (accountPickle: string, count: number) =>
    invoke<OneTimeKeysGenerated>(native.secureGenerateOneTimeKeys(accountPickle, count)),
  secureGenerateOneTimeKeysSigned: (accountPickle: string, count: number) =>
    invoke<OneTimeKeysSigned>(native.secureGenerateOneTimeKeysSigned(accountPickle, count)),
  secureGenerateFallbackKey: (accountPickle: string) =>
    invoke<FallbackKeySigned>(native.secureGenerateFallbackKey(accountPickle)),
  verifyPrekey: (signingKey: string, prekey: string, signature: string) =>
    invoke<{ valid: boolean }>(native.verifyPrekey(signingKey, prekey, signature)),
  secureCreateOutbound: (
    accountPickle: string,
    identityKey: string,
    oneTimeKey: string,
    plaintextB64: string,
  ) =>
    invoke<OutboundCreated>(
      native.secureCreateOutbound(accountPickle, identityKey, oneTimeKey, plaintextB64),
    ),
  secureEncrypt: (sessionPickle: string, plaintextB64: string) =>
    invoke<OlmEnvelope>(native.secureEncrypt(sessionPickle, plaintextB64)),
  secureCreateInbound: (accountPickle: string, identityKey: string, prekeyMessage: string) =>
    invoke<InboundCreated>(native.secureCreateInbound(accountPickle, identityKey, prekeyMessage)),
  secureDecrypt: (sessionPickle: string, messageType: string, messageB64: string) =>
    invoke<PlaintextDecrypted>(native.secureDecrypt(sessionPickle, messageType, messageB64)),
  simulateKeyLoss: () => invoke<{ simulated: boolean }>(native.simulateKeyLoss()),
  // Le support est lu une fois : un build sans clés par compte renvoie `false`
  // et la couche JS refuse alors les opérations hors développement.
  supportsPerUserKeys: (() => {
    try {
      return native.supportsPerUserKeys?.() === true;
    } catch {
      return false;
    }
  })(),
  ensureKeysForUser: (userId: string, existingDatabase: boolean) =>
    invoke<{ recovered: boolean }>(
      native.ensureKeysForUser!(userId, existingDatabase),
    ),
  sqlCipherKeyForUser: (userId: string, existingDatabase: boolean) =>
    invoke<{ key: string }>(native.sqlCipherKeyForUser!(userId, existingDatabase)),
  secureCreateAccountForUser: (userId: string) =>
    invoke<AccountCreated>(native.secureCreateAccountForUser!(userId)),
  secureGenerateOneTimeKeysSignedForUser: (
    userId: string,
    accountPickle: string,
    count: number,
  ) => invoke<OneTimeKeysSigned>(native.secureGenerateOneTimeKeysSignedForUser!(userId, accountPickle, count)),
  secureGenerateFallbackKeyForUser: (userId: string, accountPickle: string) =>
    invoke<FallbackKeySigned>(native.secureGenerateFallbackKeyForUser!(userId, accountPickle)),
  secureCreateOutboundForUser: (
    userId: string,
    accountPickle: string,
    identityKey: string,
    oneTimeKey: string,
    plaintextB64: string,
  ) =>
    invoke<OutboundCreated>(
      native.secureCreateOutboundForUser!(
        userId,
        accountPickle,
        identityKey,
        oneTimeKey,
        plaintextB64,
      ),
    ),
  secureEncryptForUser: (userId: string, sessionPickle: string, plaintextB64: string) =>
    invoke<OlmEnvelope>(native.secureEncryptForUser!(userId, sessionPickle, plaintextB64)),
  secureCreateInboundForUser: (
    userId: string,
    accountPickle: string,
    identityKey: string,
    prekeyMessage: string,
  ) =>
    invoke<InboundCreated>(
      native.secureCreateInboundForUser!(userId, accountPickle, identityKey, prekeyMessage),
    ),
  secureDecryptForUser: (
    userId: string,
    sessionPickle: string,
    messageType: string,
    messageB64: string,
  ) =>
    invoke<PlaintextDecrypted>(
      native.secureDecryptForUser!(userId, sessionPickle, messageType, messageB64),
    ),
  simulateKeyLossForUser: (userId: string) =>
    invoke<{ simulated: boolean }>(native.simulateKeyLossForUser!(userId)),
};

export default MboloCrypto;
