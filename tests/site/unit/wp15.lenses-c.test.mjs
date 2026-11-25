// W4-05 (Josh point 15): the Storms and rain lens (DESIGN-SPEC 6.1). Isobars every 4 hPa with two-digit labels, 1000 and 1020
// emphasised; H and L only at closed centres; 6-hour rain in the ECMWF bands (REF-28) from 0.1 mm; the mm / in switch.
// The grid fixture (synthetic-15d, msl on g1) is decoded here independently of site code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = new URL('../../../', import.meta.url).pathname;
const fx = path.join(root, 'tests/site/fixtures/synthetic-15d');
const site = new URL('../../../site/js/', import.meta.url);
const load = (p) => import(new URL(p, site).href);
const NODATA = -32768;

function frame(man, fid, dom, step) {
  const f = man.fields[fid], d = man.domains[dom], idx = f.steps.indexOf(step);
  const ci = f.chunks.findIndex((c) => c.steps[0] <= idx && idx < c.steps[1]), ch = f.chunks[ci];
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(fx, ch.files[dom].path)));
  const n = d.nx * d.ny, k = idx - ch.steps[0], seg = raw.subarray(k * n * 2, (k + 1) * n * 2), out = new Float64Array(n);
  for (let y = 0; y < d.ny; y++) {
    let acc = 0;
    for (let x = 0; x < d.nx; x++) {
      const i = y * d.nx + x;
      acc = (acc + ((seg[n + i] << 8) | seg[i])) & 0xFFFF;
      const q = acc >= 0x8000 ? acc - 0x10000 : acc;
      out[i] = q === NODATA ? NaN : q * f.scale + f.offset;
    }
  }
  return out;
}

/** A regional grid (not global) of `nx` x `ny` 1 degree cells with a value function (hPa) in Pa. */
const grid = (nx, ny, fn) => {
  const dom = { lon0: 200, lat0: 60, dlon: 1, dlat: -1, nx, ny }, v = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = fn(i, j) * 100;
  return { dom, v };
};

/** Strict interior local minima of a grid built by `grid` (all 8 neighbours higher): [[i, j, hPa]]. Independent of site code;
 * the tests use it to prove their own premise (a candidate exists) so a "no L" assertion cannot pass without the rule running. */
const minima = ({ dom: { nx, ny }, v }) => {
  const o = [];
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    let m = true;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && v[(j + dj) * nx + i + di] <= v[j * nx + i]) m = false;
    if (m) o.push([i, j, v[j * nx + i] / 100]);
  }
  return o;
};

test('Storms lens descriptor: complete, listed, isobars every 4 hPa with 1000 and 1020 bold, ECMWF rain fill', async () => {
  const { lens, listed } = await load('lenses/index.js'), pal = await load('render/palette.js'), S = lens('s');
  assert.equal(S.implemented, true); assert.equal(S.name, 'Storms and rain'); assert.ok(S.blurb.length > 10);
  assert.ok(listed().some((l) => l.id === 'surface'), 'listed once it draws');
  assert.deepEqual(S.fill, { field: 'tp6', palette: 'tp6' });
  assert.ok(pal.PALETTES.tp6, 'the rain palette exists');
  assert.equal(pal.LENS_FIELDS.s.fill, 'tp6'); assert.equal(pal.LENS_FIELDS.s.lines, 'msl');
  const ln = S.lines[0];
  assert.equal(ln.field, 'msl'); assert.equal(ln.style, 'contour');
  assert.equal(ln.step * ln.unit, 4, 'every 4 hPa (msl is stored in Pa)');
  assert.deepEqual(ln.bold.map((b) => b * ln.unit), [1000, 1020], '1000 and 1020 emphasised');
  assert.equal(ln.labelEvery * ln.unit, 4, 'every isobar is labelled');
  for (const k of ['answer', 'what', 'read']) assert.ok(typeof S.guide[k] === 'string' && S.guide[k].length > 40, `guide.${k}`);
  assert.ok(Array.isArray(S.guide.worth) && S.guide.worth.length >= 1);
  // the significance filter leaves many closed rings unlettered: the guide says so, so a ring with no L does not read as a bug (D15)
  const guideText = [S.guide.what, S.guide.read, ...S.guide.worth].join(' ');
  assert.match(guideText, /only the main systems are lettered/i, 'the guide says only the main systems get a letter');
  assert.match(guideText, /small or shallow ring/i, 'small and shallow rings named');
  assert.match(guideText, /near a deeper centre/i, 'rings near a deeper centre named');
  assert.match(guideText, /near the equator/i, 'the tropics named');
  // the H and L are type, drawn in compose's label pass over every line (W4-05 review 3): no under-the-linework marks hook
  assert.equal(typeof S.labels, 'function'); assert.equal(typeof S.labelBoxes, 'function'); assert.equal(S.marks, undefined);
  assert.equal(typeof S.describe, 'function');
  assert.deepEqual(S.available({ fields: { tp6: {}, msl: {} } }), { ok: true });
  assert.deepEqual(S.available({ fields: { tp6: {} } }), { ok: false, reason: 'Not in this run' });
  assert.deepEqual(S.available(null), { ok: false, reason: 'Not in this run' });
});

