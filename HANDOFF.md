# HANDOFF: maintaining valenced-e2ee

For the maintainer. `AGENTS.md` has the same ground for AI agents, plus the decision log. `README.md` is the short public page.

## What this is

`cozmicat123.e2ee`, an end-to-end encryption plugin for Valenced (Discord mobile mod). It must stay 100% compatible with the Aegires client (`Curione23/Aegires`, branch `gen3`, pinned in `scripts/verify-vendored.sh`) and with the Aliucord plugin (`cozmicat123/aliucord-e2ee`, branch `aegires-sync`). Text, pictures and videos are covered; other files travel encrypted but are not decrypted on receive, same as Aegires.

Status when this was written: version `2.0.0`, tested on device: text, edit, reply, pictures, videos (native player), file limits, key change, input-bar toggle. Forced channels were not re-tested because the test channel was deleted.

## Layout

| Path | What it is |
| --- | --- |
| `plugins/e2ee/src/main/java/com/e2ee/plugin/` | Aegires classes, copied verbatim (only the `package` line changes). `AndroidMedia` is upstream plus `patches/AndroidMedia.patch`. Never edit by hand. |
| `plugins/e2ee/src/main/kotlin/com/e2ee/plugin/` | The logic. `E2ee.kt` text, `E2eeFiles.kt` files and posters, `VideoPlayer.kt`, `E2eePlugin.kt` registers the native methods. |
| `plugins/e2ee/js/` | Hooks and UI only. `index.ts` hooks, `send.ts` outgoing, `messages.ts` decrypting rows, `files.ts` attachments, `input-button.tsx` lock button, `key-alert.tsx` + `key.ts` key prompt, `settings.tsx`, `toast.ts`, `debug.ts`. |
| `scripts/verify-vendored.sh` | Fails if a vendored file differs from the pinned Aegires commit. |
| `.github/workflows/` | `checks.yml` (tsc, biome lint, vendored check), `release.yml` (stable and beta), `publish-index.yml` (manual index rebuild). |
| `.github/scripts/` | Template scripts that manage the release pool. Not ours; leave them. |

Rule of the repo: as much Kotlin/Java as possible, TypeScript only for hooks and glue. Every AI-written file says so in its header and cites `file:line` of the human code it follows.

## How it works

- **Send text**: an `instead` hook on `sendMessage`/`editMessage` calls native `encrypt`, which returns `§...` ciphertext. On any error the send is blocked and a toast says why.
- **Send file**: `send.ts` refuses more than one file, prefixes pictures with `[sz:W,H]`, encrypts the caption, and native `encryptFile` writes `<random>.enc.<ext>` to `cache/e2ee-out`. That copy is uploaded in place of the picked file (max 25 MiB).
- **Receive text**: Flux `MESSAGE_CREATE`, `MESSAGE_UPDATE`, `LOAD_MESSAGES_SUCCESS` plus a `before` hook on `RowManager.generate` (for cached rows) call native `decrypt`. The ciphertext is kept in a map so a wrong key or Clear key locks the row again. Encrypted rows get a lock before the name.
- **Receive media**: `files.ts` calls native `decryptFile`, which uses Aegires' `MediaCache` (download, size limits, disk cache) and returns a local file. The attachment is swapped for it with a `MESSAGE_UPDATE`.
- **Video**: Discord cannot play a local video. The video is moved to `cache/e2ee-play`, a first-frame JPEG with a play badge is made next to it, and the message shows that picture. A hook on `openMediaModal` sees the tap and `VideoPlayer` plays the video in a native `VideoView` dialog.
- **Key**: Argon2id, kept in native memory only, so it is gone after a restart. Setting or clearing it re-reads the open channel and wipes decrypted media.
- **Input bar**: the lock button (after the attachments button) toggles encryption. Without a key it opens a key prompt first.

## Releasing

- `valenced-port` is the working branch. Every push builds and publishes a beta `<manifest version>-bNNNNN` to the `beta` channel. Valenced's plugin card has a channel picker.
- Merging to `main` publishes the manifest version as stable (`latest`) and writes a tag and a GitHub Release. The pool lives on the `gh-pages` branch; `index.json` is generated from it.
- **After a stable release, raise `version` in `plugins/e2ee/manifest.json` on `valenced-port` before the next push.** A labeled `2.0.0-b00012` sorts below the bare `2.0.0`, so betas of an already released version are never offered.
- To unpublish a build, delete its zip from `pool/` on `gh-pages`, then run the "Publish repository index" workflow.
- CI needs the `READ_PACKAGES_TOKEN` secret (read packages only) to download the Valenced API.

