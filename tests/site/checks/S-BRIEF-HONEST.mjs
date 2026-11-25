// S-BRIEF-HONEST (C1-05): an independent honesty, privacy and artifact check of The Briefing as it runs.
// Written from CONCEPTS-REVIEW-2026-11-20.md (honesty rules H1 to H7, the DOM contract M9, the test lines of M12) and from nothing in
// site/js/brief/: it reads only the running page (the contract's selectors, window.__wse.store, window.__wse.data, renderer.getTransform(),
// the canvas export calls and the network log) and imports no briefing module. The thresholds below are written out here on purpose, so a
// change to the briefing's own constants cannot move them.
// Variants, each at 390x844 and 1440x900: the fixture itself with a person, a near trip and a trip in days 11-15 (and the doubt overlay
// switched off before opening); on synthetic-15d also a live-like copy of it (the live-only words) and a live-like copy with z500sd removed.
// Timing: playback speed is the briefing's testRate; every wait is the page's own state, never wall-clock time.
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../lib/server.mjs';
import { Browser } from '../lib/cdp.mjs';
import { makeLiveLike } from '../lib/livelike.mjs';
import { artifactTmp } from '../lib/artifacts.mjs';
import * as inp from '../lib/input.mjs';

export const id = 'S-BRIEF-HONEST';
export const tier = 'full';
export const freshProfile = true;
export const timeoutMs = 600000;
export const data = ['synthetic-15d', 'synthetic-15d-nomean', 'recorded'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READY = 'window.__wse && window.__wse.ready === true && window.__wse.storyReady === true && !!window.__wse.ui && !!window.__wse.ui.brief';
const VPS = [{ name: 'phone', w: 390, h: 844, phone: true }, { name: 'desktop', w: 1440, h: 900, phone: false }];
const NAME = 'Zzyx Testperson';
const TOKEN = 'zzyx';
const TRANSITION_FRAMES = 3;
const RATE = 8; // playback speed multiplier (testRate): still a few dozen frames per beat
const EPS_SETTLED = 1e-3; // a settled frame may not exceed its cap by more than this
const EPS_GLIDE = 1e-5; // k falling frame over frame by more than this is a glide down toward the cap
const GLIDE_FRAMES = 12; // the first frames of a beat (a beat is 90 or more frames at the test rate) may overshoot the cap by up to GLIDE_REL (seen 5.1% on frame 2 at 3x)
const GLIDE_REL = 0.1;
// A camera held above its cap is never forgiven: every other frame must sit at cap + EPS_SETTLED or lower.

// ---- the rules, written out ----
const DETAIL_END_H = 168;
/** H1: the most a beat may zoom by the ensemble spread (dam) at the place and hour: under 3 -> 3, 3 to 6 -> 2, above 6 -> 1.4. */
const capFromSpread = (sd) => (sd < 3 ? 3 : sd <= 6 ? 2 : 1.4);
/** With no z500sd in the run the level comes from lead time alone and never earns more than 2. */
const LEAD_ONLY_CAP = 2;
const RANK = { high: 3, medium: 2, low: 1, 'pattern-only': 0, none: 0 };
/** A day-level rain or temperature word (H3). */
// (a broad pattern lean such as "leans toward a ridge (drier)" is a permitted broad line, so the comparatives are not in the list)
const DAY_WORDS = /\b(rain|rains|rainy|raining|rainfall|showers?|drizzle|downpours?|dry|wet|snow|snowy|thunderstorms?|heavy|warm|cool|cold|chilly|hot|mild|frost|freezing|temperatures?|degrees?)\b|°/i;
const CONF_WORDS = /confident|fairly sure|timing uncertain/i;
const WEEKDAY = /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|sday|nesday|rsday|urday)?\b/i;
const REWIND_BAN = /\b(arrives?|arriving|reaches|reaching|hits?|hitting|km)\b/i;

