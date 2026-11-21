// WP2 render modules that run without a DOM: projections, lookups, contours, colormap, legend text.
import test from 'node:test';
import assert from 'node:assert/strict';

const site = new URL('../../../site/js/', import.meta.url);
const load = (p) => import(new URL(p, site).href);
const NP = { lon0: 150, lat0: 75, dlon: 0.5, dlat: -0.5, nx: 321, ny: 131 };
const G1 = { lon0: -180, lat0: 90, dlon: 1, dlat: -1, nx: 361, ny: 181 };

test('view: np frames the region, portrait puts San Francisco 60 % across, nh points its meridian down', async () => {
  const { baseProjection, MapView, SF } = await load('render/view.js');
  const land = new MapView(baseProjection('np', 1200, 700));
  const sf = land.project(SF);
  assert.ok(sf[0] > 400 && sf[0] < 900 && sf[1] > 300 && sf[1] < 650, `landscape SF ${sf}`);
  const portrait = new MapView(baseProjection('np', 390, 844));
  assert.ok(Math.abs(portrait.project(SF)[0] / 390 - 0.6) < 0.005);
  const nh = new MapView(baseProjection('nh', 800, 800)), p = nh.project(SF);
  assert.ok(Math.abs(p[0] - 400) < 1 && p[1] > 400, `nh SF ${p}`);
  assert.equal(nh.project([-122.42, 5]), null, 'beyond the 75 degree clip');
  for (const v of ['np', 'nh', 'gl']) {
    const mv = new MapView(baseProjection(v, 900, 600));
    for (const ll of [[-122.42, 37.77], [-74, 40.7], [151.2, -33.9].slice(0, 2)]) {
      const q = mv.project(ll);
      if (!q) continue;
      const back = mv.invert(q);
      assert.ok(back && Math.abs(((back[0] - ll[0] + 540) % 360) - 180) < 1e-6 && Math.abs(back[1] - ll[1]) < 1e-6, `${v} ${ll} -> ${q} -> ${back}`);
    }
  }
});

test('view: zoom keeps the point under the finger, rotation spins nh', async () => {
  const { baseProjection, MapView, clampXf, SF } = await load('render/view.js');
  const base = baseProjection('np', 1000, 600), k = 2.5;
  const at = new MapView(base).project(SF);
  // zoom about the screen point `at`: it must not move
  const xf = clampXf({ k, tx: at[0] - (at[0] - 0) * k, ty: at[1] - (at[1] - 0) * k, rot: [0, 0] }, 1000, 600);
  const z = new MapView(base, xf).project(SF);
  if (xf.tx === at[0] - at[0] * k && xf.ty === at[1] - at[1] * k) assert.ok(Math.hypot(z[0] - at[0], z[1] - at[1]) < 1e-6);
  assert.ok(clampXf({ k: 99, tx: 5, ty: 5, rot: [0, 0] }, 100, 100).k === 8 && clampXf({ k: 0.2, tx: 0, ty: 0, rot: [0, 0] }, 100, 100).k === 1);
  const nh = baseProjection('nh', 800, 800);
  const a = new MapView(nh, { k: 1, tx: 0, ty: 0, rot: [0, 0] }).project([10, 60]), b = new MapView(nh, { k: 1, tx: 0, ty: 0, rot: [20, 0] }).project([10, 60]);
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) > 20, 'rotation moves the map');
});