test('isobar labels are two digits: 1008 is 08, 996 is 96, 1000 is 00', async () => {
  const { isobarLabel } = await load('lenses/surface.js');
  assert.deepEqual(['1008', '996', '1000', '1020', '1012', '984', '1044'].map(isobarLabel), ['08', '96', '00', '20', '12', '84', '44']);
});

test('H and L only at closed centres: a closed low is marked, an open trough minimum is not', async () => {
  const { pressureCentres } = await load('lenses/surface.js');
  // a closed low: a bowl 990 at (20, 20) in a 1013 field, well inside a 41 x 41 grid
  const A = grid(41, 41, (i, j) => 1013 - 23 * Math.exp(-(((i - 20) ** 2 + (j - 20) ** 2) / 36)));
  const a = pressureCentres(A.v, A.dom);
  assert.equal(a.length, 1); assert.equal(a[0].kind, 'L'); assert.equal(a[0].i, 20); assert.equal(a[0].j, 20);
  // an open trough: pressure falls toward the left edge, the lowest node (1001) is on the edge row: no 4 hPa contour closes round it
  const B = grid(41, 41, (i) => 1001 + 0.5 * i);
  assert.deepEqual(pressureCentres(B.v, B.dom), [], 'no L where no closed contour exists');
  // a trough open to the west with a 1.5 hPa dip two nodes in from the edge: a true interior local minimum (1009.5 hPa at
  // (2, 20), every neighbour higher), but the region under the next isobar (1012) runs off the west edge of this regional grid,
  // so no isobar closes round it. Only the edge rule rejects it (M-lens-c-4 deletes that rule and marks an L here).
  const C = grid(41, 41, (i, j) => 1010 + 0.5 * i + 0.5 * Math.abs(j - 20) - 1.5 * Math.exp(-((i - 2) ** 2 + (j - 20) ** 2) / 2));
  assert.deepEqual(minima(C).map(([i, j, p]) => [i, j, Math.round(p * 10) / 10]), [[2, 20, 1009.5]], 'premise: the dip is a strict local minimum');
  assert.ok(C.v[20 * 41] < 101200, 'premise: the edge node on its row is under the next isobar (1012 hPa), so the region is open');
  assert.deepEqual(pressureCentres(C.v, C.dom), [], 'a local minimum whose isobar runs off a regional edge is not a low');
  // a high and a low together, and a second, shallower low inside the low's closed 1004 hPa isobar: the deep low at (15, 20)
  // is 990 hPa; the second at (23, 20) is 1001.1, and the saddle between them (1002.4 at (21, 20)) is under 1004, so the
  // isobar that closes round the second also closes round the first. One L for one closed isobar (M-lens-c-5 deletes the
  // dedupe and marks both).
  const D = grid(61, 41, (i, j) => 1013 - 23 * Math.exp(-(((i - 15) ** 2 + (j - 20) ** 2) / 36)) - 8 * Math.exp(-(((i - 23) ** 2 + (j - 20) ** 2) / 3)) + 22 * Math.exp(-(((i - 45) ** 2 + (j - 20) ** 2) / 49)));
  assert.deepEqual(minima(D).map(([i, j]) => [i, j]), [[15, 20], [23, 20]], 'premise: two strict local minima');
  const row = (i) => D.v[20 * 61 + i] / 100;
  assert.ok(row(23) > 1000 && row(23) < 1004 && Math.max(row(19), row(20), row(21), row(22)) < 1004, 'premise: the second low and the saddle are under 1004 hPa');
  const d = pressureCentres(D.v, D.dom);
  assert.deepEqual(d.map((c) => [c.kind, c.i, c.j]).sort(), [['H', 45, 20], ['L', 15, 20]], 'the deeper low carries the L; the second low in the same isobar does not');
});

