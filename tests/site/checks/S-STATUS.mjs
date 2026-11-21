// S-STATUS (W3-05, Josh point 5; design spec 8.5): loading and failure are visible, and a toast never covers anything.
//  1. corrupt chunk: a visible status with a Retry button within 2 s of the app being ready (it used to reach only the console);
//     once the file is good again a real click on Retry loads it and the status goes away. A missing chunk (404) does the same.
//  2. first load (acceptance 4), sampled from the start of the document on two links: a proxy that holds back only /data/ (2.5 s), and the
//     browser's own network emulation at fast 4G (40 ms, 9 Mbit/s, everything slow, d3 and the module graph included). At the 300 ms
//     sample the map is visible, its ground painted and its coastline drawn, the panel shows skeleton cards (not a sentence), and the page
//     is never blank before the field draws. Time is the page's own: main.js marks 'wse:first-paint' (it must be at or before 300 ms), and
//     the main thread is read from a Chrome trace in thread CPU time, which a busy machine does not inflate: no task of the page runs
//     100 ms or more of CPU before the data arrives (a long synchronous render at first paint fails on every run). The coastline is
//     pre-projected (ui/firstpaint.js, no d3), so it does not wait for d3 or the basemap; after boot it must sit where the renderer draws
//     it. A machine so busy that the first-paint files themselves arrive late is retried (at most three attempts, all logged). The check also reads index.html: no parser-blocking classic script in <head>, every
//     module main.js imports statically (transitively) modulepreloaded, and d3 and topojson record load and error on their tags. The
//     pre-projected geometry must equal what tools/build-firstpaint.mjs makes now, and its fit baseProjection's.
//  2b. d3 or topojson blocked: "Couldn't load the app." with Retry within 2 s of navigation, never an endless loading line; Retry works.
//      The space first paint reserved for the scrubber is given back (no empty sheet-coloured band, no stretched canvas).
//  2c. manifest blocked: "Couldn't load the forecast." with Retry, the same space given back, Retry works once the file is reachable.
//  3. toasts: at desktop and phone size a toast's box intersects no visible button, field, link or the timeline: the shared toast, the toast
//     the app really shows after a real click on Layers > Copy link, and the pins toast (host moved into the region).
//  4. partial data: later chunks held back: the status says "Showing days 1-N; later days are loading" and clears when they arrive.
//  5. same-wave hooks (renderer.sampleAt, openAddSheet, data.missing) are skipped when absent and called when present.
// Each case runs its own server (a copy of the synthetic fixture, or a delaying proxy) and browser; all are closed in finally.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Browser } from '../lib/cdp.mjs';
import { startServer, DEFAULT_DATA, SITE_DIR } from '../lib/server.mjs';
import { artifactPath } from '../lib/artifacts.mjs';
import * as inp from '../lib/input.mjs';

export const id = 'S-STATUS';
export const freshProfile = true;
export const timeoutMs = 240000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A scratch copy of the synthetic data directory under the artifacts folder. */
function copyData(name) {
  const dir = path.dirname(artifactPath('S-STATUS', name, 'x'));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(DEFAULT_DATA)) fs.copyFileSync(path.join(DEFAULT_DATA, f), path.join(dir, f));
  return dir;
}

/** Run `fn(page, baseUrl)` on a fresh server and browser, then close both. */
async function withApp({ dataDir, proxy }, fn, { viewport } = {}) {
  const server = await startServer({ dataDir });
  let front = null, base = server.baseUrl, browser = null;
  try {
    if (proxy) { front = await proxy(server.baseUrl); base = front.baseUrl; }
    browser = await Browser.launch({ baseUrl: base });
    const page = await browser.newPage();
    if (viewport) await page.setViewport(...viewport);
    return await fn(page, base);
  } finally {
    if (browser) await browser.close();
    if (front) await front.close();
    await server.close();
  }
}

/** A proxy that holds back every /data/ response by `ms`; the page's own files and the basemap are not delayed. */
function delayProxy(ms) {
  return (target) => new Promise((resolve, reject) => {
    const srv = http.createServer(async (req, res) => {
      try {
        if (req.url.startsWith('/data/')) await sleep(ms);
        const r = await fetch(target + req.url.slice(1));
        res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(Buffer.from(await r.arrayBuffer()));
      } catch { res.writeHead(502).end(); }
    });
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve({
      baseUrl: `http://127.0.0.1:${srv.address().port}/`,
      close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }),
    }));
  });
}

/** A pass-through proxy that can hold back or rewrite what it forwards: hold(url) -> ms, rewrite(url, text) -> text (HTML only). */
function proxy({ hold = () => 0, rewrite = null } = {}) {
  return (target) => new Promise((resolve, reject) => {
    const srv = http.createServer(async (req, res) => {
      try {
        const ms = hold(req.url); if (ms) await sleep(ms);
        const r = await fetch(target + req.url.slice(1));
        const type = r.headers.get('content-type') || 'application/octet-stream';
        let body = Buffer.from(await r.arrayBuffer());
        if (rewrite && /text\/html/.test(type)) body = Buffer.from(rewrite(req.url, body.toString('utf8')));
        res.writeHead(r.status, { 'content-type': type, 'cache-control': 'no-store' });
        res.end(body);
      } catch { res.writeHead(502).end(); }
    });
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve({
      baseUrl: `http://127.0.0.1:${srv.address().port}/`,
      close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }),
    }));
  });
}
const errorStatus = `(() => { const s = document.getElementById('map-status'); const b = s && s.querySelector('.wse-status-retry'); return !!b && s.dataset.kind === 'error' && b.getClientRects().length > 0 && s.textContent.length > 0; })()`;

