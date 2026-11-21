// W4-04 (DESIGN-SPEC 6.1, MET-8): the Air mass and Atmospheric rivers lenses. Descriptor contents, readout words, availability,
// the colour record in rivers.js, and the pure mask-run helper behind the terrain hatch. The pixel checks are S-LENS-B.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const site = new URL('../../../site/js/', import.meta.url);
const load = (p) => import(new URL(p, site).href);
const code = (f) => fs.readFileSync(new URL(`lenses/${f}.js`, site), 'utf8');

test('both lenses are implemented, listed, named and in the registry order', async () => {
  const { LENSES, listed, lens } = await load('lenses/index.js');
  const A = lens('a'), R = lens('r');
  assert.equal(A.implemented, true); assert.equal(R.implemented, true);
  assert.equal(A.name, 'Air mass'); assert.equal(R.name, 'Atmospheric rivers');
  assert.ok(A.blurb.length > 10 && R.blurb.length > 10);
  assert.ok(listed().includes(A) && listed().includes(R));
  assert.deepEqual(LENSES.map((l) => l.id), ['pattern', 'jet', 'surface', 'airmass', 'rivers', 'confidence']);
  for (const L of [A, R]) {
    for (const k of ['answer', 'what', 'read']) assert.ok(typeof L.guide[k] === 'string' && L.guide[k].length > 40, `${L.id} guide.${k}`);
    assert.ok(Array.isArray(L.guide.worth) && L.guide.worth.length >= 1);
    assert.equal(typeof L.describe, 'function'); assert.equal(typeof L.available, 'function');
  }
});

test('Air mass: t850a fill in the REF-26 bins, grey z500 context lines, terrain mask marks', async () => {
  const { lens } = await load('lenses/index.js'), pal = await load('render/palette.js'), A = lens('a');
  assert.deepEqual(A.fill, { field: 't850a', palette: 't850a' });
  assert.deepEqual(pal.PALETTES.t850a.paper, ['#003a58', '#0077b2', '#2fb9fe', '#98dbfe', '#fea998', '#fe5132', '#b21a00', '#580b00']);
  assert.deepEqual(pal.PALETTES.t850a.neutral, [-1, 1], 'no fill inside +-1 C');
  assert.equal(pal.bandIndex('t850a', 0.99), -1); assert.equal(pal.bandIndex('t850a', -1), -1);
  assert.equal(A.lines.length, 1);
  assert.equal(A.lines[0].field, 'z500'); assert.equal(A.lines[0].tone, 'context', 'grey, not the Pattern ink');
  assert.deepEqual(A.lines[0].bold, [], 'no bold levels: the contours are context');
  assert.equal(typeof A.marks, 'function', 'the terrain hatch is a lens mark');
  assert.deepEqual(A.available({ fields: { t850a: {} } }), { ok: true });
  assert.deepEqual(A.available({ fields: {} }), { ok: false, reason: 'Not in this run' });
  assert.deepEqual(A.available(null), { ok: false, reason: 'Not in this run' });
});

test('Air mass readout: warm and cold words, and "above this level" where the field is masked', async () => {
  const { lens } = await load('lenses/index.js'), A = lens('a');
  assert.equal(A.describe(4), '+4 °C · warmer than normal');
  assert.equal(A.describe(-2), '−2 °C · a little cooler than normal');
  assert.equal(A.describe(0.5), '+1 °C · near normal');
  assert.equal(A.describe(8, { units: 'us' }), '+14 °F · much warmer than normal');
  const m = A.describe(NaN, { masked: true });
  assert.match(m, /above this level/i);
  assert.match(m, /no air-mass value/i);
  assert.equal(A.describe(NaN), '', 'no data and not masked: nothing to say');
  assert.equal(A.describe(undefined, { masked: false }), '');
});

test('maskRuns: merges masked cells of a row into one run, and rows into nothing else', async () => {
  const { maskRuns } = await load('lenses/airmass.js');
  const masked = (x, y) => x >= 8 && x < 20 && y >= 4 && y < 12; // a 12 x 8 block
  const runs = maskRuns(40, 20, 4, masked);
  assert.deepEqual(runs, [{ x: 8, y: 4, w: 12, h: 4 }, { x: 8, y: 8, w: 12, h: 4 }]);
  assert.deepEqual(maskRuns(40, 20, 4, () => false), []);
  const all = maskRuns(8, 8, 4, () => true);
  assert.deepEqual(all, [{ x: 0, y: 0, w: 8, h: 4 }, { x: 0, y: 4, w: 8, h: 4 }]);
});

