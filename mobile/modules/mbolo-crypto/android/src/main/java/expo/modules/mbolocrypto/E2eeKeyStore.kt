package expo.modules.mbolocrypto

import android.content.Context
import android.content.pm.ApplicationInfo
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/**
 * Clé AES non exportable du Keystore Android qui protège les matières
 * cryptographiques locales. Les clés en clair ne quittent jamais Kotlin vers
 * JavaScript.
 *
 * Depuis l'isolation multi-compte, chaque compte possède **sa** matière
 * (clé de pickle Olm + clé SQLCipher), stockée sous son propre identifiant dans
 * les préférences et chiffrée par la clé maîtresse du Keystore. L'identifiant
 * est aussi inscrit dans le blob : relire la matière d'un compte avec l'entrée
 * d'un autre échoue explicitement.
 *
 * Les méthodes `*Json` sans `userId` restent l'ancien chemin global, uniquement
 * pour migrer une base existante et pour les outils d'un build antérieur.
 */
class E2eeKeyStore(private val context: Context) {
  private val prefs = context.getSharedPreferences("mbolo_e2ee_keys_v1", Context.MODE_PRIVATE)
  private val alias = "mbolo_e2ee_master_v1"

  private data class Material(
    val pickleKey: ByteArray,
    val dbKey: ByteArray,
    val recovered: Boolean = false,
  )

