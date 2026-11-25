// N24 LOOK: the Soft colour family (the default map colours) and the Reference (ECMWF) family kept as a choice.
// Soft is derived from Reference in OKLab (render/palette.js); these tests hold it to the rules it is built by, measured with colour
// maths written independently of the module: less chroma, hue kept, lightness order kept per arm, diverging arms symmetric, the
// neutral gap unshaded, every Night band at least 3:1 on both Night grounds, every major-edge hairline at least 1.5:1.
// And every consumer of band colours takes the family: bandRGBA, bandLUT, legendSpec, the timeline track, the story strip,
// the raster's band tables, the prefs key.
import test from 'node:test';
import assert from 'node:assert/strict';

const site = new URL('../../../site/js/', import.meta.url);
const load = (p) => import(new URL(p, site).href);

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
const C = (hex) => Math.hypot(...oklab(rgb(hex)).slice(1));
const hue = (hex) => { const [, a, b] = oklab(rgb(hex)); return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360; };
const hueDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const over = (ink, alpha, band) => band.map((v, i) => v * (1 - alpha) + ink[i] * alpha);
const IDS = ['z500a', 'ws250', 't850a', 'tp6', 'ivt', 'z500sd'];
const NIGHT_GROUNDS = ['#12161B', '#1C2127'];
const GROUNDS = ['paper', 'night'];
const arms = (p) => (p.armSplit == null ? [p.paper.map((_, i) => i)] : [p.paper.slice(0, p.armSplit).map((_, i) => i), p.paper.slice(p.armSplit).map((_, i) => i + p.armSplit)]);

