# valenced-e2ee

End-to-end encrypted messages for Valenced, compatible with [Aegires](https://github.com/Curione23/Aegires) (branch `gen3`) and the Aliucord plugin.

- Text messages: send, edit, decrypt, reply previews.
- Key is typed in the plugin settings and kept in memory only; it is gone after a restart.
- Aegires crypto classes are vendored unchanged in `plugins/e2ee/src/main/java/com/e2ee/plugin/` (checked by `scripts/verify-vendored.sh`).
- Media and files: not yet.