/**
 * After a failure the scrubber never mounts, so the space first paint reserved for it (main.js, #timeline min-height) must be given
 * back: no inline min-height left on #timeline, no empty band (an empty #timeline is at most its 1 px border tall), and the map canvas's
 * bitmap matches its box (a canvas that grew into the space without a repaint would be stretched). Saves a screenshot for a person to look at.
 */
async function noReservedBand(assert, page, label) {
  await sleep(400); // two frames and the repaint after the space is given back
  const r = await page.eval(`(() => {
    const t = document.getElementById('timeline'), c = document.getElementById('map'), tr = t.getBoundingClientRect(), cr = c.getBoundingClientRect();
    const dpr = Math.min(2, Math.max(1, devicePixelRatio || 1));
    return { minH: t.style.minHeight, kids: t.childElementCount, h: Math.round(tr.height * 10) / 10,
      cw: c.width, ch: c.height, bw: Math.round(cr.width), bh: Math.round(cr.height), dpr };
  })()`);
  const shot = artifactPath('S-STATUS', label.replace(/\W+/g, '-') + '.png');
  await page.screenshot(shot).catch(() => {});
  console.log(`  S-STATUS ${label}: #timeline min-height '${r.minH}', ${r.kids} children, ${r.h} px tall; canvas ${r.cw}x${r.ch} for a ${r.bw}x${r.bh} box (dpr ${r.dpr}); ${shot}`);
  assert.equal(r.minH, '', `${label}: #timeline keeps the first-paint reservation (inline min-height ${r.minH})`);
  if (r.kids === 0) assert.ok(r.h <= 1, `${label}: an empty ${r.h} px band is left where the scrubber would have been`);
  assert.ok(Math.abs(r.ch / r.dpr - r.bh) <= 1 && Math.abs(r.cw / r.dpr - r.bw) <= 1, `${label}: the map canvas bitmap (${r.cw}x${r.ch}) does not match its ${r.bw}x${r.bh} box: stretched`);
}

/** The manifest never arrives (blocked, offline): "Couldn't load the forecast." with Retry, the scrubber's space given back, Retry works. */
async function manifestFailure(assert, size) {
  await withApp({ dataDir: DEFAULT_DATA }, async (page, base) => {
    await page.send('Network.enable');
    await page.send('Network.setBlockedURLs', { urls: ['*manifest.json*'] });
    await page.goto(base).catch(() => {});
    await page.waitFor(errorStatus, { timeout: 5000 }).catch(() => { throw new Error(`manifest blocked (${size}): no error status with Retry within 5 s`); });
    const text = await page.eval(`document.getElementById('map-status').textContent`);
    assert.match(text, /Couldn't load the forecast/, `manifest blocked (${size}): the status names the failure: ${text}`);
    await noReservedBand(assert, page, `manifest blocked ${size}`);
    await page.send('Network.setBlockedURLs', { urls: [] });
    await inp.click(page, '#map-status .wse-status-retry');
    await page.waitFor('window.__wse && window.__wse.storyReady === true', { timeout: 20000 }).catch(() => { throw new Error(`manifest blocked (${size}): Retry did not load the app once the manifest was reachable`); });
  }, { viewport: size === 'phone' ? [390, 844] : [1440, 900] });
}

async function chunkFailure(assert, how) {
  const dir = copyData('chunk-' + how);
  const good = fs.readFileSync(path.join(dir, 'z500a.np05.a.bin'));
  const file = path.join(dir, 'z500a.np05.a.bin');
  if (how === 'corrupt') fs.writeFileSync(file, Buffer.from('this is not a chunk '.repeat(40)));
  else fs.rmSync(file);
  await withApp({ dataDir: dir }, async (page, base) => {
    await page.goto(base);
    await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 20000 });
    const t0 = Date.now();
    await page.waitFor(errorStatus, { timeout: 2000 }).catch(() => { throw new Error(`${how} chunk: no status with Retry within 2 s of ready (console only)`); });
    assert.ok(Date.now() - t0 <= 2000);
    const text = await page.eval(`document.getElementById('map-status').textContent`);
    assert.match(text, /load/i, `${how} chunk: the status says what failed: ${text}`);
    // Pause the clock (the playing map re-requests the chunk on its own as soon as the file is good, which would clear
    // the status before the click), repair the file, then press Retry with a real click.
    if (await page.eval('window.__wse.store.get().playing')) await inp.click(page, '.tl-play'); // a real click on the timeline's Pause
    await sleep(700);
    assert.equal(await page.eval('window.__wse.store.get().playing'), false, `${how} chunk: the clock is paused`);
    assert.ok(await page.eval(errorStatus), `${how} chunk: the status is still showing`);
    fs.writeFileSync(file, good);
    const v0 = await page.eval('window.__wse.data.dataVersion()');
    await inp.click(page, '#map-status .wse-status-retry');
    await page.waitFor(`window.__wse.data.dataVersion() > ${v0} && document.getElementById('map-status').textContent === ''`, { timeout: 5000 }).catch(() => { throw new Error(`${how} chunk: Retry did not load the chunk and clear the status`); });
  });
}

