#!/usr/bin/env bash
# Run from the unzipped project folder on the Mac:
#   ./scripts/bootstrap-mac.sh [--pages] [--no-run]
# Creates the private GitHub repo quantum-wave/weather-story-explorer (or connects to it if it exists),
# pushes main, optionally stores the Cloudflare secrets for the Pages deploy, then starts the data
# workflows and prints next steps. Safe to re-run. Secrets are read from the macOS Keychain or a
# hidden prompt, piped straight to `gh secret set`, and never echoed or written to disk.
#
#   --pages    set the Cloudflare secrets (Option A, a public pages.dev URL) without asking
#   --no-run   push only; do not start the workflows
set -euo pipefail

REPO="${WSE_REPO:-quantum-wave/weather-story-explorer}"
WAIT_SECS="${WSE_WAIT_SECS:-60}"
POLL_SLEEP="${WSE_POLL_SLEEP:-3}"
PAGES_URL="https://weather-story-explorer.pages.dev/"
KC_TOKEN_SERVICE="wse-cloudflare-api-token"
KC_ACCOUNT_SERVICE="wse-cloudflare-account-id"

DO_PAGES=0 DO_RUN=1
for a in "$@"; do
  case "$a" in
    --pages) DO_PAGES=1 ;;
    --no-run) DO_RUN=0 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a (see --help)" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
fail() { printf 'STOP: %s\n' "$*" >&2; exit 1; }

cd "$(dirname "$0")/.."

# 1. Preflight -------------------------------------------------------------------------------
command -v git >/dev/null 2>&1 || fail "git is missing. Install it with: xcode-select --install"
command -v gh >/dev/null 2>&1 || fail "gh (GitHub CLI) is missing. Install it with: brew install gh"
if ! auth_out="$(gh auth status 2>&1)"; then
  fail "gh is not signed in. Run: gh auth login   (then run this script again)"
fi
case "$auth_out" in
  *workflow*) ;;
  *) fail "gh is signed in but its token lacks the 'workflow' scope, which GitHub needs to accept workflow files. Run: gh auth refresh -s workflow   (then run this script again)" ;;
esac
say "ok: git, gh signed in with the workflow scope"
if command -v wrangler >/dev/null 2>&1; then
  say "ok: wrangler found (not needed here; the deploy runs in GitHub Actions)"
else
  say "note: wrangler is not installed; that is fine, the deploy runs in GitHub Actions"
fi

# 2. Local repo and remote -------------------------------------------------------------------
[ -d .git ] || git init -b main
if [ "$(git branch --show-current 2>/dev/null || true)" != "main" ]; then git branch -M main; fi
if [ -n "$(git status --porcelain 2>/dev/null || true)" ]; then
  git add -A
  git commit -m "Sync from cloud workspace"
fi

proto="$(gh config get git_protocol 2>/dev/null || true)"
if [ "$proto" = "ssh" ]; then WANT_URL="git@github.com:$REPO.git"; else WANT_URL="https://github.com/$REPO.git"; fi

same_repo() { # does URL $1 point at $REPO?
  case "$1" in
    "https://github.com/$REPO"|"https://github.com/$REPO.git"|"git@github.com:$REPO"|"git@github.com:$REPO.git"|"ssh://git@github.com/$REPO"|"ssh://git@github.com/$REPO.git") return 0 ;;
  esac
  return 1
}

if view_err="$(gh repo view "$REPO" 2>&1 >/dev/null)"; then
  say "GitHub repo $REPO exists"
  if cur="$(git remote get-url origin 2>/dev/null)"; then
    if same_repo "$cur"; then say "origin already points at $REPO"
    else say "origin pointed at $cur; setting it to $WANT_URL"; git remote set-url origin "$WANT_URL"; fi
  else
    git remote add origin "$WANT_URL"
  fi
  git push -u origin main || fail "push was rejected. If the GitHub repo already holds other commits, tell Claude; this script never force-pushes."
else
  case "$(printf '%s' "$view_err" | tr '[:upper:]' '[:lower:]')" in
    *"could not resolve to a repository"*|*"404"*|*"not found"*) ;;
    *) fail "could not check whether $REPO exists (network or sign-in problem?): $view_err" ;;
  esac
  say "GitHub repo $REPO does not exist yet; creating it (private)"
  if cur="$(git remote get-url origin 2>/dev/null)"; then
    say "removing stale origin ($cur)"
    git remote remove origin
  fi
  gh repo create "$REPO" --private --source . --remote origin --push
fi
say "ok: main is on GitHub"

# 3. Cloudflare secrets (Option A) -----------------------------------------------------------
existing_secrets="$(gh secret list --repo "$REPO" 2>/dev/null || true)"
have_secret() { printf '%s\n' "$existing_secrets" | grep -q "^$1[[:space:]]*"; }