const READ = {
  // `after` is the app-clock pause the other checks use, so the forecast clock never moves on its own
  boot: async (page, url, vp) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.phone ? 2 : 1, mobile: !!vp.phone });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: !!vp.phone, maxTouchPoints: 5 });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await page.goto(new URL('css/tokens.css', url).href); await page.eval('localStorage.clear()');
    await page.goto(url);
    await page.waitFor(READY, { timeout: 60000 });
    await page.eval(`(async () => { (await import(new URL('js/time/clock.js', document.baseURI).href)).pause(); })()`);
    await sleep(300);
  },
};

const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10);

/** A person (named NAME), three more people, a trip in days 3-5 and one in days 12-14 of the home story. */
async function seed(page, { near = true } = {}) {
  await page.eval(`(() => { const c = __wse.pins.home();
    const P = (name, city, id, lat, lon, admin) => __wse.pins.add({ kind: 'person', name, city: { ...c, id, name: city, lat, lon, admin, cc: 'US' } });
    P(${JSON.stringify(NAME)}, 'Portland', 5746545, 45.52, -122.68, 'OR'); P(${JSON.stringify(NAME + ' Two')}, 'Seattle', 5809844, 47.61, -122.33, 'WA');
    P(${JSON.stringify(NAME + ' Three')}, 'Sacramento', 5389489, 38.58, -121.49, 'CA'); P(${JSON.stringify(NAME + ' Four')}, 'Reno', 5509952, 39.53, -119.81, 'NV'); })()`);
  const cov = await page.eval(`(() => { const s = __wse.ui.home.stories.get('home'); const c = s && s.days.coverage; return c && { firstDate: c.firstDate }; })()`);
  const T = (label, a, b) => `__wse.pins.addTrip({ label: ${JSON.stringify(label)}, city: __wse.pins.home(), start: ${JSON.stringify(addDays(cov.firstDate, a - 1))}, end: ${JSON.stringify(addDays(cov.firstDate, b - 1))} })`;
  await page.eval(`(() => { ${near ? T('Near trip', 3, 5) + ';' : ''} ${T('Far trip', 12, 14)}; })()`);
  await sleep(250);
}

/** Page-side recorder: every animation frame and every store change while a briefing is open; canvas exports, network calls and hashes. */
const RECORDER = `(() => {
  const H = window.__H = { frames: [], snaps: new Map(), maxT: {}, net: [], canvas: 0, hashes: new Set(), beats: [], stop: false };
  const A = (...a) => a.map((x) => { try { return typeof x === 'string' ? x : x instanceof URL ? x.href : x && x.url ? x.url : JSON.stringify(x); } catch { return String(x); } }).join(' ');
  const of = window.fetch; window.fetch = function (u, i) { H.net.push(A(u, i && i.body)); return of.apply(this, arguments); };
  const xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = String(u); return xo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) { H.net.push(A(this.__u, b)); return xs.apply(this, arguments); };
  if (navigator.sendBeacon) { const ob = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = (u, d) => { H.net.push(A(u, d)); return ob(u, d); }; }
  const WS = window.WebSocket; window.WebSocket = function (u) { H.net.push(A(u)); return new WS(...arguments); }; window.WebSocket.prototype = WS.prototype;
  const cnt = (o, n) => { const f = o && o.prototype && o.prototype[n]; if (!f) return; o.prototype[n] = function () { H.canvas++; return f.apply(this, arguments); }; };
  cnt(HTMLCanvasElement, 'toDataURL'); cnt(HTMLCanvasElement, 'toBlob'); cnt(HTMLCanvasElement, 'captureStream');
  if (window.OffscreenCanvas) { cnt(OffscreenCanvas, 'convertToBlob'); cnt(OffscreenCanvas, 'transferToImageBitmap'); }
  for (const n of ['pushState', 'replaceState']) { const f = history[n].bind(history); history[n] = (s, t, u) => { if (u != null) H.hashes.add(String(u)); return f(s, t, u); }; }
  window.addEventListener('hashchange', () => H.hashes.add(location.href));
  const snap = () => {
    const c = document.getElementById('brief-card'); H.hashes.add(location.hash);
    const s = __wse.store.get();
    if (!c) return;
    const id = c.dataset.beat; if (!id) return;
    if (H.beats[H.beats.length - 1] !== id) H.beats.push(id);
    const k = __wse.renderer.getTransform().k;
    H.frames.push({ id, state: c.dataset.state, t: s.t, k, doubt: !!(s.overlays || {}).doubt });
    if (!(id in H.maxT) || s.t > H.maxT[id]) H.maxT[id] = s.t;
    const st = c.querySelector('.brief-stamp'), lg = document.querySelector('.mlg-title'), dt = c.querySelector('.brief-date');
    const rec = { id, chapter: c.dataset.chapter, past: s.t > ${DETAIL_END_H}, text: c.textContent,
      stamp: st ? { hidden: !!st.hidden || !st.getClientRects().length, text: st.textContent, level: st.dataset.level || null, source: st.dataset.source || null,
        lead: (st.querySelector('.brief-stamp-lead') || {}).textContent || '' } : null,
      date: dt ? dt.textContent : '', legend: lg ? lg.textContent : '',
      lines: [...c.querySelectorAll('.brief-line')].map((e) => e.textContent), title: (c.querySelector('.brief-title') || {}).textContent || '' };
    const key = JSON.stringify([rec.id, rec.past, rec.text, rec.stamp, rec.legend]);
    if (!H.snaps.has(key)) H.snaps.set(key, rec);
  };
  __wse.store.subscribe(snap);
  const loop = () => { snap(); if (!H.stop) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  return true; })()`;

