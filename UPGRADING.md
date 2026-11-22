# Upgrading to a newer Aegires

The plugin is built around Aegires: its classes are vendored unchanged and everything else calls them. Moving to a new Aegires commit should only touch the pin and, if upstream changed them, the places listed below.

## Steps

1. Set `PIN` in `scripts/verify-vendored.sh` to the new commit.
2. Run `scripts/verify-vendored.sh <path to an Aegires clone>`.
3. For each file reported as `DIFFERS`, copy the upstream file from `app/src/main/java/a/b/util/` into `plugins/e2ee/src/main/java/com/e2ee/plugin/` and change only its `package` line.
4. If `AndroidMedia` fails, redo `patches/AndroidMedia.patch` against the new upstream file (it swaps OkHttp for `HttpURLConnection`).
5. Build, then check the touchpoints below.

## What the plugin calls

| Aegires | Used for | Where |
| --- | --- | --- |
| `Crypto` (`deriveKey`, `encrypt`, `decrypt`, `looksEncrypted`, `Preset`, `encryptStream`) | text and file encryption | `E2ee.kt`, `E2eeFiles.kt`, `E2eePlugin.kt` |
| `ForcedKeys` (`isForced`, `keyFor`, `prepare`) | forced-channel keys | `E2ee.kt` |
| `FileNames.randomFor` | name of an encrypted upload | `E2eeFiles.kt` |
| `MediaCache` (`Spec.encryptedImage`, `Spec.encryptedVideo`, `Spec.force`, `decryptToTemp`, `clearSensitive`) | receiving pictures and videos | `E2eeFiles.kt` |

## Rules copied from Aegires

If Aegires changes one of these, the plugin has to follow, or files stop interoperating.

| Rule | Aegires source | Plugin |
| --- | --- | --- |
| `.enc` goes before the last extension | `MessageListScreen.java:532-537` | `E2eeFiles.kt` (`encName`) |
| Encrypted attachment test: contains `.enc.` or ends with `.enc` | `AttachmentViewFactory.java:72` | `files.ts` |
| Video extensions: mp4, mov, webm, m4v, 3gp | `AttachmentViewFactory.java:75-84` | `files.ts` |
| Upload limit 25 MiB | `ApiClient.java:52` and `754-760` | `E2eeFiles.kt` |
| Picture size tag `[sz:W,H]` in front of the caption | `MessageListScreen.java:455-470`, `MessageCryptoHelper.java:14, 75-98` | `send.ts`, `E2ee.kt` |
| Lock marker on encrypted messages | `MessageBinder.java:46` | `index.ts` |

## Not tied to Aegires

The video poster and player (`E2eeFiles.poster`, `VideoPlayer.kt`) and the input-bar button are the plugin's own, so an Aegires change does not affect them.
