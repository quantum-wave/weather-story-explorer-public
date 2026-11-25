// S-BRIEF (C1-04): The Briefing in the real app, from the pill to the end card, on phone and desktop.
// Real pointer and key events (tests/site/lib/input.mjs). Playback speed comes from the briefing's testRate, so nothing here waits on
// wall-clock time: a beat is "settled" when the page's own camera transform has stopped moving, and the per-beat assertions run with
// testRate 0.01 (the film is effectively frozen inside each beat; Next steps through it). The free run uses testRate 20.
// Variants: full (home, a trip in the detail range, a trip in days 11-15, four people), no pins, friend link, a live-like copy of the
// fixture served by its own server (the live-only words), reduced motion, and the inert states.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../lib/server.mjs';
import { Browser } from '../lib/cdp.mjs';
import { makeLiveLike } from '../lib/livelike.mjs';
import { artifactTmp } from '../lib/artifacts.mjs';
import * as inp from '../lib/input.mjs';

export const id = 'S-BRIEF';
export const tier = 'full';
export const freshProfile = true;
export const timeoutMs = 900000;
export const data = ['synthetic-15d', 'recorded'];

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const trace = (s) => { if (process.env.WSE_TRACE) console.error('[trace]', new Date().toISOString().slice(11, 19), s); };
const READY = 'window.__wse && window.__wse.ready === true && window.__wse.storyReady === true && !!window.__wse.ui && !!window.__wse.ui.brief';
const VPS = [{ name: 'phone', w: 390, h: 844, phone: true }, { name: 'desktop', w: 1440, h: 900, phone: false }];
const SLACK = 4; // px of slack on every layout limit (wider Linux fonts)
const LENS_WORDS = { z: /Pressure pattern/, s: /Rain in 6 hours/, c: /disagree/, j: /Jet stream/ };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10);

async function boot(page, url, vp, { hash = '', reduced = false, keepStorage = false } = {}) {
  trace(`boot ${vp.name} ${hash} reduced=${reduced}`);
  await page.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.phone ? 2 : 1, mobile: !!vp.phone });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: !!vp.phone, maxTouchPoints: 5 });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
  // storage is cleared on a small same-origin file rather than on a second full load of the app (one app load per boot, not two)
  if (!keepStorage) { await page.goto(new URL('css/tokens.css', url).href); await page.eval('localStorage.clear()'); }
  if (hash) await page.goto('about:blank'); // a hash-only change is no new load
  await page.goto(url + hash);
  await page.waitFor(READY, { timeout: 60000 });
  await page.eval(`(async () => { (await import(new URL('js/time/clock.js', document.baseURI).href)).pause(); })()`);
  await sleep(300);
}

const STATE = `(() => { const s = __wse.store.get(); return { view: s.view, lens: s.lens, t: s.t, focus: s.focus ?? null, expanded: !!s.expanded,
  overlays: s.overlays, range: s.range, sheet: s.sheet, playing: !!s.playing, xf: __wse.renderer.getTransform(), hash: location.hash }; })()`;