## When Aegires changes

Moving to a new Aegires commit should only touch the pin and, if upstream changed them, the places below.

1. Set `PIN` in `scripts/verify-vendored.sh`.
2. Run `scripts/verify-vendored.sh <path to an Aegires clone>`.
3. For each file reported as `DIFFERS`, copy the upstream file from `app/src/main/java/a/b/util/` into `plugins/e2ee/src/main/java/com/e2ee/plugin/` and change only its `package` line.
4. If `AndroidMedia` fails, redo `patches/AndroidMedia.patch` against the new upstream (it swaps OkHttp for `HttpURLConnection`).
5. Build, then check the tables below.

What the plugin calls:

| Aegires | Used for | Where |
| --- | --- | --- |
| `Crypto` (`deriveKey`, `encrypt`, `decrypt`, `looksEncrypted`, `Preset`, `encryptStream`) | text and file encryption | `E2ee.kt`, `E2eeFiles.kt`, `E2eePlugin.kt` |
| `ForcedKeys` (`isForced`, `keyFor`, `prepare`) | forced-channel keys | `E2ee.kt` |
| `FileNames.randomFor` | name of an encrypted upload | `E2eeFiles.kt` |
| `MediaCache` (`Spec.encryptedImage`, `Spec.encryptedVideo`, `Spec.force`, `decryptToTemp`, `clearSensitive`) | receiving pictures and videos | `E2eeFiles.kt` |

Rules copied from Aegires. If one changes, the plugin must follow or files stop interoperating:

| Rule | Aegires source | Plugin |
| --- | --- | --- |
| `.enc` goes before the last extension | `MessageListScreen.java:532-537` | `E2eeFiles.kt` (`encName`) |
| Encrypted attachment: contains `.enc.` or ends with `.enc` | `AttachmentViewFactory.java:72` | `files.ts` |
| Video extensions mp4, mov, webm, m4v, 3gp | `AttachmentViewFactory.java:75-84` | `files.ts` |
| Upload limit 25 MiB | `ApiClient.java:52`, `754-760` | `E2eeFiles.kt` |
| Picture size tag `[sz:W,H]` before the caption | `MessageListScreen.java:455-470`, `MessageCryptoHelper.java:14, 75-98` | `send.ts`, `E2ee.kt` |
| Encrypted flag from `looksEncrypted` | `model/Message.java:17, 36` | `messages.ts`, `E2ee.kt` |
| Lock marker | `MessageBinder.java:46` | `index.ts` |

Not tied to Aegires: the poster and player and the input-bar button.

## When Valenced or Discord changes

These are the plugin's hooks into the host. If one breaks after an update, the symptom tells you where to look.

| Hook | Symptom when it breaks | File |
| --- | --- | --- |
| `getModules(withProps('sendMessage','editMessage'))` | messages go out unencrypted or sending fails | `index.ts` |
| `withName('RowManager').prototype.generate` | cached rows stay encrypted, lock marker missing | `index.ts` |
| Flux `MESSAGE_CREATE`, `MESSAGE_UPDATE`, `LOAD_MESSAGES_SUCCESS` | new or loaded messages not decrypted | `index.ts` |
| CloudUpload shape (`item.uri`, `filename`, `mimeType`, `isImage`) | "Unknown attachment format, file not sent" | `send.ts` |
| Attachment shape (`filename`, `url`, `content_type`, `size`) | attachments stay `.enc` cards | `files.ts` |
| `withProps('openMediaModal')`, `initialSources` as a list or a list of lists | tapping a video poster opens an image viewer | `index.ts` |
| `modules/chat_input/native/action_buttons/ChatInputActions.tsx` and `ChatInputActionButton.tsx` | lock button missing | `input-button.tsx` |
| `AlertActionCreators.openAlert`, `Design.AlertModal` | key prompt does not open | `key-alert.tsx` |

Use the settings page's "Copy debug log" first. It holds the last 60 events (decrypt failures, upload problems) and never message text or keys.

## Limits that are on purpose

- One file per message and 25 MiB, as in Aegires. Other file types are not decrypted on receive.
- Pictures over 6 MiB and videos over 4 MiB download automatically while "Download large media automatically" is on (default). Aegires' own limits (48 MiB pictures, 256 MiB videos) still apply.
- The key is never written to disk.
- Discord's own video player is not used (see `AGENTS.md`).

## Ideas not done

- A Kettu/Revenge version. Not checked whether those clients can run native code.
- Audio and other file types on receive (Aegires does not do them either).
