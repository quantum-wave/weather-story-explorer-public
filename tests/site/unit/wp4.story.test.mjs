// WP4 story goldens (S-STORY, pure part): classifyDay, summarize, dayLine, dayWindows on 12 fixed series.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../../site/js/story/index.js';

// Seven local days from Mon 2026-11-16, 24 h each, from forecast hour 0. Fields are {steps, values} at 6 h.
const DATES = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
const windows = DATES.map((date, i) => ({ date, startH: 24 * i, endH: 24 * i + 24 }));
const per6 = (perDay, f) => { const steps = [], values = []; perDay.forEach((v, d) => { if (v == null) return; for (let k = 0; k < 4; k++) { steps.push(24 * d + 6 * k); values.push(f(v, k)); } }); return { steps, values: Float32Array.from(values) }; };
const level = (perDay) => per6(perDay, (v) => v);
// tp6 steps are the END of each 6 h period: (start, end]
const rain = (perDay) => { const steps = [], values = []; perDay.forEach((v, d) => { if (v == null) return; for (let k = 1; k <= 4; k++) { steps.push(24 * d + 6 * k); values.push(v / 4); } }); return { steps, values: Float32Array.from(values) }; };
const mk = ({ z, sd, wet, t, ws }) => ({ windows, z500a: z ? level(z) : null, z500sd: sd ? level(sd) : null, tp6: wet ? rain(wet) : null, t850a: t ? level(t) : null, ws250max: ws ? level(ws) : null });
const week = (series, leads = [1, 2, 3, 4, 5, 6, 7]) => leads.map((l, i) => S.classifyDay(series, i, l));
const seven = (v) => Array(7).fill(v);

test('weekday names are zone independent and match the fixture dates', () => {
  assert.equal(S.weekdayShort('2026-11-16'), 'Mon');
  assert.equal(S.weekdayShort('2026-11-19'), 'Thu');
  assert.equal(S.weekdayInitial('2026-11-22'), 'S');
});

test('G1 ridge, dry, mild, tight spread: one settled sentence', () => {
  const d = week(mk({ z: seven(80), wet: seven(0), t: seven(3), sd: seven(20) }));
  assert.equal(d[0].pattern, 'ridge'); assert.equal(d[0].wet, 'dry'); assert.equal(d[0].airMass, 'warmer'); assert.equal(d[0].confidence, 'high');
  assert.equal(S.summarize(d), 'Dry and mild all week under high pressure aloft (a ridge). Pattern: confident.');
});

test('G2 trough arriving: the first change is reported with its cause', () => {
  const d = week(mk({ z: [0, 0, 0, -30, -80, -80, -80], wet: [0, 0, 0, 0, 10, 10, 10], t: seven(0), sd: seven(40) }));
  assert.equal(d[3].pattern, 'trough-arriving'); assert.equal(d[4].pattern, 'trough');
  assert.equal(d[4].wet, 'moderate'); assert.equal(d[4].wetPhrase, 'rain likely');
  assert.equal(S.summarize(d), 'Dry through Thu; rain likely from Fri as a dip in the jet stream (a trough) moves in. Pattern: fairly sure of the timing.');
});

test('G3 no data at all: nothing to say, no invented class', () => {
  const s = mk({});
  const c = S.classifyDay(s, 0, 1);
  assert.deepEqual([c.pattern, c.wet, c.wetPhrase, c.airMass, c.confidence], ['none', 'none', 'not in this run', 'none', 'none']);
  assert.equal(S.summarize([c]), '');
  assert.equal(S.dayLine('San Francisco', 'Mon', c), 'San Francisco · Mon: no forecast data.');
});

test('G4 beyond day 10 the rain row is dropped and confidence reads pattern only', () => {
  const c = S.classifyDay(mk({ z: seven(80), wet: seven(30) }), 0, 11);
  assert.equal(c.wet, 'none'); assert.equal(c.wetPhrase, ''); assert.equal(c.confidence, 'pattern-only'); assert.equal(c.pattern, 'ridge');
  assert.match(S.dayLine('X', 'Mon', c), /Pattern only, not specifics\.$/);
});

test('G5 rain wording is graded by lead', () => {
  const s = mk({ wet: seven(25) });
  assert.equal(S.classifyDay(s, 0, 1).wetPhrase, 'heavy rain');
  assert.equal(S.classifyDay(s, 0, 5).wetPhrase, 'rain likely');
  assert.equal(S.classifyDay(s, 0, 9).wetPhrase, 'a rain signal');
  const l = mk({ wet: seven(3) });
  assert.equal(S.classifyDay(l, 0, 1).wetPhrase, 'light rain');
  assert.equal(S.classifyDay(l, 0, 5).wetPhrase, 'rain possible');
  assert.equal(S.classifyDay(mk({ wet: seven(0) }), 0, 9).wetPhrase, 'no rain signal');
});

test('G6 rain thresholds at 1, 5 and 20 mm', () => {
  const w = (mm) => S.classifyDay(mk({ wet: seven(mm) }), 0, 1).wet;
  assert.deepEqual([0.9, 1, 4.9, 5, 20, 20.5].map(w), ['dry', 'light', 'light', 'moderate', 'moderate', 'heavy']);
});

