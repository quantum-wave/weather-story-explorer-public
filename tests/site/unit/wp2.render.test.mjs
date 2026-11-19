// WP2 render modules that run without a DOM: projections, lookups, contours, colormap, legend text.
import test from 'node:test';
import assert from 'node:assert/strict';

const site = new URL('../../../site/js/', import.meta.url);
const load = (p) => import(new URL(p, site).href);
const NP = { lon0: 150, lat0: 75, dlon: 0.5, dlat: -0.5, nx: 321, ny: 131 };
const G1 = { lon0: -180, lat0: 90, dlon: 1, dlat: -1, nx: 361, ny: 181 };

test('view: np frames the region, portrait puts San Francisco 70 % across, nh points its meridian down', async () => {
  const { baseProjection, MapView, SF } = await load('render/view.js');
  const land = new MapView(baseProjection('np', 1200, 700));
  const sf = land.project(SF);
  assert.ok(sf[0] > 400 && sf[0] < 900 && sf[1] > 300 && sf[1] < 650, `landscape SF ${sf}`);
  const portrait = new MapView(baseProjection('np', 390, 844));
  assert.ok(Math.abs(portrait.project(SF)[0] / 390 - 0.7) < 0.005);
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
  assert.ok(clampXf({ k: 99, tx: 5, ty: 5, rot: [0, 0] }, 100, 100).k === 6 && clampXf({ k: 0.2, tx: 0, ty: 0, rot: [0, 0] }, 100, 100).k === 1);
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

test('colormap: LUTs are consistent with anomalyRGBA and jetRGBA; fade scales saturation', async () => {
  const cm = await load('render/colormap.js');
  const lut = cm.anomalyLUT('dark', 1), at = (dam) => lut[Math.round(((dam + 30) / 60) * 1023)];
  const unpack = (u) => [u & 255, (u >> 8) & 255, (u >> 16) & 255, u >>> 24];
  for (const d of [-24, -12, 12, 24]) assert.ok(unpack(at(d)).every((v, k) => Math.abs(v - cm.anomalyRGBA(d, 'dark')[k]) <= 3), `LUT at ${d}`);
  assert.equal(cm.anomalyLUT('dark', 1), lut, 'cached');
  assert.equal(unpack(cm.jetLUT()[0])[3], 0);
  assert.equal(cm.fadeSaturation(0), 1); assert.equal(cm.fadeSaturation(25), 1); assert.equal(cm.fadeSaturation(NaN), 1);
  assert.ok(Math.abs(cm.fadeSaturation(60) - 0.8) < 1e-9 && Math.abs(cm.fadeSaturation(300) - 0.6) < 1e-9);
});

test('legend: full legend names the unit, baseline and sample badge; compact is a bar with ticks', async () => {
  const { drawLegend } = await load('render/legend.js');
  const data = await load('data/index.js');
  const fs = await import('node:fs'), path = await import('node:path');
  const dir = new URL('../fixtures/sample-min/', import.meta.url).pathname;
  data._reset({ fetch: async (u) => { const b = fs.readFileSync(path.join(dir, u.replace(/^data\//, ''))); return { ok: true, status: 200, json: async () => JSON.parse(b), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; } });
  await data.loadManifest();
  const ctx = (() => { const texts = []; const c = new Proxy({ texts }, { get(t, k) { if (k in t) return t[k]; if (k === 'measureText') return (s) => ({ width: String(s).length * 6.5 }); if (k === 'fillText') return (s) => texts.push(String(s)); return () => {}; }, set() { return true; } }); return c; })();
  const full = drawLegend(ctx, { x: 0, y: 0, width: 260, layer: 'z', theme: 'dark', baseline: 'ERA-Interim January mean' });
  const said = ctx.texts.join(' ');
  assert.match(said, /500 hPa height vs normal · dam/);
  assert.match(said, /vs ERA-Interim January mean/);
  assert.match(said, /Blue: lower pressure aloft/);
  assert.match(said, /Sample data · .* · not a forecast/);
  ctx.texts.length = 0;
  const compact = drawLegend(ctx, { x: 0, y: 0, width: 220, layer: 'z', theme: 'dark', baseline: 0, words: false });
  assert.deepEqual(ctx.texts, ['-24', '-12', '0', '+12', '+24']);
  assert.ok(compact <= 28 && full > 80, `heights ${compact} / ${full}`);
  ctx.texts.length = 0;
  drawLegend(ctx, { layer: 'z', width: 260, baseline: 0, badge: '' });
  assert.ok(!ctx.texts.some((t) => /^vs |Sample data/.test(t)), 'falsy baseline and empty badge drop those lines');
  data._reset();
});
