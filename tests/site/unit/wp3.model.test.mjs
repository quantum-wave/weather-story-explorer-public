// WP3 pure timeline helpers: day bands, trip spans, ribbon, steps, easing, readout.
import test from 'node:test';
import assert from 'node:assert/strict';

const m = await import(new URL('../../../site/js/time/model.js', import.meta.url).href);
// Local-midnight run so day bands are the same in any time zone the test runs in.
const RUN = new Date(2026, 10, 17, 0, 0, 0);
const vt = (h) => new Date(RUN.getTime() + h * 3600e3);

test('dayBands: 48 h from local midnight gives two full days with ticks at 0 and 24', () => {
  const b = m.dayBands(vt, 0, 48);
  assert.equal(b.length, 2);
  assert.deepEqual(b.map((x) => [x.t0, x.t1, x.tick]), [[0, 24, 0], [24, 48, 24]]);
  assert.deepEqual(b.map((x) => x.weekday), ['Tue', 'Wed']);
});
test('dayBands: a partial first day has no tick; 15 days gives 15 or 16 bands', () => {
  const b = m.dayBands(vt, 6, 36);
  assert.deepEqual(b.map((x) => [x.t0, x.t1, x.tick]), [[6, 24, null], [24, 36, 24]]);
  const n = m.dayBands(vt, 0, 360).length;
  assert.ok(n === 15 || n === 16, String(n));
});
test('dayBands uses the calendar: a DST change makes a 23 or 25 hour day, not a 24 hour drift', () => {
  const t = (h) => new Date(Date.UTC(2026, 2, 8, 0, 0) + h * 3600e3);
  const b = m.dayBands(t, 0, 96);
  for (const x of b) { const d = x.date; assert.equal(d.getHours(), 0); }
});
test('tripSpans: end date inclusive, clipped, outside dropped, malformed skipped', () => {
  const trips = [
    { id: 'a', label: 'Tahoe', start: '2026-11-18', end: '2026-11-18' },
    { id: 'b', label: 'Far', start: '2027-01-01', end: '2027-01-03' },
    { id: 'c', label: 'Bad', start: 'nope', end: '2026-11-18' },
    { id: 'd', label: 'Past', start: '2026-11-10', end: '2026-11-17' },
  ];
  const s = m.tripSpans(trips, vt, 0, 48);
  assert.deepEqual(s.map((x) => [x.id, x.t0, x.t1]), [['a', 24, 48], ['d', 0, 24]]);
  assert.equal(s[1].clipStart, true);
  assert.equal(s[0].label, 'Tahoe');
});
test('confidenceBand follows SPEC section 6', () => {
  assert.equal(m.confidenceBand(2.9, 24), 'high');
  assert.equal(m.confidenceBand(3, 24), 'medium');
  assert.equal(m.confidenceBand(6, 24), 'medium');
  assert.equal(m.confidenceBand(6.1, 24), 'low');
  assert.equal(m.confidenceBand(1, 168), 'medium', 'days 8-10 at most medium');
  assert.equal(m.confidenceBand(8, 200), 'low');
  assert.equal(m.confidenceBand(0.5, 240), 'pattern-only');
  assert.equal(m.confidenceBand(null, 24), 'high');
  assert.equal(m.confidenceBand(null, 100), 'medium');
  assert.equal(m.confidenceBand(null, 200), 'low');
});
test('ribbonAlpha: bright when tight, dim when spread, never bright at long lead', () => {
  assert.equal(m.ribbonAlpha(1, 12), 1);
  assert.ok(m.ribbonAlpha(8, 12) <= 0.2 + 1e-9);
  assert.ok(m.ribbonAlpha(4, 12) > m.ribbonAlpha(6, 12));
  assert.ok(m.ribbonAlpha(0.1, 200) <= 0.6);
  assert.ok(m.ribbonAlpha(0.1, 300) <= 0.25);
});
test('ribbon: spread growing with lead gives runs high, medium, low; values are gpm (x0.1 dam)', () => {
  const spread = { steps: [0, 24, 48, 72, 96], values: Float32Array.from([10, 20, 35, 50, 70]) }; // gpm
  const r = m.ribbon(spread, 0, 96);
  assert.deepEqual(r.runs.map((x) => x.band), ['high', 'medium', 'low']);
  assert.deepEqual(r.runs.map((x) => x.word), ['Confident', 'Fairly sure', 'Uncertain']);
  assert.ok(r.pts[0].alpha > r.pts[r.pts.length - 1].alpha);
  assert.equal(r.bySpread, true);
});
test('ribbon without a spread series falls back to lead time and says so', () => {
  const r = m.ribbon(null, 0, 240);
  assert.equal(r.bySpread, false);
  assert.deepEqual(r.runs.map((x) => x.band), ['high', 'medium', 'low', 'pattern-only']);
});
test('nextStep clamps at the ends and skips the current step', () => {
  const st = [0, 12, 24, 36];
  assert.equal(m.nextStep(st, 0, 1), 12);
  assert.equal(m.nextStep(st, 12, 1), 24);
  assert.equal(m.nextStep(st, 13, -1), 12);
  assert.equal(m.nextStep(st, 36, 1), 36);
  assert.equal(m.nextStep(st, 0, -1), 0);
  assert.equal(m.nextStep(st, 5, 1), 12);
});
test('advance loops inside the range', () => {
  assert.equal(m.advance(10, 1000, 12, 0, 48), 22);
  assert.equal(m.advance(47, 1000, 12, 0, 48), 11);
  assert.equal(m.advance(0, 0, 12, 0, 0), 0);
});
test('easing is 0 to 1 and monotone', () => {
  assert.equal(m.easeInOutCubic(0), 0); assert.equal(m.easeInOutCubic(1), 1);
  let prev = -1; for (let i = 0; i <= 20; i++) { const v = m.easeInOutCubic(i / 20); assert.ok(v >= prev); prev = v; }
});
test('formatReadout', () => {
  const f = m.formatReadout(new Date(2026, 10, 22, 4, 0), 'PST');
  assert.equal(f.main, 'Sun 22 Nov, 4 am PST'); assert.equal(f.short, 'Sun 22 Nov, 4 am'); assert.equal(f.tz, 'PST');
  assert.equal(m.formatReadout(new Date(2026, 10, 22, 0, 0), '').main, 'Sun 22 Nov, 12 am');
  assert.equal(m.formatReadout(new Date(2026, 10, 22, 12, 0), '').main, 'Sun 22 Nov, 12 pm');
});
test('thinLabels keeps a minimum pixel gap', () => {
  const items = [{ t: 0 }, { t: 5 }, { t: 50 }, { t: 100 }];
  assert.deepEqual(m.thinLabels(items, 0, 100, 200, 60).map((x) => x.t), [0, 50, 100]);
});
test('percentile', () => { assert.equal(m.percentile([1, 2, 3, 4, 100], 95), 100); assert.equal(m.percentile([], 95), null); });