const rectOf = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`;
const hits = (a, b, pad = 0) => a && b && a.l - pad < b.r && a.r + pad > b.l && a.t - pad < b.b && a.b + pad > b.t;
const ev = (page, expr) => page.eval(expr);

/** Resolves when the camera transform has not moved for at least 4 frames and 360 ms of the page's own clock (page-reported state, not a
 *  fixed wait). Watched inside the page, frame by frame, so a loaded Mac pays no round trip per sample; gives up after 10 s of page time. */
const settled = (page) => ev(page, `new Promise((done) => { const t0 = performance.now(); let last = '', since = 0, frames = 0;
  const f = (now) => { const x = JSON.stringify(window.__wse.renderer.getTransform());
    if (x !== last) { last = x; since = now; frames = 0; } else frames++;
    if ((frames >= 4 && now - since >= 360) || now - t0 > 10000) done(true); else requestAnimationFrame(f); };
  requestAnimationFrame(f); })`);

async function seedFull(page) {
  await page.eval(`(() => { const c = __wse.pins.home();
    const P = (name, city, id, lat, lon, admin) => __wse.pins.add({ kind: 'person', name, city: { ...c, id, name: city, lat, lon, admin, cc: 'US' } });
    P('Maya', 'Portland', 5746545, 45.52, -122.68, 'OR'); P('Theo', 'Seattle', 5809844, 47.61, -122.33, 'WA');
    P('Ana', 'Sacramento', 5389489, 38.58, -121.49, 'CA'); P('Sam', 'Reno', 5509952, 39.53, -119.81, 'NV'); })()`);
  const cov = await page.eval(`(() => { const s = __wse.ui.home.stories.get('home'); const c = s && s.days.coverage; return c && { firstDate: c.firstDate, lastDate: c.lastDate }; })()`);
  const T = (label, a, b) => `__wse.pins.addTrip({ label: ${JSON.stringify(label)}, city: __wse.pins.home(), start: ${JSON.stringify(addDays(cov.firstDate, a - 1))}, end: ${JSON.stringify(addDays(cov.firstDate, b - 1))} })`;
  await page.eval(`(() => { ${T('Near trip', 3, 5)}; ${T('Far trip', 12, 14)}; })()`);
  await sleep(200);
}

const open = async (page, { rate = null } = {}) => {
  if (rate != null) await page.eval(`__wse.ui.brief.testRate = ${rate}`);
  await inp.click(page, '#brief-pill');
  await page.waitFor(`document.getElementById('app').hasAttribute('data-brief') && !!document.getElementById('brief-card')`, { timeout: 30000 });
};
const beatId = (page) => page.eval(`document.getElementById('brief-card')?.dataset.beat || null`);
const cardState = (page) => page.eval(`document.getElementById('brief-card')?.dataset.state || null`);
const pillText = (page) => page.eval(`(document.getElementById('brief-pill') || {}).textContent || ''`);
const waitEnded = (page, timeout = 90000) => page.waitFor(`__wse.ui.brief.player() && __wse.ui.brief.player().state() === 'ended'`, { timeout });
const closed = (page) => page.waitFor(`!document.getElementById('app').hasAttribute('data-brief') && !document.getElementById('brief-card')`, { timeout: 8000 });

function sameXf(a, b, assert, tag) {
  assert.ok(Math.abs(a.k - b.k) <= 0.001, `${tag}: k ${a.k} vs ${b.k}`);
  assert.ok(Math.abs(a.tx - b.tx) <= 1 && Math.abs(a.ty - b.ty) <= 1, `${tag}: tx,ty ${a.tx},${a.ty} vs ${b.tx},${b.ty}`);
  const ar = [].concat(a.rot || []), br = [].concat(b.rot || []);
  for (let i = 0; i < ar.length; i++) assert.ok(Math.abs(ar[i] - br[i]) <= 0.01, `${tag}: rot[${i}] ${ar[i]} vs ${br[i]}`);
}
function sameState(a, b, assert, tag, { keepView = false } = {}) {
  assert.equal(b.expanded, a.expanded, `${tag}: expanded`);
  assert.deepEqual(b.overlays, a.overlays, `${tag}: overlays`);
  assert.equal(b.range, a.range, `${tag}: range`);
  assert.equal(b.sheet, a.sheet, `${tag}: sheet snap`);
  assert.equal(b.view, a.view, `${tag}: view`);
  assert.equal(b.lens, a.lens, `${tag}: lens`);
  assert.ok(Math.abs(b.t - a.t) <= 0.01, `${tag}: t ${a.t} -> ${b.t}`);
  assert.deepEqual(b.focus, a.focus, `${tag}: focus`);
  void keepView;
  sameXf(a.xf, b.xf, assert, tag + ' transform');
}

/** The free run: pill to the end card at testRate 20, with the order of beats and the rewind's falling clock recorded in the page. */
async function freeRun(page, assert, tag, { full }) {
  await page.eval(`(() => { window.__rec = { beats: [], rewind: [], strips: {} };
    const note = () => { const id = document.getElementById('brief-card')?.dataset.beat; if (id && __rec.beats[__rec.beats.length - 1] !== id) __rec.beats.push(id); };
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-beat'] });
    __wse.store.subscribe((s, p) => { if (!('t' in p)) return; const c = document.getElementById('brief-card'); const id = c && c.dataset.beat; if (!id) return;
      if (id === 'picture-rewind') __rec.rewind.push(s.t);
      const st = c.querySelector('.brief-strip svg .strip-sel'); if (st) (__rec.strips[id] = __rec.strips[id] || new Set()).add(st.getAttribute('x')); }); })()`);
  await open(page, { rate: 20 });
  assert.equal(await page.eval('__wse.store.get().playing'), false, tag + ': store.playing is false while the briefing plays');
  assert.equal(await page.eval('__wse.store.get().overlays.doubt'), true, tag + ': the doubt overlay is on');
  assert.equal(await page.eval(`document.getElementById('app').hasAttribute('data-expanded')`), true, tag + ': #app[data-expanded]');
  assert.equal(await page.eval(`(() => { const t = document.getElementById('map-tools'); return getComputedStyle(t).display === 'none' || getComputedStyle(t).visibility === 'hidden' || !t.getClientRects().length; })()`), true, tag + ': #map-tools is not visible');
  await waitEnded(page);
  const script = await page.eval(`__wse.ui.brief.script().beats.map((b) => ({ id: b.id, chapter: b.chapter, hook: b.hook || null }))`);
  const rec = await page.eval(`({ beats: __rec.beats, rewind: __rec.rewind, strips: Object.fromEntries(Object.entries(__rec.strips).map(([k, v]) => [k, [...v]])) })`);
  assert.deepEqual(rec.beats, script.map((b) => b.id), tag + ': the beats arrived in script order');
  if (script.some((b) => b.hook === 'rewind')) {
    assert.ok(rec.rewind.length >= 2 && rec.rewind[0] > rec.rewind.at(-1), tag + `: store.t falls during the rewind beat (${rec.rewind[0]} -> ${rec.rewind.at(-1)})`);
    assert.ok(rec.rewind.every((v, i) => i === 0 || v <= rec.rewind[i - 1] + 1e-6), tag + ': store.t never rises during the rewind beat');
  } else assert.ok(!full, tag + ': the full variant has a rewind beat on this fixture');
  if (script.some((b) => b.id === 'home-near')) assert.ok((rec.strips['home-near'] || []).length >= 2, tag + `: the strip is redrawn with a new active day as the clock crosses into a new local day (${JSON.stringify(rec.strips['home-near'])})`);
  return { script, rec };
}

async function stepThrough(page, assert, tag, vp, fixtureLive) {
  await page.eval(`window.__pads = []; (() => { const r = __wse.renderer, orig = r.setPadding.bind(r); r.setPadding = (p) => { window.__pads.push(p); return orig(p); }; })()`);
  await open(page, { rate: 0.01 });
  const script = await page.eval(`__wse.ui.brief.script().beats.map((b) => ({ id: b.id, chapter: b.chapter, view: b.view, lens: b.lens, t0: b.t0, t1: b.t1, hook: b.hook || null,
    place: b.place ? { lat: b.place.lat, lon: b.place.lon, kind: b.place.kind } : null, strip: !!b.strip, camera: b.camera || null, lines: b.lines, title: b.title }))`);
  const heights = new Set();
  let stripRepainted = false;
  for (let i = 0; i < script.length; i++) {
    const b = script[i];
    if (i > 0) { await inp.click(page, '#brief-card [data-act="next"]'); await page.waitFor(`document.getElementById('brief-card').dataset.beat === ${JSON.stringify(b.id)}`, { timeout: 15000 }); }
    await page.waitFor(`__wse.ui.brief.player().state() === 'playing' || __wse.ui.brief.player().state() === 'paused'`, { timeout: 30000 });
    await settled(page);
    const m = await page.eval(`(() => { const s = __wse.store.get(), card = document.getElementById('brief-card'), cr = card.getBoundingClientRect(),
      cv = document.getElementById('map').getBoundingClientRect(), tl = document.getElementById('timeline').getBoundingClientRect(),
      lg = document.querySelector('.mlg'), lr = lg && lg.getBoundingClientRect(), pl = ${JSON.stringify(b.place)};
      let pt = null; if (pl) { const p = __wse.renderer.project([pl.lon, pl.lat]); pt = p && { x: p[0], y: p[1] }; }
      const pads = window.__pads.at(-1);
      return { view: s.view, lens: s.lens, t: s.t, playing: !!s.playing, doubt: !!(s.overlays || {}).doubt, date: (card.querySelector('.brief-date') || {}).textContent || '',
        h: cr.height, cardTop: cr.top, cardBox: { l: cr.left, t: cr.top, r: cr.right, b: cr.bottom }, cv: { l: cv.left, t: cv.top, r: cv.right, b: cv.bottom }, tlH: tl.height,
        legend: lr && lr.width ? { l: lr.left, t: lr.top, r: lr.right, b: lr.bottom } : null, legendTitle: (document.querySelector('.mlg-title') || {}).textContent || '',
        pt, pads, vt: __wse.data.validTime(s.t).getTime(), strip: !!card.querySelector('.brief-strip svg'), stripH: +((card.querySelector('.brief-strip svg') || { getAttribute: () => 0 }).getAttribute('height') || 0), stripSel: !!card.querySelector('.brief-strip svg .strip-sel'),
        stampPhrase: (card.querySelector('.brief-stamp') || {}).textContent || '', text: card.textContent }; })()`);
    const at = `${tag} beat ${b.id}`;
    heights.add(Math.round(m.h));
    assert.equal(m.view, b.view, `${at}: store.view equals the beat's`);
    assert.equal(m.lens, b.lens, `${at}: store.lens equals the beat's`);
    const want = b.hook === 'rewind' || b.t0 !== b.t1 ? b.t0 : b.t0;
    assert.ok(Math.abs(m.t - want) <= 0.5, `${at}: store.t ${m.t} is the beat's start ${want}`);
    assert.equal(m.playing, false, `${at}: the app clock is not playing`);
    assert.equal(m.doubt, true, `${at}: overlays.doubt is on`);
    assert.ok(LENS_WORDS[b.lens].test(m.legendTitle), `${at}: the legend names the beat's lens (${m.legendTitle})`);
    if (!['title', 'end'].includes(b.chapter)) {
      const d = new Date(m.vt), wd = d.toLocaleDateString('en-US', { weekday: 'short' }), mon = d.toLocaleDateString('en-US', { month: 'short' });
      assert.ok(m.date.includes(wd) && m.date.includes(mon) && m.date.includes(String(d.getDate())), `${at}: .brief-date "${m.date}" shows the valid date of store.t (${wd} ${d.getDate()} ${mon})`);
    }
    assert.ok(!hits(m.legend, m.cardBox, 0), `${at}: the legend and the card do not intersect`);
    if (b.place && b.camera) {
      assert.ok(m.pt && m.pt.x >= m.cv.l && m.pt.x <= m.cv.r && m.pt.y >= m.cv.t && m.pt.y <= m.cv.b, `${at}: the place is inside the canvas (${JSON.stringify(m.pt)})`);
      assert.ok(m.pt.y < m.cardTop, `${at}: the place (${m.pt && m.pt.y}) is above the card's top edge (${m.cardTop})`);
    }
    assert.ok(m.pads && Math.abs(m.pads.bottom - Math.round(m.h + m.tlH)) <= 1, `${at}: renderer bottom padding ${m.pads && m.pads.bottom} equals card height + timeline (${m.h} + ${m.tlH})`);
    if (vp.phone) assert.ok(m.cardTop >= 0.5 * vp.h - 0.5, `${at}: the chart above the card is at least half the viewport (card top ${m.cardTop})`);
    else assert.ok((m.cardBox.r - m.cardBox.l) * (m.cardBox.b - m.cardBox.t) <= 0.12 * (m.cv.r - m.cv.l) * (m.cv.b - m.cv.t) + 1, `${at}: the card covers at most 12% of the stage`);
    if (b.strip) assert.ok(m.strip, `${at}: a home beat shows the compact strip`);
    if (b.strip) assert.ok(m.stripSel, `${at}: the strip marks the active day`);
    if (b.strip) assert.ok(m.stripH > 0 && m.stripH <= 60, `${at}: the strip is the compact form (${m.stripH} px tall)`);
    if (b.strip && !stripRepainted) {
      // switching Map colors or the theme mid-briefing repaints the strip (it was redrawn only when the day changed)
      stripRepainted = true;
      const html = () => page.eval(`document.querySelector('#brief-card .brief-strip svg')?.outerHTML || ''`);
      for (const [key, alt] of [['colors', (v) => (v === 'reference' ? 'soft' : 'reference')], ['theme', (v) => (v === 'light' ? 'dark' : 'light')]]) {
        const was = await page.eval(`__wse.store.get().${key}`), h0 = await html(); let h1;
        await page.eval(`__wse.store.set({ ${key}: ${JSON.stringify(alt(was))} })`); await sleep(150);
        h1 = await html(); assert.notEqual(h1, h0, `${at}: the strip repaints when ${key} changes`);
        await page.eval(`__wse.store.set({ ${key}: ${JSON.stringify(was)} })`); await sleep(150);
        assert.notEqual(await html(), h1, `${at}: and repaints again when ${key} is set back`);
      }
    }
    if (!fixtureLive && !['title', 'end'].includes(b.chapter)) assert.ok(!/confident|fairly sure|timing uncertain/i.test(m.stampPhrase), `${at}: no confidence word on data that is not live`);
  }
  assert.equal(heights.size, 1, `${tag}: the card keeps one height on every beat (${[...heights]})`);
  return script;
}

