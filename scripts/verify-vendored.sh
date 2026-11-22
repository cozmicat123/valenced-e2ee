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
for f in Argon2id Blake2b Crypto FileNames ForcedKeys ImageLoader MediaCache SuperProperties; do
  if diff <(grep -v '^package ' "$SRC/$UP/$f.java") <(grep -v '^package ' "$OURS/$f.java") >/dev/null; then
    echo "$f same"
  else
    echo "$f DIFFERS from pin $PIN"
    ok=0
  fi
done

# AndroidMedia is upstream plus patches/AndroidMedia.patch (OkHttp -> HttpURLConnection), nothing else
w=$(mktemp -d)
grep -v '^package ' "$SRC/$UP/AndroidMedia.java" > "$w/AndroidMedia.java"
patch -s "$w/AndroidMedia.java" < patches/AndroidMedia.patch
if diff "$w/AndroidMedia.java" <(grep -v '^package ' "$OURS/AndroidMedia.java") >/dev/null; then
  echo "AndroidMedia same (with patch)"
else
  echo "AndroidMedia DIFFERS from pin $PIN + patch"
  ok=0
fi
[ "$ok" = 1 ]
