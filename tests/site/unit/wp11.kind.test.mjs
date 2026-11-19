// W2-06 data/kind.js: the three dataset kinds, staleness, the one sample label and the one run label.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const K = await import(new URL('../../../site/js/data/kind.js', import.meta.url).href);
const fx = (name) => JSON.parse(fs.readFileSync(new URL(`../fixtures/${name}/manifest.json`, import.meta.url), 'utf8'));

const live = { schema: 1, sample: false, model: 'ECMWF IFS HRES', run: '2026-11-18T12:00Z', generated: '2026-11-18T21:30Z' };
const rec = { schema: 1, sample: true, sample_label: 'Recorded forecast · ECMWF run 19 Nov 2026 00 UTC', model: 'ECMWF IFS HRES', run: '2026-11-19T00:00Z' };

test('K1 the predicates: live is not a sample, multi-case has cases, recorded is a sample without cases', () => {
  assert.deepEqual([K.isLive(live), K.isMultiCase(live), K.isRecorded(live)], [true, false, false]);
  assert.deepEqual([K.isLive(rec), K.isMultiCase(rec), K.isRecorded(rec)], [false, false, true]);
  const sm = fx('sample-min');
  assert.deepEqual([K.isLive(sm), K.isMultiCase(sm), K.isRecorded(sm)], [false, true, false]);
  const rm = fx('recorded-min');
  assert.deepEqual([K.isLive(rm), K.isMultiCase(rm), K.isRecorded(rm)], [false, false, true]);
  assert.deepEqual([K.isLive(null), K.isMultiCase(undefined), K.isRecorded(null)], [false, false, false]);
});

test('K2 staleness: fresh at 22 h, stale at 30 h, very-stale at 50 h, boundaries at 26 and 48, recorded never stale', () => {
  const at = (h) => Date.parse(live.run) + h * 3600e3;
  assert.equal(K.ageHours(live, at(22)), 22);
  assert.deepEqual([22, 30, 50].map((h) => K.staleness(live, at(h))), ['fresh', 'stale', 'very-stale']);
  assert.deepEqual([25.99, 26, 48, 48.01].map((h) => K.staleness(live, at(h))), ['fresh', 'stale', 'stale', 'very-stale']);
  for (const m of [rec, fx('recorded-min'), fx('sample-min')]) {
    for (const h of [0, 30, 50, 5000]) assert.equal(K.staleness(m, Date.parse(m.run) + h * 3600e3), 'recorded');
  }
});

test('K3 the one sample label: long form carries "not live", short form is the phone chip, live has none', () => {
  assert.equal(K.sampleLabel(rec), 'Recorded forecast · ECMWF run 19 Nov 2026 00 UTC · not live');
  assert.equal(K.sampleLabel(rec, { short: true }), 'Recorded · 19 Nov · not live');
  assert.equal(K.sampleLabel(live), '');
  assert.equal(K.sampleLabel(live, { short: true }), '');
  assert.equal(K.sampleLabel(fx('recorded-min')), 'Recorded run shape (synthetic stand-in), run 2026-11-17 00Z · not live');
  assert.match(K.sampleLabel(fx('sample-min'), { short: true }), /^Sample · 17 Nov · not live$/);
});

test('K4 the one run label: weekday, date, local time and the zone name; a non-live dataset returns its sample label', () => {
  assert.equal(K.runLabel(live, { zone: 'America/Los_Angeles' }), 'ECMWF run Wed 18 Nov, 4 am PST');
  assert.equal(K.runLabel({ ...live, run: '2026-11-19T00:00Z' }, { zone: 'America/Los_Angeles' }), 'ECMWF run Wed 18 Nov, 4 pm PST');
  assert.equal(K.runLabel(live, { zone: 'UTC' }), 'ECMWF run Wed 18 Nov, 12 pm UTC');
  assert.equal(K.runLabel(rec), K.sampleLabel(rec));
  assert.equal(K.runLabel(null), '');
});