async function chartGestures(page, assert, tag, vp) {
  const before = await page.eval('__wse.renderer.getTransform()');
  const c = await page.eval(rectOf('#map'));
  const mid = { x: (c.l + c.r) / 2, y: c.t + (c.b - c.t) * 0.3 };
  await inp.drag(page, mid, { by: { dx: 120, dy: 40 }, touch: vp.phone });
  await inp.wheel(page, mid, { dy: -240 });
  await inp.wheel(page, mid, { dy: -240, ctrl: true });
  if (vp.phone) await inp.pinch(page, mid, { from: 80, to: 220 });
  await sleep(150); await settled(page);
  const after = await page.eval('__wse.renderer.getTransform()');
  sameXf(before, after, assert, tag + ': drag, wheel and pinch leave the chart where the briefing put it');
  // a real click at the timeline's play button changes nothing (the timeline is inert while the briefing plays)
  const pb = await page.eval(rectOf('#timeline .tl-play'));
  if (pb && pb.w) {
    await inp.click(page, { x: pb.l + pb.w / 2, y: pb.t + pb.h / 2 });
    await sleep(120);
    assert.equal(await page.eval('__wse.store.get().playing'), false, tag + ': a click on the timeline play button does not start the clock');
  }
}

async function keysAndTaps(page, assert, tag, vp) {
  const idx = () => page.eval(`__wse.ui.brief.player().index()`);
  const view0 = await page.eval('__wse.store.get().view');
  await page.eval(`document.activeElement && document.activeElement.blur && document.activeElement.blur()`);
  const i0 = await idx();
  await inp.key(page, null, 'ArrowRight'); await page.waitFor(`__wse.ui.brief.player().index() === ${i0 + 1}`, { timeout: 15000 });
  await inp.key(page, null, 'ArrowLeft'); await page.waitFor(`__wse.ui.brief.player().index() === ${i0}`, { timeout: 15000 });
  assert.equal(await idx(), i0, tag + ': ArrowRight then ArrowLeft move one beat each way');
  for (const k of [' ', 'f', 'F', '1', '2', '3', '4']) {
    await inp.key(page, null, k);
    await sleep(60);
    const s = await page.eval(`({ playing: !!__wse.store.get().playing, view: __wse.store.get().view, expanded: !!__wse.store.get().expanded, brief: document.getElementById('app').hasAttribute('data-brief') })`);
    assert.equal(s.playing, false, `${tag}: key "${k}" does not start the app clock`);
    assert.equal(s.view, view0, `${tag}: key "${k}" does not switch the view`);
    assert.equal(s.expanded, true, `${tag}: key "${k}" does not leave expanded`);
    assert.equal(s.brief, true, `${tag}: key "${k}" does not close the briefing`);
    if (k === ' ') { assert.equal(await page.eval('__wse.ui.brief.player().state()'), 'paused', tag + ': Space pauses'); await inp.key(page, null, ' '); await page.waitFor(`__wse.ui.brief.player().state() !== 'paused'`, { timeout: 5000 }); assert.notEqual(await page.eval('__wse.ui.brief.player().state()'), 'paused', tag + ': Space resumes'); }
  }
  // taps on the right and left thirds of the chart
  const c = await page.eval(rectOf('#map')), card = await page.eval(rectOf('#brief-card'));
  const y = Math.min(c.t + 160, card.t - 40);
  const here0 = await idx();
  const tapAt = (x) => (vp.phone ? inp.tap(page, { x, y }) : inp.click(page, { x, y }));
  await tapAt(c.l + (c.r - c.l) * 0.88); await page.waitFor(`__wse.ui.brief.player().index() === ${here0 + 1}`, { timeout: 15000 });
  await tapAt(c.l + (c.r - c.l) * 0.12); await page.waitFor(`__wse.ui.brief.player().index() === ${here0}`, { timeout: 15000 });
  assert.equal(await idx(), here0, tag + ': a tap on the right third advances one beat and on the left third goes back one');
}