test('synthetic-15d: the closed low is marked L within 2 degrees of its centre; every centre sits inside a closed region', async () => {
  const { pressureCentres } = await load('lenses/surface.js'), man = JSON.parse(fs.readFileSync(path.join(fx, 'manifest.json'), 'utf8'));
  for (const [dom, step] of [['g1', 0], ['g1', 72], ['np05', 0], ['np05', 72]]) {
    const d = man.domains[dom], v = frame(man, 'msl', dom, step), cs = pressureCentres(v, d), Ls = cs.filter((c) => c.kind === 'L');
    const probe = man.probes.find((p) => p.name === 'closed-low' && p.domain === dom && p.step === step);
    const near = Ls.filter((c) => Math.abs(c.lat - probe.lat) <= 2 && Math.abs(((c.lon - probe.lon + 540) % 360) - 180) <= 2);
    assert.equal(near.length, 1, `${dom} ${step} h: one L within 2 degrees of ${probe.lat}, ${probe.lon}; Ls: ${JSON.stringify(Ls.map((c) => [c.lat, c.lon]))}`);
    assert.ok(Math.abs(near[0].value - probe.value) < 20, `its value is the probe's ${probe.value} Pa (${near[0].value})`);
    for (const c of cs) assert.ok(c.i > 0 && c.j > 0 && c.j < d.ny - 1 && (c.i < d.nx - 1 || d.nx * d.dlon >= 360), `${dom}: centre not on the grid edge`);
  }
});

test('rain: the REF-28 bands from 0.1 mm; 0.05 mm is unfilled; the mm / in switch reaches the legend and the readout', async () => {
  const pal = await load('render/palette.js'), { lens } = await load('lenses/index.js'), S = lens('s');
  const hex = (c) => '#' + c.slice(0, 3).map((n) => n.toString(16).padStart(2, '0')).join('');
  assert.equal(pal.bandRGBA('tp6', 0.05, 'paper')[3], 0, '0.05 mm is unfilled');
  // the REF-28 hex is the Reference family; the default (Soft) is its own table, band for band
  assert.equal(hex(pal.bandRGBA('tp6', 0.1, 'paper', 'reference')), '#efdbb7');
  assert.equal(hex(pal.bandRGBA('tp6', 12, 'paper', 'reference')), '#77baf9');
  assert.equal(hex(pal.bandRGBA('tp6', 500, 'paper', 'reference')), '#ff00ff');
  assert.equal(hex(pal.bandRGBA('tp6', 12, 'paper')), pal.PALETTES.tp6.soft.paper[4]);
  const mm = pal.legendSpec('tp6', 'paper'), inch = pal.legendSpec('tp6', 'paper', null, null, 'us');
  assert.equal(mm.unit, 'mm'); assert.equal(inch.unit, 'in');
  assert.deepEqual(mm.unitSwitch, { options: ['mm', 'in'], active: 'mm' }); assert.deepEqual(inch.unitSwitch, { options: ['mm', 'in'], active: 'in' });
  assert.deepEqual(mm.ticks.map((t) => t.label), ['0.1', '1', '2', '5', '10', '15', '20', '30', '40', '50', '100', '300']);
  assert.deepEqual(inch.ticks.map((t) => t.label), ['0.004', '0.039', '0.079', '0.2', '0.39', '0.59', '0.79', '1.2', '1.6', '2', '3.9', '12']);
  assert.deepEqual(mm.stops.map((s) => s.color), inch.stops.map((s) => s.color), 'the same colours in either unit');
  assert.equal(pal.legendSpec('z500a', 'paper').unitSwitch ?? null, null, 'only the rain legend has the switch');
  assert.match(S.describe(0.8), /^0\.8 mm in 6 h · light rain/);
  assert.match(S.describe(0.8, { units: 'us' }), /^0\.03 in in 6 h/);
  assert.match(S.describe(0.8, { msl: 98505 }), /985 hPa/);
  assert.match(S.describe(0.05), /dry/);
});

