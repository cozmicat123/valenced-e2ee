// AI-written glue. Setting the key, shared by the settings page and the input-bar button.
import { callNativeMethod } from '@valenced/modules/native'
import { redecrypt } from './messages'

// Derives the key in native (Argon2id, a few seconds) and re-reads the open channel with it. Returns an error text, or null when it worked.
export async function applyKey(password: string): Promise<string | null> {
        try {
                if (!(await callNativeMethod('cozmicat123.e2ee.setKey', [password]))) return `Password must be 8-256 characters (got ${password.length})`
        } catch (e) {
                return String(e)
        }
        redecrypt()
        return null
}
