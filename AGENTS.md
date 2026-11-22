# AGENTS.md: state, rules and decisions

Read this before changing anything. `HANDOFF.md` has the maintainer-facing view (layout, releasing, upgrading); this file has the rules, the verified facts and why things are the way they are.

## Goal

Valenced plugin `cozmicat123.e2ee`: E2EE that is 100% compatible with Aegires (`Curione23/Aegires`, branch `gen3`, pin in `scripts/verify-vendored.sh`) and the Aliucord plugin (`cozmicat123/aliucord-e2ee`, branch `aegires-sync`). Must stay small, clean, fast and easy to maintain. If Aegires changes, the fix should be a pin bump.

## Rules (from the maintainer)

1. **Aegires classes are vendored verbatim**, only the `package` line changes. A needed change is a `patches/*.patch` that `scripts/verify-vendored.sh` re-applies to the pinned upstream. Never edit vendored files in place.
2. **Maximum Kotlin/Java**, TypeScript only for hooks and UI glue.
3. **Human-written code is the reference** for hooks and risky code: `~/ref/valenced-community-plugins`, `~/ref/valenced-plugins`, `~/ref/valenced-plugin-template`, `~/ref/valenced-types`, `~/ref/valenced` (bundle source). Read it before writing a hook. Do not copy `~/ref/friend` (a GPL-3.0 proof of concept, read-only).
4. **AI-written glue is labeled** in the file header and cites `file:line` of the human source. Verify cites against the real files; a wrong cite is a bug.
5. **No guessing.** If a fact about Valenced, Discord or Aegires is not in a file you read, ask the maintainer to run a grep (search with broad keywords first; narrow ones miss).
6. **No bloat.** No brute force, no duplicate code, no TEMP code left behind. Remove redundancy instead of adding to it.
7. **Run the checks**: CI runs `tsc` and biome lint on every push (`checks.yml`). The sandbox usually cannot run them, so say so when sending a patch. Check `scripts/verify-vendored.sh ~/ref/Aegires` on the device after touching vendored files.

## Working with the maintainer (Zedox)

- Android kernel developer, works only from Termux on a OnePlus 12, no PC, not rooted. Everything is done from a phone.
- Replies: ultra-concise (1-2 lines), one step per message, no long guides. `R:` means he runs it, `O:` means he runs it and pastes the output. Never explain commands. Flag risky steps.
- Delivery: a patch is a file sent to him, verified with `git apply --check` against a clean `git archive HEAD` copy of the current repo. He runs `~/bin/ship <patch-name> "<commit message>"`, which applies `~/storage/downloads/<patch>.patch`, commits, pushes and waits for CI. Keep the scratch repo in sync with what he shipped (his device is the truth; ask for `cat` when unsure).
- Big research: tell him what is needed and write a brief for a separate Claude agent. Small research is fine in the chat.
- He has other plugins and may do a Kettu/Revenge one, so keep this one easy to port and to maintain.

## Architecture in one page

Native Kotlin does the work; JS only hooks Discord and renders. The JS side calls native methods registered in `E2eePlugin.kt` (`cozmicat123.e2ee.*`) through `callNativeMethod` (async, off the RN thread) or `callNativeMethodSync`. Flows are described in `HANDOFF.md`. Key facts:

- Key and settings state live in `E2ee` (native, memory only). JS syncs `enabled`/`preset` before each send (`configure`) and `largeMedia` on start and on toggle.
- Decrypted media: pictures stay where Aegires' `MediaCache` puts them; videos move to `cache/e2ee-play` with a JPEG poster next to them. `clear()` wipes both plus `cache/e2ee-out` (ciphertext copies of uploads, also pruned after an hour).
- The `encrypted` map in `messages.ts` keeps the ciphertext of decrypted rows (capped at 2000) so a key change can lock them again.

## Decision log

| Decision | Why | Dead ends |
| --- | --- | --- |
| Videos shown as a first-frame JPEG poster, played by a native `VideoView` dialog | Discord's player cannot play a local video. On device: `file://` gives a thumbnail (only with a real extension) but fullscreen shows 0:00 black; a loopback `http://127.0.0.1` server was never contacted even with cleartext allowed; public `https://` plays. Showing the video as an image avoids Discord's video component (and its broken inline play button) completely. | Loopback HTTP server (Discord never connects); renaming to `.mp4` alone; hooking the inline play button (no component found in any reference code). |
| Hook `openMediaModal` to start the player | Tapping a poster fires it with the poster's `file://` uri. `initialSources` can be a list or a list of lists. The uri may carry a `?width&height` query, so the file is found from the path only. | |
| `Spec.force` behind a setting, default on | There is no confirm dialog in the plugin, so media over Aegires' auto limits would otherwise stay `.enc` forever. | |
| Only pictures and videos are decrypted on receive | Aegires does the same (one file per message; audio and other files have no decrypt path). | |
| Key prompt as a Valenced alert | `AlertActionCreators.openAlert` with `AlertModal` (from the Valenced bundle). An alert action closes the alert when pressed, so results come back as toasts. | |
| Input-bar button copied from `silent-typing` | Human-written, proven placement hook. | |
| One `release.yml` for stable and beta | Beta (`valenced-port`) and stable (`main`) used the same build and publish steps. | Separate `rolling.yml`, `branch-build.yml` (duplicates). |
| `validate.yml` (template PR check) removed | Solo repo; it runs with the package token on `pull_request_target` and fails without a repo variable. | |
| `largeMedia` stored as optional | Older saved settings do not have it, absent means on. | |

## Verified facts (checked on a device, do not re-research)

- `withAppActivity { activity -> ... }` in the plugin `start` scope gives the app Activity once; the captured Activity can go stale, so `VideoPlayer.play` checks `isFinishing`/`isDestroyed` and returns false.
- Discord viewer: found with `withProps('openMediaModal')` (as `picture-links` does).
- `LockIcon` exists in the generated icon set; `ChatInputActions.tsx` and `ChatInputActionButton.tsx` paths are as in `silent-typing`.
- Upload objects expose `item.uri`; attachments are `{ id, filename, size, url, proxy_url, content_type, ... }`.
- Kotlin bridge: a `null as String` cast throws; numbers arrive as `Number`; return `Double`, not `Int`/`Long`.
- Spec `MediaCache.Spec.force` is a public boolean field. Auto limits: pictures 6 MiB, videos 4 MiB; max 48 MiB and 256 MiB.
- Aegires plays video in a fullscreen WebView. That route was not used.

## Release state

- Manifest `2.0.0`. `valenced-port` publishes betas; merging to `main` publishes stable. Bump the manifest on `valenced-port` after a stable release (see `HANDOFF.md`).
- `v1` (text only) was on `main` before this work.

## Open items

- Forced channels untested since the test channel was deleted.
- Three `evt as any` casts remain in `index.ts` for Flux payloads, which have no types.
- Possible Kettu/Revenge port: first check whether those clients can run native code.