/** Close puts back the pan and zoom the person made: a real wheel and drag on the default home focus, the pill, Next, Escape. */
async function restoreFromZoom(page, baseUrl, assert, tag, vp) {
  await boot(page, baseUrl, vp);
  const c = await page.eval(rectOf('#map'));
  const mid = { x: Math.round(c.l + (c.r - c.l) * 0.5), y: Math.round(c.t + (c.b - c.t) * 0.35) };
  await inp.wheel(page, mid, { dy: -700 });
  await settled(page);
  await inp.drag(page, mid, { by: { dx: -90, dy: -50 }, touch: !!vp.phone });
  await settled(page);
  await sleep(300);
  const pre = await page.eval(STATE);
  assert.ok(pre.xf.k > 1.2, `${tag}: the chart is zoomed in by the wheel: k=${pre.xf.k}`);
  assert.ok(Math.abs(pre.xf.tx) + Math.abs(pre.xf.ty) > 20, `${tag}: the drag moved the pan: ${pre.xf.tx},${pre.xf.ty}`);
  assert.ok(pre.focus && Number.isFinite(pre.focus.lat), `${tag}: the default home focus is set: ${JSON.stringify(pre.focus)}`);
  await open(page, { rate: 1 });
  await sleep(300);
  await inp.key(page, null, 'ArrowRight');
  await sleep(300);
  await inp.key(page, null, 'Escape');
  await closed(page);
  await sleep(1200); await settled(page);
  const post = await page.eval(STATE);
  sameXf(pre.xf, post.xf, assert, `${tag}: Close restores the zoomed-in pan and zoom`);
  assert.deepEqual(post.focus, pre.focus, `${tag}: and the focus`);
}