/** The z500sd and z500a series at a place, read through the page's data layer (dam), with the run's own steps. */
const SERIES = (lat, lon) => `(() => { const D = __wse.data, f = (a) => a && { steps: a.steps, values: Array.from(a.values, (v) => (Number.isFinite(v) ? v / 10 : null)) };
  return { sd: f(D.sampleSeries('z500sd', ${lat}, ${lon})), a: f((D.patternSeries && D.patternSeries('z500a', ${lat}, ${lon})) || D.sampleSeries('z500a', ${lat}, ${lon})) }; })()`;

function interp(S, t) {
  if (!S) return NaN;
  const { steps, values } = S;
  if (!(t >= steps[0]) || t > steps[steps.length - 1]) return NaN;
  let i = 0; while (i < steps.length - 2 && steps[i + 1] <= t) i++;
  const a = values[i], b = values[i + 1];
  if (a == null || b == null) return NaN;
  const w = (t - steps[i]) / (steps[i + 1] - steps[i]);
  return a + (b - a) * w;
}

/** Everything the check needs from one briefing played from the pill to the end card, then closed. */
async function play(page, assert, T, { doubtOff = false, near = true } = {}) {
  await seed(page, { near });
  if (doubtOff) await page.eval(`__wse.store.set({ overlays: { ...__wse.store.get().overlays, doubt: false } })`);
  const doubtBefore = await page.eval(`!!__wse.store.get().overlays.doubt`);
  const before = await page.eval(`({ keys: Object.keys(localStorage) })`);
  const pinsKey = await page.eval(`(() => { const k = Object.keys(localStorage).filter((k) => (localStorage.getItem(k) || '').toLowerCase().includes(${JSON.stringify(TOKEN)})); return k; })()`);
  assert.equal(pinsKey.length, 1, T(`the seeded person is stored under exactly one localStorage key (the pins store): ${JSON.stringify(pinsKey)}`));
  await page.eval(RECORDER);
  await page.eval(`__wse.ui.brief.testRate = ${RATE}`);
  await page.eval(`new Promise((done) => { let last = '', n = 0; const f = () => { const e = document.getElementById('brief-pill'), r = e && e.getBoundingClientRect(), x = r ? [r.left, r.top, r.width].join() : ''; n = x === last ? n + 1 : 0; last = x; if (n >= 8) done(true); else requestAnimationFrame(f); }; requestAnimationFrame(f); })`);
  await inp.click(page, '#brief-pill');
  try { await page.waitFor(`document.getElementById('app').hasAttribute('data-brief') && !!document.getElementById('brief-card')`, { timeout: 30000 }); }
  catch (e) { throw new Error(T('the pill did not open the briefing: ' + JSON.stringify(await page.eval(`(() => { const p = document.getElementById('brief-pill'); return { pill: p && [p.textContent, p.disabled], brief: __wse.ui.brief.isOpen(), err: ${JSON.stringify(page.errors())} }; })()`)))); }
  await page.waitFor(`__wse.ui.brief.player() && __wse.ui.brief.player().state() === 'ended'`, { timeout: 240000 });
  await sleep(100);
  const script = await page.eval(`__wse.ui.brief.script().beats.map((b) => ({ id: b.id, chapter: b.chapter, hook: b.hook || null, lens: b.lens,
    place: b.place ? { key: b.place.key, kind: b.place.kind, lat: b.place.lat, lon: b.place.lon } : null }))`);
  const rec = await page.eval(`(() => { const H = window.__H; H.stop = true; return { frames: H.frames, snaps: [...H.snaps.values()], maxT: H.maxT, net: H.net, canvas: H.canvas, hashes: [...H.hashes], beats: H.beats }; })()`);
  const doubtOnEnd = await page.eval(`!!__wse.store.get().overlays.doubt`);
  const manifest = await page.eval(`(() => { const m = __wse.data.getManifest(); const f = m.fields || {}; const st = (f.z500sd || f.z500 || {}).steps || [0];
    return { sample: !!m.sample, hasSd: !!f.z500sd, last: st[st.length - 1], chip: ((document.querySelector('.wse-sample-chip') || {}).textContent || '').trim() }; })()`);
  // per-place series for the H1 frames
  const series = {};
  for (const b of script) if (b.place && !series[b.place.key]) series[b.place.key] = await page.eval(SERIES(b.place.lat, b.place.lon));
  const home = await page.eval(`(() => { const h = __wse.pins.home(); return { lat: h.lat, lon: h.lon }; })()`);
  series.__home = await page.eval(SERIES(home.lat, home.lon));
  // the day classes the Home story shows for each place the briefing covered (H2): a pin's card story is loaded the way Home loads it
  // when the card is opened, so a person's stamp is weighed against that person's own days, never home's
  await page.eval(`(async () => { const H = __wse.ui.home; for (const k of ${JSON.stringify([...new Set(script.filter((b) => b.place && /^pin:/.test(b.place.key)).map((b) => b.place.key))])}) {
    const p = __wse.pins.all().find((x) => 'pin:' + x.id === k); if (!p) continue;
    await H.loadStory({ key: k, kind: p.kind === 'place' ? 'place' : 'person', id: p.id, city: p.city, lat: p.city.lat, lon: p.city.lon, label: p.city.name, pin: p, title: p.name }); } return true; })()`);
  const days = await page.eval(`(() => { const out = {}; for (const [k, st] of __wse.ui.home.stories) out[k] = (st.days || []).map((d) => ({ lead: d.lead, confidence: d.confidence })); return out; })()`);
  const net = await page.eval(`performance.getEntriesByType('resource').map((e) => e.name)`);
  const ls = await page.eval(`Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])`);
  const ss = await page.eval(`Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k)])`);
  // Close
  await inp.click(page, '#brief-card [data-act="close"]');
  await page.waitFor(`!document.getElementById('app').hasAttribute('data-brief') && !document.getElementById('brief-card')`, { timeout: 10000 });
  await sleep(300);
  const doubtAfterClose = await page.eval(`!!__wse.store.get().overlays.doubt`);
  return { script, rec, manifest, series, home, days, net, ls, ss, before, pinsKey: pinsKey[0], doubtBefore, doubtOnEnd, doubtAfterClose, ext: page.externalRequests.slice(), errors: page.errors() };
}