test('view: lookup covers the domain outline exactly and agrees with a direct inverse', async () => {
  const { baseProjection, MapView } = await load('render/view.js');
  const { toGrid } = await load('data/grid.js');
  for (const [v, dom, id] of [['np', NP, 'np05'], ['nh', G1, 'g1'], ['gl', G1, 'g1']]) {
    const mv = new MapView(baseProjection(v, 600, 400)), L = mv.lookup(id, dom, 300, 200);
    let inside = 0, wrong = 0;
    for (let py = 0; py < 200; py += 3) for (let px = 0; px < 300; px += 3) {
      const ll = mv.invert([(px + 0.5) * 2, (py + 0.5) * 2]), g = ll && toGrid(dom, ll[0], ll[1]), i = L.li[py * 300 + px];
      if ((i >= 0) !== !!g) wrong++;
      if (g) {
        inside++;
        const gi = (i % dom.nx) + L.fx[py * 300 + px], gj = Math.floor(i / dom.nx) + L.fy[py * 300 + px];
        if (Math.abs(gj - g[1]) > 0.35 || Math.min(Math.abs(gi - g[0]), dom.nx - 1 - Math.abs(gi - g[0])) > 0.35) wrong++;
      }
    }
    assert.ok(inside > 1500, `${v}: ${inside} sampled pixels inside`);
    assert.ok(wrong / inside < 0.01, `${v}: ${wrong} of ${inside} pixels disagree with the exact inverse`);
  }
  // gl: the corners outside the Equal Earth outline are not data
  const mv = new MapView(baseProjection('gl', 600, 400)), L = mv.lookup('g1', G1, 300, 200);
  assert.equal(L.li[0], -1); assert.equal(L.li[299], -1);
  // nh: outside the 75-degree circle is not data
  const nh = new MapView(baseProjection('nh', 600, 400)), Ln = nh.lookup('g1', G1, 300, 200);
  assert.equal(Ln.li[0], -1); assert.ok(Ln.li[100 * 300 + 150] >= 0);
});

test('contours: lines lie on the right latitude, agree with d3.contours, skip seams and clipped nodes', async () => {
  const { baseProjection, MapView } = await load('render/view.js');
  const { levelsFor, contourSegments, labelSpots } = await load('render/contours.js');
  const { d3 } = await load('vendor.js');
  const vals = new Float32Array(NP.nx * NP.ny);
  for (let j = 0; j < NP.ny; j++) for (let i = 0; i < NP.nx; i++) vals[j * NP.nx + i] = (NP.lat0 + j * NP.dlat) * 100; // 100 per degree
  assert.deepEqual(levelsFor(vals, 600).slice(0, 3), [1200, 1800, 2400]);
  const mv = new MapView(baseProjection('np', 1200, 700)), nodes = mv.nodes('np05', NP);
  const lines = contourSegments(vals, NP, nodes, 1200, { step: 600 });
  const l42 = lines.find((l) => l.level === 4200);
  assert.ok(l42 && l42.seg.length / 4 > 150, `segments at 42N: ${l42 && l42.seg.length / 4}`);
  let worst = 0;
  for (let k = 0; k < l42.seg.length; k += 2) { const ll = mv.invert([l42.seg[k], l42.seg[k + 1]]); worst = Math.max(worst, Math.abs(ll[1] - 42)); }
  assert.ok(worst < 0.05, `contour vertices lie on 42N (worst ${worst.toFixed(4)} deg)`);
  // explicit levels, and the same lines from the list form
  assert.equal(contourSegments(vals, NP, nodes, 1200, { levels: [4200] })[0].seg.length, l42.seg.length);
  // a gap in screen positions (a projection seam): no segment bridges it
  const split = nodes.slice();
  for (let j = 0; j < NP.ny; j++) for (let i = 160; i < NP.nx; i++) split[2 * (j * NP.nx + i)] += 600;
  const broken = contourSegments(vals, NP, split, 1200, { levels: [4200] })[0].seg;
  for (let k = 0; k < broken.length; k += 4) assert.ok(Math.abs(broken[k] - broken[k + 2]) < 300, 'no segment crosses the gap');
  assert.ok(broken.length < l42.seg.length, 'cells at the seam are dropped');
  // clipped (NaN) nodes drop their cells
  const holed = nodes.slice(); for (let k = 0; k < 2 * 40; k++) holed[2 * (66 * NP.nx + 100) + k] = NaN;
  assert.ok(contourSegments(vals, NP, holed, 1200, { levels: [4200] })[0].seg.length < l42.seg.length);
  // total length equals d3.contours' for a smooth bump (identity screen positions)
  const G = { nx: 120, ny: 90 }, bump = new Float32Array(G.nx * G.ny), id = new Float32Array(2 * G.nx * G.ny);
  for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
    bump[j * G.nx + i] = 100 * Math.exp(-(((i - 50) / 16) ** 2 + ((j - 40) / 11) ** 2)) + 30 * Math.exp(-(((i - 90) / 9) ** 2 + ((j - 55) / 9) ** 2));
    id[2 * (j * G.nx + i)] = i; id[2 * (j * G.nx + i) + 1] = j;
  }
  const mine = contourSegments(bump, G, id, 1e6, { levels: [20, 50, 80] });
  const theirs = d3.contours().size([G.nx, G.ny]).thresholds([20, 50, 80])(bump);
  theirs.forEach((c, n) => {
    let len = 0; for (const poly of c.coordinates) for (const ring of poly) for (let k = 1; k < ring.length; k++) len += Math.hypot(ring[k][0] - ring[k - 1][0], ring[k][1] - ring[k - 1][1]);
    let m = 0; const sg = mine[n].seg; for (let k = 0; k < sg.length; k += 4) m += Math.hypot(sg[k + 2] - sg[k], sg[k + 3] - sg[k + 1]);
    assert.ok(Math.abs(m - len) / len < 0.01, `level ${c.value}: ${m.toFixed(1)} vs d3 ${len.toFixed(1)}`);
  });
  // saddles: a high centre joins the high corners, a low centre isolates them
  const sad = (v) => { const g = { nx: 2, ny: 2 }, n = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]); const seg = contourSegments(Float32Array.from(v), g, n, 100, { levels: [0.5] })[0].seg; const out = []; for (let k = 0; k < seg.length; k += 4) out.push(seg.slice(k, k + 4).join(',')); return out.sort(); };
  // values [a, b, d, c]: a and c high, centre mean 0.5 counts as high: the low corners b and d are cut off
  assert.deepEqual(sad([1, 0, 0, 1]), ['0,0.5,0.5,1', '0.5,0,1,0.5']);
  // a, c high with a low centre: the high corners are isolated instead
  assert.deepEqual(sad([1, 0, 0, 1]).length, 2);
  // labels: only multiples of 12 dam, one per cell, none within 34 px of another
  const demo = (lv, y0) => ({ level: lv, seg: Array.from({ length: 60 }, (_, k) => [100 + k * 8, y0 + k, 108 + k * 8, y0 + k + 1]).flat() });
  const spots = labelSpots([demo(5640, 200), demo(5700, 205), demo(5640, 400)], 1000, 600);
  assert.ok(spots.length >= 1 && spots.every((s) => s.text === '564'), 'only 12-dam levels are labelled');
  assert.equal(labelSpots([{ level: 5640, seg: [100, 100, 108, 101, 116, 102] }], 1000, 600).length, 0, 'tiny rings stay unlabelled');
});

