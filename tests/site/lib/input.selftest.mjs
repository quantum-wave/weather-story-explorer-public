// input.mjs self-test (W0-01, Josh point 3 / TEST-3): type 11272026 into a native date input with real CDP key events and
// read back 2026-11-27. Tries Playwright's headless shell, then the full chromium in new headless mode, and reports which
// worked. If neither works it prints REAL TYPING NOT PROVEN with the evidence of both attempts and exits 1.
// --both also tries the full chromium when the shell already worked (evidence for the record).
// Run: node tests/site/lib/input.selftest.mjs
import { Browser, killAll } from './cdp.mjs';
import { chromePath, fullChromiumPath } from './chrome.mjs';
import { click, tap, drag, flick, pinch, wheel, type as typeText, key } from './input.mjs';

const HTML = `data:text/html,${encodeURIComponent(`<!doctype html><meta name=viewport content="width=device-width">
<style>body{margin:0;font:16px sans-serif}#d{position:absolute;left:20px;top:20px;font-size:20px}#pad{position:absolute;left:20px;top:120px;width:300px;height:200px;background:#ddd;touch-action:none;overflow:auto}</style>
<input id=d type=date><div id=pad><div style="height:900px;width:900px">pad</div></div>
<script>window.ev=[];for(const t of ['mousedown','mouseup','click','touchstart','touchmove','touchend','wheel','pointerdown','keydown'])
document.addEventListener(t,e=>ev.push(t),{passive:true,capture:true});</script>`)}`;

async function attempt(name, executablePath, headless) {
  const ev = { mode: name, executablePath, headless };
  let b;
  try {
    b = await Browser.launch({ baseUrl: 'http://127.0.0.1:1/', executablePath, headless });
    const page = await b.newPage();
    await page.setViewport(390, 844, 2);
    await page.goto(HTML);
    ev.ua = await page.eval('navigator.userAgent');
    // A person clicks the month segment (left edge of the field), then types the digits.
    const box = await page.eval(`(() => { const r = document.getElementById('d').getBoundingClientRect(); return { x: r.left, y: r.top, h: r.height }; })()`);
    await click(page, { x: box.x + 14, y: box.y + box.h / 2 });
    await typeText(page, null, '11272026', { delay: 25 });
    ev.value = await page.eval(`document.getElementById('d').value`);
    ev.events = await page.eval('ev.slice(0,12).join(",")');
    ev.ok = ev.value === '2026-11-27';
    // Smoke the other helpers: they must dispatch events the page sees.
    await tap(page, '#pad'); await drag(page, '#pad', { by: { dx: 40, dy: 10 } }); await flick(page, '#pad', { dx: -60 });
    await pinch(page, '#pad'); await wheel(page, '#pad', { dy: 80 }); await key(page, null, 'Tab');
    const seen = await page.eval('[...new Set(ev)].join(",")');
    ev.helperEvents = seen;
    for (const need of ['click', 'touchstart', 'touchend', 'wheel', 'mousedown', 'keydown']) if (!seen.includes(need)) { ev.ok = false; ev.error = `helper events missing ${need}: ${seen}`; }
  } catch (e) { ev.ok = false; ev.error = String(e.message || e); } finally { await b?.close().catch(() => {}); }
  return ev;
}

const attempts = [];
const first = await attempt('headless shell', chromePath(), 'new');
attempts.push(first);
let used = first.ok ? first : null;
if (!used || process.argv.includes('--both')) {
  const full = fullChromiumPath();
  if (full) { const second = await attempt('chromium new headless', full, 'new'); attempts.push(second); if (second.ok) used ||= second; }
  else attempts.push({ mode: 'chromium new headless', ok: false, error: 'full chromium not downloaded' });
}
killAll();
if (used) { console.log(`input self-test: typed 11272026 and read ${used.value} using ${used.mode}`); console.log(JSON.stringify(attempts)); process.exit(0); }
console.log('REAL TYPING NOT PROVEN');
console.log(JSON.stringify(attempts, null, 1));
process.exit(1);
