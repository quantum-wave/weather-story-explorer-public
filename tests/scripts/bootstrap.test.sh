#!/usr/bin/env bash
# Tests for scripts/bootstrap-mac.sh (stub gh, git, security on PATH) and tools/assemble.sh.
#   bash tests/scripts/bootstrap.test.sh
# Prints PASS/FAIL per check and "SCRIPTS: <n> passed, <m> failed"; exit 1 on any failure.
# Fakes live in a temp folder under $TMPDIR and are removed on every exit path.
set -u
HERE="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(cd "$HERE/../.." && pwd -P)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/wse-scripts-test.XXXXXX")" || exit 1
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

PASS=0 FAILN=0
ok()  { PASS=$((PASS + 1)); echo "PASS $1"; }
bad() { FAILN=$((FAILN + 1)); echo "FAIL $1: $2"; }
check() { # name, condition-exit-status, reason
  if [ "$2" -eq 0 ]; then ok "$1"; else bad "$1" "$3"; fi
}
has()   { grep -qF -- "$2" "$1"; }

SECRET_TOKEN="tok-SECRET-9f3a7c"
SECRET_ACCT="acct-SECRET-5b21"

# ---- fake binaries -----------------------------------------------------------------------------
STUBS="$WORK/stubs"; mkdir -p "$STUBS"
cat > "$STUBS/git" <<'FAKE'
#!/usr/bin/env bash
echo "git $*" >> "$STATE/calls.log"
case "$1 $2" in
  "init -b") mkdir -p .git ;;
  "branch --show-current") cat "$STATE/branch" 2>/dev/null || echo main ;;
  "branch -M") echo main > "$STATE/branch" ;;
  "status --porcelain") cat "$STATE/dirty" 2>/dev/null || true ;;
  "add -A") ;;
  "commit -m") rm -f "$STATE/dirty" ;;
  "remote get-url") [ -f "$STATE/origin" ] && cat "$STATE/origin" || exit 2 ;;
  "remote add") echo "$4" > "$STATE/origin" ;;
  "remote set-url") echo "$4" > "$STATE/origin" ;;
  "remote remove") rm -f "$STATE/origin" ;;
  "push -u") rc="$(cat "$STATE/push_rc" 2>/dev/null || echo 0)"; [ "$rc" -eq 0 ] || echo "! [rejected] main -> main (fetch first)" >&2; exit "$rc" ;;
  *) echo "fake git: unexpected $*" >&2; exit 99 ;;
esac
FAKE
cat > "$STUBS/security" <<'FAKE'
#!/usr/bin/env bash
echo "security $*" >> "$STATE/calls.log"
[ -f "$STATE/keychain" ] || exit 44
case "$*" in
  *wse-cloudflare-api-token*) printf '%s\n' "$KC_TOKEN" ;;
  *wse-cloudflare-account-id*) printf '%s\n' "$KC_ACCT" ;;
  *) exit 44 ;;
