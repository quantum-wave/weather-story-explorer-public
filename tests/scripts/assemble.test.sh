#!/usr/bin/env bash
# Tests for tools/assemble.sh. Sourced by bootstrap.test.sh (uses its ok/bad/check helpers, $WORK, $ROOT).
# Standalone: bash tests/scripts/assemble.test.sh
if [ -z "${WORK:-}" ]; then
  exec bash -c 'cd "$(dirname "$1")" && source ./bootstrap.test.sh' _ "$0"
fi

A="$WORK/assemble"; mkdir -p "$A/tools" "$A/site/js" "$A/site/vendor" "$A/data-in"
cp "$ROOT/tools/assemble.sh" "$A/tools/assemble.sh"
echo '<!doctype html><title>t</title>' > "$A/site/index.html"
echo 'export const a=1;' > "$A/site/js/a.js"
echo 'junk' > "$A/site/.DS_Store"
echo '{"sample":true}' > "$A/data-in/manifest.json"
head -c 5000 /dev/zero > "$A/data-in/z500.bin"
asm() { ( cd "$A" && bash tools/assemble.sh "$@" ) > "$A/out" 2> "$A/err"; ARC=$?; cat "$A/out" "$A/err" >> "$WORK/all-output.txt"; }

asm "$A/dist" "$A/data-in" --canonical-url https://example.pages.dev/
check "assemble: success exit 0" "$ARC" "$(cat "$A/err")"
[ -f "$A/dist/index.html" ] && [ -f "$A/dist/js/a.js" ] && [ -f "$A/dist/data/manifest.json" ] && [ -f "$A/dist/data/z500.bin" ]
check "assemble: site and data files present" $? "$(find "$A/dist" -type f)"
[ "$(cat "$A/dist/config.json")" = '{"canonicalUrl":"https://example.pages.dev/"}' ]; check "assemble: config.json carries the canonical URL" $? "$(cat "$A/dist/config.json")"
[ ! -e "$A/dist/.DS_Store" ]; check "assemble: .DS_Store left out" $? "present"
grep -q '^files:   5 ' "$A/out"; check "assemble: prints the file count" $? "$(cat "$A/out")"
grep -q '^total:   ' "$A/out" && grep -q 'limit 64.00 MiB' "$A/out"; check "assemble: prints total size against the 64 MiB limit" $? "$(cat "$A/out")"
grep -q 'limit 20.00 MiB' "$A/out"; check "assemble: prints the largest file against the 20 MiB limit" $? "$(cat "$A/out")"

echo stale > "$A/dist/stale.txt"; asm "$A/dist" "$A/data-in"
[ "$ARC" -eq 0 ] && [ ! -e "$A/dist/stale.txt" ]; check "assemble: re-run clears the earlier output" $? "rc=$ARC"
[ "$(cat "$A/dist/config.json")" = '{"canonicalUrl":null}' ]; check "assemble: no URL gives null" $? "$(cat "$A/dist/config.json")"

asm "$A/site/dist" "$A/data-in"
[ "$ARC" -ne 0 ] && [ ! -e "$A/site/dist" ]; check "assemble: refuses dist inside site/ and creates nothing" $? "rc=$ARC"
asm "$A" "$A/data-in"
[ "$ARC" -ne 0 ] && [ -f "$A/site/index.html" ]; check "assemble: refuses a dist that contains site/" $? "rc=$ARC"
mkdir -p "$A/other"; echo keep > "$A/other/mine.txt"
asm "$A/other"
[ "$ARC" -ne 0 ] && [ -f "$A/other/mine.txt" ]; check "assemble: refuses to clear a folder it did not make" $? "rc=$ARC"
asm "$A/d2" "$A/nope"; [ "$ARC" -ne 0 ]; check "assemble: missing data folder fails" $? "rc=0"
mkdir -p "$A/nomanifest"; asm "$A/d2" "$A/nomanifest"; [ "$ARC" -ne 0 ]; check "assemble: data folder without manifest.json fails" $? "rc=0"
asm "$A/d2" "$A/data-in" --canonical-url 'javascript:x'; [ "$ARC" -ne 0 ]; check "assemble: rejects a non-http canonical URL" $? "rc=0"
asm "$A/d2" "$A/data-in" --canonical-url 'https://a"b'; [ "$ARC" -ne 0 ]; check "assemble: rejects a quote in the URL" $? "rc=0"
asm; [ "$ARC" -ne 0 ]; check "assemble: no arguments prints usage and fails" $? "rc=0"

