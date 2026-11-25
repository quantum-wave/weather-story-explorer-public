// W2-03: the lens palettes and chart tokens (DESIGN-SPEC 4.2, 5.1, 5.4, 6.1, 10.1). Pure modules, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';

const site = new URL('../../../site/js/', import.meta.url);
const load = (p) => import(new URL(p, site).href);

// ---- colour maths, written independently of the module under test ----
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const Y = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const contrast = (a, b) => { const x = Y(a), y = Y(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const oklab = (c) => {
  const [r, g, b] = c.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const L = (hex) => oklab(rgb(hex))[0];
const range0 = (from, to) => { const o = []; if (to < from) for (let i = from; i > to; i--) o.push(i); else for (let i = from; i < to; i++) o.push(i); return o; };
const hue = (hex) => { const [, a, b] = oklab(rgb(hex)); return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360; };
const hueDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const over = (ink, alpha, band) => band.map((v, i) => v * (1 - alpha) + ink[i] * alpha);

// REF-20, listed literally: negative arm from -40..-38 up to -4..-2, then positive arm 2..4 up to 38..40.
const REF20_NEG = ['#000bfe', '#0017fe', '#0023fe', '#002ffe', '#003bfe', '#0047fe', '#0053fe', '#005ffe', '#006bfe', '#0077fe',
  '#0083fe', '#008ffe', '#009bfe', '#00a7fe', '#00b3fe', '#00bffe', '#00cbfe', '#00d7fe', '#00e3fe'];
const REF20_POS = ['#fea400', '#fe9c00', '#fe9400', '#fe8c00', '#fe8400', '#fe7c00', '#fe7400', '#fe6c00', '#fe6400', '#fe5c00',
  '#fe5400', '#fe4c00', '#fe4400', '#fe3c00', '#fe3400', '#fe2c00', '#fe2400', '#fe1c00', '#fe1400'];
const REF22 = ['#ffff00', '#a7e700', '#5dd000', '#1fb800', '#00a110', '#008a34', '#00724b'];
const REF26 = ['#003a58', '#0077b2', '#2fb9fe', '#98dbfe', '#fea998', '#fe5132', '#b21a00', '#580b00']; // the +-1 C neutral gap drops #cbedfe and #fed3cb (6.1)
const REF28 = ['#efdbb7', '#b5f9aa', '#77f472', '#b5eff9', '#77baf9', '#3d96f4', '#1e6ded', '#ffe877', '#ffa000', '#ff0000', '#a32121', '#ff00ff'];
const IDS = ['z500a', 'ws250', 't850a', 'tp6', 'ivt', 'z500sd'];
const GROUNDS = ['#12161B', '#1C2127'];

test('z500a Paper bands are the 38 ECMWF hex values of REF-20, exactly, plus flagged extension stops', async () => {
  const { PALETTES } = await load('render/palette.js');
  const p = PALETTES.z500a;
  assert.equal(REF20_NEG.length + REF20_POS.length, 38);
  const lo = p.sourced[0], hi = p.sourced[1];
  assert.deepEqual(p.paper.slice(lo, hi), [...REF20_NEG, ...REF20_POS]);
  assert.equal(p.paper.length, 42, '38 sourced + 4 extension stops');
  assert.deepEqual(p.paper.slice(0, lo), ['#3a0a6e', '#4b0fa8']);
  assert.deepEqual(p.paper.slice(hi), ['#a8102e', '#6e0a3a']);
  assert.equal(p.construction, true);
  assert.equal(p.unit, 'dam');
  assert.deepEqual(p.neutral, [-2, 2]);
  assert.deepEqual(p.majorEdges, [-40, -30, -20, -10, 10, 20, 30, 40]);
  // the closed form of REF-20 agrees with the literal table
  REF20_NEG.forEach((h, i) => { const k = 19 - i; assert.equal(h, '#' + [0, 0xe3 - 12 * (k - 1), 0xfe].map((v) => v.toString(16).padStart(2, '0')).join('')); });
});

test('z500a: alpha 0 inside +-2 dam, opaque bands elsewhere at every magnitude', async () => {
  const { bandRGBA } = await load('render/palette.js');
  for (const v of [-2, -1.99, -0.5, 0, 0.5, 1.99, 2]) for (const g of ['paper', 'night']) assert.equal(bandRGBA('z500a', v, g)[3], 0, `${v} ${g}`);
  for (const v of [-2.01, 2.01, -9, 9, -24, 24, -39.9, 39.9, -45, 45, -80, 80]) for (const g of ['paper', 'night']) assert.equal(bandRGBA('z500a', v, g)[3], 255, `${v} ${g}`);
  assert.deepEqual(bandRGBA('z500a', -3, 'paper', 'reference'), [0, 0xe3, 0xfe, 255]);
  assert.deepEqual(bandRGBA('z500a', 3, 'paper', 'reference'), [0xfe, 0xa4, 0, 255]);
  assert.deepEqual(bandRGBA('z500a', -39, 'paper', 'reference'), [0, 0x0b, 0xfe, 255]);
  assert.deepEqual(bandRGBA('z500a', 39, 'paper', 'reference'), [0xfe, 0x14, 0, 255]);
});

test('bandIndex edge cases: exactly +-2, no data, ties toward zero, beyond the range', async () => {
  const { PALETTES, bandIndex } = await load('render/palette.js');
  const p = PALETTES.z500a, sc = p.sourced[0];
  assert.equal(bandIndex('z500a', 2), -1, 'exactly +2 is neutral');
  assert.equal(bandIndex('z500a', -2), -1, 'exactly -2 is neutral');
  assert.equal(bandIndex('z500a', 0), -1);
  for (const bad of [NaN, null, undefined, Infinity, -Infinity, 'x']) assert.equal(bandIndex('z500a', bad), null, String(bad));
  assert.equal(p.paper[bandIndex('z500a', -3)], '#00e3fe');
  assert.equal(p.paper[bandIndex('z500a', 2.0001)], '#fea400');
  assert.equal(p.paper[bandIndex('z500a', 4)], '#fea400', 'a value on an edge takes the band nearer zero (+4)');
  assert.equal(p.paper[bandIndex('z500a', 4.0001)], '#fe9c00');
  assert.equal(p.paper[bandIndex('z500a', -4)], '#00e3fe', 'and -4');
  assert.equal(p.paper[bandIndex('z500a', -4.0001)], '#00d7fe');
  assert.equal(bandIndex('z500a', -40.5), sc - 1, 'beyond -40 is the first extension stop');
  assert.equal(bandIndex('z500a', -55), 0);
  assert.equal(bandIndex('z500a', -500), 0, 'beyond the range clamps to the last stop');
  assert.equal(bandIndex('z500a', 500), p.paper.length - 1);
  // sequential palettes: neutral below the first edge, an edge value takes the upper band
  assert.equal(bandIndex('ws250', 29.99), -1);
  assert.equal(bandIndex('ws250', 30), 0);
  assert.equal(bandIndex('ws250', 40), 1);
  assert.equal(bandIndex('ws250', 250), 6, 'beyond 100 m/s keeps the last band');
  assert.equal(bandIndex('tp6', 0.09), -1);
  assert.equal(bandIndex('tp6', 0.1), 0);
  assert.equal(bandIndex('ivt', 249.9), -1);
  assert.equal(bandIndex('ivt', 250), 0);
  assert.equal(bandIndex('ivt', 2000), 7);
});

test('ws250, t850a, tp6 Paper tables equal REF-22, REF-26, REF-28; ivt and z500sd follow 6.1 and are flagged construction', async () => {
  const { PALETTES } = await load('render/palette.js');
  assert.deepEqual(PALETTES.ws250.paper, REF22);
  assert.deepEqual(PALETTES.ws250.edges, [30, 40, 50, 60, 70, 80, 90]);
  assert.deepEqual(PALETTES.t850a.paper, REF26);
  assert.deepEqual(PALETTES.t850a.edges, [-10, -6, -3, -1, 1, 3, 6, 10]);
  assert.deepEqual(PALETTES.t850a.neutral, [-1, 1]);
  assert.deepEqual(PALETTES.tp6.paper, REF28);
  assert.deepEqual(PALETTES.tp6.edges, [0.1, 1, 2, 5, 10, 15, 20, 30, 40, 50, 100, 300]);
  assert.deepEqual(PALETTES.ivt.paper, ['#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026', '#54278f']);
  assert.deepEqual(PALETTES.ivt.edges, [250, 375, 500, 625, 750, 1000, 1250, 1500]);
  assert.equal(PALETTES.ivt.construction, true);
  assert.deepEqual(PALETTES.z500sd.edges, [2, 4, 6, 8, 12]);
  assert.equal(PALETTES.z500sd.paper.length, 5);
  assert.equal(PALETTES.z500sd.construction, true);
  for (const id of ['ws250', 'tp6']) assert.equal(PALETTES[id].construction, false, id + ' is sourced');
  for (const id of IDS) {
    const p = PALETTES[id];
    assert.equal(typeof p.unit, 'string');
    assert.equal(p.paper.length, p.night.length, id);
    assert.ok(p.paper.every((h) => /^#[0-9a-f]{6}$/.test(h)) && p.night.every((h) => /^#[0-9a-f]{6}$/.test(h)), id);
    assert.ok(p.edges.every((e, i) => i === 0 || e > p.edges[i - 1]), id + ' edges ascend');
    assert.equal(typeof p.toDisplay(3), 'number');
    assert.equal(typeof p.describe(3, {}), 'string');
    assert.ok(Array.isArray(p.majorEdges));
  }
});

test('Night: every band >= 3:1 on both Night grounds, lightness monotone per arm, hue order unchanged, z500a orange arm identical', async () => {
  const { PALETTES } = await load('render/palette.js');
  for (const id of IDS) {
    const p = PALETTES[id];
    p.night.forEach((h, i) => { for (const g of GROUNDS) assert.ok(contrast(rgb(h), rgb(g)) >= 3, `${id} night[${i}] ${h} on ${g}: ${contrast(rgb(h), rgb(g)).toFixed(2)}`); });
    // arms: a diverging palette splits at the neutral gap; the rest are one arm
    const split = p.armSplit; // index of the first band of the second arm, or null
    const arms = split == null ? [p.paper.map((_, i) => i)] : [p.paper.slice(0, split).map((_, i) => i), p.paper.slice(split).map((_, i) => i + split)];
    for (const arm of arms) {
      const lp = arm.map((i) => L(p.paper[i])), ln = arm.map((i) => L(p.night[i]));
      // direction of lightness along the arm on Paper is kept on Night, never reversed
      for (let k = 1; k < arm.length; k++) {
        const dp = lp[k] - lp[k - 1], dn = ln[k] - ln[k - 1];
        if (Math.abs(dp) > 0.004) assert.ok(dn * dp > 0 || Math.abs(dn) < 0.004, `${id} arm lightness not monotone at ${arm[k]}: paper ${dp.toFixed(3)} night ${dn.toFixed(3)}`);
      }
      // hue: each band stays within 8 degrees of its Paper hue, and bands whose Paper hues are clearly ordered (12 to 150 degrees apart; near 180 the direction is ambiguous) keep that order
      arm.forEach((i) => { if (L(p.paper[i]) >= 0.58) return; const chromaP = Math.hypot(...oklab(rgb(p.paper[i])).slice(1)); if (chromaP > 0.04) assert.ok(hueDiff(hue(p.paper[i]), hue(p.night[i])) <= 8, `${id} band ${i} hue ${hue(p.paper[i]).toFixed(1)} -> ${hue(p.night[i]).toFixed(1)}`); });
      for (let a = 0; a < arm.length; a++) for (let b = a + 1; b < arm.length; b++) {
        const hp = (hue(p.paper[arm[b]]) - hue(p.paper[arm[a]]) + 540) % 360 - 180;
        const hn = (hue(p.night[arm[b]]) - hue(p.night[arm[a]]) + 540) % 360 - 180;
        if (Math.abs(hp) > 12 && Math.abs(hp) < 150) assert.ok(hp * hn > 0, `${id} hue order flips between bands ${arm[a]} and ${arm[b]}`);
      }
    }
  }
  const z = PALETTES.z500a;
  // z500a including the extension stops: lightness strictly falls outward from the gap on both arms, and the two extension stops are distinguishable
  const lowOut = range0(z.armSplit - 1, -1), highOut = range0(z.armSplit, z.paper.length);
  for (const [idx, name] of [[lowOut, 'neg'], [highOut, 'pos']]) for (let k = 1; k < idx.length; k++) assert.ok(L(z.night[idx[k]]) < L(z.night[idx[k - 1]]), `z500a ${name} arm night L must strictly fall outward at band ${idx[k]}: ${L(z.night[idx[k - 1]]).toFixed(4)} -> ${L(z.night[idx[k]]).toFixed(4)}`);
  const nExt = z.paper.length - z.sourced[1];
  assert.equal(z.sourced[0], 2);
  for (const [a, b, name] of [[0, 1, 'neg'], [z.sourced[1], z.sourced[1] + 1, 'pos']]) {
    const dL = Math.abs(L(z.night[a]) - L(z.night[b])), c = contrast(rgb(z.night[a]), rgb(z.night[b]));
    assert.ok(dL >= 0.02 && c >= 1.05, `z500a ${name} extension stops on Night too alike: dL ${dL.toFixed(3)} contrast ${c.toFixed(3)}`);
  }
  assert.equal(nExt, 2);
  assert.deepEqual(z.night.slice(z.armSplit, z.sourced[1]), z.paper.slice(z.armSplit, z.sourced[1]), 'the sourced orange-red arm is identical on both grounds');
  // the two construction stops beyond +40 are too dark to read on Night, so they keep their hue and are lifted to L 0.58 or more
  z.night.slice(z.sourced[1]).forEach((h, i) => assert.ok(L(h) >= 0.575 && hueDiff(hue(h), hue(z.paper[z.sourced[1] + i])) <= 8, `ext ${h}`));
  assert.ok(L('#000bfe') < 0.58 && L('#fe1400') >= 0.58, 'the premise of the rule: blue arm dips below L 0.58, orange does not');
  assert.notDeepEqual(z.night.slice(0, z.armSplit), z.paper.slice(0, z.armSplit), 'blue arm is lifted');
  assert.ok(z.night.slice(0, z.armSplit).every((h) => L(h) >= 0.58 - 0.01), 'blue arm lifted to L 0.58 or more');
  // the lightest band of each remapped arm keeps its Paper lightness
  assert.equal(z.night[z.armSplit - 1], z.paper[z.armSplit - 1]);
  assert.equal(z.nightConstruction, true);
});

test('Night bandRGBA (Reference): z500a +30 dam is identical on both grounds, -30 is lifted', async () => {
  const { bandRGBA } = await load('render/palette.js');
  assert.deepEqual(bandRGBA('z500a', 30.5, 'night', 'reference'), bandRGBA('z500a', 30.5, 'paper', 'reference'));
  assert.notDeepEqual(bandRGBA('z500a', -39, 'night', 'reference'), bandRGBA('z500a', -39, 'paper', 'reference'));
});

test('band-edge hairline (Reference) is at least 1.5:1 against both adjacent bands at every major edge on Paper', async () => {
  const { PALETTES, bandIndex, edgeHairline } = await load('render/palette.js');
  const { CHART } = await load('render/chart-tokens.js');
  const p = PALETTES.z500a, tok = CHART.paper.bandEdge;
  assert.equal(tok.color, '#111417'); assert.equal(tok.alpha, 0.35);
  const report = [];
  for (const e of p.majorEdges) {
    const below = rgb(p.paper[bandIndex('z500a', e - 0.001)]), above = rgb(p.paper[bandIndex('z500a', e + 0.001)]);
    const h = edgeHairline('z500a', 'paper', e, 'reference');
    const ink = rgb(h.color);
    for (const band of [below, above]) {
      const c = contrast(over(ink, h.alpha, band), band);
      report.push(`${e}:${h.color}:${c.toFixed(2)}`);
      assert.ok(c >= 1.5, `edge ${e} hairline ${h.color} ${c.toFixed(2)}`);
    }
    if (h.color === tok.color) assert.equal(h.alpha, tok.alpha);
  }
  // the token ink alone does not clear 1.5:1 on the deepest blue edge: that is why the light variant exists
  const deep = rgb(p.paper[bandIndex('z500a', -39)]);
  assert.ok(contrast(over(rgb(tok.color), tok.alpha, deep), deep) < 1.5);
  assert.equal(edgeHairline('z500a', 'paper', -40, 'reference').color, CHART.paper.bandEdgeLight.color);
  assert.equal(edgeHairline('z500a', 'paper', 10, 'reference').color, tok.color);
  assert.equal(edgeHairline('z500a', 'paper', 7, 'reference'), null, 'only major edges carry a hairline');
  assert.ok(report.length === 16, report.join(' '));
});

test('describe: section 5.4 readout words, including the no-clear-signal form', async () => {
  const { PALETTES } = await load('render/palette.js');
  const d = (v, x) => PALETTES.z500a.describe(v, x);
  assert.equal(d(0.5), '+1 dam · near normal');
  assert.equal(d(-2), '−2 dam · near normal');
  assert.equal(d(4), '+4 dam · slightly above normal');
  assert.equal(d(-6), '−6 dam · slightly below normal');
  assert.equal(d(8), '+8 dam · a ridge');
  assert.equal(d(-10), '−10 dam · a trough');
  assert.equal(d(14), '+14 dam · strong ridge');
  assert.equal(d(-24), '−24 dam · strong trough');
  assert.equal(d(31), '+31 dam · exceptional ridge');
  assert.equal(d(-45), '−45 dam · exceptional trough');
  assert.equal(d(1.2, { signal: 'none', spread: 8 }), 'No clear signal yet\naverage of forecasts +1 dam, spread 8 dam');
  assert.equal(d(-3.4, { signal: 'none', spread: 5 }), 'No clear signal yet\naverage of forecasts −3 dam, spread 5 dam');
  assert.equal(d(14, { signal: 'clear' }), '+14 dam · strong ridge');
  assert.equal(d(NaN), '');
  for (const id of ['ws250', 't850a', 'tp6', 'ivt', 'z500sd']) assert.ok(PALETTES[id].describe(PALETTES[id].edges[2] + 1, {}).length > 3, id);
  assert.match(PALETTES.ivt.describe(800, {}), /strong/);
  assert.match(PALETTES.ws250.describe(62, {}), /62 m\/s/);
});

test('legendSpec z500a: the section 5.1 words (snapshot)', async () => {
  const { legendSpec } = await load('render/palette.js');
  const s = legendSpec('z500a', 'paper', -30, 30, 'metric', 'reference');
  assert.equal(s.title, 'Pressure pattern aloft, vs normal');
  assert.equal(s.subtitle, 'Height of the 500 hPa surface, about 5.5 km up, compared with the usual for this date.');
  assert.equal(s.unit, 'dam (tens of metres)');
  assert.deepEqual(s.ends, { low: 'lower: trough', high: 'higher: ridge' });
  assert.deepEqual(s.lineSample, { label: '564', text: 'the height itself: 564 = 5,640 m, every 60 m' });
  assert.equal(s.hatch, 'forecasts disagree here');
  assert.equal(s.footer, 'vs 1990-2019 normal; the world now runs warmer than that, so a faint orange is common');
  assert.deepEqual(s.ticks.map((t) => t.value), [-30, -20, -10, -2, 2, 10, 20, 30]);
  assert.deepEqual(s.ticks.map((t) => t.label), ['−30', '−20', '−10', '−2', '+2', '+10', '+20', '+30']);
  assert.deepEqual(s.ticks.map((t) => t.major), [true, true, true, false, false, true, true, true]);
  const gap = s.stops.filter((x) => x.gap);
  assert.equal(gap.length, 1); assert.deepEqual([gap[0].from, gap[0].to], [-2, 2]);
  assert.equal(s.stops.filter((x) => !x.gap).length, 28, '14 coloured bands per arm between 2 and 30');
  assert.equal(s.stops[0].from, -30); assert.equal(s.stops.at(-1).to, 30);
  assert.equal(s.stops[0].color, '#0047fe', '-30..-28');
  assert.equal(s.stops.at(-1).color, '#fe3c00', '28..30');
  const wide = legendSpec('z500a', 'night', -42, 42, 'metric', 'reference');
  assert.deepEqual(wide.ticks.map((t) => t.value).filter((v) => Math.abs(v) === 40), [-40, 40], '+-40 present when the range reaches it');
  const narrow = legendSpec('z500a', 'paper', -12, 12);
  assert.deepEqual(narrow.ticks.map((t) => t.value), [-10, -2, 2, 10]);
  assert.notEqual(legendSpec('z500a', 'night', -30, 30, 'metric', 'reference').stops[0].color, s.stops[0].color, 'Night lifts the blue arm');
  assert.equal(legendSpec('z500a', 'night', -30, 30, 'metric', 'reference').stops.at(-1).color, s.stops.at(-1).color, 'and keeps the orange arm');
  for (const id of IDS) { const l = legendSpec(id, 'paper', 0, 50); assert.ok(l.title && l.unit && Array.isArray(l.ticks) && Array.isArray(l.stops), id); }
});

test('bandLUT and LENS_FIELDS', async () => {
  const { bandLUT, bandRGBA, LENS_FIELDS, PALETTES } = await load('render/palette.js');
  const lut = bandLUT('z500a', 'paper', 81, -40, 40);
  assert.ok(lut instanceof Uint32Array && lut.length === 81);
  const pack = ([r, g, b, a]) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  assert.equal(lut[40], 0, 'v = 0 is transparent');
  assert.equal(lut[0], pack(bandRGBA('z500a', -40, 'paper')));
  assert.equal(lut[80], pack(bandRGBA('z500a', 40, 'paper')));
  assert.equal(bandLUT('z500a', 'paper', 81, -40, 40, 'reference')[60], pack(bandRGBA('z500a', 20, 'night', 'reference')), 'Reference: orange arm identical on Night');
  assert.equal(lut[60], pack(bandRGBA('z500a', 20, 'paper', 'soft')), 'the default LUT is Soft');
  assert.deepEqual(Object.keys(LENS_FIELDS).sort(), ['a', 'c', 'j', 'r', 's', 'z']);
  assert.deepEqual(LENS_FIELDS.z, { fill: 'z500a', lines: 'z500' });
  for (const k of Object.keys(LENS_FIELDS)) assert.ok(PALETTES[LENS_FIELDS[k].fill], k);
});

test('chart tokens equal section 10.1 for both grounds, with heavier basemap lines', async () => {
  const { CHART, chartTokens } = await load('render/chart-tokens.js');
  assert.equal(chartTokens('paper'), CHART.paper); assert.equal(chartTokens('night'), CHART.night);
  assert.equal(chartTokens('anything'), CHART.paper, 'unknown ground falls back to Paper');
  const P = CHART.paper, N = CHART.night;
  assert.deepEqual([P.ocean, P.land, N.ocean, N.land], ['#F6F7F9', '#E9E6E0', '#12161B', '#1C2127']);
  // Coast, border and state-line weights are heavier than the section 10.1 table (outlines were hard to see over the bands):
  // a 3 px casing at 0.9 under both, a 1.25 px border core at 0.85, state lines at 0.5 (chart-tokens.js says why).
  assert.deepEqual(P.coast, { color: '#1A1D21', alpha: 1, width: 1, casing: '#FFFFFF', casingAlpha: 0.9, casingWidth: 3 });
  assert.deepEqual(N.coast, { color: '#E6E9ED', alpha: 1, width: 1, casing: '#0B0D10', casingAlpha: 0.9, casingWidth: 3 });
  assert.deepEqual(P.border, { color: '#1A1D21', alpha: 0.85, width: 1.25, casing: '#FFFFFF', casingAlpha: 0.9, casingWidth: 3 });
  assert.deepEqual(N.border, { color: '#E6E9ED', alpha: 0.85, width: 1.25, casing: '#0B0D10', casingAlpha: 0.9, casingWidth: 3 });
  assert.deepEqual(P.stateLine, { color: '#1A1D21', alpha: 0.5, width: 0.75 });
  assert.deepEqual(N.stateLine, { color: '#E6E9ED', alpha: 0.5, width: 0.75 });
  assert.deepEqual(P.graticule, { color: '#1A1D21', alpha: 0.12, width: 0.5 });
  assert.deepEqual(N.graticule, { color: '#E6E9ED', alpha: 0.14, width: 0.5 });
  assert.deepEqual(P.contour, { color: '#111417', width: 1, boldWidth: 2, casing: null, casingAlpha: 0, casingWidth: 0 });
  assert.deepEqual(N.contour, { color: '#E6E9ED', width: 1, boldWidth: 2, casing: '#0B0D10', casingAlpha: 0.7, casingWidth: 2.5 });
  assert.deepEqual(P.contextContour, { color: '#111417', alpha: 0.35, width: 1 });
  assert.deepEqual(N.contextContour, { color: '#E6E9ED', alpha: 0.4, width: 1 });
  assert.deepEqual(P.bandEdge, { color: '#111417', alpha: 0.35, width: 1 });
  assert.deepEqual(N.bandEdge, { color: '#0B0D10', alpha: 0.45, width: 1 });
  assert.deepEqual(P.label, { ink: '#111417', halo: '#F6F7F9', haloWidth: 3 }, 'halo is the ground colour (ocean)');
  assert.deepEqual(N.label, { ink: '#E6E9ED', halo: '#12161B', haloWidth: 3 });
  assert.deepEqual(P.hatch, { color: '#1A1D21', alpha: 0.35, width: 1, pitch: 7, angle: 45 });
  assert.deepEqual(N.hatch, { color: '#E6E9ED', alpha: 0.35, width: 1, pitch: 7, angle: 45 });
  assert.deepEqual(P.noDataHatch, { color: '#1A1D21', alpha: 0.18, pitch: 6 });
  assert.deepEqual(N.noDataHatch, { color: '#E6E9ED', alpha: 0.2, pitch: 6 });
  assert.deepEqual(P.pin, { dot: '#1A1D21', ring: '#FFFFFF', ringWidth: 2 });
  assert.deepEqual(N.pin, { dot: '#E6E9ED', ring: '#0B0D10', ringWidth: 2 });
  assert.ok(Object.isFrozen(CHART.paper) && Object.isFrozen(CHART.night));
});
