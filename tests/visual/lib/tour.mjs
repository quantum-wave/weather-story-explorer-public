// The tour: drives every stop at phone 390x844@2 (touch) and desktop 1440x900 through tests/site/lib/input.mjs, takes a
// screenshot once the page is idle, runs the layout assertions, diffs against a baseline when one exists, and writes PNGs plus
// one self-contained contact sheet under $WSE_ARTIFACTS/visual/. Browsers and servers are closed in finally.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Browser } from '../../site/lib/cdp.mjs';
import { startServer } from '../../site/lib/server.mjs';
import { artifactsDir } from '../../site/lib/artifacts.mjs';
import * as input from '../../site/lib/input.mjs';
import { runLayoutAssertions, describeOffender } from './layout-assert.mjs';
import { compareImages } from './diff.mjs';
import { writeContactSheet } from './contact-sheet.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const VISUAL_DIR = path.resolve(here, '..');
export const REPO = path.resolve(VISUAL_DIR, '..', '..');
export const VIEWPORTS = {
  phone: { width: 390, height: 844, dpr: 2, mobile: false, touch: true },
  desktop: { width: 1440, height: 900, dpr: 1, mobile: false, touch: false },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '_');

// A card's day table (story/daytable.js) scrolls sideways inside its wrapper whenever its days do not fit, on every stop
// that shows a card: a scroller by design, not a layout fault.
const ALWAYS_SCROLLERS = ['.strip-wrap.dt-scroll'];

/** The idle gate: the app has booted, fonts are loaded, and two screenshots 120 ms apart are byte-identical. */
export async function settle(page, { tries = 10 } = {}) {
  await page.waitFor(`document.fonts.status === 'loaded' && (!window.__wse || window.__wse.ready === true && (window.__wse.storyReady === true || !!window.__wse.error))`, { timeout: 30000 });
  await page.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  let prev = await page.screenshot();
  for (let i = 0; i < tries; i++) {
    await sleep(120);
    const cur = await page.screenshot();
    if (Buffer.compare(prev, cur) === 0) return { png: cur, stable: true };
    prev = cur;
  }
  return { png: prev, stable: false };
}

function boundInput(page, phone) {
  const touch = phone;
  return {
    phone,
    click: (t, o) => input.click(page, t, o), tap: (t, o) => input.tap(page, t, o),
    drag: (t, o) => input.drag(page, t, { touch, ...o }), flick: (t, o) => input.flick(page, t, o),
    pinch: (t, o) => input.pinch(page, t, o), wheel: (t, o) => input.wheel(page, t, o),
    type: (t, text, o) => input.type(page, t, text, o), key: (t, k, o) => input.key(page, t, k, o),
    /** What a person does to press something: a tap on the phone, a click on the desktop. */
    activate: (t, o) => (phone ? input.tap(page, t, o) : input.click(page, t, o)),
    wait: sleep,
  };
}

export async function loadStops(dir, only) {
  const files = fs.readdirSync(dir).filter((f) => /^\d+-.*\.mjs$/.test(f)).sort();
  const stops = [];
  for (const f of files) {
    const stop = (await import(pathToFileURL(path.join(dir, f)).href)).default;
    if (!stop || !stop.id || typeof stop.run !== 'function') throw new Error(`stop ${f} must export default { id, owner, gate, run }`);
    if (!stop.owner) throw new Error(`stop ${stop.id} names no owner package`);
    if (typeof stop.gate !== 'boolean') throw new Error(`stop ${stop.id} must say gate: true or false`);
    if (stop.gate === false && !Array.isArray(stop.mvpFails)) throw new Error(`stop ${stop.id} has gate:false but no mvpFails list`);
    stops.push({ file: f, viewports: ['phone', 'desktop'], data: 'synthetic', ...stop });
  }
  if (only?.length) {
    const missing = only.filter((o) => !stops.some((s) => s.id === o));
    if (missing.length) throw new Error('unknown stop id: ' + missing.join(', '));
    return stops.filter((s) => only.includes(s.id));
  }
  return stops;
}

/**
 * Run the tour. opts: { stopsDir, only, viewports, out, baselineDir, saveBaseline, gatePixels, referencesDir, log }.
 * Returns { ok, frames, errors, outDir, sheet }.
 */