test('rain is stored finely enough to draw the 0.1 mm edge between grid nodes (no staircase)', () => {
  // At a 0.1 mm storage step every node near the lowest band's edge holds 0 or 0.1, so the interpolated 0.1 mm edge can only
  // fall on nodes and draws as square cells (review round 2, stop 32). At 0.01 mm the nodes just outside the edge hold their
  // real 0.01-0.09 mm and the edge passes between nodes, as smooth as every other band edge.
  const man = JSON.parse(fs.readFileSync(path.join(fx, 'manifest.json'), 'utf8'));
  assert.ok(man.fields.tp6.scale <= 0.01, `tp6 is stored to 0.01 mm or finer (scale ${man.fields.tp6.scale})`);
  const d = man.domains.g1, a = frame(man, 'tp6', 'g1', 30);
  let outside = 0, resolved = 0;
  for (let j = 1; j < d.ny - 1; j++) for (let i = 1; i < d.nx - 1; i++) {
    const v = a[j * d.nx + i];
    if (!(v < 0.1)) continue;
    if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => a[(j + dj) * d.nx + i + di] >= 0.1)) continue;
    outside++; if (v > 0) resolved++;
  }
  assert.ok(outside >= 20, `the 30 h frame has a 0.1 mm edge to measure (${outside} nodes just outside it)`);
  assert.ok(resolved / outside >= 0.5, `most nodes just outside the 0.1 mm edge hold a value between 0 and 0.1 mm: ${resolved} of ${outside}`);
});

test('pressureCentres: missing data beside a candidate means the isobar is not known to close; far away it does not matter', async () => {
  const { pressureCentres } = await load('lenses/surface.js');
  const bowl = (i, j) => 1013 - 23 * Math.exp(-(((i - 20) ** 2 + (j - 20) ** 2) / 36));
  const ok = grid(41, 41, bowl);
  assert.equal(pressureCentres(ok.v, ok.dom).length, 1, 'control: the intact bowl has its L');
  // a NaN hole two nodes from the centre, inside the region the 4 hPa isobar would enclose (not a neighbour of the centre,
  // so the centre is still a candidate): the region reaches missing data, so no L (a mutant that skips NaN would close it)
  const hole = grid(41, 41, bowl); hole.v[20 * 41 + 22] = NaN;
  assert.deepEqual(pressureCentres(hole.v, hole.dom), [], 'a NaN node inside the region: no L');
  // the same beside a high
  const hill = grid(41, 41, (i, j) => 1013 + 23 * Math.exp(-(((i - 20) ** 2 + (j - 20) ** 2) / 36))); hill.v[22 * 41 + 20] = NaN;
  assert.deepEqual(pressureCentres(hill.v, hill.dom), [], 'a NaN node inside the region of a high: no H');
  // missing data far from the bowl is irrelevant
  const far = grid(41, 41, bowl); far.v[2 * 41 + 2] = NaN; far.v[38 * 41 + 38] = NaN;
  const f = pressureCentres(far.v, far.dom);
  assert.equal(f.length, 1); assert.equal(f[0].kind, 'L');
});

test('pressureCentres: a region larger than 60% of the grid is a broad low, not a marked centre; a smaller one is marked', async () => {
  const { pressureCentres } = await load('lenses/surface.js');
  // a flat 999.8 hPa basin (min 999.5 at the centre) inside a ring of 1030 hPa, `inset` nodes from the edge: the isobar at 1000 hPa
  // closes round the whole basin without touching the grid edge. Basin 39 x 39 of 41 x 41 is 90% of the grid; inset 6 gives 29 x 29, 50%.
  const basin = (inset) => grid(41, 41, (i, j) => (i < inset || j < inset || i > 40 - inset || j > 40 - inset ? 1030 : i === 20 && j === 20 ? 999.5 : 999.8));
  const big = basin(1), bigC = pressureCentres(big.v, big.dom);
  assert.deepEqual(bigC, [], 'a basin of 90% of the grid is capped: no L');
  assert.equal(pressureCentres(big.v, big.dom, { maxFraction: 0.99 }).filter((c) => c.kind === 'L').length, 1, 'only the cap hides it: raise the cap and the L is there');
  const mid = basin(6), midC = pressureCentres(mid.v, mid.dom);
  assert.deepEqual(midC.map((c) => c.kind), ['L'], 'a basin of 50% of the grid is under the cap: marked');
  assert.equal(midC[0].i, 20); assert.equal(midC[0].j, 20);
});

