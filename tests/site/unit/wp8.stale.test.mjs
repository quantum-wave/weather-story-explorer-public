// The stale warning must stay quiet through a healthy build cadence (00Z/12Z runs built ~9.5 h later).
import test from 'node:test';
import assert from 'node:assert/strict';
// A zone west of UTC, so a run at 00 UTC falls on the previous local day: the chip must still give the recorded run's UTC date.
process.env.TZ = 'America/Los_Angeles';

const { isStale, ageHours } = await import(new URL('../../../site/js/ui/format.js', import.meta.url).href);

test('a run is not stale at the oldest age a healthy cadence shows, and is stale when a slot was missed', () => {
  const run = '2026-11-17T12:00Z';
  const at = (h) => ageHours(run, Date.parse('2026-11-17T12:00Z') + h * 3600e3);
  assert.equal(isStale(at(21.5)), false, '12Z run just before the next 00Z run is built (09:30Z)');
  assert.equal(isStale(at(19)), false);
  assert.equal(isStale(at(31)), true, 'a missed slot');
});

// W3-04: the header chip's states. The chip uses data/kind.js (acceptance 3): its state is kind.staleness(), its recorded text is
// kind.sampleLabel(), its run time is kind.runLabel(). The chip never carries a Z time suffix; recorded and sample chips say they are not live.
const { chipModel } = await import(new URL('../../../site/js/ui/header.js', import.meta.url).href);
const K = await import(new URL('../../../site/js/data/kind.js', import.meta.url).href);
const NOW = Date.UTC(2026, 10, 18, 22, 0);
const iso = (ms) => new Date(ms).toISOString().slice(0, 16) + 'Z';
const live = (ageH) => ({ sample: false, model: 'ECMWF IFS', run: iso(NOW - ageH * 3600e3) });

test('the chip and data/kind.js agree on staleness at the boundaries: 25.9, 26, 48 and 48.1 h', () => {
  const run = '2026-11-18T12:00Z', t0 = Date.parse(run);
  const m = { sample: false, model: 'ECMWF IFS HRES', run };
  const got = [25.9, 26, 48, 48.1].map((h) => { const now = t0 + h * 3600e3; return [h, chipModel(m, { now }).state, K.staleness(m, now)]; });
  for (const [h, chip, kind] of got) assert.equal(chip, kind, `at ${h} h the chip says ${chip}, kind.js says ${kind}`);
  assert.deepEqual(got.map((g) => g[1]), ['fresh', 'stale', 'stale', 'very-stale']);
  // the words follow the state: the age is whole hours, never rounded up into a state the chip is not in
  assert.equal(chipModel(m, { now: t0 + 25.9 * 3600e3 }).tail, '25 h old');
  assert.equal(chipModel(m, { now: t0 + 48 * 3600e3 }).tail, '48 h old, stale');
  assert.equal(chipModel(m, { now: t0 + 48.1 * 3600e3 }).tail, '48 h old, very stale');
});

test('a recorded chip is kind.sampleLabel(short) with the run UTC date, and its detail is kind.sampleLabel()', () => {
  const rec = { sample: true, sample_label: 'Recorded forecast · ECMWF run 19 Nov 2026 00 UTC', model: 'ECMWF IFS HRES', run: '2026-11-19T00:00Z' };
  const c = chipModel(rec, { now: Date.parse('2026-11-19T12:00Z') });
  assert.equal(c.variants[0], K.sampleLabel(rec, { short: true }));
  assert.equal(c.variants[0], 'Recorded · 19 Nov · not live', 'UTC date, not the local 18 Nov');
  assert.equal(c.detail, K.sampleLabel(rec));
  for (const h of [0, 30, 50, 5000]) { const now = Date.parse(rec.run) + h * 3600e3; assert.equal(chipModel(rec, { now }).state, K.staleness(rec, now)); }
});

