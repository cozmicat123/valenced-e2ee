// AI-written glue (v1). Layout and components copied from human Valenced plugins:
//  - page shell and TextInput/Button: anonymous-file-names/js/settings.tsx:1-71
//  - TableSwitchRow: better-chat-buttons/js/settings.tsx:56-68
//  - TableRadioGroup/TableRadioRow: better-chat-buttons/js/settings.tsx:81-95
//  - Clipboard.setString: link-alert-copy/index.tsx:47, developer-kit AssetBrowserSettingScreen.tsx:178
// Texts and rules mirror aliucord-e2ee@aegires-sync E2eeSettings.kt (password 8-256, preset radios).
import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { callNativeMethod } from '@valenced/modules/native'
import { useEffect, useState } from 'react'
import { ScrollView, Text } from 'react-native'
import { debugText } from './debug'
import { applyKey } from './key'
import { redecrypt } from './messages'
import { toast } from './toast'
import type { Settings } from '.'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'

const { Button, Stack, TableRadioGroup, TableRadioRow, TableRowGroup, TableSwitchRow, TextInput } = Design

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

export default function SettingsComponent({ api: { jsonStorage: storage } }: Props) {
        const { enabled, preset, largeMedia = true } = storage.use()!
        const [password, setPassword] = useState('')
        const [error, setError] = useState('')
        const [hasKey, setHasKey] = useState(false)
        const [busy, setBusy] = useState(false)
        const [nonce, setNonce] = useState(0)

        useEffect(() => {
                callNativeMethod('cozmicat123.e2ee.hasKey', []).then(setHasKey, e => setError(String(e)))
        }, [])

        const setKey = async () => {
                setBusy(true)
                const failure = await applyKey(password)
                setError(failure ?? '')
                if (!failure) {
                        setHasKey(true)
                        setPassword('')
                        // The input is uncontrolled, so a new key empties it
                        setNonce(n => n + 1)
                }
                setBusy(false)
        }

        return (
                <ScrollView keyboardShouldPersistTaps="handled">
                        <Page>
                                <Stack>
                                        <TextInput
                                                key={nonce}
                                                label="Password"
                                                placeholder="8-256 characters"
                                                defaultValue=""
                                                status={error ? 'error' : 'default'}
                                                errorMessage={error || undefined}
                                                onChange={setPassword}
                                        />
                                        <Button
                                                variant="primary"
                                                size="sm"
                                                text={busy ? 'Deriving key...' : 'Set key'}
                                                onPress={setKey}
                                        />
                                        <Button
                                                variant="secondary"
                                                size="sm"
                                                text="Clear key"
                                                onPress={() => {
                                                        callNativeMethod('cozmicat123.e2ee.clearKey', []).then(() => redecrypt())
                                                        setHasKey(false)
                                                        storage.set({ enabled: false })
                                                }}
                                        />
                                        <Button
                                                variant="secondary"
                                                size="sm"
                                                text="Copy debug log"
                                                onPress={() => {
                                                        Clipboard.setString(debugText())
                                                        toast('Debug log copied')
                                                }}
                                        />
                                        <Text>{hasKey ? 'Key set (kept in memory only).' : 'No key set.'}</Text>
                                </Stack>
                                <TableRowGroup title="Encryption">
                                        <TableSwitchRow
                                                label="Encrypt my messages"
                                                subLabel="Applies to the messages you send. You can read everyone else's messages regardless of profile. Preset channels always use AES-128-GCM."
                                                value={enabled}
                                                onValueChange={(v: boolean) => {
                                                        // Aliucord plugin does the same: no encrypting until a key exists
                                                        if (v && !hasKey) return setError('Set a key first')
                                                        storage.set({ enabled: v })
                                                }}
                                        />
                                </TableRowGroup>
                                <TableRowGroup title="Media">
                                        <TableSwitchRow
                                                label="Download large media automatically"
                                                subLabel="Pictures over 6 MiB and videos over 4 MiB. Off keeps them as encrypted files."
                                                value={largeMedia}
                                                onValueChange={(v: boolean) => {
                                                        storage.set({ largeMedia: v })
                                                        callNativeMethod('cozmicat123.e2ee.largeMedia', [v]).then(() => redecrypt())
                                                }}
                                        />
                                </TableRowGroup>
                                <TableRadioGroup<number>
                                        title="Profile"
                                        defaultValue={preset}
                                        onChange={v => storage.set({ preset: v })}
                                >
                                        <TableRadioRow label="AES-128-GCM" value={0} />
                                        <TableRadioRow label="AES-192-GCM" value={1} />
                                        <TableRadioRow label="AES-256-GCM" value={2} />
                                </TableRadioGroup>
                        </Page>
                </ScrollView>
        )
}
