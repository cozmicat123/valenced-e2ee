// AI-written glue; no Aegires or Valenced plugin code covers this. Discord's player cannot play a file:// video, so decrypted
// videos are served to it from here: a loopback-only HTTP server that hands out the files of E2eeFiles.playDir by exact name
// (random names, so the address is the secret), with Range support for seeking.
package com.e2ee.plugin

import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.io.RandomAccessFile
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLConnection
import kotlin.concurrent.thread

internal object MediaServer {
    private var server: ServerSocket? = null

    // TEMP diagnostic: what the player asked for and what was sent
    private val requests = ArrayDeque<String>()

    @Synchronized
    private fun note(line: String) {
        requests.addLast(line)
        if (requests.size > 20) requests.removeFirst()
    }

    @Synchronized
    fun log(): String = requests.joinToString("\n").ifEmpty { "no requests" }

    // http://127.0.0.1:<port>/<file name>. The server starts on first use.
    @Synchronized
    fun urlFor(file: File): String {
        val s = server ?: ServerSocket(0, 8, InetAddress.getLoopbackAddress()).also {
            server = it
            thread(isDaemon = true) { accept(it) }
        }
        return "http://127.0.0.1:${s.localPort}/${file.name}"
    }

    @Synchronized
    fun stop() {
        server?.close()
        server = null
    }

    private fun accept(server: ServerSocket) {
        while (true) {
            val client = try {
                server.accept()
            } catch (e: IOException) {
                return // closed by stop()
            }
            thread(isDaemon = true) {
                try {
                    client.use { serve(it) }
                } catch (e: IOException) {
                    note("closed: ${e.message}") // the player closed the connection (seeking does this)
                }
            }
        }
    }

    private fun serve(client: Socket) {
        val input = client.getInputStream().bufferedReader(Charsets.ISO_8859_1)
        val request = input.readLine()?.split(' ') ?: return
        var range: String? = null
        while (true) {
            val line = input.readLine()
            if (line.isNullOrEmpty()) break
            if (line.startsWith("Range:", ignoreCase = true)) range = line.substring(6).trim()
        }
        note("${request.take(2).joinToString(" ")} range=$range")
        val out = client.getOutputStream()
        val dir = E2eeFiles.playDir
        val file = request.getOrNull(1)?.removePrefix("/")?.let { File(dir, it) }?.takeIf { it.parentFile == dir && it.isFile }
            ?: return respond(out, "404 Not Found", 0)

        val total = file.length()
        val bytes = range?.let { Regex("bytes=(\\d*)-(\\d*)").matchEntire(it) }
        var start = 0L
        var end = total - 1
        if (bytes != null) {
            val first = bytes.groupValues[1].toLongOrNull()
            val last = bytes.groupValues[2].toLongOrNull()
            if (first == null && last != null) start = (total - last).coerceAtLeast(0) // "bytes=-N" is the last N bytes
            if (first != null) start = first
            if (first != null && last != null) end = minOf(last, end)
        }
        if (start > end) return respond(out, "416 Range Not Satisfiable", 0, "Content-Range: bytes */$total\r\n")

        val type = URLConnection.guessContentTypeFromName(file.name) ?: "application/octet-stream"
        val partial = if (bytes != null) "Content-Range: bytes $start-$end/$total\r\n" else ""
        respond(out, if (bytes != null) "206 Partial Content" else "200 OK", end - start + 1, "Content-Type: $type\r\nAccept-Ranges: bytes\r\n$partial")
        if (request[0] == "HEAD") return
        var sent = 0L
        try {
            RandomAccessFile(file, "r").use { f ->
                f.seek(start)
                val buffer = ByteArray(64 * 1024)
                var left = end - start + 1
                while (left > 0) {
                    val n = f.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
                    if (n < 0) break
                    out.write(buffer, 0, n)
                    left -= n
                    sent += n
                }
            }
        } finally {
            note("sent $sent of ${end - start + 1}")
        }
    }

    private fun respond(out: OutputStream, status: String, length: Long, headers: String = "") {
        out.write("HTTP/1.1 $status\r\nContent-Length: $length\r\n${headers}Connection: close\r\n\r\n".toByteArray(Charsets.ISO_8859_1))
        out.flush()
    }
}
