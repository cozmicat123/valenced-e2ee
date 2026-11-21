@file:JvmName("E2eePlugin")

// AI-written glue (v1). Logic ported from cozmicat123/aliucord-e2ee@aegires-sync E2eePlugin.kt `object E2ee`
// (keyFor/presetFor/encryptOn/encryptText), which itself mirrors Aegires MessageListScreen + MessageCryptoHelper.
// Plugin/bridge structure: Valenced/valenced-plugin-template example-plugin MyPlugin.kt.
// Crypto, FileNames, ForcedKeys, Argon2id, Blake2b are vendored verbatim from Aegires and not touched here.
// v2 file encryption (encName, encryptFile): name rule ported from Aegires MessageListScreen.java:532-537; the
// content:// / file path reading follows ThemesPlugin.kt:95-125 (valenced-community-plugins importBackground).
package com.e2ee.plugin

import android.app.AndroidAppHelper
import android.graphics.BitmapFactory
import android.net.Uri
import app.valenced.plugins.plugin
import app.valenced.xposed.api.registerNativeAsyncMethod
import app.valenced.xposed.api.registerNativeMethod
import java.io.File
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.crypto.SecretKey

// Aegires ApiClient.java:52
private const val MAX_UPLOAD_BYTES = 25L * 1024 * 1024

// Same pattern as Aegires MessageCryptoHelper.java:14
private val SIZE_TAG = Regex("^\\[sz:(\\d+),(\\d+)\\]")

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

    // Downloads and decrypts a received attachment with Aegires' own MediaCache (limits, retries, disk cache), as a temp file.
    // Waits for the callback on this worker thread, which is off the RN thread.
    fun decryptFile(url: String, channelId: String, sender: String?, size: Long, w: Int, h: Int): Map<String, Any?> {
        val k = keyFor(channelId) ?: return mapOf("error" to "no key")
        if (sender == null) return mapOf("error" to "no sender")
        val result = CompletableFuture<Map<String, Any?>>()
        val spec = MediaCache.Spec.encryptedImage(url, k, channelId, sender, size, w, h)
        MediaCache.get(AndroidAppHelper.currentApplication()).decryptToTemp(spec, object : MediaCache.TempCallback {
            override fun onProgress(done: Long, total: Long) {}
            override fun onNeedsConfirm(totalBytes: Long) {
                result.complete(mapOf("confirm" to totalBytes.toDouble()))
            }
            override fun onFailure(failure: MediaCache.Failure) {
                result.complete(mapOf("error" to failure.toString()))
            }
            override fun onFile(plaintext: File) {
                // Images sent without a "[sz:W,H]" tag: read the size from the decrypted picture itself
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                if (w <= 0 || h <= 0) BitmapFactory.decodeFile(plaintext.absolutePath, bounds)
                result.complete(
                    mapOf(
                        "path" to plaintext.absolutePath,
                        "w" to bounds.outWidth.takeIf { it > 0 }?.toDouble(),
                        "h" to bounds.outHeight.takeIf { it > 0 }?.toDouble(),
                    ),
                )
            }
        })
        return try {
            result.get(180, TimeUnit.SECONDS)
        } catch (t: Exception) {
            mapOf("error" to "timeout")
        }
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
        // Any failure is reported with the step it happened in, so the toast says what broke
        var stage = "app"
        var out: File? = null
        try {
            val app = AndroidAppHelper.currentApplication()
            stage = "dir"
            val dir = File(app.cacheDir, "e2ee-out").apply { mkdirs() }
            // Uploads read these copies after sending, so only old ones are removed (and all on Clear key)
            dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 3_600_000 }?.forEach { it.delete() }
            stage = "name"
            val file = File(dir, encName(FileNames.randomFor(name, mime)))
            out = file
            stage = "open"
            val source = Uri.parse(uri)
            val input = if (source.scheme == "content") app.contentResolver.openInputStream(source)
            else File(source.path ?: uri).inputStream()
            stage = "size"
            // Same rule as Aegires ApiClient.java:754-760 (size unknown = no check)
            val size = if (source.scheme == "content") app.contentResolver.openAssetFileDescriptor(source, "r")?.use { it.length } ?: -1L
            else File(source.path ?: uri).length()
            if (size >= 0 && size + Crypto.fileOverhead(presetFor(channelId), size) > MAX_UPLOAD_BYTES) {
                input?.close()
                return mapOf("error" to "File too large for E2EE upload")
            }
            stage = "crypto"
            val ok = input?.use { i ->
                file.outputStream().use { o -> Crypto.encryptStream(i, o, k, presetFor(channelId), channelId, sender) }
            } ?: false
            if (!ok) {
                file.delete()
                return mapOf("error" to "File encryption failed (crypto returned false)")
            }
        } catch (t: Throwable) {
            out?.delete()
            return mapOf("error" to "File encryption failed at $stage: ${t.javaClass.simpleName}")
        }
        val done = out ?: return mapOf("error" to "File encryption failed (no output)")
        return mapOf("path" to done.absolutePath, "name" to done.name, "size" to done.length().toDouble())
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

        // [url, channelId, selfId?, size, w, h] -> { path } | { confirm: bytes } | { error }
        registerNativeAsyncMethod("$id.decryptFile") { args ->
            E2ee.decryptFile(
                args[0] as String,
                args[1] as String,
                args[2] as String?,
                (args[3] as Number).toLong(),
                (args[4] as Number).toInt(),
                (args[5] as Number).toInt(),
            )
        }

        // Aegires clearSensitive: forget decrypted pictures, delete decrypted files (and our encrypted upload copies)
        registerNativeMethod("$id.clearMedia") { _ ->
            val app = AndroidAppHelper.currentApplication()
            MediaCache.get(app).clearSensitive()
            File(app.cacheDir, "e2ee-out").listFiles()?.forEach { it.delete() }
            Unit
        }

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

        // [[content, channelId, authorId?], ...] -> [{ text: plain | null, enc: Boolean, w?, h? }, ...]
        // text null = leave the message as is. enc = looksEncrypted(content), same rule as Aegires Message.encrypted.
        registerNativeMethod("$id.decrypt") { args ->
            (args[0] as List<*>).map { item ->
                val (content, channelId, author) = (item as List<*>)
                val enc = content is String && Crypto.looksEncrypted(content)
                val k = E2ee.keyFor(channelId as String)
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
        }
    }

    stop {
        E2ee.key = null
        E2ee.enabled = false
    }
}
