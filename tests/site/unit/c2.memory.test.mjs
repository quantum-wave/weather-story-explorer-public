// C2-03: the Briefing's memory and its 'since' beat. memory.js over an injected storage (save, previous, the six-run cap, blocked
// storage), the rule of each 'since' line on injected digests, and the script's 'since' beat (placement, stamp, camera, live-only).
import test from 'node:test';
import assert from 'node:assert/strict';

const site = new URL('../../../site/js/', import.meta.url);
const load = (p) => import(new URL(p, site).href);
const S = await load('story/index.js');
const P = await load('story/phrases.js');
const B = await load('brief/script.js');
const M = await load('brief/memory.js');
const C = await load('brief/copy.js');

const mem = () => { const m = new Map(); return { data: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };
const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
const day = (date, o = {}) => ({ date, wet: 'dry', family: 'ridge', confidence: 'high', signal: 'clear', ...o });
const entry = (reason, days, key = 'home') => ({ key, reason, days });
const week = (o = {}) => Array.from({ length: 7 }, (_, i) => day(`2026-11-${String(18 + i).padStart(2, '0')}`, o));

// ---------- memory.js ----------

test('save and previous: the latest earlier run comes back, the same or a later run does not', () => {
  const st = mem(), m = M.createMemory(st);
  assert.equal(m.previous('2026-11-17T12:00Z'), null, 'a browser with nothing saved');
  assert.equal(m.save('2026-11-17T00:00Z', [entry('Dry all week', week())], 'ECMWF run Tue 17 Nov, 12 am UTC'), true);
  assert.equal(m.save('2026-11-17T12:00Z', [entry('Rain from Sun', week())], 'run b'), true);
  const p = m.previous('2026-11-18T00:00Z');
  assert.equal(p.run, '2026-11-17T12:00Z'); assert.equal(p.entries[0].reason, 'Rain from Sun'); assert.equal(p.label, 'run b');
  assert.equal(m.previous('2026-11-17T12:00Z').run, '2026-11-17T00:00Z', 'previous(run) never returns run itself');
  assert.equal(m.previous('2026-11-17T00:00Z'), null);
  assert.equal(m.save('2026-11-17T12:00Z', [entry('Other', week())]), false, 'a run already kept is not kept twice');
  assert.equal(m.previous('2026-11-18T00:00Z').entries[0].reason, 'Rain from Sun');
});

test('the key is wse.v1.brief.memory and at most 6 runs are kept, the oldest dropped', () => {
  const st = mem(), m = M.createMemory(st);
  for (let i = 1; i <= 9; i++) m.save(`2026-11-${String(10 + i).padStart(2, '0')}T00:00Z`, [entry(`r${i}`, week())]);
  assert.equal(M.MEMORY_KEY, 'wse.v1.brief.memory'); assert.equal(M.MAX_RUNS, 6);
  const raw = JSON.parse(st.data.get('wse.v1.brief.memory'));
  assert.equal(raw.runs.length, 6);
  assert.deepEqual(raw.runs.map((r) => r.run.slice(8, 10)).join(','), '14,15,16,17,18,19');
  assert.equal(m.previous('2026-11-14T00:00Z'), null, 'the dropped runs are gone');
});

test('blocked, absent or damaged storage disables the feature without an error', () => {
  const b = M.createMemory(blocked);
  assert.equal(b.save('r1', [entry('x', week())]), false); assert.equal(b.previous('r2'), null);
  const n = M.createMemory(undefined);
  assert.equal(n.save('r1', [entry('x', week())]), false); assert.equal(n.previous('r2'), null);
  const bad = mem(); bad.setItem(M.MEMORY_KEY, '{not json');
  const d = M.createMemory(bad);
  assert.equal(d.previous('r2'), null);
  assert.equal(d.save('r1', [entry('x', week())]), true, 'a damaged record is replaced');
});

test('a saved digest holds only keys, phrases and day classes: no name, label, city or coordinate', () => {
  const st = mem(), m = M.createMemory(st);
  m.save('r1', [{ key: 'pin:abc', reason: 'Dry all week', name: 'Zzyx Testperson', city: 'Zzyxville', lat: 1.5, lon: 2.5, days: [{ ...day('2026-11-18'), name: 'Zzyx', lat: 3 }] }]);
  const raw = st.data.get(M.MEMORY_KEY);
  for (const bad of ['Zzyx', 'name', 'city', 'lat', 'lon']) assert.ok(!raw.includes(bad), bad);
  assert.deepEqual(Object.keys(JSON.parse(raw).runs[0].entries[0]).sort(), ['days', 'key', 'reason']);
  assert.deepEqual(Object.keys(JSON.parse(raw).runs[0].entries[0].days[0]).sort(), ['confidence', 'date', 'family', 'signal', 'wet']);
});

// ---------- the 'since' rule ----------

test('since: equal phrases and no differing day give the single line', () => {
  assert.deepEqual(M.sinceLines(entry('Dry all week', week()), entry('Dry all week', week())), ['Same as your last briefing.']);
});
test('since: different phrases give Then and Now, byte-equal to the phrases after the labels', () => {
  const l = M.sinceLines(entry('Dry all week', week()), entry('Rain from Sun', week()));
  assert.deepEqual(l, ['Then: Dry all week', 'Now: Rain from Sun']);
});
test('since: equal phrases but a common day that changed wet class or pattern family are not "the same"', () => {
  const a = week(), b = week(); b[2] = day(b[2].date, { wet: 'moderate' });
  assert.deepEqual(M.sinceLines(entry('X', a), entry('X', b)), ['Then: X', 'Now: X']);
  const c = week(); c[4] = day(c[4].date, { family: 'trough' });
  assert.equal(M.sinceLines(entry('X', a), entry('X', c)).length, 2);
});
test('since: a day with no clear signal, or low confidence, in either digest is never the basis of a difference', () => {
  for (const o of [{ signal: 'none' }, { confidence: 'low' }]) {
    const a = week(), b = week();
    b[3] = day(b[3].date, { wet: 'heavy', family: 'trough', ...o });
    assert.deepEqual(M.sinceLines(entry('X', a), entry('X', b)), ['Same as your last briefing.'], `now ${JSON.stringify(o)}`);
    assert.deepEqual(M.sinceLines(entry('X', b), entry('X', a)), ['Same as your last briefing.'], `then ${JSON.stringify(o)}`);
  }
});
test('since: days not common to both runs are not compared; an empty phrase gives no beat', () => {
  const a = week(), b = Array.from({ length: 7 }, (_, i) => day(`2026-11-${String(19 + i).padStart(2, '0')}`));
  b[6] = day(b[6].date, { wet: 'heavy' }); // 25 Nov is in only one digest
  assert.deepEqual(M.sinceLines(entry('X', a), entry('X', b)), ['Same as your last briefing.']);
  assert.equal(M.sinceLines(entry('', a), entry('X', b)), null);
  assert.equal(M.sinceLines(entry('X', a), entry('', b)), null);
});

// ---------- the script's 'since' beat ----------

const HOUR = 3600e3, DAY = 24 * HOUR, ORIGIN = Date.parse('2026-11-17T00:00:00Z');
const STEPS = Array.from({ length: 61 }, (_, i) => 6 * i);
const per6 = (perDay) => ({ steps: STEPS.slice(), values: Float32Array.from(STEPS, (s) => perDay[Math.min(14, Math.floor(s / 24))] ?? 0) });
const rain6 = (perDay) => { const steps = STEPS.filter((s) => s > 0); return { steps, values: Float32Array.from(steps, (s) => (perDay[Math.min(14, Math.floor((s - 0.001) / 24))] ?? 0) / 4) }; };
const flat = (v) => Array(15).fill(v);
const manifest = (live) => ({ schema: 1, sample: !live, model: 'ECMWF', run: '2026-11-17T12:00Z', generated: '2026-11-17T21:30Z',
  fields: { z500a: { steps: STEPS }, z500sd: { steps: STEPS }, tp6: { steps: STEPS.filter((s) => s > 0) }, msl: { steps: STEPS } } });
function input({ live = true, wet = flat(0), z = flat(0), previous } = {}) {
  const m = manifest(live);
  const series = { windows: [], z500a: per6(z), z500sd: per6(flat(20)), tp6: rain6(wet), t850a: null, t2m: null, pr1: null, pr10: null, ws250max: null };
  const days = S.daysFromSeries(series, { originMs: ORIGIN, fromMs: ORIGIN, toMs: ORIGIN + 14 * DAY, anchorMs: ORIGIN, offsetMin: 0, nowMs: ORIGIN + 2 * HOUR, manifest: m });
  const home = { key: 'home', kind: 'home', name: 'San Francisco', city: 'San Francisco', lat: 37.77, lon: -122.42 };
  const sd = Array.from(per6(flat(20)).values, (v) => v / 10);
  return { manifest: m, dataLabel: live ? 'ECMWF run Tue 17 Nov, 12 pm UTC' : 'Recorded', live, nowMs: ORIGIN + 2 * HOUR, nowH: 2, hasMean: false, zone: 'UTC', home,
    trips: [], pins: [], friendPlace: null, days: { home: days }, sample: { home: { steps: STEPS, anomDam: per6(z).values.map((v) => v / 10), spreadDam: sd } },
    notabilityOf: () => ({ score: 0 }), lensOk: () => true, ...(previous !== undefined ? { previous } : {}) };
}
const prevOf = (inp, tweak) => { const d = B.digestOf(inp); if (tweak) tweak(d); return { run: '2026-11-17T00:00Z', label: 'ECMWF run Tue 17 Nov, 12 am UTC', entries: d }; };
const dayRain = [0, 0, 10, 10, 0, 0, 0, ...flat(0).slice(7)];

test('no previous digest: the script is exactly the C1 script (no since beat)', () => {
  const plain = B.buildScript(input({ wet: dayRain }));
  assert.ok(!plain.beats.some((b) => b.chapter === 'since'));
  assert.deepEqual(B.buildScript(input({ wet: dayRain, previous: null })), plain);
});

test('a previous digest adds one since beat after the title, with the kicker, lines, stamp and a null camera', () => {
  const before = input({ wet: flat(0) });
  const now = input({ wet: dayRain, previous: prevOf(before) });
  const sc = B.buildScript(now);
  assert.deepEqual(sc.beats.slice(0, 2).map((b) => b.id), ['title', 'since']);
  assert.equal(sc.beats.filter((b) => b.chapter === 'since').length, 1);
  const b = sc.beats[1];
  assert.equal(b.kicker, 'Since your last briefing · ECMWF run Tue 17 Nov, 12 am UTC');
  assert.equal(b.ms, 4000); assert.equal(b.camera, null); assert.equal(b.t0, b.t1); assert.equal(b.t0, now.nowH);
  assert.equal(b.view, 'nh'); assert.ok(b.sure && b.sure.level, 'today\'s stamp');
  const then = B.savedReason(before.days.home), nowP = B.savedReason(now.days.home);
  assert.notEqual(then, nowP);
  assert.deepEqual(b.lines, [`Then: ${then}`, `Now: ${nowP}`]);
  assert.equal(sc.beats.length, B.buildScript(input({ wet: dayRain })).beats.length + 1);
});

test('the same weather twice gives the single line "Same as your last briefing."', () => {
  const a = input({ wet: dayRain });
  const sc = B.buildScript(input({ wet: dayRain, previous: prevOf(a) }));
  assert.deepEqual(sc.beats[1].lines, ['Same as your last briefing.']);
});

test('data that is not live: no since beat even with a digest; a friend link: none either', () => {
  const a = input({ wet: dayRain });
  assert.ok(!B.buildScript(input({ live: false, wet: dayRain, previous: prevOf(a) })).beats.some((b) => b.chapter === 'since'));
  const f = input({ wet: dayRain, previous: prevOf(a) }); f.friendPlace = { key: 'shared', name: 'Paris', city: 'Paris', lat: 48.8, lon: 2.3 };
  f.days.shared = f.days.home; f.sample.shared = f.sample.home;
  assert.ok(!B.buildScript(f).beats.some((b) => b.chapter === 'since'));
});

test('the since beat needs the home place in the digest and SHOW_SENTENCES', () => {
  const a = input({ wet: dayRain });
  assert.ok(!B.buildScript(input({ wet: dayRain, previous: prevOf(a, (d) => { d[0].key = 'pin:x'; }) })).beats.some((b) => b.chapter === 'since'));
  assert.ok(!B.buildScript(input({ wet: dayRain, previous: prevOf(a) }), { showSentences: false }).beats.some((b) => b.chapter === 'since'));
});

test('digestOf: home and every briefed key, days 1-7, nothing else', () => {
  const d = B.digestOf(input({ wet: dayRain }));
  assert.deepEqual(d.map((e) => e.key), ['home']);
  assert.equal(d[0].days.length, 7); assert.equal(d[0].reason, B.savedReason(input({ wet: dayRain }).days.home));
  assert.deepEqual(Object.keys(d[0].days[0]).sort(), ['confidence', 'date', 'family', 'signal', 'wet']);
  assert.ok(!JSON.stringify(d).includes('San Francisco'));
});

test('copy: the since strings are the only new words and are fixed', () => {
  assert.equal(C.SINCE_SAME, 'Same as your last briefing.');
  assert.equal(C.thenLine('Dry all week'), 'Then: Dry all week'); assert.equal(C.nowLine('x'), 'Now: x');
});

// ---------- the saved phrase: no place name, no relative day word ----------

/** Same weather on the same calendar dates, read on day `todayIdx` of a 10-day calendar; optional place in another time zone. */
function cal(todayIdx, { placeName = '', offsetMin = -480 } = {}) {
  const dates = Array.from({ length: 10 }, (_, i) => `2026-11-${String(18 + i).padStart(2, '0')}`);
  const list = dates.slice(todayIdx).map((date, i) => ({ date, lead: i, wet: date === '2026-11-20' ? 'moderate' : 'dry', wetPhrase: 'rain likely', pattern: 'trough', airMass: 'none', confidence: 'high', signal: 'clear' }));
  const cov = { kind: 'live', todayDate: dates[todayIdx], nowLocalHour: 9, placeName, viewerOffset: -480, offsetMin };
  Object.defineProperty(list, 'coverage', { value: cov, enumerable: false });
  return list;
}

test('a place in another time zone: the saved digest carries no city (no "(London time)")', () => {
  const key = 'pin:poy91e766y';
  const d = B.digestOf({ days: { home: cal(1), [key]: cal(1, { placeName: 'London', offsetMin: 0 }) } });
  const raw = JSON.stringify(d);
  assert.ok(d.some((e) => e.key === key));
  assert.ok(!/London|time\)/.test(raw), raw);
  // the live phrase would carry it, so the test is not vacuous
  assert.match(P.reasonPhrase(cal(1, { placeName: 'London', offsetMin: 0 })), /London time/);
});

test('the saved phrase names weekdays, never today, tonight or tomorrow', () => {
  for (const i of [0, 1, 2]) assert.doesNotMatch(B.digestOf({ days: { home: cal(i) } })[0].reason, /today|tonight|tomorrow/i);
});

test('two runs a day apart with the same weather on the same dates give the single line', () => {
  const then = B.digestOf({ days: { home: cal(1) } })[0], now = B.digestOf({ days: { home: cal(2) } })[0];
  assert.equal(then.reason, now.reason);
  assert.deepEqual(M.sinceLines(then, now), ['Same as your last briefing.']);
});
