// W2-05 globe maths: point-follows-pointer, spinOnly, inertia with a fake clock, far-side visibility, ISC notice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { d3 } = await import(new URL('../../../site/js/vendor.js', import.meta.url).href);
const { dragRotate, spinOnly, inertia, visible } = await import(new URL('../../../site/js/render/globe.js', import.meta.url).href);
const versor = (await import(new URL('../../../site/js/render/versor.js', import.meta.url).href)).default;

const W = 400, H = 400;
const mk = (r) => d3.geoOrthographic().translate([W / 2, H / 2]).scale(180).clipAngle(90).rotate(r);
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const dist = (a, b) => d3.geoDistance(a, b) * 180 / Math.PI;

test('dragRotate: the point under p0 ends under p1 within 0.5 deg, 20 drags incl. across the pole', () => {
  const drags = [];
  // two drags straight over the north and south poles
  drags.push({ r0: [0, -60, 0], p0: [200, 90], p1: [200, 330] }); // pulls the north pole region over the top
  drags.push({ r0: [30, 55, 0], p0: [200, 330], p1: [200, 60] });
  while (drags.length < 20) {
    const pt = () => { for (;;) { const x = rnd() * W, y = rnd() * H; if (Math.hypot(x - W / 2, y - H / 2) < 165) return [x, y]; } };
    drags.push({ r0: [rnd() * 360 - 180, rnd() * 160 - 80, rnd() * 40 - 20], p0: pt(), p1: pt() });
  }
  for (const { r0, p0, p1 } of drags) {
    const proj = mk(r0);
    const grabbed = proj.invert(p0);
    const r1 = dragRotate(proj, p0, p1, r0);
    proj.rotate().forEach((x, i) => assert.ok(Math.abs(x - r0[i]) < 1e-9, 'projection rotation is restored'));
    const at = mk(r1)(grabbed);
    const back = mk(r1).invert(p1);
    assert.ok(at, 'grabbed point stays on the near side');
    assert.ok(dist(back, grabbed) < 0.5, `grabbed point ${dist(back, grabbed).toFixed(3)} deg from pointer for r0 ${r0} ${p0}->${p1}`);
  }
});

test('dragRotate: off-globe pointer returns the start rotation', () => {
  const proj = mk([10, 20, 0]);
  assert.deepEqual(dragRotate(proj, [200, 200], [5, 5], [10, 20, 0]), [10, 20, 0]);
  assert.deepEqual(dragRotate(proj, [5, 5], [200, 200], [10, 20, 0]), [10, 20, 0]);
});

test('spinOnly changes lambda only and wraps', () => {
  assert.deepEqual(spinOnly([10, 25, 3], 30), [40, 25, 3]);
  assert.deepEqual(spinOnly([170, -40, 0], 30), [-160, -40, 0]);
  assert.equal(spinOnly([0, 10, 0], -190)[0], 170);
});

function fake() {
  let now = 0, q = [], id = 0;
  return {
    raf: (fn) => { q.push([++id, fn]); return id; }, caf: (i) => { q = q.filter(([j]) => j !== i); },
    now: () => now, pending: () => q.length,
    tick(ms = 16) { now += ms; const run = q; q = []; for (const [, fn] of run) fn(now); },
    get t() { return now; },
  };
}

test('inertia from 1,000 px/s travels 40-200 px and rests within 600 ms', () => {
  const c = fake(); let px = 0, ended = 0, endT = null;
  inertia({ velocity: 1000, raf: c.raf, caf: c.caf, now: c.now, onStep: (dx) => { px += dx; }, onEnd: () => { ended++; endT = c.t; } });
  for (let i = 0; i < 80 && !ended; i++) c.tick(16);
  assert.equal(ended, 1);
  assert.ok(px >= 40 && px <= 200, `travelled ${px.toFixed(1)} px`);
  assert.ok(endT <= 600, `rested at ${endT} ms`);
  assert.equal(c.pending(), 0);
  c.tick(16); c.tick(16);
  assert.equal(ended, 1, 'onEnd fires once');
});

test('inertia: 2-D velocity, a leftward flick goes negative, cancel stops it', () => {
  const c = fake(); let sx = 0, sy = 0, ended = 0;
  const h = inertia({ velocity: { x: -800, y: 600 }, raf: c.raf, caf: c.caf, now: c.now, onStep: (dx, dy) => { sx += dx; sy += dy; }, onEnd: () => ended++ });
  c.tick(16); c.tick(16);
  assert.ok(sx < 0 && sy > 0);
  h.cancel();
  const before = sx; c.tick(16); c.tick(16);
  assert.equal(sx, before); assert.equal(ended, 1); assert.equal(c.pending(), 0);
});

test('inertia does nothing under reduced motion (and for a negligible flick)', () => {
  for (const o of [{ velocity: 1000, reducedMotion: true }, { velocity: 4 }]) {
    const c = fake(); let steps = 0;
    inertia({ ...o, raf: c.raf, caf: c.caf, now: c.now, onStep: () => steps++ });
    assert.equal(c.pending(), 0); c.tick(16);
    assert.equal(steps, 0);
  }
});

test('visible(): centre true, antipode false, horizon band', () => {
  const rot = [-30, -45, 0]; // centre is [30, 45]
  assert.equal(visible(rot, 30, 45), true);
  assert.equal(visible(rot, 30 - 180, -45), false, 'antipode of the centre');
  assert.equal(visible([0, 0, 0], 91, 0), false);
  assert.equal(visible([0, 0, 0], 89, 0), true);
  assert.equal(visible([0, -90, 0], 0, 89), true); // centre at the north pole
  assert.equal(visible([0, -90, 0], 0, -10), false);
});

test('versor.js keeps its ISC notice and VERSIONS.md has the row', () => {
  const src = fs.readFileSync(new URL('../../../site/js/render/versor.js', import.meta.url), 'utf8');
  assert.match(src, /ISC/); assert.match(src, /Mike Bostock/); assert.match(src, /d3\/versor/);
  assert.match(fs.readFileSync(new URL('../../../site/vendor/VERSIONS.md', import.meta.url), 'utf8'), /versor.*ISC/i);
  assert.deepEqual(versor.rotation(versor([20, -30, 10])).map((x) => Math.round(x * 1e6) / 1e6), [20, -30, 10]);
});
