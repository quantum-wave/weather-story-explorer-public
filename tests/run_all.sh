#!/usr/bin/env bash
# Cross-component entry: pipeline tests, then site tests (then script tests once they exist).
# Usage: tests/run_all.sh [--data <dir>]   (--data goes to the site tests)
set -u
cd "$(dirname "$0")/.."
PY="${WSE_PYTHON:-}"
if [ -z "$PY" ]; then
  if [ -x .venv/bin/python ]; then PY=.venv/bin/python
  else PY=python3; fi
fi
rc=0
echo "== pipeline =="; "$PY" -I -m pytest tests/pipeline -q || rc=1
echo "== site =="; node tests/site/run.mjs "$@" || rc=1
# The Pages deploy runs the site tests on the live data (sample:false, no cases). Run every check on a live-like
# copy of the fixture too, so a check that only passes on sample data cannot regress. Skipped when --data is given.
case " $* " in
  *" --data "*) ;;
  *)
    LL="$(mktemp -d "${TMPDIR:-/tmp}/wse-livelike.XXXXXX")"
    node tests/site/lib/livelike.mjs "$LL/data" >/dev/null || rc=1
    ids="$(ls tests/site/checks | sed 's/\.mjs$//' | paste -sd, -)"
    echo "== site (live-like data) =="; node tests/site/run.mjs --data "$LL/data" --only "$ids" || rc=1
    rm -rf "$LL" ;;
esac
if [ -f tests/scripts/bootstrap.test.sh ]; then echo "== scripts =="; bash tests/scripts/bootstrap.test.sh || rc=1; fi
[ $rc -eq 0 ] && echo "ALL: passed" || echo "ALL: FAILED"
exit $rc