test('maskRuns: a run that reaches the right edge is emitted when W is not a multiple of step', async () => {
  const { maskRuns } = await load('lenses/airmass.js');
  assert.deepEqual(maskRuns(10, 4, 4, () => true), [{ x: 0, y: 0, w: 10, h: 4 }]);
  assert.deepEqual(maskRuns(390, 4, 4, () => true), [{ x: 0, y: 0, w: 390, h: 4 }]);
  const right = maskRuns(390, 8, 4, (x) => x > 200);
  assert.equal(right.length, 2);
  assert.ok(right.every((r) => r.x === 200 && r.x + r.w === 390), JSON.stringify(right));
  assert.deepEqual(maskRuns(13, 6, 6, (x) => x > 6), [{ x: 6, y: 0, w: 7, h: 6 }], 'the 6 px motion step too');
});

test('Rivers: IVT fill from 250, contours every 250 from 250, CW3E words in the readout', async () => {
  const { lens } = await load('lenses/index.js'), pal = await load('render/palette.js'), R = lens('r');
  assert.deepEqual(R.fill, { field: 'ivt', palette: 'ivt' });
  assert.equal(pal.PALETTES.ivt.neutral[1], 250);
  assert.equal(R.lines.length, 1);
  const ln = R.lines[0];
  assert.equal(ln.field, 'ivt'); assert.equal(ln.step, 250); assert.equal(ln.from, 250, 'no 0 contour'); assert.equal(ln.style, 'contour');
  assert.equal(ln.labelEvery % 250, 0);
  // pixel colours the lens draws: 800 is the 750 band, 200 is unfilled
  assert.deepEqual(pal.bandRGBA('ivt', 800, 'paper'), [0xe3, 0x1a, 0x1c, 255]);
  assert.equal(pal.bandRGBA('ivt', 200, 'paper')[3], 0);
  assert.equal(pal.bandRGBA('ivt', 249.9, 'paper')[3], 0);
  assert.deepEqual(pal.bandRGBA('ivt', 250, 'paper'), [0xfe, 0xd9, 0x76, 255]);
  // the CW3E category words, one per band edge
  const words = [[300, 'weak atmospheric river'], [600, 'moderate atmospheric river'], [800, 'strong atmospheric river'], [1100, 'extreme atmospheric river'], [1300, 'exceptional atmospheric river']];
  for (const [v, w] of words) assert.equal(R.describe(v), `${v} kg/m/s · ${w}`);
  assert.match(R.describe(200), /below atmospheric-river strength/);
  assert.equal(R.describe(NaN), '');
  assert.equal(typeof R.marks, 'undefined', 'rivers draws no marks');
});

test('rivers.available: needs ivt, and says "Arrives with the 00Z run" when it is absent', async () => {
  const { lens } = await load('lenses/index.js'), R = lens('r');
  assert.deepEqual(R.available({ fields: { ivt: {} } }), { ok: true });
  assert.deepEqual(R.available({ fields: { z500a: {} } }), { ok: false, reason: 'Arrives with the 00Z run' });
  assert.deepEqual(R.available(null), { ok: false, reason: 'Arrives with the 00Z run' });
  assert.deepEqual(R.available({}), { ok: false, reason: 'Arrives with the 00Z run' });
});

test('rivers.js header records the ColorBrewer re-check, and every IVT hex it names is in the palette', async () => {
  const src = code('rivers'), header = src.split('\n').filter((l) => l.startsWith('//')).join('\n');
  const pal = await load('render/palette.js');
  assert.match(header, /colorbrewer/i);
  assert.match(header, /YlOrRd/); assert.match(header, /Purples/);
  assert.match(header, /2026-11-\d\d/, 'dated');
  for (const hex of pal.PALETTES.ivt.paper) assert.ok(header.includes(hex), `header names ${hex}`);
  assert.match(header, /construction/i, 'says the colours are a construction, the thresholds sourced');
});

test('the finished lenses carry the guide in plain words, with no jargon the legend does not explain', async () => {
  const { lens } = await load('lenses/index.js');
  for (const id of ['a', 'r']) {
    const g = lens(id).guide, all = [g.answer, g.what, g.read, ...g.worth].join(' ');
    assert.ok(!/\b(IVT|T850|hPa)\b/.test(g.answer), `${id}: the answer line uses no code names`);
    assert.ok(!/coming soon|TODO|lorem/i.test(all));
  }
});
