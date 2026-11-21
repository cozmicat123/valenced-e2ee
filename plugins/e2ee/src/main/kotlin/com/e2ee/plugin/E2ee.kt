// AI-written glue. Logic ported from cozmicat123/aliucord-e2ee@aegires-sync E2eePlugin.kt `object E2ee`
// (keyFor/presetFor/encryptOn/encryptText), which itself mirrors Aegires MessageListScreen + MessageCryptoHelper.
// Crypto, FileNames, ForcedKeys, Argon2id, Blake2b are vendored verbatim from Aegires and not touched here.
package com.e2ee.plugin

import java.util.concurrent.ConcurrentHashMap
import javax.crypto.SecretKey

// Same pattern as Aegires MessageCryptoHelper.java:14
private val SIZE_TAG = Regex("^\\[sz:(\\d+),(\\d+)\\]")

// A problem the user should read as is (shown as a toast)
internal class E2eeError(message: String) : Exception(message)

internal object E2ee {
    @Volatile var key: SecretKey? = null
    @Volatile var enabled = false
    @Volatile var preset: Crypto.Preset = Crypto.Preset.AES256

    // Forced-channel keys are derived once per channel; never start two 64 MiB derivations for one channel
    private val preparing = ConcurrentHashMap.newKeySet<String>()

    fun isForced(channelId: String) = ForcedKeys.isForced(channelId)

    fun keyFor(channelId: String): SecretKey? {
        if (!isForced(channelId)) return key
        ForcedKeys.keyFor(channelId)?.let { return it }
        if (preparing.add(channelId)) ForcedKeys.prepare(channelId) { preparing.remove(channelId) }
        return null
    }

    fun presetFor(channelId: String): Crypto.Preset =
        if (isForced(channelId)) Crypto.Preset.AES128 else preset

    fun encryptOn(channelId: String): Boolean = isForced(channelId) || enabled

    // Same checks and messages as the Aliucord plugin
    fun requireKey(channelId: String): SecretKey = keyFor(channelId)
        ?: throw E2eeError(if (isForced(channelId)) "Encryption key not ready yet" else "Encryption key missing")

    fun requireSender(sender: String?): String = sender ?: throw E2eeError("Not ready yet, try again in a moment")

    fun encryptText(channelId: String, plain: String, sender: String?): String {
        val key = requireKey(channelId)
        val from = requireSender(sender)
        val p = presetFor(channelId)
        val max = Crypto.maxPlaintextBytes(p)
        if (Crypto.utf8Length(plain) > max) throw E2eeError("Too long for ${p.label} (max $max bytes)")
        return Crypto.encrypt(plain, key, p, channelId, from) ?: throw E2eeError("Encryption failed")
    }

    // [[content, channelId, authorId?], ...] -> [{ text: plain | null, enc, w, h }, ...]
    // text null = leave the message as is. enc = looksEncrypted(content), same rule as Aegires Message.encrypted.
    fun decryptAll(items: List<*>): List<Map<String, Any?>> = items.map { item ->
        val (content, channelId, author) = item as List<*>
        val enc = content is String && Crypto.looksEncrypted(content)
        val k = keyFor(channelId as String)
        val text = if (k == null || !enc) null else Crypto.decrypt(content as String, k, channelId, author as String?)
        // Aegires strips a leading "[sz:W,H]" from the text and keeps the size for the picture (MessageCryptoHelper.java:75-98)
        val tag = text?.let { SIZE_TAG.find(it) }
        mapOf(
            "text" to (if (tag != null) text?.substring(tag.range.last + 1) else text),
            "enc" to enc,
            "w" to tag?.groupValues?.get(1)?.toDoubleOrNull(),
            "h" to tag?.groupValues?.get(2)?.toDoubleOrNull(),
        )
    }

    // Turns a failure into { error } for the JS side
    fun attempt(what: String, block: () -> Map<String, Any?>): Map<String, Any?> = try {
        block()
    } catch (e: E2eeError) {
        mapOf("error" to e.message)
    } catch (e: Exception) {
        mapOf("error" to "$what failed: ${e.javaClass.simpleName}")
    }
}