# limits (env overrides keep the fixtures small)
WSE_MAX_FILES=4 asm "$A/d3" "$A/data-in"; [ "$ARC" -eq 1 ] && grep -q 'files is over the limit of 4' "$A/err"; check "assemble: fails over the file-count limit" $? "rc=$ARC $(cat "$A/err")"
WSE_MAX_BYTES=4000 asm "$A/d3" "$A/data-in"; [ "$ARC" -eq 1 ] && grep -q 'over the limit' "$A/err"; check "assemble: fails over the total-size limit" $? "rc=$ARC $(cat "$A/err")"
WSE_MAX_FILE_BYTES=4000 asm "$A/d3" "$A/data-in"; [ "$ARC" -eq 1 ] && grep -q 'z500.bin' "$A/err"; check "assemble: fails over the per-file limit and names the file" $? "rc=$ARC $(cat "$A/err")"
WSE_MAX_FILES=5 asm "$A/d3" "$A/data-in"; check "assemble: exactly at the file limit passes" "$ARC" "rc=$ARC"
WSE_MAX_FILES=4 asm "$A/d3" "$A/data-in"; [ "$ARC" -eq 1 ]; check "assemble: re-run after a limit failure works again" $? "rc=$ARC"

# site/data copied when no data folder is given
mkdir -p "$A/site/data"; echo '{}' > "$A/site/data/manifest.json"; asm "$A/d4"
[ "$ARC" -eq 0 ] && [ -f "$A/d4/data/manifest.json" ]; check "assemble: without a data folder, site/data is copied along" $? "rc=$ARC"

# the synthetic test fixture never ships, from a data folder or from site/data
mkdir -p "$A/syn-in"; echo '{"sample":true,"sample_note":"synthetic test data"}' > "$A/syn-in/manifest.json"
asm "$A/d5" "$A/syn-in"; [ "$ARC" -ne 0 ] && grep -q 'synthetic' "$A/err" && [ ! -e "$A/d5/data/manifest.json" ]; check "assemble: refuses a synthetic data folder and leaves nothing behind" $? "rc=$ARC $(cat "$A/err")"
cp "$A/site/data/manifest.json" "$A/real-manifest.bak"; echo '{"sample":true,"attribution":"synthetic test data, no source"}' > "$A/site/data/manifest.json"
asm "$A/d6"; [ "$ARC" -ne 0 ] && grep -q 'synthetic' "$A/err"; check "assemble: refuses synthetic data in site/data" $? "rc=$ARC"
cp "$A/real-manifest.bak" "$A/site/data/manifest.json"
# the repo's own site/data and the fixture the tests default to
! grep -qi synthetic "$ROOT/site/data/manifest.json"; check "site/data (shipped by default) is not synthetic" $? "synthetic found"

