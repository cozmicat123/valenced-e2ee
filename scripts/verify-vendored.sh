#!/usr/bin/env bash
# AI-written glue. Checks the vendored Aegires files against the pinned upstream commit.
# Only the `package` line may differ. Usage: scripts/verify-vendored.sh [path-to-Aegires-clone]
set -euo pipefail

PIN=dddead05ec875ed91a54dd14c50c60bf4094bc2c
UP=app/src/main/java/a/b/util
OURS=plugins/e2ee/src/main/java/com/e2ee/plugin

SRC=${1:-}
if [ -z "$SRC" ]; then
  SRC=$(mktemp -d)
  git clone -q https://github.com/Curione23/Aegires "$SRC"
fi
git -C "$SRC" checkout -q "$PIN"

ok=1
for f in Argon2id Blake2b Crypto FileNames ForcedKeys; do
  if diff <(grep -v '^package ' "$SRC/$UP/$f.java") <(grep -v '^package ' "$OURS/$f.java") >/dev/null; then
    echo "$f same"
  else
    echo "$f DIFFERS from pin $PIN"
    ok=0
  fi
done
[ "$ok" = 1 ]