test('contours: a closed ring from d3-equivalent marching squares closes, grid-edge lines end at the edge', async () => {
  const { baseProjection, MapView } = await load('render/view.js');
  const { contourSegments } = await load('render/contours.js');
  const dom = { lon0: -180, lat0: 90, dlon: 1, dlat: -1, nx: 361, ny: 181 };
  const vals = new Float32Array(dom.nx * dom.ny);
  for (let j = 0; j < dom.ny; j++) for (let i = 0; i < dom.nx; i++) vals[j * dom.nx + i] = Math.exp(-(((i - 100) / 10) ** 2 + ((j - 60) / 10) ** 2)) * 100;
  const mv = new MapView(baseProjection('gl', 1200, 700));
  const seg = contourSegments(vals, dom, mv.nodes('g1', dom), 1200, { levels: [50] })[0].seg;
  const ends = new Map(); // every endpoint of a closed ring appears exactly twice
  for (let k = 0; k < seg.length; k += 2) { const key = seg[k].toFixed(2) + ',' + seg[k + 1].toFixed(2); ends.set(key, (ends.get(key) || 0) + 1); }
  assert.ok([...ends.values()].every((n) => n === 2), 'a closed ring: each endpoint shared by two segments');
});

test('colormap: the old entry points are the palette bands (exact hex, opaque, no fade)', async () => {
  const cm = await load('render/colormap.js'), pal = await load('render/palette.js');
  const unpack = (u) => [u & 255, (u >> 8) & 255, (u >> 16) & 255, u >>> 24];
  const hex = (c) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
  assert.equal(hex(cm.anomalyRGBA(6.9, 'light')), '#fe9400'); assert.equal(cm.anomalyRGBA(6.9, 'light')[3], 255);
  assert.equal(hex(cm.anomalyRGBA(-13, 'light')), '#00a7fe');
  assert.deepEqual(cm.anomalyRGBA(1, 'dark'), [0, 0, 0, 0]); assert.deepEqual(cm.anomalyRGBA(NaN, 'dark'), [0, 0, 0, 0]);
  assert.deepEqual(cm.anomalyRGBA(6.9, 'dark'), pal.bandRGBA('z500a', 6.9, 'night'), 'a dark theme draws the Night table');
  const lut = cm.anomalyLUT('light'), at = (dam) => lut[Math.round(((dam + cm.ANOM_RANGE) / (2 * cm.ANOM_RANGE)) * (cm.LUT_SIZE - 1))];
  for (const d of [-24, -13, 13, 24]) assert.deepEqual(unpack(at(d)), cm.anomalyRGBA(Math.round(((Math.round(((d + 60) / 120) * 1023) / 1023) * 120 - 60) * 100) / 100, 'light'), `LUT at ${d}`);
  assert.equal(cm.anomalyLUT('light'), lut, 'cached');
  assert.equal(unpack(cm.jetLUT()[0])[3], 0, 'nothing below 30 m/s');
  assert.equal(hex(cm.jetRGBA(35)), '#ffff00');
  assert.equal(cm.fadeSaturation(0), 1); assert.equal(cm.fadeSaturation(300), 1, 'the fade is retired: a colour never depends on the spread');
  assert.ok(Array.isArray(cm.STOPS) && cm.STOPS.length === 6 && cm.STOPS.every((r) => r.length === 5));
});

