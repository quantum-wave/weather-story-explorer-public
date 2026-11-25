// N24 ANIM: playback smoothing. The map's blend in time is a monotone cubic (data/interp.js), so a value's rate of change has no
// jolt at each data step (the linear blend had one at every step), never leaves the two bracketing values (no invented
// extremes, rain never negative), and falls back to the linear blend at the range ends and across gaps. Real frames only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const site = new URL('../../../site/js/', import.meta.url);
const load = (p) => import(new URL(p, site).href);
const fixtures = new URL('../fixtures/', import.meta.url).pathname;
const shim = (dir) => async (url) => {
  const f = path.join(dir, url.replace(/^data\//, ''));
  if (!fs.existsSync(f)) return { ok: false, status: 404 };
  const buf = fs.readFileSync(f);
  return { ok: true, status: 200, json: async () => JSON.parse(buf.toString()), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
const open = async (name) => {
  const data = await load('data/index.js');
  data._reset({ fetch: shim(path.join(fixtures, name)) });
  const m = await data.loadManifest();
  return { data, m };
};
// a deterministic pseudo-random sequence (no Math.random: a failure must reproduce)
const rng = (seed) => () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

test('interp: one tangent per step, so the slope is continuous across every interior step; values stay in the bracket', async () => {
  const { cubicAt } = await load('data/interp.js');
  const r = rng(7);
  for (let trial = 0; trial < 200; trial++) {
    const T = [0], V = [];
    for (let i = 1; i < 8; i++) T.push(T[i - 1] + (r() < 0.2 ? 12 : 6)); // 6- and 12-hourly, as real runs mix them
    for (let i = 0; i < 8; i++) V.push(r() < 0.15 ? 0 : (r() - 0.3) * 100);
    const at = (t) => {
      let i = 0; while (i < T.length - 2 && T[i + 1] <= t) i++;
      return cubicAt(t, T[i], V[i], T[i + 1], V[i + 1], i > 0 ? { t: T[i - 1], v: V[i - 1] } : null, i + 2 < T.length ? { t: T[i + 2], v: V[i + 2] } : null);
    };
    for (let i = 1; i < T.length - 1; i++) {
      const e = 1e-4, left = (at(T[i]) - at(T[i] - e)) / e, right = (at(T[i] + e) - at(T[i])) / e;
      const scale = Math.max(Math.abs(V[i] - V[i - 1]) / (T[i] - T[i - 1]), Math.abs(V[i + 1] - V[i]) / (T[i + 1] - T[i]), 1e-6);
      assert.ok(Math.abs(right - left) <= 0.01 * scale + 1e-6, `trial ${trial} step ${T[i]}: slope ${left} then ${right}`);
      assert.ok(Math.abs(at(T[i]) - V[i]) < 1e-9, 'passes through the step');
    }
    for (let i = 0; i < T.length - 1; i++) for (let s = 0; s <= 1; s += 0.05) {
      const v = at(T[i] + s * (T[i + 1] - T[i])), lo = Math.min(V[i], V[i + 1]), hi = Math.max(V[i], V[i + 1]);
      assert.ok(v >= lo - 1e-9 && v <= hi + 1e-9, `trial ${trial}: ${v} outside [${lo}, ${hi}]`);
    }
  }
});

test('interp: no neighbours is exactly the linear blend; a step that is a peak in time levels off there (no overshoot)', async () => {
  const { cubicAt, tangent } = await load('data/interp.js');
  for (const s of [0, 0.1, 0.25, 0.5, 0.9, 1]) assert.ok(Math.abs(cubicAt(6 * s, 0, 10, 6, 40) - (10 + 30 * s)) < 1e-12, 'linear at ' + s);
  assert.equal(tangent(5, -5, 6, 6), 0, 'a peak has zero slope');
  assert.equal(tangent(0, 5, 6, 6), 0, 'a flat side has zero slope');
  assert.equal(tangent(NaN, 5, 6, 6), 5, 'a missing neighbour takes the other secant');
  assert.ok(tangent(1, 100, 6, 6) <= 3 + 1e-12, 'the slope is limited to three times the smaller secant');
  // rain that stops: 0, 0, 8, 0 mm. Between the dry steps it stays exactly 0; never below 0 anywhere.
  for (let s = 0; s <= 1; s += 0.1) {
    assert.equal(cubicAt(6 + 6 * s, 6, 0, 12, 0, { t: 0, v: 0 }, { t: 18, v: 8 }), 0);
    assert.ok(cubicAt(12 + 6 * s, 12, 0, 18, 8, { t: 6, v: 0 }, { t: 24, v: 0 }) >= 0);
  }
});

// The wobble, measured on the map's own frames: the value at a node, sampled over t across several step boundaries.
async function slopeJumps(data, field, dom, t0, t1, stride = 37) {
  const steps = data.fieldSteps(field).filter((s) => s > t0 && s < t1);
  const e = 0.02;
  let cubic = 0, linear = 0, nodes = 0, maxDev = 0;
  for (const T of steps) {
    const f = (t) => Float32Array.from(data.fieldAt(field, dom, t));
    const m = f(T - e), c = f(T), p = f(T + e);
    const i = data.fieldSteps(field).indexOf(T), st = data.fieldSteps(field);
    const L = f(st[i - 1]), R = f(st[i + 1]), mid = f((T + st[i + 1]) / 2);
    for (let k = 0; k < c.length; k += stride) {
      if (!(m[k] === m[k] && p[k] === p[k] && L[k] === L[k] && R[k] === R[k])) continue;
      cubic += Math.abs((p[k] - c[k]) / e - (c[k] - m[k]) / e);
      linear += Math.abs((R[k] - c[k]) / (st[i + 1] - T) - (c[k] - L[k]) / (T - st[i - 1])); // what the linear blend did
      maxDev = Math.max(maxDev, Math.abs(mid[k] - (c[k] + R[k]) / 2));
      nodes++;
    }
  }
  return { cubic, linear, nodes, maxDev, steps: steps.length };
}

test('wobble: the slope of z500a at a place jumps at every step with the linear blend; the cubic removes the jump', async () => {
  const { data } = await open('synthetic-15d');
  await data.ensureAll('z500a', 'g1');
  const r = await slopeJumps(data, 'z500a', 'g1', 3, 75); // 12 step boundaries, before the ensemble blend
  assert.ok(r.steps >= 10 && r.nodes > 1000, `sampled ${r.nodes} node-steps over ${r.steps} steps`);
  assert.ok(r.linear > 0, 'the linear blend has a slope jump at the steps');
  const ratio = r.cubic / r.linear;
  console.log(`N24 ratio ${ratio.toFixed(4)} cubic ${r.cubic.toFixed(1)} linear ${r.linear.toFixed(1)} maxDev ${r.maxDev.toFixed(2)}`);
  assert.ok(ratio < 0.1, `slope jump at the steps, cubic over linear: ${ratio.toFixed(3)} (sum ${r.cubic.toFixed(1)} vs ${r.linear.toFixed(1)} gpm/h)`);
  assert.ok(r.maxDev > 0.5, `the cubic is really not the linear blend (largest mid-interval difference ${r.maxDev.toFixed(2)} gpm)`);
});

test('wobble: the blended pattern past 168 h is smooth across steps too (z500 and the ensemble mean both cubic)', async () => {
  const { data } = await open('synthetic-15d');
  for (const f of ['z500a', 'z500', 'z500em']) await data.ensureAll(f, 'g1');
  const r = await slopeJumps(data, 'z500a', 'g1', 171, 237);
  assert.ok(r.nodes > 500, 'sampled ' + r.nodes);
  console.log(`N24 blend ratio ${(r.cubic / r.linear).toFixed(4)}`);
  assert.ok(r.cubic / r.linear < 0.15, `inside the blend zone, cubic over linear slope jump: ${(r.cubic / r.linear).toFixed(3)}`);
});

test('range: every node at every sampled t stays inside its two bracketing steps; precipitation is never negative', async () => {
  const { data } = await open('synthetic-15d');
  for (const [f, dom] of [['z500a', 'g1'], ['msl', 'np05'], ['tp6', 'g1'], ['ws250', 'g1']]) {
    await data.ensureAll(f, dom);
    const st = data.fieldSteps(f);
    let checked = 0, neg = 0;
    for (let i = 0; i < Math.min(st.length - 1, 30); i += 3) {
      const A = Float32Array.from(data.fieldAt(f, dom, st[i])), B = Float32Array.from(data.fieldAt(f, dom, st[i + 1]));
      for (const s of [0.2, 0.5, 0.8]) {
        const X = data.fieldAt(f, dom, st[i] + s * (st[i + 1] - st[i]));
        for (let k = 0; k < X.length; k += 7) {
          if (!(A[k] === A[k] && B[k] === B[k])) { assert.ok(X[k] !== X[k], 'no data stays no data'); continue; }
          const tol = 1e-3 * Math.max(1, Math.abs(A[k]));
          assert.ok(X[k] >= Math.min(A[k], B[k]) - tol && X[k] <= Math.max(A[k], B[k]) + tol, `${f} ${st[i]}+${s}: ${X[k]} outside [${A[k]}, ${B[k]}]`);
          if (f === 'tp6' && X[k] < 0) neg++;
          checked++;
        }
      }
    }
    assert.ok(checked > 1000, `${f}: ${checked} values checked`);
    assert.equal(neg, 0, 'tp6 never negative');
  }
});

test('ensure() loads the step on each side of the bracket, so the cubic has its neighbours at a chunk edge', async () => {
  const { data, m } = await open('synthetic-15d');
  const st = m.fields.z500a.steps, edge = m.fields.z500a.chunks[0].steps[1] - 1; // last step index of chunk a
  await data.ensure('z500a', 'g1', (st[edge - 1] + st[edge]) / 2);
  const have = data.loadedRanges('z500a');
  assert.ok(have.some(([a, b]) => a <= st[edge + 1] && b >= st[edge + 1]), `the step after the bracket (${st[edge + 1]} h, next chunk) is loaded: ${JSON.stringify(have)}`);
});

test('next to a gap longer than the blend gap the cubic takes no neighbour across it (linear on that side)', async () => {
  const { artifactTmp } = await import(new URL('../lib/artifacts.mjs', import.meta.url).href);
  const { cubicAt } = await load('data/interp.js');
  const dir = artifactTmp('n24-gap-');
  try {
    const src = path.join(fixtures, 'sample-min');
    for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dir, f));
    const mp = path.join(dir, 'manifest.json'), man = JSON.parse(fs.readFileSync(mp, 'utf8'));
    man.fields.z500a.steps = [0, 12, 24, 168]; // a partial run: the last step is 144 h after the one before it
    fs.writeFileSync(mp, JSON.stringify(man));
    const data = await load('data/index.js');
    data._reset({ fetch: shim(dir) });
    await data.loadManifest();
    await data.ensureAll('z500a', 'np05');
    assert.ok(data.fieldAt('z500a', 'np05', 24), 'the step just before the gap is real data and draws');
    const [a, b, c] = [0, 12, 24].map((t) => Float32Array.from(data.fieldAt('z500a', 'np05', t)));
    const x = data.fieldAt('z500a', 'np05', 18);
    let checked = 0;
    for (let k = 0; k < x.length; k += 53) {
      if (!(a[k] === a[k] && b[k] === b[k] && c[k] === c[k])) continue;
      assert.ok(Math.abs(x[k] - cubicAt(18, 12, b[k], 24, c[k], { t: 0, v: a[k] }, null)) < 1e-3, 'node ' + k);
      checked++;
    }
    assert.ok(checked > 100);
    assert.equal(data.fieldAt('z500a', 'np05', 100), null, 'inside the gap there is still no frame');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
