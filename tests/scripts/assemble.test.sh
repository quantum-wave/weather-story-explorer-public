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

# W2-09: with no data folder the recorded forecast ships; with one, that folder ships instead
R="$A/tests/site/fixtures/recorded"; mkdir -p "$R"
printf '{"sample":true,"sample_label":"Recorded forecast","run":"2026-11-19T00:00Z"}\n' > "$R/manifest.json"; printf 'rec' > "$R/z500.g1.a.bin"
asm "$A/d7"
[ "$ARC" -eq 0 ] && [ -f "$A/d7/data/z500.g1.a.bin" ] && grep -q 'Recorded forecast' "$A/d7/data/manifest.json" && [ "$(cat "$A/d7/data/z500.g1.a.bin")" = rec ] && grep -q 'shipping the recorded forecast' "$A/out"
check "assemble: no data folder ships the recorded forecast, and says so" $? "rc=$ARC $(cat "$A/err" "$A/out")"
[ ! -e "$A/d7/data/z500.bin" ] && ! grep -q '^{}$' "$A/d7/data/manifest.json"; check "assemble: the recorded forecast replaces site/data" $? "$(find "$A/d7/data" -type f)"
asm "$A/d8" "$A/data-in"
[ "$ARC" -eq 0 ] && [ -f "$A/d8/data/z500.bin" ] && [ ! -e "$A/d8/data/z500.g1.a.bin" ] && ! grep -q 'Recorded forecast' "$A/d8/data/manifest.json" && ! grep -q 'shipping the recorded' "$A/out"
check "assemble: with a data folder it ships that folder, not the recorded forecast" $? "rc=$ARC $(find "$A/d8/data" -type f)"
asm "$A/d9" "$R"; [ "$ARC" -eq 0 ] && [ -f "$A/d9/data/z500.g1.a.bin" ] && ! grep -q 'shipping the recorded' "$A/out"; check "assemble: the recorded folder named explicitly ships too" $? "rc=$ARC"
echo '{"sample":true,"sample_label":"Recorded run shape (SYNTHETIC stand-in)"}' > "$R/manifest.json"
asm "$A/d10"; [ "$ARC" -ne 0 ] && grep -q 'synthetic' "$A/err" && [ ! -e "$A/d10/data/manifest.json" ]; check "assemble: a synthetic recorded folder is refused, nothing left behind" $? "rc=$ARC $(cat "$A/err")"
asm "$A/d10" "$A/data-in"; check "assemble: an explicit data folder still ships when the recorded one is synthetic" "$ARC" "rc=$ARC"
rm -rf "$A/tests"
asm "$A/d11"; [ "$ARC" -eq 0 ] && [ -f "$A/d11/data/manifest.json" ] && ! grep -q 'shipping the recorded' "$A/out"; check "assemble: no recorded folder falls back to site/data" $? "rc=$ARC"

# the synthetic test fixture never ships, from a data folder or from site/data
mkdir -p "$A/syn-in"; echo '{"sample":true,"sample_note":"synthetic test data"}' > "$A/syn-in/manifest.json"
asm "$A/d5" "$A/syn-in"; [ "$ARC" -ne 0 ] && grep -q 'synthetic' "$A/err" && [ ! -e "$A/d5/data/manifest.json" ]; check "assemble: refuses a synthetic data folder and leaves nothing behind" $? "rc=$ARC $(cat "$A/err")"
cp "$A/site/data/manifest.json" "$A/real-manifest.bak"; echo '{"sample":true,"attribution":"synthetic test data, no source"}' > "$A/site/data/manifest.json"
asm "$A/d6"; [ "$ARC" -ne 0 ] && grep -q 'synthetic' "$A/err"; check "assemble: refuses synthetic data in site/data" $? "rc=$ARC"
cp "$A/real-manifest.bak" "$A/site/data/manifest.json"
# the repo's own site/data and the fixture the tests default to
SD="${WSE_SITE_DATA_MANIFEST:-$ROOT/site/data/manifest.json}" # wse-lint: ok (presence asserted just below)
if [ -f "$SD" ]; then
  ! grep -qi synthetic "$SD"; check "site/data (shipped by default) is not synthetic" $? "synthetic found"
