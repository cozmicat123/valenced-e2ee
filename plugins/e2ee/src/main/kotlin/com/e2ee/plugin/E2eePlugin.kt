@file:JvmName("E2eePlugin")

// AI-written glue (v1). Logic ported from cozmicat123/aliucord-e2ee@aegires-sync E2eePlugin.kt `object E2ee`
// (keyFor/presetFor/encryptOn/encryptText), which itself mirrors Aegires MessageListScreen + MessageCryptoHelper.
// Plugin/bridge structure: Valenced/valenced-plugin-template example-plugin MyPlugin.kt.
// Crypto, FileNames, ForcedKeys, Argon2id, Blake2b are vendored verbatim from Aegires and not touched here.
// v2 file encryption (encName, encryptFile): name rule ported from Aegires MessageListScreen.java:532-537; the
// content:// / file path reading follows ThemesPlugin.kt:95-125 (valenced-community-plugins importBackground).
package com.e2ee.plugin

import android.app.AndroidAppHelper
import android.net.Uri
import app.valenced.plugins.plugin
import app.valenced.xposed.api.registerNativeAsyncMethod
import app.valenced.xposed.api.registerNativeMethod
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.SecretKey

private object E2ee {
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

    // Same checks and messages as the Aliucord plugin. Returns text, or the message to show the user.
    fun encryptText(channelId: String, plain: String, sender: String?): Pair<String?, String?> {
        val k = keyFor(channelId)
            ?: return null to (if (isForced(channelId)) "Encryption key not ready yet" else "Encryption key missing")
        if (sender == null) return null to "Not ready yet, try again in a moment"
        val p = presetFor(channelId)
        val max = Crypto.maxPlaintextBytes(p)
        if (Crypto.utf8Length(plain) > max) return null to "Too long for ${p.label} (max $max bytes)"
        val out = Crypto.encrypt(plain, k, p, channelId, sender) ?: return null to "Encryption failed"
        return out to null
    }

    // "x.ext" -> "x.enc.ext", no extension -> "x.enc" (Aegires AttachmentViewFactory.java:72 looks for exactly this)
    private fun encName(original: String): String {
        val dot = original.lastIndexOf('.')
        return if (dot > 0) original.substring(0, dot) + ".enc" + original.substring(dot) else "$original.enc"
    }

    // Reads the picked file, writes the Aegires-format ciphertext copy into the cache and returns its location.
    fun encryptFile(uri: String, name: String?, mime: String?, channelId: String, sender: String?): Map<String, Any?> {
        val k = keyFor(channelId)
            ?: return mapOf("error" to (if (isForced(channelId)) "Encryption key not ready yet" else "Encryption key missing"))
        if (sender == null) return mapOf("error" to "Not ready yet, try again in a moment")
        val app = AndroidAppHelper.currentApplication()
        val dir = File(app.cacheDir, "e2ee-out").apply { mkdirs() }
        val out = File(dir, encName(FileNames.randomFor(name, mime)))
        val source = Uri.parse(uri)
        val input = if (source.scheme == "content") app.contentResolver.openInputStream(source)
        else File(source.path ?: uri).inputStream()
        val ok = input?.use { i ->
            out.outputStream().use { o -> Crypto.encryptStream(i, o, k, presetFor(channelId), channelId, sender) }
        } ?: false
        if (!ok) {
            out.delete()
            return mapOf("error" to "File encryption failed")
        }
        return mapOf("path" to out.absolutePath, "name" to out.name, "size" to out.length().toDouble())
    }
}

val e2eePlugin = plugin {
    start {
        val id = manifest.id

        // [enabled: Boolean, preset: Int]
        registerNativeMethod("$id.configure") { args ->
            E2ee.enabled = args[0] as Boolean
            E2ee.preset = Crypto.Preset.fromIndex((args[1] as Number).toInt()) ?: Crypto.Preset.AES256
            Unit
        }

        // [password: String] -> Boolean. Argon2id is heavy, so this runs off the RN thread.
        registerNativeAsyncMethod("$id.setKey") { args ->
            val password = args[0] as String
            // deriveKey returns null on any failure (Crypto.java derive, line 99 on); keep the old key then
            val derived = if (password.length in 8..256) Crypto.deriveKey(password) else null
            if (derived != null) E2ee.key = derived
            derived != null
        }

        registerNativeMethod("$id.clearKey") { _ ->
            E2ee.key = null
            Unit
        }

        registerNativeMethod("$id.hasKey") { _ -> E2ee.key != null }

        // [channelId] -> Boolean
        registerNativeMethod("$id.encryptOn") { args -> E2ee.encryptOn(args[0] as String) }

        // [uri, filename?, mimeType?, channelId, selfId?] -> { path, name, size } | { error }. Heavy, so off the RN thread.
        registerNativeAsyncMethod("$id.encryptFile") { args ->
            E2ee.encryptFile(args[0] as String, args[1] as String?, args[2] as String?, args[3] as String, args[4] as String?)
        }

        // [channelId, plain, selfId?] -> { text?: String, error?: String }, or null when encryption is off for the channel
        registerNativeMethod("$id.encrypt") { args ->
            val channelId = args[0] as String
            val plain = args[1] as String
            // Same as Aliucord encryptOutgoing: never double-encrypt
            if (!E2ee.encryptOn(channelId) || Crypto.looksEncrypted(plain)) {
                null
            } else {
                val (text, error) = E2ee.encryptText(channelId, plain, args[2] as String?)
                mapOf("text" to text, "error" to error)
            }
        }

        // [[content, channelId, authorId?], ...] -> [{ text: plain | null, enc: Boolean }, ...]
        // text null = leave the message as is. enc = looksEncrypted(content), same rule as Aegires Message.encrypted.
        registerNativeMethod("$id.decrypt") { args ->
            (args[0] as List<*>).map { item ->
                val (content, channelId, author) = (item as List<*>)
                val enc = content is String && Crypto.looksEncrypted(content)
                val k = E2ee.keyFor(channelId as String)
                val text = if (k == null || !enc) null else Crypto.decrypt(content as String, k, channelId, author as String?)
                mapOf("text" to text, "enc" to enc)
            }
        }
    }

    stop {
        E2ee.key = null
        E2ee.enabled = false
    }
}
