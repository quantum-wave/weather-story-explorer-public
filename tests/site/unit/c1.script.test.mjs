// C1-01: the Briefing's script builder and its honesty rules (H1-H8 as rewritten in CONCEPTS-REVIEW-2026-11-20.md).
// One test per acceptance line. The caps and clauses are proven on injected inputs (a signal-none day at lead 5, a 7 dam
// spread at lead 4, no z500sd, a trip in days 11-15), never on fixture luck; the fixtures prove gatherInput and the wiring
// of real day classes: synthetic-15d, its live-like copy (the patch of wp4.story.test.mjs), synthetic-15d-nomean, synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const site = new URL('../../../site/js/', import.meta.url);
const load = (p) => import(new URL(p, site).href);
const S = await load('story/index.js');
const P = await load('story/phrases.js');
const CF = await load('story/confidence.js');
const data = await load('data/index.js');
const gz = await load('pins/gazetteer.js');
const { store } = await load('state.js');
const { createPins } = await load('pins/index.js');
const B = await load('brief/script.js');
const C = await load('brief/copy.js');
const K = await load('brief/contract.js');
const fixtures = new URL('../fixtures/', import.meta.url).pathname;
const scriptSource = fs.readFileSync(new URL('brief/script.js', site), 'utf8');
gz.setData(JSON.parse(fs.readFileSync(new URL('../geo/cities.json', site), 'utf8')));

const HOUR = 3600e3, DAY = 24 * HOUR;

// ---------- inputs gathered from the real fixtures ----------

