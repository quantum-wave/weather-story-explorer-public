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

// ---- W3-08: the data-coloured track, honest readout, ruler, easing target (DESIGN-SPEC 7.1, 7.2)
const pal = await import(new URL('../../../site/js/render/palette.js', import.meta.url).href);
const conf = await import(new URL('../../../site/js/story/confidence.js', import.meta.url).href);
const ser = (steps, dam) => ({ steps, values: Float32Array.from(dam, (d) => d * 10) }); // stored in gpm

test('trackTimes: every step to 168 h, then every 12 h (6-hourly early, 12-hourly late)', () => {
  const steps = Array.from({ length: 61 }, (_, i) => i * 6);
  const t = m.trackTimes(steps);
  assert.equal(t.filter((x) => x <= 168).length, 29);
  assert.ok(t.filter((x) => x > 168).every((x) => x % 12 === 0), 'after 168 h only 12-hourly steps');
  assert.equal(t[t.length - 1], 360); assert.equal(t.includes(174), false); assert.equal(t.includes(180), true);
  assert.deepEqual(m.trackTimes([]), []);
});

test('trackCells: colour equals bandRGBA of the pattern value, blank inside +-2 dam, neutral where there is no clear signal', () => {
  const steps = [0, 6, 12, 18, 24];
  const z = ser(steps, [12, 1.5, -9, -25, 3]);
  const sd = ser(steps, [2, 2, 2, 2, 9]); // the last step: spread 9 dam > |3 dam|: no clear signal
  for (const ground of ['paper', 'night']) {
    const cells = m.trackCells(steps, { z500a: z, z500sd: sd, ground });
    assert.equal(cells.length, 5);
    assert.deepEqual(cells[0].rgba, pal.bandRGBA('z500a', 12, ground)); assert.equal(cells[0].state, 'band');
    assert.equal(cells[1].state, 'blank'); assert.equal(cells[1].rgba, null);
    assert.deepEqual(cells[2].rgba, pal.bandRGBA('z500a', -9, ground));
    assert.deepEqual(cells[3].rgba, pal.bandRGBA('z500a', -25, ground));
    assert.equal(cells[4].state, 'none', 'no clear signal'); assert.equal(cells[4].rgba, null);
  }
});
test('trackCells: cells tile [first, last] without gaps; a missing value is nodata, never a colour', () => {
  const steps = [0, 6, 12, 24];
  const z = { steps, values: Float32Array.from([100, NaN, -100, 50]) };
  const c = m.trackCells(steps, { z500a: z, z500sd: null, ground: 'paper' });
  assert.equal(c[0].from, 0); assert.equal(c[c.length - 1].to, 24);
  for (let i = 1; i < c.length; i++) assert.equal(c[i].from, c[i - 1].to);
  assert.equal(c[1].state, 'nodata'); assert.equal(c[1].rgba, null);
  assert.equal(m.trackCells([], { z500a: z, ground: 'paper' }).length, 0);
  assert.equal(m.trackCells(steps, { z500a: null, ground: 'paper' }).every((x) => x.state === 'nodata'), true);
});
test('blendSeries: the run to 168 h, a linear blend to the mean by 240 h, the mean after; no mean leaves the run', () => {
  const steps = [0, 168, 204, 240, 300];
  const run = { steps, values: Float32Array.from([100, 100, 100, 100, 100]) };
  const mean = { steps: [168, 204, 240, 300], values: Float32Array.from([0, 0, 0, 20]) };
  const b = m.blendSeries(run, mean);
  assert.deepEqual([...b.values].map((v) => Math.round(v * 100) / 100), [100, 100, 50, 0, 20]);
  assert.deepEqual([...m.blendSeries(run, null).values], [...run.values], 'no mean: the single run, honestly');
  assert.equal(m.blendSeries(null, mean), null);
});
test('nearestStep and dayOf', () => {
  assert.equal(m.nearestStep([0, 6, 12, 24], 8), 6); assert.equal(m.nearestStep([0, 6, 12, 24], 9), 12);
  assert.equal(m.nearestStep([0, 6, 12, 24], 99), 24); assert.equal(m.nearestStep([], 5), 5);
  assert.equal(m.isOnStep([0, 6, 12], 6.004), true); assert.equal(m.isOnStep([0, 6, 12], 7), false);
  assert.deepEqual(m.dayOf(0, 0, 360), { n: 1, of: 15 }); assert.deepEqual(m.dayOf(144, 0, 360), { n: 7, of: 15 });
  assert.deepEqual(m.dayOf(360, 0, 360), { n: 15, of: 15 }); assert.deepEqual(m.dayOf(30, 0, 36), { n: 2, of: 2 });
});
test('readoutLines: two lines, zone name on line 1, Day n of N and the run on line 2, "between model steps" off a step', () => {
  const d = new Date(2026, 10, 24, 16, 0);
  const a = m.readoutLines({ date: d, tz: 'PST', t: 144, lo: 0, hi: 360, run: 'ECMWF run Wed 18 Nov, 4 pm PST', between: false });
  assert.equal(a.line1, 'Tue 24 Nov · 4 pm PST');
  assert.equal(a.line2, 'Day 7 of 15 · ECMWF run Wed 18 Nov, 4 pm PST');
  const b = m.readoutLines({ date: d, tz: 'PST', t: 145, lo: 0, hi: 360, run: 'ECMWF run Wed 18 Nov, 4 pm PST', between: true });
  assert.match(b.line2, /^Day 7 of 15 · between model steps · ECMWF run/);
  assert.equal(m.readoutLines({ date: d, tz: '', t: 0, lo: 0, hi: 36, run: '' }).line2, 'Day 1 of 2');
  assert.ok(!/\b\d\dZ\b/.test(a.line1 + a.line2), 'no bare UTC hour beside a local date');
});
test('rulerLabel: "Tue 24", "Today" for the first live day, thinning is left to thinLabels', () => {
  const d = new Date(2026, 10, 24, 0, 0);
  assert.equal(m.rulerLabel({ date: d, weekday: 'Tue' }, { today: false }), 'Tue 24');
  assert.equal(m.rulerLabel({ date: d, weekday: 'Tue' }, { today: true }), 'Today');
});
test('zoneSpans: only from zones(); no mean means no 51-forecasts caption', () => {
  const z = m.zoneSpans(360, { hasMean: true });
  assert.deepEqual(z.map((x) => [x.from, x.to, x.kind, x.caption]), conf.zones(360, { hasMean: true }).map((x) => [x.from, x.to, x.kind, x.caption]));
  const n = m.zoneSpans(360, { hasMean: false });
  assert.deepEqual(n.map((x) => [x.from, x.to, x.kind]), [[0, 168, 'hres'], [168, 360, 'hres-late']]);
  assert.ok(!n.some((x) => /51 forecasts/.test(x.caption)));
  assert.ok(!n.some((x) => x.kind === 'blend' || x.kind === 'mean'));
});
