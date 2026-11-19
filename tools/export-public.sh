#!/usr/bin/env bash
# One-way export of the code from this private repo to the public mirror, whose free Actions minutes run the
# data pipeline. Only allowlisted paths from a COMMITTED tree leave this repo; durable docs (WORKING, PARKED,
# DECISIONS, INTENT, the brief, research) stay private. The mirror has its own history: one snapshot commit per export.
#
#   tools/export-public.sh [--ref <commit>] [--push]
#     --ref   commit to export (default HEAD)
#     --push  push the mirror's main (without it, the snapshot is committed locally only)
#
# Mirror checkout: $WSE_PUBLIC_DIR (default ../weather-story-explorer-public); repo: $WSE_PUBLIC_REPO.
set -euo pipefail

PUBLIC_REPO="${WSE_PUBLIC_REPO:-quantum-wave/weather-story-explorer-public}"
REF=HEAD PUSH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    --push) PUSH=1; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."
PRIVATE="$(pwd)"
PUBLIC_DIR="${WSE_PUBLIC_DIR:-$(dirname "$PRIVATE")/weather-story-explorer-public}"
SHA="$(git rev-parse --verify "$REF^{commit}")"

# Paths that may go public. Anything not listed here stays private.
ALLOW=(.github .gitignore pipeline pytest.ini requirements.txt requirements-dev.txt scripts site tests tools)

[ -d "$PUBLIC_DIR/.git" ] || { echo "STOP: no mirror checkout at $PUBLIC_DIR (clone $PUBLIC_REPO there first)" >&2; exit 1; }
[ -z "$(git -C "$PUBLIC_DIR" status --porcelain)" ] || { echo "STOP: mirror checkout has uncommitted changes" >&2; exit 1; }

# Replace the mirror's tree (keeping its .git) with the allowlisted paths of the committed ref.
git -C "$PUBLIC_DIR" rm -rq --ignore-unmatch . >/dev/null
git archive "$SHA" -- "${ALLOW[@]}" | tar -x -C "$PUBLIC_DIR"
git show "$SHA:tools/public-README.md" > "$PUBLIC_DIR/README.md"

# Guard: nothing private may ride along.
leak="$(cd "$PUBLIC_DIR" && find . -path ./.git -prune -o -type f \( -name 'WORKING.md' -o -name 'PARKED.md' -o -name 'DECISIONS.md' -o -name 'ACTIVITY.md' -o -name 'INTENT.md' -o -name 'project-brief.md' -o -name 'AGENTS.md' \) -print)"
[ -z "$leak" ] || { echo "STOP: private doc in export: $leak" >&2; exit 1; }

git -C "$PUBLIC_DIR" add -A
if git -C "$PUBLIC_DIR" diff --cached --quiet; then
  echo "mirror already matches $SHA"
else
  git -C "$PUBLIC_DIR" commit -qm "Snapshot of the app code ($(git log -1 --format=%cs "$SHA"), source ${SHA:0:7})"
  echo "mirror committed: $(git -C "$PUBLIC_DIR" rev-parse --short HEAD) from $SHA"
fi
if [ "$PUSH" -eq 1 ]; then
  git -C "$PUBLIC_DIR" push -q origin main
  echo "pushed: $(git -C "$PUBLIC_DIR" ls-remote origin refs/heads/main)"
fi