test('a live chip takes its model, weekday and time from kind.runLabel(), and its detail is runLabel() itself', () => {
  const m = { sample: false, model: 'ECMWF IFS HRES', run: '2026-11-19T00:00Z' };
  for (const zone of ['America/Los_Angeles', 'Asia/Kolkata', 'UTC']) {
    const c = chipModel(m, { now: Date.parse('2026-11-19T09:00Z'), zone });
    const label = K.runLabel(m, { zone });
    assert.equal(c.detail, label);
    const [, model, wd, time] = /^(.*) run (\S+) \d+ \S+, (.+) \S+$/.exec(label);
    assert.equal(c.lead, model); assert.equal(c.mid, `${wd} ${time} run`);
  }
  assert.equal(chipModel(m, { now: 0, zone: 'America/Los_Angeles' }).mid, 'Wed 4 pm run');
  // a dataset with cases is multi-case, whatever its run time; isLive decides before any age is read
  assert.equal(chipModel({ sample: true, run: m.run, cases: { A: { label: 'x' } }, fields: {} }, { now: Date.parse(m.run) + 99 * 3600e3 }).state, 'multi-case');
});

test('chip states: live fresh, stale, very stale, recorded, multi-case', () => {
  const f = chipModel(live(9), { now: NOW });
  assert.equal(f.state, 'fresh'); assert.equal(f.lead, 'ECMWF'); assert.match(f.tail, /^9 h old$/); assert.match(f.mid, /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+(:\d\d)? (am|pm) run$/);
  assert.equal(chipModel(live(30), { now: NOW }).state, 'stale');
  const vs = chipModel(live(60), { now: NOW });
  assert.equal(vs.state, 'very-stale'); assert.match(vs.tail, /very stale/);
  const rec = chipModel({ sample: true, sample_label: 'Recorded run', run: iso(NOW - 40 * 3600e3) }, { now: NOW });
  assert.equal(rec.state, 'recorded'); assert.equal(rec.tail, 'not live'); assert.equal(rec.lead, 'Recorded');
  const multi = chipModel({ sample: true, run: iso(NOW), cases: { A: { label: 'ERA5, 1-2 Jan 2017', fields: ['z500'] } }, fields: { z500: { source: { valid: ['2017-01-01T00:00Z'] } } } }, { now: NOW, caseId: 'A' });
  assert.equal(multi.state, 'multi-case'); assert.equal(multi.mid, '1 Jan 2017'); assert.equal(multi.tail, 'not a forecast');
  assert.equal(multi.detail, 'Sample data · ERA5, 1-2 Jan 2017 · not a forecast');
  assert.equal(chipModel(null), null);
});

test('no chip text carries a Z time suffix, in any state', () => {
  const all = [chipModel(live(9), { now: NOW }), chipModel(live(30), { now: NOW }), chipModel(live(60), { now: NOW }), chipModel({ sample: true, run: iso(NOW) }, { now: NOW }),
    chipModel({ sample: true, run: iso(NOW), cases: { A: { label: 'x' } }, fields: {} }, { now: NOW })];
  for (const m of all) for (const part of [m.lead, m.mid, m.tail, m.detail]) assert.doesNotMatch(String(part), /\d\s?Z\b|\bZ\b/, `Z suffix in "${part}"`);
});

test('chip variants: widest first, the tail is in every one, no variant is cut mid-word; no start date never invents one', () => {
  const m = chipModel({ sample: false, model: 'Synthetic test wave', run: iso(NOW - 60 * 3600e3) }, { now: NOW });
  assert.ok(m.variants.length >= 4);
  for (const v of m.variants) { assert.ok(v.endsWith(m.tail), v); assert.doesNotMatch(v, /…/); }
  for (let i = 1; i < m.variants.length; i++) assert.ok(m.variants[i].length < m.variants[i - 1].length);
  const nostart = chipModel({ sample: true, run: iso(NOW), cases: { A: { label: 'Synthetic wave', fields: [] } }, fields: {} }, { now: NOW, caseId: 'A' });
  assert.equal(nostart.mid, 'Synthetic wave'); assert.doesNotMatch(nostart.note, /starts/); assert.doesNotMatch(nostart.variants.join('|'), /past data/);
  const bare = chipModel({ sample: true, run: iso(NOW), cases: { A: { fields: [] } }, fields: {} }, { now: NOW, caseId: 'A' });
  assert.equal(bare.variants[0], 'Sample · not a forecast'); assert.doesNotMatch(bare.note, /starts/);
});