/**
 * First paint, measured from the start of the document on two links: `proxy` (a proxy holds back only /data/ by 2.5 s; the page's own files
 * are fast) and `4g` (the browser's own network emulation at fast 4G, 40 ms and 9 Mbit/s: everything slow, d3 and the module graph
 * included). A script added before the document samples the canvas and the panel at fixed times after navigation start. At the 300 ms
 * sample the map is visible, its ground is painted, the coastline is drawn (pixels far from the ground colour, which the ground and the
 * graticule never are), the panel shows skeleton cards and the data has not arrived; no sample before the field draws shows a blank
 * screen. After boot the first-paint coastline sits where the renderer draws it (San Francisco within 2 px), its overlay is gone, and so
 * are the skeletons and the loading line.
 *
 * What is timed, and on which clock. A sampler timer is wall-clock: on a machine at load 15-60 it runs 20-160 ms late with the page doing
 * nothing wrong, so its lateness is not a measure of the page. The page states its own time instead: main.js marks 'wse:first-paint'
 * the moment the ground, the coastline, the skeleton cards and the loading line are in place, and that mark must be at or before 300 ms
 * (performance.now, the page clock). The page must also leave its main thread free to put that paint on screen and answer input: a
 * Chrome trace gives every main-thread task's thread CPU time (tdur), which load does not stretch, and no task from navigation until the
 * first /data/ response arrives may run 100 ms of CPU or more (the long-task gate of AUDIT-TESTS TEST-10). The 50 m basemap swap projected in one
 * task was 146-151 ms of CPU on every run (2026-11-19), and fails here wherever it lands; the sliced swap's largest task is under 50 ms.
 * The pixels are still read from the 300 ms sample, whenever its timer ran, as long as it ran before any chunk had decoded.
 *
 * Starvation: a machine so busy that the browser itself is late delivers the first-paint files (the stylesheets and modulepreloads in
 * index.html's <head>) well after the link would (about 180 ms on fast 4G, about 20 ms through the proxy, on an idle machine), or runs the
 * 300 ms sample only after the data has arrived. Such an attempt says nothing about the page, so it is run again, at most three times in
 * all; every attempt is logged and three starved attempts fail. Any other miss fails at once: a parser-blocking script, a deeper import
 * chain, a late first-paint mark or a long task is not starvation.
 */
async function firstLoad(assert, vp, mode) {
  for (let attempt = 1; ; attempt++) {
    const r = await firstLoadOnce(assert, vp, mode, attempt);
    if (!r.starved) return;
    console.log(`  S-STATUS ${vp} ${mode}: attempt ${attempt}: the machine was starved (first-paint files in by ${r.critical}; limit ${STARVED_MS} ms, or the 300 ms sample ran after the data): ${r.miss}`);
    assert.ok(attempt < 3, `${vp} ${mode}: three attempts in a row were starved (first-paint files in by ${r.critical}); the 300 ms first paint could not be measured: ${r.miss}`);
  }
}
const STARVED_MS = 250;
/** The stylesheets and modulepreloads index.html lists in its <head>, as written (relative). */
function headLinks() {
  const html = fs.readFileSync(path.join(SITE_DIR, 'index.html'), 'utf8');
  const head = html.slice(0, html.search(/<\/head>/i));
  return [...head.matchAll(/<link\b[^>]*rel=["']?(stylesheet|modulepreload)\b[^>]*>/gi)].map((m) => (m[0].match(/href=["']?([^"'\s>]+)/) || [])[1]).filter(Boolean);
}
/** Canvas and panel samples at fixed times after navigation start. `ink`: the share of sampled pixels whose luminance is more than 100 away
 *  from the most common colour's: the coastline (core #E6E9ED on Night, #1A1D21 on Paper) is; the ground and the graticule never are. */
const SAMPLER = (times) => `
  window.__samples = [];
  const sample = (T) => {
    const c = document.getElementById('map');
    let colours = 0, share = 0, ink = 0, rgb = null;
    if (c && c.width) {
      // what is on screen: #map with the first-paint coastline overlay (main.js holds the coastline there from the renderer's first frame
      // until the renderer draws its own) composited over it
      const ov = document.querySelector('.wse-first-coast');
      let src = c;
      if (ov && ov.width === c.width && ov.height === c.height) { src = document.createElement('canvas'); src.width = c.width; src.height = c.height; const x = src.getContext('2d'); x.drawImage(c, 0, 0); x.drawImage(ov, 0, 0); }
      const img = src.getContext('2d').getImageData(0, 0, c.width, c.height).data; const seen = new Map(); const lum = [];
      rgb = [img[0], img[1], img[2], img[3]];
      for (let i = 0; i < img.length; i += 4 * 7) { const k = (img[i] >> 3) + ',' + (img[i + 1] >> 3) + ',' + (img[i + 2] >> 3); seen.set(k, (seen.get(k) || 0) + 1); lum.push(0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2]); }
      let top = 0, topK = ''; for (const [k, n] of seen) if (n > top) { top = n; topK = k; }
      const [r, g, b] = topK.split(',').map((v) => (+v << 3) + 4), L0 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const tot = lum.length; colours = seen.size; share = (tot - top) / tot; ink = lum.filter((l) => Math.abs(l - L0) > 100).length / tot;
    }
    const cards = [...document.querySelectorAll('.wse-skel-card, [data-skeleton] > .skeleton')].filter((e) => e.getBoundingClientRect().width > 0).length;
    window.__samples.push({ T, at: Math.round(performance.now()), opacity: c ? +getComputedStyle(c).opacity : null, rgb, colours, share: +share.toFixed(4), ink: +ink.toFixed(4), cards, ready: !!(window.__wse && window.__wse.ready), dv: window.__wse && window.__wse.data ? window.__wse.data.dataVersion() : 0, body: !!document.body });
  };
  for (const T of ${JSON.stringify(times)}) setTimeout(() => sample(T), Math.max(0, T - performance.now()));`;
