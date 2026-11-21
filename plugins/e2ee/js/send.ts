// AI-written glue (v1 text, v2 files). Hook shapes copied from human Valenced plugins are listed in index.ts.
// Outgoing side: encrypts the text, and with a file attached swaps the picked file for its Aegires-format ciphertext copy
// (native encryptFile) right before sending. The CloudUpload field names come from datamined Discord code and are checked on device.
import { ToastActionCreators } from '@valenced/discord/actions'
import { Stores } from '@valenced/discord/flux'
import { callNativeMethod, callNativeMethodSync } from '@valenced/modules/native'
import { debug } from './debug'

// Errors are shown as a toast, as in Aegires MessageCryptoHelper.java:42 and the Aliucord plugin's showToast.
// Call shape: valenced-plugins better-invites/js/index.tsx:32, bio-emoji-button/js/picker.tsx:262
const toast = (text: string) => ToastActionCreators.open('cozmicat123.e2ee.error', { text })

const selfIdOf = (): string | null => (Stores as any).UserStore?.getCurrentUser?.()?.id ?? null

// Aegires puts the picture size in front of the caption before encrypting it (MessageListScreen.java:455-470), also when there is no caption
const sizeTag = (f: any) => (f.isImage && f.item.width > 0 && f.item.height > 0 ? `[sz:${f.item.width},${f.item.height}]` : '')

export function createSender(configureNative: () => void) {
        // Fails closed: returns false when the message must not be sent
        function encryptOutgoing(channelId: string, data: { content?: string } | undefined) {
                const plain = data?.content?.trim()
                if (!data || !plain) return true
                configureNative()
                const res = callNativeMethodSync('cozmicat123.e2ee.encrypt', [channelId, plain, selfIdOf()])
                if (res === null) return true // encryption off for this channel
                if (res.error || !res.text) {
                        toast(res.error ?? 'Encryption failed')
                        return false
                }
                data.content = res.text
                return true
        }

        // Returns a copy of the upload object with the ciphertext file in place (prototype kept, the original stays untouched
        // for draft recovery), or undefined after telling the user why not.
        async function encryptUpload(f: any, channelId: string) {
                const item = f.item
                const res = await callNativeMethod('cozmicat123.e2ee.encryptFile', [
                        item.uri,
                        f.filename ?? null,
                        f.mimeType ?? null,
                        channelId,
                        selfIdOf(),
                ]).catch(e => {
                        debug(`encryptFile threw: ${String(e)}`)
                })
                if (!res) return toast('File encryption failed (see Copy debug log in settings)')
                if (!res.path || !res.name || !res.size) {
                        debug(`encryptFile result: ${JSON.stringify(res)}`)
                        toast(res.error ?? 'File encryption failed')
                        return
                }
                const uri = `file://${res.path}`
                return Object.assign(Object.create(Object.getPrototypeOf(f)), f, {
                        item: { ...item, uri, originalUri: uri, filename: res.name, mimeType: 'application/octet-stream' },
                        filename: res.name,
                        mimeType: 'application/octet-stream',
                        currentSize: res.size,
                        preCompressionSize: res.size,
                        reactNativeFilePrepped: true,
                })
        }

        // Aegires sends one file per message, so more than one is refused. Fails closed: on any problem nothing is sent.
        async function sendWithFile(self: unknown, args: any[], original: (...a: any[]) => unknown, files: any[]) {
                const channelId: string = args[0]
                configureNative()
                if (!callNativeMethodSync('cozmicat123.e2ee.encryptOn', [channelId])) return Reflect.apply(original, self, args)
                if (files.length > 1) return toast('Encrypted chats take one file per message')
                // The picked file's location lives in the CloudUpload's `item`, not on the upload itself
                const f = files[0]
                if (typeof f.item?.uri !== 'string') {
                        debug(`file item has no uri: item keys=${Object.keys(f.item ?? {}).join(',')}`)
                        return toast('Unknown attachment format, file not sent')
                }
                // Done on a copy so the original draft stays as it was
                const message = { ...args[1], content: sizeTag(f) + (args[1]?.content ?? '') }
                if (!encryptOutgoing(channelId, message)) return
                const upload = await encryptUpload(f, channelId)
                if (!upload) return
                const next = [...args]
                next[1] = message
                next[3] = { ...args[3], attachmentsToUpload: [upload] }
                return Reflect.apply(original, self, next)
        }

        return { encryptOutgoing, sendWithFile }
}
