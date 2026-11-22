// AI-written glue. File side of E2ee. Encrypting and decrypting are Aegires' own Crypto.encryptStream and MediaCache
// (limits, retries, disk cache), only wrapped here. Name rule: Aegires MessageListScreen.java:532-537; size cap:
// ApiClient.java:52 and 754-760. content:// / file path reading follows ThemesPlugin.kt:95-125
// (valenced-community-plugins importBackground).
package com.e2ee.plugin

import android.app.AndroidAppHelper
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.media.MediaMetadataRetriever
import android.net.Uri
import java.io.File
import java.io.InputStream
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

internal object E2eeFiles {
    private const val MAX_UPLOAD_BYTES = 25L * 1024 * 1024 // Aegires ApiClient.java:52
    private const val KEEP_MS = 3_600_000L // uploads read their ciphertext copy after sending, so only old ones go
    private const val DECRYPT_WAIT_S = 180L
    private const val POSTER_EXT = "jpg"

    private val app get() = AndroidAppHelper.currentApplication()
    private val outDir get() = File(app.cacheDir, "e2ee-out")
    val playDir get() = File(app.cacheDir, "e2ee-play") // decrypted videos, kept until Clear key or stop

    // "x.ext" -> "x.enc.ext", no extension -> "x.enc" (Aegires AttachmentViewFactory.java:72 looks for exactly this)
    private fun encName(original: String): String {
        val dot = original.lastIndexOf('.')
        return if (dot > 0) original.substring(0, dot) + ".enc" + original.substring(dot) else "$original.enc"
    }

    private fun open(source: Uri): InputStream =
        (if (source.scheme == "content") app.contentResolver.openInputStream(source) else File(source.path ?: "").inputStream())
            ?: throw E2eeError("Can't read the file")

    // -1 = unknown
    private fun sizeOf(source: Uri): Long =
        if (source.scheme == "content") app.contentResolver.openAssetFileDescriptor(source, "r")?.use { it.length } ?: -1L
        else File(source.path ?: "").length()