// ---- significance: a handful of systems, not every closed dimple (W4-05 review round 1, 2026-11-19) ----
/** A compactly supported bowl of depth `a` hPa and radius `R` cells on a flat `bg` hPa field: exactly `bg` beyond R. */
const bowl = (bg, a, R, ci, cj) => (i, j) => { const r = Math.hypot(i - ci, j - cj); return bg - (r < R ? a * (1 - r / R) ** 2 : 0); };
const kmBetween = (lon1, lat1, lon2, lat2) => {
  const r = Math.PI / 180, a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
};

test('pressureCentres: a dip shallower than one full 4 hPa isobar is not a centre, even where an isobar closes round it', async () => {
  const { pressureCentres } = await load('lenses/surface.js');
  // the field is 1016 hPa (an isobar level) with a 3 hPa dip (1013): the 1016 isobar closes round it, but the next one up
  // (1020) is everywhere. The first build marked it. Only the depth rule rejects it (M-lens-c-7 removes the rule).
  const S = grid(61, 41, bowl(1016, 3, 12, 30, 20));
  assert.equal(minima(S).length, 1, 'premise: one strict local minimum');
  const below = S.v.filter((x) => x < 101600).length;
  assert.ok(below > 100 && below < S.v.length / 2, `premise: a closed region lies under the 1016 hPa isobar (${below} nodes)`);
  assert.deepEqual(pressureCentres(S.v, S.dom), [], 'a 3 hPa dip is not marked');
  assert.equal(pressureCentres(S.v, S.dom, { minDepthPa: 1, minAreaKm2: 0 }).length, 1, 'the old rule (any closed isobar) marked it');
  // 6 hPa deep: a full isobar interval closes round it
  const D = grid(61, 41, bowl(1016, 6, 12, 30, 20));
  const c = pressureCentres(D.v, D.dom);
  assert.deepEqual(c.map((x) => [x.kind, x.i, x.j]), [['L', 30, 20]]);
  assert.ok(c[0].depth >= 4, `its closed isobar is at least 4 hPa up (${c[0].depth})`);
});

test('pressureCentres: a closed isobar under about 1,000,000 square km is a dimple, not a system; a deep, compact low still counts for its outer isobar', async () => {
  const { pressureCentres, CENTRE_RULES } = await load('lenses/surface.js');
  const small = grid(61, 41, bowl(1016, 14, 4, 30, 20)), wide = grid(61, 41, bowl(1016, 14, 12, 30, 20));
  assert.equal(minima(small).length, 1); assert.equal(minima(wide).length, 1);
  assert.deepEqual(pressureCentres(small.v, small.dom), [], 'a 14 hPa pit 4 cells wide (about 0.4 million km2) is not marked');
  const w = pressureCentres(wide.v, wide.dom);
  assert.equal(w.length, 1, 'the same pit 12 cells wide is');
  assert.ok(w[0].areaKm2 >= CENTRE_RULES.minAreaKm2, `its area ${w[0].areaKm2} km2`);
  assert.equal(pressureCentres(small.v, small.dom, { minAreaKm2: 1e5 }).length, 1, 'premise: only the area rule rejected the small pit');
});

test('pressureCentres: two centres of a kind closer than 1500 km leave only the deeper; a high and a low never cancel', async () => {
  const { pressureCentres } = await load('lenses/surface.js');
  // two separate pits (radius 5 cells, 12 rows apart: about 1330 km), one 12 hPa deep and one 9; the area floor is lowered so only spacing decides
  const f1 = bowl(1016, 12, 5, 20, 12), f2 = bowl(1016, 9, 5, 20, 24), rules = { minAreaKm2: 2e5 };
  const P = grid(41, 41, (i, j) => f1(i, j) + f2(i, j) - 1016);
  assert.equal(minima(P).length, 2, 'premise: two strict minima, in two separate regions');
  assert.ok(kmBetween(P.dom.lon0 + 20, P.dom.lat0 - 12, P.dom.lon0 + 20, P.dom.lat0 - 24) < 1500, 'premise: they are under 1500 km apart');
  assert.equal(pressureCentres(P.v, P.dom, { ...rules, minSepKm: 0 }).length, 2, 'premise: with no spacing rule both are marked');
  const c = pressureCentres(P.v, P.dom, rules);
  assert.deepEqual(c.map((x) => [x.kind, x.j, Math.round(x.value / 100)]), [['L', 12, 1004]], 'one L: the deeper');
  // a high next to a low is allowed: kinds are separate
  const Q = grid(41, 41, (i, j) => f1(i, j) - (bowl(1016, 9, 5, 20, 24)(i, j) - 1016));
  assert.deepEqual(pressureCentres(Q.v, Q.dom, rules).map((x) => x.kind).sort(), ['H', 'L']);
});

