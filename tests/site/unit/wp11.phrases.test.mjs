// W2-06 story/phrases.js goldens: reason phrases, the summary sentence, the day line, trips, titles. Day classes come from
// classifyDay on fixed series so the wording is tested against the same numbers the app reads.
import test from 'node:test';
import assert from 'node:assert/strict';

const site = new URL('../../../site/js/', import.meta.url);
const S = await import(new URL('story/index.js', site).href);
const P = await import(new URL('story/phrases.js', site).href);
const C = await import(new URL('story/confidence.js', site).href);
const L = await import(new URL('story/localday.js', site).href);

// Ten local days from Mon 2026-11-16 (day 1). Per-day values; null leaves the day out of that field.
const N = 10;
const DATES = Array.from({ length: N }, (_, i) => `2026-11-${16 + i}`);
const windows = DATES.map((date, i) => ({ date, startH: 24 * i, endH: 24 * i + 24 }));
const lvl = (perDay) => { const steps = [], values = []; perDay.forEach((v, d) => { if (v == null) return; for (let k = 0; k < 4; k++) { steps.push(24 * d + 6 * k); values.push(v); } }); return { steps, values: Float32Array.from(values) }; };
const rain = (perDay) => { const steps = [], values = []; perDay.forEach((v, d) => { if (v == null) return; for (let k = 1; k <= 4; k++) { steps.push(24 * d + 6 * k); values.push(v / 4); } }); return { steps, values: Float32Array.from(values) }; };
const prob = (perDay) => { const steps = [], values = []; perDay.forEach((v, d) => { if (v == null) return; steps.push(24 * d + 24); values.push(v); }); return { steps, values: Float32Array.from(values) }; };
const fill = (n, v, rest = null) => Array.from({ length: N }, (_, i) => (i < n ? v : rest));
const LIVE = { kind: 'live', todayDate: '2026-11-16', nowLocalHour: 9 };
/** Day classes with a coverage; `dry` and `wet` give tp6 (days 1-3) and pr1 (day 4 on) per day. */
function days({ z, wet, p1, p10, n = 7, cov = LIVE, sd, t2m } = {}) {
  const series = { windows: windows.slice(0, n), z500a: z ? lvl(z) : null, z500sd: sd ? lvl(sd) : null, tp6: wet ? rain(wet) : null, pr1: p1 ? prob(p1) : null, pr10: p10 ? prob(p10) : null, t2m: t2m ? lvl(t2m) : null };
  const d = series.windows.map((_, i) => S.classifyDay(series, i, i + 1));
  Object.defineProperty(d, 'coverage', { value: cov });
  return d;
}
const dry = (n = 10) => ({ wet: fill(n, 0), p1: fill(n, 10, null).map((v, i) => (i >= 3 && i < n ? 10 : null)), p10: fill(n, 0) });

test('R1 reason phrase: rain from a weekday, a single heavy day, dry through, dry all week', () => {
  const wetFromSat = days({ n: 9, wet: fill(3, 0), p1: [null, null, null, 10, 10, 70, 70, 70, 10], p10: fill(9, 0) });
  assert.equal(P.reasonPhrase(wetFromSat), 'Rain likely from Saturday');
  assert.equal(P.reasonPhrase(days({ wet: [0, 0, 25, 0, 0, 0, 0], p1: fill(7, 10), p10: fill(7, 0) })), 'Heavy rain Wednesday');
  assert.equal(P.reasonPhrase(days({ n: 7, ...dry(7) })), 'Dry all week');
  assert.equal(P.reasonPhrase(days({ n: 6, ...dry(6) })), 'Dry through Saturday');
});