const shim = (dir, patch) => async (url) => {
  const f = path.join(dir, url.replace(/^data\//, ''));
  if (!fs.existsSync(f)) return { ok: false, status: 404 };
  const buf = fs.readFileSync(f);
  if (patch && url.endsWith('manifest.json')) { const m = patch(JSON.parse(buf.toString())); return { ok: true, status: 200, json: async () => m }; }
  return { ok: true, status: 200, json: async () => JSON.parse(buf.toString()), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
const liveLike = (run) => (m) => { m.sample = false; delete m.cases; delete m.sample_note; for (const f of Object.values(m.fields)) delete f.case; m.run = run; m.generated = run.replace('00:00Z', '09:30Z'); return m; };
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };
const NOW = Date.parse('2026-11-17T14:00:00Z');

async function gather(name, { patch = null, friend = null, people = true, trip = true } = {}) {
  data._reset({ fetch: shim(path.join(fixtures, name), patch) });
  store.set({ case: 'A', focus: friend ? { lat: friend.lat, lon: friend.lon, label: friend.label, kind: 'place', placeRef: null } : null });
  const manifest = await data.loadManifest();
  const pins = createPins({ storage: mem(), today: () => '2026-11-17' });
  if (people) for (const q of ['Maya in Portland', 'Sam in Boston', 'Lee in Lisbon']) await pins.quickAdd(q);
  if (trip) await pins.quickAdd('Trip to Denver Nov 25 to Nov 28');
  const app = { data, story: S, pins, store, manifest, now: () => NOW, friend: { active: () => !!friend } };
  const input = await B.gatherInput(app);
  input.zone = 'UTC';
  return input;
}
const IN = {
  sample15: await gather('synthetic-15d'),
  live15: await gather('synthetic-15d', { patch: liveLike('2026-11-17T00:00Z') }),
  nomean: await gather('synthetic-15d-nomean'),
  small: await gather('synthetic'),
  bare: await gather('synthetic-15d', { patch: liveLike('2026-11-17T00:00Z'), people: false, trip: false }),
  noMsl: await gather('synthetic-15d', { patch: (m) => { const x = liveLike('2026-11-17T00:00Z')(m); delete x.fields.msl; return x; } }),
};
const FRIEND = { lat: 48.86, lon: 2.35, label: 'Paris, France' };
IN.recorded = await gather('recorded', { patch: liveLike('2026-11-17T00:00Z') });
IN.friend = await gather('synthetic-15d', { patch: liveLike('2026-11-17T00:00Z'), friend: FRIEND });

// ---------- injected inputs ----------

const ORIGIN = Date.parse('2026-11-17T00:00:00Z');
const STEPS = Array.from({ length: 61 }, (_, i) => 6 * i);
const per6 = (perDay, steps = STEPS) => ({ steps: steps.slice(), values: Float32Array.from(steps, (s) => perDay[Math.min(14, Math.floor(s / 24))] ?? 0) });
const rain6 = (perDay) => { const steps = STEPS.filter((s) => s > 0); return { steps, values: Float32Array.from(steps, (s) => (perDay[Math.min(14, Math.floor((s - 0.001) / 24))] ?? 0) / 4) }; };
const manifestOf = ({ live = true, spread = true, mean = true } = {}) => ({
  schema: 1, sample: !live, model: 'ECMWF', run: '2026-11-17T00:00Z', generated: '2026-11-17T09:30Z',
  fields: {
    z500a: { steps: STEPS }, ...(spread ? { z500sd: { steps: STEPS } } : {}), ...(mean ? { z500em: { steps: STEPS.filter((s) => s >= 144) } } : {}),
    tp6: { steps: STEPS.filter((s) => s > 0) }, msl: { steps: STEPS },
  },
});
const flat = (v) => Array(15).fill(v);
function daysOf({ z = flat(0), sd = flat(20), wet = flat(0), spread = true, nowH = 2, manifest }) {
  const series = { windows: [], z500a: per6(z), z500sd: spread ? per6(sd) : null, tp6: rain6(wet), t850a: null, t2m: null, pr1: null, pr10: null, ws250max: null };
  return S.daysFromSeries(series, { originMs: ORIGIN, fromMs: ORIGIN, toMs: ORIGIN + 14 * DAY, anchorMs: ORIGIN, offsetMin: 0, nowMs: ORIGIN + nowH * HOUR, manifest });
}
const sampleOf = ({ z = flat(0), sd = flat(20), spread = true }) => ({ steps: STEPS.slice(), anomDam: per6(z).values.map((v) => v / 10), spreadDam: spread ? Array.from(per6(sd).values, (v) => v / 10) : null });
const HOME = { key: 'home', kind: 'home', name: 'San Francisco', city: 'San Francisco', lat: 37.77, lon: -122.42 };
const mkPlace = (key, name, city, lat, lon, kind = 'person') => ({ key, kind, name, city, lat, lon });

function inject({ live = true, spread = true, mean = true, nowH = 2, home = HOME, lensOk = () => true, trips = [], pins = [], notab = {}, extra = {}, friendPlace = null, hdr = {}, ...series } = {}) {
  const manifest = manifestOf({ live, spread, mean });
  const o = { ...series, spread, nowH, manifest };
  const input = {
    manifest, dataLabel: live ? 'ECMWF run Tue 17 Nov, 12 am UTC' : 'Recorded · 17 Nov · not live', live, nowMs: ORIGIN + nowH * HOUR, nowH, hasMean: mean, zone: 'UTC',
    home, trips, pins, friendPlace, days: { [home.key]: daysOf(o) }, sample: { [home.key]: sampleOf(o) }, notabilityOf: (k) => ({ score: notab[k] ?? 0, reason: '' }), lensOk,
    ...hdr,
  };
  for (const [key, x] of Object.entries(extra)) { input.days[key] = daysOf({ ...o, ...x, manifest }); input.sample[key] = sampleOf({ spread, ...x }); }
  return input;
}
const beatOf = (script, id) => script.beats.find((b) => b.id === id);
const chapters = (script) => script.beats.map((b) => b.chapter);
const subset = (days, from, to) => Object.assign(days.filter((c) => c.lead >= from && c.lead <= to), { coverage: days.coverage });

// ---------- acceptance: pure, synchronous, deterministic ----------

test('buildScript is pure and synchronous: the same input gives a deep-equal Script, and the input is not changed', () => {
  const input = inject({ z: [0, 0, -80, -80, -80, -80, -80, ...flat(0).slice(7)], wet: [0, 0, 10, 10, 10, 0, 0, ...flat(0).slice(7)] });
  const before = JSON.stringify([input.sample, input.dataLabel, input.nowH, input.home]);
  const a = B.buildScript(input), b = B.buildScript(input);
  assert.ok(!(a instanceof Promise), 'synchronous');
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify([input.sample, input.dataLabel, input.nowH, input.home]), before);
  for (const k of Object.keys(IN)) assert.deepEqual(B.buildScript(IN[k]), B.buildScript(IN[k]), k);
});

test('only gatherInput touches the data facade: buildScript and its helpers read no clock, store, DOM or random source', () => {
  const cut = scriptSource.indexOf('// ---------- gathering the input from the app');
  assert.ok(cut > 0);
  const pure = scriptSource.slice(0, cut).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  for (const bad of [/Date\.now/, /Math\.random/, /\bdocument\b/, /\bwindow\b/, /\bstore\b/, /\bdata\./, /\blocalStorage/, /\bfetch\(/, /dayLine\(/, /new Date\(\)/]) assert.doesNotMatch(pure, bad, String(bad));
  assert.match(scriptSource.slice(cut), /export async function gatherInput\(app\)/);
  // the data facade is reached only through the app argument, never imported
  assert.doesNotMatch(scriptSource, /from '\.\.\/data\/index\.js'/);
  assert.doesNotMatch(scriptSource, /from '\.\.\/story\/index\.js'/);
});

test('gatherInput returns the plain input from each fixture: days per place, a sample per place, lens availability', () => {
  for (const [k, input] of Object.entries(IN)) {
    assert.ok(input.manifest?.run, k);
    assert.equal(typeof input.nowH, 'number'); assert.ok(input.nowH >= 0, k);
    assert.ok(input.days.home?.length > 0 || k === 'friend', k);
    const key = input.friendPlace ? input.friendPlace.key : 'home';
    assert.ok(input.days[key].length >= 1, k);
    assert.equal(input.sample[key].steps.length, input.sample[key].anomDam.length, k);
    assert.equal(typeof input.lensOk('z'), 'boolean');
    assert.equal(typeof input.notabilityOf('pin:x').score, 'number');
  }
  assert.equal(IN.live15.live, true); assert.equal(IN.sample15.live, false);
  assert.ok(IN.live15.nowH > 0, 'a live-like run anchors the story at now');
  assert.equal(IN.sample15.nowH, 0, 'a recorded or sample run anchors the story at its origin');
  assert.equal(IN.nomean.hasMean, false); assert.equal(IN.sample15.hasMean, true);
  assert.equal(IN.nomean.sample.home.spreadDam !== null, true, 'synthetic-15d-nomean has z500sd');
  assert.equal(IN.sample15.dataLabel, 'Sample · 17 Nov · not live');
  assert.match(IN.live15.dataLabel, /^Synthetic test fixture \(15-day\) run /);
});

// ---------- acceptance: chapter order, people, clock hour ----------

test('chapter order is title, picture, home, [trip], [people], sure, end with one title and one end; picture beats come before home', () => {
  for (const k of ['sample15', 'live15', 'nomean']) {
    const s = B.buildScript(IN[k]);
    const ch = chapters(s);
    assert.equal(ch[0], 'title'); assert.equal(ch.at(-1), 'end'); assert.equal(ch.at(-2), 'sure');
    assert.equal(ch.filter((c) => c === 'title').length, 1); assert.equal(ch.filter((c) => c === 'end').length, 1);
    const order = ['title', 'picture', 'home', 'trip', 'people', 'sure', 'end'];
    const idx = ch.map((c) => order.indexOf(c));
    assert.deepEqual(idx, idx.slice().sort((a, b) => a - b), `${k}: ${ch.join(',')}`);
    assert.ok(ch.includes('trip'), k); assert.equal(ch.filter((c) => c === 'people').length, 3, k);
  }
});

test('people: the highest notability scores at or above the floor, ties by name; morePeople counts the ones left out', () => {
  const pins = [['a', 'Zed', 2], ['b', 'Ana', 2.5], ['c', 'Bo', 2.5], ['d', 'Cy', 1], ['e', 'Di', 0.99], ['f', 'Eve', 1.7]]
    .map(([k, name]) => mkPlace(`pin:${k}`, name, 'Portland', 45.52, -122.68));
  const notab = Object.fromEntries([['a', 2], ['b', 2.5], ['c', 2.5], ['d', 1], ['e', 0.99], ['f', 1.7]].map(([k, v]) => [`pin:${k}`, v]));
  const extra = Object.fromEntries(pins.map((p) => [p.key, { wet: [0, 4, ...flat(0).slice(2)] }]));
  const s = B.buildScript(inject({ pins, notab, extra }));
  const ppl = s.beats.filter((b) => b.chapter === 'people');
  assert.deepEqual(ppl.map((b) => b.place.name), ['Ana', 'Bo', 'Zed'], 'scores 2.5, 2.5 (tie by name), then 2 before 1.7');
  assert.equal(K.MAX_PEOPLE, 3);
  assert.equal(s.morePeople, 2, 'Eve (1.7) and Cy (1, at the floor) are left out; Di (0.99) is below the floor');
  assert.equal(B.buildScript(inject({ pins: pins.slice(4), notab, extra })).beats.filter((b) => b.chapter === 'people').length, 1, 'Di is below the floor, Eve is above');
  assert.equal(B.buildScript(inject({ pins: [pins[4]], notab, extra })).beats.some((b) => b.chapter === 'people'), false);
  assert.equal(ppl[0].title, 'Ana · Portland');
});

test('a person is held at the first of days 1-7 with rain of light or more, else the day of largest |anomaly|', () => {
  const wetP = mkPlace('pin:w', 'Wen', 'Portland', 45.52, -122.68), dryP = mkPlace('pin:d', 'Dee', 'Boston', 42.36, -71.06), anoP = mkPlace('pin:n', 'Nia', 'Denver', 39.74, -104.98);
  const extra = {
    'pin:w': { wet: [0, 0, 0, 3, 10, 0, 0, ...flat(0).slice(7)] }, // first light rain: day 4 (index 3), window [72, 96], noon 84
    'pin:d': { z: [0, 10, -20, 30, -90, 20, 0, ...flat(0).slice(7)], wet: flat(0) }, // largest |anomaly| -9 dam on day 5, window [96, 120], noon 108
    'pin:n': { z: flat(0), wet: flat(0) },
  };
  const s = B.buildScript(inject({ pins: [wetP, dryP, anoP], notab: { 'pin:w': 3, 'pin:d': 2, 'pin:n': 1.5 }, extra }));
  const by = Object.fromEntries(s.beats.filter((b) => b.chapter === 'people').map((b) => [b.place.name, b]));
  assert.deepEqual([by.Wen.t0, by.Wen.t1], [84, 84]);
  assert.deepEqual([by.Dee.t0, by.Dee.t1], [108, 108]);
  assert.equal(by.Nia.t0, by.Nia.t1, 'a held frame');
  assert.ok(by.Nia.t0 >= 0 && by.Nia.t0 <= 12, 'no rain, no anomaly: the first day');
});

// ---------- acceptance: the hook ----------

const TROUGH = [0, 0, -80, -80, -80, -80, -80, ...flat(0).slice(7)];
test('hook: a headline day makes the picture three beats, hold, rewind (t1 < t0, camera null), forward', () => {
  const s = B.buildScript(inject({ z: TROUGH }));
  const pic = s.beats.filter((b) => b.chapter === 'picture');
  assert.deepEqual(pic.map((b) => b.hook), ['hold', 'rewind', 'forward']);
  const [hold, rewind, fwd] = pic;
  assert.equal(hold.t0, hold.t1); assert.equal(hold.t0, 36, 'day 2 is the first day of the approaching trough; its noon is hour 36');
  assert.ok(hold.t0 <= K.DETAIL_END_H);
  assert.equal(rewind.camera, null); assert.equal(rewind.t0, 36); assert.equal(rewind.t1, 2); assert.ok(rewind.t1 < rewind.t0);
  assert.equal(fwd.t0, 2); assert.equal(fwd.t1, 168); assert.equal(fwd.camera, null);
  assert.equal(hold.lens, 'z'); assert.equal(hold.view, 'np'); assert.ok(hold.camera && hold.camera.lat === HOME.lat);
  assert.equal(rewind.view, 'nh'); assert.equal(fwd.view, 'nh');
  assert.equal(rewind.lines[0], C.REWIND_LIVE);
  assert.equal(fwd.lines[0], C.teaching('San Francisco'));
});

test('hook: the held hour is the step nearest the local day’s noon and never past 168', () => {
  // a trough that only arrives on day 7 (index 6, window [144, 168], noon 156); and one on day 8 gives no hook (beyond days 2-7)
  const late = B.buildScript(inject({ z: [...flat(0).slice(0, 6), -80, -80, -80, ...flat(0).slice(9)] }));
  const hold = beatOf(late, 'picture-hold');
  assert.ok(hold); assert.ok(hold.t0 <= 168); assert.equal(hold.t0 % 6, 0);
  const eight = B.buildScript(inject({ z: [...flat(0).slice(0, 7), -80, -80, ...flat(0).slice(9)] }));
  assert.ok(beatOf(eight, 'picture-hold') === undefined || beatOf(eight, 'picture-hold').t0 <= 168);
  // origin 00Z, a place whose day windows are shifted: noon falls between steps, the nearer one wins
  const shifted = inject({ z: TROUGH });
  const d = shifted.days.home;
  d.windows.forEach((w, i) => { w.startH = 24 * i - 5; w.endH = 24 * i + 19; }); // noon at 24i + 7: nearest step 24i + 6
  assert.equal(beatOf(B.buildScript(shifted), 'picture-hold').t0, 30);
});

test('hook: no headline day gives one picture beat, view nh, now to 168, no hook', () => {
  for (const z of [flat(0), [-80, ...flat(0).slice(1)]]) { // a trough on day 1 only is not a headline day (days 2-7)
    const s = B.buildScript(inject({ z }));
    const pic = s.beats.filter((b) => b.chapter === 'picture');
    assert.equal(pic.length, 1); assert.equal(pic[0].view, 'nh'); assert.equal(pic[0].camera, null);
    assert.equal(pic[0].t0, 2); assert.equal(pic[0].t1, 168); assert.equal(pic[0].hook, undefined);
    assert.equal(pic[0].lines[0], C.teaching('San Francisco'));
  }
  // not a headline: no clear signal (spread above the anomaly) or timing uncertain (low confidence)
  assert.equal(B.buildScript(inject({ z: flat(-100), sd: flat(110) })).beats.filter((b) => b.chapter === 'picture').length, 1, 'no clear signal');
  assert.equal(B.buildScript(inject({ z: flat(-100), sd: flat(70) })).beats.filter((b) => b.chapter === 'picture').length, 1, 'low confidence');
  assert.equal(B.buildScript(inject({ z: flat(-100), sd: flat(40) })).beats.filter((b) => b.chapter === 'picture').length, 3, 'medium confidence still earns the hook');
});

// ---------- acceptance: home and rain ----------

test('home is two beats (days 1-3, days 4-7) with strip, the summary sentence and their own stamp; rain follows only for a wet day and lens s', () => {
  const input = inject({ z: flat(0), wet: [0, 0, 10, 0, 0, 0, 0, ...flat(0).slice(7)] });
  const s = B.buildScript(input);
  const home = s.beats.filter((b) => b.chapter === 'home');
  assert.deepEqual(home.map((b) => b.id), ['home-near', 'home-later', 'home-rain']);
  const days = input.days.home;
  const [near, later, rain] = home;
  assert.equal(near.strip, true); assert.equal(later.strip, true);
  assert.deepEqual(near.lines, [S.summarize(subset(days, 1, 3), { sample: false })]);
  assert.deepEqual(later.lines, [S.summarize(subset(days, 4, 7), { sample: false })]);
  assert.deepEqual([near.t0, near.t1], [2, 72]); assert.deepEqual([later.t0, later.t1], [72, 168]);
  assert.deepEqual(near.sure.days, [1, 3]); assert.deepEqual(later.sure.days, [4, 7]);
  assert.equal(rain.lens, 's'); assert.equal(rain.strip, false);
  assert.deepEqual([rain.t0, rain.t1], [48, 72], 'day 3 is the wet day, and its local day is hours 48 to 72');
  assert.deepEqual(rain.lines, [P.reasonPhrase(days), P.PATTERN_LINE[days[2].pattern] + '.']);
  assert.equal(B.buildScript(inject({ z: flat(0), wet: flat(0) })).beats.some((b) => b.id === 'home-rain'), false, 'no wet day, no rain beat');
  assert.equal(B.buildScript(inject({ z: flat(0), wet: [0, 0, 10, ...flat(0).slice(3)], lensOk: (c) => c !== 's' })).beats.some((b) => b.id === 'home-rain'), false, 'lens s unavailable');
});

test('rain beat: a pattern line that does not go with the rain (a ridge with heavy rain) is left off, as the day line does', () => {
  const input = inject({ z: flat(80), wet: [30, ...flat(0).slice(1)], nowH: 0 });
  const rain = beatOf(B.buildScript(input), 'home-rain');
  assert.ok(rain);
  assert.equal(input.days.home[0].pattern, 'ridge'); assert.equal(input.days.home[0].wet, 'heavy');
  assert.deepEqual(rain.lines, [P.reasonPhrase(input.days.home)]);
});

// ---------- H1: zoom is earned ----------

const camBeats = (s) => s.beats.filter((b) => b.camera);
test('H1 signal none at lead 5: the beat covering it has zoom 1, signal none and the no-clear-signal stamp', () => {
  const sd = flat(20); sd[4] = 50;
  const z = flat(0); z[4] = 20; // 2 dam against 5 dam of spread: the mean shrank toward zero
  const input = inject({ z, sd });
  assert.equal(input.days.home[4].signal, 'none');
  const later = beatOf(B.buildScript(input), 'home-later');
  assert.equal(later.sure.signal, 'none'); assert.equal(later.camera.zoom, 1); assert.equal(later.sure.phrase, CF.NO_CLEAR_SIGNAL);
  assert.ok(['low', 'pattern-only', 'none'].includes(later.sure.level), 'a no-signal beat never claims better than low');
  const near = beatOf(B.buildScript(input), 'home-near');
  assert.equal(near.sure.signal, 'clear'); assert.ok(near.camera.zoom > 1, 'days 1-3 do not cover day 5');
});

test('H1 spread 7 dam at lead 4: the weakest reading rules the whole beat (low, zoom 1.4) even when later days are tight', () => {
  const sd = flat(20); sd[3] = 70;
  const z = flat(0); z[3] = -100;
  const input = inject({ z, sd });
  input.sample.home.spreadDam[12] = 2; // hour 72 is the first frame of day 4; the weak steps are the later ones of that day
  const s = B.buildScript(input);
  const later = beatOf(s, 'home-later');
  assert.equal(later.sure.level, 'low'); assert.equal(later.camera.zoom, K.ZOOM_CAP.low); assert.equal(K.ZOOM_CAP.low, 1.4);
  assert.equal(later.sure.signal, 'clear'); assert.equal(later.sure.phrase, CF.CONFIDENCE_WORDS.low);
  const near = beatOf(s, 'home-near');
  assert.equal(near.sure.level, 'high'); assert.equal(near.camera.zoom, K.ZOOM_CAP.high);
});

test('H1 no z500sd at all: the level comes from lead time alone (source lead) and the zoom is capped at LEAD_ONLY_CAP', () => {
  const input = inject({ spread: false });
  assert.equal(input.sample.home.spreadDam, null);
  const s = B.buildScript(input);
  const near = beatOf(s, 'home-near');
  assert.equal(near.sure.source, 'lead'); assert.equal(near.sure.level, 'high');
  assert.equal(near.camera.zoom, K.LEAD_ONLY_CAP); assert.equal(K.LEAD_ONLY_CAP, 2);
  for (const b of camBeats(s)) assert.ok(b.camera.zoom <= K.LEAD_ONLY_CAP, b.id);
});

test('H1 a trip in days 11-15: zoom 1 and a pattern-only stamp, whatever the spread says', () => {
  const trip = { key: 'trip:t', kind: 'trip', label: 'Denver', name: 'Denver', city: 'Denver', lat: 39.74, lon: -104.98, start: '2026-11-27', end: '2026-11-30' };
  const input = inject({ trips: [trip], extra: { 'trip:t': {} }, sd: flat(10) });
  const t = beatOf(B.buildScript(input), 'trip');
  assert.ok(t);
  assert.equal(t.camera.zoom, 1); assert.equal(t.sure.level, 'pattern-only'); assert.ok(t.t0 > K.DETAIL_END_H);
});

test('H1 a beat past 168 or at pattern-only never zooms; every camera is within ZOOM_CAP of its own level on every fixture and injection', () => {
  const scripts = [...Object.values(IN).map((i) => B.buildScript(i)), B.buildScript(inject({ z: TROUGH })), B.buildScript(inject({ spread: false })), B.buildScript(inject({ sd: flat(40) }))];
  let n = 0;
  for (const s of scripts) for (const b of camBeats(s)) {
    n++;
    assert.ok(b.camera.zoom <= K.ZOOM_CAP[b.sure.level], `${b.id} zoom ${b.camera.zoom} level ${b.sure.level}`);
    if (b.t0 > 168 || b.t1 > 168 || b.sure.signal === 'none' || ['pattern-only', 'none'].includes(b.sure.level)) assert.equal(b.camera.zoom, 1, b.id);
    if (b.sure.source === 'lead') assert.ok(b.camera.zoom <= K.LEAD_ONLY_CAP, b.id);
  }
  assert.ok(n > 30);
  const caps = new Set(scripts.flatMap((s) => camBeats(s).map((b) => b.camera.zoom)));
  assert.ok(caps.size >= 3, `distinct zooms seen: ${[...caps]}`);
});

test('H1 the level is the weakest over the beat: the same input with one weak step inside the beat lowers the stamp', () => {
  const base = inject({});
  const s0 = beatOf(B.buildScript(base), 'home-near');
  const weak = inject({});
  weak.sample.home.spreadDam[4] = 7; // one 6-hourly step (hour 24) with 7 dam of spread, against a 12 dam anomaly: clear signal, weak timing
  weak.sample.home.anomDam[4] = 12;
  const s1 = beatOf(B.buildScript(weak), 'home-near');
  assert.equal(s0.sure.level, 'high'); assert.equal(s1.sure.level, 'low'); assert.equal(s1.camera.zoom, 1.4);
});

// ---------- H2: the stamp ----------

test('H2 every beat except title and end has sure with days, zone and caption; the phrase is empty off live data and words on live data', () => {
  for (const [k, input] of Object.entries(IN)) {
    const s = B.buildScript(input);
    for (const b of s.beats) {
      if (b.chapter === 'title' || b.chapter === 'end') { assert.equal(b.sure, null, `${k} ${b.id}`); continue; }
      assert.ok(b.sure, `${k} ${b.id}`);
      assert.equal(b.sure.days.length, 2); assert.ok(b.sure.days[0] >= 1 && b.sure.days[1] >= b.sure.days[0], `${k} ${b.id} days ${b.sure.days}`);
      assert.ok(['hres', 'blend', 'mean', 'hres-late'].includes(b.sure.zone), `${k} ${b.id}`);
      assert.equal(b.sure.caption, CF.CAPTIONS[b.sure.zone]);
      if (!input.live) assert.equal(b.sure.phrase, '', `${k} ${b.id}`);
      else assert.equal(b.sure.phrase, b.sure.signal === 'none' ? CF.NO_CLEAR_SIGNAL : CF.CONFIDENCE_WORDS[b.sure.level], `${k} ${b.id}`);
    }
  }
  const live = B.buildScript(inject({}));
  assert.equal(beatOf(live, 'home-near').sure.phrase, 'confident');
  assert.equal(B.buildScript(inject({ live: false })).beats.filter((b) => b.sure).every((b) => b.sure.phrase === ''), true);
  assert.ok(B.buildScript(inject({ live: false })).beats.filter((b) => b.sure).some((b) => b.camera && b.camera.zoom > 1), 'zoom caps still apply, they do not vanish with the words');
});

test('H2 on a live input where a day past day 3 is wet and the spread is under 3 dam, the beat covering it is at most medium', () => {
  const input = inject({ z: flat(0), sd: flat(20), wet: [0, 0, 0, 0, 10, 0, 0, ...flat(0).slice(7)] });
  const d5 = input.days.home[4];
  assert.equal(d5.wet, 'moderate');
  d5.confidence = 'high'; // a class handed to the builder at full strength
  const later = beatOf(B.buildScript(input), 'home-later');
  assert.ok(['medium', 'low', 'pattern-only'].includes(later.sure.level), later.sure.level);
  assert.equal(later.sure.phrase, 'fairly sure of the timing');
  assert.ok(later.camera.zoom <= K.ZOOM_CAP.medium);
  // the real classifier already downgrades it
  const real = inject({ z: flat(0), sd: flat(20), wet: [0, 0, 0, 0, 10, ...flat(0).slice(5)] });
  assert.equal(real.days.home[4].confidence, 'medium');
});

test('H2 a line that names a day past 7 (a wet spell running on) is stamped by that day’s confidence too', () => {
  const sd = flat(20); sd[8] = 70; // day 9: 7 dam of spread
  const z = flat(0); z[8] = -100;
  const input = inject({ z, sd, wet: [0, 0, 0, 0, 0, 10, 10, 10, 10, 0, ...flat(0).slice(10)] });
  assert.ok(input.days.home[8].wet === 'moderate' && input.days.home[8].lead === 9, 'the wet spell runs on to day 9');
  const rain = beatOf(B.buildScript(input), 'home-rain');
  assert.equal(rain.sure.level, 'low'); assert.equal(rain.camera.zoom, 1.4);
});

// ---------- H3 ----------

const dayLevelLines = (input) => {
  const out = new Set();
  const keys = Object.keys(input.days);
  for (const k of keys) {
    const d = input.days[k];
    out.add(P.reasonPhrase(d)); out.add(S.summarize(subset(d, 1, 3), { sample: !input.live })); out.add(S.summarize(subset(d, 4, 7), { sample: !input.live }));
  }
  for (const v of Object.values(P.PATTERN_LINE)) out.add(v + '.');
  for (const t of input.trips || []) {
    const cov = input.days.home.coverage;
    const c2 = { ...cov, todayDate: cov.todayDate || cov.firstDate };
    if (P.tripState(t, c2, input.nowMs) === 'detail') out.add(P.tripLine(t, input.days[t.key], c2, { state: 'detail', now: input.nowMs, sample: !input.live }));
  }
  out.delete('');
  return out;
};
const RAINISH = /rain likely|rain possible|heavy rain|light rain|\bdry\b|°/i;

test('H3 a beat with a day-level sentence plays inside [first step, 168]; a beat past 168 carries none of the rain, dry or degree words', () => {
  let withSentence = 0, past = 0;
  for (const [k, input] of Object.entries(IN)) {
    const s = B.buildScript(input);
    const dl = dayLevelLines(input);
    const first = Math.min(...input.manifest.fields.z500a.steps);
    for (const b of s.beats) {
      if (b.lines.some((l) => dl.has(l))) { withSentence++; assert.ok(b.t0 >= first && b.t0 <= 168 && b.t1 >= first && b.t1 <= 168, `${k} ${b.id} ${b.t0}-${b.t1}`); }
      if (b.t0 > 168 || b.t1 > 168) { past++; for (const l of b.lines) assert.doesNotMatch(l, RAINISH, `${k} ${b.id}: ${l}`); }
    }
  }
  assert.ok(withSentence >= 10 && past >= 4, `${withSentence} beats with a sentence, ${past} beats past 168`);
  // and a planted failure: a past-168 beat with a day-level line would be caught by the same regex
  assert.match('Rain likely from Sunday', RAINISH);
});

test('H3 a trip wholly in days 8-15: on a live-like input the broad line begins Too early for details and zoom is 1; on the raw sample it begins Beyond this sample', () => {
  const live = beatOf(B.buildScript(IN.live15), 'trip');
  assert.match(live.lines[0], /^Too early for details/); assert.equal(live.camera.zoom, 1);
  assert.ok(live.t0 > 168 || live.t1 > 168);
  const raw = beatOf(B.buildScript(IN.sample15), 'trip');
  assert.match(raw.lines[0], /^Beyond this sample/); assert.equal(raw.camera.zoom, 1);
  const inj = beatOf(B.buildScript(inject({ trips: [{ key: 'trip:t', kind: 'trip', label: 'Denver', name: 'Denver', city: 'Denver', lat: 39.74, lon: -104.98, start: '2026-11-25', end: '2026-11-28' }], extra: { 'trip:t': {} } })), 'trip');
  assert.match(inj.lines[0], /^Too early for details/); assert.equal(inj.camera.zoom, 1);
});

test('H3 a trip in days 1-7 is a detail beat: its sentence plays no further than 168, even for a trip that runs on into days 8-10', () => {
  const trip = { key: 'trip:t', kind: 'trip', label: 'Reno', name: 'Reno', city: 'Reno', lat: 39.53, lon: -119.81, start: '2026-11-21', end: '2026-11-26' };
  const input = inject({ trips: [trip], extra: { 'trip:t': { wet: [0, 0, 0, 0, 10, 10, 10, 10, 10, ...flat(0).slice(9)] } } });
  const t = beatOf(B.buildScript(input), 'trip');
  assert.ok(t.t1 <= 168 && t.t0 <= 168);
  assert.ok(t.lines.length === 1 && t.lines[0].length > 0);
  assert.doesNotMatch(t.lines[0], /^Too early/);
});

// ---------- H4 ----------

test('H4 with z500sd and lens c the beat before end is the confidence chapter: lens c, nh, camera null, the whole run, zone captions string for string', () => {
  for (const [k, input] of Object.entries(IN)) {
    const s = B.buildScript(input);
    const b = s.beats.at(-2);
    assert.equal(b.chapter, 'sure', k); assert.equal(b.lens, 'c', k); assert.equal(b.view, 'nh', k); assert.equal(b.camera, null, k);
    const st = input.manifest.fields.z500a.steps;
    assert.equal(b.t0, st[0], k); assert.equal(b.t1, st.at(-1), k);
    assert.deepEqual(b.zoneCaptions.map((z) => z.caption), CF.zones(st.at(-1), { hasMean: input.hasMean }).map((z) => z.caption), k);
    assert.deepEqual(b.zoneCaptions.map((z) => z.from), CF.zones(st.at(-1), { hasMean: input.hasMean }).map((z) => z.from), k);
  }
  assert.equal(B.buildScript(IN.sample15).beats.at(-2).zoneCaptions.length, 3);
  assert.equal(B.buildScript(IN.nomean).beats.at(-2).zoneCaptions.length, 2);
  assert.equal(B.buildScript(IN.small).beats.at(-2).zoneCaptions.length, 1, 'a 48-hour run has only the first zone');
});

test('H4 without z500sd, or without lens c, the chapter is a held beat on lens z that says there is no ensemble spread and days past 7 are one forecast', () => {
  const noSd = B.buildScript(inject({ spread: false }));
  const b = noSd.beats.at(-2);
  assert.equal(b.chapter, 'sure'); assert.equal(b.lens, 'z'); assert.equal(b.t0, b.t1); assert.equal(b.camera, null); assert.equal(b.lines.length, 1);
  assert.match(b.lines[0], /no ensemble spread/); assert.match(b.lines[0], /days past 7 are one forecast/); assert.equal(b.lines[0], C.NO_SPREAD_LINE);
  const noLens = B.buildScript(inject({ lensOk: (c) => c !== 'c' })).beats.at(-2);
  assert.equal(noLens.chapter, 'sure'); assert.equal(noLens.lens, 'z'); assert.equal(noLens.t0, noLens.t1);
  assert.equal(B.buildScript(IN.noMsl).beats.at(-2).lens, 'c', 'a run without msl still has its spread map');
});

// ---------- H6 and H8 sources ----------

test('H6 every beat’s kicker carries the data label when the data is not live', () => {
  for (const k of ['sample15', 'nomean', 'small']) for (const b of B.buildScript(IN[k]).beats) assert.ok(b.kicker.includes(IN[k].dataLabel), `${k} ${b.id}: ${b.kicker}`);
  const rec = B.buildScript(inject({ live: false }));
  for (const b of rec.beats) assert.ok(b.kicker.includes('Recorded · 17 Nov · not live'), b.id);
  assert.equal(rec.sample, true); assert.equal(rec.dataLabel, 'Recorded · 17 Nov · not live');
  const live = B.buildScript(inject({}));
  assert.equal(live.sample, false);
  for (const b of live.beats.filter((x) => x.chapter !== 'title')) assert.ok(!b.kicker.includes('ECMWF'), 'on live data only the title beat names the run');
  assert.match(live.beats[0].kicker, /ECMWF run/);
});

test('freshness: a stale live run puts the app’s own age line on the title; the end card promises the next update only when fresh', () => {
  const fresh = B.buildScript(inject({}));
  assert.ok(fresh.beats.at(-1).lines.includes(C.nextUpdate('9 pm')), 'generated 09:30Z plus 12 h, shown in UTC');
  const old = inject({ nowH: 30 });
  old.nowMs = ORIGIN + 30 * HOUR;
  const s = B.buildScript(old);
  assert.equal(s.beats[0].kicker, P.EMPTY.stale(30));
  assert.equal(s.beats.at(-1).lines.some((l) => /Next update/.test(l)), false);
  assert.equal(B.buildScript(inject({ live: false })).beats.at(-1).lines.some((l) => /Next update/.test(l)), false);
});

// ---------- H7: where every line comes from ----------

const copyLines = () => {
  const out = new Set();
  const walk = (v) => { if (typeof v === 'string') out.add(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  for (const [k, v] of Object.entries(C)) if (typeof v !== 'function' && k !== 'SHOW_SENTENCES') walk(v);
  return out;
};
test('H7 every line is the briefing’s own copy or byte-equal to a phrases or confidence output; dayLine is never used', () => {
  const own = copyLines();
  const fromCopy = (l, input) => own.has(l) || l === C.teaching(input.home.city) || (input.friendPlace && l === C.teaching(input.friendPlace.city)) || l === C.moreInPeople(Number(l.split(' ')[0])) && /^\d+ more in People$/.test(l) || /^Next update usually about \d+ [ap]m\.$/.test(l);
  let sentences = 0, copies = 0;
  for (const [k, input] of Object.entries({ ...IN, injected: inject({ z: TROUGH, wet: [0, 0, 10, 10, 0, 0, 0, ...flat(0).slice(7)] }) })) {
    const dl = dayLevelLines(input);
    // a broad tripLine is also a phrases output
    for (const t of input.trips || []) { const cov = input.days.home.coverage; const c2 = { ...cov, todayDate: cov.todayDate || cov.firstDate }; const st = P.tripState(t, c2, input.nowMs); if (st === 'broad') dl.add(P.tripLine(t, input.days[t.key], c2, { state: 'broad', now: input.nowMs, sample: !input.live })); }
    for (const b of B.buildScript(input).beats) for (const l of b.lines) {
      if (dl.has(l)) sentences++; else { copies++; assert.ok(fromCopy(l, input), `${k} ${b.id}: ${l}`); }
    }
  }
  assert.ok(sentences > 20 && copies > 10, `${sentences} sentences, ${copies} copy lines`);
  assert.doesNotMatch(scriptSource, /dayLine\(/);
  assert.doesNotMatch(scriptSource, /P\.dayLine|S\.dayLine/);
});

test('H7 with SHOW_SENTENCES false no beat has a phrases line: only the briefing’s own copy is left', () => {
  const own = copyLines();
  for (const [k, input] of Object.entries(IN)) {
    for (const b of B.buildScript(input, { showSentences: false }).beats) for (const l of b.lines) {
      assert.ok(own.has(l) || l === C.teaching(input.home.city) || l === C.teaching(input.friendPlace?.city) || /^(\d+ more in People|Next update usually about .*)$/.test(l), `${k} ${b.id}: ${l}`);
    }
  }
  const on = B.buildScript(IN.live15), off = B.buildScript(IN.live15, { showSentences: false });
  assert.ok(on.beats.reduce((a, b) => a + b.lines.length, 0) > off.beats.reduce((a, b) => a + b.lines.length, 0));
});

// ---------- variants ----------

test('variants: no pins and no trips gives title, picture, home, sure, end, and the end card invites an add', () => {
  const s = B.buildScript(IN.bare);
  const ch = chapters(s);
  assert.deepEqual([...new Set(ch)], ['title', 'picture', 'home', 'sure', 'end']);
  assert.ok(s.beats.at(-1).lines.includes(C.END_ADD));
  const withTrip = B.buildScript(IN.live15);
  assert.ok(!withTrip.beats.at(-1).lines.includes(C.END_ADD));
});

test('variants: friendPlace gives title, picture, the shared place in the home chapter (kind shared), sure, end, and no person beat', () => {
  const s = B.buildScript(IN.friend);
  assert.deepEqual([...new Set(chapters(s))], ['title', 'picture', 'home', 'sure', 'end']);
  assert.equal(s.beats.some((b) => b.place?.kind === 'person'), false);
  for (const b of s.beats.filter((x) => x.chapter === 'home')) { assert.equal(b.place.kind, 'shared'); assert.equal(b.place.city, 'Paris'); }
  assert.match(s.beats[0].title, /Paris/);
  assert.equal(B.buildScript({ ...inject({ pins: [mkPlace('pin:a', 'Ana', 'Rome', 41.9, 12.5)], notab: { 'pin:a': 5 }, extra: { 'pin:a': { wet: flat(5) } }, friendPlace: { key: 'shared', kind: 'shared', name: 'Paris', city: 'Paris', lat: 48.86, lon: 2.35 } }) }).beats.some((b) => b.chapter === 'people'), false, 'a link opened by a friend never reads this viewer’s pins');
});

test('variants: a 48-hour run (the synthetic fixture) gives a valid script whose beats all lie inside the run', () => {
  const s = B.buildScript(IN.small);
  assert.ok(s.beats.length >= 5);
  for (const b of s.beats) { assert.ok(b.t0 >= 0 && b.t0 <= 48 && b.t1 >= 0 && b.t1 <= 48, `${b.id} ${b.t0}-${b.t1}`); }
  assert.equal(s.beats.at(-2).t1, 48);
  assert.equal(s.beats.some((b) => b.id === 'home-later'), false, 'no days 4-7 in 48 hours');
});

// ---------- lenses, limits, view ----------

test('a lens is never scheduled when lensOk(code) is false: without msl (or lens s) there is no lens s beat; without lens c the chapter is held on z', () => {
  assert.ok(B.buildScript(IN.live15).beats.some((b) => b.lens === 's'), 'the control: a wet day and the lens give a rain beat');
  assert.equal(IN.noMsl.lensOk('s'), false);
  assert.equal(B.buildScript(IN.noMsl).beats.some((b) => b.lens === 's'), false);
  for (const code of ['s', 'c']) assert.equal(B.buildScript(inject({ z: flat(0), wet: flat(8), lensOk: (c) => c !== code })).beats.some((b) => b.lens === code), false, code);
  for (const b of B.buildScript(inject({ lensOk: () => false })).beats) assert.equal(b.lens, 'z');
});

test('every beat: at most 2 lines of 110 characters, ms 1200-14000, t0 and t1 inside the run; the full chapter set totals 30 to 90 seconds', () => {
  for (const [k, input] of Object.entries(IN)) {
    const s = B.buildScript(input);
    const [first, last] = [input.manifest.fields.z500a.steps[0], input.manifest.fields.z500a.steps.at(-1)];
    for (const b of s.beats) {
      assert.ok(b.lines.length <= 2, `${k} ${b.id}`);
      for (const l of b.lines) assert.ok(l.length > 0 && l.length <= 110, `${k} ${b.id}: ${l.length}`);
      assert.ok(b.ms >= 1200 && b.ms <= 14000, `${k} ${b.id} ms ${b.ms}`);
      assert.ok(b.t0 >= first && b.t0 <= last && b.t1 >= first && b.t1 <= last, `${k} ${b.id}`);
      assert.ok(['np', 'nh', 'gl'].includes(b.view)); assert.ok(['z', 's', 'c'].includes(b.lens));
    }
    assert.equal(s.totalMs, s.beats.reduce((a, b) => a + b.ms, 0));
    assert.equal(new Set(s.beats.map((b) => b.id)).size, s.beats.length, 'ids are unique');
  }
  for (const k of ['sample15', 'live15', 'nomean']) { const t = B.buildScript(IN[k]).totalMs; assert.ok(t >= 30000 && t <= 90000, `${k} ${t}`); }
  assert.ok(B.buildScript(IN.bare).totalMs >= 30000);
  const full = B.buildScript(inject({ z: TROUGH, wet: [0, 0, 10, 10, 0, 0, 0, ...flat(0).slice(7)], pins: [1, 2, 3, 4].map((i) => mkPlace(`pin:${i}`, `P${i}`, 'Portland', 45.52, -122.68)), notab: { 'pin:1': 2, 'pin:2': 2, 'pin:3': 2, 'pin:4': 2 }, extra: { 'pin:1': { wet: flat(5) }, 'pin:2': { wet: flat(5) }, 'pin:3': { wet: flat(5) }, 'pin:4': { wet: flat(5) }, 'trip:t': {} }, trips: [{ key: 'trip:t', kind: 'trip', label: 'Reno', name: 'Reno', city: 'Reno', lat: 39.53, lon: -119.81, start: '2026-11-21', end: '2026-11-23' }] }));
  assert.ok(full.totalMs >= 30000 && full.totalMs <= 90000, String(full.totalMs));
  assert.equal(full.beats.filter((b) => b.chapter === 'picture').length, 3);
  assert.equal(full.beats.filter((b) => b.chapter === 'home').length, 3);
  assert.equal(full.morePeople, 1);
});

test('a place outside np05 gets view gl, never np; inside it gets np', () => {
  assert.equal(B.viewFor(37.77, -122.42), 'np'); assert.equal(B.viewFor(10, 150), 'np'); assert.equal(B.viewFor(75, -50), 'np');
  for (const [lat, lon] of [[9.9, -122], [75.1, -122], [37, 149.9], [37, -49.9], [-33.9, 151.2], [51.5, -0.1], [38.7, -9.1], [64, 140]]) assert.equal(B.viewFor(lat, lon), 'gl', `${lat},${lon}`);
  const lisbon = mkPlace('pin:l', 'Lee', 'Lisbon', 38.72, -9.13), sydney = mkPlace('pin:s', 'Sy', 'Sydney', -33.9, 151.2), portland = mkPlace('pin:p', 'Pat', 'Portland', 45.52, -122.68);
  const extra = Object.fromEntries([lisbon, sydney, portland].map((p) => [p.key, { wet: flat(5) }]));
  const s = B.buildScript(inject({ pins: [lisbon, sydney, portland], notab: { 'pin:l': 3, 'pin:s': 2, 'pin:p': 1.5 }, extra }));
  const by = Object.fromEntries(s.beats.filter((b) => b.chapter === 'people').map((b) => [b.place.city, b.view]));
  assert.deepEqual(by, { Lisbon: 'gl', Sydney: 'gl', Portland: 'np' });
  const home = B.buildScript(inject({ home: { ...HOME, name: 'Sydney', city: 'Sydney', lat: -33.9, lon: 151.2 } }));
  for (const b of home.beats.filter((x) => x.chapter === 'home')) assert.equal(b.view, 'gl');
  for (const b of B.buildScript(IN.live15).beats) assert.ok(b.view !== 'np' || !b.place || B.viewFor(b.place.lat, b.place.lon) === 'np', b.id);
});

test('stamp days: a beat whose level is weaker than its covered classes names the days that weakened it', () => {
  const s = B.buildScript(IN.recorded);
  const days = IN.recorded.days.home;
  const used = days.filter((c) => c.lead <= 7 && P.hasStoryData(c));
  const last = Math.max(...used.map((c) => c.lead)), first = Math.min(...used.map((c) => c.lead));
  assert.ok(last > 3, 'the fixture has story days past day 3');
  const near = s.beats.find((b) => b.id === 'home-near'), rain = s.beats.find((b) => b.id === 'home-rain'), hold = s.beats.find((b) => b.id === 'picture-hold');
  assert.ok(near && rain && hold, 'the recorded script has the near, rain and hold beats');
  assert.deepEqual(near.sure.days, [1, 3]);
  // the rain line and the hold line talk about every used day, so the stamp spans them all
  for (const b of [rain, hold]) {
    assert.ok(b.sure.days[0] <= first && b.sure.days[1] >= last, `${b.id} stamp names days ${b.sure.days}, its line covers ${first}-${last}`);
  }
  // never a weak stamp on a span of days whose own classes are all strong, and no strong reading beside a weak day it names
  const weakDay = (c) => c.signal === 'none' || c.pattern === 'no-signal' || ['low', 'pattern-only'].includes(c.confidence);
  for (const b of s.beats.filter((x) => x.place?.key === 'home' && x.sure && x.sure.signal === 'none')) {
    assert.ok(days.some((c) => c.lead >= b.sure.days[0] && c.lead <= b.sure.days[1] && weakDay(c)) || b.sure.source !== 'none', `${b.id} is weak with no weak day in ${b.sure.days}`);
  }
  for (const b of s.beats.filter((x) => x.place?.key === 'home' && x.sure?.level === 'high')) {
    assert.ok(!days.some((c) => c.lead >= b.sure.days[0] && c.lead <= b.sure.days[1] && c.signal === 'none'), `${b.id} reads high over a no-signal day`);
  }
});

test('friend link: the home chapter kicker comes from copy.js and names the friend place naturally', () => {
  const home = B.buildScript(IN.friend).beats.filter((b) => b.chapter === 'home');
  assert.ok(home.length > 0);
  for (const b of home) assert.equal(b.kicker, C.homeKicker('Paris'), b.id);
  assert.doesNotMatch(scriptSource, /`At \$\{/);
});
