// AI-written glue (v1). Hook shapes copied from human Valenced plugins:
//  - send/edit `instead` hooks: valenced-community-plugins fake-nitro/src/patches/expressions/fakeify.ts:138-158
//  - module lookup: gif-to-chat-input/index.ts:27-35
//  - Flux payload rewrite: clear-urls/index.tsx:104-111 (MESSAGE_CREATE). The LOAD_MESSAGES_SUCCESS shape ({ messages, channelId })
//    has no human source; it is only verified by working on device
//  - jsonStorage wiring: anonymous-file-names/js/index.ts:39-44
// Behaviour mirrors cozmicat123/aliucord-e2ee@aegires-sync E2eePlugin.kt (Aegires MessageCryptoHelper).
import { ToastActionCreators } from '@valenced/discord/actions'
import { onFluxEventDispatched, Stores } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { callNativeMethod, callNativeMethodSync } from '@valenced/modules/native'
import { after, before, instead } from '@valenced/patcher'
import { decryptMessages, decryptPreview, encrypted } from './messages'
import SettingsComponent from './settings'

export interface Settings {
        enabled: boolean
        preset: number // Crypto.Preset index: 0 = AES-128, 1 = AES-192, 2 = AES-256
}

export const ID = 'cozmicat123.e2ee'

// Errors are shown as a toast, as in Aegires MessageCryptoHelper.java:42 and the Aliucord plugin's showToast.
// Call shape: valenced-plugins better-invites/js/index.tsx:32, bio-emoji-button/js/picker.tsx:262
const ToastKey = `${ID}.error`

declare module '@valenced/modules/native' {
        interface NativeMethods {
                'cozmicat123.e2ee.configure': [args: [enabled: boolean, preset: number], returnValue: null]
                'cozmicat123.e2ee.setKey': [args: [password: string], returnValue: boolean]
                'cozmicat123.e2ee.clearKey': [args: [], returnValue: null]
                'cozmicat123.e2ee.hasKey': [args: [], returnValue: boolean]
                'cozmicat123.e2ee.encrypt': [
                        args: [channelId: string, plain: string, selfId: string | null],
                        returnValue: { text: string | null; error: string | null } | null,
                ]
                'cozmicat123.e2ee.encryptOn': [args: [channelId: string], returnValue: boolean]
                'cozmicat123.e2ee.encryptFile': [
                        args: [uri: string, filename: string | null, mimeType: string | null, channelId: string, selfId: string | null],
                        returnValue: { path?: string; name?: string; size?: number; error?: string },
                ]
                'cozmicat123.e2ee.decrypt': [
                        args: [items: [content: unknown, channelId: string, authorId: string | null][]],
                        returnValue: { text: string | null; enc: boolean }[],
                ]
        }
}

interface MessageActions {
        sendMessage(channelId: string, message: { content: string }, clearDraft: boolean, options?: object): unknown
        editMessage(channelId: string, messageId: string, message: { content: string }): unknown
}

// Aegires MessageBinder.java:46 puts a lock before the time; here it goes before the name (show-tag/index.ts:79-92 rewrites the same row field)
const LOCK = '\uD83D\uDD12 '
const MessageRowType = 1

interface RowManager {
        prototype: { generate(args: { message?: any }): MessageRow }
}

interface MessageRow {
        type?: number
        message?: { id?: string; username?: string }
}