test('R2 today, tonight and tomorrow replace the weekday on live data; a recorded forecast carries the date', () => {
  const wetToday = days({ wet: [10, 0, 0, 0, 0, 0, 0] });
  assert.equal(P.reasonPhrase(wetToday), 'Rain today');
  assert.equal(P.reasonPhrase(days({ wet: [10, 10, 0, 0, 0, 0, 0] })), 'Rain through tomorrow');
  assert.equal(P.reasonPhrase(days({ wet: [0, 10, 0, 0, 0, 0, 0] })), 'Rain tomorrow');
  assert.equal(P.reasonPhrase(days({ wet: [10, 0, 0, 0, 0, 0, 0], cov: { ...LIVE, nowLocalHour: 20 } })), 'Rain tonight');
  assert.equal(P.reasonPhrase(days({ wet: [0, 0, 0, 0, 0, 0, 25], cov: { kind: 'live', todayDate: null, nowLocalHour: 0 } })), 'Rain likely Sunday', 'very stale: no today or tomorrow, weekday only');
  const rec = { kind: 'recorded', todayDate: null, nowLocalHour: 0 };
  assert.equal(P.reasonPhrase(days({ n: 9, wet: fill(3, 0), p1: [null, null, null, 10, 10, 70, 70, 70, 10], p10: fill(9, 0), cov: rec })), 'Rain likely from Sat 21 Nov');
  assert.equal(P.reasonPhrase(days({ n: 6, ...dry(6), cov: rec })), 'Dry through Sat 21 Nov');
});

test('R3 without rain fields the phrase is cause-only and names the pattern', () => {
  assert.equal(P.reasonPhrase(days({ z: fill(7, 80) })), 'Under a ridge all week');
  assert.equal(P.reasonPhrase(days({ z: [0, 0, 0, 0, 0, 0, -80, -80], n: 8 })), 'Under a trough from Saturday');
  assert.equal(P.reasonPhrase(days({ z: fill(3, -80, null), n: 3 })), 'Under a trough through Wednesday');
  assert.equal(P.reasonPhrase(days({ z: fill(7, 0) })), 'Near-normal pattern all week');
  assert.equal(P.reasonPhrase(days({})), '');
});

test('R4 no reason phrase and no summary uses the words settled or unsettled', () => {
  const all = [P.reasonPhrase(days({ z: fill(7, 80) })), P.summary(days({ z: fill(7, -80), wet: fill(7, 10) })), JSON.stringify(P.EMPTY), JSON.stringify(P.PATTERN_LINE), JSON.stringify(P.PATTERN_PLAIN), JSON.stringify(P.SUMMARY_CONFIDENCE)];
  for (const s of all) assert.doesNotMatch(s, /settled/i);
});

test('M1 summary: the section 7.3 sentence, consequence plus cause, at most 110 characters', () => {
  const d = days({ z: [80, 80, 80, 80, 80, 80, -80], wet: fill(3, 0), p1: [null, null, null, 10, 10, 10, 70], p10: fill(7, 0), sd: fill(7, 20) });
  const s = P.summary(d);
  assert.equal(s, 'Dry through Saturday under a ridge; rain likely from Sunday as a trough approaches.');
  assert.ok(s.length <= 110);
  assert.equal(P.summaryConfidence(d), 'Pattern: fairly sure of the timing.');
  assert.equal(P.summaryConfidence(d, { sample: true }), '');
});

test('M2 summary: a single spell, a one-day group between two, and the length cap', () => {
  assert.equal(P.summary(days({ z: fill(7, 80), ...dry(7) })), 'Dry all week under a ridge.');
  assert.equal(P.summary(days({ wet: [0, 0, 25, 0, 0, 0, 0], p1: fill(7, 10), p10: fill(7, 0) })), 'Dry through tomorrow; heavy rain on Wednesday.');
  // every combination stays within 110 characters, even dated and with long causes
  const rec = { kind: 'recorded', todayDate: null, nowLocalHour: 0 };
  for (const cov of [LIVE, rec]) for (const z of [fill(7, 80), fill(7, -80), [80, 80, 80, 0, -80, -80, -80]]) for (const wet of [null, fill(3, 0), [0, 0, 25, 0, 0, 0, 0], [10, 10, 10, 10, 10, 10, 10]]) {
    const s = P.summary(days({ z, wet, p1: wet ? [null, null, null, 70, 10, 70, 10] : null, p10: wet ? fill(7, 45) : null, cov }), {});
    assert.ok(s.length <= P.MAX_SUMMARY, `${s.length}: ${s}`);
  }
});

test('M3 summary with no rain fields is cause-only and says rain is not in this run (or sample)', () => {
  assert.equal(P.summary(days({ z: fill(7, 80) })), 'Under a ridge all week. Rain isn’t in this run.');
  assert.equal(P.summary(days({ z: fill(7, 80) }), { sample: true }), 'Under a ridge all week. Rain isn’t in this sample.');
});

