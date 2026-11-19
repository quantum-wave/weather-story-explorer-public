// W3-03 view maths without a DOM: the orthographic globe and its far side, Regional framing, the inverse mesh, pan limits, and
// that rotating redraws allocate no typed arrays.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const load = (p) => import(new URL(`../../../site/js/${p}`, import.meta.url).href);
const manifest = JSON.parse(fs.readFileSync(new URL('../fixtures/synthetic/manifest.json', import.meta.url), 'utf8'));
const G1 = manifest.domains.g1, NP05 = manifest.domains.np05;
const SF = [-122.42, 37.77], ANCHORAGE = [-149.9, 61.2], HONOLULU = [-157.86, 21.3];
const dist = (a, b) => { const r = Math.PI / 180, c = Math.sin(a[1] * r) * Math.sin(b[1] * r) + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.cos((a[0] - b[0]) * r); return Math.acos(Math.max(-1, Math.min(1, c))) / r; };

test('globe: the view centre projects, its antipode is null, off the disc is null, and project/invert round trip', async () => {
  const { baseProjection, MapView } = await load('render/view.js');
  for (const rot of [[0, 0, 0], [60, -20, 0], [-170, 50, 15]]) {
    const mv = new MapView(baseProjection('gl', 800, 800), { k: 1, tx: 0, ty: 0, rot });
    const centre = mv.invert([400, 400]);
    assert.ok(centre, 'the middle of the disc inverts');
    assert.ok(mv.project(centre), 'the view centre projects');
    assert.equal(mv.project([centre[0] + 180, -centre[1]]), null, `antipode of ${centre} is on the far side`);
    assert.equal(mv.invert([2, 2]), null, 'a canvas corner is off the disc');
    assert.equal(mv.invert([798, 400]), null, 'the right edge is off the disc');
    for (const ll of [centre, [centre[0] + 40, centre[1] + 10], [centre[0] - 30, centre[1] - 25]]) {
      const q = mv.project(ll), back = q && mv.invert(q);
      assert.ok(back && dist(back, ll) < 1e-6, `round trip ${ll}`);
    }
    // every point more than 92 degrees from the centre is hidden, every one within 88 degrees is shown
    let hidden = 0, shown = 0;
    for (let lon = -180; lon < 180; lon += 12) for (let lat = -84; lat <= 84; lat += 12) {
      const d = dist(centre, [lon, lat]), q = mv.project([lon, lat]);
      if (d > 92) { assert.equal(q, null, `${lon},${lat} is ${d.toFixed(0)} degrees away`); hidden++; }
      else if (d < 88) { assert.ok(q, `${lon},${lat} is ${d.toFixed(0)} degrees away`); shown++; }
    }
    assert.ok(hidden > 100 && shown > 100);
  }
});

test('globe: nodes() leaves the far side NaN and mesh marks only the visible disc', async () => {
  const { baseProjection, MapView } = await load('render/view.js');
  const mv = new MapView(baseProjection('gl', 600, 600));
  const P = mv.nodes('g1', G1);
  let nan = 0, ok = 0;
  for (let i = 0; i < P.length; i += 2) (Number.isNaN(P[i]) ? nan++ : ok++);
  assert.ok(nan > 0.35 * (P.length / 2) && ok > 0.25 * (P.length / 2), `far side clipped: ${nan} hidden, ${ok} visible`);
  const M = mv.mesh('g1', G1);
  assert.equal(M.step, 8);
  assert.equal(M.mok[0], 0, 'the canvas corner is outside the disc');
  assert.equal(M.mok[Math.floor(M.mh / 2) * (M.mw + 1) + Math.floor(M.mw / 2)], 1, 'the middle is inside');
});