# the real site, against the real limits
( cd "$ROOT" && bash tools/assemble.sh "$WORK/real-dist" tests/site/fixtures/sample-min --canonical-url https://example.pages.dev/ ) > "$A/out" 2> "$A/err"
check "assemble: the real site plus the real sample data fits the limits" $? "$(cat "$A/err" "$A/out" | tail -8)"

# ---- --artifact mode: .bin -> .wasm, CDN libraries instead of vendor/ ------------------------------------------
B="$WORK/artifact"; mkdir -p "$B/tools" "$B/site/js" "$B/site/vendor/d3@7.9.2" "$B/data-in"
cp "$ROOT/tools/assemble.sh" "$B/tools/assemble.sh"
cp "$ROOT/site/index.html" "$B/site/index.html"; cp "$ROOT/site/js/vendor.js" "$B/site/js/vendor.js"
echo 'lib' > "$B/site/vendor/d3@7.9.2/d3.min.js"
printf '{"fields":{"z500a":{"chunks":[{"id":"a","files":{"g1":{"path":"z500a.g1.a.bin","bytes":5,"sha256":"x"}}}]}},"sample":false}\n' > "$B/data-in/manifest.json"
printf 'chunk' > "$B/data-in/z500a.g1.a.bin"
asmb() { ( cd "$B" && bash tools/assemble.sh "$@" ) > "$B/out" 2> "$B/err"; BRC=$?; cat "$B/out" "$B/err" >> "$WORK/all-output.txt"; }

asmb "$B/default" "$B/data-in"
[ "$BRC" -eq 0 ] && [ -f "$B/default/data/z500a.g1.a.bin" ] && [ -d "$B/default/vendor" ] && grep -q 'src="vendor/d3@7.9.2/d3.min.js"' "$B/default/index.html" && grep -q "../vendor/gifenc@1.0.3/gifenc.esm.js" "$B/default/js/vendor.js"
check "assemble default: vendored libraries and .bin chunks stay as they are" $? "rc=$BRC $(find "$B/default" -type f | head -20)"

asmb "$B/art" "$B/data-in" --artifact
check "assemble --artifact: exit 0" "$BRC" "rc=$BRC $(cat "$B/err")"
[ -f "$B/art/data/z500a.g1.a.wasm" ] && [ ! -e "$B/art/data/z500a.g1.a.bin" ] && [ "$(cat "$B/art/data/z500a.g1.a.wasm")" = chunk ]
check "assemble --artifact: data chunks renamed to .wasm, content untouched" $? "$(ls "$B/art/data")"
grep -q '"path":"z500a.g1.a.wasm"' "$B/art/data/manifest.json" && ! grep -q '\.bin' "$B/art/data/manifest.json"
check "assemble --artifact: manifest paths rewritten to .wasm" $? "$(cat "$B/art/data/manifest.json")"
[ ! -e "$B/art/vendor" ]; check "assemble --artifact: vendor/ left out" $? "$(ls "$B/art")"
for u in "https://cdn.jsdelivr.net/npm/d3@7.9.2/dist/d3.min.js" "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js"; do
  grep -qF "src=\"$u\"" "$B/art/index.html"; check "assemble --artifact: index.html loads $u" $? "$(grep script "$B/art/index.html")"
done
for u in "https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js" "https://cdn.jsdelivr.net/npm/fflate@0.8.3/esm/browser.js"; do
  grep -qF "'$u'" "$B/art/js/vendor.js"; check "assemble --artifact: vendor.js imports $u" $? "$(cat "$B/art/js/vendor.js")"
done
! grep -rq 'vendor/' "$B/art/index.html" "$B/art/js/vendor.js"; check "assemble --artifact: no vendor/ path is left" $? "$(grep -rn 'vendor/' "$B/art/index.html" "$B/art/js/vendor.js")"
node --input-type=module --check < "$B/art/js/vendor.js" 2>"$B/syn.err"; check "assemble --artifact: vendor.js is still valid JavaScript" $? "$(cat "$B/syn.err")"
[ "$(cat "$B/art/config.json")" = '{"canonicalUrl":null}' ]; check "assemble --artifact: config.json still written" $? "$(cat "$B/art/config.json")"
asmb "$B/art" "$B/data-in" --artifact --canonical-url https://claude.ai/x
[ "$BRC" -eq 0 ] && [ -f "$B/art/data/z500a.g1.a.wasm" ]; check "assemble --artifact: re-run into the same folder works" $? "rc=$BRC $(cat "$B/err")"
