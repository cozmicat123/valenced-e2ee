// AI-written glue. In-memory debug log (last LIMIT lines, never written to disk, no message text or keys).
// The settings page copies it so errors can be pasted instead of read off a toast.
const LIMIT = 60
const lines: string[] = []

export function debug(message: string) {
        lines.push(`${new Date().toISOString().slice(11, 19)} ${message}`)
        if (lines.length > LIMIT) lines.shift()
}

export const debugText = () => lines.join('\n') || 'empty'
