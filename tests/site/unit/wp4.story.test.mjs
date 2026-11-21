// WP4 / W2-06 story goldens: classifyDay on fixed series, local-day binning at three longitudes, buildDays on every fixture
// (columns equal local days with data), live-like clock handling and the active case.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const site = new URL('../../../site/js/', import.meta.url);
const load = (p) => import(new URL(p, site).href);
const S = await load('story/index.js');
const L = await load('story/localday.js');
const data = await load('data/index.js');
const { store } = await load('state.js');
const fixtures = new URL('../fixtures/', import.meta.url).pathname;

const shim = (dir, patch) => async (url) => {
  const f = path.join(dir, url.replace(/^data\//, ''));
  if (!fs.existsSync(f)) return { ok: false, status: 404 };
  const buf = fs.readFileSync(f);
  if (patch && url.endsWith('manifest.json')) { const m = patch(JSON.parse(buf.toString())); return { ok: true, status: 200, json: async () => m }; }
  return { ok: true, status: 200, json: async () => JSON.parse(buf.toString()), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
const open = async (name, patch) => { data._reset({ fetch: shim(path.join(fixtures, name), patch) }); store.set({ lens: 'z' }); return data.loadManifest(); };
const liveLike = (run) => (m) => { m.sample = false; delete m.cases; delete m.sample_note; for (const f of Object.values(m.fields)) delete f.case; m.run = run; m.generated = run.replace('00:00Z', '09:30Z'); return m; };

// ---------- classifyDay on fixed series ----------

const DATES = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
const windows = DATES.map((date, i) => ({ date, startH: 24 * i, endH: 24 * i + 24 }));
const per6 = (perDay, f) => { const steps = [], values = []; perDay.forEach((v, d) => { if (v == null) return; for (let k = 0; k < 4; k++) { steps.push(24 * d + 6 * k); values.push(f(v, k)); } }); return { steps, values: Float32Array.from(values) }; };
const level = (perDay) => per6(perDay, (v) => v);
// tp6 steps are the END of each 6 h period: (start, end]
const rain = (perDay) => { const steps = [], values = []; perDay.forEach((v, d) => { if (v == null) return; for (let k = 1; k <= 4; k++) { steps.push(24 * d + 6 * k); values.push(v / 4); } }); return { steps, values: Float32Array.from(values) }; };
// pr1 / pr10: one value per local day at the window that ends at the day's end
const prob = (perDay) => { const steps = [], values = []; perDay.forEach((v, d) => { if (v == null) return; steps.push(24 * d + 24); values.push(v); }); return { steps, values: Float32Array.from(values) }; };
const mk = ({ z, sd, wet, t, ws, pr1, pr10, t2m }) => ({ windows, z500a: z ? level(z) : null, z500sd: sd ? level(sd) : null, tp6: wet ? rain(wet) : null, t850a: t ? level(t) : null, ws250max: ws ? level(ws) : null, pr1: pr1 ? prob(pr1) : null, pr10: pr10 ? prob(pr10) : null, t2m: t2m ? level(t2m) : null });
const week = (series, leads = [1, 2, 3, 4, 5, 6, 7]) => leads.map((l, i) => S.classifyDay(series, i, l));
const seven = (v) => Array(7).fill(v);

test('weekday names are zone independent and match the fixture dates', () => {
  assert.equal(S.weekdayShort('2026-11-16'), 'Mon');
  assert.equal(S.weekdayShort('2026-11-19'), 'Thu');
  assert.equal(S.weekdayInitial('2026-11-22'), 'S');
});

test('G1 ridge, dry, mild, tight spread: one consequence-plus-cause sentence, no confidence in it', () => {
  const d = week(mk({ z: seven(80), wet: seven(0), t: seven(3), sd: seven(20) }));
  assert.deepEqual([d[0].pattern, d[0].wet, d[0].airMass, d[0].confidence, d[0].signal], ['ridge', 'dry', 'warmer', 'high', 'clear']);
  assert.equal(S.summarize(d), 'Dry all week under a ridge.');
  assert.equal(S.summaryConfidence(d), 'Pattern: confident.');
});

test('G2 trough arriving: the first change is reported with its cause', () => {
  const d = week(mk({ z: [0, 0, 0, -30, -80, -80, -80], wet: [0, 0, 0, 0, 10, 10, 10], t: seven(0), sd: seven(30) }));
  assert.equal(d[3].pattern, 'trough-arriving'); assert.equal(d[4].pattern, 'trough');
  assert.equal(d[4].wet, 'moderate');
  assert.equal(S.summarize(d), 'Dry through Thursday; rain likely from Friday as a trough approaches.');
});

test('G3 no data at all: nothing to say, no invented class', () => {
  const s = mk({});
  const c = S.classifyDay(s, 0, 1);
  assert.deepEqual([c.pattern, c.wet, c.wetPhrase, c.airMass, c.confidence, c.rainMissing, c.tempMissing], ['none', 'none', 'not in this run', 'none', 'none', true, true]);
  assert.equal(S.summarize([c]), '');
  assert.equal(S.dayLine('San Francisco', 'Mon', c), 'San Francisco · Mon: no forecast data.');
});

test('G4 beyond day 10 the rain row is dropped and confidence reads pattern only', () => {
  const c = S.classifyDay(mk({ z: seven(80), wet: seven(30) }), 0, 11);
  assert.equal(c.wet, 'none'); assert.equal(c.wetPhrase, ''); assert.equal(c.confidence, 'pattern-only'); assert.equal(c.pattern, 'ridge');
  assert.match(S.dayLine('X', 'Mon', c), /Pattern only, not specifics\.$/);
});

test('G5 days 1-3 are graded by the tp6 sum; day 4 on by pr1 and pr10 (section 7.3)', () => {
  const s = mk({ wet: seven(25) });
  assert.equal(S.classifyDay(s, 0, 1).wetPhrase, 'heavy rain');
  assert.equal(S.classifyDay(mk({ wet: seven(10) }), 0, 3).wetPhrase, 'rain');
  assert.equal(S.classifyDay(mk({ wet: seven(3) }), 0, 1).wetPhrase, 'light rain');
  assert.equal(S.classifyDay(mk({ wet: seven(0) }), 0, 1).wetPhrase, 'dry');
  const phrase = (p1, p10, lead = 5) => S.classifyDay(mk({ pr1: seven(p1), pr10: seven(p10) }), 0, lead).wetPhrase;
  assert.deepEqual([29, 30, 59, 60].map((p) => phrase(p, 10)), ['mostly dry', 'a chance of rain', 'a chance of rain', 'rain likely']);
  assert.equal(phrase(70, 39), 'rain likely');
  assert.equal(phrase(70, 40), 'heavy rain possible');
  const c = S.classifyDay(mk({ pr1: seven(75), pr10: seven(30), wet: seven(0) }), 0, 4);
  assert.deepEqual([c.wetSource, c.pr1, c.pr10], ['pr', 75, 30], 'pr1 wins from day 4 even when tp6 says dry');
  assert.equal(S.classifyDay(mk({ pr1: seven(75), pr10: seven(30), wet: seven(0) }), 0, 3).wetSource, 'tp6', 'day 3 still reads tp6');
});

test('G6 rain thresholds at 1, 5 and 20 mm', () => {
  const w = (mm) => S.classifyDay(mk({ wet: seven(mm) }), 0, 1).wet;
  assert.deepEqual([0.9, 1, 4.9, 5, 19.9, 20, 20.5].map(w), ['dry', 'light', 'light', 'moderate', 'moderate', 'heavy', 'heavy']);
});

test('G7 air mass thresholds at 2 and 5 K; a masked field says nothing and is never reported missing', () => {
  const a = (k) => S.classifyDay(mk({ t: seven(k) }), 0, 1).airMass;
  assert.deepEqual([5, 2, 1.9, -1.9, -2, -5].map(a), ['much-warmer', 'warmer', 'near-normal', 'near-normal', 'cooler', 'much-cooler']);
  const masked = S.classifyDay({ windows, z500a: level(seven(0)), tp6: rain(seven(0)), t850a: { steps: [0, 6, 12, 18], values: Float32Array.from([NaN, NaN, NaN, NaN]) }, t2m: level(seven(280)) }, 0, 1);
  assert.equal(masked.airMass, 'none'); assert.equal(masked.tempMissing, false);
  assert.doesNotMatch(S.dayLine('Tahoe', 'Mon', masked), /air mass|Temperature isn/);
  assert.match(S.dayLine('Tahoe', 'Mon', masked), /High near 7°, low near 7°/);
});

test('G8 confidence from spread, lead and rain', () => {
  const c = (sd, lead, wet) => S.classifyDay(mk({ z: seven(0), sd: seven(sd), wet: wet == null ? null : seven(wet) }), 0, lead).confidence;
  assert.deepEqual([25, 30, 60, 61].map((v) => c(v, 1)), ['high', 'medium', 'medium', 'low']);
  assert.equal(c(10, 9), 'medium', 'days 8 to 10 are at most medium');
  assert.equal(c(10, 5, 10), 'medium', 'never high beside rain past day 3');
  assert.equal(c(10, 3, 10), 'high');
  const noSd = (lead) => S.classifyDay(mk({ z: seven(0) }), 0, lead).confidence;
  assert.deepEqual([3, 6, 9].map(noSd), ['high', 'medium', 'low']);
});

test('G9 storm track needs 50 m/s within 250 km', () => {
  assert.equal(S.classifyDay(mk({ z: seven(0), ws: seven(50) }), 0, 1).stormTrack, true);
  assert.equal(S.classifyDay(mk({ z: seven(0), ws: seven(49.9) }), 0, 1).stormTrack, false);
});

test('G10 day line: rain first with its probability window, then air mass, high and low, then the cause, then confidence', () => {
  const s = { ...mk({ z: seven(-80), sd: seven(20), pr1: seven(75), pr10: seven(30), t: seven(-3), t2m: seven(282.15) }), originMs: Date.UTC(2026, 10, 16), offsetMin: -480 };
  const c = S.classifyDay(s, 4, 5);
  assert.equal(c.prEndHour, 16, 'the window that ends at local day end: 24 h after 00Z is 4 pm PST');
  assert.equal(S.dayLine('Portland', 'Friday', c), 'Portland · Friday: Rain likely: 75% chance of a wet day, 30% of a very wet one (24 h to 4 pm). Cooler air mass; high near 9°, low near 9°. A dip in the jet stream (a trough) overhead. Pattern: fairly sure of the timing.');
  assert.match(S.dayLine('Portland', 'Friday', c, { units: 'us' }), /high near 48°, low near 48°/);
  // from day 8 no high and low
  assert.doesNotMatch(S.dayLine('Portland', 'Friday', S.classifyDay(s, 4, 8)), /high near/);
  // sample: no confidence claim, and what is missing says "sample"
  const lacking = S.classifyDay(mk({ z: seven(80) }), 0, 1);
  assert.equal(S.dayLine('Portland', 'Thu', lacking, { sample: true }), 'Portland · Thu: High pressure aloft (a ridge) overhead. Rain and temperature aren’t in this sample.');
  assert.equal(S.dayLine('Portland', 'Thu', lacking), 'Portland · Thu: High pressure aloft (a ridge) overhead. Rain and temperature aren’t in this run. Pattern: confident.');
});

test('G13 coherence: rain is never reported "under a ridge", dry never "as a trough approaches"', () => {
  const ridgeRain = S.classifyDay(mk({ z: seven(80), wet: seven(10) }), 0, 3);
  assert.equal(S.coherent('ridge', ridgeRain), false);
  assert.equal(S.summarize([ridgeRain]), 'Rain on Monday.');
  assert.doesNotMatch(S.dayLine('Portland', 'Mon', ridgeRain), /ridge/);
  assert.equal(S.coherent('ridge', { wet: 'light' }), true);
  assert.equal(S.coherent('ridge', { wet: 'heavy' }), false);
  assert.equal(S.coherent('trough', { wet: 'dry' }), false);
  assert.equal(S.coherent('trough', { wet: 'moderate' }), true);
  const dryTrough = S.classifyDay(mk({ z: seven(-80), wet: seven(0) }), 0, 1);
  assert.equal(S.summarize([dryTrough]), 'Dry on Monday.');
});

test('G11 a recorded or short dataset never says "No data past", and cause-only sentences say what is missing', () => {
  const d = week(mk({ z: [80, 80, null, null, null, null, null], sd: [5, 5, null, null, null, null, null] })).filter(S.hasData);
  assert.equal(d.length, 2);
  assert.equal(S.summarize(d), 'Under a ridge through Tuesday. Rain isn’t in this run.');
  assert.equal(S.summarize(d, { sample: true }), 'Under a ridge through Tuesday. Rain isn’t in this sample.');
  assert.doesNotMatch(S.summarize(d), /No data past/);
});

test('G12 a trough that crosses -6 dam during the day, and day windows by fixed offset', () => {
  const steps = [0, 6, 12, 18, 24, 30, 36, 42];
  const s = { windows, z500a: { steps, values: Float32Array.from([0, 0, -70, -70, -70, -70, -70, -70]) } };
  assert.equal(S.classifyDay(s, 0, 1).pattern, 'trough-arriving', 'mean -35 dam but the day reaches -70');
  assert.equal(S.classifyDay(s, 1, 2).pattern, 'trough');
  const o = Date.UTC(2026, 10, 17, 0);
  const w = S.dayWindows(o, o, 2, -8);
  assert.deepEqual(w.map((x) => [x.date, x.startH, x.endH]), [['2026-11-16', -16, 8], ['2026-11-17', 8, 32]]);
  assert.equal(S.tzForLon(-122.4), -8);
});

test('G14 the words settled and unsettled appear in no sentence, whatever the pattern and rain', () => {
  const words = [];
  for (const z of [80, -80, 0, [0, 0, 0, -30, -80, -80, -80], [80, 80, 80, 60, 0, -80, -80]]) {
    for (const wet of [null, seven(0), seven(10), seven(25), [0, 0, 0, 10, 10, 0, 0]]) {
      for (const sd of [null, seven(20), seven(80)]) {
        const d = week(mk({ z: Array.isArray(z) ? z : seven(z), wet, sd, t: seven(3), pr1: seven(70), pr10: seven(45) }));
        words.push(S.summarize(d), S.reasonPhrase(d), ...d.map((c) => S.dayLine('P', 'Mon', c)), S.notability(0, 0).reason);
      }
    }
  }
  assert.ok(words.length > 100);
  for (const w of words) assert.doesNotMatch(w, /settled/i, w);
});

// ---------- local days ----------

test('L1 local-day binning at three longitudes: a rain event is reported under the place\'s own day', () => {
  const origin = Date.UTC(2026, 10, 18, 0); // Wed 18 Nov 00Z
  const ev = { tp6: { steps: [20, 26], values: Float32Array.from([12, 12]) } }; // Wed 20:00Z and Thu 02:00Z
  const bin = (lon) => { const off = L.offsetMinutes(lon); const d = S.daysFromSeries({ windows: [], ...ev }, { originMs: origin, fromMs: origin, toMs: origin + 3 * 86400e3, anchorMs: origin, offsetMin: off, nowMs: origin }); return d.map((c) => [c.date, c.wet]); };
  assert.equal(L.offsetMinutes(-122.42), -480);
  assert.equal(L.offsetMinutes(-9.14), -60);
  assert.equal(L.offsetMinutes(139.7), 540);
  assert.deepEqual(bin(-122.42), [['2026-11-18', 'heavy']], 'San Francisco: both events are Wednesday');
  assert.deepEqual(bin(-9.14), [['2026-11-18', 'moderate'], ['2026-11-19', 'moderate']], 'Lisbon: 02:00 UTC Thursday is 01:00 Thursday');
  assert.deepEqual(bin(139.7), [['2026-11-19', 'heavy']], 'Tokyo: both are Thursday');
  assert.equal(L.dayLabel('2026-11-19', -480, -60, 'Lisbon, Portugal'), 'Thursday (Lisbon time)');
  assert.equal(L.dayLabel('2026-11-19', -480, -480, 'San Francisco'), 'Thursday');
  assert.equal(L.dayLabel('2026-11-19', -480, -60, ''), 'Thursday');
  assert.equal(L.localDate(origin + 26 * 3600e3, -60), '2026-11-19');
  assert.equal(L.localDate(origin + 26 * 3600e3, -480), '2026-11-18');
  assert.equal(L.addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(L.daysBetween('2026-11-20', '2026-12-04'), 14);
});

// ---------- buildDays on every fixture: columns equal local days with data ----------

const SF = [37.77, -122.42];
test('B1 sample-min: three columns, no hatched day, no "No data past"', async () => {
  await open('sample-min');
  const days = await S.buildDays(...SF, 0, 6);
  assert.equal(days.length, 3);
  assert.deepEqual(days.map((d) => d.date), ['2016-12-31', '2017-01-01', '2017-01-02']);
  assert.deepEqual(days.coverage, { ...days.coverage, requested: 7, withData: 3, firstDate: '2016-12-31', lastDate: '2017-01-02', nextUpdate: null, kind: 'multi' });
  assert.ok(Array.isArray(days.days) && days.days.length === 3 && days.series.windows.length === 3);
  assert.ok(days.every(S.hasData));
  assert.doesNotMatch(S.summarize(days, { sample: true }), /No data past/);
  assert.equal(S.weekTitle(days.coverage), 'A recorded week');
});

test('B2 synthetic-15d: 7 columns on a 7-day request, 15 on 15, only days with data', async () => {
  await open('synthetic-15d');
  const w = await S.buildDays(...SF, 0, 6);
  assert.equal(w.length, 7);
  assert.equal(w.coverage.requested, 7);
  const f = await S.buildDays(...SF, 0, 14);
  assert.equal(f.length, 15);
  assert.equal(f.coverage.withData, 15);
  assert.ok(f.slice(7, 10).every((d) => d.lead >= 8 && d.lead <= 10));
  assert.ok(f.slice(10).every((d) => d.lead >= 11 && d.confidence === 'pattern-only' && d.wet === 'none'));
});

test('B3 synthetic-15d at the home: dry days 1-3 from tp6, rain likely from day 4 from pr1 with its window end', async () => {
  await open('synthetic-15d');
  const d = await S.buildDays(48, 0, 0, 6);
  assert.deepEqual(d.map((c) => c.wet), ['dry', 'dry', 'dry', 'moderate', 'moderate', 'moderate', 'moderate']);
  assert.deepEqual(d.slice(0, 3).map((c) => c.wetSource), ['tp6', 'tp6', 'tp6']);
  assert.deepEqual(d.slice(3).map((c) => [c.wetSource, c.pr1, c.pr10, c.prEndHour]), Array(4).fill(['pr', 75, 30, 0]));
  const s = S.summarize(d);
  assert.equal(s, 'Dry through Thu 19 Nov under a ridge; rain likely from Fri 20 Nov as a trough approaches.');
  assert.ok(s.length <= 110);
  assert.equal(S.reasonPhrase(d), 'Rain likely from Fri 20 Nov');
});

test('B3b synthetic-15d at the San Francisco home: the wet spell carries its cause (acceptance 7)', async () => {
  await open('synthetic-15d');
  const d = await S.buildDays(37.77, -122.42, 0, 6);
  assert.match(d[3].pattern, /trough-arriving/);
  const s = S.summarize(d);
  assert.equal(s, 'Rain through Thu 19 Nov as a trough approaches; mostly dry from Fri 20 Nov.');
  assert.ok(s.length <= 110);
});

test('B4 synthetic-15d probes at 300 h: the no-signal point says so, the clear point keeps its ridge', async () => {
  await open('synthetic-15d');
  const none = await S.buildDays(30, -56, 0, 14);
  const i = none.series.windows.findIndex((w) => 300 >= w.startH && 300 < w.endH);
  assert.equal(none[i].signal, 'none');
  assert.equal(none[i].pattern, 'no-signal');
  assert.equal(S.dayLine('Atlantic', 'Wed', none[i]), 'Atlantic · Wed: No clear signal yet: forecasts disagree.');
  const clear = await S.buildDays(70, -120, 0, 14);
  const j = clear.series.windows.findIndex((w) => 300 >= w.startH && 300 < w.endH);
  assert.equal(clear[j].signal, 'clear');
  assert.equal(clear[j].pattern, 'ridge');
  assert.doesNotMatch(S.dayLine('Arctic', 'Wed', clear[j]), /No clear signal|near[- ]normal/);
});

test('B5 recorded-min (no cases, sample true): its own dates, 11 days of 15, no case lookup', async () => {
  const m = await open('recorded-min');
  assert.equal(m.cases, undefined);
  const d = await S.buildDays(...SF, 0, 14);
  assert.equal(d.length, 11);
  assert.equal(d.coverage.kind, 'recorded');
  assert.equal(d.coverage.firstDate, '2026-11-16');
  assert.equal(S.weekTitle(d.coverage), 'A recorded week');
  assert.equal(S.weekTitle({ ...d.coverage, withData: 1 }), '1 day of data');
  assert.equal(S.weekTitle({ ...d.coverage, withData: 2 }), '2 days of data');
  assert.equal(S.anchorMs(Date.UTC(2030, 0, 1)), Date.UTC(2026, 10, 17), 'a recorded forecast starts at its own first valid time, never now');
});

test('B6 synthetic-partial (0-48 h, no spread): 3 days of the place, confidence from lead, no signal claim', async () => {
  await open('synthetic-partial');
  const d = await S.buildDays(...SF, 0, 6);
  assert.equal(d.length, 3);
  assert.ok(d.every((c) => c.signal === 'clear' && c.spreadDam !== c.spreadDam));
  assert.deepEqual(d.map((c) => c.confidence), ['high', 'high', 'high']);
});

test('B7 a dataset of one day reads "1 day of data", never "1 days"', () => {
  const o = Date.UTC(2026, 10, 17);
  const one = S.daysFromSeries({ windows: [], z500a: { steps: [0, 6, 12], values: Float32Array.from([10, 20, 30]) } }, { originMs: o, fromMs: o, toMs: o + 6 * 86400e3, anchorMs: o, offsetMin: 0, nowMs: o });
  assert.equal(one.length, 1);
  assert.equal(S.weekTitle(one.coverage), '1 day of data');
  assert.equal(S.coverageNote(one.coverage), 'This dataset covers Tue 17 Nov only.');
  const two = S.daysFromSeries({ windows: [], z500a: { steps: [0, 36], values: Float32Array.from([10, 20]) } }, { originMs: o, fromMs: o, toMs: o + 6 * 86400e3, anchorMs: o, offsetMin: 0, nowMs: o });
  assert.equal(S.weekTitle(two.coverage), '2 days of data');
  assert.equal(S.coverageNote(two.coverage), 'This dataset covers Tue 17 Nov to Wed 18 Nov only.');
});

// ---------- live-like data and the clock ----------

test('T1 live-like: the first column is today, the hours before now are marked passed, later days follow the run', async () => {
  const m = await open('synthetic-15d', liveLike('2026-11-17T00:00Z'));
  assert.equal(m.sample, false);
  const now = Date.parse('2026-11-17T14:00Z'); // 14 h after the run
  const d = await S.buildDays(...SF, 0, 6, { now });
  assert.equal(d.length, 7);
  assert.equal(d.coverage.kind, 'live');
  assert.equal(d.coverage.todayDate, '2026-11-17');
  assert.equal(d[0].date, '2026-11-17');
  assert.equal(d[0].today, true);
  assert.equal(d[0].passedH, 14);
  assert.ok(d.slice(1).every((c) => !c.today && c.passedH === undefined));
  assert.equal(S.summarize(d), 'Rain through tomorrow; dry from Thursday.');
  // the same data 30 h later: the clock moved, the first column is still today's date
  const later = await S.buildDays(...SF, 0, 6, { now: Date.parse('2026-11-18T14:00Z') });
  assert.equal(later[0].date, '2026-11-18');
  assert.equal(later.coverage.todayDate, '2026-11-18');
});

test('T2 live-like and very stale: no today or tomorrow wording, dates only', async () => {
  await open('synthetic-15d', liveLike('2026-11-17T00:00Z'));
  const now = Date.parse('2026-11-19T12:00Z'); // 60 h after the run
  const d = await S.buildDays(...SF, 0, 6, { now });
  assert.equal(d.coverage.staleness, 'very-stale');
  assert.equal(d.coverage.todayDate, null);
  assert.doesNotMatch(S.reasonPhrase(d), /today|tonight|tomorrow/);
});

test('T3 live: a run short of the range says when the next update comes', async () => {
  await open('synthetic-partial', liveLike('2026-11-17T00:00Z'));
  const now = Date.parse('2026-11-17T06:00Z');
  const d = await S.buildDays(...SF, 0, 6, { now });
  assert.ok(d.length < 7);
  assert.equal(d.coverage.requested, 7);
  assert.equal(d.coverage.nextUpdate.toISOString(), '2026-11-17T21:30:00.000Z');
  assert.match(S.laterDaysNote(d.coverage, { zone: 'America/Los_Angeles' }), /^later days arrive with the next update \(about 1 pm\)$/);
});

test('T4 today/tomorrow wording: tonight after 6 pm, full weekdays beyond, dates on a recorded forecast', async () => {
  await open('synthetic-15d', liveLike('2026-11-17T00:00Z'));
  const d = await S.buildDays(48, 0, 0, 6, { now: Date.parse('2026-11-17T09:00Z') }); // 09:00 at longitude 0
  assert.equal(S.reasonPhrase(d), 'Rain likely from Friday');
  assert.equal(S.summarize(d), 'Dry through Thursday under a ridge; rain likely from Friday as a trough approaches.');
  const evening = await S.buildDays(48, 0, 0, 6, { now: Date.parse('2026-11-17T20:00Z') });
  assert.equal(evening.coverage.nowLocalHour, 20);
  assert.match(S.summarize(evening), /^Dry through Thursday/);
});

// ---------- the active case ----------

test('C1 the story reads the active case: choosing the jet lens (case B) reads Irma, not case A', async () => {
  await open('sample-min');
  store.set({ lens: 'j' });
  try {
    const d = await S.buildDays(25, -80, 0, 6);
    assert.ok(d.length >= 1);
    assert.ok(d[0].date.startsWith('2017-09'), d[0].date);
    assert.ok(d.every((c) => c.pattern === 'none'), 'case B has no pattern field: the story does not borrow case A');
  } finally { store.set({ lens: 'z' }); }
});

test('C2 the story never reads manifest.sample as "has cases"', () => {
  const src = fs.readFileSync(new URL('story/index.js', site), 'utf8');
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''), /\.sample\b/);
});

test('N1 notability keeps its score and its reason is a reason phrase, never "Trough Sun"', async () => {
  await open('synthetic-15d');
  await S.ensureStoryData(48, 0);
  const n = S.notability(48, 0);
  assert.ok(n.score > 0);
  assert.match(n.reason, /^Rain likely from /);
  await open('sample-min');
  await S.buildDays(...SF, 0, 6);
  assert.match(S.notability(...SF).reason, /^Under a trough /);
});
