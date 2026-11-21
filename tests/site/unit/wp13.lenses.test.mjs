// The lens registry (DESIGN-SPEC 6, section 15, W3-01): all six registered in order, only the finished one listed, the
// unbuilt five carry no drawing code and no text a person could read, and the Pattern descriptor is complete.
import test from 'node:test';
import assert from 'node:assert/strict';

const site = new URL('../../../site/js/', import.meta.url);
const load = (p) => import(new URL(p, site).href);

test('registry: six lenses in the spec order, listed() is exactly the implemented ones, lens(code) finds each', async () => {
  const { LENSES, listed, lens } = await load('lenses/index.js');
  assert.deepEqual(LENSES.map((l) => l.code), ['z', 'j', 's', 'a', 'r', 'c']);
  assert.deepEqual(LENSES.map((l) => l.id), ['pattern', 'jet', 'surface', 'airmass', 'rivers', 'confidence']);
  assert.deepEqual(listed().map((l) => l.id), LENSES.filter((l) => l.implemented).map((l) => l.id), 'only a finished lens is listed');
  assert.ok(listed().some((l) => l.id === 'pattern'));
  for (const l of LENSES) assert.equal(lens(l.code), l);
  assert.equal(lens('x'), undefined);
  assert.ok(Object.isFrozen(LENSES));
});

test('every unbuilt lens is implemented: false with no drawing code and no user-visible string', async () => {
  const { LENSES } = await load('lenses/index.js');
  for (const l of LENSES.filter((x) => !x.implemented)) {
    assert.equal(l.implemented, false, l.id);
    assert.deepEqual(Object.keys(l).sort(), ['code', 'fill', 'id', 'implemented', 'lines'], `${l.id}: only the registry fields`);
    assert.equal(l.fill, null); assert.deepEqual(l.lines, []);
    for (const [k, v] of Object.entries(l)) assert.ok(typeof v !== 'function', `${l.id}.${k} is not code`);
    for (const k of ['name', 'blurb', 'guide', 'describe', 'marks', 'available']) assert.ok(!(k in l), `${l.id} has no ${k}`);
  }
  // and the source files carry no string literal beyond their code and id (no "Coming soon", no label)
  const fs = await import('node:fs');
  for (const f of LENSES.filter((x) => !x.implemented).map((x) => x.id)) {
    const src = fs.readFileSync(new URL(`lenses/${f}.js`, site), 'utf8').split('\n').filter((ln) => !ln.trim().startsWith('//')).join('\n');
    const strings = [...src.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    assert.ok(strings.every((s) => /^[a-z]$/.test(s) || s === f || s === 'code' || s === 'id'), `${f}.js strings: ${strings}`);
    assert.ok(!/coming soon/i.test(src));
  }
});

test('Pattern is complete: fill, contour lines, guide, readout words, availability', async () => {
  const { lens } = await load('lenses/index.js'), pal = await load('render/palette.js'), P = lens('z');
  assert.equal(P.implemented, true); assert.equal(P.name, 'Pattern'); assert.ok(P.blurb.length > 10);
  assert.deepEqual(P.fill, { field: 'z500a', palette: 'z500a' });
  assert.ok(pal.PALETTES[P.fill.palette], 'the fill palette exists');
  assert.equal(pal.LENS_FIELDS.z.fill, P.fill.field); assert.equal(pal.LENS_FIELDS.z.lines, P.lines[0].field);
  assert.deepEqual(P.lines, [{ field: 'z500', step: 60, bold: [5520, 5640, 5760, 5880], labelEvery: 120, unit: 0.1, style: 'contour' }]);
  assert.deepEqual(P.lines[0].bold.map((b) => b * P.lines[0].unit), [552, 564, 576, 588], 'bold at 552, 564, 576, 588 dam');
  assert.ok(P.lines[0].step * P.lines[0].unit === 6 && P.lines[0].labelEvery * P.lines[0].unit === 12, 'every 6 dam, labelled every 12');
  for (const k of ['answer', 'what', 'read']) assert.ok(typeof P.guide[k] === 'string' && P.guide[k].length > 40, `guide.${k}`);
  assert.ok(Array.isArray(P.guide.worth) && P.guide.worth.length >= 1);
  assert.match(P.guide.answer, /^Yes, this is the pressure pattern/);
  // the readout words are the palette's (a ridge is orange, 6-12 dam)
  assert.equal(P.describe(14), '+14 dam · strong ridge');
  assert.equal(P.describe(-7), '−7 dam · a trough'); assert.equal(P.describe(1), '+1 dam · near normal');
  assert.match(P.describe(1, { signal: 'none', spread: 8 }), /^No clear signal yet/);
  // availability: needs the anomaly field, and says why with a data reason only
  assert.deepEqual(P.available({ fields: { z500a: {} } }), { ok: true });
  assert.deepEqual(P.available({ fields: {} }), { ok: false, reason: 'Not in this run' });
  assert.deepEqual(P.available(null), { ok: false, reason: 'Not in this run' });
});
