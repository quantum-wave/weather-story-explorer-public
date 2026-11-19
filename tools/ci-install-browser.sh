#!/usr/bin/env bash
# Install Playwright's chromium-headless-shell for CI at a pinned version.
#   tools/ci-install-browser.sh <playwright-version>
# GitHub's ubuntu-24.04 image already carries the system libraries a Chromium needs (it ships Google Chrome), so
# the browser is installed without apt first and smoke-launched. Only if that launch fails are the OS packages
# installed (`install-deps`), with retries, because apt mirror outages failed `--with-deps` twice on 2026-11-19.
# The runner image presets CHROME_BIN to its installed Google Chrome, which the test harness refuses, so the script
# points CHROME_BIN at the headless shell for later steps (via $GITHUB_ENV).
set -euo pipefail
v="${1:?usage: tools/ci-install-browser.sh <playwright-version>}"

npx --yes "playwright@$v" install chromium-headless-shell

shell="$(ls -d "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux*/chrome-headless-shell 2>/dev/null | sort | tail -1 || true)"
[ -n "$shell" ] || { echo "STOP: chromium-headless-shell not found after install" >&2; exit 1; }
if [ -n "${GITHUB_ENV:-}" ]; then echo "CHROME_BIN=$shell" >> "$GITHUB_ENV"; fi
echo "CHROME_BIN for later steps: $shell"
if "$shell" --headless --no-sandbox --disable-gpu --dump-dom about:blank >/dev/null 2>&1; then
  echo "ok: chromium-headless-shell launches without extra OS packages ($shell)"
  exit 0
fi

echo "headless shell did not launch; installing its OS packages"
for i in 1 2 3; do
  if sudo apt-get -o Acquire::Retries=5 update -q && npx --yes "playwright@$v" install-deps chromium-headless-shell; then
    echo "ok: OS packages installed (attempt $i)"
    exit 0
  fi
  echo "install-deps attempt $i failed; retrying in 30 s"
  sleep 30
done
echo "STOP: could not install the browser's OS packages after 3 attempts" >&2
exit 1