esac
FAKE
cat > "$STUBS/gh" <<'FAKE'
#!/usr/bin/env bash
echo "gh $*" >> "$STATE/calls.log"
case "$1 $2" in
  "auth status")
    [ -f "$STATE/noauth" ] && { echo "You are not logged into any GitHub hosts." >&2; exit 1; }
    echo "github.com"; echo "  - Token scopes: $(cat "$STATE/scopes" 2>/dev/null || echo "'gist', 'repo', 'workflow'")" ;;
  "config get") echo "${GH_PROTO:-https}" ;;
  "repo view")
    if [ -f "$STATE/view_error" ]; then echo "error connecting to api.github.com" >&2; exit 1; fi
    if [ -f "$STATE/repo_exists" ]; then echo "quantum-wave/weather-story-explorer"; exit 0; fi
    echo "GraphQL: Could not resolve to a Repository with the name 'quantum-wave/weather-story-explorer'. (repository)" >&2; exit 1 ;;
  "repo create")
    touch "$STATE/repo_exists"; echo "https://github.com/quantum-wave/weather-story-explorer" > "$STATE/origin" ;;
  "secret list") [ -f "$STATE/secrets_list" ] && cat "$STATE/secrets_list" || true ;;
  "secret set")
    cat > "$STATE/secret.$3"; : ;;
  "workflow list")
    n=$(( $(cat "$STATE/wf_polls" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STATE/wf_polls"
    after="$(cat "$STATE/wf_after" 2>/dev/null || echo 0)"
    if [ "$n" -gt "$after" ] && [ ! -f "$STATE/wf_never" ]; then echo ".github/workflows/clim.yml"; echo ".github/workflows/data.yml"; echo ".github/workflows/pages.yml"; fi ;;
  "workflow run") echo "$3" > "$STATE/last_wf"; touch "$STATE/dispatched_$3" ;;
  "run list")
    # Before the dispatch: nothing, or (with $STATE/prior_runs) the previous completed run. After it: the new run,
    # which only shows once the poll asks for dispatched runs, as the script must.
    case "$*" in *clim.yml*) wf=clim.yml; new=101; old=91 ;; *data.yml*) wf=data.yml; new=102; old=92 ;; esac
    if [ -f "$STATE/dispatched_$wf" ] && { [ ! -f "$STATE/late_run" ] || [ "$(cat "$STATE/list_polls" 2>/dev/null || echo 0)" -ge 2 ]; }; then echo "$new"
    elif [ -f "$STATE/prior_runs" ]; then echo "$old"; fi
    echo $(( $(cat "$STATE/list_polls" 2>/dev/null || echo 0) + 1 )) > "$STATE/list_polls"
    case "$*" in *"--event workflow_dispatch"*) echo "event-filter" >> "$STATE/run_list_filters" ;; esac ;;
  "run watch") [ -f "$STATE/fail_$3" ] && exit 1 || exit 0 ;;
  "run view")
    case "$*" in
      *"--json url"*) echo "https://github.com/quantum-wave/weather-story-explorer/actions/runs/$3" ;;
      *"--json jobs"*) [ -f "$STATE/fail_$3" ] && echo "  failing step: build / Fetch ECMWF fields" ;;
    esac ;;
  *) echo "fake gh: unexpected $*" >&2; exit 99 ;;