test('mesh: {mgi, mgj, mok, mw, mh, step}; 8 px at rest, 16 px at rotate quality; cached per view', async () => {
  const { baseProjection, MapView } = await load('render/view.js');
  const mv = new MapView(baseProjection('np', 640, 480));
  const M = mv.mesh('np05', NP05);
  for (const k of ['mgi', 'mgj', 'mok', 'mw', 'mh', 'step']) assert.ok(k in M, 'has ' + k);
  assert.equal(M.step, 8); assert.equal(M.mw, 80); assert.equal(M.mh, 60);
  assert.equal(mv.mesh('np05', NP05), M, 'cached');
  mv.quality = 'rotate';
  const R = mv.mesh('np05', NP05);
  assert.equal(R.step, 16); assert.equal(R.mw, 40); assert.equal(R.mh, 30);
  // a mesh node maps back to the domain: its grid coordinate is the grid coordinate of the screen point
  const { toGrid } = await load('data/grid.js');
  const ll = mv.invert([16 * 20, 16 * 15]), g = toGrid(NP05, ll[0], ll[1]), k = 15 * (R.mw + 1) + 20;
  assert.ok(Math.abs(R.mgi[k] - g[0]) < 1e-3 && Math.abs(R.mgj[k] - g[1]) < 1e-3 && R.mok[k] === 1);
});

test('rotating the globe allocates no typed arrays: 60 rotated views at rotate quality reuse one scratch pool', async () => {
  const { baseProjection, MapView } = await load('render/view.js');
  const base = baseProjection('gl', 390, 700);
  const names = ['Float32Array', 'Float64Array', 'Int32Array', 'Uint8Array', 'Uint32Array', 'Uint8ClampedArray', 'Int16Array'];
  const real = Object.fromEntries(names.map((n) => [n, globalThis[n]]));
  let made = 0;
  const frameOf = (r) => { const mv = new MapView(base, { k: 1, tx: 0, ty: 0, rot: [r, r / 3, 0] }); mv.quality = 'rotate'; mv.lookup('g1', G1, 98, 175); mv.nodes('g1', G1); return mv; };
  frameOf(0); // warm: the pool fills on the first rotate frame
  try {
    for (const n of names) globalThis[n] = new Proxy(real[n], { construct(t, a, nt) { made++; return Reflect.construct(t, a, nt); } });
    for (let r = 1; r <= 60; r++) frameOf(r * 2);
  } finally { for (const n of names) globalThis[n] = real[n]; }
  assert.equal(made, 0, `${made} typed arrays constructed while rotating`);
  // and the known positive: rest quality does allocate, so the counter can see
  made = 0;
  try {
    for (const n of names) globalThis[n] = new Proxy(real[n], { construct(t, a, nt) { made++; return Reflect.construct(t, a, nt); } });
    const mv = new MapView(base, { k: 1, tx: 0, ty: 0, rot: [5, 0, 0] }); mv.lookup('g1', G1, 98, 175);
  } finally { for (const n of names) globalThis[n] = real[n]; }
  assert.ok(made > 0, 'the counter sees constructions at rest quality');
});

test('rotate-quality lookup agrees with a direct inverse', async () => {
  const { baseProjection, MapView } = await load('render/view.js');
  const { toGrid } = await load('data/grid.js');
  const mv = new MapView(baseProjection('gl', 400, 400), { k: 1, tx: 0, ty: 0, rot: [30, 10, 0] });
  mv.quality = 'rotate';
  const L = mv.lookup('g1', G1, 100, 100);
  let checked = 0, bad = 0;
  for (let py = 5; py < 100; py += 7) for (let px = 5; px < 100; px += 7) {
    const ll = mv.invert([(px + 0.5) * 4, (py + 0.5) * 4]), g = ll && toGrid(G1, ll[0], ll[1]), i = L.li[py * 100 + px];
    if ((i >= 0) !== !!g) { bad++; continue; }
    if (g) { checked++; const gi = (i % G1.nx) + L.fx[py * 100 + px], gj = Math.floor(i / G1.nx) + L.fy[py * 100 + px]; if (Math.abs(gj - g[1]) > 0.4 || Math.min(Math.abs(gi - g[0]), G1.nx - 1 - Math.abs(gi - g[0])) > 0.4) bad++; }
  }
  assert.ok(checked > 40 && bad === 0, `${bad} of ${checked} lookup pixels disagree`);
});

