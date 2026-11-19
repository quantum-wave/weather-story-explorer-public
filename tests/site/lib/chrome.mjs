// Find the browser the tests drive: CHROME_BIN, else the newest Playwright-downloaded chromium_headless_shell. Never an installed
// Google Chrome (house rule, AGENTS.md): such a path is refused with a message, and none found exits with a clear message.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// "Google Chrome for Testing" is Playwright's own download and allowed; the installed browser is not.
const FORBIDDEN = /google[ -]chrome(?! for testing)/i;

export function playwrightCaches() {
  const out = [];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') out.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  const h = os.homedir();
  if (process.platform === 'darwin') out.push(path.join(h, 'Library', 'Caches', 'ms-playwright'));
  else out.push(path.join(h, '.cache', 'ms-playwright'));
  return out;
}

function newest(prefix, rel) {
  const found = [];
  for (const cache of playwrightCaches()) {
    if (!fs.existsSync(cache)) continue;
    for (const n of fs.readdirSync(cache)) {
      const m = n.match(new RegExp(`^${prefix}-(\\d+)$`));
      if (!m) continue;
      const dir = path.join(cache, n);
      for (const r of rel) { const p = path.join(dir, r); if (fs.existsSync(p)) found.push({ rev: +m[1], p }); }
    }
  }
  found.sort((a, b) => b.rev - a.rev);
  return found.map((f) => f.p);
}

/** Absolute path to a headless shell, or throws Error with a clear message. */
export function chromePath(env = process.env) {
  const bin = env.CHROME_BIN;
  if (bin) {
    if (FORBIDDEN.test(bin)) throw new Error(`CHROME_BIN=${bin} is an installed Google Chrome, which the tests never use. Unset it or point it at Playwright's chromium_headless_shell (npx playwright@1.64.1 install chromium-headless-shell).`);
    if (!fs.existsSync(bin)) throw new Error(`CHROME_BIN=${bin} does not exist.`);
    return bin;
  }
  const hits = newest('chromium_headless_shell', ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-headless-shell-linux/chrome-headless-shell']);
  if (hits[0]) return hits[0];
  throw new Error(`No Playwright chromium_headless_shell found in ${playwrightCaches().join(' or ')}. Install it with: npx playwright@1.64.1 install chromium-headless-shell (or set CHROME_BIN).`);
}

/** Playwright's full Chromium (new headless mode); used only by the input self-test. null when not downloaded. */
export function fullChromiumPath() {
  const hits = newest('chromium', ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-linux64/chrome', 'chrome-linux/chrome']);
  return hits[0] || null;
}

// CLI: node chrome.mjs prints the resolved path, or the message and exit 2.
import { fileURLToPath } from 'node:url';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(chromePath()); } catch (e) { console.error(e.message); process.exit(2); }
}