export async function runTour(opts = {}) {
  const log = opts.log || ((m) => console.log(m));
  const stopsDir = path.resolve(opts.stopsDir || path.join(VISUAL_DIR, 'stops'));
  const outDir = path.resolve(opts.out || path.join(artifactsDir(), 'visual'));
  const baselineDir = path.resolve(opts.baselineDir || path.join(VISUAL_DIR, 'baselines'));
  const refDir = path.resolve(opts.referencesDir || process.env.WSE_REFERENCES || path.join(VISUAL_DIR, 'references'));
  const stops = await loadStops(stopsDir, opts.only);
  if (!stops.length) throw new Error(`no stops in ${stopsDir}`);
  fs.rmSync(path.join(outDir, 'new'), { recursive: true, force: true });
  fs.rmSync(path.join(outDir, 'diff'), { recursive: true, force: true });
  for (const d of ['new', 'diff']) fs.mkdirSync(path.join(outDir, d), { recursive: true });
  if (opts.saveBaseline) fs.mkdirSync(baselineDir, { recursive: true });

  const frames = [], servers = new Map();
  let browser, scratch, chromeVersion = 'unknown';
  try {
    const first = await startServer({});
    servers.set('synthetic', first);
    browser = await Browser.launch({ baseUrl: first.baseUrl, width: 1440, height: 900 });
    try { chromeVersion = (await browser.conn.send('Browser.getVersion')).product; } catch {}
    scratch = await browser.newPage(); // a blank page used only to diff images and make thumbnails
    await scratch.goto('about:blank');
    for (const stop of stops) {
      if (!servers.has(stop.data)) servers.set(stop.data, await startServer({ dataDir: path.join(REPO, 'tests', 'site', 'fixtures', stop.data) }));
      const baseUrl = servers.get(stop.data).baseUrl;
      for (const vpName of stop.viewports.filter((v) => !opts.viewports || opts.viewports.includes(v))) {
        const vp = VIEWPORTS[vpName];
        if (!vp) throw new Error(`stop ${stop.id}: unknown viewport ${vpName}`);
        browser.baseUrl = baseUrl; // the page may load only its own stop's server (page.mjs blocks other origins)
        const page = await browser.newPage(); // its own browser context: clean storage per stop and size
        page.baseUrl = baseUrl; // a stop that names another fixture (W4-05: synthetic-15d) is served by its own server; the page may talk to that one
        const snaps = [];
        const snap = async (name) => {
          const { png, stable } = await settle(page);
          const key = safe(name ? `${stop.id}--${name}` : stop.id) + `--${vpName}`;
          const lay = await runLayoutAssertions(page, { phone: vpName === 'phone', allowOverlap: stop.allowOverlap || [], allowTarget: stop.allowTarget || [], scrollers: [...(stop.scrollers || []), ...ALWAYS_SCROLLERS] });
          for (const o of lay.allowedTargets || []) console.log(`  [5 target, allowed by ${stop.id}] ${describeOffender(o)}`);
          const newPath = path.join(outDir, 'new', key + '.png');
          fs.writeFileSync(newPath, png);
          const frame = { stop: stop.id, owner: stop.owner, gate: stop.gate, mvpFails: stop.mvpFails || [], mvpReason: stop.mvpReason || '', viewport: vpName, name: name || '', key, newPath, stable, layout: lay, referenceFile: null, baseline: null, diff: null, error: null };
          const bPath = path.join(baselineDir, key + '.png');
          if (fs.existsSync(bPath)) {
            frame.baseline = { path: bPath };
            frame.diff = await compareImages(scratch, fs.readFileSync(bPath), png, stop.diffTolerance || {});
            if (frame.diff.diffPng) fs.writeFileSync(path.join(outDir, 'diff', key + '.png'), frame.diff.diffPng);
          }
          if (opts.saveBaseline) fs.copyFileSync(newPath, bPath);
          if (stop.reference) { const rp = path.join(refDir, stop.reference); if (fs.existsSync(rp)) frame.referenceFile = rp; }
          frames.push(frame); snaps.push(frame);
          return frame;
        };
        try {
          await page.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
          if (vp.touch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
          // reduced motion keeps the clock paused after the opening play, so a frame is the same on every run
          await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: stop.ground === 'paper' || stop.theme === 'light' ? 'light' : 'dark' }] });
          await page.goto(stop.url || baseUrl + (stop.hash || ''));
          await settle(page);
          const inp = boundInput(page, vpName === 'phone');
          if (stop.theme) {
            const cur = await page.eval(`document.documentElement.dataset.theme || ''`);
            if (cur !== stop.theme) { await inp.activate(vpName === 'phone' ? '#btn-more' : '#btn-display'); await inp.activate(`#display-menu [data-group="theme"] button[data-value="${stop.theme}"]`); await inp.key(null, 'Escape'); }
          }
          await stop.run(page, inp, { snap, viewport: vpName, baseUrl });
          await snap('');
          const errs = page.errors().map((e) => e.text).filter((t) => !/favicon/i.test(t));
          for (const f of snaps) f.consoleErrors = errs;
        } catch (e) {
          const msg = String(e?.stack || e).split('\n').slice(0, 4).join(' | ');
          log(`ERROR ${stop.id} ${vpName}: ${msg}`);
          let png = null; try { png = await page.screenshot(); } catch {}
          const key = safe(stop.id) + `--${vpName}--error`;
          if (png) fs.writeFileSync(path.join(outDir, 'new', key + '.png'), png);
          frames.push({ stop: stop.id, owner: stop.owner, gate: stop.gate, mvpFails: stop.mvpFails || [], mvpReason: '', viewport: vpName, name: 'error', key, newPath: png ? path.join(outDir, 'new', key + '.png') : null, layout: { offenders: [], failing: [], counts: {} }, error: msg, stable: false });
        } finally { await page.close(); }
      }
    }
    const platform = `${os.type()} ${os.release()} ${os.arch()}, Node ${process.version}, ${chromeVersion}`;
    const verdict = summarise(frames, !!opts.gatePixels, log); // sets each ungated frame's `note` before the sheet and report are written
    const sheet = await writeContactSheet({ frames, outDir, platform, scratch, opts: { gatePixels: !!opts.gatePixels, baselineDir } });
    return { ...verdict, frames, outDir, sheet, platform };
  } finally {
    try { await scratch?.close(); } catch {}
    try { await browser?.close(); } catch {}
    for (const s of servers.values()) { try { await s.close(); } catch {} }
  }
}