test('D1 day line: probability from day 4 with the window end, high and low, units, the air-mass phrase dropped when masked', () => {
  const d = days({ z: fill(7, -80), sd: fill(7, 20), wet: fill(3, 0), p1: fill(7, 75, null), p10: fill(7, 30, null), t2m: fill(7, 282.15) });
  const line = P.dayLine(d[5], { label: 'Tahoe', dayName: 'Saturday' });
  assert.equal(line, 'Tahoe · Saturday: Rain likely: 75% chance of a wet day, 30% of a very wet one. High near 9°, low near 9°. A dip in the jet stream (a trough) overhead. Pattern: fairly sure of the timing.');
  assert.match(P.dayLine(d[5], { label: 'Tahoe', dayName: 'Saturday', units: 'us' }), /High near 48°, low near 48°/);
  assert.equal(P.degrees(-2, 'metric'), '−2°');
  assert.equal(P.hourWord(0), 'midnight'); assert.equal(P.hourWord(12), 'noon'); assert.equal(P.hourWord(16), '4 pm'); assert.equal(P.hourWord(9), '9 am');
});

test('D2 day line: a no-signal day says so and never "near normal"; confidence is left out', () => {
  const d = days({ z: fill(7, 10), sd: fill(7, 60), wet: fill(7, 0) });
  assert.ok(d.every((c) => c.signal === 'none' && c.pattern === 'no-signal'));
  const line = P.dayLine(d[2], { label: 'Atlantic', dayName: 'Wednesday' });
  assert.equal(line, 'Atlantic · Wednesday: Dry. No clear signal yet: forecasts disagree. Temperature isn’t in this run.');
  assert.doesNotMatch(line, /near[- ]normal|Pattern:/i);
});

test('D3 day line names a person\'s day with their time zone when it differs from the viewer\'s', () => {
  assert.equal(P.dayLineName({ date: '2026-11-19' }, -480, -60, 'Lisbon, Portugal'), 'Thursday (Lisbon time)');
  assert.equal(P.dayLineName({ date: '2026-11-19' }, -480, -480, 'Portland, OR'), 'Thursday');
});

test('D4 the zone note reaches the output: dayLine, reasonPhrase and summary say "(Lisbon time)" only when the offsets differ', () => {
  const LIS = { ...LIVE, placeName: 'Lisbon, Portugal', offsetMin: -60, viewerOffset: -480 };
  const SAME = { ...LIS, viewerOffset: -60 };
  const mk = (cov) => days({ z: fill(7, 80), wet: [0, 25, 0, 0, 0, 0, 0], p1: fill(7, 10), p10: fill(7, 0), cov });
  const d = mk(LIS);
  assert.match(P.dayLine(d[1], { label: 'Ana', days: d }), /^Ana · tomorrow \(Lisbon time\): Heavy rain/);
  assert.match(P.dayLine(d[3], { label: 'Ana', days: d }), /^Ana · Thursday \(Lisbon time\): /);
  assert.match(P.dayLine(d[3], { label: 'Ana', dayName: 'Thu', days: d }), /^Ana · Thu \(Lisbon time\): /, 'a caller-supplied name gets the note too, once');
  assert.match(P.dayLine(d[3], { label: 'Ana', dayName: 'Thursday (Lisbon time)', days: d }), /^Ana · Thursday \(Lisbon time\): /);
  assert.equal(P.reasonPhrase(d), 'Heavy rain tomorrow (Lisbon time)');
  assert.match(P.summary(d), /\(Lisbon time\)\./);
  assert.ok(P.summary(d).length <= P.MAX_SUMMARY);
  const same = mk(SAME);
  assert.doesNotMatch(P.dayLine(same[2], { label: 'Ana', days: same }) + P.reasonPhrase(same) + P.summary(same), /Lisbon time/);
  const noViewer = mk({ ...LIVE, placeName: 'Lisbon, Portugal', offsetMin: -60 });
  assert.doesNotMatch(P.reasonPhrase(noViewer), /time\)/, 'viewer offset unknown: no claim');
  const noName = mk({ ...LIS, placeName: '' });
  assert.doesNotMatch(P.reasonPhrase(noName), /time\)/);
  assert.equal(P.reasonPhrase(days({ z: fill(7, 80), cov: LIS })), 'Under a ridge all week', 'no day named: no note');
});