/** All the rules over one recorded run. */
function judge(r, assert, T, { live, fixture, noSd, caps }) {
  const { script, rec, manifest } = r;
  const byId = Object.fromEntries(script.map((b) => [b.id, b]));
  const inner = (b) => b.chapter !== 'title' && b.chapter !== 'end';

  // ---- every beat was shown, in script order, none skipped (Artifact) ----
  assert.deepEqual(rec.beats, script.map((b) => b.id), T(`every beat was shown in script order with none skipped: ${rec.beats.join(',')}`));

  // ---- H1 on screen, every frame of every place beat ----
  if (process.env.WSE_TRACE) { const mx = {}; for (const f of rec.frames) { const m = mx[f.id] = mx[f.id] || { n: 0, kmax: 0, kmin: 9, tmin: 9e9, tmax: -1, states: new Set() }; m.n++; m.kmax = Math.max(m.kmax, f.k); m.kmin = Math.min(m.kmin, f.k); m.tmin = Math.min(m.tmin, f.t); m.tmax = Math.max(m.tmax, f.t); m.states.add(f.state); }
    console.error('[honest]', T('frames'), JSON.stringify(Object.entries(mx).map(([k, m]) => [k, m.n, +m.kmin.toFixed(3), +m.kmax.toFixed(3), m.tmin, m.tmax, [...m.states].join('/')]))); }
  let frames = 0, worst = 0, prev = null; const seq = new Map();
  for (const f of rec.frames) {
    const last = prev; prev = f;
    const b = byId[f.id];
    if (!b || !b.place || (f.state !== 'playing' && f.state !== 'paused')) continue;
    const S = r.series[b.place.key];
    const sd = manifest.hasSd ? interp(S && S.sd, f.t) : NaN, an = interp(S && S.a, f.t);
    let cap;
    if (!manifest.hasSd) cap = LEAD_ONLY_CAP;
    else {
      assert.ok(Number.isFinite(sd), T(`z500sd is sampled at ${b.place.key} for store.t=${f.t} (beat ${f.id})`));
      cap = capFromSpread(sd);
      if (sd >= 4 && Number.isFinite(an) && sd > Math.abs(an)) cap = 1;
    }
    if (f.t > DETAIL_END_H) cap = 1;
    caps.add(cap);
    frames++; worst = Math.max(worst, f.k - cap);
    const idx = (last && last.id === f.id) ? (seq.get(f.id) || 0) + 1 : 0; seq.set(f.id, idx);
    const gliding = (idx < GLIDE_FRAMES && f.k <= cap * (1 + GLIDE_REL)) || (!!last && last.id === f.id && f.k < last.k - EPS_GLIDE);
    assert.ok(f.k <= cap + EPS_SETTLED || gliding, T(`H1: settled frame, beat ${f.id} at store.t=${f.t.toFixed(1)}: k=${f.k.toFixed(3)} is at most the cap ${cap}${manifest.hasSd ? ` (spread ${sd.toFixed(2)} dam, anomaly ${an.toFixed(2)} dam)` : ' (no z500sd: lead only)'}`));
  }
  assert.ok(frames >= 20, T(`H1: at least 20 frames of place beats were sampled (${frames})`));

  // ---- H2 / H3 / H6 / H7 on the cards ----
  const snaps = rec.snaps;
  const seenInner = new Set();
  for (const s of snaps) {
    const b = byId[s.id]; if (!b) continue;
    if (inner(b)) {
      seenInner.add(s.id);
      assert.ok(s.stamp && !s.stamp.hidden, T(`H2: the card of ${s.id} shows .brief-stamp`));
      if (!live) assert.ok(!CONF_WORDS.test(s.stamp.text), T(`H2: no confidence word in the stamp of ${s.id} on data that is not live: ${s.stamp.text}`));
    } else assert.ok(!s.stamp || s.stamp.hidden, T(`H2: no stamp on the ${b.chapter} card`));
    // a card may name the new beat for the one or two frames before the clock leaves the previous beat's late hour (TRANSITION_FRAMES);
    // any longer than that is a day-level line on a screen showing a late hour
    const pastFrames = rec.frames.filter((f) => f.id === s.id && f.t > DETAIL_END_H).length;
    if (s.past && pastFrames > TRANSITION_FRAMES) assert.ok(!DAY_WORDS.test(s.text), T(`H3: the card of ${s.id} shown while store.t > ${DETAIL_END_H} carries a day-level word: ${(s.text.match(DAY_WORDS) || [])[0]} in "${s.text.slice(0, 160)}"`));
    if (manifest.sample && manifest.chip) {
      // the chip shows the full label or its short form; the card carries the label's lead word and "not live"
      const lead = manifest.chip.split(' ')[0];
      assert.ok(s.text.includes(lead) && /not live/.test(s.text), T(`H6: the card of ${s.id} carries the header chip's sample label ("${manifest.chip}": needs "${lead}" and "not live"): ${s.text.slice(0, 140)}`));
    }
    if (b.hook === 'rewind') {
      const noDate = s.text.replace(s.date, ''); // the date readout is the clock, not copy
      assert.ok(!WEEKDAY.test(noDate), T(`H7: the rewind card has no weekday name: "${noDate.slice(0, 120)}"`));
      assert.ok(!REWIND_BAN.test(s.text), T(`H7: the rewind card has none of arrives, reaches, hits, km: "${s.text.slice(0, 120)}"`));
    }
    if (fixture === 'synthetic-15d-nomean') assert.ok(!/51 forecasts/.test(s.text), T(`H4: no card names "51 forecasts" with no ensemble mean in the run (${s.id})`));
    if (noSd && s.id === script.at(-2)?.id) assert.ok(/no ensemble spread/i.test(s.text), T(`H4: with z500sd removed the last card before the end says the run has no ensemble spread: "${s.text.slice(0, 200)}"`));
  }
  for (const b of script.filter(inner)) assert.ok(seenInner.has(b.id), T(`H2: the card of ${b.id} was seen`));

  // ---- H2 live-like: no stamp stronger than the weakest day class ----
  if (live) {
    for (const s of snaps) {
      const b = byId[s.id];
      if (!b || !inner(b) || !s.stamp || !s.stamp.level) continue;
      const m = /Days? (\d+)(?:-(\d+))?/.exec(s.stamp.lead);
      assert.ok(m, T(`H2: the stamp of ${s.id} names its lead ("${s.stamp.lead}")`));
      const a = +m[1], z = +(m[2] || m[1]);
      const key = b.place ? b.place.key : 'home';
      assert.ok(Array.isArray(r.days[key]) && r.days[key].length, T(`H2: the Home story holds day classes for ${s.id}'s place (${key})`));
      const D = r.days[key];
      let weakest = 3;
      for (const d of D) if (d.lead >= a && d.lead <= z && d.confidence in RANK) weakest = Math.min(weakest, RANK[d.confidence]);
      // beyond day 7 no day class exists: days 8-10 are at most medium, beyond day 10 pattern only
      if (z > 10) weakest = 0; else if (z >= 8) weakest = Math.min(weakest, 2);
      assert.ok(s.stamp.level in RANK, T(`H2: the stamp of ${s.id} has a known level: ${s.stamp.level}`));
      assert.ok(RANK[s.stamp.level] <= weakest, T(`H2: the stamp of ${s.id} ("${s.stamp.lead}") says ${s.stamp.level}, stronger than the weakest day class it covers (rank ${weakest})`));
    }
  }

  // ---- H4: the last beat before the end card ----
  const last = script.at(-2);
  assert.equal(last.chapter, 'sure', T(`H4: the last beat before the end card is the confidence chapter (${last.chapter})`));
  if (manifest.hasSd) {
    const sn = snaps.filter((s) => s.id === last.id);
    assert.ok(sn.some((s) => /disagree/i.test(s.legend)), T(`H4: the legend names the Confidence lens on the last beat: ${sn.map((s) => s.legend).join(' | ')}`));
    assert.ok(rec.maxT[last.id] >= manifest.last - 0.5, T(`H4: store.t reaches the run's last step ${manifest.last} on the last beat (max ${rec.maxT[last.id]})`));
  }

  // ---- H5 ----
  assert.ok(rec.frames.length > 0 && rec.frames.every((f) => f.doubt === true), T(`H5: store.overlays.doubt is true on every frame of every beat (${rec.frames.filter((f) => !f.doubt).length} frames with it off)`));
}