/** Decide pass or fail. Gated stops fail on any layout offender; every run error fails; pixels fail only with --gate-pixels. */
export function summarise(frames, gatePixels, log = () => {}) {
  const problems = [];
  for (const f of frames) {
    if (f.error) { problems.push(`${f.stop} ${f.viewport}: the stop failed to run: ${f.error}`); continue; }
    const fails = f.layout.offenders;
    if (f.gate && fails.length) {
      problems.push(`${f.stop}${f.name ? '/' + f.name : ''} ${f.viewport}: ${fails.length} layout offender(s) in assertion(s) ${f.layout.failing.join(',')}`);
      for (const o of fails.slice(0, 12)) log(`  ${describeOffender(o)}`);
    }
    if (gatePixels && f.diff?.exceeds) problems.push(`${f.stop}${f.name ? '/' + f.name : ''} ${f.viewport}: pixel diff ${(f.diff.changedFraction * 100).toFixed(2)}% over tolerance ${(f.diff.tolerance * 100).toFixed(2)}%${f.diff.note ? ' (' + f.diff.note + ')' : ''}`);
  }
  // The mvpFails cross-check, per stop: the assertions that fail on any frame of the stop (either size) against its mvpFails list.
  // A list that is out of date is stated on every frame of the stop, on the contact sheet and in report.json.
  const byStop = new Map();
  for (const f of frames) if (!f.gate && !f.error) { if (!byStop.has(f.stop)) byStop.set(f.stop, []); byStop.get(f.stop).push(f); }
  for (const [, fs_] of byStop) {
    const failing = new Set(fs_.flatMap((f) => f.layout.failing));
    const listed = fs_[0].mvpFails;
    const unlisted = [...failing].filter((n) => !listed.includes(n)).sort();
    const nowPass = listed.filter((n) => !failing.has(n)).sort();
    const note = [unlisted.length ? `not in mvpFails: ${unlisted.join(',')}` : '', nowPass.length ? `listed but passing: ${nowPass.join(',')}` : ''].filter(Boolean).join('; ');
    for (const f of fs_) f.note = note;
  }
  return { ok: problems.length === 0, problems };
}
