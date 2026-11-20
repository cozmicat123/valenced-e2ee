// TEMPORARY v2 probe (AI-written, to be removed). Shows only field NAMES and TYPES in a toast, never values.
// Hooks copied from anonymous-file-names/js/index.ts:61-88 (uploadLocalFiles, CloudUpload) and the RowManager hook above.
import { ToastActionCreators } from '@valenced/discord/actions'
import { getModules } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { after, before } from '@valenced/patcher'

const shown = new Set<string>()

// Once per label, so a long chat does not flood the screen
function show(label: string, o: unknown) {
        if (shown.has(label)) return
        shown.add(label)
        const text =
                o && typeof o === 'object'
                        ? Object.entries(o as object)
                                  .map(([k, v]) => `${k}:${typeof v}`)
                                  .join(' ')
                        : typeof o
        ToastActionCreators.open(`E2EE_PROBE_${label}`, { text: `${label} => ${text}` })
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
        cleanup(
                getModules(withName<{ prototype: { generate(a: unknown): any } }>('RowManager'), ({ prototype }) => {
                        cleanup(
                                after(prototype, 'generate', row => {
                                        show('row-attachment0', row?.message?.attachments?.[0])
                                        return row
                                }),
                        )
                }),
        )
}
