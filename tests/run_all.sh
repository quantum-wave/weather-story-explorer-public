#!/usr/bin/env bash
# Cross-component entry: lints, pipeline tests, site tests (synthetic fixture, then a live-like copy), script tests, the
# input self-test. Usage: tests/run_all.sh [--data <dir>] [--tier deploy|full|network[,...]]   (flags go to the site tests)
# Output goes under $WSE_ARTIFACTS (default out/test-artifacts, git-ignored), never /tmp. The browser is found by
# tests/site/lib/chrome.mjs (CHROME_BIN, else Playwright's cache); no installed Google Chrome is ever used.
# A fresh clone first runs: python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
set -u
cd "$(dirname "$0")/.."
export WSE_ARTIFACTS="${WSE_ARTIFACTS:-$PWD/out/test-artifacts}"
mkdir -p "$WSE_ARTIFACTS" || exit 1
PY="${WSE_PYTHON:-}"
if [ -z "$PY" ]; then
  if [ -x .venv/bin/python ]; then PY=.venv/bin/python
  else PY=python3; fi
fi
# site/data/ is built locally and git-ignored: in a clean clone or CI it is absent. Say so and skip its checks explicitly.
if [ ! -f site/data/manifest.json ] && [ -z "${WSE_SKIP_SITE_DATA:-}" ]; then
  echo "note: site/data/manifest.json is not built here; checks that read it are skipped explicitly (WSE_SKIP_SITE_DATA=1)"
  export WSE_SKIP_SITE_DATA=1
fi
rc=0
echo "== lint =="; node tests/lint/hygiene.mjs || rc=1; node --test tests/lint/*.test.mjs || rc=1
echo "== pipeline =="; "$PY" -I -m pytest tests/pipeline -q || rc=1
echo "== site =="; node tests/site/run.mjs "$@" || rc=1
# The Pages deploy runs the site tests on the live data (sample:false, no cases). Run every check on a live-like
# copy of the fixture too, so a check that only passes on sample data cannot regress. Skipped when --data is given.
case " $* " in
  *" --data "*) ;;
  *)
    LL="$WSE_ARTIFACTS/livelike/data"
    node tests/site/lib/livelike.mjs "$LL" >/dev/null || rc=1
    # --only ignores tiers, so leave the network-tier checks out of the list here (they run nightly: --tier network)
    ids="$(grep -L "^export const tier = 'network'" tests/site/checks/*.mjs | xargs -n1 basename | sed 's/\.mjs$//' | paste -sd, -)"
    echo "== site (live-like data) =="; node tests/site/run.mjs --data "$LL" --only "$ids" || rc=1
    rm -rf "$WSE_ARTIFACTS/livelike" ;;
esac
if [ -f tests/scripts/bootstrap.test.sh ]; then echo "== scripts =="; bash tests/scripts/bootstrap.test.sh || rc=1; fi
echo "== input self-test =="; node tests/site/lib/input.selftest.mjs || rc=1
# W1-01: the tour runner, layout assertions and mutation runner prove they can fail (self-tests), then the tour runs (stops whose
# gate is false report but do not fail). The mutation gate itself (about a minute) is run on demand: node tests/mutations/run.mjs
echo "== visual and mutation self-tests =="; node tests/visual/lib/selftest.mjs || rc=1; node tests/mutations/run.mjs --selftest || rc=1
echo "== visual tour =="; node tests/visual/run.mjs || rc=1
[ $rc -eq 0 ] && echo "ALL: passed" || echo "ALL: FAILED"
exit $rc