function judgePrivacy(r, assert, T) {
  // the person is on a card on screen
  assert.ok(r.rec.snaps.some((s) => s.text.includes(NAME) && s.id.startsWith('people')), T(`Privacy: the card shows the person's name on screen (a people beat names ${NAME})`));
  // and nowhere else
  const lc = (s) => String(s).toLowerCase();
  const leaks = (list) => list.filter((s) => lc(s).includes(TOKEN) || lc(decodeURIComponent(String(s).replace(/%(?![0-9a-f]{2})/gi, ''))).includes(TOKEN) || lc(s).includes(lc(encodeURIComponent(NAME))));
  assert.deepEqual(leaks(r.rec.net), [], T('Privacy: the name is in no fetch, XHR, beacon or socket made during the run'));
  assert.deepEqual(leaks(r.net), [], T('Privacy: the name is in no request URL in the resource log'));
  assert.deepEqual(leaks(r.rec.hashes), [], T('Privacy: the name is in no location.hash or history URL during the run'));
  const ls = r.ls.filter(([k, v]) => k !== r.pinsKey && (lc(k).includes(TOKEN) || lc(v).includes(TOKEN)));
  assert.deepEqual(ls.map(([k]) => k), [], T(`Privacy: no localStorage key other than the pins store (${r.pinsKey}) holds the name`));
  assert.deepEqual(r.ss.filter(([k, v]) => lc(k).includes(TOKEN) || lc(v).includes(TOKEN)).map(([k]) => k), [], T('Privacy: no sessionStorage entry holds the name'));
  assert.equal(r.rec.canvas, 0, T(`Privacy: no canvas export (toDataURL, toBlob, captureStream, convertToBlob) was made during the run (${r.rec.canvas})`));
}