test('pressureCentres: nearer the equator than 15 degrees is not a pressure system', async () => {
  const { pressureCentres } = await load('lenses/surface.js');
  const mk = (lat0) => { const g = grid(61, 41, bowl(1016, 14, 12, 30, 20)); return { v: g.v, dom: { ...g.dom, lat0 }, }; };
  assert.equal(pressureCentres(mk(60).v, mk(60).dom).length, 1, 'premise: the same bowl at 40N is marked');
  assert.deepEqual(pressureCentres(mk(25).v, mk(25).dom), [], 'at 5N it is not');
  assert.equal(pressureCentres(mk(25).v, mk(25).dom, { minLat: 0 }).length, 1, 'premise: only the latitude rule rejected it');
});

test('recorded ECMWF run: a handful of systems, every one a real extremum at least 4 hPa deep, 1500 km from the next of its kind', async () => {
  const { pressureCentres, CENTRE_RULES } = await load('lenses/surface.js');
  const rx = path.join(root, 'tests/site/fixtures/recorded'), man = JSON.parse(fs.readFileSync(path.join(rx, 'manifest.json'), 'utf8'));
  const g = man.domains.g1, f = man.fields.msl;
  const get = (step) => {
    const idx = f.steps.indexOf(step), ch = f.chunks.find((c) => c.steps[0] <= idx && idx < c.steps[1]);
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(rx, ch.files.g1.path))), n = g.nx * g.ny, k = idx - ch.steps[0], seg = raw.subarray(k * n * 2, (k + 1) * n * 2), out = new Float64Array(n);
    for (let y = 0; y < g.ny; y++) { let acc = 0; for (let x = 0; x < g.nx; x++) { const i = y * g.nx + x; acc = (acc + ((seg[n + i] << 8) | seg[i])) & 0xFFFF; const q = acc >= 0x8000 ? acc - 0x10000 : acc; out[i] = q === NODATA ? NaN : q * f.scale + f.offset; } }
    return out;
  };
  for (const step of [0, 24, 96, 168, 240]) {
    const v = get(step), cs = pressureCentres(v, g);
    // with only the old rule the same field has far more (the 2026-11-19 review saw 44 on the Hemisphere view)
    const old = pressureCentres(v, g, { minDepthPa: 1, minAreaKm2: 0, minSepKm: 0, minLat: 0 });
    assert.ok(old.length >= 3 * cs.length, `premise: the old rule marks many more (${old.length} against ${cs.length}) at ${step} h`);
    for (const [name, mine] of [['northern', cs.filter((c) => c.lat > 0)], ['southern', cs.filter((c) => c.lat < 0)]]) {
      assert.ok(mine.length >= 3 && mine.length <= 14, `${step} h: a handful of systems in the ${name} hemisphere (${mine.length}: ${mine.map((c) => c.kind + Math.round(c.value / 100)).join(' ')})`);
    }
    for (const c of cs) {
      const at = (i, j) => v[j * g.nx + ((i % (g.nx - 1)) + g.nx - 1) % (g.nx - 1)], s = c.kind === 'L' ? 1 : -1;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (di || dj) assert.ok(s * at(c.i + di, c.j + dj) >= s * v[c.j * g.nx + c.i], `${step} h: ${c.kind}${Math.round(c.value / 100)} at ${c.lon}, ${c.lat} is a local extremum`);
      assert.ok(Math.abs(c.lat) >= CENTRE_RULES.minLat, 'not in the tropics');
      assert.ok(c.depth >= 4 && c.areaKm2 >= CENTRE_RULES.minAreaKm2, `${c.kind}${Math.round(c.value / 100)}: depth ${c.depth} hPa, area ${c.areaKm2} km2`);
    }
    for (let a = 0; a < cs.length; a++) for (let b = a + 1; b < cs.length; b++) {
      if (cs[a].kind === cs[b].kind) assert.ok(kmBetween(cs[a].lon, cs[a].lat, cs[b].lon, cs[b].lat) >= CENTRE_RULES.minSepKm - 1, `${step} h: two ${cs[a].kind} are 1500 km apart`);
    }
  }
});

