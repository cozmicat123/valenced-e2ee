// AI-written glue. One toast for everything this plugin says, so a new message replaces the old one instead of stacking.
// Call shape: valenced-plugins better-invites/js/index.tsx:32, bio-emoji-button/js/picker.tsx:262
import { ToastActionCreators } from '@valenced/discord/actions'

export const toast = (text: string) => ToastActionCreators.open('cozmicat123.e2ee.toast', { text })