ask_yes_no() { # $1 prompt; default no; EOF is no
  local ans=""
  printf '%s [y/N] ' "$1" >&2
  read -r ans || true
  case "$ans" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

set_secret() { # $1 secret name, $2 keychain service, $3 prompt text
  local name="$1" service="$2" prompt="$3" value=""
  if command -v security >/dev/null 2>&1; then
    value="$(security find-generic-password -s "$service" -w 2>/dev/null || true)"
  fi
  if [ -n "$value" ]; then
    say "$name: read from the Keychain (item $service)"
  else
    printf '%s (typing is hidden): ' "$prompt" >&2
    read -rs value || true
    printf '\n' >&2
  fi
  if [ -z "$value" ]; then
    say "$name: nothing entered, skipped"
    return 1
  fi
  printf '%s' "$value" | gh secret set "$name" --repo "$REPO" >/dev/null
  value=""
  say "$name: stored as a GitHub Actions secret"
}

PAGES_ON=0
if have_secret CLOUDFLARE_API_TOKEN && have_secret CLOUDFLARE_ACCOUNT_ID && [ "$DO_PAGES" -eq 0 ]; then
  say "Cloudflare secrets are already set"
  PAGES_ON=1
elif [ "$DO_PAGES" -eq 1 ] || ask_yes_no "Set up the public pages.dev site now (needs a Cloudflare API token and account id)?"; then
  if set_secret CLOUDFLARE_API_TOKEN "$KC_TOKEN_SERVICE" "Cloudflare API token (Pages: Edit)" \
     && set_secret CLOUDFLARE_ACCOUNT_ID "$KC_ACCOUNT_SERVICE" "Cloudflare account id"; then
    PAGES_ON=1
  else
    say "Cloudflare setup incomplete; run this script again with --pages when you have both values"
  fi
fi

# 4. Workflows ---------------------------------------------------------------------------------
RUN_FAILED=0
watch_workflow() { # $1 workflow file
  local wf="$1" id="" url="" tries=0 steps before=""
  # The newest dispatched run before ours: on a re-run it is the previous, already finished run, which must not be
  # mistaken for the one we are about to start.
  before="$(gh run list --repo "$REPO" --workflow "$wf" --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)"
  gh workflow run "$wf" --repo "$REPO" || { say "could not start $wf"; return 1; }
  while [ -z "$id" ] && [ "$tries" -lt 10 ]; do
    sleep "$POLL_SLEEP"
    id="$(gh run list --repo "$REPO" --workflow "$wf" --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)"
    [ "$id" != "$before" ] || id=""
    tries=$((tries + 1))
  done
  [ -n "$id" ] || { say "started $wf, but no run appeared yet; look at the Actions page"; return 1; }
  url="$(gh run view "$id" --repo "$REPO" --json url --jq '.url' 2>/dev/null || true)"
  say "$wf running: ${url:-run $id}"
  if gh run watch "$id" --repo "$REPO" --exit-status >/dev/null 2>&1; then
    say "$wf finished: success"
    return 0
  fi
  say "$wf FAILED: ${url:-run $id}"
  steps="$(gh run view "$id" --repo "$REPO" --json jobs --jq '.jobs[] | select(.conclusion=="failure") | .name as $j | .steps[] | select(.conclusion=="failure") | "  failing step: \($j) / \(.name)"' 2>/dev/null || true)"
  [ -z "$steps" ] || say "$steps"
  return 1
}

if [ "$DO_RUN" -eq 1 ]; then
  say "waiting up to ${WAIT_SECS}s for GitHub to list the workflows"
  start=$SECONDS listed=""
  while :; do
    listed="$(gh workflow list --repo "$REPO" --json path --jq '.[].path' 2>/dev/null || true)"
    if printf '%s\n' "$listed" | grep -q 'clim\.yml$' && printf '%s\n' "$listed" | grep -q 'data\.yml$'; then break; fi
    [ $((SECONDS - start)) -lt "$WAIT_SECS" ] || break
    sleep "$POLL_SLEEP"
  done
  if printf '%s\n' "$listed" | grep -q 'clim\.yml$' && printf '%s\n' "$listed" | grep -q 'data\.yml$'; then
    if watch_workflow clim.yml; then
      watch_workflow data.yml || RUN_FAILED=1
    else
      say "skipping data.yml: it needs the climatology that clim.yml builds"
      RUN_FAILED=1
    fi
  else
    say "the workflows are not listed yet (clim.yml, data.yml). Start them from the Actions page below."
    RUN_FAILED=1
  fi
fi

# 5. Next steps --------------------------------------------------------------------------------
say ""
say "Repo:    https://github.com/$REPO"
say "Actions: https://github.com/$REPO/actions"
if [ "$PAGES_ON" -eq 1 ]; then
  say "Public site (after the first data run, about a minute for the deploy): $PAGES_URL"
else
  say "Public site: not set up. Re-run with --pages to add it later."
fi
say "Next: when data.yml shows a green tick, tell Claude \"data is live\"; it will refresh the artifact from the data branch."
if [ "$RUN_FAILED" -eq 1 ]; then
  say "Result: a workflow did not finish cleanly. Send Claude the failing step shown above."
  exit 1
fi
say "Result: done."