    // Writes the Aegires-format ciphertext copy of the picked file into the cache and returns its location.
    fun encrypt(uri: String, name: String?, mime: String?, channelId: String, sender: String?): Map<String, Any?> {
        val key = E2ee.requireKey(channelId)
        val from = E2ee.requireSender(sender)
        val preset = E2ee.presetFor(channelId)
        val source = Uri.parse(uri)
        // Same rule as Aegires ApiClient.java:754-760 (size unknown = no check)
        val size = sizeOf(source)
        if (size >= 0 && size + Crypto.fileOverhead(preset, size) > MAX_UPLOAD_BYTES) throw E2eeError("File too large for E2EE upload")

        val dir = outDir.apply { mkdirs() }
        dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > KEEP_MS }?.forEach { it.delete() }
        val out = File(dir, encName(FileNames.randomFor(name, mime)))
        try {
            open(source).use { input ->
                out.outputStream().use { output ->
                    if (!Crypto.encryptStream(input, output, key, preset, channelId, from)) throw E2eeError("File encryption failed")
                }
            }
        } catch (t: Throwable) {
            out.delete()
            throw t
        }
        return mapOf("path" to out.absolutePath, "name" to out.name, "size" to out.length().toDouble())
    }

    // Downloads and decrypts a received picture or video into a temp file. Waits on this worker thread, which is off the RN thread.
    fun decrypt(url: String, channelId: String, sender: String?, size: Long, w: Int, h: Int, videoExt: String?): Map<String, Any?> {
        val video = videoExt != null
        val key = E2ee.requireKey(channelId)
        val from = E2ee.requireSender(sender)
        val result = CompletableFuture<Map<String, Any?>>()
        // Same choice as Aegires EncryptedMediaSlot.java:121-124 (video limits differ)
        val spec = if (video) MediaCache.Spec.encryptedVideo(url, key, channelId, from, size, w)
        else MediaCache.Spec.encryptedImage(url, key, channelId, from, size, w, h)
        spec.force = E2ee.largeMedia
        MediaCache.get(app).decryptToTemp(spec, object : MediaCache.TempCallback {
            override fun onProgress(done: Long, total: Long) {}
            override fun onNeedsConfirm(totalBytes: Long) {
                result.complete(mapOf("confirm" to totalBytes.toDouble()))
            }
            override fun onFailure(failure: MediaCache.Failure) {
                result.complete(mapOf("error" to failure.toString()))
            }
            override fun onFile(plaintext: File) {
                // Must complete the future whatever happens, or the caller waits out DECRYPT_WAIT_S
                result.complete(
                    runCatching { described(if (videoExt == null) plaintext else poster(playable(plaintext, videoExt)), w, h) }
                        .getOrElse { mapOf("error" to "Could not read the media: ${it.javaClass.simpleName} ${it.message}") },
                )
            }
        })
        return result.get(DECRYPT_WAIT_S, TimeUnit.SECONDS)
    }

    // Like Aegires wiping its plain folder when the cache is built: videos of an earlier run go on first use
    private val leftovers by lazy { playDir.listFiles()?.forEach { it.delete() } }

    // The cache names its temp files ".tmp", so a video moves to our own folder under its real extension
    // (a move, nothing is left in the cache). VideoPlayer plays it from there.
    private fun playable(temp: File, ext: String): File {
        leftovers
        val target = File(playDir.apply { mkdirs() }, "${temp.nameWithoutExtension}.$ext")
        return if (temp.renameTo(target)) target else temp
    }

    // Discord cannot play a local video (inline or in its viewer), so the message shows a picture of the video's first frame
    // with a play badge. Tapping it opens the video in VideoPlayer, which finds the video next to this file (videoFor).
    private fun poster(video: File): File {
        val meta = MediaMetadataRetriever()
        val frame = try {
            meta.setDataSource(video.absolutePath)
            meta.getFrameAtTime(0) ?: throw E2eeError("No picture in the video")
        } finally {
            meta.release()
        }
        val picture = frame.copy(Bitmap.Config.ARGB_8888, true)
        val canvas = Canvas(picture)
        val cx = picture.width / 2f
        val cy = picture.height / 2f
        val r = minOf(picture.width, picture.height) / 8f
        canvas.drawCircle(cx, cy, r, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(150, 0, 0, 0) })
        val triangle = Path().apply {
            moveTo(cx - r * 0.3f, cy - r * 0.5f)
            lineTo(cx - r * 0.3f, cy + r * 0.5f)
            lineTo(cx + r * 0.55f, cy)
            close()
        }
        canvas.drawPath(triangle, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE })
        val file = File(video.parentFile, "${video.nameWithoutExtension}.$POSTER_EXT")
        file.outputStream().use { picture.compress(Bitmap.CompressFormat.JPEG, 85, it) }
        return file
    }

    /** The decrypted video behind a poster picture, given the uri Discord's viewer was opened with. Null for anything else. */
    fun videoFor(uri: String): File? {
        val poster = File(Uri.parse(uri).path ?: return null)
        if (poster.extension != POSTER_EXT || poster.parentFile?.canonicalFile != playDir.canonicalFile) return null
        return playDir.listFiles()?.firstOrNull { it.nameWithoutExtension == poster.nameWithoutExtension && it.extension != POSTER_EXT }
    }

    // Pictures sent without a "[sz:W,H]" tag, and video posters (videos never have a tag): read the size from the file itself
    private fun described(file: File, w: Int, h: Int): Map<String, Any?> {
        if (w > 0 && h > 0) return mapOf("path" to file.absolutePath)
        val (width, height) = imageSize(file)
        return mapOf(
            "path" to file.absolutePath,
            "w" to width.takeIf { it > 0 }?.toDouble(),
            "h" to height.takeIf { it > 0 }?.toDouble(),
        )
    }

    private fun imageSize(file: File): Pair<Int, Int> {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        return bounds.outWidth to bounds.outHeight
    }

    // Aegires clearSensitive: forget decrypted pictures and delete their files, plus our ciphertext upload copies and played videos
    fun clear() {
        MediaCache.get(app).clearSensitive()
        outDir.listFiles()?.forEach { it.delete() }
        playDir.listFiles()?.forEach { it.delete() }
    }
}