const INK_MIN = 0.001; // measured at 300 ms (W3-05 fix 4): with the coastline desktop 0.0106-0.0152, phone 0.0027; the round-3 page (ground and graticule only): 0

/** Starts a Chrome trace of the page's main-thread tasks; stop() returns [{start, wall, cpu}] in ms from navigation start (cpu null where
 *  the trace has no thread time). */
async function traceTasks(page) {
  const events = [];
  const prev = page.conn.listeners.get(page.sessionId);
  page.conn.onEvent(page.sessionId, (m, p) => { if (m === 'Tracing.dataCollected') events.push(...p.value); else prev?.(m, p); });
  await page.send('Tracing.start', { traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing'] }, transferMode: 'ReportEvents' });
  return async () => {
    const done = page.conn.waitEvent(page.sessionId, 'Tracing.tracingComplete', 30000);
    await page.send('Tracing.end');
    await done;
    page.conn.onEvent(page.sessionId, prev);
    const nav = events.find((e) => e.name === 'navigationStart' && e.args?.data?.isLoadingMainFrame && /^http/.test(e.args.data.documentLoaderURL || ''));
    if (!nav) return null;
    return events.filter((e) => e.name === 'RunTask' && e.ph === 'X' && e.pid === nav.pid && e.tid === nav.tid && e.ts >= nav.ts)
      .map((e) => ({ start: Math.round((e.ts - nav.ts) / 1000), wall: Math.round(e.dur / 1000), cpu: e.tdur == null ? null : Math.round(e.tdur / 1000) }));
  };
}
const LONG_CPU_MS = 100; // one task's thread CPU time; AUDIT-TESTS TEST-10's long-task gate

async function firstLoadOnce(assert, vp, mode, attempt) {
  const proxyMode = mode === 'proxy';
  return withApp({ dataDir: DEFAULT_DATA, proxy: proxyMode ? delayProxy(2500) : null }, async (page, base) => {
    if (!proxyMode) {
      await page.send('Network.enable');
      await page.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
    }
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SAMPLER([300, 600, 1000, 1500, 2000, 2500, 3000, 4000, 5000]) });
    const stopTrace = await traceTasks(page);
    await page.goto(base).catch(() => {});
    await sleep(5400);
    const tasks = await stopTrace();
    const S = await page.eval('window.__samples');
    const at = (T) => S.find((x) => x.T === T);
    const tag = `${vp} ${mode}`;
    const d3End = await page.eval(`Math.round((performance.getEntriesByType('resource').find((e) => /d3\\.min/.test(e.name)) || {}).responseEnd || 0)`);
    const fpMark = await page.eval(`(() => { const m = performance.getEntriesByName('wse:first-paint')[0]; return m ? Math.round(m.startTime) : null; })()`);
    const lit = (x) => x.opacity === 1 && x.rgb && x.rgb[3] === 255 && x.cards >= 2;
    const want = headLinks().map((h) => new URL(h, base).href);
    const critical = await page.eval(`(() => {
      const want = ${JSON.stringify(want)};
      const ends = performance.getEntriesByType('resource').filter((e) => want.includes(e.name)).map((e) => e.responseEnd);
      return ends.length === want.length ? Math.round(Math.max(...ends)) : 99999;
    })()`);
    const s300 = at(300);
    const early = (x) => !x.ready && !x.dv; // before the first chunk decoded: the first-load picture (ground, coastline, skeletons)
    const firstData = S.find((x) => !early(x));
    // the first-load window, for the main thread: from navigation until the first /data/ response (the manifest) has arrived; what the
    // page does with the data (the scrubber, the first field) is not first paint
    const dataDir = new URL('data/', base).href; // the site's data folder (not js/data/, the loader's modules)
    const dataAt = await page.eval(`Math.round(Math.min(...performance.getEntriesByType('resource').filter((e) => e.name.startsWith(${JSON.stringify(dataDir)})).map((e) => e.responseEnd), 5400))`);
    const windowEnd = dataAt;
    const misses = [];
    const check = (ok, what) => { if (!ok) misses.push(what); };
    check(fpMark != null && fpMark <= 300, `main.js marked its first paint at ${fpMark} ms (page clock; budget 300 ms)`);
    check(s300 && early(s300), `the 300 ms sample (run at ${s300 && s300.at} ms) came before any data`);
    if (s300) {
      check(s300.body, `the body is parsed at 300 ms (d3 ended ${d3End} ms)`);
      check(s300.opacity === 1, 'the map is visible at 300 ms');
      check(s300.rgb && s300.rgb[3] === 255, 'the ground is painted at 300 ms');
      check(s300.ink >= INK_MIN, `the coastline is drawn at 300 ms (ink share ${s300.ink}, needs ${INK_MIN})`);
      check(s300.cards >= 2, `the panel shows skeleton cards at 300 ms (${s300.cards})`);
    }
    // ink is measured against the commonest colour, the ground's until the field draws: after a chunk has decoded, the page is checked for
    // not blank (ground, visible map, skeletons), not for ink
    for (const x of S) {
      if (early(x)) check(lit(x) && x.ink >= INK_MIN, `at ${x.T} ms (no data yet) the map shows ground and coastline and the panel skeleton cards`);
      else if (!x.ready) check(lit(x), `at ${x.T} ms (the field drawing, the app not ready) the map shows its ground and the panel skeleton cards`);
    }
    const timed = tasks && tasks.filter((t) => t.start < windowEnd);
    const long = (timed || []).filter((t) => t.cpu != null && t.cpu >= LONG_CPU_MS);
    const unknown = (timed || []).filter((t) => t.cpu == null && t.wall >= LONG_CPU_MS);
    const busiest = (timed || []).reduce((m, t) => (t.cpu != null && t.cpu > (m ? m.cpu : -1) ? t : m), null);
    const miss = misses.length ? `${misses.join('; ')} ${JSON.stringify(s300)}` : '';
    const traceMiss = !tasks ? 'the trace has no navigation of the page' : long.length ? `the main thread ran a long task before the data: ${JSON.stringify(long)} (start, wall and CPU ms; limit ${LONG_CPU_MS} ms of CPU)` : '';
    assert.equal(traceMiss, '', `${tag}: ${traceMiss}`); // CPU time: a long task is the page's own, never starvation
    // starved: the first-paint files came late, the 300 ms sample ran only after the data, or a long wall-clock task has no thread time
    // to tell load from the page's own work; the body was parsed (a blocking script never counts)
    const starved = (miss && (critical > STARVED_MS || (s300 && !early(s300))) && s300 && s300.body) || (!traceMiss && unknown.length);
    if (starved && attempt < 4) return { starved: true, critical: `${critical} ms, first paint marked at ${fpMark} ms, 300 ms sample at ${s300 && s300.at} ms`, miss: miss || `long wall-clock tasks without thread time ${JSON.stringify(unknown)}` };
    assert.equal(miss, '', `${tag}: ${miss} (first-paint files in by ${critical} ms)`);
    await page.waitFor('window.__wse && window.__wse.storyReady === true', { timeout: 30000 });
    await sleep(300);
    const fit = await page.eval(`(() => {
      const w = window.__wse, f = w.firstPaint; if (!f) return null;
      return { gaps: f.anchors.map(([ll, u]) => { const p = w.renderer.project(ll); return p ? +Math.hypot(p[0] - (f.tx + f.k * u[0]), p[1] - (f.ty + f.k * u[1])).toFixed(2) : null; }),
        overlay: document.querySelectorAll('.wse-first-coast').length };
    })()`);
    assert.ok(fit, `${tag}: the first paint recorded its fit (window.__wse.firstPaint)`);
    assert.ok(fit.gaps.every((g) => g != null && g <= 2), `${tag}: the first-paint coastline sits where the booted renderer draws it (gaps ${JSON.stringify(fit.gaps)} px at San Francisco and 150W 60N; a change in the scrubber's height moves the chart: ui/firstpaint.js TIMELINE_H)`);
    assert.equal(fit.overlay, 0, `${tag}: the first-paint coastline overlay is gone once the renderer draws its own`);
    assert.equal(await page.eval(`document.querySelectorAll('[data-skeleton]').length`), 0, `${tag}: skeletons gone when ready`);
    assert.equal(await page.eval(`document.getElementById('map-status').textContent`), '', `${tag}: the loading line is gone`);
    if (proxyMode) assert.deepEqual(page.errors(), [], `${tag}: console errors ` + JSON.stringify(page.errors()));
    const readyAt = S.find((x) => x.ready);
    console.log(`  S-STATUS ${tag} (attempt ${attempt}): first-paint files in by ${critical} ms; first paint marked at ${fpMark} ms; d3 at ${d3End} ms; 300 ms sample (run at ${s300.at} ms): ink ${s300.ink}, cards ${s300.cards}; busiest main-thread task before the data (in by ${dataAt} ms) ${busiest ? `${busiest.cpu} ms CPU (${busiest.wall} ms wall) at ${busiest.start} ms` : 'n/a'} of ${timed.length}; first chunk by the ${firstData ? firstData.T + ' ms' : 'n/a'} sample; app ready by the ${readyAt ? readyAt.T + ' ms' : 'n/a'} sample; fit gaps ${JSON.stringify(fit.gaps)} px`);
    return { starved: false };
  }, { viewport: vp === 'phone' ? [390, 844] : [1440, 900] });
}

