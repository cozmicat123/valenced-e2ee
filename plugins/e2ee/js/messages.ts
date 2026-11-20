// AI-written glue (v1). Shared by index.ts and settings.tsx so they do not import each other.
// redecrypt after Set key: valenced-community-plugins valid-user/js/index.ts:54-83 (redrawMentions)
import { Dispatcher } from '@valenced/discord/common/flux'
import { Stores } from '@valenced/discord/flux'
import { callNativeMethodSync } from '@valenced/modules/native'
import type { DiscordModules } from '@valenced/discord/types'

// Flux message objects (snake_case, as sent by the gateway)
export interface FluxMessage {
        id?: string
        content?: string
        channel_id?: string
        author?: { id?: string }
        referenced_message?: FluxMessage | null
        messageReference?: { message_id?: string }
}

// Messages that were sent encrypted (Aegires Message.encrypted): id -> original ciphertext plus what decrypting needs.
// Kept because decrypting replaces the content in place, and a wrong key or Clear key must be able to lock the row (and
// reply previews of it) again. Reply previews are stored too. Capped.
interface Sealed {
        cipher: string
        channelId: string
        authorId: string | null
}
export const encrypted = new Map<string, Sealed>()
const MAX_ENCRYPTED = 2000

// Same test as Crypto.looksEncrypted (Crypto.java: PREFIX line 65, looksEncrypted 83-85; pinned dddead0 "\u00A7"). Checked here so plain rows never cross the bridge.
const looksEncrypted = (s: unknown): s is string => typeof s === 'string' && s.startsWith('\u00A7')

// Replace encrypted content in place. The message and its reply preview go in one native call.
export function decryptMessages(messages: FluxMessage[], fallbackChannel?: string) {
        const targets: FluxMessage[] = []
        const items: [unknown, string, string | null][] = []
        const add = (m: FluxMessage | null | undefined, channel: string | undefined) => {
                const channelId = m?.channel_id ?? channel
                if (!m || !channelId || !looksEncrypted(m.content)) return
                targets.push(m)
                items.push([m.content, channelId, m.author?.id ?? null])
        }
        for (const m of messages) {
                add(m, fallbackChannel)
                add(m.referenced_message, m.channel_id ?? fallbackChannel)
        }
        if (!items.length) return
        let out: { text: string | null; enc: boolean }[]
        try {
                out = callNativeMethodSync('cozmicat123.e2ee.decrypt', [items])
        } catch (e) {
                console.warn('[e2ee] decrypt failed', e)
                return
        }
        out.forEach(({ text, enc }, i) => {
                if (text !== null) targets[i].content = text
                const id = targets[i].id
                if (enc && id) {
                        encrypted.set(id, { cipher: items[i][0] as string, channelId: items[i][1], authorId: items[i][2] })
                        if (encrypted.size > MAX_ENCRYPTED) encrypted.delete(encrypted.keys().next().value!)
                }
        })
}

// Reply preview inside a row record (row.message.referencedMessage.message; show-tag/index.ts:82-83, mention-avatars/js/index.ts:43).
// It is rebuilt from the stored ciphertext every time, so a key change shows it locked or unlocked again.
export function decryptPreview(p: { id?: string; content?: unknown }) {
        const sealed = p.id ? encrypted.get(p.id) : undefined
        if (!p.id || !sealed) return
        const copy: FluxMessage = {
                id: p.id,
                content: sealed.cipher,
                channel_id: sealed.channelId,
                author: { id: sealed.authorId ?? undefined },
        }
        decryptMessages([copy])
        p.content = copy.content
}

// Rows keep what they were first built with, so a new key alone changes nothing (valid-user redrawMentions has the same
// problem). Decrypt the loaded messages of the open channel with the current key and send the result back as a MESSAGE_UPDATE.
export function redecrypt() {
        const SelectedChannelStore = Stores.SelectedChannelStore as DiscordModules.Flux.Store<{
                getChannelId(): string | undefined
        }>
        const channelId = SelectedChannelStore.getChannelId()
        if (!channelId) return

        const MessageStore = Stores.MessageStore as DiscordModules.Flux.Store<{
                getMessages(channelId: string): { toArray(): FluxMessage[] }
        }>
        for (const { id, content, author, messageReference } of MessageStore.getMessages(channelId).toArray()) {
                // Plain rows have no ciphertext. Already-decrypted rows go back through theirs, so a wrong key or
                // Clear key shows them locked again, as in Aegires.
                const cipher = looksEncrypted(content) ? content : id ? encrypted.get(id)?.cipher : undefined
                if (!id || content === undefined) continue
                let next = content
                if (cipher) {
                        const copy: FluxMessage = { id, content: cipher, channel_id: channelId, author: { id: author?.id } }
                        decryptMessages([copy])
                        next = copy.content ?? content
                }
                // A reply to an encrypted message must rebuild its row too, or its preview keeps the old text.
                const repliesToEncrypted = !!messageReference?.message_id && encrypted.has(messageReference.message_id)
                if (next === content && !repliesToEncrypted) continue
                const update = (text: string) =>
                        Dispatcher.dispatch({ type: 'MESSAGE_UPDATE', message: { id, channel_id: channelId, content: text } })
                // Unchanged content may not rebuild the row, so change it and restore it (valid-user/js/index.ts:72 and :78).
                if (next === content) update(`${content}\u200b`)
                update(next)
        }
}
