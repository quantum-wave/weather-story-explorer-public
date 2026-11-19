#!/usr/bin/env bash
# Build the exact file set that gets published: site/ plus one data directory, plus config.json.
# One output serves both hosts (claude.ai artifact via publish_files, and Cloudflare Pages), so it
# is held to the strictest limits: at most 256 files, 64 MiB in total, 20 MiB per file.
#
#   tools/assemble.sh <dist> [<datadir>] [--canonical-url URL] [--artifact]
#
#   <dist>           output folder; created, or cleared if it is an earlier output of this script
#   <datadir>        folder holding manifest.json and the chunk files; becomes <dist>/data/.
#                    Without it, site/data/ (if present) is copied along with the rest of site/.
#   --canonical-url  the public address of the site (written to config.json; null if omitted)
#   --artifact       build for the claude.ai artifact host instead of Pages: data chunks *.bin are renamed *.wasm
#                    (the host refuses .bin and serves .wasm) with the manifest paths rewritten, and the vendored
#                    libraries are replaced by the same files from cdn.jsdelivr.net (vendor/ is left out).
#                    Without it the output is the default: vendored libraries, .bin chunks (Pages, tests).
#
# Prints the file count, total size and the largest files; exits 1 over a limit (the output stays
# in place for inspection). Test overrides: WSE_MAX_FILES, WSE_MAX_BYTES, WSE_MAX_FILE_BYTES.
set -euo pipefail

MAX_FILES="${WSE_MAX_FILES:-256}"
MAX_BYTES="${WSE_MAX_BYTES:-67108864}"
MAX_FILE_BYTES="${WSE_MAX_FILE_BYTES:-20971520}"

die() { echo "assemble: $*" >&2; exit 1; }

usage() {
  echo "Usage: tools/assemble.sh <dist> [<datadir>] [--canonical-url URL] [--artifact]" >&2
  exit 2
}

