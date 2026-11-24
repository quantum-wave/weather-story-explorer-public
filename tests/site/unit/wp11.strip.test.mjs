// W2-06 story/strip.js: the monotone cubic, the columns, the hatch, the neutral ink where there is no clear signal, the
// phone end cell and the rain row. The strip draws through `document`; a minimal fake stands in for it here (the browser
// measurement of the real path is in S-STORY).
import test from 'node:test';
import assert from 'node:assert/strict';

class El {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.style = {}; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  // true when this element or an ancestor carries a clip-path: a clipped rect shows only the part inside the clip
  get clipped() { for (let e = this; e; e = e.parent) if (e.attrs && e.attrs['clip-path']) return true; return false; }
  get cls() { return (this.attrs.class || '').split(/\s+/); }
  all(sel) {
    const [tag, ...cl] = sel.split('.');
    const out = [];
    const walk = (e) => { for (const c of e.children) { if ((!tag || c.tag === tag) && cl.every((x) => c.cls.includes(x))) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
}
globalThis.document = { createElementNS: (_ns, tag) => new El(tag) };

const site = new URL('../../../site/js/', import.meta.url);
const ST = await import(new URL('story/strip.js', site).href);
const S = await import(new URL('story/index.js', site).href);
const PAL = await import(new URL('render/palette.js', site).href);
const num = (s) => s.match(/-?\d+(\.\d+)?/g).map(Number);

const N = 15;
const DATES = Array.from({ length: N }, (_, i) => new Date(Date.UTC(2026, 10, 16 + i)).toISOString().slice(0, 10));
const windows = DATES.map((date, i) => ({ date, startH: 24 * i, endH: 24 * i + 24 }));
const steps = (to, by = 12) => { const a = []; for (let h = 0; h <= to; h += by) a.push(h); return a; };
const series = (n, fn, extra = {}) => ({ windows: windows.slice(0, n), z500a: { steps: steps(24 * n), values: Float32Array.from(steps(24 * n), fn) }, ...extra });
const mk = (n, fn, extra, cov) => { const s = series(n, fn, extra); const d = s.windows.map((_, i) => S.classifyDay(s, i, i + 1)); if (cov) Object.defineProperty(d, 'coverage', { value: cov }); return [d, s]; };
const sine = (h) => 150 * Math.sin(h / 30);
// a run that carries the ensemble mean (z500em): the zones table has its blend (days 8-10) and mean (11-15) rows
const MEAN = { hasMean: true };

test('C1 tangents never overshoot and the cubic is C1 through every sample', () => {
  const xs = [0, 24, 48, 72, 96, 120, 144], ys = [0, 40, -35, -35, 20, 90, 10];
  const m = ST.tangents(xs, ys);
  for (let k = 0; k + 1 < xs.length; k++) {
    const lo = Math.min(ys[k], ys[k + 1]) - 1e-9, hi = Math.max(ys[k], ys[k + 1]) + 1e-9;
    for (let x = xs[k]; x <= xs[k + 1]; x += 0.5) { const y = ST.hermiteAt(xs, ys, m, x); assert.ok(y >= lo && y <= hi, `overshoot ${x} ${y}`); }
  }
  const d = ST.cubicSegments(xs, ys, m);
  assert.ok(/^(C[-\d. ]+)+$/.test(d), 'only cubic commands: no straight joins');
  const segs = d.split('C').slice(1).map(num);
  assert.equal(segs.length, xs.length - 1);
  // tangent continuity at every interior knot: incoming (end - c2) is parallel to outgoing (c1 - start)
  for (let k = 1; k < segs.length; k++) {
    const a = [segs[k - 1][4] - segs[k - 1][2], segs[k - 1][5] - segs[k - 1][3]], b = [segs[k][0] - segs[k - 1][4], segs[k][1] - segs[k - 1][5]];
    const cross = a[0] * b[1] - a[1] * b[0], dot = a[0] * b[0] + a[1] * b[1];
    assert.ok(Math.abs(cross) < 0.05 * Math.hypot(...a) * Math.hypot(...b) + 0.05, `knot ${k} cross ${cross}`);
    assert.ok(dot >= 0, `knot ${k} turns back`);
  }
});

test('C3 a peak beside a steep fall (real 6-hourly data at 15 days in 336 px) turns under 30 degrees, and random series never overshoot', () => {
  // knots from the recorded sample's San Francisco strip (x px, y px): flat rise to a peak, then a 4.7 px fall in 5.6 px
  const xs = [93.33, 98.93, 104.53, 110.13, 115.73], ys = [67.8, 68.47, 69.33, 64.61, 60.94];
  const m = ST.tangents(xs, ys);
  // the 14.3 measurement: points 2 px of path length either side of the knot (path length accumulated along the curve)
  const pts = []; let L = 0, prev = null;
  for (let x = xs[0]; x <= xs[4]; x += 0.001) { const p = [x, ST.hermiteAt(xs, ys, m, x)]; if (prev) L += Math.hypot(p[0] - prev[0], p[1] - prev[1]); prev = p; pts.push([L, ...p]); }
  const atL = (l) => pts.find((q) => q[0] >= l).slice(1);
  const kL = pts.find((q) => q[1] >= 104.53)[0];
  const a = atL(kL - 2), k = atL(kL), b = atL(kL + 2);
  const turn = Math.acos(((k[0] - a[0]) * (b[0] - k[0]) + (k[1] - a[1]) * (b[1] - k[1])) / (Math.hypot(k[0] - a[0], k[1] - a[1]) * Math.hypot(b[0] - k[0], b[1] - k[1]))) * 180 / Math.PI;
  assert.ok(turn < 30, `turn at the peak ${turn.toFixed(1)} deg`);
  // no overshoot, whatever the series (seeded)
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let trial = 0; trial < 400; trial++) {
    const n = 3 + Math.floor(rnd() * 30), X = [], Y = [];
    for (let i = 0; i < n; i++) { X.push(i ? X[i - 1] + 2 + rnd() * 10 : 0); Y.push(rnd() < 0.15 && i ? Y[i - 1] : (rnd() - 0.5) * 40); }
    const M = ST.tangents(X, Y);
    for (let i = 0; i + 1 < n; i++) {
      const lo = Math.min(Y[i], Y[i + 1]) - 1e-9, hi = Math.max(Y[i], Y[i + 1]) + 1e-9;
      for (let x = X[i]; x <= X[i + 1]; x += (X[i + 1] - X[i]) / 40) { const y = ST.hermiteAt(X, Y, M, x); assert.ok(y >= lo && y <= hi, `trial ${trial} overshoot at ${x}: ${y} outside [${lo}, ${hi}]`); }
    }
  }
});

test('C2 the drawn wave: a cubic path through the model steps, turning angle under 30 degrees, no overshoot', () => {
  const [d, s] = mk(7, sine);
  const svg = ST.stripSVG(d, s, { width: 336 });
  const path = svg.all('path.wave-line')[0];
  assert.ok(path, 'a wave line');
  assert.doesNotMatch(path.attrs.d, /L/, 'no straight joins');
  const knots = JSON.parse(path.attrs['data-knots']);
  assert.equal(knots.length, 15);
  const segs = path.attrs.d.split('C').slice(1).map(num);
  // sample each cubic and measure the chord turning angle at the knots and the range between knots
  const pt = (p0, c, t) => [0, 1].map((i) => (1 - t) ** 3 * p0[i] + 3 * (1 - t) ** 2 * t * c[i] + 3 * (1 - t) * t * t * c[2 + i] + t ** 3 * c[4 + i]);
  let maxTurn = 0;
  for (let k = 0; k < segs.length; k++) {
    const p0 = knots[k], lo = Math.min(knots[k][1], knots[k + 1][1]) - 0.06, hi = Math.max(knots[k][1], knots[k + 1][1]) + 0.06;
    for (let t = 0; t <= 1; t += 0.02) { const y = pt(p0, segs[k], t)[1]; assert.ok(y >= lo && y <= hi, `overshoot at ${k} ${t}`); }
    if (k > 0) {
      const prev = pt(knots[k - 1], segs[k - 1], 0.98), at = knots[k], next = pt(p0, segs[k], 0.02);
      const a = [at[0] - prev[0], at[1] - prev[1]], b = [next[0] - at[0], next[1] - at[1]];
      maxTurn = Math.max(maxTurn, Math.acos((a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b))) * 180 / Math.PI);
    }
  }
  assert.ok(maxTurn < 30, `turning angle ${maxTurn}`);
});

test('S1 one column per day with data, labelled "Thu 19", never a single initial; the key is real text; the height is fixed', () => {
  const [d, s] = mk(7, sine);
  const svg = ST.stripSVG(d, s, { width: 336 });
  assert.equal(svg.all('rect.strip-day').length, 7);
  assert.deepEqual(svg.all('text.strip-label').map((t) => t.textContent), ['Mon 16', 'Tue 17', 'Wed 18', 'Thu 19', 'Fri 20', 'Sat 21', 'Sun 22']);
  assert.equal(svg.all('rect.hatch-nodata').length, 0);
  assert.equal(svg.all('rect.hatch-pattern-only').length, 0);
  assert.deepEqual(svg.all('text.strip-key').map((t) => t.textContent), ['Orange: higher pressure aloft · Blue: lower'], 'no rain bars and no hatch drawn: the key names neither');
  assert.deepEqual(ST.keyLines({ rain: true, hatch: true }), ['Orange: higher pressure aloft · Blue: lower', 'Bars: rain · Hatch: pattern only, no detail']);
  assert.equal(svg.attrs.height, String(16 + 46 + 16), 'labels, wave and a one-line key: no rain row without rain');
  for (const t of svg.all('rect.strip-day')) assert.ok(+t.attrs.width >= 44, 'columns are at least 44 px wide on touch');
  const tap = svg.all('rect.strip-day')[2];
  assert.equal(tap.attrs['data-day'], '2'); assert.equal(+tap.attrs['data-t'], 60);
});

test('S2 the spread envelope only when z500sd exists', () => {
  const [d, s] = mk(7, sine);
  assert.equal(ST.stripSVG(d, s, {}).all('polygon.envelope').length, 0);
  const sd = { steps: steps(168), values: Float32Array.from(steps(168), (h) => 20 + h / 4) };
  const [d2, s2] = mk(7, sine, { z500sd: sd });
  assert.equal(ST.stripSVG(d2, s2, {}).all('polygon.envelope').length, 1);
});

test('S3 with the ensemble mean the hatch marks only days beyond day 10, once, with "pattern only"; days 8-10 get the dashed edge', () => {
  const [d, s] = mk(15, sine, MEAN);
  const svg = ST.stripSVG(d, s, { width: 420 });
  assert.equal(svg.all('rect.strip-day').length, 15);
  assert.equal(svg.all('rect.hatch-pattern-only').length, 5, 'days 11-15');
  assert.equal(svg.all('rect.hatch-nodata').length, 0);
  assert.equal(svg.all('text.strip-note').filter((t) => t.textContent === 'pattern only').length, 1);
  assert.equal(svg.all('line.zone-dashed').length, 1);
  assert.deepEqual(svg.all('text.strip-key').map((t) => t.textContent), ['Orange: higher pressure aloft · Blue: lower', 'Hatch: pattern only, no detail']);
});

test('S4 a day with no data is the only thing that earns the no-data hatch', () => {
  const [d, s] = mk(7, sine);
  d[3] = { ...d[3], pattern: 'none', wet: 'none', airMass: 'none', hi: undefined };
  assert.equal(ST.stripSVG(d, s, {}).all('rect.hatch-nodata').length, 1);
});

test('S5 slices take the palette colour of their value, blank inside +-2 dam, neutral ink at 40% where there is no clear signal', () => {
  const [d, s] = mk(7, () => -300); // -30 dam all week: Paper and Night differ here
  let svg = ST.stripSVG(d, s, { ground: 'paper' });
  const slices = svg.all('rect.slice');
  assert.ok(slices.length >= 1);
  const [r, g, b] = PAL.bandRGBA('z500a', -30, 'paper');
  assert.equal(slices[0].attrs.style, `fill:rgb(${r},${g},${b})`);
  assert.notEqual(PAL.bandRGBA('z500a', -30, 'night').join(), PAL.bandRGBA('z500a', -30, 'paper').join());
  svg = ST.stripSVG(d, s, { ground: 'night' });
  const [r2, g2, b2] = PAL.bandRGBA('z500a', -30, 'night');
  assert.equal(svg.all('rect.slice')[0].attrs.style, `fill:rgb(${r2},${g2},${b2})`);
  // near normal: no slice at all
  const [d0, s0] = mk(7, () => 10);
  assert.equal(ST.stripSVG(d0, s0, {}).all('rect.slice').length, 0, '+1 dam is inside the blank band');
  // no clear signal from day 4 on (mean small, spread large): those columns are neutral ink, the first three keep their band colour
  const sd = { steps: steps(168), values: Float32Array.from(steps(168), (h) => (h >= 72 ? 600 : 10)) };
  const [d3, s3] = mk(7, (h) => (h >= 72 ? 10 : 100), { z500sd: sd });
  assert.deepEqual(d3.map((c) => c.signal), ['clear', 'clear', 'clear', 'none', 'none', 'none', 'none']);
  svg = ST.stripSVG(d3, s3, { width: 336 });
  const none = svg.all('rect.slice.nosignal'), clr = svg.all('rect.slice').filter((x) => !x.cls.includes('nosignal'));
  assert.ok(none.length >= 1 && clr.length >= 1);
  assert.ok(none.every((x) => +x.attrs.x >= 144 - 2.01), 'neutral ink starts at day 4 (144 px)');
  assert.ok(clr.every((x) => +x.attrs.x + +x.attrs.width <= 144 + 2.5), 'band colours stop at day 4');
  assert.match(none[0].attrs.style, /var\(--ink\);opacity:\.4/);
});

test('P1 phone: ranges 10 and 15 show days 1-7 and one compressed end cell; expanded shows them all', () => {
  const [d, s] = mk(15, sine, MEAN);
  const ten = d.slice(0, 10);
  let svg = ST.stripSVG(ten, s, { width: 336, phone: true, range: 10 });
  assert.equal(svg.all('rect.strip-day').length, 7);
  assert.equal(svg.all('rect.strip-end').length, 1);
  assert.equal(svg.all('path.wave-line-mini').length, 1);
  assert.ok(svg.all('text.strip-label').some((t) => t.textContent === '8–10'));
  assert.match(svg.all('rect.strip-end')[0].attrs['aria-label'], /Days 8–10, broad pattern/);
  svg = ST.stripSVG(d, s, { width: 372, phone: true, range: 15 });
  assert.equal(svg.all('rect.strip-day').length, 7);
  assert.match(svg.all('rect.strip-end')[0].attrs['aria-label'], /Days 8–15, pattern only/);
  assert.ok(svg.all('rect.strip-day').every((t) => +t.attrs.width >= 44), 'full-width days are 44 px wide when the strip is 368 px or wider (7 x 44 + the 56 px end cell + 4)');
  assert.ok(+svg.all('rect.strip-end')[0].attrs.height >= 44, 'the end cell is at least 44 px tall');
  svg = ST.stripSVG(d, s, { width: 336, phone: true, range: 15, expanded: true });
  assert.equal(svg.all('rect.strip-day').length, 15);
  assert.equal(svg.all('rect.strip-end').length, 0);
  // desktop: all columns at once; a label is 41 to 44 px wide, so at 22 px per column the labels thin by measured width
  // (the first one slides in from the edge, which costs a slot): fewer than 15, more than a handful
  svg = ST.stripSVG(d, s, { width: 336 });
  assert.equal(svg.all('rect.strip-day').length, 15);
  assert.ok(svg.all('text.strip-label').length < 15 && svg.all('text.strip-label').length >= 5);
});

test('R1 the rain row: ink bars at four heights from tp6, outline filled to pr1 from day 4, omitted when no rain field', () => {
  const rainSteps = steps(168, 6).slice(1);
  const tp = { steps: rainSteps, values: Float32Array.from(rainSteps, (h) => ({ 0: 0.1, 1: 2, 2: 8, 3: 30 })[Math.floor(h / 24) % 4] / 4) };
  const [d, s] = mk(7, sine, { tp6: tp });
  const svg = ST.stripSVG(d, s, {});
  const bars = svg.all('rect.bar');
  assert.equal(bars.length, 7);
  assert.deepEqual(bars.slice(0, 4).map((b) => b.cls[1]), ['bar-dry', 'bar-light', 'bar-moderate', 'bar-heavy']);
  assert.ok(bars.every((b) => !/blue|#[0-9a-f]{6}/i.test(b.attrs.style) && /var\(--ink\)/.test(b.attrs.style)), 'ink, not blue');
  const hs = bars.slice(0, 4).map((b) => +b.attrs.height);
  assert.deepEqual([...hs].sort((a, b) => a - b), hs, 'four rising heights');
  assert.equal(svg.attrs.height, String(16 + 46 + 26 + 30));
  assert.deepEqual(svg.all('text.strip-key').map((t) => t.textContent), ['Orange: higher pressure aloft · Blue: lower', 'Bars: rain']);
  // pr1 from day 4
  const pr1 = { steps: [24, 48, 72, 96, 120, 144, 168], values: Float32Array.from([5, 5, 5, 75, 75, 75, 75]) };
  const [d2, s2] = mk(7, sine, { tp6: tp, pr1, pr10: pr1 });
  const svg2 = ST.stripSVG(d2, s2, {});
  assert.equal(svg2.all('rect.bar-prob').length, 4);
  assert.deepEqual(svg2.all('rect.bar-prob').map((b) => b.attrs['data-pr1']), ['75', '75', '75', '75']);
  const out = svg2.all('rect.bar-prob')[0], fillRect = svg2.all('rect.bar-prob-fill')[0];
  assert.ok(Math.abs(+fillRect.attrs.height - 0.75 * +out.attrs.height) < 0.02, 'filled to the probability');
});

test('T1 today: the first column reads Today, the next Tomorrow (or its short form when it would touch the next label), and the passed hours are greyed and named', () => {
  const cov = { kind: 'live', todayDate: '2026-11-16', nowH: 6 };
  const [d, s] = mk(7, sine, {}, cov);
  d[0].today = true; d[0].passedH = 8;
  const svg = ST.stripSVG(d, s, {});
  const labels = svg.all('text.strip-label').map((t) => t.textContent);
  // 48 px columns: "Tomorrow" (56 px) would touch "Wed 18" (42 px), so the second column takes its short form
  assert.deepEqual(labels.slice(0, 3), ['Today', 'Tue 17', 'Wed 18']);
  assert.deepEqual(ST.stripSVG(d, s, { width: 420 }).all('text.strip-label').map((t) => t.textContent).slice(0, 3), ['Today', 'Tomorrow', 'Wed 18'], '60 px columns: the long form fits');
  const passed = svg.all('g.passed');
  assert.equal(passed.length, 1);
  assert.equal(passed[0].all('title')[0].textContent, 'earlier today');
  assert.ok(+passed[0].all('rect')[0].attrs.width > 0 && +passed[0].all('rect')[0].attrs.width < 48);
  const [d2, s2] = mk(7, sine);
  assert.equal(ST.stripSVG(d2, s2, {}).all('g.passed').length, 0);
});

test('K1 compact (the peek and compact rows): 40 px, wave only, still tappable', () => {
  const [d, s] = mk(7, sine);
  const svg = ST.stripSVG(d, s, { compact: true });
  assert.equal(svg.attrs.height, '40');
  assert.equal(svg.all('text').length, 0 + svg.all('text.strip-note').length);
  assert.equal(svg.all('rect.bar').length, 0);
  assert.equal(svg.all('rect.strip-day').length, 7);
  assert.equal(svg.all('path.wave-line').length, 1);
});

test('L1 the legacy call (days, series, theme, opts) still draws, on the matching ground', () => {
  const [d, s] = mk(7, () => -300);
  const dark = S.stripSVG(d, s, 'dark', { width: 336 }), light = S.stripSVG(d, s, 'light', { width: 336 });
  assert.equal(dark.all('rect.strip-day').length, 7);
  assert.notEqual(dark.all('rect.slice')[0].attrs.style, light.all('rect.slice')[0].attrs.style);
});

test('B1 day labels never meet, never leave their region, and always keep the active day (estimated widths; the browser check measures real boxes)', () => {
  const forms = (n) => Array.from({ length: n }, (_, i) => (i === 0 ? ['Today'] : i === 1 ? ['Tomorrow', 'Tue 17'] : [`Day ${10 + i}`]));
  for (const [regionW, n] of [[313, 7], [313, 15], [324, 7], [262, 7], [640, 15], [336, 15], [336, 10]]) {
    const colW = regionW / n;
    for (const active of [-1, 0, 1, 2, n - 2, n - 1]) {
      const L = ST.layoutDayLabels(forms(n), colW, regionW, active);
      for (let k = 0; k < L.length; k++) {
        assert.ok(L[k].cx - L[k].w / 2 >= -0.01 && L[k].cx + L[k].w / 2 <= regionW + 0.01, `inside the region ${regionW}/${n}/${active}: ${L[k].text}`);
        if (k) assert.ok(L[k].cx - L[k].w / 2 - (L[k - 1].cx + L[k - 1].w / 2) >= ST.LABEL_GAP - 1e-9, `${ST.LABEL_GAP} px apart ${regionW}/${n}/${active}: ${L[k - 1].text} | ${L[k].text}`);
      }
      if (active >= 0) assert.ok(L.some((x) => x.i === active), `the active day keeps its label ${regionW}/${n}/${active}`);
    }
  }
  // the phone cell in the real strip: the last main label is clear of "Days 8-15" and the first is not cut at the edge
  const [d, s] = mk(15, sine);
  const svg = ST.stripSVG(d, s, { width: 324, phone: true, range: 15, activeDay: 3 });
  const xs = svg.all('text.strip-label').map((t) => +t.attrs.x);
  assert.ok(xs.every((x, k) => k === 0 || x > xs[k - 1]));
  // at 324 px the columns are 39 px: the labels fall back to weekdays (the selected day in semibold) rather than drop a day
  const main = svg.all('text.strip-label').filter((t) => !t.cls.includes('strip-label-end'));
  assert.equal(main.length, 7, 'every one of days 1-7 keeps a label: ' + main.map((t) => t.textContent));
  assert.ok(main.some((t) => /^Thu( 19)?$/.test(t.textContent) && /font:600/.test(t.attrs.style)), 'active day named, in semibold');
});

test('B2 a weekday alone stands in for a date only on the phone, and never when the caller asks for dates (very stale, spec 3.2)', () => {
  const [d, s] = mk(15, sine);
  const bare = (svg) => svg.all('text.strip-label').map((t) => t.textContent).filter((t) => /^[A-Z][a-z]{2}$/.test(t));
  for (const active of [0, 2, 3, 6]) {
    // desktop: 7 columns at 313 px, the width that dropped the dates (fails before: Mon | Tue | Wed | Thu 19 | ...)
    assert.deepEqual(bare(ST.stripSVG(d.slice(0, 7), s, { width: 313, activeDay: active })), [], `desktop 313 px, day ${active}: dated or thinned, never a weekday alone`);
    // phone, but the run is very stale: dates only
    assert.deepEqual(bare(ST.stripSVG(d, s, { width: 324, phone: true, range: 15, activeDay: active, weekdayLabels: false })), [], `phone, weekdayLabels false, day ${active}`);
  }
  // the phone itself still may (B1), so the option is what turns it off
  assert.ok(bare(ST.stripSVG(d, s, { width: 324, phone: true, range: 15, activeDay: 3 })).length > 0, 'the phone at 324 px uses weekdays');
});

test('B3 neighbours a little short of the gap are eased apart, never more than NUDGE, each still over its own column', () => {
  const forms = [['Mon 16'], ['Tue 17'], ['Wed 18'], ['Thu 19'], ['Fri 20'], ['Sat 21'], ['Sun 22']];
  for (const regionW of [313, 320, 340]) {
    const colW = regionW / 7;
    for (let active = 0; active < 7; active++) {
      const L = ST.layoutDayLabels(forms, colW, regionW, active);
      for (let k = 0; k < L.length; k++) {
        const c = colW * (L[k].i + 0.5);
        assert.ok(Math.abs(L[k].cx - Math.min(Math.max(c, L[k].w / 2), regionW - L[k].w / 2)) <= ST.NUDGE + 1e-6, `${regionW}/${active}: ${L[k].text} moved at most NUDGE`);
        assert.ok(L[k].cx > colW * L[k].i && L[k].cx < colW * (L[k].i + 1), `${regionW}/${active}: ${L[k].text} over its column`);
        if (k) assert.ok(L[k].cx - L[k].w / 2 - (L[k - 1].cx + L[k - 1].w / 2) >= ST.MIN_LABEL_GAP - 1e-6, `${regionW}/${active}: at least MIN_LABEL_GAP`);
      }
    }
  }
});

test('B2 wider fonts (a Linux runner, a fallback font, letter-spacing): the layout uses the measured widths, keeps LABEL_GAP, and thins rather than overlaps', () => {
  assert.ok(ST.LABEL_GAP >= 4, 'a real gap, not a hairline: ' + ST.LABEL_GAP);
  const forms = ['Today', 'Tue 17', 'Wed 18', 'Thu 19', 'Fri 20', 'Sat 21', 'Sun 22'].map((t, i) => (i === 1 ? ['Tomorrow', t] : [t]));
  // a stand-in width model, scaled from 1x to 2x (the Linux runner rendered wider than the macOS estimate assumed)
  const est = (t, bold) => (t.length * 7.2 + (/W/.test(t) ? 4 : 0)) * (bold ? 1.06 : 1);
  for (const scale of [1, 1.1, 1.25, 1.5, 2]) {
    const measure = (t, b) => est(t, b) * scale;
    for (const [regionW, n] of [[313, 7], [264, 7], [640, 7], [313, 15], [640, 15]]) {
      const fm = Array.from({ length: n }, (_, i) => forms[i % 7]);
      for (const active of [-1, 0, 1, 3, n - 1]) {
        const L = ST.layoutDayLabels(fm, regionW / n, regionW, active, measure);
        const where = `x${scale} ${regionW}/${n}/${active}: ${L.map((x) => x.text)}`;
        assert.ok(L.length >= 1, where);
        for (let k = 0; k < L.length; k++) {
          assert.ok(Math.abs(L[k].w - measure(L[k].text, L[k].i === active)) < 1e-9, 'the measured width is the one laid out ' + where);
          assert.ok(L[k].cx - L[k].w / 2 >= -0.01 && L[k].cx + L[k].w / 2 <= regionW + 0.01 || L.length === 1, 'inside ' + where);
          if (k) assert.ok(L[k].cx - L[k].w / 2 - (L[k - 1].cx + L[k - 1].w / 2) >= ST.LABEL_GAP - 1e-9, 'gap ' + where);
        }
        if (active >= 0) assert.ok(L.some((x) => x.i === active), 'active kept ' + where);
      }
    }
  }
  // 313 px, 7 columns, a quarter wider: the seven labels no longer fit with the gap, so the row is thinned
  const wide = ST.layoutDayLabels(forms, 313 / 7, 313, 1, (t, b) => est(t, b) * 1.25);
  assert.ok(wide.length < 7 && wide.length >= 3, 'thinned, not overlapped: ' + wide.map((x) => x.text));
});

test('B3 a row that misses the gap by a little is spread apart, each label within a fifth of its column, not thinned', () => {
  // the recorded week at 313 px on macOS: "Sun 22" (39.5 px) and "Mon 23" (42.7 px) in 44.7 px columns sit 3.6 px apart
  const colW = 313 / 7, ws = [41.86, 38.25, 32.58, 34.81, 39.52, 42.73, 38.75];
  const texts = ['Wed 18', 'Thu 19', 'Fri 20', 'Sat 21', 'Sun 22', 'Mon 23', 'Tue 24'];
  const measure = (t) => ws[texts.indexOf(t)];
  const L = ST.layoutDayLabels(texts.map((t) => [t]), colW, 313, -1, measure);
  assert.deepEqual(L.map((x) => x.text), texts, 'all seven kept');
  for (let k = 0; k < L.length; k++) {
    assert.ok(Math.abs(L[k].cx - colW * (k + 0.5)) <= colW / 5 + 1e-9 || k === 0, `label ${k} stays over its column: ${L[k].cx}`);
    if (k) assert.ok(L[k].cx - L[k].w / 2 - (L[k - 1].cx + L[k - 1].w / 2) >= ST.LABEL_GAP - 1e-9, `gap ${k}`);
  }
  // too far off to spread: null, so the caller thins
  assert.equal(ST.spreadLabels([{ cx: 20, w: 40 }, { cx: 40, w: 40 }], 20, 300), null);
  assert.equal(ST.spreadLabels([{ cx: 20, w: 30 }, { cx: 52, w: 30 }], 32, 300, 0), null, 'slack 0: placed as is or not at all');
});

test('N1 a no-signal day draws a visible neutral band even when its anomaly is near zero (P-B2/MET-14)', () => {
  // +1 dam all week, spread 5 dam: the curve sits on the normal line, so only a band can show the day is not "near normal"
  const sd = { steps: steps(168), values: Float32Array.from(steps(168), () => 50) };
  const [d, s] = mk(7, () => 10, { z500sd: sd });
  assert.ok(d.every((c) => c.signal === 'none'));
  const svg = ST.stripSVG(d, s, { width: 336 });
  const band = svg.all('rect.slice.nosignal');
  assert.ok(band.length >= 1);
  const area = band.reduce((a, r) => a + +r.attrs.width * +r.attrs.height, 0);
  assert.ok(area >= 336 * 8, `neutral area ${area}px2 covers the week at 8 px or more tall`);
  // the band must be visible, not merely present: a clip-path to the curve (which sits on the normal line here) would leave a sliver
  assert.ok(band.every((r) => !r.clipped), 'no-signal band is not inside a clip-path group');
  assert.ok(band.every((r) => +r.attrs.height >= 8 && /var\(--ink\);opacity:\.4/.test(r.attrs.style)));
  // a clear near-normal week (small spread) draws no band at all: the two read differently
  const [dc, sc] = mk(7, () => 10, { z500sd: { steps: steps(168), values: Float32Array.from(steps(168), () => 8) } });
  assert.ok(dc.every((c) => c.signal === 'clear'));
  assert.equal(ST.stripSVG(dc, sc, { width: 336 }).all('rect.slice.nosignal').length, 0);
});

test('N2 the phone end cell: 12 px label that fits the cell, and the mini wave sits on the cell normal line', () => {
  const [d, s] = mk(15, () => 0);
  const svg = ST.stripSVG(d, s, { width: 324, phone: true, range: 15 });
  const end = svg.all('text.strip-label-end')[0];
  assert.ok(end, 'end label drawn');
  assert.match(end.attrs.style, /font:12px/, 'no text under 12 px (14.3 rule 3)');
  assert.ok(end.textContent.length <= 5, 'short enough for the 56 px cell: ' + end.textContent);
  const cellLine = svg.all('line.end-normal-line')[0], mini = svg.all('path.wave-line-mini')[0], main = svg.all('path.wave-line').find((x) => !x.cls.includes('wave-line-mini'));
  const ys = JSON.parse(mini.attrs['data-knots']).map((k) => k[1]);
  assert.ok(ys.every((y) => Math.abs(y - +cellLine.attrs.y1) < 0.01), `mini baseline ${ys[0]} equals the cell line ${cellLine.attrs.y1}`);
  assert.equal(+cellLine.attrs.y1, +svg.all('line.normal-line')[0].attrs.y1, 'same normal line as the main strip');
  // a +10 dam wave in the cell rises from that line and a -10 dam wave falls from it
  for (const sign of [1, -1]) {
    const [d2, s2] = mk(15, () => sign * 100);
    const sv = ST.stripSVG(d2, s2, { width: 324, phone: true, range: 15 });
    const y = JSON.parse(sv.all('path.wave-line-mini')[0].attrs['data-knots'])[0][1], y0 = +sv.all('line.end-normal-line')[0].attrs.y1;
    assert.ok(sign * (y0 - y) > 3, `sign ${sign}: wave leaves the line on the right side (${y} vs ${y0})`);
  }
});

test('N3 the zone notes sit in a lane of their own, above the wave and clear of the day labels', () => {
  const [d, s] = mk(15, sine, MEAN);
  for (const [opts, words] of [[{ width: 640 }, ['broad pattern', 'pattern only']], [{ width: 336 }, null]]) {
    const svg = ST.stripSVG(d, s, opts);
    const top = +svg.all('rect.strip-day')[0].attrs.height; // whole column height, only to prove the lane exists
    const wave = svg.all('line.normal-line')[0], mid = +wave.attrs.y1;
    const notes = svg.all('text.strip-note');
    assert.ok(notes.length >= 1);
    if (words) assert.deepEqual(notes.map((t) => t.textContent), words);
    for (const t of notes) {
      assert.ok(+t.attrs.y < mid - 23 + 0.01, `note baseline ${t.attrs.y} is above the wave area (top ${mid - 23})`);
      assert.ok(+t.attrs.y - 10 >= 16 - 0.01, 'note box starts below the day-label lane');
      assert.match(t.attrs.style, /paint-order:stroke/);
    }
    assert.ok(top > 0);
  }
  // the two zone notes never meet each other (round-3 review: "broad rpattern only" at 313 px). Boxes from the text's x
  // and anchor with upper-bound widths of the real 12 px text (Chrome getBBox: 77.3 and 68.1 px; "broad" about 31);
  // the stacked end-cell words sit below the normal line, one per line, and are left out.
  const WIDE = { 'broad pattern': 80, 'pattern only': 71, broad: 34 };
  const box = (t) => { const w = WIDE[t.textContent], x = +t.attrs.x; assert.ok(w, 'known note ' + t.textContent); return t.attrs['text-anchor'] === 'end' ? [x - w, x] : t.attrs['text-anchor'] === 'middle' ? [x - w / 2, x + w / 2] : [x, x + w]; };
  let cases = 0;
  for (const n of [9, 10, 11, 12, 15]) {
    const [dn, sn] = mk(n, sine, MEAN);
    for (const [phone, expanded] of [[false, false], [true, true]]) for (let W = 260; W <= 720; W += 1) {
      const svg = ST.stripSVG(dn, sn, { width: W, phone, expanded, range: n > 10 ? 15 : 10 });
      const mid = +svg.all('line.normal-line')[0].attrs.y1;
      const lane = svg.all('text.strip-note').filter((t) => +t.attrs.y < mid).map((t) => [t.textContent, ...box(t)]);
      const where = `n=${n} W=${W} phone=${phone} expanded=${expanded}: ${JSON.stringify(lane)}`;
      for (const [, l, r] of lane) assert.ok(l >= -0.01 && r <= W + 0.01, 'note inside the strip ' + where);
      for (let a = 0; a < lane.length; a++) for (let b = a + 1; b < lane.length; b++) {
        assert.ok(lane[a][2] + 2 <= lane[b][1] || lane[b][2] + 2 <= lane[a][1], 'zone notes overlap ' + where);
      }
      // a strip that hatches days past 10 always says so
      if (svg.all('rect.hatch-pattern-only').length) assert.ok(lane.some((x) => x[0] === 'pattern only'), 'pattern only kept ' + where);
      cases++;
    }
  }
  assert.ok(cases > 4000, 'cases ' + cases);
});

// ---------- the "normal" label is never on the no-signal band, the curve or the fill (review round 2, item 1) ----------

// Text box of the 12 px label from its attributes: baseline - 12 to baseline + 3 (Chrome getBBox of the label: 15 px tall,
// 38.9 px wide); 40 px is the upper-bound width used here, independent of the strip's own estimate.
const NORMAL_W = 40;
function normalBox(svg) {
  const t = svg.all('text.strip-normal')[0];
  if (!t) return null;
  const x = +t.attrs.x, y = +t.attrs.y, a = t.attrs['text-anchor'];
  const l = a === 'end' ? x - NORMAL_W : a === 'middle' ? x - NORMAL_W / 2 : x;
  return { l, r: l + NORMAL_W, t: y - 12, b: y + 3 };
}
/** Points along the drawn wave path (M then cubic segments), sampled from its own d attribute. */
function curvePoints(svg) {
  const p = svg.all('path.wave-line').find((x) => !x.cls.includes('wave-line-mini'));
  if (!p) return [];
  const [head, ...segs] = p.attrs.d.split('C');
  let p0 = num(head); const out = [];
  for (const sg of segs) {
    const c = num(sg);
    for (let t = 0; t <= 1; t += 0.01) out.push([0, 1].map((i) => (1 - t) ** 3 * p0[i] + 3 * (1 - t) ** 2 * t * c[i] + 3 * (1 - t) * t * t * c[2 + i] + t ** 3 * c[4 + i]));
    p0 = [c[4], c[5]];
  }
  return out;
}
/** Every way the label can sit on something: a no-signal rect, the curve, or the band-colour fill between curve and line. */
function normalHits(svg) {
  const B = normalBox(svg);
  if (!B) return [];
  const hits = [];
  const meet = (r) => B.l < r.r && r.l < B.r && B.t < r.b && r.t < B.b;
  for (const r of svg.all('rect.slice.nosignal')) {
    const R = { l: +r.attrs.x, r: +r.attrs.x + +r.attrs.width, t: +r.attrs.y, b: +r.attrs.y + +r.attrs.height };
    if (meet(R)) hits.push('nosignal ' + JSON.stringify(R));
  }
  const pts = curvePoints(svg);
  const onCurve = pts.find(([x, y]) => x >= B.l && x <= B.r && y >= B.t && y <= B.b);
  if (onCurve) hits.push('curve ' + onCurve.map((v) => v.toFixed(1)));
  const mid = +svg.all('line.normal-line')[0].attrs.y1;
  const fills = svg.all('rect.slice').filter((r) => !r.cls.includes('nosignal')).map((r) => [+r.attrs.x, +r.attrs.x + +r.attrs.width]);
  for (const [x, y] of pts) {
    if (x < B.l || x > B.r || !fills.some(([a, b]) => x >= a && x <= b)) continue;
    if (Math.min(y, mid) < B.b && Math.max(y, mid) > B.t) { hits.push(`fill at x ${x.toFixed(1)}`); break; }
  }
  return hits.map((h) => `${h} vs label ${JSON.stringify(B)}`);
}

test('L1 the "normal" label stays off the no-signal band when the band is at the quiet end of the week (the recorded sample\'s Tue 24)', () => {
  // A trough early in the week, near normal and no clear signal at the end: the end where the wave is nearest the line is
  // the end holding the neutral band, so a label that picks its end from the wave alone sits on the band.
  const sd = { steps: steps(168), values: Float32Array.from(steps(168), (h) => (h >= 120 ? 60 : 8)) };
  const [d, s] = mk(7, (h) => (h < 120 ? -180 * Math.sin(Math.PI * Math.min(h, 96) / 96) - 30 : 10), { z500sd: sd });
  assert.deepEqual(d.map((c) => c.signal).slice(5), ['none', 'none']);
  for (const W of [313, 324, 336, 420, 640]) {
    const svg = ST.stripSVG(d, s, { width: W });
    assert.ok(svg.all('rect.slice.nosignal').length >= 1, 'the band is drawn');
    assert.ok(svg.all('text.strip-normal').length === 1, `the label is still drawn at ${W} px (a clear spot exists)`);
    assert.deepEqual(normalHits(svg), [], `${W} px`);
  }
});

test('L2 a no-signal band across the whole week moves the label off the band, not onto it', () => {
  const sd = { steps: steps(168), values: Float32Array.from(steps(168), () => 50) };
  const [d, s] = mk(7, () => 10, { z500sd: sd });
  const svg = ST.stripSVG(d, s, { width: 336 });
  assert.deepEqual(normalHits(svg), []);
  assert.equal(svg.all('text.strip-normal').length, 1, 'a 5 px band leaves room above or below it');
});

test('L3 sweep: whatever the wave, the band and the width, the label never meets the band, the curve or the fill', () => {
  let drawn = 0, cases = 0;
  for (const amp of [0, 40, 120, 250]) for (const phase of [0, 1, 2, 3, 4, 5]) for (const ns of [null, [0, 48], [96, 168], [120, 168], [0, 168], [48, 96]]) {
    const sd = { steps: steps(168), values: Float32Array.from(steps(168), (h) => (ns && h >= ns[0] && h <= ns[1] ? 70 : 6)) };
    const zf = (h) => (ns && h >= ns[0] && h <= ns[1] ? 15 : amp * Math.sin(h / 20 + phase));
    for (const today of [false, true]) {
      const [d, s] = mk(7, zf, { z500sd: sd }, today ? { todayDate: DATES[0] } : undefined);
      if (today) d[0] = { ...d[0], today: true, passedH: 20 };
      for (const W of [280, 313, 336, 420, 640]) {
        const svg = ST.stripSVG(d, s, { width: W });
        cases++;
        if (svg.all('text.strip-normal').length) drawn++;
        assert.deepEqual(normalHits(svg), [], `amp ${amp} phase ${phase} band ${ns} today ${today} W ${W}`);
      }
    }
  }
  assert.ok(drawn >= cases * 0.9, `the label is drawn in most strips: ${drawn} of ${cases}`);
});

// ---------- the zones table drives the strip; no ensemble mean means no blend (review round 2, item 2) ----------

const data = await import(new URL('data/index.js', site).href);
const { store } = await import(new URL('state.js', site).href);
const CF = await import(new URL('story/confidence.js', site).href);
const fsm = await import('node:fs');
const pathm = await import('node:path');
const fixtures = new URL('../fixtures/', import.meta.url).pathname;
const shim = (dir) => async (url) => {
  const f = pathm.join(dir, url.replace(/^data\//, ''));
  if (!fsm.existsSync(f)) return { ok: false, status: 404 };
  const buf = fsm.readFileSync(f);
  return { ok: true, status: 200, json: async () => JSON.parse(buf.toString()), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
const openFx = async (name) => { data._reset({ fetch: shim(pathm.join(fixtures, name)) }); store.set({ lens: 'z' }); return data.loadManifest(); };
const stripText = (svg) => [...svg.all('text').map((t) => t.textContent), ...svg.all('rect').map((r) => r.attrs['aria-label'] || '')].join(' | ');
const hatchedCols = (svg) => { const cols = svg.all('rect.strip-day'); return cols.map((c) => svg.all('rect.hatch-pattern-only').some((h) => +h.attrs.x === +c.attrs.x)); };

test('Z1 no ensemble mean (synthetic-15d-nomean, recorded-min): hatch from day 8, "pattern only" only, never "broad"', async () => {
  for (const fx of ['synthetic-15d-nomean', 'recorded-min']) {
    const m = await openFx(fx);
    assert.equal(m.fields.z500em, undefined, fx + ' has no z500em');
    const days = await S.buildDays(37.77, -122.42, 0, 14);
    assert.equal(days.series.hasMean, false, fx);
    const maxStep = m.fields.z500a.steps.at(-1);
    assert.deepEqual(CF.zones(maxStep, { hasMean: false }).map((z) => [z.from, z.to, z.kind]), [[0, 168, 'hres'], [168, maxStep, 'hres-late']]);
    assert.ok(days.length >= 10, `${fx}: days 8 and later exist (${days.length})`);
    for (const opts of [{ width: 640 }, { width: 336 }, { width: 324, phone: true, range: 15 }, { width: 324, phone: true, range: 15, expanded: true }]) {
      const svg = ST.stripSVG(days, days.series, opts);
      const where = `${fx} ${JSON.stringify(opts)}`;
      const cols = hatchedCols(svg), mainN = cols.length;
      assert.deepEqual(cols, days.slice(0, mainN).map((c) => c.lead >= 8), where + ': hatched exactly from day 8');
      assert.equal(svg.all('line.zone-dashed').length, 0, where + ': no dashed "broad pattern" zone');
      assert.doesNotMatch(stripText(svg), /broad/i, where + ': no "broad" anywhere');
      const notes = svg.all('text.strip-zone-note').map((t) => t.textContent);
      if (mainN > 7) assert.deepEqual(notes, ['pattern only'], where);
      if (opts.phone && !opts.expanded) assert.match(svg.all('rect.strip-end')[0].attrs['aria-label'], /pattern only/, where);
      // no rain bar under the hatch: "pattern only" means no detail
      for (const b of svg.all('rect.bar')) { const i = Math.floor(+b.attrs.x / (+svg.all('rect.strip-day')[0].attrs.width)); assert.ok(!cols[i], where + ' rain bar in hatched day ' + i); }
    }
  }
  // the same request on the run that carries the mean: days 8-10 blend ("broad pattern", dashed), the hatch from day 11
  await openFx('synthetic-15d');
  const days = await S.buildDays(37.77, -122.42, 0, 14);
  assert.equal(days.series.hasMean, true);
  const svg = ST.stripSVG(days, days.series, { width: 640 });
  assert.deepEqual(hatchedCols(svg), days.map((c) => c.lead >= 11));
  assert.equal(svg.all('line.zone-dashed').length, 1);
  assert.deepEqual(svg.all('text.strip-zone-note').map((t) => t.textContent), ['broad pattern', 'pattern only']);
});

test('Z2 the strip reads hasMean from the series, and an explicit option wins; unknown counts as no mean', () => {
  const [d, s] = mk(15, sine);
  assert.equal(ST.stripSVG(d, s, { width: 640 }).all('line.zone-dashed').length, 0, 'no hasMean: no blend zone');
  assert.equal(ST.stripSVG(d, { ...s, hasMean: true }, { width: 640 }).all('line.zone-dashed').length, 1);
  assert.equal(ST.stripSVG(d, { ...s, hasMean: true }, { width: 640, hasMean: false }).all('line.zone-dashed').length, 0);
  assert.equal(ST.stripSVG(d, { ...s, z500em: s.z500a }, { width: 640 }).all('line.zone-dashed').length, 1, 'a series carrying z500em has the mean');
  assert.equal(CF.zoneNote(CF.zones(360, { hasMean: false })[1]), 'pattern only');
  assert.equal(CF.zoneNote(CF.zones(360)[1]), 'broad pattern');
  assert.equal(CF.zoneNote(CF.zones(360)[0]), '');
});

test('L4 the product sample (tests/site/fixtures/recorded) at the home card width: "normal" clear of the band and the curve', async () => {
  await openFx('recorded');
  const days = await S.buildDays(37.77, -122.42, 0, 6);
  assert.ok(days.some((c) => c.signal === 'none'), 'the recorded run has a no-clear-signal day in San Francisco\'s week');
  for (const W of [313, 314, 324, 336, 640]) for (const active of [-1, 0, 3, 6]) {
    const svg = ST.stripSVG(days, days.series, { width: W, activeDay: active });
    assert.ok(svg.all('rect.slice.nosignal').length >= 1);
    assert.deepEqual(normalHits(svg), [], `recorded W ${W} active ${active}`);
  }
});

test('B4 where the platform draws labels off their placed x (no subpixel text positioning), the drawn row is checked and refitted: gaps and edges hold; where labels land as placed, nothing changes', () => {
  const est = (t, bold) => (t.length * 7.2 + (/W/.test(t) ? 4 : 0)) * (bold ? 1.06 : 1);
  // drawn at the strip's rounded x (0.01 px), then either exactly there or with the start snapped to a whole pixel
  const r2 = (x) => Math.round(x * 100) / 100;
  const snapped = (L) => L.map((a) => { const l = Math.round(r2(a.cx) - a.w / 2); return { l, r: l + a.w }; });
  const exact = (L) => L.map((a) => ({ l: r2(a.cx) - a.w / 2, r: r2(a.cx) + a.w / 2 }));
  const weeks = [['Today', 'Tue 17', 'Wed 18', 'Thu 19', 'Fri 20', 'Sat 21', 'Sun 22'], ['Today', 'Tomorrow', 'Wed 24', 'Thu 25', 'Fri 26', 'Sat 27', 'Sun 28'],
    ['Today', 'Fri 26', 'Sat 27', 'Sun 28', 'Mon 29', 'Tue 30', 'Wed 1']];
  let brokenWithoutCheck = 0, cases = 0;
  for (const days of weeks) {
    const forms = days.map((d, i) => (i === 0 ? [d] : d === 'Tomorrow' ? [d, 'Tue 23', 'Tue'] : [d, d, d.slice(0, 3)]));
    for (const measure of [undefined, est, (t, b) => est(t, b) * 1.03, (t, b) => est(t, b) * 1.1, (t, b) => est(t, b) * 1.25]) for (let regionW = 200; regionW <= 700; regionW += 3.5) for (const active of [-1, 0, 1, 3, 6]) {
      cases++;
      const where = `${days[1]}/${regionW}/${active}`;
      const L = ST.fitDayLabels(forms, regionW / 7, regionW, active, measure, snapped);
      assert.equal(ST.labelShortfall(snapped(L), regionW), 0, 'drawn row keeps the gap and the edges ' + where + ' ' + JSON.stringify(snapped(L)));
      if (active >= 0) assert.ok(L.some((a) => a.i === active), 'active day kept ' + where);
      if (ST.labelShortfall(snapped(ST.layoutDayLabels(forms, regionW / 7, regionW, active, measure)), regionW)) brokenWithoutCheck++;
      // labels that land where they are placed: exactly the plain layout (no day name lost)
      assert.deepEqual(ST.fitDayLabels(forms, regionW / 7, regionW, active, measure, exact), ST.layoutDayLabels(forms, regionW / 7, regionW, active, measure), 'unchanged ' + where);
    }
  }
  // pinned: on a precise platform the 313 px home card keeps all seven dated labels (no allowance leaks in)
  const wk = weeks[0].map((d, i) => (i ? [d, d, d.slice(0, 3)] : [d]));
  assert.deepEqual(ST.fitDayLabels(wk, 313 / 7, 313, -1, undefined, exact).map((a) => a.text), weeks[0]);
  // a renderer that is always short: every round is measured, and the last resort has more room than any measured row
  const seen = [];
  const gapOf = (L) => Math.min(...L.slice(1).map((a, k) => a.cx - a.w / 2 - (L[k].cx + L[k].w / 2)));
  const always = (L) => { seen.push(L); return L.map((a, k) => ({ l: k * 50, r: k * 50 + 48 })); };
  const last = ST.fitDayLabels(wk, 264 / 7, 264, -1, undefined, always);
  assert.equal(seen.length, 4, 'the first layout and three refits are all measured');
  // three capped refits (SNAP_ALLOWANCE each) and SNAP_ALLOWANCE on top: every planned gap keeps all of it
  assert.ok(last.length < 2 || gapOf(last) >= ST.LABEL_GAP + 4 * ST.SNAP_ALLOWANCE - 1e-6, 'the last resort keeps more room than any measured row: ' + gapOf(last));
  assert.notDeepEqual(last, seen.at(-1), 'the last resort is not the row last measured short');  // the check is what holds the gap: without it, snapping breaks rows across the sweep
  assert.ok(brokenWithoutCheck > 0, `snapping alone breaks ${brokenWithoutCheck} of ${cases} rows`);
});
