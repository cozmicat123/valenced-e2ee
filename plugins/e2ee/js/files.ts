// AI-written glue (v2 receive, pictures and videos like Aegires). Decrypting an attachment happens in native (vendored Aegires MediaCache.decryptToTemp:
// download, size limits, disk cache). This file only swaps the attachment in the message for the decrypted local file.
// The swap is a MESSAGE_UPDATE, the same way messages.ts redecrypt() refreshes rows (valid-user/js/index.ts:54-83).
import { Dispatcher } from '@valenced/discord/common/flux'
import { callNativeMethod } from '@valenced/modules/native'
import { debug } from './debug'
import type { FluxMessage } from './messages'

// Attachment as the gateway sends it (seen in the debug log: id, filename, size, url, proxy_url, content_type)
export interface Attachment {
        id: string
        filename: string
        size?: number
        url: string
        proxy_url?: string
        content_type?: string
        width?: number
        height?: number
}

interface Job {
        channelId: string
        original: Attachment[]
        swapped?: Attachment[]
}

// message id -> what was received and, once decrypted, what replaces it. Capped.
const jobs = new Map<string, Job>()
const MAX_JOBS = 500

// Picture size from the caption's "[sz:W,H]" tag, per message id (set by messages.ts)
const sizes = new Map<string, [number, number]>()
export const setSize = (id: string, w: number, h: number) => sizes.set(id, [w, h])

// Same test as Aegires AttachmentViewFactory.java:72
const isEncrypted = (name: string) => name.includes('.enc.') || name.endsWith('.enc')
const plainName = (name: string) => name.replace('.enc', '')
// Same list as Aegires AttachmentViewFactory.isVideoFilename (screen/AttachmentViewFactory.java:75-84)
const videoExt = (name: string) => /\.(mp4|mov|webm|m4v|3gp)$/i.exec(name)?.[1].toLowerCase() ?? null

async function open(a: Attachment, channelId: string, authorId: string | null, w: number, h: number): Promise<Attachment> {
        // Aegires shows only pictures and videos; other encrypted files stay as they are
        const ext = videoExt(a.filename)
        if (!isEncrypted(a.filename) || !(ext || a.content_type?.startsWith('image/'))) return a
        try {
                const r = await callNativeMethod('cozmicat123.e2ee.decryptFile', [a.url, channelId, authorId, a.size ?? 0, w, h, ext])
                if (!r.path) {
                        debug(`decryptFile ${a.filename}: ${JSON.stringify(r)}`)
                        return a
                }
                // Videos come with an http:// address on the loopback server, since Discord's player cannot play file://
                const url = ext ? 'https://www.w3schools.com/html/mov_bbb.mp4' : (r.url ?? `file://${r.path}`) // TEMP probe: public https video
                if (ext) debug(`video ${r.info} ${url} ${a.content_type}`) // TEMP diagnostic
                const width = w || r.w
                const height = h || r.h
                return { ...a, url, proxy_url: url, filename: plainName(a.filename), ...(width && height ? { width, height } : {}) }
        } catch (e) {
                debug(`decryptFile ${a.filename} threw: ${String(e)}`)
                return a
        }
}

// Called wherever a message is decrypted. Swaps in the decrypted files when they are ready, starts decrypting when not.
export function attachFiles(m: FluxMessage, fallbackChannel?: string) {
        const id = m.id
        const list = m.attachments
        const channelId = m.channel_id ?? fallbackChannel
        if (!id || !channelId || !list?.some(a => isEncrypted(a.filename))) return
        const job = jobs.get(id)
        if (job) {
                if (job.swapped) m.attachments = job.swapped
                return
        }
        jobs.set(id, { channelId, original: list })
        if (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value!)
        const [w, h] = sizes.get(id) ?? [0, 0]
        Promise.all(list.map(a => open(a, channelId, m.author?.id ?? null, w, h))).then(swapped => {
                const current = jobs.get(id)
                // Reset meanwhile, or nothing could be decrypted (no key, too big, network): keep the originals
                if (!current || swapped.every((a, i) => a === list[i])) return
                current.swapped = swapped
                Dispatcher.dispatch({ type: 'MESSAGE_UPDATE', message: { id, channel_id: channelId, attachments: swapped } })
        })
}

// Key set or cleared: put the received attachments back and wipe the decrypted files (Aegires clearSensitive)
export function resetFiles() {
        for (const [id, job] of jobs) {
                if (job.swapped)
                        Dispatcher.dispatch({
                                type: 'MESSAGE_UPDATE',
                                message: { id, channel_id: job.channelId, attachments: job.original },
                        })
        }
        jobs.clear()
        callNativeMethod('cozmicat123.e2ee.clearMedia', []).catch(e => debug(`clearMedia threw: ${String(e)}`))
}