test('Storms lens: the H and L on screen do not depend on what else is loaded (a masked t850a arriving later changes nothing)', async () => {
  // The lens' marks must be a function of the run, the time and the view only. Another lens (Air mass) or the story may load
  // t850a, which the pipeline masks below ground (pipeline/reduce.py apply_mask); the Storms lens never asks for it. Here the
  // recorded run is served as built, except that t850a is masked over the Mongolian plateau (85-115E, 40-56N), where the
  // run's 1040+ hPa Siberian high sits. The H and L laid out before and after t850a lands must be the same.
  const data = await load('data/index.js'), { store } = await load('state.js'), { lens } = await load('lenses/index.js');
  const { lastDrawn } = await load('lenses/surface.js'), S = lens('s');
  const rx = path.join(root, 'tests/site/fixtures/recorded'), man = JSON.parse(fs.readFileSync(path.join(rx, 'manifest.json'), 'utf8'));
  const g = man.domains.g1, n = g.nx * g.ny, inBox = (i, j) => { const lon = g.lon0 + i * g.dlon, lat = g.lat0 + j * g.dlat; return lon >= 85 && lon <= 115 && lat >= 40 && lat <= 56; };
  const masked = (buf, nFrames) => { // dx-shuffle Int16 frames, re-encoded with NODATA in the box
    const raw = zlib.gunzipSync(buf), out = Buffer.alloc(raw.length);
    for (let f = 0; f < nFrames; f++) {
      const seg = raw.subarray(f * n * 2, (f + 1) * n * 2), o = out.subarray(f * n * 2, (f + 1) * n * 2);
      for (let y = 0; y < g.ny; y++) {
        let acc = 0, prev = 0;
        for (let x = 0; x < g.nx; x++) {
          const i = y * g.nx + x; acc = (acc + ((seg[n + i] << 8) | seg[i])) & 0xFFFF;
          const q = inBox(x, y) ? NODATA & 0xFFFF : acc, d = (q - prev) & 0xFFFF; prev = q;
          o[i] = d & 0xFF; o[n + i] = d >> 8;
        }
      }
    }
    return zlib.gzipSync(out);
  };
  let maskedCells = 0;
  data._reset({ fetch: async (url) => {
    const rel = url.replace(/^data\//, ''), file = path.join(rx, rel);
    if (!fs.existsSync(file)) return { ok: false, status: 404 };
    let buf = fs.readFileSync(file);
    if (rel.startsWith('t850a.')) { const ch = man.fields.t850a.chunks.find((c) => c.files.g1.path === rel); buf = masked(buf, ch.steps[1] - ch.steps[0]); }
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString()), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  } });
  try {
    await data.loadManifest();
    const s = { view: 'nh', t: 0 }, W = 1440, H = 720;
    const mv = { W, H, project: ([lon, lat]) => [((lon + 180) % 360 + 360) % 360 * (W / 360), (90 - lat) * (H / 180)] };
    const ctx = { font: '', save() {}, restore() {}, measureText(t) { const px = Number(/(\d+)px/.exec(this.font)?.[1] || 12); return { width: 0.62 * px * String(t).length }; } };
    const tk = { ground: 'paper', label: { halo: '#fff', ink: '#000' } };
    const marks = () => { S.labelBoxes(ctx, mv, tk, { s }); return lastDrawn().map((m) => `${m.kind}${Math.round(m.value / 100)}@${m.lon},${m.lat}`).sort(); };
    await data.ensure('msl', 'g1', 0);
    const before = marks();
    assert.ok(before.some((k) => /^H10[34]\d@(8[5-9]|9\d|1[01]\d),(4\d|5[0-6])$/.test(k)), `premise: an H of 1030+ hPa inside the masked box (${before.join(' ')})`);
    await data.ensure('t850a', 'g1', 0);
    const t = data.fieldAt('t850a', 'g1', 0);
    for (let k = 0; k < n; k++) if (Number.isNaN(t[k])) maskedCells++;
    assert.ok(maskedCells > 400, `premise: t850a is loaded and masked (${maskedCells} cells)`);
    assert.deepEqual(marks(), before, 'the same H and L once t850a is loaded');
  } finally {
    data._reset(); store._reset?.();
  }
});