function judgeArtifact(r, assert, T, origin) {
  const bad = r.net.filter((n) => new URL(n, origin).origin !== origin);
  assert.deepEqual(bad, [], T('Artifact: every request in the resource log is same-origin'));
  assert.deepEqual(r.rec.net.filter((u) => /^[a-z][a-z0-9+.-]*:/i.test(u.split(' ')[0]) && !u.startsWith(origin) && !/^(data|blob):/.test(u)), [], T('Artifact: every fetch or XHR made during the run is relative or same-origin'));
  assert.deepEqual(r.ext, [], T('Artifact: no request left the origin (every other host is blocked by the harness, none was attempted)'));
  assert.ok(r.net.length > 5, T(`Artifact: the resource log is not empty (${r.net.length})`));
  assert.deepEqual(r.errors, [], T(`Artifact: no console error or failed load, so nothing the briefing needed was blocked: ${JSON.stringify(r.errors)}`));
}

async function oneViewport(page, baseUrl, vp, assert, tag, opts) {
  // two plays: people, a near trip and a trip in days 11-15 (the script briefs one trip, the nearest); then people and only the far trip,
  // which is the broad-pattern trip beat
  for (const near of [true, false]) {
    const T = (s) => `${tag} ${vp.name}${near ? '' : ' far-trip-only'}: ${s}`;
    await READ.boot(page, baseUrl, vp);
    const r = await play(page, assert, T, { doubtOff: near, near });
    if (near) assert.equal(r.doubtBefore, false, T('the test switched the doubt overlay off before opening'));
    judge(r, assert, T, opts);
    if (near) assert.equal(r.doubtAfterClose, false, T('H5: the doubt overlay is false again after Close (the person had it off)'));
    else assert.equal(r.doubtAfterClose, true, T('H5: the doubt overlay is as the person left it (on) after Close'));
    if (!near) assert.ok(r.script.some((b) => b.chapter === 'trip' && b.place && r.rec.frames.some((f) => f.id === b.id && f.t > DETAIL_END_H)), T('the far trip is briefed as a broad-pattern trip beat past 168 h'));
    judgePrivacy(r, assert, T);
    judgeArtifact(r, assert, T, new URL(baseUrl).origin);
  }
}