esac
FAKE
chmod +x "$STUBS"/*

# A PATH holding only basic utilities, to test a missing tool.
BARE="$WORK/bare"; mkdir -p "$BARE"
for t in bash env dirname grep sed cat tr head wc date sleep mkdir rm ls awk sort find; do
  p="$(command -v "$t" 2>/dev/null || true)"; [ -n "$p" ] && ln -s "$p" "$BARE/$t"
done

# ---- scenario runner ---------------------------------------------------------------------------
N=0
new_case() { # sets CASE_DIR (project copy), STATE; callers set state files afterwards
  N=$((N + 1))
  CASE_DIR="$WORK/case$N/proj"; STATE="$WORK/case$N/state"
  mkdir -p "$CASE_DIR/scripts" "$STATE"
  cp "$ROOT/scripts/bootstrap-mac.sh" "$CASE_DIR/scripts/"
  : > "$STATE/calls.log"; LOG="$STATE/calls.log"
}
run_boot() { # args to script; stdin from $INPUT (default empty); out in $STATE/out, err in $STATE/err
  ( cd "$CASE_DIR" && env STATE="$STATE" PATH="${USE_PATH:-$STUBS:$PATH}" KC_TOKEN="$SECRET_TOKEN" KC_ACCT="$SECRET_ACCT" \
      WSE_POLL_SLEEP=0 WSE_WAIT_SECS="${WAIT:-60}" bash scripts/bootstrap-mac.sh "$@" \
      < "${INPUT:-/dev/null}" > "$STATE/out" 2> "$STATE/err" )
  RC=$?
  cat "$STATE/out" "$STATE/err" >> "$WORK/all-output.txt"
}
calls() { cat "$STATE/calls.log"; }
called() { grep -qF -- "$1" "$STATE/calls.log"; }

# 1. syntax and shellcheck
for f in scripts/bootstrap-mac.sh tools/assemble.sh tests/scripts/bootstrap.test.sh tests/scripts/assemble.test.sh; do
  bash -n "$ROOT/$f" 2>"$WORK/syn.err"; check "syntax $f" $? "$(cat "$WORK/syn.err")"
done
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck -S warning "$ROOT/scripts/bootstrap-mac.sh" "$ROOT/tools/assemble.sh" >"$WORK/sc.out" 2>&1; check "shellcheck" $? "$(head -20 "$WORK/sc.out")"
else
  echo "SKIP shellcheck (not installed)"
fi

# 2. first run: nothing exists
new_case; echo dirty > "$STATE/dirty"; run_boot
check "first run exits 0" "$RC" "rc=$RC: $(cat "$STATE/err")"
called "git init -b main"; check "first run: git init" $? "no git init"
called "git commit -m Sync from cloud workspace"; check "first run: commits the unsaved work" $? "no commit"
called "gh repo create quantum-wave/weather-story-explorer --private --source . --remote origin --push"; check "first run: gh repo create with the exact flags" $? "$(calls)"
called "git push"; r=$?; check "first run: no separate push after create" $((1 - r)) "unexpected git push"
called "gh secret set"; r=$?; check "first run: no secrets without --pages or yes" $((1 - r)) "secret set was called"
grep -n "gh workflow run" "$LOG" | sed 's/^[0-9]*://' > "$STATE/wfruns"
[ "$(cat "$STATE/wfruns")" = "$(printf 'gh workflow run clim.yml --repo quantum-wave/weather-story-explorer\ngh workflow run data.yml --repo quantum-wave/weather-story-explorer')" ]
check "first run: runs clim.yml then data.yml in that order" $? "$(cat "$STATE/wfruns")"
has "$STATE/out" "https://github.com/quantum-wave/weather-story-explorer/actions"; check "first run: prints the Actions URL" $? "no URL"
has "$STATE/out" "actions/runs/101"; check "first run: prints the run URL" $? "no run URL"
has "$STATE/out" "Result: done."; check "first run: says done" $? "$(cat "$STATE/out")"

# 3. re-run: repo exists, origin correct
new_case; touch "$STATE/repo_exists"; echo "https://github.com/quantum-wave/weather-story-explorer.git" > "$STATE/origin"; mkdir "$CASE_DIR/.git"
run_boot
check "re-run exits 0" "$RC" "rc=$RC: $(cat "$STATE/err")"
called "gh repo create"; r=$?; check "re-run: does not create" $((1 - r)) "created again"
called "git push -u origin main"; check "re-run: pushes with upstream" $? "$(calls)"
called "git init"; r=$?; check "re-run: no second git init" $((1 - r)) "git init ran"
grep -qE "git remote (add|set-url|remove)" "$LOG"; r=$?; check "re-run: leaves a correct origin alone" $((1 - r)) "$(grep 'git remote' "$LOG")"

# 4. repo exists, no origin yet
new_case; touch "$STATE/repo_exists"; mkdir "$CASE_DIR/.git"; run_boot
called "git remote add origin https://github.com/quantum-wave/weather-story-explorer.git"; check "existing repo, no origin: adds origin" $? "$(calls)"
called "git push -u origin main"; check "existing repo, no origin: pushes" $? "$(calls)"

# 4b. ssh preference
new_case; touch "$STATE/repo_exists"; mkdir "$CASE_DIR/.git"; GH_PROTO=ssh run_boot
called "git remote add origin git@github.com:quantum-wave/weather-story-explorer.git"; check "gh ssh preference: ssh origin" $? "$(calls)"

# 5. repo exists, origin points elsewhere
new_case; touch "$STATE/repo_exists"; mkdir "$CASE_DIR/.git"; echo "git@github.com:someone/else.git" > "$STATE/origin"; run_boot
called "git remote set-url origin https://github.com/quantum-wave/weather-story-explorer.git"; check "wrong origin: set-url to the repo" $? "$(calls)"

# 6. stale origin, repo missing on GitHub
new_case; mkdir "$CASE_DIR/.git"; echo "git@github.com:quantum-wave/old-name.git" > "$STATE/origin"; run_boot
called "git remote remove origin"; check "stale origin: removed first" $? "$(calls)"
called "gh repo create"; check "stale origin: repo created" $? "$(calls)"
rm_line="$(grep -n 'git remote remove' "$LOG" | head -1 | cut -d: -f1)"; cr_line="$(grep -n 'gh repo create' "$LOG" | head -1 | cut -d: -f1)"
[ "${rm_line:-99}" -lt "${cr_line:-0}" ]; check "stale origin: removal comes before create" $? "remove line $rm_line, create line $cr_line"

# 7. missing workflow scope
new_case; echo "'gist', 'repo'" > "$STATE/scopes"; run_boot
[ "$RC" -ne 0 ]; check "missing workflow scope: exits non-zero" $? "rc=0"
has "$STATE/err" "gh auth refresh -s workflow"; check "missing workflow scope: prints the refresh command" $? "$(cat "$STATE/err")"
called "gh repo create"; r=$?; check "missing workflow scope: nothing created" $((1 - r)) "created"
called "git push"; r=$?; check "missing workflow scope: nothing pushed" $((1 - r)) "pushed"

# 8. not signed in
new_case; touch "$STATE/noauth"; run_boot
[ "$RC" -ne 0 ]; check "not signed in: exits non-zero" $? "rc=0"
has "$STATE/err" "gh auth login"; check "not signed in: says gh auth login" $? "$(cat "$STATE/err")"

# 9. missing tools
new_case; USE_PATH="$BARE" run_boot
[ "$RC" -ne 0 ] && has "$STATE/err" "git is missing"; check "no git: stops with an install hint" $? "rc=$RC $(cat "$STATE/err")"
new_case; cp "$STUBS/git" "$WORK/bare/git"; USE_PATH="$BARE" run_boot; rm -f "$WORK/bare/git"
[ "$RC" -ne 0 ] && has "$STATE/err" "gh (GitHub CLI) is missing"; check "no gh: stops with an install hint" $? "rc=$RC $(cat "$STATE/err")"

# 10. network error on repo view must not create
new_case; touch "$STATE/view_error"; run_boot
[ "$RC" -ne 0 ]; check "repo view network error: exits non-zero" $? "rc=0"
called "gh repo create"; r=$?; check "repo view network error: does not create" $((1 - r)) "created"

# 11. push rejected
new_case; touch "$STATE/repo_exists"; mkdir "$CASE_DIR/.git"; echo 1 > "$STATE/push_rc"; run_boot
[ "$RC" -ne 0 ]; check "push rejected: exits non-zero" $? "rc=0"
has "$STATE/err" "never force-pushes"; check "push rejected: explains, no force" $? "$(cat "$STATE/err")"
called "--force"; r=$?; check "push rejected: no force flag anywhere" $((1 - r)) "force used"

# 12. --pages with Keychain
new_case; touch "$STATE/repo_exists" "$STATE/keychain"; mkdir "$CASE_DIR/.git"; run_boot --pages --no-run
check "--pages (keychain) exits 0" "$RC" "rc=$RC $(cat "$STATE/err")"
[ "$(cat "$STATE/secret.CLOUDFLARE_API_TOKEN" 2>/dev/null)" = "$SECRET_TOKEN" ]; check "--pages: token reached gh secret set via stdin" $? "missing"
[ "$(cat "$STATE/secret.CLOUDFLARE_ACCOUNT_ID" 2>/dev/null)" = "$SECRET_ACCT" ]; check "--pages: account id reached gh secret set via stdin" $? "missing"
grep -qF -e "$SECRET_TOKEN" -e "$SECRET_ACCT" "$LOG"; r=$?; check "--pages: secret values never in any command line" $((1 - r)) "$(grep -F SECRET "$LOG")"
grep -qF -e "$SECRET_TOKEN" -e "$SECRET_ACCT" "$STATE/out" "$STATE/err"; r=$?; check "--pages: secret values not on stdout or stderr" $((1 - r)) "leaked"
called "gh workflow"; r=$?; check "--no-run: no workflow started" $((1 - r)) "workflow called"
has "$STATE/out" "pages.dev"; check "--pages: prints the pages.dev URL" $? "no URL"

# 13. --pages, no Keychain item: hidden prompt on stdin
new_case; touch "$STATE/repo_exists"; mkdir "$CASE_DIR/.git"; printf '%s\n%s\n' "$SECRET_TOKEN" "$SECRET_ACCT" > "$WORK/input$N"
INPUT="$WORK/input$N" run_boot --pages --no-run
[ "$(cat "$STATE/secret.CLOUDFLARE_API_TOKEN" 2>/dev/null)" = "$SECRET_TOKEN" ] && [ "$(cat "$STATE/secret.CLOUDFLARE_ACCOUNT_ID" 2>/dev/null)" = "$SECRET_ACCT" ]
check "--pages (prompt): both values stored" $? "$(ls "$STATE")"
grep -qF -e "$SECRET_TOKEN" -e "$SECRET_ACCT" "$STATE/out" "$STATE/err" "$LOG"; r=$?; check "--pages (prompt): typed values never echoed or logged" $((1 - r)) "leaked"
has "$STATE/err" "typing is hidden"; check "--pages (prompt): prompt says typing is hidden" $? "$(cat "$STATE/err")"

# 14. y/N prompt: yes, then no
new_case; touch "$STATE/repo_exists" "$STATE/keychain"; mkdir "$CASE_DIR/.git"; echo y > "$WORK/input$N"; INPUT="$WORK/input$N" run_boot --no-run
[ -f "$STATE/secret.CLOUDFLARE_API_TOKEN" ]; check "y at the prompt sets the secrets" $? "none set"
new_case; touch "$STATE/repo_exists" "$STATE/keychain"; mkdir "$CASE_DIR/.git"; echo n > "$WORK/input$N"; INPUT="$WORK/input$N" run_boot --no-run
[ ! -f "$STATE/secret.CLOUDFLARE_API_TOKEN" ]; check "n at the prompt sets nothing" $? "set"

# 15. empty hidden entry: skipped, not stored
new_case; touch "$STATE/repo_exists"; mkdir "$CASE_DIR/.git"; INPUT=/dev/null run_boot --pages --no-run
[ ! -f "$STATE/secret.CLOUDFLARE_API_TOKEN" ]; check "--pages with nothing entered stores nothing" $? "stored"

# 16. data workflow fails
new_case; touch "$STATE/repo_exists" "$STATE/fail_102"; mkdir "$CASE_DIR/.git"; run_boot
[ "$RC" -eq 1 ]; check "data.yml failure: exit 1" $? "rc=$RC"
has "$STATE/out" "failing step: build / Fetch ECMWF fields"; check "data.yml failure: prints the failing step" $? "$(cat "$STATE/out")"

# 17. clim fails: data not started
new_case; touch "$STATE/repo_exists" "$STATE/fail_101"; mkdir "$CASE_DIR/.git"; run_boot
[ "$RC" -eq 1 ]; check "clim.yml failure: exit 1" $? "rc=$RC"
called "workflow run data.yml"; r=$?; check "clim.yml failure: data.yml not started" $((1 - r)) "data started"

# 17b. a re-run: the previous completed runs are still listed; the script must wait for the new ones
new_case; touch "$STATE/repo_exists" "$STATE/prior_runs" "$STATE/late_run"; mkdir "$CASE_DIR/.git"; run_boot
check "re-run with old runs listed: exit 0" "$RC" "rc=$RC: $(cat "$STATE/out")"
has "$STATE/out" "/runs/101"; check "re-run: watches the new clim run, not the old one" $? "$(cat "$STATE/out")"
has "$STATE/out" "/runs/102"; check "re-run: watches the new data run, not the old one" $? "$(cat "$STATE/out")"
called "run watch 91"; r=$?; check "re-run: never watches the old run" $((1 - r)) "$(calls)"
[ -f "$STATE/run_list_filters" ]; check "re-run: asks only for workflow_dispatch runs" $? "no --event filter"

# 18. workflows appear late, and never
new_case; touch "$STATE/repo_exists"; mkdir "$CASE_DIR/.git"; echo 3 > "$STATE/wf_after"; run_boot
check "workflows listed on the 4th poll: still runs" "$RC" "rc=$RC"
new_case; touch "$STATE/repo_exists" "$STATE/wf_never"; mkdir "$CASE_DIR/.git"; WAIT=0 run_boot
[ "$RC" -eq 1 ]; check "workflows never listed: exit 1" $? "rc=$RC"
has "$STATE/out" "not listed yet"; check "workflows never listed: tells Josh where to start them" $? "$(cat "$STATE/out")"

# 19. repo secrets already set: no prompt
new_case; touch "$STATE/repo_exists"; mkdir "$CASE_DIR/.git"; printf 'CLOUDFLARE_API_TOKEN\t2026-11-18\nCLOUDFLARE_ACCOUNT_ID\t2026-11-18\n' > "$STATE/secrets_list"; run_boot --no-run
has "$STATE/out" "already set"; check "secrets already set: noted, not re-asked" $? "$(cat "$STATE/out")"

# 20. no secret value anywhere in the whole run output
grep -qF -e "$SECRET_TOKEN" -e "$SECRET_ACCT" "$WORK/all-output.txt"; r=$?; check "no secret value in any run's stdout or stderr" $((1 - r)) "leaked"

# ---- pages.yml ---------------------------------------------------------------------------------
PY="${WSE_PYTHON:-python3}"
PG="$ROOT/.github/workflows/pages.yml"
"$PY" -I - "$PG" > "$WORK/pages.out" 2>&1 <<'PYEOF'
import sys
try:
    import yaml
except ImportError:
    print("SKIP"); sys.exit(0)
d = yaml.safe_load(open(sys.argv[1]))
on = d.get(True) or d.get("on")
assert on["workflow_run"]["workflows"] == ["data"], "must follow the data workflow"
assert "workflow_dispatch" in on
gate, dep = d["jobs"]["gate"], d["jobs"]["deploy"]
assert dep["needs"] == "gate" and "deploy == 'true'" in dep["if"], "deploy must be gated"
text = open(sys.argv[1]).read()
assert "assemble.sh dist data/latest" in text and "wrangler@4 pages deploy dist" in text
assert text.count("secrets.CLOUDFLARE_API_TOKEN") >= 2
for line in text.splitlines():
    assert "cfut_" not in line and "Bearer" not in line, "literal credential"
print("OK")
PYEOF
if has "$WORK/pages.out" SKIP; then echo "SKIP pages.yml structure (no PyYAML)"; else has "$WORK/pages.out" OK; check "pages.yml: gated on the secret, follows data, assembles, deploys" $? "$(cat "$WORK/pages.out")"; fi

# ---- assemble ------------------------------------------------------------------------------------
source "$HERE/assemble.test.sh"

echo "SCRIPTS: $PASS passed, $FAILN failed"
[ "$FAILN" -eq 0 ]