const MEASURE = (sel = '.wse-toast') => `(() => {
  const clip = (el) => {
    let r = el.getBoundingClientRect(); let l = r.left, t = r.top, rt = r.right, b = r.bottom;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') { const q = p.getBoundingClientRect(); l = Math.max(l, q.left); t = Math.max(t, q.top); rt = Math.min(rt, q.right); b = Math.min(b, q.bottom); }
    }
    return rt > l && b > t ? { l, t, r: rt, b } : null;
  };
  const vis = (el) => { const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && el.getClientRects().length > 0; };
  const toasts = [...document.querySelectorAll('${sel}')];
  const out = { toasts: toasts.length, hits: [] };
  for (const toast of toasts) {
    const tr = toast.getBoundingClientRect();
    const others = [...document.querySelectorAll('button, input, select, textarea, a[href], #timeline')].filter((e) => !toast.contains(e) && vis(e));
    for (const e of others) {
      const c = clip(e); if (!c) continue;
      if (c.l < tr.right && c.r > tr.left && c.t < tr.bottom && c.b > tr.top) out.hits.push((e.id || e.className || e.tagName) + ' ' + JSON.stringify([c.l, c.t, c.r, c.b].map(Math.round)));
    }
    out.box = [tr.left, tr.top, tr.right, tr.bottom].map(Math.round);
    out.inViewport = tr.left >= 0 && tr.right <= innerWidth && tr.top >= 0 && tr.bottom <= innerHeight;
  }
  return out;
})()`;