// ---------- trips (section 3.5) ----------

// Forecast covers Fri 20 Nov (day 1, today) to Fri 4 Dec (day 15).
const COV = { firstDate: '2026-11-20', lastDate: '2026-12-04', todayDate: '2026-11-20' };
const NOW = Date.parse('2026-11-20T18:00Z');
const trip = (start, end, label = 'Tahoe') => ({ label, start, end });

test('T1 tripState: detail on day 3, broad on day 9, too-far on day 20, over in the past', () => {
  assert.equal(P.tripState(trip('2026-11-22', '2026-11-24'), COV, NOW), 'detail');
  assert.equal(P.tripState(trip('2026-11-20', '2026-11-20'), COV, NOW), 'detail');
  assert.equal(P.tripState(trip('2026-11-26', '2026-11-28'), COV, NOW), 'detail', 'day 7 is still detail');
  assert.equal(P.tripState(trip('2026-11-28', '2026-11-30'), COV, NOW), 'broad', 'day 9');
  assert.equal(P.tripState(trip('2026-11-27', '2026-11-30'), COV, NOW), 'broad', 'day 8');
  assert.equal(P.tripState(trip('2026-12-04', '2026-12-06'), COV, NOW), 'broad', 'the last forecast day');
  assert.equal(P.tripState(trip('2026-12-09', '2026-12-12'), COV, NOW), 'too-far', 'day 20');
  assert.equal(P.tripState(trip('2026-11-15', '2026-11-18'), COV, NOW), 'over');
  assert.equal(P.tripState(trip('2026-11-18', '2026-11-20'), COV, NOW), 'detail', 'ends today: not over');
  // a recorded forecast (no today in the coverage) compares with the clock
  assert.equal(P.tripState(trip('2026-11-15', '2026-11-18'), { firstDate: '2026-11-16', lastDate: '2026-11-26' }, NOW), 'over');
});

test('T2 tripLine: the four states with the right dates', () => {
  const dd = [];
  assert.equal(P.tripLine(trip('2026-11-28', '2026-11-30'), dd, COV, { now: NOW }), 'Too early for details. No broad-pattern data for these days yet. Firmer from Sun 22 Nov.', 'no days for the trip: no confidence claim');
  const seven = Object.assign([{ date: '2026-11-26', lead: 7, pattern: 'ridge', signal: 'clear', anomDam: 8 }], { coverage: COV });
  assert.match(P.tripLine(trip('2026-11-28', '2026-11-30'), seven, COV, { now: NOW }), /No broad-pattern data/, 'a 7-day buildDays says nothing about day 9');
  assert.equal(P.tripLine(trip('2026-12-09', '2026-12-12'), dd, COV, { now: NOW }), 'Too far out. The forecast starts covering it on Wed 25 Nov.');
  assert.equal(P.tripLine(trip('2026-11-15', '2026-11-18', 'Tahoe'), dd, COV, { now: NOW }), 'Tahoe · ended Wed 18 Nov');
  // day 9 trip with a ridge leaning and a trough leaning
  const mkBroad = (anom) => Object.assign([{ date: '2026-11-28', lead: 9, pattern: 'ridge', signal: 'clear', anomDam: anom }, { date: '2026-11-29', lead: 10, pattern: 'ridge', signal: 'clear', anomDam: anom }], { coverage: COV });
  assert.equal(P.tripLine(trip('2026-11-28', '2026-11-30'), mkBroad(8), COV, { now: NOW }), 'Too early for details. The broad pattern leans toward a ridge (drier). Firmer from Sun 22 Nov.');
  assert.equal(P.tripLine(trip('2026-11-28', '2026-11-30'), mkBroad(-8), COV, { now: NOW }), 'Too early for details. The broad pattern leans toward a trough (wetter). Firmer from Sun 22 Nov.');
  assert.equal(P.tripLine(trip('2026-11-28', '2026-11-30'), mkBroad(0.5), COV, { now: NOW }), 'Too early for details. The broad pattern looks near normal. Firmer from Sun 22 Nov.');
  const mixed = Object.assign([{ date: '2026-11-28', lead: 9, pattern: 'no-signal', signal: 'none', anomDam: 0.5 }, { date: '2026-11-29', lead: 10, pattern: 'no-signal', signal: 'none', anomDam: 1 }], { coverage: COV });
  assert.match(P.tripLine(trip('2026-11-28', '2026-11-30'), mixed, COV, { now: NOW }), /^Too early for details\. No clear signal yet: forecasts disagree\. Firmer from Sun 22 Nov\.$/);
  // detail: the sentence for the trip's own days
  const det = days({ z: fill(7, 80), ...dry(7), cov: { ...LIVE, todayDate: '2026-11-16' } });
  assert.equal(P.tripLine(trip('2026-11-17', '2026-11-19'), det, { firstDate: '2026-11-16', lastDate: '2026-11-25', todayDate: '2026-11-16' }, { now: Date.parse('2026-11-16T12:00Z') }), 'Dry through Thursday under a ridge.');
});