/** A page per viewport on one browser, both at once; every failure is reported. */
async function bothViewports(brs, baseUrl, assert, tag, opts) {
  const pages = [];
  for (let i = 0; i < VPS.length; i++) pages.push(await brs[i].newPage());
  const res = await Promise.allSettled(VPS.map((vp, i) => oneViewport(pages[i], baseUrl, vp, assert, tag, opts)));
  const bad = res.filter((x) => x.status === 'rejected').map((x) => x.reason);
  if (bad.length) { const e = bad[0]; if (bad.length > 1) e.message = bad.map((x) => String(x && x.message || x).split('\n')[0]).join(' AND '); throw e; }
}

export async function run({ page, baseUrl, assert, fixture, dataDir }) {
  const tag = `[${fixture}]`;
  const caps = new Set();
  const live = false;
  // the fixture as it is (not live): its own page for the phone, a second browser for the desktop
  const br2 = await Browser.launch({ baseUrl });
  try {
    const desk = await br2.newPage();
    const res = await Promise.allSettled([
      oneViewport(page, baseUrl, VPS[0], assert, tag, { live, fixture, noSd: false, caps }),
      oneViewport(desk, baseUrl, VPS[1], assert, tag, { live, fixture, noSd: false, caps }),
    ]);
    const bad = res.filter((x) => x.status === 'rejected').map((x) => x.reason);
    if (bad.length) { const e = bad[0]; if (bad.length > 1) e.message = bad.map((x) => String(x && x.message || x).split('\n')[0]).join(' AND '); throw e; }
  } finally { await br2.close(); }
  if (fixture === 'synthetic-15d') {
    assert.ok(caps.size >= 2, `${tag} H1: at least two distinct caps were exercised on screen (${[...caps].join(', ')})`);
    // a live-like copy (the live-only words), then the same with z500sd removed
    const mk = (strip) => {
      const dir = path.join(artifactTmp('s-brief-honest-'), 'data');
      makeLiveLike(dir, dataDir);
      const mp = path.join(dir, 'manifest.json'), m = JSON.parse(fs.readFileSync(mp, 'utf8'));
      const runAt = new Date(Math.floor((Date.now() - 14 * 3600e3) / 3600e3) * 3600e3);
      m.run = runAt.toISOString().slice(0, 16) + 'Z';
      m.generated = new Date(runAt.getTime() + 9.5 * 3600e3).toISOString().slice(0, 16) + 'Z';
      if (strip) {
        delete m.fields.z500sd;
        for (const c of Object.values(m.cases || {})) if (Array.isArray(c.fields)) c.fields = c.fields.filter((f) => f !== 'z500sd');
      }
      fs.writeFileSync(mp, JSON.stringify(m));
      return dir;
    };
    for (const noSd of [false, true]) {
      const srv = await startServer({ dataDir: mk(noSd) });
      const brs = [await Browser.launch({ baseUrl: srv.baseUrl }), await Browser.launch({ baseUrl: srv.baseUrl })];
      try {
        await bothViewports(brs, srv.baseUrl, assert, `${tag} ${noSd ? 'live-like, no z500sd' : 'live-like'}`, { live: true, fixture, noSd, caps: new Set() });
      } finally { for (const b of brs) await b.close(); await srv.close(); }
    }
  }
}