async function toasts(assert, vp) {
  await withApp({ dataDir: DEFAULT_DATA }, async (page, base) => {
    await page.goto(base);
    await page.waitFor('window.__wse && window.__wse.storyReady === true', { timeout: 20000 });
    await sleep(500);
    for (const [label, text, action] of [
      ['short with an action', 'Link copied', true],
      ['long text with an action', 'Could not copy the link. The sandbox blocked the clipboard, so select the text below and copy it yourself.', true],
      ['two at once', 'Second message', false],
    ]) {
      await page.eval(`(async () => { const m = await import(new URL('js/ui/status.js', document.baseURI).href); m.showToast({ text: ${JSON.stringify(text)}, ${action ? "action: { label: 'Undo', run() {} }," : ''} ms: 60000 }); })()`);
      await sleep(350);
      const r = await page.eval(MEASURE());
      assert.ok(r.toasts >= 1, `${vp} ${label}: a toast is on screen`);
      assert.deepEqual(r.hits, [], `${vp} ${label}: the toast ${JSON.stringify(r.box)} covers ${r.hits.join('; ')}`);
      assert.ok(r.inViewport, `${vp} ${label}: the toast is inside the viewport ${JSON.stringify(r.box)}`);
    }
    // a status line with Retry and a toast together: the toast sits below the status, covering neither Retry nor anything else
    await page.eval(`(async () => { const m = await import(new URL('js/ui/status.js', document.baseURI).href); m.setStatus({ kind: 'error', text: "Couldn't load this layer.", retry() {} }); })()`);
    await sleep(350);
    const r1 = await page.eval(MEASURE());
    assert.deepEqual(r1.hits, [], `${vp} with a status line: the toast covers ${r1.hits.join('; ')}`);
    await page.eval(`(async () => { const m = await import(new URL('js/ui/status.js', document.baseURI).href); m.setStatus({}); })()`);
    // the action is a real, pressable button that closes the toast
    const n0 = await page.eval(`document.querySelectorAll('.wse-toast').length`);
    await (vp === 'phone' ? inp.tap(page, '.wse-toast-action') : inp.click(page, '.wse-toast-action'));
    await sleep(200);
    assert.equal(await page.eval(`document.querySelectorAll('.wse-toast').length`), n0 - 1, `${vp}: the action closed its toast`);
    // the toast the app really shows: a real click on Layers > Copy link (the old pins toast sat on the timeline). Whichever toast
    // appears (Link copied, or Could not copy where the clipboard is blocked) must be the shared one and cover nothing.
    await (vp === 'phone' ? inp.tap(page, '#btn-layers') : inp.click(page, '#btn-layers'));
    await sleep(250);
    await page.eval(`[...document.querySelectorAll('#layers-panel button')].find((b) => /copy link/i.test(b.textContent)).setAttribute('data-t', 'copylink')`);
    await (vp === 'phone' ? inp.tap(page, '[data-t=copylink]') : inp.click(page, '[data-t=copylink]'));
    await sleep(500);
    const rc = await page.eval(MEASURE());
    assert.ok(rc.toasts >= 1, `${vp} Copy link: the app's toast is the shared .wse-toast (found ${rc.toasts}; pn-toast ${await page.eval(`document.querySelectorAll('.pn-toast').length`)})`);
    assert.deepEqual(rc.hits, [], `${vp} Copy link: the toast ${JSON.stringify(rc.box)} covers ${rc.hits.join('; ')}`);
    assert.equal(await page.eval(`document.querySelectorAll('body > .pn-toast-host').length`), 0, `${vp}: no floating pins toast host left on the body`);
    assert.ok(await page.eval(`document.getElementById('layers-panel').hidden`), `${vp} Copy link: the panel closed, so the toast has the region to itself`);
    // the pins toast (Added Maya, Undo): its host is moved into the region and covers nothing
    await page.eval(`(async () => { const m = await import(new URL('js/pins/toast.js', document.baseURI).href); window.__pt = m.showToast({ message: 'Maya', lead: 'Added ', undo() {}, ms: 60000 }); })()`);
    await sleep(350);
    const rp = await page.eval(MEASURE('.pn-toast'));
    assert.ok(rp.toasts >= 1, `${vp}: the pins toast is on screen`);
    assert.ok(await page.eval(`document.getElementById('toasts').contains(document.querySelector('.pn-toast'))`), `${vp}: the pins toast sits in #toasts`);
    assert.deepEqual(rp.hits, [], `${vp}: the pins toast ${JSON.stringify(rp.box)} covers ${rp.hits.join('; ')}`);
    assert.ok(rp.inViewport, `${vp}: the pins toast is inside the viewport ${JSON.stringify(rp.box)}`);
    await page.eval(`window.__pt.close()`);
    // while expanded the region follows the map
    await (vp === 'phone' ? inp.tap(page, '#btn-expand') : inp.click(page, '#btn-expand')); // a real press on Expand
    await sleep(350);
    assert.ok(await page.eval(`document.getElementById('app').hasAttribute('data-expanded')`), `${vp}: Expand was pressed`);
    const r2 = await page.eval(MEASURE());
    assert.deepEqual(r2.hits, [], `${vp} expanded: the toast covers ${r2.hits.join('; ')}`);
  }, { viewport: vp === 'phone' ? [390, 844] : [1440, 900] });
}