/** Counts the page's own animation frames (the hold after Close gives way after 45 quiet frames; this waits past it by frames, not time). */
const frames = (page, n) => page.eval(`new Promise((r) => { let i = 0; const f = () => (++i >= ${n} ? r(i) : requestAnimationFrame(f)); requestAnimationFrame(f); })`);

/** The pan and zoom put back after Close give way to the person: zoom, open, Escape, then at once a real press on the view switch or on
 *  Reset view. The chart ends where the same press leaves it with no briefing at all, never on the transform from before the briefing.
 *  Two boots per viewport: one page takes both references (zoom, the view switch; zoom again, Reset view), a fresh page repeats the same
 *  steps with the briefing opened and closed before each press, and each of its zooms is first checked to land on the reference's. */
async function yieldsAfterClose(page, baseUrl, assert, tag, vp) {
  const press = (target) => (vp.phone ? inp.tap(page, target) : inp.click(page, target));
  const RESET_SHOWN = `(() => { const b = document.getElementById('btn-reset'); return !!b && !b.hidden && b.getClientRects().length > 0; })()`;
  const zoom = async () => {
    const c = await page.eval(rectOf('#map'));
    await inp.wheel(page, { x: Math.round(c.l + (c.r - c.l) * 0.5), y: Math.round(c.t + (c.b - c.t) * 0.35) }, { dy: -700 });
    await settled(page);
    const xf = await page.eval('__wse.renderer.getTransform()');
    assert.ok(xf.k > 1.2, `${tag}: the wheel zoomed the chart in: k=${xf.k}`);
    return xf;
  };
  const now = () => page.eval(`({ view: __wse.store.get().view, xf: __wse.renderer.getTransform() })`);
  // the case waits 90 of the page's frames past the press (twice the hold's 45), so a hold that did not give way would have put the old
  // transform back by then; the reference has no briefing and so no hold to outlast
  const after = async (hold) => { if (hold) await frames(page, 90); await settled(page); return now(); };
  const briefThenEscape = async () => {
    await open(page, { rate: 1 });
    await sleep(300);
    await inp.key(page, null, 'Escape');
    await closed(page);
  };
  const cases = [
    { name: 'the view switch (Hemisphere)', go: async () => press('#view-switch [data-view="nh"]') },
    { name: 'Reset view', go: async () => { await page.waitFor(RESET_SHOWN, { timeout: 8000 }); await press('#btn-reset'); } },
  ];
  // the references: the same presses on a zoomed chart with no briefing
  await boot(page, baseUrl, vp);
  for (const c of cases) { c.pre = await zoom(); await c.go(); c.ref = await after(false); }
  // the cases: the same zoom, the briefing opened and closed with Escape, then the press at once
  await boot(page, baseUrl, vp);
  for (const c of cases) {
    const pre = await zoom();
    sameXf(c.pre, pre, assert, `${tag}: ${c.name}: the zoom before the briefing lands where it did with no briefing`);
    await briefThenEscape();
    await c.go();
    const got = await after(true);
    assert.equal(got.view, c.ref.view, `${tag}: ${c.name} right after Close: view ${got.view}, with no briefing ${c.ref.view}`);
    sameXf(c.ref.xf, got.xf, assert, `${tag}: ${c.name} right after Close leaves the chart where it leaves it with no briefing (before the briefing k=${pre.k.toFixed(4)})`);
  }
}

