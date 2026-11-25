// N24 ROTATE view maths without a DOM: World and Regional turn their central meridian, the Hemisphere tilts off the pole (no roll),
// a drag keeps the grabbed place under the pointer, and the Regional turn stops where its data stops covering the frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const load = (p) => import(new URL(`../../../site/js/${p}`, import.meta.url).href);
const { d3 } = await load('vendor.js');
const manifest = JSON.parse(fs.readFileSync(new URL('../fixtures/synthetic/manifest.json', import.meta.url), 'utf8'));
const NP05 = manifest.domains.np05;
const dist = (a, b) => d3.geoDistance(a, b) * 180 / Math.PI;
const lonDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
let seed = 24; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

test('rotateForward matches d3.geoRotation; solveSpinTilt puts the grabbed place on the pointer with no roll, tilt bounded', async () => {
  const { rotateForward, solveSpinTilt } = await load('render/globe.js');
  for (let i = 0; i < 300; i++) {
    const r = [rnd() * 360 - 180, rnd() * 180 - 90, rnd() * 60 - 30], ll = [rnd() * 360 - 180, rnd() * 170 - 85];
    assert.ok(dist(rotateForward(r, ll), d3.geoRotation(r)(ll)) < 1e-9, `rotateForward ${r} ${ll}`);
  }
  // reachable: a rotation inside the range that puts g at v is found again (to 1e-6 degrees)
  for (let i = 0; i < 300; i++) {
    const rt = [rnd() * 360 - 180, -90 + rnd() * 60], g = [rnd() * 360 - 180, 15 + rnd() * 75], v = d3.geoRotation(rt)(g);
    const s = solveSpinTilt(g, v, -90 + rnd() * 60, -90, -30);
    assert.ok(s[1] >= -90 && s[1] <= -30, `tilt ${s[1]} in range`);
    assert.ok(dist(d3.geoRotation(s)(g), v) < 1e-6, `g ${g} reaches v ${v}: ${dist(d3.geoRotation(s)(g), v)}`);
  }
  // out of reach: the tilt stops at its bound and the spin still turns g toward v's bearing
  const g = [-100, 20], v = [0, 0]; // putting 20N at the centre needs phi -20, past the -30 bound
  const s = solveSpinTilt(g, v, -60, -90, -30);
  assert.equal(s[1], -30);
  const w = d3.geoRotation(s)(g);
  assert.ok(Math.abs(w[0]) < 1e-6, `the place is on the centre's meridian: ${w}`);
  // a drag straight up through the middle of the Hemisphere, step by step: the centre tilts down to 30N and stops there; the map never
  // flips round (the exact fit past the limit tilts over the pole with the spin turned 180 degrees, and is passed over)
  const { baseProjection, MapView } = await load('render/view.js');
  const nh = baseProjection('nh', 800, 800);
  let xf = { k: 1, tx: 0, ty: 0, rot: [0, 0, 0] }, prev = [400, 700];
  for (let i = 1; i <= 14; i++) {
    const to = [400, 700 - (620 * i) / 14], mv = new MapView(nh, xf), r0 = mv.rotation();
    const r1 = solveSpinTilt(mv.invert(prev), rotateForward(r0, mv.invert(to)), r0[1], -150, -30, r0[0], 90);
    assert.ok(Math.abs(r1[0] - r0[0]) < 1e-6, `step ${i}: no spin on a straight drag along the meridian (${r0[0]} -> ${r1[0]})`);
    xf = { ...xf, rot: [r1[0] - nh.rotate[0], r1[1] - nh.rotate[1], 0] }; prev = to;
  }
  const c = new MapView(nh, xf).invert([400, 400]);
  assert.ok(Math.abs(c[1] - 30) < 1e-6 && Math.abs(c[0] + 122.42) < 1e-6, `the centre stops at 30N on San Francisco's meridian: ${c}`);
  // without the jump guard the same step takes the flip, which is what the guard is for
  const flip = solveSpinTilt([-122.42, 29.2], rotateForward([122.42, -36.84], new MapView(nh, { k: 1, tx: 0, ty: 0, rot: [0, 53.16, 0] }).invert([400, 390])), -36.84, -150, -30);
  assert.ok(Math.abs(Math.abs(flip[0] - 122.42) - 180) < 1, `unguarded, crossing the middle flips the spin: ${flip}`);
});

