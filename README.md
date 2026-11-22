# valenced-e2ee

End-to-end encrypted chat for [Valenced](https://github.com/Valenced), compatible with [Aegires](https://github.com/Curione23/Aegires) (branch `gen3`) and the Aliucord plugin. Messages and files encrypted by any of the three can be read by the others.

## What it does

- **Text**: send, edit, decrypt, reply previews. Encrypted messages show a lock before the name.
- **Pictures**: sent and received in Aegires' file format, shown in place.
- **Videos**: shown as a picture of the first frame with a play badge. Tap to play in a native player.
- **Other files**: encrypted on send; received as encrypted files, as in Aegires.
- **Limits** (same as Aegires): one file per message, 25 MiB per upload.
- **Key**: typed in the plugin settings or in the prompt of the lock button next to the attachments button. It is kept in memory only, so it is gone after a restart.
- **Settings**: cipher profile, "Download large media automatically" (pictures over 6 MiB, videos over 4 MiB) and a debug log you can copy for bug reports (no message text or keys).

## How it is built

- Crypto and media handling are Aegires' own classes, vendored in `plugins/e2ee/src/main/java/com/e2ee/plugin/` with only the `package` line changed. `AndroidMedia` is upstream plus `patches/AndroidMedia.patch` (OkHttp replaced by `HttpURLConnection`). `scripts/verify-vendored.sh` checks all of them against the pinned upstream commit in CI.
- Kotlin (`plugins/e2ee/src/main/kotlin/`) holds the logic: `E2ee` (text), `E2eeFiles` (files), `VideoPlayer`, `E2eePlugin` (the native methods).
- TypeScript (`plugins/e2ee/js/`) is only hooks and UI: message and upload hooks, the input-bar button, settings.
- When Aegires changes, see [UPGRADING.md](UPGRADING.md).

## Install

Add the repository in Valenced and install **E2EE**. The plugin card's channel picker selects `latest` (stable) or `beta` (every push to `valenced-port`).

## License

See [LICENSE](LICENSE).