/** The page works from a sub-path: a server that only answers under /wse/sub/path/ (anything absolute 404s). */
async function subPathRun(baseUrl, dataDir, assert, tag) {
  const PREFIX = '/wse/sub/path/';
  const real = new URL(baseUrl);
  const proxy = http.createServer((req, res) => {
    if (!req.url.startsWith(PREFIX)) { res.writeHead(404).end('outside the prefix'); return; }
    const up = http.request({ host: real.hostname, port: real.port, path: '/' + req.url.slice(PREFIX.length), method: req.method }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => res.writeHead(502).end()); up.end();
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${proxy.address().port}${PREFIX}`;
  const br = await Browser.launch({ baseUrl: base });
  try {
    const vp = VPS[1], T = (s) => `${tag}: sub-path: ${s}`, p = await br.newPage();
    await boot(p, base, vp);
    await seedFull(p);
    assert.ok((await pillText(p)).startsWith('Play'), T('the pill is there under ' + PREFIX));
    await open(p, { rate: 20 });
    await p.waitFor(`__wse.ui.brief.player().index() >= 2`, { timeout: 30000 });
    const css = await p.eval(`(() => { const l = document.querySelector('link#wse-brief-css'); return { href: l && l.href, loaded: [...document.styleSheets].some((s) => s.href && s.href.endsWith('css/brief.css')) }; })()`);
    assert.ok(css.href && css.href.includes(PREFIX) && css.loaded, T('brief.css loads from under the prefix: ' + JSON.stringify(css)));
    const res = await p.eval(`performance.getEntriesByType('resource').map((e) => new URL(e.name).pathname)`);
    assert.ok(res.length > 10 && res.every((n) => n.startsWith(PREFIX)), T('every request stays under the prefix: ' + res.filter((n) => !n.startsWith(PREFIX)).join(',')));
    assert.deepEqual(p.externalRequests || [], [], T('no request left the origin'));
    assert.ok(await p.eval(`!!document.getElementById('brief-card') && __wse.ui.brief.isOpen()`), T('the briefing plays'));
    await inp.key(p, null, 'Escape');
    await closed(p);
    assert.deepEqual(p.errors(), [], T('no console errors or failed loads: ' + JSON.stringify(p.errors())));
  } finally { await br.close(); await new Promise((r) => proxy.close(r)); }
}

export async function run({ page, baseUrl, assert, fixture, dataDir }) {
  const tag = (s) => `[${fixture}] ${s}`;
  // ---- the source rules: one dynamic import, a mount after storyReady, no static import, the stylesheet by import.meta.url ----
  {
    const main = fs.readFileSync(path.join(REPO, 'site/js/main.js'), 'utf8');
    assert.equal((main.match(/import\(\s*['"]\.\/brief\/index\.js['"]\s*\)/g) || []).length, 1, 'main.js has exactly one dynamic import of ./brief/index.js');
    assert.ok(!/^\s*import[^;]*brief\//m.test(main), 'main.js has no static import of the briefing');
    assert.ok(main.indexOf('mountBriefing(') > main.indexOf('wse.storyReady = true'), 'mountBriefing is called after wse.storyReady = true');
    assert.equal((main.match(/mountBriefing\(/g) || []).length, 1, 'one mountBriefing call');
    const html = fs.readFileSync(path.join(REPO, 'site/index.html'), 'utf8');
    assert.ok(!/brief/i.test(html), 'index.html does not mention the briefing');
    const idx = fs.readFileSync(path.join(REPO, 'site/js/brief/index.js'), 'utf8');
    assert.ok(/new URL\(\s*['"]\.\.\/\.\.\/css\/brief\.css['"]\s*,\s*import\.meta\.url\s*\)/.test(idx), 'brief/index.js loads brief.css with new URL(..., import.meta.url)');
    assert.ok(!/https?:\/\//.test(idx.replace(/\/\/.*$/gm, '')) && !/['"`]\/[a-z]/i.test(idx.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/[^/\n]+\/[gimsuy]*[.,;)\s]/g, '')), 'brief/index.js has no absolute URL');
  }

  // Every variant below runs on its own page per viewport. The phone runs on the runner's page and the desktop on a second browser, both
  // at once: each page keeps its own profile and storage, and every wait is the page's own state, frames or clock, so neither page's
  // timing depends on the other (one after the other, the check outgrew the mutation gate's 240 s cap per check on a loaded Mac).
  const oneViewport = async (page, vp) => {
    const T = (s) => tag(`${vp.name}: ${s}`);
    // ================= the full variant =================
    await boot(page, baseUrl, vp);
    await seedFull(page);
    // the pill: text, place, never overlapping
    const text0 = await pillText(page);
    const live0 = await page.eval('!__wse.data.getManifest().sample');
    assert.equal(live0, false, T('the fixture is not live'));
    assert.equal(text0, 'Play briefing · recorded forecast', T('pill text on data that is not live: ' + text0));
    const pill = await page.eval(rectOf('#brief-pill')), stage = await page.eval(rectOf('#stage'));
    assert.ok(pill && pill.w > 0, T('the pill is on screen'));
    assert.ok(pill.l >= stage.l && pill.r <= stage.r && pill.t >= stage.t && pill.b <= stage.b, T('the pill is within the stage'));
    assert.ok(pill.h >= (vp.phone ? 44 : 32) - 0.5, T('the pill is tall enough to press: ' + pill.h));
    for (const sel of ['#view-switch', '#map-tools button', '#map-tools .seg', '.mlg', '#map-status', '.wse-sample-chip', '#timeline', '#btn-reset']) {
      const boxes = await page.eval(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => !e.hidden && e.getClientRects().length && (getComputedStyle(e).display !== 'none')).map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }).filter((r) => r.w > 0 && r.h > 0)`);
      for (const b of boxes) assert.ok(!hits({ l: pill.l, t: pill.t, r: pill.r, b: pill.b }, b, SLACK), T(`the pill does not overlap ${sel} (${JSON.stringify(b)} vs ${JSON.stringify(pill)})`));
    }
    // the free run (also proves the click on the pill, the order of beats, the rewind) then the end card
    const before = await page.eval(STATE);
    const { script } = await freeRun(page, assert, T('free run'), { full: fixture === 'synthetic-15d' });
    const chapters = script.map((b) => b.chapter);
    assert.deepEqual([chapters[0], chapters.at(-1)], ['title', 'end'], T('the script runs from title to end: ' + chapters.join(',')));
    assert.ok(chapters.includes('trip'), T('the full variant has a trip beat'));
    assert.ok(chapters.includes('people'), T('the full variant has a people beat'));
    const ls = await page.eval(`JSON.parse(localStorage.getItem('wse.v1.brief') || 'null')`);
    assert.ok(ls && JSON.stringify(Object.keys(ls).sort()) === JSON.stringify(['finishedAt', 'plays', 'run']), T('wse.v1.brief has exactly run, finishedAt and plays: ' + JSON.stringify(ls)));
    const endText = await page.eval(`document.getElementById('brief-card').textContent`);
    assert.ok(!/Next update usually about/.test(endText), T('no "Next update" line on data that is not live'));
    assert.equal(await page.eval(`!!document.querySelector('#brief-card [data-act="add"]:not([hidden])')`), false, T('the end card has no Add when there are people and a trip'));
    // Explore from here keeps the end beat's view, lens, t, focus and transform and leaves expanded
    const atEnd = await page.eval(STATE);
    await inp.click(page, '#brief-card [data-act="stay"]');
    await closed(page);
    const stayed = await page.eval(STATE);
    assert.equal(stayed.expanded, before.expanded, T('Explore from here exits expanded'));
    for (const k of ['view', 'lens']) assert.equal(stayed[k], atEnd[k], T(`Explore from here keeps the ${k}`));
    assert.ok(Math.abs(stayed.t - atEnd.t) <= 0.01, T('Explore from here keeps t'));
    assert.deepEqual(stayed.focus, atEnd.focus, T('Explore from here keeps the focus'));
    await sleep(700);
    // (the transform is compared with the fit the app has after leaving expanded: same view, so k stays at 1)
    assert.ok((await page.eval('__wse.renderer.getTransform().k')) >= 0.999, T('the chart is still drawn after Explore from here'));

    trace(`${vp.name}: step pass`);
    // the step pass: per-beat assertions, gestures, keys, taps, Escape, restore
    await boot(page, baseUrl, vp);
    await seedFull(page);
    await page.eval(`(() => { __wse.store.set({ view: 'gl', lens: 'j', range: 10 }); __wse.store.set({ t: 48 }); })()`);
    await sleep(500);
    const pre = await page.eval(STATE);
    const steps = await stepThrough(page, assert, T('step'), vp, false);
    // back to a paused-in-place beat in the middle for the gestures and keys
    await page.eval(`__wse.ui.brief.player().goTo(3)`);
    await page.waitFor(`__wse.ui.brief.player().index() === 3`, { timeout: 10000 });
    await settled(page);
    await chartGestures(page, assert, T('H8'), vp);
    await keysAndTaps(page, assert, T('keys'), vp);
    await inp.key(page, null, 'Escape');
    await closed(page);
    await sleep(900);
    const post = await page.eval(STATE);
    sameState(pre, post, assert, T('Close restores the state before the click'));
    assert.equal(post.hash, pre.hash, T('location.hash is restored after Close: ' + pre.hash + ' -> ' + post.hash));
    assert.ok(steps.length >= 5, T('the script has at least five beats'));
    // network: every request is same-origin
    const outside = await page.eval(`performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n, location.href).origin !== location.origin)`);
    assert.deepEqual(outside, [], T('every request is same-origin'));
    assert.deepEqual(page.externalRequests || [], [], T('no request left the origin'));
    assert.ok(await page.eval(`!!document.querySelector('link#wse-brief-css') && document.querySelector('link#wse-brief-css').href.endsWith('css/brief.css')`), T('brief.css is loaded as a relative stylesheet'));
    assert.deepEqual(page.errors(), [], T('no console errors: ' + JSON.stringify(page.errors())));

    trace(`${vp.name}: inert`);
    // ================= the inert states (phone and desktop) =================
    await boot(page, baseUrl, vp);
    await page.eval(`__wse.ui.app.openAddSheet({})`);
    await page.waitFor(`!!document.querySelector('.wse-sheet-root')`, { timeout: 8000 });
    await sleep(150);
    assert.equal(await page.eval(`document.getElementById('brief-pill').disabled`), true, T('the pill is inert while the add sheet is open'));
    await page.eval(`document.getElementById('brief-pill').click()`);
    await sleep(150);
    assert.equal(await page.eval(`document.getElementById('app').hasAttribute('data-brief')`), false, T('a briefing cannot open over the add sheet'));
    await page.eval(`document.querySelector('.wse-sheet-close').click()`);
    await page.waitFor(`!document.querySelector('.wse-sheet-root')`, { timeout: 8000 });
    await sleep(150);
    assert.equal(await page.eval(`document.getElementById('brief-pill').disabled`), false, T('the pill comes back when the sheet closes'));
    // (the Layers panel of the recorded fixture throws in layers.js buildPanel, Object.keys of an undefined list: not this package's, so it is opened on the synthetic fixture only)
    if (fixture === 'synthetic-15d') {
      await inp.click(page, '#btn-layers');
      await page.waitFor(`!document.getElementById('layers-panel').hidden`, { timeout: 5000 });
      await sleep(150);
      assert.equal(await page.eval(`document.getElementById('brief-pill').disabled`), true, T('the pill is inert while the layers panel is open'));
      await inp.click(page, '#btn-layers');
      await sleep(200);
    }
    // the share sheet: the Share button is in the header (on the phone, behind More)
    const sh = await page.eval(rectOf('#btn-share'));
    if (sh && sh.w > 0) {
      await inp.click(page, '#btn-share');
      await page.waitFor(`!!document.querySelector('.wse-sheet-root, .modal-scrim, #share-sheet, [role="dialog"]')`, { timeout: 8000 });
      assert.equal(await page.eval(`document.getElementById('brief-pill').disabled`), true, T('the pill is inert while the share sheet is open'));
      await inp.key(page, null, 'Escape');
      await sleep(300);
    }

    trace(`${vp.name}: restore from zoom`);
    await restoreFromZoom(page, baseUrl, assert, T('restore from a zoomed, dragged chart'), vp);
    trace(`${vp.name}: the hold gives way`);
    await yieldsAfterClose(page, baseUrl, assert, T('the restored zoom gives way to the person'), vp);

    trace(`${vp.name}: no pins`);
    // ================= no pins: the end card offers Add =================
    await boot(page, baseUrl, vp);
    const bare = await freeRun(page, assert, T('no pins'), { full: false });
    assert.deepEqual(bare.script.map((b) => b.chapter).filter((c, i, a) => a.indexOf(c) === i), ['title', 'picture', 'home', 'sure', 'end'], T('no pins and no trips: title, picture, home, sure, end'));
    assert.equal(await page.eval(`!!document.querySelector('#brief-card [data-act="add"]:not([hidden])')`), true, T('the end card shows Add'));
    await inp.click(page, '#brief-card [data-act="add"]');
    await page.waitFor(`!!document.querySelector('.wse-sheet-root')`, { timeout: 8000 });
    assert.equal(await page.eval(`document.getElementById('app').hasAttribute('data-brief')`), false, T('Add closes the briefing and opens the add sheet'));
    await page.eval(`document.querySelector('.wse-sheet-close') && document.querySelector('.wse-sheet-close').click()`);

    trace(`${vp.name}: friend`);
    // ================= the friend link =================
    await boot(page, baseUrl, vp);
    const hashFor = await page.eval(`(async () => { const G = await import(new URL('js/share/hashgrammar.js', document.baseURI).href); return '#np-z-' + G.utcStamp(__wse.data.validTime(__wse.store.get().t)) + '-c5809844'; })()`);
    await boot(page, baseUrl, vp, { hash: hashFor, keepStorage: true });
    await sleep(400);
    const fp = await pillText(page);
    assert.ok(/^Play the briefing for \S/.test(fp), T('a friend (default home, opened from a link) is offered the place: ' + fp));
    const friend = await freeRun(page, assert, T('friend'), { full: false });
    assert.ok(!friend.script.some((b) => b.chapter === 'people' || b.chapter === 'trip'), T('the friend link has no people or trip beat'));
    await inp.click(page, '#brief-card [data-act="close"]');
    await closed(page);
  };
  {
    const br2 = await Browser.launch({ baseUrl });
    try {
      const desk = await br2.newPage();
      // both run to the end, so a failure names every viewport it happened on
      const res = await Promise.allSettled([oneViewport(page, VPS[0]), oneViewport(desk, VPS[1])]);
      const bad = res.filter((r) => r.status === 'rejected').map((r) => r.reason);
      if (bad.length) { const e = bad[0]; if (bad.length > 1) e.message = bad.map((x) => String(x && x.message || x).split('\n')[0]).join(' AND '); throw e; }
    } finally { await br2.close(); }
  }

  // ================= reduced motion =================
  {
    const vp = VPS[0], T = (s) => tag(`reduced: ${s}`);
    await boot(page, baseUrl, vp, { reduced: true });
    await open(page, { rate: 20 });
    await sleep(100);
    const b0 = await beatId(page), t0 = await page.eval('__wse.store.get().t');
    await page.waitFor(`__wse.ui.brief.player().state() === 'paused'`, { timeout: 10000 });
    await sleep(900);
    assert.equal(await beatId(page), b0, T('nothing advances without Next'));
    assert.equal(await page.eval('__wse.store.get().t'), t0, T('the clock does not move'));
    await inp.click(page, '#brief-card [data-act="next"]');
    await page.waitFor(`document.getElementById('brief-card').dataset.beat !== ${JSON.stringify(b0)}`, { timeout: 10000 });
    await inp.key(page, null, 'Escape');
    await closed(page);
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  }

  if (fixture === 'synthetic-15d') await subPathRun(baseUrl, dataDir, assert, tag('sub-path'));

  // ================= a live-like copy: the live-only words =================
  if (fixture === 'synthetic-15d') {
    const dir = path.join(artifactTmp('s-brief-live-'), 'data');
    makeLiveLike(dir, path.join(path.dirname(dataDir), 'synthetic-15d'));
    const mp = path.join(dir, 'manifest.json'), mm = JSON.parse(fs.readFileSync(mp, 'utf8'));
    const runAt = new Date(Math.floor((Date.now() - 14 * 3600e3) / 3600e3) * 3600e3);
    mm.run = runAt.toISOString().slice(0, 16) + 'Z';
    mm.generated = new Date(runAt.getTime() + 9.5 * 3600e3).toISOString().slice(0, 16) + 'Z';
    fs.writeFileSync(mp, JSON.stringify(mm));
    const srv = await startServer({ dataDir: dir }), br = await Browser.launch({ baseUrl: srv.baseUrl });
    try {
      for (const vp of VPS) {
        const T = (s) => tag(`live-like ${vp.name}: ${s}`);
        const p = await br.newPage();
        await boot(p, srv.baseUrl, vp);
        const gen = new Date(mm.generated.replace(/Z$/, ':00Z'));
        const sameDay = gen.toDateString() === new Date().toDateString();
        const when = gen.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const wantNew = `New briefing · updated ${sameDay ? '' : gen.toLocaleDateString('en-US', { weekday: 'short' }) + ' '}${when}`;
        assert.equal((await pillText(p)).replace(/\s+/g, ' ').trim(), wantNew, T('a new run is labelled with its local time'));
        await seedFull(p);
        const { script } = await freeRun(p, assert, T('free run'), { full: true });
        const endText = await p.eval(`document.getElementById('brief-card').textContent`);
        assert.ok(/Next update usually about \d{1,2} [ap]m/.test(endText), T('the end card says when the next update is usually due: ' + endText.slice(0, 200)));
        const ls = await p.eval(`JSON.parse(localStorage.getItem('wse.v1.brief'))`);
        assert.deepEqual(Object.keys(ls).sort(), ['finishedAt', 'plays', 'run'], T('wse.v1.brief keys'));
        assert.equal(ls.run, mm.run, T('the stored run is the manifest run'));
        await inp.click(p, '#brief-card [data-act="close"]');
        await closed(p);
        await sleep(200);
        const after = await pillText(p);
        const mins = Math.max(1, Math.round(script.length && (await p.eval('__wse.ui.brief.script().totalMs')) / 60000));
        assert.ok(!/New/.test(after), T('the pill no longer says New: ' + after));
        assert.equal(after.replace(/\s+/g, ' ').trim(), `Play briefing · about ${mins} min`, T('pill text after a play'));
        assert.deepEqual(p.errors(), [], T('no console errors'));
        // the live copy serves the same relative files: stepping the beats there keeps every rule
        await boot(p, srv.baseUrl, vp, { keepStorage: true });
        await seedFull(p);
        await stepThrough(p, assert, T('step'), vp, true);
        await inp.key(p, null, 'Escape');
        await closed(p);
        await p.close();
      }
    } finally { await br.close(); await srv.close(); }
  }
}