test('World turns its central meridian: rot[0] moves the centre, every place still projects and inverts, it never tilts', async () => {
  const { baseProjection, MapView } = await load('render/view.js');
  for (const [W, H] of [[1440, 900], [390, 844]]) {
    const base = baseProjection('wm', W, H);
    for (const r of [0, 60, -150, 175]) {
      const mv = new MapView(base, { k: 1, tx: 0, ty: 0, rot: [r, 20, 0] });
      assert.deepEqual(mv.rotation(), [150 + r, 0, 0], 'no tilt, whatever rot[1] says');
      const centre = -150 - r, c = mv.project([centre, 0]);
      assert.ok(Math.abs(c[0] - W / 2) < 2, `${W}x${H} rot ${r}: ${centre} is mid-frame (${c[0].toFixed(1)})`);
      for (const ll of [[centre + 179, 50], [centre - 179, -50], [centre + 179.5, 0], [10, 80]]) {
        const q = mv.project(ll), back = q && mv.invert(q);
        assert.ok(back && lonDiff(back[0], ll[0]) < 0.5 && Math.abs(back[1] - ll[1]) < 0.5, `${ll} -> ${q} -> ${back}`);
      }
    }
  }
});

test('spinForDrag: World keeps the grabbed place under the pointer exactly; Regional too, with the pan for the row', async () => {
  const { baseProjection, MapView, spinForDrag } = await load('render/view.js');
  for (const [W, H] of [[1440, 900], [390, 844]]) {
    const base = baseProjection('wm', W, H);
    for (const xf of [{ k: 1, tx: 0, ty: 0, rot: [0, 0, 0] }, { k: 3, tx: -W, ty: -H * 0.9, rot: [40, 0, 0] }]) {
      for (let i = 0; i < 20; i++) {
        const from = [W * (0.3 + 0.4 * rnd()), H * (0.4 + 0.2 * rnd())], to = [from[0] + (rnd() - 0.5) * 300, from[1]];
        const g = new MapView(base, xf).invert(from);
        if (!g || !new MapView(base, xf).invert(to)) continue; // both ends on the map's own row
        const { d, g: grabbed } = spinForDrag(base, xf, from, to);
        assert.ok(grabbed && dist(grabbed, g) < 1e-9);
        const q = new MapView(base, { ...xf, rot: [xf.rot[0] + d, 0, 0] }).project(g);
        assert.ok(Math.abs(q[0] - to[0]) < 0.01 && Math.abs(q[1] - from[1]) < 0.01, `World ${W}x${H} k${xf.k}: ${from} -> ${to}, the place lands at ${q}`);
      }
    }
  }
  const base = baseProjection('np', 1000, 600), xf = { k: 2, tx: -500, ty: -300, rot: [0, 0, 0] };
  for (const [from, to] of [[[500, 300], [560, 330]], [[300, 200], [120, 150]], [[700, 450], [760, 300]]]) {
    const g = new MapView(base, xf).invert(from), { d } = spinForDrag(base, xf, from, to);
    const turned = { ...xf, rot: [d, 0, 0] }, q = new MapView(base, turned).project(g);
    const x = { ...turned, ty: xf.ty + to[1] - q[1] }, at = new MapView(base, x).project(g);
    assert.ok(Math.abs(at[0] - to[0]) < 0.01 && Math.abs(at[1] - to[1]) < 0.01, `Regional ${from} -> ${to}: the place lands at ${at}`);
  }
});