const FIFTEEN = path.join(path.dirname(DEFAULT_DATA), 'synthetic-15d');

/** Partial data: the later chunks of every field are held back, so the first days are up while the rest load. */
async function partialData(assert) {
  let release = false;
  const px = proxy({ hold: (u) => (/\.(b|c)\.bin/.test(u) && !release ? 60000 : 0) });
  await withApp({ dataDir: FIFTEEN, proxy: px }, async (page, base) => {
    await page.goto(base);
    await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 20000 });
    const line = `(() => { const s = document.getElementById('map-status'); return { kind: s.dataset.kind || '', text: s.textContent }; })()`;
    await page.waitFor(`document.getElementById('map-status').dataset.kind === 'partial'`, { timeout: 6000 }).catch(() => { throw new Error('partial data: no partial status while the later chunks load ' + JSON.stringify({}) ); });
    const r = await page.eval(line);
    assert.match(r.text, /^Showing days 1-\d+; later days are loading$/, `partial data: the line reads ${r.text}`);
    const days = +r.text.match(/1-(\d+)/)[1];
    assert.ok(days >= 1 && days <= 5, `partial data: days ${days} are those of the first chunk only (about 5 days)`);
  });
}

/** The same-wave hooks are optional: absent ones are skipped without an error, present ones are called. */
async function optionalHooks(assert) {
  await withApp({ dataDir: DEFAULT_DATA }, async (page, base) => {
    await page.goto(base);
    await page.waitFor('window.__wse && window.__wse.storyReady === true', { timeout: 20000 });
    await sleep(300);
    const r = await page.eval(`(async () => {
      const { renderer, ui } = window.__wse, app = ui.app, out = {};
      out.hasSampleAt = typeof renderer.sampleAt === 'function';
      const saved = renderer.sampleAt; delete renderer.sampleAt; renderer.sampleAt = undefined;
      out.absentSample = app.sampleAt(-120, 45);
      renderer.sampleAt = (lon, lat) => ({ values: {}, t: 0, signal: 'none', lon, lat });
      out.presentSample = app.sampleAt(-120, 45);
      renderer.sampleAt = saved;
      const pm = await import(new URL('js/pins/mount.js', document.baseURI).href);
      out.hasAddSheet = typeof pm.openAddSheet === 'function';
      if (!out.hasAddSheet) out.addSheetAbsent = app.openAddSheet({ kind: 'place' });
      out.hasMissing = typeof window.__wse.data.missing === 'function';
      out.status = document.getElementById('map-status').dataset.kind || '';
      return out;
    })()`);
    assert.equal(r.absentSample, null, 'renderer.sampleAt absent: app.sampleAt skips it and returns null');
    assert.equal(r.presentSample && r.presentSample.signal, 'none', 'renderer.sampleAt present: app.sampleAt calls it');
    if (!r.hasAddSheet) assert.equal(r.addSheetAbsent, false, 'openAddSheet absent: skipped, returns false');
    if (!r.hasMissing) assert.equal(r.status, '', 'data.missing absent: no missing-field line');
    assert.deepEqual(page.errors(), [], 'no console errors with hooks absent ' + JSON.stringify(page.errors()));
  });
}

/**
 * A library that never arrives (blocked CDN, CSP, offline): d3 or topojson is blocked through the browser's own request blocking, so its
 * error fires at once, usually before main.js has run. Within 2 s of navigation the map shows "Couldn't load the app." with a visible Retry
 * (it used to say "Loading the pressure pattern…" over skeleton cards for ever); the coastline is still drawn; once the block is lifted, a
 * real click on Retry loads the app.
 */