test('G7 air mass thresholds at 2 and 5 K', () => {
  const a = (k) => S.classifyDay(mk({ t: seven(k) }), 0, 1).airMass;
  assert.deepEqual([5, 2, 1.9, -1.9, -2, -5].map(a), ['much-warmer', 'warmer', 'near-normal', 'near-normal', 'cooler', 'much-cooler']);
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

test('G10 day line wording: amounts say "in the latest forecast"', () => {
  const cls = { dayIndex: 1, date: '2026-11-19', lead: 2, pattern: 'trough', stormTrack: false, wet: 'moderate', wetPhrase: 'rain', airMass: 'cooler', confidence: 'high' };
  assert.equal(S.dayLine('Portland', 'Thu', cls), 'Portland · Thu: rain in the latest forecast, cooler air mass — a dip in the jet stream (a trough). Pattern: confident.');
  // sample: the missing rows say so, a sample spread is not a forecast spread (no confidence claim), and a storm
  // track is not reported overhead of a ridge
  const sample = { ...cls, wet: 'none', wetPhrase: 'not in this run', airMass: 'none', pattern: 'ridge', stormTrack: true };
  assert.equal(S.dayLine('Portland', 'Thu', sample, { sample: true }), 'Portland · Thu: High pressure aloft (a ridge) overhead. Rain and temperature aren’t in this sample.');
  // one thing missing, and a live run: the missing sentence says which, and "this run"
  const airOnly = { ...cls, airMass: 'none' };
  assert.equal(S.dayLine('Portland', 'Thu', airOnly), 'Portland · Thu: rain in the latest forecast — a dip in the jet stream (a trough). Temperature isn’t in this run. Pattern: confident.');
  const trough = { ...sample, pattern: 'trough' };
  assert.equal(S.dayLine('Portland', 'Thu', trough, { sample: true }), 'Portland · Thu: A dip in the jet stream (a trough), storm track overhead. Rain and temperature aren’t in this sample.');
});

test('G10b sample summary: a trough on its way says "moves in by", not "arriving through"', () => {
  const d = week(mk({ z: [-80, -80, null, null, null, null, null] })).map((c) => ({ ...c, pattern: c.pattern === 'none' ? c.pattern : 'trough-arriving' }));
  assert.equal(S.summarize(d, { sample: true }), 'A dip in the jet stream (a trough) moves in by Tue. No data past Tue.');
});

test('G13 coherence: rain is never reported "under a ridge", dry never "as a trough moves in"', () => {
  // the sentence that read "Rain and mild on Wed under high pressure aloft (a ridge)"
  const ridgeRain = { dayIndex: 2, date: '2026-11-18', lead: 3, pattern: 'ridge', stormTrack: true, wet: 'moderate', wetPhrase: 'rain', airMass: 'warmer', confidence: 'high' };
  assert.equal(S.coherent('ridge', ridgeRain), false);
  assert.equal(S.summarize([ridgeRain]), 'Rain and mild on Wed. Pattern: confident.');
  assert.equal(S.dayLine('Portland', 'Wed', ridgeRain), 'Portland · Wed: rain in the latest forecast, warmer air mass. Pattern: confident.');
  // light rain under a ridge (a marine layer) is allowed to keep the pattern words; heavy rain is not
  assert.equal(S.coherent('ridge', { wet: 'light' }), true);
  assert.equal(S.coherent('ridge', { wet: 'heavy' }), false);
  assert.equal(S.coherent('trough', { wet: 'dry' }), false);
  assert.equal(S.coherent('trough', { wet: 'moderate' }), true);
  assert.equal(S.coherent('normal', { wet: 'heavy' }), true);
  // a dry day under a trough: no "dry under a dip in the jet stream"
  const dryTrough = { dayIndex: 0, date: '2026-11-16', lead: 1, pattern: 'trough', stormTrack: false, wet: 'dry', wetPhrase: 'dry', airMass: 'near-normal', confidence: 'high' };
  assert.equal(S.summarize([dryTrough]), 'Dry on Mon. Pattern: confident.');
  // a change to rain that comes with a ridge building gets no cause; with a trough it does (G2)
  const d = [
    { dayIndex: 0, date: '2026-11-16', lead: 1, pattern: 'near-normal', stormTrack: false, wet: 'dry', wetPhrase: 'dry', airMass: 'near-normal', confidence: 'high' },
    { dayIndex: 1, date: '2026-11-17', lead: 2, pattern: 'ridge', stormTrack: false, wet: 'heavy', wetPhrase: 'heavy rain', airMass: 'near-normal', confidence: 'high' },
  ];
  assert.equal(S.summarize(d), 'Dry on Mon; heavy rain on Tue. Pattern: confident.');
  // and in sample mode no confidence phrase at all
  assert.equal(S.summarize(d, { sample: true }), 'Dry on Mon; heavy rain on Tue.');
});

test('G11 sample-style data (pattern only, two days): says where the data stops', () => {
  const d = week(mk({ z: [80, 80, null, null, null, null, null], sd: [5, 5, null, null, null, null, null] }));
  assert.equal(d[2].pattern, 'none');
  assert.equal(S.summarize(d), 'Settled through Tue under high pressure aloft (a ridge). Pattern: confident. No data past Tue.');
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

test('G14 sample stories state only the pattern: no Settled/Unsettled, no cause, no confidence', () => {
  const d = week(mk({ z: [80, -80, null, null, null, null, null], sd: [5, 5, null, null, null, null, null] }));
  assert.equal(S.summarize(d, { sample: true }), 'High pressure aloft (a ridge) on Mon; a dip in the jet stream (a trough) on Tue. No data past Tue.');
  const t = week(mk({ z: [-80, -80, null, null, null, null, null] }));
  assert.equal(S.summarize(t, { sample: true }), 'A dip in the jet stream (a trough) through Tue. No data past Tue.');
  // a live run without rain data keeps the pattern-implied words
  assert.match(S.summarize(t), /^Unsettled through Tue under a dip in the jet stream \(a trough\)\. Pattern: /);
});