elif [ -n "${WSE_SKIP_SITE_DATA:-}" ]; then
  ok "site/data (shipped by default) is not synthetic: SKIPPED explicitly (WSE_SKIP_SITE_DATA), site/data is not built here"
else
  bad "site/data (shipped by default) is not synthetic" "site/data/manifest.json is absent: build it, or set WSE_SKIP_SITE_DATA=1 to skip explicitly"
fi

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
[ -f "$B/art/index.html" ] && [ -f "$B/art/js/vendor.js" ] && ! grep -rq 'vendor/' "$B/art/index.html" "$B/art/js/vendor.js"; check "assemble --artifact: no vendor/ path is left" $? "$(grep -rn 'vendor/' "$B/art/index.html" "$B/art/js/vendor.js")"
node --input-type=module --check < "$B/art/js/vendor.js" 2>"$B/syn.err"; check "assemble --artifact: vendor.js is still valid JavaScript" $? "$(cat "$B/syn.err")"
[ "$(cat "$B/art/config.json")" = '{"canonicalUrl":null}' ]; check "assemble --artifact: config.json still written" $? "$(cat "$B/art/config.json")"
asmb "$B/art" "$B/data-in" --artifact --canonical-url https://claude.ai/x
[ "$BRC" -eq 0 ] && [ -f "$B/art/data/z500a.g1.a.wasm" ]; check "assemble --artifact: re-run into the same folder works" $? "rc=$BRC $(cat "$B/err")"

# the repo's own recording (made by tools/make_sample.py from a real run; never synthetic)
REC="${WSE_RECORDED_MANIFEST:-$ROOT/tests/site/fixtures/recorded/manifest.json}"
if [ -f "$REC" ]; then
  ! grep -qi synthetic "$REC"; check "recorded forecast is not synthetic" $? "synthetic found in $REC"
  python3 - "$REC" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
assert m["sample"] is True and "cases" not in m and m.get("sample_label"), "needs sample true, a sample_label and no cases"
assert m["fields"]["z500a"]["steps"][-1] >= 168, "z500a must reach 168 h"
PY
  check "recorded forecast: sample true, a label, no cases, z500a reaches 168 h" $? "see $REC"
  python3 - "$REC" > "$A/recsize" 2>&1 <<'PY'
import json, os, sys
d = os.path.dirname(os.path.abspath(sys.argv[1]))
m = json.load(open(sys.argv[1]))
files = sorted(os.listdir(d))
total = sum(os.path.getsize(os.path.join(d, f)) for f in files)  # every file, manifest.json included
ref = {meta["path"] for f in m["fields"].values() for c in f["chunks"] for meta in c["files"].values()}
assert set(files) == ref | {"manifest.json"}, f"files other than the manifest and its chunks: {sorted(set(files) ^ (ref | {'manifest.json'}))}"
print(f"recorded folder {total} bytes (manifest.json {os.path.getsize(os.path.join(d, 'manifest.json'))}), cap 14000000")
assert total <= 14_000_000, "over the 14 MB cap"
PY
  check "recorded forecast: the whole folder, manifest.json counted, is within 14,000,000 bytes" $? "$(cat "$A/recsize")"
  ( cd "$ROOT" && bash tools/assemble.sh "$WORK/rec-dist" ) > "$A/out" 2> "$A/err"
  check "assemble: the real site plus the recorded forecast fits the limits" $? "$(cat "$A/err" "$A/out" | tail -8)"
elif [ -n "${WSE_SKIP_RECORDED:-}" ]; then
  ok "recorded forecast checks: SKIPPED explicitly (WSE_SKIP_RECORDED)"
else
  bad "recorded forecast exists" "tests/site/fixtures/recorded/manifest.json is absent: the product ships it by default (tools/make_sample.py <real build> tests/site/fixtures/recorded); set WSE_SKIP_RECORDED=1 to skip explicitly"
fi