  private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun secretKey(): SecretKey {
    val store = keyStore()
    (store.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        alias,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return generator.generateKey()
  }

  private fun encrypt(material: ByteArray): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, secretKey())
    val encrypted = cipher.doFinal(material)
    val combined = ByteArray(cipher.iv.size + encrypted.size)
    cipher.iv.copyInto(combined)
    encrypted.copyInto(combined, cipher.iv.size)
    return Base64.encodeToString(combined, Base64.NO_WRAP)
  }

  private fun decrypt(encoded: String): ByteArray {
    val combined = Base64.decode(encoded, Base64.NO_WRAP)
    if (combined.size < 13) throw IllegalStateException("short blob")
    val iv = combined.copyOfRange(0, 12)
    val payload = combined.copyOfRange(12, combined.size)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
    return cipher.doFinal(payload)
  }

  private fun randomKey(): ByteArray = ByteArray(32).also { SecureRandom().nextBytes(it) }

  private fun freshMaterial(recovered: Boolean = false): Material =
    Material(randomKey(), randomKey(), recovered = recovered)

  /** Identifiant de préférence propre à un compte, sans caractère exotique. */
  private fun entryKey(userId: String): String =
    "material:" + MessageDigest.getInstance("SHA-256")
      .digest(userId.toByteArray(Charsets.UTF_8))
      .joinToString("") { "%02x".format(it) }

  private fun requireUserId(userId: String): String {
    val clean = userId.trim()
    if (clean.isEmpty() || clean.length > 200) {
      throw IllegalArgumentException("invalid user id")
    }
    return clean
  }

  private fun serialize(material: Material, userId: String?): String =
    JSONObject()
      .put("p", Base64.encodeToString(material.pickleKey, Base64.NO_WRAP))
      .put("d", Base64.encodeToString(material.dbKey, Base64.NO_WRAP))
      .apply { if (userId != null) put("u", userId) }
      .toString()

  private fun parse(bytes: ByteArray, expectedUser: String?): Material {
    val json = JSONObject(String(bytes, Charsets.UTF_8))
    if (expectedUser != null) {
      val storedUser = json.optString("u", "")
      if (storedUser != expectedUser) {
        throw IllegalStateException("material owner mismatch")
      }
    }
    val pickle = Base64.decode(json.getString("p"), Base64.NO_WRAP)
    val database = Base64.decode(json.getString("d"), Base64.NO_WRAP)
    if (pickle.size != 32 || database.size != 32) throw IllegalStateException("bad material")
    return Material(pickle, database, recovered = false)
  }

  private fun store(userId: String, material: Material) {
    prefs.edit()
      .putString(entryKey(userId), encrypt(serialize(material, userId).toByteArray()))
      .apply()
  }

  /** Ancienne matière globale, lue seulement pour migrer une base existante. */
  private fun legacyMaterial(): Material? {
    if (!prefs.getBoolean("initialized", false)) return null
    val stored = prefs.getString("material", null) ?: return null
    return try {
      parse(decrypt(stored), expectedUser = null)
    } catch (_: Throwable) {
      null
    }
  }

  /**
   * Matière du compte, créée au premier besoin.
   *
   * `existingDatabase` autorise l'adoption de l'ancienne matière globale : une
   * base déjà présente sur l'appareil a été chiffrée avec elle. Une base neuve
   * reçoit en revanche toujours une matière fraîche, même si l'ancienne existe.
   */
  private fun ensureMaterial(userId: String, existingDatabase: Boolean): Material {
    val clean = requireUserId(userId)
    val key = entryKey(clean)
    val stored = prefs.getString(key, null)
    if (stored != null) {
      return try {
        parse(decrypt(stored), clean)
      } catch (_: Throwable) {
        // Blob du compte illisible : on repart d'une matière neuve. La base de
        // ce compte devient illisible et sera mise en quarantaine par l'appelant.
        val replaced = freshMaterial(recovered = true)
        store(clean, replaced)
        replaced
      }
    }
    if (existingDatabase) {
      legacyMaterial()?.let { legacy ->
        val adopted = legacy.copy(recovered = false)
        store(clean, adopted)
        return adopted
      }
      // Base présente mais aucune matière lisible : la clé est perdue.
      val recovered = freshMaterial(recovered = true)
      store(clean, recovered)
      return recovered
    }
    val fresh = freshMaterial()
    store(clean, fresh)
    return fresh
  }

  /** Matière déjà créée : ne jamais en générer une nouvelle pour un pickle existant. */
  private fun requireMaterial(userId: String): Material {
    val clean = requireUserId(userId)
    val stored = prefs.getString(entryKey(clean), null)
      ?: throw IllegalStateException("keystore material missing")
    return parse(decrypt(stored), clean)
  }

  private fun zero(material: Material) {
    material.pickleKey.fill(0)
    material.dbKey.fill(0)
  }

  private fun ok(data: JSONObject): String = JSONObject().put("ok", true).put("data", data).toString()

  private fun error(code: String): String =
    JSONObject().put("ok", false).put("error", code).toString()

  // ----------------------------- Clés par compte -----------------------------

  fun ensureKeysForUserJson(userId: String, existingDatabase: Boolean): String =
    try {
      val material = ensureMaterial(userId, existingDatabase)
      val recovered = material.recovered
      zero(material)
      ok(JSONObject().put("recovered", recovered))
    } catch (_: Throwable) {
      error("keystore")
    }

  fun sqlCipherKeyForUserJson(userId: String, existingDatabase: Boolean): String =
    try {
      val material = ensureMaterial(userId, existingDatabase)
      val hex = material.dbKey.joinToString("") { "%02x".format(it) }
      zero(material)
      ok(JSONObject().put("key", hex))
    } catch (_: Throwable) {
      error("keystore")
    }

  fun createAccountForUserJson(native: MboloCryptoNative, userId: String): String =
    withUserKey(userId) { key -> native.nativeCreateAccount(key) }

  fun generateOneTimeKeysForUserJson(
    native: MboloCryptoNative,
    userId: String,
    accountPickle: String,
    count: Int,
  ): String = withUserKey(userId) { key ->
    native.nativeGenerateOneTimeKeys(accountPickle, key, count)
  }

  fun generateOneTimeKeysSignedForUserJson(
    native: MboloCryptoNative,
    userId: String,
    accountPickle: String,
    count: Int,
  ): String = withUserKey(userId) { key ->
    native.nativeGenerateOneTimeKeysSigned(accountPickle, key, count)
  }

  fun generateFallbackKeyForUserJson(
    native: MboloCryptoNative,
    userId: String,
    accountPickle: String,
  ): String = withUserKey(userId) { key ->
    native.nativeGenerateFallbackKeySigned(accountPickle, key)
  }

  fun createOutboundForUserJson(
    native: MboloCryptoNative,
    userId: String,
    accountPickle: String,
    identityKey: String,
    oneTimeKey: String,
    plaintextB64: String,
  ): String = withUserKey(userId) { key ->
    native.nativeCreateOutbound(accountPickle, key, identityKey, oneTimeKey, plaintextB64)
  }

  fun encryptForUserJson(
    native: MboloCryptoNative,
    userId: String,
    sessionPickle: String,
    plaintextB64: String,
  ): String = withUserKey(userId) { key ->
    native.nativeEncrypt(sessionPickle, key, plaintextB64)
  }

  fun createInboundForUserJson(
    native: MboloCryptoNative,
    userId: String,
    accountPickle: String,
    identityKey: String,
    prekeyMessage: String,
  ): String = withUserKey(userId) { key ->
    native.nativeCreateInbound(accountPickle, key, identityKey, prekeyMessage)
  }

  fun decryptForUserJson(
    native: MboloCryptoNative,
    userId: String,
    sessionPickle: String,
    messageType: String,
    messageB64: String,
  ): String = withUserKey(userId) { key ->
    native.nativeDecrypt(sessionPickle, key, messageType, messageB64)
  }

  /** Outil de développement : corrompt uniquement la matière du compte visé. */
  fun simulateKeyLossForUserJson(userId: String): String {
    return try {
      val debuggable = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
      if (!debuggable) {
        error("forbidden")
      } else {
        val clean = requireUserId(userId)
        prefs.edit().putString(entryKey(clean), "AAAA").apply()
        ok(JSONObject().put("simulated", true))
      }
    } catch (_: Throwable) {
      error("keystore")
    }
  }

  // ------------------------ Compatibilité (ancien build) ------------------------

  private fun ensureLegacyMaterial(): Material {
    val initialized = prefs.getBoolean("initialized", false)
    val stored = prefs.getString("material", null)
    if (!initialized) {
      val material = freshMaterial()
      prefs.edit()
        .putString("material", encrypt(serialize(material, userId = null).toByteArray()))
        .putBoolean("initialized", true)
        .apply()
      return material
    }
    if (stored != null) {
      try {
        return parse(decrypt(stored), expectedUser = null)
      } catch (_: Throwable) {
        // Blob illisible : on repart proprement, l'appelant signale la perte.
      }
    }
    val material = freshMaterial(recovered = true)
    prefs.edit()
      .putString("material", encrypt(serialize(material, userId = null).toByteArray()))
      .putBoolean("initialized", true)
      .apply()
    return material
  }

  fun ensureKeysJson(): String =
    try {
      val material = ensureLegacyMaterial()
      val recovered = material.recovered
      zero(material)
      ok(JSONObject().put("recovered", recovered))
    } catch (_: Throwable) {
      error("keystore")
    }

  fun sqlCipherKeyJson(): String =
    try {
      val material = ensureLegacyMaterial()
      val hex = material.dbKey.joinToString("") { "%02x".format(it) }
      zero(material)
      ok(JSONObject().put("key", hex))
    } catch (_: Throwable) {
      error("keystore")
    }

  fun createAccountJson(native: MboloCryptoNative): String =
    withLegacyKey { key -> native.nativeCreateAccount(key) }

  fun generateOneTimeKeysJson(native: MboloCryptoNative, accountPickle: String, count: Int): String =
    withLegacyKey { key -> native.nativeGenerateOneTimeKeys(accountPickle, key, count) }

  fun generateOneTimeKeysSignedJson(
    native: MboloCryptoNative,
    accountPickle: String,
    count: Int,
  ): String = withLegacyKey { key -> native.nativeGenerateOneTimeKeysSigned(accountPickle, key, count) }

  fun generateFallbackKeyJson(native: MboloCryptoNative, accountPickle: String): String =
    withLegacyKey { key -> native.nativeGenerateFallbackKeySigned(accountPickle, key) }

  fun createOutboundJson(
    native: MboloCryptoNative,
    accountPickle: String,
    identityKey: String,
    oneTimeKey: String,
    plaintextB64: String,
  ): String = withLegacyKey { key ->
    native.nativeCreateOutbound(accountPickle, key, identityKey, oneTimeKey, plaintextB64)
  }

  fun encryptJson(native: MboloCryptoNative, sessionPickle: String, plaintextB64: String): String =
    withLegacyKey { key -> native.nativeEncrypt(sessionPickle, key, plaintextB64) }

  fun createInboundJson(
    native: MboloCryptoNative,
    accountPickle: String,
    identityKey: String,
    prekeyMessage: String,
  ): String = withLegacyKey { key ->
    native.nativeCreateInbound(accountPickle, key, identityKey, prekeyMessage)
  }

  fun decryptJson(
    native: MboloCryptoNative,
    sessionPickle: String,
    messageType: String,
    messageB64: String,
  ): String = withLegacyKey { key ->
    native.nativeDecrypt(sessionPickle, key, messageType, messageB64)
  }

  /** Outil de développement : rend le blob global illisible sans toucher au Keystore. */
  fun simulateKeyLossJson(): String {
    return try {
      val debuggable = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
      if (!debuggable) {
        error("forbidden")
      } else {
        prefs.edit().putString("material", "AAAA").putBoolean("initialized", true).apply()
        ok(JSONObject().put("simulated", true))
      }
    } catch (_: Throwable) {
      error("keystore")
    }
  }

  /**
   * Exécute `block` avec la clé de pickle en octets bruts. Le tableau est
   * zeroïsé dès le retour de l'appel natif : la copie Rust vit dans un
   * `Zeroizing` et aucune String du secret n'est créée côté JVM.
   */
  private fun withUserKey(userId: String, block: (ByteArray) -> String): String =
    try {
      val material = requireMaterial(userId)
      val result = block(material.pickleKey)
      zero(material)
      result
    } catch (_: Throwable) {
      error("keystore")
    }

  private fun withLegacyKey(block: (ByteArray) -> String): String =
    try {
      val material = ensureLegacyMaterial()
      val result = block(material.pickleKey)
      zero(material)
      result
    } catch (_: Throwable) {
      error("keystore")
    }
}