export default plugin<{ jsonStorage: Settings }>({
        jsonStorage: { load: true, default: { enabled: false, preset: 2 } },
        start({ cleanup, jsonStorage: storage, plugin }) {
                // The key lives in native memory only, so after a restart there is none. Start with encryption off;
                // the settings page does not let it be turned on without a key.
                // cache may not be loaded yet here, so read through get() as fake-nitro fakeify.ts:252 does
                storage.get().then(
                        s => {
                                if (s.enabled) storage.set({ enabled: false })
                        },
                        e => plugin.reportError(e),
                )

                // The row hook needs the message list to be built after it is installed
                if (plugin.startedLate) {
                        plugin.requireReload()
                        return
                }

                // Fails closed: returns false when the message must not be sent
                const configureNative = () =>
                        callNativeMethodSync('cozmicat123.e2ee.configure', [!!storage.cache?.enabled, storage.cache?.preset ?? 2])
                const selfIdOf = (): string | null => (Stores as any).UserStore?.getCurrentUser?.()?.id ?? null

                const encryptOutgoing = (channelId: string, data: { content?: string } | undefined) => {
                        const plain = data?.content?.trim()
                        if (!data || !plain) return true
                        configureNative()
                        const selfId = selfIdOf()
                        const res = callNativeMethodSync('cozmicat123.e2ee.encrypt', [channelId, plain, selfId])
                        if (res === null) return true // encryption off for this channel
                        if (res.error || !res.text) {
                                ToastActionCreators.open(ToastKey, { text: res.error ?? 'Encryption failed' })
                                return false
                        }
                        data.content = res.text
                        return true
                }

                // v2: with files attached in an encrypted chat the picked file is replaced by its Aegires-format
                // ciphertext copy right before sending (native encryptFile). Aegires sends one file per message, so
                // more than one file is refused. Fails closed: on any problem nothing is sent.
                // AI-written; the CloudUpload field names come from datamined Discord code and are checked on device.
                const sendWithFile = async (self: unknown, args: any[], original: (...a: any[]) => unknown, files: any[]) => {
                        const channelId: string = args[0]
                        configureNative()
                        if (!callNativeMethodSync('cozmicat123.e2ee.encryptOn', [channelId])) return Reflect.apply(original, self, args)
                        if (files.length > 1) {
                                ToastActionCreators.open(ToastKey, { text: 'Encrypted chats take one file per message' })
                                return
                        }
                        if (!encryptOutgoing(channelId, args[1])) return
                        const f = files[0]
                        const res = await callNativeMethod('cozmicat123.e2ee.encryptFile', [
                                f.uri,
                                f.filename ?? null,
                                f.mimeType ?? null,
                                channelId,
                                selfIdOf(),
                        ])
                        if (!res || res.error || !res.path || !res.name || !res.size) {
                                ToastActionCreators.open(ToastKey, { text: res?.error ?? 'File encryption failed' })
                                return
                        }
                        // Copy of the upload object (prototype kept); the original stays untouched for draft recovery
                        const uri = `file://${res.path}`
                        const swapped = Object.assign(Object.create(Object.getPrototypeOf(f)), f, {
                                uri,
                                originalUri: uri,
                                filename: res.name,
                                mimeType: 'application/octet-stream',
                                currentSize: res.size,
                                preCompressionSize: res.size,
                                reactNativeFilePrepped: true,
                        })
                        const next = [...args]
                        next[3] = { ...args[3], attachmentsToUpload: [swapped] }
                        // TEMPORARY diagnostics, removed once file sending works
                        const dbg = (text: string) => ToastActionCreators.open(`${ID}.dbg.${text}`, { text })
                        dbg(`enc ok ${res.name} ${res.size}`)
                        try {
                                const sent = await Reflect.apply(original, self, next)
                                dbg(`send returned ${typeof sent}`)
                                return sent
                        } catch (e) {
                                dbg(`send threw ${String(e).slice(0, 80)}`)
                                throw e
                        }
                }

                cleanup(
                        getModules(withProps<MessageActions>('sendMessage', 'editMessage'), messages => {
                                cleanup(
                                        instead(messages, 'sendMessage', function (args, original) {
                                                const files = (args[3] as any)?.attachmentsToUpload
                                                if (Array.isArray(files) && files.length) return sendWithFile(this, args, original, files)
                                                // Blocked: return a promise. AI-chosen (no human hook found); a blocked send was tested on device and does not crash
                                                if (!encryptOutgoing(args[0], args[1])) return Promise.resolve()
                                                return Reflect.apply(original, this, args)
                                        }),
                                        instead(messages, 'editMessage', function (args, original) {
                                                if (!encryptOutgoing(args[0], args[2])) return Promise.resolve()
                                                return Reflect.apply(original, this, args)
                                        }),
                                )
                        }),
                )

                cleanup(
                        // modules/messages/native/renderer/RowGenerator.tsx; hook form from mention-avatars/js/index.ts:34 and fake-nitro realify.ts:244-245
                        getModules(withName<RowManager>('RowManager'), ({ prototype }) => {
                                cleanup(
                                        // Already-cached messages: decrypt when the list (re)builds a row. Same idea as the Aliucord
                                        // plugin's `before onConfigure { decrypt(it) }`; hook form from anonymous-file-names (`before`).
                                        before(prototype, 'generate', args => {
                                                const m = args[0]?.message
                                                if (m) {
                                                        decryptMessages([m], m.channelId)
                                                        const preview = m.referencedMessage?.message
                                                        if (preview) decryptPreview(preview)
                                                }
                                                return args
                                        }),
                                        after(prototype, 'generate', row => {
                                                const m = row?.type === MessageRowType ? row.message : undefined
                                                if (!m?.id || m.username == null || !encrypted.has(m.id)) return row
                                                return { ...row, message: { ...m, username: LOCK + m.username } }
                                        }),
                                )
                        }),
                )

                cleanup(
                        onFluxEventDispatched('MESSAGE_CREATE', evt => {
                                if ((evt as any)?.message) decryptMessages([(evt as any).message])
                                return evt
                        }),
                        onFluxEventDispatched('MESSAGE_UPDATE', evt => {
                                if ((evt as any)?.message) decryptMessages([(evt as any).message])
                                return evt
                        }),
                        onFluxEventDispatched('LOAD_MESSAGES_SUCCESS', evt => {
                                const e = evt as any
                                if (Array.isArray(e?.messages)) decryptMessages(e.messages, e.channelId)
                                return evt
                        }),
                )
        },
        stop() {
                callNativeMethod('cozmicat123.e2ee.clearKey', [])
        },
        SettingsComponent,
})
