// AI-written glue. Alert shape from the Valenced bundle (settings.plugins/components/PluginClearDataConfirmationAlert.tsx,
// opened as in settings.plugins/utils/alerts.tsx); the text input is the same one the settings page uses.
// An alert action closes the alert when pressed, so the result comes back as a toast.
import { AlertActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { useState } from 'react'
import { applyKey } from './key'
import { toast } from './toast'

const { AlertActionButton, AlertModal, TextInput } = Design

function KeyAlert({ onSet }: { onSet(): void }) {
        const [password, setPassword] = useState('')
        return (
                <AlertModal
                        title="Set encryption key"
                        content={<TextInput label="Password" placeholder="8-256 characters" defaultValue="" onChange={setPassword} />}
                        actions={
                                <>
                                        <AlertActionButton
                                                text="Set key"
                                                variant="primary"
                                                onPress={() => {
                                                        toast('Deriving key, this takes a few seconds...')
                                                        applyKey(password).then(error => (error ? toast(error) : onSet()))
                                                }}
                                        />
                                        <AlertActionButton text="Cancel" variant="secondary" />
                                </>
                        }
                />
        )
}

// Asks for the key, then calls onSet once it is derived
export const askKey = (onSet: () => void) => AlertActionCreators.openAlert('cozmicat123.e2ee.key', <KeyAlert onSet={onSet} />)
