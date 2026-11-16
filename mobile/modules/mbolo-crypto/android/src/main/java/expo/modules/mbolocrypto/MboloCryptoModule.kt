package expo.modules.mbolocrypto

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Les AsyncFunction d'Expo s'exécutent sur une file native dédiée : aucun
 * chiffrement ne doit tourner sur le fil JavaScript.
 */
class MboloCryptoModule : Module() {
  private val native = MboloCryptoNative()
  private val keyStore by lazy {
    E2eeKeyStore(requireNotNull(appContext.reactContext) { "Contexte Android indisponible" })
  }

  override fun definition() = ModuleDefinition {
    Name("MboloCrypto")

    Function("version") {
      native.nativeVersion()
    }

    /** Les clés sont isolées par compte dans ce build. */
    Function("supportsPerUserKeys") { true }

    // Fonctions brutes (écran spike, gated dev) : la clé de pickle arrive en
    // Uint8Array depuis JS et part en ByteArray vers le noyau Rust.
    AsyncFunction("createAccount") { pickleKey: ByteArray ->
      native.nativeCreateAccount(pickleKey)
    }

    AsyncFunction("generateOneTimeKeys") { accountPickle: String, pickleKey: ByteArray, count: Int ->
      native.nativeGenerateOneTimeKeys(accountPickle, pickleKey, count)
    }

    AsyncFunction("createOutbound") {
      accountPickle: String,
      pickleKey: ByteArray,
      identityKey: String,
      oneTimeKey: String,
      plaintextB64: String,
      ->
      native.nativeCreateOutbound(accountPickle, pickleKey, identityKey, oneTimeKey, plaintextB64)
    }

    AsyncFunction("encrypt") { sessionPickle: String, pickleKey: ByteArray, plaintextB64: String ->
      native.nativeEncrypt(sessionPickle, pickleKey, plaintextB64)
    }

    AsyncFunction("createInbound") {
      accountPickle: String,
      pickleKey: ByteArray,
      identityKey: String,
      prekeyMessage: String,
      ->
      native.nativeCreateInbound(accountPickle, pickleKey, identityKey, prekeyMessage)
    }

    AsyncFunction("decrypt") {
      sessionPickle: String,
      pickleKey: ByteArray,
      messageType: String,
      messageB64: String,
      ->
      native.nativeDecrypt(sessionPickle, pickleKey, messageType, messageB64)
    }

    AsyncFunction("encryptFile") { inputPath: String, outputPath: String ->
      native.nativeEncryptFile(inputPath, outputPath)
    }

    AsyncFunction("decryptFile") {
      inputPath: String,
      outputPath: String,
      key: ByteArray,
      nonce: ByteArray,
      expectedSha256: String,
      ->
      native.nativeDecryptFile(inputPath, outputPath, key, nonce, expectedSha256)
    }

    AsyncFunction("selfTest") { workDir: String, fileMb: Int ->
      native.nativeSelfTest(workDir, fileMb)
    }

    AsyncFunction("ensureKeys") {
      keyStore.ensureKeysJson()
    }

    AsyncFunction("sqlCipherKey") {
      keyStore.sqlCipherKeyJson()
    }

    AsyncFunction("secureCreateAccount") {
      keyStore.createAccountJson(native)
    }

    AsyncFunction("secureGenerateOneTimeKeys") { accountPickle: String, count: Int ->
      keyStore.generateOneTimeKeysJson(native, accountPickle, count)
    }

    AsyncFunction("secureGenerateOneTimeKeysSigned") { accountPickle: String, count: Int ->
      keyStore.generateOneTimeKeysSignedJson(native, accountPickle, count)
    }

    AsyncFunction("secureGenerateFallbackKey") { accountPickle: String ->
      keyStore.generateFallbackKeyJson(native, accountPickle)
    }

    AsyncFunction("verifyPrekey") { signingKey: String, prekey: String, signature: String ->
      native.nativeVerifyPrekey(signingKey, prekey, signature)
    }

    AsyncFunction("secureCreateOutbound") {
      accountPickle: String,
      identityKey: String,
      oneTimeKey: String,
      plaintextB64: String,
      ->
      keyStore.createOutboundJson(native, accountPickle, identityKey, oneTimeKey, plaintextB64)
    }

    AsyncFunction("secureEncrypt") { sessionPickle: String, plaintextB64: String ->
      keyStore.encryptJson(native, sessionPickle, plaintextB64)
    }

    AsyncFunction("secureCreateInbound") {
      accountPickle: String,
      identityKey: String,
      prekeyMessage: String,
      ->
      keyStore.createInboundJson(native, accountPickle, identityKey, prekeyMessage)
    }

    AsyncFunction("secureDecrypt") {
      sessionPickle: String,
      messageType: String,
      messageB64: String,
      ->
      keyStore.decryptJson(native, sessionPickle, messageType, messageB64)
    }

    AsyncFunction("simulateKeyLoss") {
      keyStore.simulateKeyLossJson()
    }

    // ------------------------ Clés isolées par compte ------------------------

    AsyncFunction("ensureKeysForUser") { userId: String, existingDatabase: Boolean ->
      keyStore.ensureKeysForUserJson(userId, existingDatabase)
    }

    AsyncFunction("sqlCipherKeyForUser") { userId: String, existingDatabase: Boolean ->
      keyStore.sqlCipherKeyForUserJson(userId, existingDatabase)
    }

    AsyncFunction("secureCreateAccountForUser") { userId: String ->
      keyStore.createAccountForUserJson(native, userId)
    }

    AsyncFunction("secureGenerateOneTimeKeysForUser") {
      userId: String,
      accountPickle: String,
      count: Int,
      ->
      keyStore.generateOneTimeKeysForUserJson(native, userId, accountPickle, count)
    }

    AsyncFunction("secureGenerateOneTimeKeysSignedForUser") {
      userId: String,
      accountPickle: String,
      count: Int,
      ->
      keyStore.generateOneTimeKeysSignedForUserJson(native, userId, accountPickle, count)
    }

    AsyncFunction("secureGenerateFallbackKeyForUser") { userId: String, accountPickle: String ->
      keyStore.generateFallbackKeyForUserJson(native, userId, accountPickle)
    }

    AsyncFunction("secureCreateOutboundForUser") {
      userId: String,
      accountPickle: String,
      identityKey: String,
      oneTimeKey: String,
      plaintextB64: String,
      ->
      keyStore.createOutboundForUserJson(
        native,
        userId,
        accountPickle,
        identityKey,
        oneTimeKey,
        plaintextB64,
      )
    }

    AsyncFunction("secureEncryptForUser") {
      userId: String,
      sessionPickle: String,
      plaintextB64: String,
      ->
      keyStore.encryptForUserJson(native, userId, sessionPickle, plaintextB64)
    }

    AsyncFunction("secureCreateInboundForUser") {
      userId: String,
      accountPickle: String,
      identityKey: String,
      prekeyMessage: String,
      ->
      keyStore.createInboundForUserJson(native, userId, accountPickle, identityKey, prekeyMessage)
    }

    AsyncFunction("secureDecryptForUser") {
      userId: String,
      sessionPickle: String,
      messageType: String,
      messageB64: String,
      ->
      keyStore.decryptForUserJson(native, userId, sessionPickle, messageType, messageB64)
    }

    AsyncFunction("simulateKeyLossForUser") { userId: String ->
      keyStore.simulateKeyLossForUserJson(userId)
    }
  }
}