async function libFailure(assert, lib, size = 'phone') {
  await withApp({ dataDir: DEFAULT_DATA }, async (page, base) => {
    await page.send('Network.enable');
    await page.send('Network.setBlockedURLs', { urls: [lib === 'd3' ? '*d3.min.js*' : '*topojson-client.min.js*'] });
    const t0 = Date.now();
    await page.goto(base).catch(() => {});
    await page.waitFor(errorStatus, { timeout: 2000 }).catch(() => { throw new Error(`${lib} blocked: no error status with Retry within 2 s (still showing ${JSON.stringify(null)})`); });
    const ms = Date.now() - t0;
    const r = await page.eval(`({ text: document.getElementById('map-status').textContent, skel: document.querySelectorAll('[data-skeleton]').length, state: document.querySelector('script[data-lib=${lib}]').dataset.state || '' })`);
    assert.match(r.text, /Couldn't load the app/, `${lib} blocked: the status names the failure: ${r.text}`);
    assert.equal(r.skel, 0, `${lib} blocked: no skeleton cards promising content that will not come`);
    console.log(`  S-STATUS ${lib} blocked: error status with Retry ${ms} ms after navigation (tag state '${r.state}')`);
    await noReservedBand(assert, page, `${lib} blocked ${size}`);
    await page.send('Network.setBlockedURLs', { urls: [] });
    await inp.click(page, '#map-status .wse-status-retry'); // a real click: Retry reloads the page
    await page.waitFor('window.__wse && window.__wse.storyReady === true', { timeout: 20000 }).catch(() => { throw new Error(`${lib} blocked: Retry did not load the app once the library was reachable`); });
  }, { viewport: size === 'phone' ? [390, 844] : [1440, 900] });
}

/** The pre-projected first-paint geometry is what tools/build-firstpaint.mjs makes from the bundled basemap now, and ui/firstpaint.js fits
 *  the Regional view exactly as render/view.js baseProjection does (eight canvas shapes, insets included). */
async function firstPaintGeometry(assert) {
  const tool = await import(new URL('../../../tools/build-firstpaint.mjs', import.meta.url).href);
  const cur = fs.readFileSync(path.join(SITE_DIR, 'js', 'ui', 'firstpaint-geo.js'), 'utf8');
  assert.equal(cur === await tool.build(), true, 'site/js/ui/firstpaint-geo.js is stale: run node tools/build-firstpaint.mjs');
  const gap = await tool.fitGap();
  assert.ok(gap < 0.01, `ui/firstpaint.js fitRegional differs from baseProjection by ${gap} px`);
}

/** index.html: no classic <script src> in <head> without async or defer (it would hold the body until it has downloaded), d3 and
 * topojson carry the `data-lib` that main.js waits on, and main.js's static imports are modulepreloaded. */
function noBlockingScripts(assert) {
  const html = fs.readFileSync(path.join(SITE_DIR, 'index.html'), 'utf8');
  const head = html.slice(0, html.search(/<\/head>/i));
  const tags = head.match(/<script\b[^>]*>/gi) || [];
  const blocking = tags.filter((t) => /\bsrc=/i.test(t) && !/\b(async|defer)\b/i.test(t) && !/type=["']?module/i.test(t));
  assert.deepEqual(blocking, [], `index.html: parser-blocking scripts in <head> leave the page blank until they arrive: ${blocking.join(' ')}`);
  // main.js and its static imports are modulepreloaded, so the first paint is one round trip away rather than two (fast 4G: skeleton
  // cards at about 180 ms with the hints, about 250 ms without)
  const pre = new Set([...head.matchAll(/<link\b[^>]*rel=["']?modulepreload[^>]*>/gi)].map((m) => (m[0].match(/href=["']?([^"'\s>]+)/) || [])[1]));
  // every module main.js imports statically, and theirs, all the way down: each level missing from the list costs a round trip
  const statics = new Set(), todo = ['js/main.js'];
  while (todo.length) {
    const f = todo.pop(), src = fs.readFileSync(path.join(SITE_DIR, f), 'utf8');
    for (const m of src.matchAll(/^import\s[^;]*?from\s+['"](\.[^'"]+)['"]/gm)) {
      const dep = path.posix.join(path.posix.dirname(f), m[1]);
      if (!statics.has(dep)) { statics.add(dep); todo.push(dep); }
    }
  }
  assert.ok(statics.size >= 1, 'main.js has static imports to check');
  for (const f of ['js/main.js', ...statics]) assert.ok(pre.has(f), `index.html modulepreloads ${f} (a static import of main.js or of one of its imports): ${[...pre].join(', ')}`);
  // d3 and topojson record their outcome on the tag as it happens (main.js may run after a fast failure has fired)
  for (const t of tags.filter((x) => /data-lib=/.test(x))) assert.ok(/\bonerror=["'][^"']*dataset\.state\s*=\s*'error'/.test(t) && /\bonload=["'][^"']*dataset\.state\s*=\s*'load'/.test(t), `index.html: ${t} records load and error in data-state`);
  for (const lib of ['d3', 'topojson']) assert.ok(tags.some((t) => new RegExp(`data-lib=["']?${lib}\\b`).test(t) && /\basync\b/.test(t)), `index.html: ${lib} loads async with data-lib="${lib}" (main.js waits on it)`);
}

export async function run({ assert }) {
  await chunkFailure(assert, 'corrupt');
  await chunkFailure(assert, 'missing');
  await libFailure(assert, 'd3');
  await libFailure(assert, 'topojson');
  await libFailure(assert, 'd3', 'desktop');
  await manifestFailure(assert, 'phone');
  await manifestFailure(assert, 'desktop');
  await firstPaintGeometry(assert);
  noBlockingScripts(assert);
  await firstLoad(assert, 'desktop', 'proxy');
  await firstLoad(assert, 'phone', 'proxy');
  await firstLoad(assert, 'desktop', '4g');
  await firstLoad(assert, 'phone', '4g');
  await partialData(assert);
  await optionalHooks(assert);
  await toasts(assert, 'desktop');
  await toasts(assert, 'phone');
}