test('Regional framing: SF between 0.5 W and 0.75 W; Anchorage and Honolulu off the canvas or in the outer 15 %', async () => {
  const { baseProjection, MapView } = await load('render/view.js');
  for (const [W, H] of [[390, 844], [1000, 1300], [600, 900]]) {
    const mv = new MapView(baseProjection('np', W, H));
    const sf = mv.project(SF), an = mv.project(ANCHORAGE), ho = mv.project(HONOLULU);
    assert.ok(sf[0] >= 0.5 * W && sf[0] <= 0.75 * W, `${W}x${H}: SF at ${(sf[0] / W).toFixed(2)} W`);
    assert.ok(an[1] < 0.15 * H || an[0] < 0 || an[0] > W, `${W}x${H}: Anchorage at y=${an[1].toFixed(0)} of ${H}`);
    assert.ok(ho[1] > 0.85 * H || ho[0] < 0 || ho[0] > W, `${W}x${H}: Honolulu at y=${ho[1].toFixed(0)} of ${H}`);
  }
  // landscape keeps the wide region: SF, New York and Honolulu all on the canvas
  const land = new MapView(baseProjection('np', 1200, 700));
  for (const ll of [SF, [-74, 40.7], HONOLULU]) { const q = land.project(ll); assert.ok(q && q[0] > 0 && q[0] < 1200 && q[1] > 0 && q[1] < 700, `landscape ${ll} -> ${q}`); }
});

test('zoom 1x-8x, pan limits widen to the data domain, and a drag past a limit is damped to at most 24 px', async () => {
  const { baseProjection, MapView, clampXf, domainBox, dampOver, ZOOM_MAX, IDENTITY } = await load('render/view.js');
  assert.equal(ZOOM_MAX, 8);
  assert.equal(clampXf({ k: 99, tx: 0, ty: 0, rot: [0, 0, 0] }, 100, 100).k, 8);
  assert.equal(clampXf({ k: 0.1, tx: 0, ty: 0, rot: [0, 0, 0] }, 100, 100).k, 1);
  const base = baseProjection('np', 1000, 600), box = domainBox(base, NP05);
  assert.ok(box && box[0] <= 0 && box[2] >= 1000, 'the domain reaches past the left and right of the frame: ' + box);
  const free = clampXf({ ...IDENTITY(), tx: 9999 }, 1000, 600, box), hard = clampXf({ ...IDENTITY(), tx: 9999 }, 1000, 600);
  assert.equal(hard.tx, 0, 'without the domain the un-zoomed map cannot pan');
  assert.ok(free.tx > 0 && Math.abs(free.tx + box[0]) < 1e-9, `with it, the map pans until the domain's left edge reaches the frame's: tx ${free.tx}`);
  // at the limit the domain's west edge sits exactly on the frame's edge
  const west = new MapView(base, free);
  const xs = []; for (let lat = 10; lat <= 74; lat += 2) { const q = west.project([NP05.lon0, lat]); if (q) xs.push(q[0]); }
  assert.ok(Math.abs(Math.min(...xs)) < 1e-6, 'domain edge on the frame edge');
  for (const over of [1, 10, 100, 1e4]) assert.ok(dampOver(over) > 0 && dampOver(over) <= 24 && dampOver(-over) === -dampOver(over));
  assert.ok(dampOver(1e6) <= 24);
});

test('xf.rot is [lambda, phi, gamma]; view keys differ with the roll', async () => {
  const { baseProjection, MapView, IDENTITY, sameXf } = await load('render/view.js');
  assert.deepEqual(IDENTITY().rot, [0, 0, 0]);
  const base = baseProjection('gl', 500, 500);
  const a = new MapView(base, { k: 1, tx: 0, ty: 0, rot: [0, 0, 0] }), b = new MapView(base, { k: 1, tx: 0, ty: 0, rot: [0, 0, 20] });
  assert.notEqual(a.key, b.key);
  assert.ok(!sameXf({ k: 1, tx: 0, ty: 0, rot: [0, 0, 0] }, { k: 1, tx: 0, ty: 0, rot: [0, 0, 20] }));
  const pa = a.project([-100, 20]), pb = b.project([-100, 20]);
  assert.ok(Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) > 5, 'roll moves the map');
});
