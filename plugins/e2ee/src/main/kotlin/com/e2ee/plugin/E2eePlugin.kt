@file:JvmName("E2eePlugin")

// AI-written glue. Plugin/bridge structure: Valenced/valenced-plugin-template example-plugin MyPlugin.kt.
// This file only registers the native methods the JS side calls; the work is in E2ee.kt (text) and E2eeFiles.kt (files).
package com.e2ee.plugin

import app.valenced.plugins.plugin
import app.valenced.xposed.api.registerNativeAsyncMethod
import app.valenced.xposed.api.registerNativeMethod

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

        registerNativeMethod("$id.clearMedia") { _ ->
            E2eeFiles.clear()
            Unit
        }

        // [channelId] -> Boolean
        registerNativeMethod("$id.encryptOn") { args -> E2ee.encryptOn(args[0] as String) }

        // [channelId, plain, selfId?] -> { text } | { error }, or null when encryption is off for the channel
        registerNativeMethod("$id.encrypt") { args ->
            val channelId = args[0] as String
            val plain = args[1] as String
            // Same as Aliucord encryptOutgoing: never double-encrypt
            if (!E2ee.encryptOn(channelId) || Crypto.looksEncrypted(plain)) {
                null
            } else {
                E2ee.attempt("Encryption") { mapOf("text" to E2ee.encryptText(channelId, plain, args[2] as String?)) }
            }
        }

        // [[content, channelId, authorId?], ...] -> [{ text, enc, w, h }, ...]
        registerNativeMethod("$id.decrypt") { args -> E2ee.decryptAll(args[0] as List<*>) }

        // [uri, filename?, mimeType?, channelId, selfId?] -> { path, name, size } | { error }. Heavy, so off the RN thread.
        registerNativeAsyncMethod("$id.encryptFile") { args ->
            E2ee.attempt("File encryption") {
                E2eeFiles.encrypt(args[0] as String, args[1] as String?, args[2] as String?, args[3] as String, args[4] as String?)
            }
        }

        // [url, channelId, selfId?, size, w, h] -> { path, w?, h? } | { confirm: bytes } | { error }
        registerNativeAsyncMethod("$id.decryptFile") { args ->
            E2ee.attempt("Image decryption") {
                E2eeFiles.decrypt(
                    args[0] as String,
                    args[1] as String,
                    args[2] as String?,
                    (args[3] as Number).toLong(),
                    (args[4] as Number).toInt(),
                    (args[5] as Number).toInt(),
                )
            }
        }
    }

    stop {
        E2ee.key = null
        E2ee.enabled = false
        E2eeFiles.clear()
    }
}
