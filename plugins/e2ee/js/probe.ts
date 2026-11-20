// TEMPORARY v2 probe (AI-written, to be removed). Shows only field NAMES and TYPES in a toast, never values.
// Hooks copied from anonymous-file-names/js/index.ts:61-88 (uploadLocalFiles, CloudUpload).
import { ToastActionCreators } from '@valenced/discord/actions'
import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { before } from '@valenced/patcher'

const shown = new Set<string>()

// Once per label, so a long chat does not flood the screen. Undefined is skipped so it cannot use up the label.
// Long field lists are split over several toasts because one toast cuts the text off.
export function show(label: string, o: unknown) {
        if (o === undefined || o === null || shown.has(label)) return
        shown.add(label)
        if (typeof o !== 'object') {
                ToastActionCreators.open(`E2EE_PROBE_${label}`, { text: `${label} => ${typeof o}` })
                return
        }
        const fields = Object.entries(o as object).map(([k, v]) => `${k}:${typeof v}`)
        for (let i = 0; i < fields.length; i += 4)
                ToastActionCreators.open(`E2EE_PROBE_${label}_${i}`, {
                        text: `${label} ${fields.slice(i, i + 4).join(' ')}`,
                })
}

export function probe(cleanup: (...fns: (() => void)[]) => void) {
        cleanup(
                getModules(withProps('uploadLocalFiles'), mod => {
                        cleanup(
                                before(mod, 'uploadLocalFiles', args => {
                                        const files = args[0]?.items ?? args[0]?.files ?? args[0]?.uploads
                                        show('upload-arg0', args[0])
                                        show('upload-item0', files?.[0])
                                        show('upload-item0-file', files?.[0]?.file)
                                        return args
                                }),
                        )
                }),
        )
        cleanup(
                getModules(withProps('CloudUpload'), mod => {
                        cleanup(
                                before(mod, 'CloudUpload', args => {
                                        show('cloud-arg0', args[0])
                                        return args
                                }),
                        )
                }),
        )
}