test('Soft tables exist for every palette and ground, one band per Reference band, flagged a construction, not the Reference hex', async () => {
  const { PALETTES, MAP_COLORS, DEFAULT_COLORS, colorsOf, bandColors } = await load('render/palette.js');
  assert.deepEqual([...MAP_COLORS], ['soft', 'reference']);
  assert.equal(DEFAULT_COLORS, 'soft');
  assert.equal(colorsOf('reference'), 'reference');
  for (const v of [undefined, null, 'soft', 'ECMWF', 3]) assert.equal(colorsOf(v), 'soft', String(v));
  for (const id of IDS) {
    const p = PALETTES[id];
    assert.equal(p.softConstruction, true, id);
    for (const g of GROUNDS) {
      const soft = p.soft[g], ref = p[g];
      assert.equal(soft.length, ref.length, `${id} ${g}`);
      assert.ok(soft.every((h) => /^#[0-9a-f]{6}$/.test(h)), `${id} ${g} hex`);
      assert.deepEqual(bandColors(id, g), soft, `${id} ${g}: the default family is Soft`);
      assert.deepEqual(bandColors(id, g, 'reference'), ref, `${id} ${g}: Reference is the sourced table`);
      assert.ok(soft.filter((h, i) => h !== ref[i]).length >= Math.ceil(ref.length / 2), `${id} ${g}: Soft is its own table`);
    }
  }
});

test('Soft: chroma well under Reference on every palette (mean at most 0.6x), hue within 8 degrees wherever the band has colour', async () => {
  const { PALETTES, SOFT_CHROMA } = await load('render/palette.js');
  assert.ok(SOFT_CHROMA > 0.3 && SOFT_CHROMA <= 0.6, `SOFT_CHROMA ${SOFT_CHROMA}`);
  for (const id of IDS) for (const g of GROUNDS) {
    const p = PALETTES[id], soft = p.soft[g], ref = p[g];
    const cs = soft.reduce((a, h) => a + C(h), 0), cr = ref.reduce((a, h) => a + C(h), 0);
    assert.ok(cs <= cr * 0.6 + 1e-6, `${id} ${g}: mean chroma ${(cs / soft.length).toFixed(3)} vs Reference ${(cr / ref.length).toFixed(3)}`);
    soft.forEach((h, i) => {
      assert.ok(C(h) <= C(ref[i]) * SOFT_CHROMA + 0.01, `${id} ${g} band ${i}: chroma ${C(h).toFixed(3)} vs Reference ${C(ref[i]).toFixed(3)}`);
      if (C(h) > 0.03 && C(ref[i]) > 0.04) assert.ok(hueDiff(hue(h), hue(ref[i])) <= 8, `${id} ${g} band ${i}: hue ${hue(ref[i]).toFixed(1)} -> ${hue(h).toFixed(1)}`);
    });
  }
});

test('Soft: lightness keeps its direction along every arm (never reversed), and the two diverging arms are symmetric band for band', async () => {
  const { PALETTES } = await load('render/palette.js');
  for (const id of IDS) for (const g of GROUNDS) {
    const p = PALETTES[id], soft = p.soft[g], ref = p[g];
    for (const arm of arms(p)) for (let k = 1; k < arm.length; k++) {
      const dr = L(ref[arm[k]]) - L(ref[arm[k - 1]]), ds = L(soft[arm[k]]) - L(soft[arm[k - 1]]);
      if (Math.abs(dr) > 0.004) assert.ok(ds * dr > 0 || Math.abs(ds) < 0.004, `${id} ${g} lightness reversed at band ${arm[k]}: Reference ${dr.toFixed(3)}, Soft ${ds.toFixed(3)}`);
    }
  }
  // the diverging palettes: band i and band n-1-i are the same distance from zero; on Paper they share one lightness, and on
  // Night they stay within 0.03 (the 3:1 guard may lift a band of the darker hue a little)
  for (const id of ['z500a', 't850a']) {
    const p = PALETTES[id], n = p.paper.length;
    assert.equal(p.armSplit * 2, n, `${id}: arms of equal length`);
    for (let i = 0; i < p.armSplit; i++) {
      assert.ok(Math.abs(L(p.soft.paper[i]) - L(p.soft.paper[n - 1 - i])) < 0.012, `${id} paper pair ${i}/${n - 1 - i}: L ${L(p.soft.paper[i]).toFixed(3)} vs ${L(p.soft.paper[n - 1 - i]).toFixed(3)}`);
      assert.ok(Math.abs(L(p.soft.night[i]) - L(p.soft.night[n - 1 - i])) < 0.03, `${id} night pair ${i}/${n - 1 - i}`);
    }
  }
  // z500a: lightness falls outward from the gap on both arms on Paper (the extension stops included), so the strongest anomaly is the darkest
  const z = PALETTES.z500a;
  for (const idx of [Array.from({ length: z.armSplit }, (_, k) => z.armSplit - 1 - k), Array.from({ length: z.armSplit }, (_, k) => z.armSplit + k)]) {
    for (let k = 1; k < idx.length; k++) assert.ok(L(z.soft.paper[idx[k]]) <= L(z.soft.paper[idx[k - 1]]) + 1e-9, `z500a soft paper L rises outward at ${idx[k]}`);
    assert.ok(L(z.soft.paper[idx[0]]) - L(z.soft.paper[idx.at(-1)]) > 0.3, 'z500a soft: a wide lightness range from the gap outward');
  }
});

test('Soft Night: every band at least 3:1 on both Night grounds (the Reference floor, not lowered)', async () => {
  const { PALETTES } = await load('render/palette.js');
  for (const id of IDS) PALETTES[id].soft.night.forEach((h, i) => {
    for (const g of NIGHT_GROUNDS) assert.ok(contrast(rgb(h), rgb(g)) >= 3, `${id} soft night[${i}] ${h} on ${g}: ${contrast(rgb(h), rgb(g)).toFixed(2)}`);
  });
});

test('Soft: the neutral gap is unshaded and no data is transparent in both families', async () => {
  const { bandRGBA } = await load('render/palette.js');
  for (const c of ['soft', 'reference']) for (const g of GROUNDS) {
    for (const v of [-2, -0.5, 0, 1.99, 2]) assert.equal(bandRGBA('z500a', v, g, c)[3], 0, `z500a ${v} ${g} ${c}`);
    for (const v of [-0.9, 0, 1]) assert.equal(bandRGBA('t850a', v, g, c)[3], 0, `t850a ${v} ${g} ${c}`);
    assert.equal(bandRGBA('ws250', 29.9, g, c)[3], 0); assert.equal(bandRGBA('tp6', 0.05, g, c)[3], 0);
    assert.deepEqual(bandRGBA('z500a', NaN, g, c), [0, 0, 0, 0]);
    for (const v of [-45, -3, 3, 45]) assert.equal(bandRGBA('z500a', v, g, c)[3], 255, `${v} ${g} ${c} opaque`);
  }
});

test('Soft: the major-edge hairline is at least 1.5:1 against both bands at every major edge, on both grounds', async () => {
  const { PALETTES, bandIndex, edgeHairline } = await load('render/palette.js');
  const p = PALETTES.z500a;
  for (const g of GROUNDS) for (const e of p.majorEdges) {
    const h = edgeHairline('z500a', g, e, 'soft');
    for (const side of [e - 0.001, e + 0.001]) {
      const band = rgb(p.soft[g][bandIndex('z500a', side)]);
      const c = contrast(over(rgb(h.color), h.alpha, band), band);
      assert.ok(c >= 1.5, `${g} edge ${e} hairline ${h.color} on ${p.soft[g][bandIndex('z500a', side)]}: ${c.toFixed(2)}`);
    }
  }
});

test('bandRGBA, bandLUT and legendSpec follow the family; the default is Soft; Soft footers say the colours are softened', async () => {
  const { PALETTES, bandRGBA, bandLUT, legendSpec, bandIndex } = await load('render/palette.js');
  const hex = (c) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
  assert.equal(hex(bandRGBA('z500a', 6.9, 'paper', 'reference')), '#fe9400');
  assert.equal(hex(bandRGBA('z500a', 6.9, 'paper')), PALETTES.z500a.soft.paper[bandIndex('z500a', 6.9)]);
  assert.equal(hex(bandRGBA('z500a', -13, 'night', 'soft')), PALETTES.z500a.soft.night[bandIndex('z500a', -13)]);
  const pack = ([r, g, b, a]) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  assert.equal(bandLUT('ws250', 'paper', 11, 30, 80)[1], pack(bandRGBA('ws250', 35, 'paper', 'soft')));
  assert.equal(bandLUT('ws250', 'paper', 11, 30, 80, 'reference')[1], pack(bandRGBA('ws250', 35, 'paper', 'reference')));
  for (const id of IDS) for (const g of GROUNDS) {
    const soft = legendSpec(id, g, null, null, 'metric'), ref = legendSpec(id, g, null, null, 'metric', 'reference');
    const colours = (s) => s.stops.filter((x) => !x.gap).map((x) => x.color);
    assert.ok(colours(soft).every((c) => PALETTES[id].soft[g].includes(c)), `${id} ${g}: Soft legend draws Soft bands`);
    assert.ok(colours(ref).every((c) => PALETTES[id][g].includes(c)), `${id} ${g}: Reference legend draws the Reference bands`);
    assert.deepEqual(soft.ticks, ref.ticks, `${id}: the same ticks in both families`);
  }
  assert.match(legendSpec('ws250', 'paper').footer, /softened/);
  assert.match(legendSpec('tp6', 'paper').footer, /softened/);
  assert.match(legendSpec('t850a', 'paper').footer, /softened/);
  assert.equal(legendSpec('ws250', 'paper', null, null, 'metric', 'reference').footer, 'Colours follow ECMWF’s 200 hPa wind chart; below 30 m/s nothing is shaded');
  assert.equal(legendSpec('z500a', 'paper').footer, legendSpec('z500a', 'paper', null, null, 'metric', 'reference').footer);
});

test('the raster band tables and the timeline track take the family (the story strip: wp11.strip S5b)', async () => {
  const { bandTables } = await load('render/sample.js');
  const { bandRGBA, PALETTES } = await load('render/palette.js');
  const { trackCells } = await load('time/model.js');
  const soft = bandTables('z500a', 'paper', 'soft'), ref = bandTables('z500a', 'paper', 'reference'), dflt = bandTables('z500a', 'paper');
  assert.equal(dflt, soft, 'no family is Soft (one cached table)');
  assert.notDeepEqual([...soft.colors], [...ref.colors]);
  const j = PALETTES.z500a.neutralInterval + 3; // a positive band
  assert.deepEqual(ref.rgbs[j], PALETTES.z500a.rgbs.reference.paper[j - 1]);
  assert.deepEqual(soft.rgbs[j], PALETTES.z500a.rgbs.soft.paper[j - 1]);
  const series = { steps: [0, 6, 12], values: [90, -150, 5] }; // gpm: +9, -15 and +0.5 dam
  for (const c of [undefined, 'soft', 'reference']) {
    const cells = trackCells([0, 6, 12], { z500a: series, ground: 'paper', colors: c });
    assert.deepEqual(cells[0].rgba, bandRGBA('z500a', 9, 'paper', c), `track ${c}`);
    assert.deepEqual(cells[1].rgba, bandRGBA('z500a', -15, 'paper', c));
    assert.equal(cells[2].state, 'blank');
  }
  assert.notDeepEqual(trackCells([0], { z500a: series, colors: 'reference' })[0].rgba, trackCells([0], { z500a: series })[0].rgba);
});

test('prefs: Map colors is Soft until Reference is chosen, and an unknown value reads as Soft', async () => {
  const { prefs, COLORS } = await load('ui/prefs.js');
  assert.deepEqual(COLORS, ['soft', 'reference']);
  assert.equal(prefs.colors(), 'soft');
  prefs.set('colors', 'reference'); assert.equal(prefs.colors(), 'reference');
  prefs.set('colors', 'loud'); assert.equal(prefs.colors(), 'soft');
  prefs.set('colors', 'soft'); assert.equal(prefs.colors(), 'soft');
});

test('About this data: the Style and Constructions rows follow the colour family; the default (Soft) never claims ECMWF colours', async () => {
  const { aboutStyleRows } = await import('../../../site/js/ui/guide.js');
  const { bandColors, PALETTES } = await import('../../../site/js/render/palette.js');
  const rowsOf = (c) => Object.fromEntries(aboutStyleRows(c));
  for (const c of [undefined, 'soft', 'bogus']) {
    const r = rowsOf(c);
    assert.deepEqual(Object.keys(r), ['Style', 'Constructions'], `rows for ${c}`);
    assert.match(r.Style, /^Soft colours, softened from ECMWF/, `Style for ${c}: ${r.Style}`);
    assert.doesNotMatch(r.Style, /^ECMWF colours/, `Style for ${c} must not claim ECMWF colours`);
    assert.match(r.Constructions, /Every map colour, on Paper and on Night, is our own construction/, `Constructions for ${c}`);
    assert.doesNotMatch(r.Constructions, /past ±40 dam/, `Soft Constructions must not limit the construction to the extension stops`);
  }
  const ref = rowsOf('reference');
  assert.match(ref.Style, /^ECMWF colours/);
  assert.match(ref.Constructions, /Colours past ±40 dam and every colour on the Night ground are our own construction/);
  // the wording matches the palette: Soft is flagged a construction and its Paper bands are not the Reference hex
  const p = PALETTES.z500a;
  assert.equal(p.softConstruction, true);
  assert.notDeepEqual([...bandColors('z500a', 'paper', 'soft')], [...bandColors('z500a', 'paper', 'reference')]);
});