test('Regional turn limits: the data domain still covers the canvas side to side; at a limit its edge is on the frame edge', async () => {
  const { baseProjection, MapView, regionalSpinLimits, domainBoxAt, domainBox } = await load('render/view.js');
  const lon1 = NP05.lon0 + (NP05.nx - 1) * NP05.dlon;
  const edgeX = (mv, lon, fn) => { const xs = []; for (let lat = 10; lat <= 75; lat += 0.25) { const q = mv.project([lon, lat]); if (q) xs.push(q[0]); } return fn(...xs); };
  const spans = {};
  for (const [W, H] of [[1000, 600], [390, 844], [1280, 800]]) {
    const base = baseProjection('np', W, H);
    assert.deepEqual(domainBoxAt(base, NP05, 0), domainBox(base, NP05), 'no turn is the plain domain box');
    for (const k of [1, 2.5]) {
      const tx = (W - W * k) / 2, [lo, hi] = regionalSpinLimits(base, NP05, k, tx);
      assert.ok(lo <= 0 && hi >= 0, `${W}x${H} k${k}: [${lo}, ${hi}] holds 0`);
      assert.ok(lo >= -66 && hi <= 26, `${W}x${H} k${k}: [${lo}, ${hi}] keeps the domain within 125 degrees of the central meridian`);
      spans[`${W}x${H}x${k}`] = [lo, hi];
      const west = new MapView(base, { k, tx, ty: 0, rot: [hi, 0, 0] }), east = new MapView(base, { k, tx, ty: 0, rot: [lo, 0, 0] });
      if (hi < 25.7) assert.ok(Math.abs(edgeX(west, NP05.lon0, Math.min)) < 0.5, `${W}x${H} k${k}: turned to ${hi.toFixed(2)} the data's west edge is on x = 0 (${edgeX(west, NP05.lon0, Math.min)})`);
      if (lo > -64.2) assert.ok(Math.abs(edgeX(east, lon1, Math.max) - W) < 0.5, `${W}x${H} k${k}: turned to ${lo.toFixed(2)} the data's east edge is on x = W (${edgeX(east, lon1, Math.max)})`);
      if (hi < 24) assert.ok(edgeX(new MapView(base, { k, tx, ty: 0, rot: [hi + 1, 0, 0] }), NP05.lon0, Math.min) > 0.5, 'a degree past the limit the west edge is inside the frame');
    }
  }
  const width = (k) => spans[k][1] - spans[k][0];
  assert.ok(width('390x844x1') > 40, `a phone turns the Regional map through ${width('390x844x1').toFixed(1)} degrees at 1x`);
  assert.ok(width('1000x600x2.5') > width('1000x600x1') + 20, `zoomed in, the turn reaches further across the data (${width('1000x600x1').toFixed(1)} -> ${width('1000x600x2.5').toFixed(1)})`);
});

test('Hemisphere tilts either way across the pole down to 30N and no further; Regional and World draw every point (no clip), the rotation is in every cache key', async () => {
  const { baseProjection, MapView, NH_TILT_MAX } = await load('render/view.js');
  assert.equal(NH_TILT_MAX, 60);
  const nh = baseProjection('nh', 800, 800);
  const tilted = new MapView(nh, { k: 1, tx: 0, ty: 0, rot: [0, 80, 0] });
  assert.deepEqual(tilted.rotation(), [122.42, -30], 'the tilt stops at 30N');
  const c = tilted.invert([400, 400]);
  assert.ok(Math.abs(c[1] - 30) < 1e-6 && lonDiff(c[0], -122.42) < 1e-6, `the centre is 30N on San Francisco's meridian: ${c}`);
  assert.ok(tilted.project([-122.42, -40]), 'tilted, 40S is on the disc (75 degrees from the centre)');
  assert.equal(new MapView(nh).project([-122.42, -40]), null, 'at the pole it is not');
  // across the pole the other way: the centre goes over to the far meridian, still no further than 30N
  const over = new MapView(nh, { k: 1, tx: 0, ty: 0, rot: [0, -80, 0] });
  assert.deepEqual(over.rotation(), [122.42, -150]);
  const c2 = over.invert([400, 400]);
  assert.ok(Math.abs(c2[1] - 30) < 1e-6 && lonDiff(c2[0], 57.58) < 1e-6, `the centre is 30N on the meridian opposite San Francisco's: ${c2}`);
  for (const v of ['np', 'wm']) {
    const base = baseProjection(v, 900, 600), a = new MapView(base), b = new MapView(base, { k: 1, tx: 0, ty: 0, rot: [10, 0, 0] });
    assert.notEqual(a.key, b.key, `${v}: a turned view has its own key (meshes, lookups, basemap paths and contours are cached by it)`);
    assert.equal(a._clip, null); assert.equal(b._clip, null);
    const pa = a.project([-100, 40]), pb = b.project([-100, 40]);
    assert.ok(Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) > 5, `${v}: the turn moves the map`);
  }
});
