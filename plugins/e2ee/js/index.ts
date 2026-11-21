// AI-written glue (v1). Hook shapes copied from human Valenced plugins:
//  - send/edit `instead` hooks: valenced-community-plugins fake-nitro/src/patches/expressions/fakeify.ts:138-158
//  - module lookup: gif-to-chat-input/index.ts:27-35
//  - Flux payload rewrite: clear-urls/index.tsx:104-111 (MESSAGE_CREATE). The LOAD_MESSAGES_SUCCESS shape ({ messages, channelId })
//    has no human source; it is only verified by working on device
//  - jsonStorage wiring: anonymous-file-names/js/index.ts:39-44
// Outgoing side (text and files) is in send.ts. Behaviour mirrors cozmicat123/aliucord-e2ee@aegires-sync E2eePlugin.kt (Aegires MessageCryptoHelper).
import { onFluxEventDispatched } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { callNativeMethod, callNativeMethodSync } from '@valenced/modules/native'
import { after, before, instead } from '@valenced/patcher'
import { decryptMessages, decryptPreview, encrypted } from './messages'
import { createSender } from './send'
import SettingsComponent from './settings'

export interface Settings {
        enabled: boolean
        preset: number // Crypto.Preset index: 0 = AES-128, 1 = AES-192, 2 = AES-256
}

export const ID = 'cozmicat123.e2ee'

declare module '@valenced/modules/native' {
        interface NativeMethods {
                'cozmicat123.e2ee.configure': [args: [enabled: boolean, preset: number], returnValue: null]
                'cozmicat123.e2ee.setKey': [args: [password: string], returnValue: boolean]
                'cozmicat123.e2ee.clearKey': [args: [], returnValue: null]
                'cozmicat123.e2ee.hasKey': [args: [], returnValue: boolean]
                'cozmicat123.e2ee.encrypt': [
                        args: [channelId: string, plain: string, selfId: string | null],
                        returnValue: { text?: string; error?: string } | null,
                ]
                'cozmicat123.e2ee.encryptOn': [args: [channelId: string], returnValue: boolean]
                'cozmicat123.e2ee.encryptFile': [
                        args: [uri: string, filename: string | null, mimeType: string | null, channelId: string, selfId: string | null],
                        returnValue: { path?: string; name?: string; size?: number; error?: string },
                ]
                'cozmicat123.e2ee.decryptFile': [
                        args: [url: string, channelId: string, authorId: string | null, size: number, w: number, h: number, videoExt: string | null],
                        returnValue: { path?: string; url?: string; info?: string; w?: number | null; h?: number | null; confirm?: number; error?: string },
                ]
                'cozmicat123.e2ee.clearMedia': [args: [], returnValue: null]
                'cozmicat123.e2ee.mediaLog': [args: [], returnValue: string] // TEMP diagnostic
                'cozmicat123.e2ee.decrypt': [
                        args: [items: [content: unknown, channelId: string, authorId: string | null][]],
                        returnValue: { text: string | null; enc: boolean; w: number | null; h: number | null }[],
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

                const configureNative = () =>
                        callNativeMethodSync('cozmicat123.e2ee.configure', [!!storage.cache?.enabled, storage.cache?.preset ?? 2])
                const { encryptOutgoing, sendWithFile } = createSender(configureNative)

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