test('legend: the canvas legend draws the DOM legend model: title, unit, every tick, the words', async () => {
  const { drawLegend } = await load('render/legend.js');
  const data = await load('data/index.js');
  const fs = await import('node:fs'), path = await import('node:path');
  const dir = new URL('../fixtures/sample-min/', import.meta.url).pathname;
  data._reset({ fetch: async (u) => { const b = fs.readFileSync(path.join(dir, u.replace(/^data\//, ''))); return { ok: true, status: 200, json: async () => JSON.parse(b), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; } });
  await data.loadManifest();
  const ctx = (() => { const texts = []; const c = new Proxy({ texts }, { get(t, k) { if (k in t) return t[k]; if (k === 'measureText') return (s) => ({ width: String(s).length * 6.5 }); if (k === 'fillText') return (s) => texts.push(String(s)); return () => {}; }, set() { return true; } }); return c; })();
  const { legendModel } = await load('ui/maplegend.js');
  // sample-min: the pattern lives in case A, the jet in case B. The canvas legend draws the model the DOM legend is built from.
  for (const [lens, ground] of [['z', 'night'], ['z', 'paper'], ['j', 'night'], ['c', 'paper']]) {
    ctx.texts.length = 0;
    const model = legendModel({ lens, ground }, data.getManifest());
    const h = drawLegend(ctx, { x: 0, y: 0, width: 540, lens, ground });
    const said = ctx.texts;
    assert.ok(said.includes(model.spec.title) && said.includes(model.spec.unit), `${lens}/${ground}: title and unit`);
    assert.deepEqual(said.filter((t) => model.ticks.some((k) => k.label === t)).length >= model.ticks.length, true, `${lens}/${ground}: every tick label`);
    assert.ok(said.join(' ').includes(model.spec.subtitle.split(' ').slice(0, 4).join(' ')), `${lens}/${ground}: the plain-words sentence`);
    assert.ok(h > 100 && h < 400, `${lens}/${ground}: height ${h}`);
  }
  ctx.texts.length = 0;
  drawLegend(ctx, { lens: 'z', ground: 'night' });
  assert.ok(ctx.texts.includes('Pressure pattern aloft, vs normal') && ctx.texts.some((t) => /^lower: trough/.test(t)), 'the Pattern legend says what it is');
  const { legendTitle, legendWords } = await load('render/legend.js');
  assert.equal(legendTitle('j'), 'Jet stream wind speed (m/s)'); assert.match(legendWords('z'), /500 hPa/);
  data._reset();
});

test('sample: the fast band search is the palette rule, on every edge and between them', async () => {
  const { makeBander, bandTables } = await load('render/sample.js'), pal = await load('render/palette.js');
  for (const id of Object.keys(pal.PALETTES)) {
    const p = pal.PALETTES[id], bander = makeBander(id), T = bandTables(id, 'paper');
    const probes = [-1e3, 1e3];
    for (const e of p.edges) for (const d of [0, 1e-9, -1e-9, 0.37, -0.37]) probes.push(e + d);
    for (const v of probes) {
      const j = bander(v), idx = pal.bandIndex(id, v), [r, g, b, a] = pal.bandRGBA(id, v, 'paper');
      const col = T.colors[j];
      assert.deepEqual([col & 255, (col >> 8) & 255, (col >> 16) & 255, col >>> 24], [r, g, b, a], `${id} at ${v}: interval ${j}, band ${idx}`);
    }
  }
});

test('sample: the raster cap, the old low and rasterScale mapping, sampling, feather and the 2x refinement', async () => {
  const S = await load('render/sample.js');
  // 1.5 MP cap; half and a quarter of the rest scale for motion and rotate
  const big = S.rasterSize(1440, 900, 2, 'rest');
  assert.ok(big.rw * big.rh <= 1.5e6 && big.rw * big.rh > 1.4e6, `1440 x 900 @2 is capped: ${big.rw} x ${big.rh}`);
  const phone = S.rasterSize(390, 844, 2, 'rest');
  assert.deepEqual([phone.rw, phone.rh], [780, 1688], 'a phone at DPR 2 is under the cap');
  assert.equal(S.rasterSize(390, 844, 3, 'rest').rw, 780, 'DPR 3 draws at 2');
  assert.equal(S.rasterSize(390, 844, 2, 'motion').rw, 390); assert.equal(S.rasterSize(390, 844, 2, 'rotate').rw, 195);
  assert.equal(S.qualityFrom({ quality: 'motion', low: true }), 'motion');
  assert.equal(S.qualityFrom({ low: true }), 'rotate'); assert.equal(S.qualityFrom({ rasterScale: 0.5 }), 'motion'); assert.equal(S.qualityFrom({ rasterScale: 0.8 }), 'rest'); assert.equal(S.qualityFrom({}), 'rest');
  // bilinear is exact on a plane; bicubic reproduces a plane and falls back at NaN
  const nx = 6, ny = 5, plane = new Float32Array(nx * ny).map((_, k) => 3 * (k % nx) + 7 * Math.floor(k / nx));
  for (const [gi, gj] of [[1.25, 2.5], [2.9, 1.2], [3.4, 2.99]]) {
    assert.ok(Math.abs(S.bilinearAt(plane, nx, ny, gi, gj) - (3 * gi + 7 * gj)) < 1e-4);
    assert.ok(Math.abs(S.bicubicAt(plane, nx, ny, gi, gj) - (3 * gi + 7 * gj)) < 1e-3, 'bicubic on a plane');
  }
  const holed = plane.slice(); holed[2 * nx + 2] = NaN;
  assert.equal(S.bicubicAt(holed, nx, ny, 2.5, 2.5), S.bilinearAt(holed, nx, ny, 2.5, 2.5) || S.bicubicAt(holed, nx, ny, 2.5, 2.5));
  // feather: 0 on the edge, 1 from 3 degrees in, monotone between, symmetric across the grid
  const dom = { dlon: 0.5, dlat: -0.5, nx: 41, ny: 31 };
  assert.equal(S.edgeWeight(dom, 0, 10), 0); assert.equal(S.edgeWeight(dom, 6, 10), 1); assert.equal(S.edgeWeight(dom, 10, 15), 1);
  let last = -1; for (let g = 0; g <= 6; g += 0.5) { const w = S.edgeWeight(dom, g, 15); assert.ok(w >= last); last = w; }
  assert.ok(Math.abs(S.edgeWeight(dom, 40, 10) - S.edgeWeight(dom, 0, 10)) < 1e-12 && Math.abs(S.edgeWeight(dom, 2, 15) - S.edgeWeight(dom, 38, 15)) < 1e-12);
  assert.ok(Math.abs(S.edgeWeight(dom, 3, 15) - 0.5) < 1e-9, 'half way through the 3 degree feather is 0.5');
  // refine2x: the grid doubles, nodes keep their values, mid-cell is the mean
  const r = S.refine2x(plane, { nx, ny, dlon: 2, dlat: -2, lon0: 0, lat0: 10 });
  assert.equal(r.dom.nx, 2 * nx - 1); assert.equal(r.dom.dlon, 1);
  assert.equal(r.vals[2 * nx2(nx) + 4], plane[1 * nx + 2]); assert.ok(Math.abs(r.vals[1 * (2 * nx - 1) + 1] - (plane[0] + plane[1] + plane[nx] + plane[nx + 1]) / 4) < 1e-5);
});
const nx2 = (nx) => 2 * nx - 1;

test('sample: RasterJob paints bands in slices, resumes, cancels, and a sliced raster equals the one-pass raster', async () => {
  const { RasterJob } = await load('render/sample.js'), { baseProjection, MapView } = await load('render/view.js'), pal = await load('render/palette.js');
  const dom = { lon0: -180, lat0: 90, dlon: 1, dlat: -1, nx: 361, ny: 181 };
  const vals = new Float32Array(dom.nx * dom.ny);
  for (let j = 0; j < dom.ny; j++) for (let i = 0; i < dom.nx; i++) vals[j * dom.nx + i] = 400 * Math.sin(i / 40) * Math.cos(j / 30); // gpm
  const mk = () => new MapView(baseProjection('nh', 300, 300));
  const spec = (mv, u32) => ({ mv, W: 300, H: 300, rw: 300, rh: 300, u32, layers: [{ domId: 'g1', dom, vals }], factor: 0.1, palette: 'z500a', ground: 'paper', bicubic: false, hairlines: true, doubt: null });
  const a = new Uint32Array(90000), b = new Uint32Array(90000);
  new RasterJob(spec(mk(), a)).step(1e9);
  const job = new RasterJob(spec(mk(), b)); let slices = 0;
  while (!job.step(0.0001) && slices < 1000) slices++;   // a tiny budget: one row (never fewer) per slice
  assert.ok(slices > 20, `${slices} slices`); assert.deepEqual(a, b, 'sliced == one pass');
  // every opaque pixel is a palette colour or a hairline blend of two: nothing is half-faded
  const bands = new Set(); for (const g of ['paper']) for (let v = -60; v <= 60; v += 0.25) { const [r, gg, bb, al] = pal.bandRGBA('z500a', v, g); if (al) bands.add(`${r},${gg},${bb}`); }
  let drawn = 0, off = 0, alphaLow = 0;
  for (const u of a) { if (!u) continue; drawn++; if ((u >>> 24) !== 255) alphaLow++; if (!bands.has(`${u & 255},${(u >> 8) & 255},${(u >> 16) & 255}`)) off++; }
  assert.ok(drawn > 20000 && alphaLow < drawn * 0.005, `${drawn} drawn, ${alphaLow} not opaque (hairline ink over the unshaded gap only)`);
  assert.ok(off > 0 && off < drawn * 0.08, `hairline pixels are the only non-band colours: ${off} of ${drawn}`);
  // cancel: a cancelled job paints no more rows
  const c = new Uint32Array(90000), j2 = new RasterJob(spec(mk(), c)); j2.step(0.0001); j2.cancel();
  const before = c.slice(); assert.equal(j2.step(1e9), false); assert.deepEqual(c, before, 'no rows after cancel');
});

test('compose: plan() reads the lens (Pattern when absent); needed() adds the global underlay in Regional', async () => {
  const { plan, needed, domainFor, doubtWanted, underlayFor } = await load('render/compose.js'), data = await load('data/index.js');
  const fs = await import('node:fs'), path = await import('node:path');
  const dir = new URL('../fixtures/synthetic-15d/', import.meta.url).pathname;
  data._reset({ fetch: async (u) => { const b = fs.readFileSync(path.join(dir, u.replace(/^data\//, ''))); return { ok: true, status: 200, json: async () => JSON.parse(b), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; } });
  await data.loadManifest();
  const m = data.getManifest();
  const lens = plan({ lens: 'z', layers: { z: false, j: true }, overlays: {} }, m);
  assert.deepEqual([lens.lens, lens.anom?.field, lens.anom?.palette, lens.contour, lens.doubt, lens.jet], ['z', 'z500a', 'z500a', 'z500', true, null], 'the retired layers flags are ignored: store.lens decides');
  assert.equal(plan({ overlays: {} }, m).lens, 'z', 'no lens is the Pattern');
  const jet = plan({ lens: 'j', overlays: {} }, m), outline = plan({ lens: 'z', overlays: { jetline: true } }, m);
  assert.deepEqual([jet.anom?.field, jet.jet, jet.jetLine], ['ws250', 'ws250', null], 'the jet lens fills with the jet');
  assert.deepEqual([outline.anom.field, outline.jet, outline.jetLine], ['z500a', null, 'ws250'], 'never two fills: the jet over the pattern is an outline');
  // whichever lenses are still unbuilt (the set shrinks as the lens packages land): each draws nothing
  const { LENSES } = await load('lenses/index.js');
  for (const l of LENSES.filter((x) => !x.implemented)) {
    const unlisted = plan({ lens: l.code, overlays: {} }, m);
    assert.deepEqual([unlisted.anom, unlisted.contour], [null, null], `a lens that is not built (${l.id}) draws nothing`);
  }
  assert.equal(plan({ lens: 'z', overlays: { contours: false } }, m).contour, null, 'the Height contours overlay switches the lines off');
  assert.equal(domainFor('z500a', 'np', m), 'np05'); assert.equal(underlayFor('z500a', 'np05', m), 'g1'); assert.equal(underlayFor('z500a', 'g1', m), null);
  const npNeed = needed({ lens: 'z', view: 'np' }, m).map((x) => x.join(':')), glNeed = needed({ lens: 'z', view: 'gl' }, m).map((x) => x.join(':'));
  assert.ok(npNeed.includes('z500a:np05') && npNeed.includes('z500a:g1') && npNeed.includes('z500sd:np05') && npNeed.includes('z500:np05'), npNeed.join());
  assert.ok(!glNeed.includes('z500a:np05') && glNeed.includes('z500a:g1'), glNeed.join());
  assert.equal(doubtWanted({ t: 10, overlays: { doubt: false } }), false); assert.equal(doubtWanted({ t: 200, overlays: { doubt: false } }), true);
  data._reset();
});

test('sample: the band value table answers exactly as palette.bandIndex, at and around every edge (W3-01 fix 3)', async () => {
  const S = await load('render/sample.js'), P = await load('render/palette.js');
  let n = 0;
  for (const [id, p] of Object.entries(P.PALETTES)) {
    const B = S.makeBander(id), e = p.edges, span = e[e.length - 1] - e[0], nI = p.neutralInterval, last = p.paper.length - 1;
    const asIndex = (j) => (j === nI ? -1 : Math.max(0, Math.min(last, j < nI ? j : j - 1)));
    const vs = [];
    for (let k = 0; k <= 20000; k++) vs.push(e[0] - 0.2 * span + (1.4 * span * k) / 20000);
    for (const x of [...e, ...p.neutral.filter(Number.isFinite)]) for (const d of [0, 1e-12, -1e-12, 1e-9, -1e-9, 1e-6, -1e-6]) vs.push(x + d, x * (1 + d));
    for (const v of vs) { n++; assert.equal(asIndex(B(v)), P.bandIndex(id, v), `${id} at ${v}`); }
  }
  assert.ok(n > 120000, `${n} values checked`);
});

test('sample: the motion raster fit keeps a playing raster near MOTION_RASTER_MS (W3-01 fix 2)', async () => {
  const S = await load('render/sample.js'), B = S.MOTION_RASTER_MS;
  const px = 375000;
  assert.equal(S.motionFit(0, px), 1, 'unknown cost: the half-scale raster');
  assert.equal(S.motionFit((0.5 * B) / px, px), 1, 'cheap enough: the half-scale raster');
  assert.equal(S.motionFit((4 * B) / px, px), 0.5, 'four times over budget: a quarter of the rest scale per side (the floor)');
  assert.equal(S.motionFit((40 * B) / px, px), 0.5, 'never below the floor');
  const f = S.motionFit((2 * B) / px, px);
  assert.ok(f < 1 && (2 * B) * f * f <= B, `twice over budget: a step that fits (${f})`);
  // a larger step needs 20% headroom: at a cost where 0.85 would take 0.9 of the budget, a scene at 0.71 stays at 0.71
  const c = (0.9 * B) / (px * 0.85 * 0.85);
  assert.equal(S.motionFit(c, px, 0.71), 0.71); assert.equal(S.motionFit(c, px, 0.85), 0.85);
  assert.equal(S.rasterSize(1440, 900, 2, 'motion', 0.5).rw, S.rasterSize(1440, 900, 2, 'rotate').rw, 'fit 0.5 is the rotate size');
});