test('T3 tripState dates for trips starting on days 3, 9, 20 and in the past from any first day', () => {
  for (const first of ['2026-11-20', '2026-12-30', '2027-02-27']) {
    const cov = { firstDate: first, lastDate: L.addDays(first, 14), todayDate: first };
    const at = (n) => { const s = new Date(Date.parse(first + 'T00:00:00Z') + (n - 1) * 86400e3).toISOString().slice(0, 10); return trip(s, s); };
    const now = Date.parse(first + 'T12:00:00Z');
    assert.deepEqual([3, 9, 20].map((n) => P.tripState(at(n), cov, now)), ['detail', 'broad', 'too-far'], first);
    assert.equal(P.tripState(at(-1), cov, now), 'over');
  }
});

test('T4 the dates tripLine names are the days tripState actually changes', () => {
  const covOn = (first) => ({ firstDate: first, lastDate: L.addDays(first, 14), todayDate: first });
  const at = (first) => Date.parse(first + 'T12:00:00Z');
  const broadTrip = trip('2026-11-28', '2026-11-30'), farTrip = trip('2026-12-09', '2026-12-12');
  const firmer = L.addDays(broadTrip.start, -6), cover = L.addDays(farTrip.start, -14);
  assert.match(P.tripLine(broadTrip, [], covOn('2026-11-20'), { now: at('2026-11-20') }), /Firmer from Sun 22 Nov/);
  assert.equal(P.tripState(broadTrip, covOn(L.addDays(firmer, -1)), at(firmer)), 'broad', 'the day before the named date');
  assert.equal(P.tripState(broadTrip, covOn(firmer), at(firmer)), 'detail', 'on the named date');
  assert.match(P.tripLine(farTrip, [], covOn('2026-11-20'), { now: at('2026-11-20') }), /starts covering it on Wed 25 Nov/);
  assert.equal(P.tripState(farTrip, covOn(L.addDays(cover, -1)), at(cover)), 'too-far', 'the day before the named date');
  assert.equal(P.tripState(farTrip, covOn(cover), at(cover)), 'broad', 'on the named date');
});

test('X1 titles and dataset notes: plural, recorded week, range, short-of-range note', () => {
  assert.equal(P.daysOfData(1), '1 day of data'); assert.equal(P.daysOfData(2), '2 days of data');
  const cov = (o) => ({ requested: 7, withData: 7, firstDate: '2026-11-16', lastDate: '2026-11-22', nextUpdate: null, kind: 'live', ...o });
  assert.equal(P.weekTitle(cov({})), 'Your week');
  assert.equal(P.weekTitle(cov({}), { range: 10 }), 'Your next 10 days');
  assert.equal(P.weekTitle(cov({}), { range: 15 }), 'Your next 15 days');
  assert.equal(P.weekTitle(cov({ kind: 'recorded' })), 'A recorded week');
  assert.equal(P.weekTitle(cov({ withData: 2, kind: 'recorded' })), '2 days of data');
  assert.equal(P.coverageNote(cov({ withData: 3, firstDate: '2016-12-31', lastDate: '2017-01-02' })), 'This dataset covers Sat 31 Dec to Mon 2 Jan only.');
  assert.equal(P.laterDaysNote(cov({ nextUpdate: new Date('2026-11-17T21:30:00Z') }), { zone: 'America/Los_Angeles' }), 'later days arrive with the next update (about 1 pm)');
  assert.ok(C.NO_CLEAR_SIGNAL === P.NO_CLEAR_SIGNAL);
});