# Absolute, lexically normalised path (resolves symlinks in the part that exists).
absolute() {
  local p="$1" out="" part existing rest
  case "$p" in /*) ;; *) p="$PWD/$p" ;; esac
  local IFS=/
  for part in $p; do
    case "$part" in
      ''|.) ;;
      ..) out="${out%/*}" ;;
      *) out="$out/$part" ;;
    esac
  done
  [ -n "$out" ] || out=/
  existing="$out"; rest=""
  while [ ! -d "$existing" ]; do rest="/${existing##*/}$rest"; existing="${existing%/*}"; [ -n "$existing" ] || existing=/; done
  existing="$(cd "$existing" && pwd -P)"
  if [ "$existing" = "/" ]; then echo "$rest"; else echo "$existing$rest"; fi
}

mib() { awk -v b="$1" 'BEGIN { if (b >= 1048576) printf "%.2f MiB", b / 1048576; else printf "%.1f KiB", b / 1024 }'; }

DIST="" DATADIR="" CANON="" ARTIFACT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --canonical-url) [ $# -ge 2 ] || usage; CANON="$2"; shift 2 ;;
    --canonical-url=*) CANON="${1#*=}"; shift ;;
    --artifact) ARTIFACT=1; shift ;;
    -h|--help) usage ;;
    -*) echo "assemble: unknown option $1" >&2; usage ;;
    *) if [ -z "$DIST" ]; then DIST="$1"; elif [ -z "$DATADIR" ]; then DATADIR="$1"; else usage; fi; shift ;;
  esac
done
[ -n "$DIST" ] || usage

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
SITE="$ROOT/site"
[ -f "$SITE/index.html" ] || die "site/index.html not found under $ROOT"

if [ -n "$CANON" ]; then
  case "$CANON" in
    http://*|https://*) ;;
    *) die "--canonical-url must start with http:// or https://" ;;
  esac
  case "$CANON" in *[\"\\\ ]*) die "--canonical-url must not contain quotes, backslashes or spaces" ;; esac
fi

if [ -n "$DATADIR" ]; then
  [ -d "$DATADIR" ] || die "data folder not found: $DATADIR"
  [ -f "$DATADIR/manifest.json" ] || die "no manifest.json in $DATADIR"
  DATA_ABS="$(cd "$DATADIR" && pwd -P)"
fi

DIST_ABS="$(absolute "$DIST")"
case "$DIST_ABS/" in
  "$SITE"/*) die "refusing: $DIST is inside site/ (the output would be copied into itself)" ;;
esac
case "$SITE/" in
  "$DIST_ABS"/*) die "refusing: $DIST contains site/ (it would be cleared)" ;;
esac
if [ -n "$DATADIR" ]; then
  case "$DIST_ABS/" in "$DATA_ABS"/*) die "refusing: $DIST is inside the data folder" ;; esac
  case "$DATA_ABS/" in "$DIST_ABS"/*) die "refusing: $DIST contains the data folder (it would be cleared)" ;; esac
fi

if [ -e "$DIST_ABS" ]; then
  [ -d "$DIST_ABS" ] || die "$DIST exists and is not a folder"
  if [ -n "$(ls -A "$DIST_ABS")" ]; then
    { [ -f "$DIST_ABS/index.html" ] && [ -f "$DIST_ABS/config.json" ]; } \
      || die "refusing to clear $DIST: it is not an earlier output of this script (no index.html and config.json)"
    find "$DIST_ABS" -mindepth 1 -delete
  fi
else
  mkdir -p "$DIST_ABS"
fi

cp -R "$SITE"/. "$DIST_ABS"/
if [ -n "$DATADIR" ]; then
  rm -rf "$DIST_ABS/data"
  mkdir -p "$DIST_ABS/data"
  cp -R "$DATA_ABS"/. "$DIST_ABS/data"/
fi
# The `synthetic` test fixture (tests/site/fixtures/synthetic) is made-up weather for tests only: never ship it.
if [ -f "$DIST_ABS/data/manifest.json" ] && grep -qi 'synthetic' "$DIST_ABS/data/manifest.json"; then
  find "$DIST_ABS" -mindepth 1 -delete
  die "refusing: the data manifest says it is synthetic test data, which must never be published"
fi
# Editor and OS leftovers never ship.
find "$DIST_ABS" \( -name '.DS_Store' -o -name '__pycache__' -o -name '*.pyc' -o -name '.git' -o -name '.gitignore' \) -prune -exec rm -rf {} +

if [ "$ARTIFACT" -eq 1 ]; then
  CDN="https://cdn.jsdelivr.net/npm"
  # Data chunks: the artifact host serves .wasm and refuses .bin. Same bytes, new name, manifest paths follow.
  if [ -d "$DIST_ABS/data" ]; then
    while IFS= read -r f; do mv "$f" "${f%.bin}.wasm"; done < <(find "$DIST_ABS/data" -type f -name '*.bin')
    if [ -f "$DIST_ABS/data/manifest.json" ]; then
      sed 's/\.bin"/.wasm"/g' "$DIST_ABS/data/manifest.json" > "$DIST_ABS/data/manifest.json.new" && mv "$DIST_ABS/data/manifest.json.new" "$DIST_ABS/data/manifest.json"
    fi
  fi
  # Libraries: the exact npm files from jsdelivr instead of the vendored copies.
  rm -rf "$DIST_ABS/vendor"
  sed -e "s#src=\"vendor/d3@7.9.2/d3.min.js\"#src=\"$CDN/d3@7.9.2/dist/d3.min.js\"#" \
      -e "s#src=\"vendor/topojson-client@3.1.0/topojson-client.min.js\"#src=\"$CDN/topojson-client@3.1.0/dist/topojson-client.min.js\"#" \
      "$DIST_ABS/index.html" > "$DIST_ABS/index.html.new" && mv "$DIST_ABS/index.html.new" "$DIST_ABS/index.html"
  if [ -f "$DIST_ABS/js/vendor.js" ]; then
    # the Node-only branch (unit tests load the vendored files) goes with vendor/
    sed -e '/^if (typeof globalThis.d3 === .undefined. && globalThis.process/,/^}$/d' \
        -e "s#'../vendor/gifenc@1.0.3/gifenc.esm.js'#'$CDN/gifenc@1.0.3/dist/gifenc.esm.js'#" \
        -e "s#'../vendor/fflate@0.8.3/browser.js'#'$CDN/fflate@0.8.3/esm/browser.js'#" \
        "$DIST_ABS/js/vendor.js" > "$DIST_ABS/js/vendor.js.new" && mv "$DIST_ABS/js/vendor.js.new" "$DIST_ABS/js/vendor.js"
  fi
fi

if [ -n "$CANON" ]; then
  printf '{"canonicalUrl":"%s"}\n' "$CANON" > "$DIST_ABS/config.json"
else
  printf '{"canonicalUrl":null}\n' > "$DIST_ABS/config.json"
fi

[ -f "$DIST_ABS/index.html" ] || die "no index.html in the output"
if [ -d "$DIST_ABS/data" ] && [ ! -f "$DIST_ABS/data/manifest.json" ]; then
  echo "assemble: warning: no data/manifest.json in the output (the site will show no forecast)" >&2
fi

count=0 total=0 big_name="" big_size=0 over_file=""
sizes=""
while IFS= read -r f; do
  s="$(wc -c < "$f" | tr -d ' ')"
  rel="${f#"$DIST_ABS"/}"
  count=$((count + 1)); total=$((total + s))
  if [ "$s" -gt "$big_size" ]; then big_size="$s"; big_name="$rel"; fi
  if [ "$s" -gt "$MAX_FILE_BYTES" ]; then over_file="$over_file
  $rel: $(mib "$s") (limit $(mib "$MAX_FILE_BYTES"))"; fi
  sizes="$sizes$s $rel
"
done < <(find "$DIST_ABS" -type f | sort)

echo "assembled: $DIST_ABS"
echo "files:   $count (limit $MAX_FILES)"
echo "total:   $(mib "$total") (limit $(mib "$MAX_BYTES"))"
echo "largest: ${big_name:-none} ${big_name:+$(mib "$big_size") (limit $(mib "$MAX_FILE_BYTES"))}"
if [ -d "$DIST_ABS/data" ]; then
  dcount="$(find "$DIST_ABS/data" -type f | wc -l | tr -d ' ')"
  dtotal=0
  while IFS= read -r f; do dtotal=$((dtotal + $(wc -c < "$f" | tr -d ' '))); done < <(find "$DIST_ABS/data" -type f)
  echo "data:    $dcount files, $(mib "$dtotal")"
fi
echo "top five:"
printf '%s' "$sizes" | sort -rn | head -5 | while read -r s rel; do echo "  $(mib "$s")  $rel"; done

bad=""
[ "$count" -le "$MAX_FILES" ] || bad="$bad
  $count files is over the limit of $MAX_FILES"
[ "$total" -le "$MAX_BYTES" ] || bad="$bad
  $(mib "$total") is over the limit of $(mib "$MAX_BYTES")"
[ -z "$over_file" ] || bad="$bad
 files over the per-file limit:$over_file"
if [ -n "$bad" ]; then
  echo "assemble: FAILED, over the publish limits:$bad" >&2
  exit 1
fi
echo "assemble: OK"
