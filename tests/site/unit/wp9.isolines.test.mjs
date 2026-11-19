// W2-04 (Josh point 14): joined, smoothed contours and collision-aware labels as a pure module (DESIGN-SPEC 4.3).
// The field under test is the synthetic-hires-48h circular +20 dam anomaly, decoded here independently of site code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = new URL('../../../', import.meta.url).pathname;
const fx = path.join(root, 'tests/site/fixtures/synthetic-hires-48h');
const site = new URL('../../../site/js/', import.meta.url);
const load = (p) => import(new URL(p, site).href);
const man = JSON.parse(fs.readFileSync(path.join(fx, 'manifest.json'), 'utf8'));
const NODATA = -32768;

/** Decoded frame at `step` of field `fid` on domain `dom`: physical values, NaN for no data. */
function frame(fid, dom, step) {
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
/** Node positions in px: `pxPerDeg` per degree, x east, y south. */
function nodesOf(d, pxPerDeg) {
  const P = new Float32Array(2 * d.nx * d.ny);
  for (let j = 0; j < d.ny; j++) for (let i = 0; i < d.nx; i++) { P[2 * (j * d.nx + i)] = i * d.dlon * pxPerDeg; P[2 * (j * d.nx + i) + 1] = j * -d.dlat * pxPerDeg; }
  return P;
}
const C = { lat: 46, lon: -160 }, A = 200, R12 = 12; // +20 dam (gpm 200), half height at 12 degrees
const radiusAt = (level) => R12 * Math.sqrt(Math.log(A / level) / Math.LN2);
const turnDeg = (pts, closed) => {
  const m = pts.length / 2; let worst = 0;
  for (let i = closed ? 0 : 1; i < (closed ? m : m - 1); i++) {
    const p = (i + m - 1) % m, q = (i + 1) % m;
    const ax = pts[2 * i] - pts[2 * p], ay = pts[2 * i + 1] - pts[2 * p + 1], bx = pts[2 * q] - pts[2 * i], by = pts[2 * q + 1] - pts[2 * i + 1];
    worst = Math.max(worst, Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) * 180 / Math.PI);
  }
  return worst;
};
const segInter = (a, b) => { // proper crossing of two segments [x0,y0,x1,y1]
  const o = (px, py, qx, qy, rx, ry) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  return o(a[0], a[1], a[2], a[3], b[0], b[1]) * o(a[0], a[1], a[2], a[3], b[2], b[3]) < 0 && o(b[0], b[1], b[2], b[3], a[0], a[1]) * o(b[0], b[1], b[2], b[3], a[2], a[3]) < 0;
};

// Levels whose circle stays inside the domain: np05 reaches lon 150..310 (circle of 26 degrees fits); g1 stops at -180.
const CASES = [['np05', 20, 10], ['g1', 40, 10]];

for (const [dom, lo, stepL] of CASES) {
  test(`ring test on ${dom}: each level is exactly one closed ring within 0.25 degrees of the analytic circle, no turn over 30 degrees`, async () => {
    const { isolines } = await load('render/isolines.js');
    const d = man.domains[dom], vals = frame('z500a', dom, 0), px = 20;
    const levels = []; for (let v = lo; v <= 190; v += stepL) levels.push(v);
    const out = isolines(vals, d, nodesOf(d, px), 1e6, { levels });
    assert.deepEqual(out.map((o) => o.level), levels);
    for (const { level, lines } of out) {
      assert.equal(lines.length, 1, `${dom} level ${level}: ${lines.length} lines`);
      const { pts, closed } = lines[0];
      assert.equal(closed, true, `${dom} level ${level} closed`);
      const r = radiusAt(level); let worst = 0;
      for (let i = 0; i < pts.length; i += 2) {
        const lon = d.lon0 + pts[i] / px, lat = d.lat0 - pts[i + 1] / px;
        const dl = ((lon - C.lon + 540) % 360) - 180;
        worst = Math.max(worst, Math.abs(Math.hypot(lat - C.lat, dl) - r));
      }
      assert.ok(worst <= 0.25, `${dom} level ${level}: vertex ${worst.toFixed(3)} deg off the circle`);
      const turn = turnDeg(pts, true);
      assert.ok(turn <= 30, `${dom} level ${level}: sharpest turn ${turn.toFixed(1)} deg`);
    }
  });
}

test('before: today\'s contourSegments leaves each level as hundreds of unjoined 2-point pieces', async () => {
  const { contourSegments } = await load('render/contours.js');
  const d = man.domains.np05, vals = frame('z500a', 'np05', 0);
  for (const { level, seg } of contourSegments(vals, d, nodesOf(d, 20), 1e6, { levels: [20, 100, 180] })) {
    assert.ok(seg.length / 4 > 30, `level ${level} has ${seg.length / 4} separate pieces`);
  }
});

test('chain joins a hand-made ring, an open run and ignores zero-length pieces; order and direction of segments do not matter', async () => {
  const { chain } = await load('render/isolines.js');
  const sq = [[0, 0, 1, 0], [1, 0, 1, 1], [1, 1, 0, 1], [0, 1, 0, 0]];
  const flip = [[1, 1, 0, 1], [0, 0, 0, 1], [1, 0, 0, 0], [1, 1, 1, 0], [5, 5, 5, 5]];
  for (const set of [sq, flip]) {
    const r = chain(set.flat());
    assert.equal(r.length, 1); assert.equal(r[0].closed, true); assert.equal(r[0].pts.length, 8);
  }
  const open = chain([[2, 0, 3, 0], [0, 0, 1, 0], [1, 0, 2, 0]].flat());
  assert.equal(open.length, 1); assert.equal(open[0].closed, false);
  assert.deepEqual([open[0].pts[0], open[0].pts[6]].sort(), [0, 3]);
  assert.equal(open[0].pts.length, 8);
  assert.equal(chain([0, 0, 1, 1, 5, 5, 6, 6]).length, 2); // two separate pieces stay separate
  assert.equal(chain([]).length, 0);
  assert.equal(chain([-0, 0, 1, 0, 1, 0, 1, -0].map((v) => v)).length, 1); // -0 and 0 are the same coordinate
});

test('smooth keeps open end points, wraps rings, is pure, and rounds a right angle', async () => {
  const { smooth } = await load('render/isolines.js');
  const line = { pts: [0, 0, 10, 0, 10, 10], closed: false }, copy = JSON.stringify(line);
  const s = smooth(line);
  assert.equal(JSON.stringify(line), copy);
  assert.deepEqual(s.pts.slice(0, 2), [0, 0]); assert.deepEqual(s.pts.slice(-2), [10, 10]); assert.equal(s.closed, false);
  assert.ok(turnDeg(s.pts, false) < 90 && turnDeg(s.pts, false) <= 46, `right angle softened to ${turnDeg(s.pts, false)}`);
  const ring = smooth({ pts: [0, 0, 10, 0, 10, 10, 0, 10], closed: true });
  assert.equal(ring.closed, true); assert.equal(ring.pts.length, 8 * 4); // 4 vertices, two passes: x4
  assert.equal(smooth(line, 0).pts.length, 6);
});

test('saddle cells do not cross, for a high and a low centre', async () => {
  const { chain } = await load('render/isolines.js');
  const { contourSegments } = await load('render/contours.js');
  const dom = { nx: 2, ny: 2 }, nodes = new Float32Array([0, 0, 10, 0, 0, 10, 10, 10]);
  for (const [vals, lv] of [[[1, 0, 0, 1], 0.4], [[1, 0, 0, 1], 0.6], [[0, 1, 1, 0], 0.4], [[0, 1, 1, 0], 0.6]]) {
    const [{ seg }] = contourSegments(Float64Array.from(vals), dom, nodes, 100, { levels: [lv] });
    assert.equal(seg.length, 8, 'two segments in a saddle cell');
    assert.equal(segInter(seg.slice(0, 4), seg.slice(4, 8)), false, `vals ${vals} level ${lv} crosses`);
    const lines = chain(seg);
    assert.equal(lines.length, 2, 'the two segments stay two separate lines');
    // a high centre (mean 0.5 >= level) joins the two high corners: the lines hug the low corners, so the centre lies on the high side
    const high = lv <= 0.5, highCorner = vals[0] === 1 ? [[0, 0], [10, 10]] : [[10, 0], [0, 10]];
    for (const l of lines) {
      const mx = (l.pts[0] + l.pts[2]) / 2, my = (l.pts[1] + l.pts[3]) / 2;
      const nearHigh = highCorner.some(([x, y]) => Math.hypot(mx - x, my - y) < 5);
      assert.equal(nearHigh, !high, `vals ${vals} level ${lv}: lines cut off the ${high ? 'low' : 'high'} corners`);
    }
  }
});

/** Proper crossings among all smoothed segments of one level, a line with itself included (O(n^2), small inputs only). */
function crossings(lines) {
  const S = [];
  for (const { pts, closed } of lines) { const m = pts.length / 2, K = closed ? m : m - 1; for (let i = 0; i < K; i++) { const j = (i + 1) % m; S.push([pts[2 * i], pts[2 * i + 1], pts[2 * j], pts[2 * j + 1]]); } }
  let n = 0;
  for (let a = 0; a < S.length; a++) for (let b = a + 1; b < S.length; b++) if (segInter(S[a], S[b])) n++;
  return n;
}
const gridNodes = (nx, ny) => { const P = new Float32Array(2 * nx * ny); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { P[2 * (j * nx + i)] = i * 10; P[2 * (j * nx + i) + 1] = j * 10; } return P; };

test('integer data: a saddle node equal to the level does not make smoothed lines cross; the level is reported unchanged', async () => {
  const { isolines } = await load('render/isolines.js');
  // centre node = level 1, north/south 0, east/west 2: a saddle sitting exactly on the node, four segment ends meet there without the nudge
  const vals = Float64Array.from([0, 0, 0, 0, 0, 2, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // 5x5
  const dom = { nx: 5, ny: 5 }, nodes = gridNodes(5, 5);
  const out = isolines(vals, dom, nodes, 1e6, { levels: [1], minVertices: 1 });
  assert.equal(out.length, 1); assert.equal(out[0].level, 1);
  assert.equal(crossings(out[0].lines), 0);
});

test('integer data: textured integer fields have no proper crossing among the smoothed lines of any level', async () => {
  const { isolines } = await load('render/isolines.js');
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const nx = 60, ny = 40, dom = { nx, ny }, nodes = gridNodes(nx, ny), vals = new Float64Array(nx * ny);
  for (let k = 0; k < vals.length; k++) vals[k] = Math.round(rnd() * 3);
  const out = isolines(vals, dom, nodes, 1e9, { levels: [1, 2], minVertices: 1 });
  assert.deepEqual(out.map((o) => o.level), [1, 2]);
  for (const { level, lines } of out) assert.equal(crossings(lines), 0, `level ${level}`);
  // the same with the step grid: integer gpm data on multiples of 60
  for (let k = 0; k < vals.length; k++) vals[k] = 60 * Math.round(rnd() * 3);
  const out2 = isolines(vals, dom, nodes, 1e9, { minVertices: 1 });
  assert.ok(out2.length >= 1);
  for (const { level, lines } of out2) { assert.equal(level % 60, 0); assert.equal(crossings(lines), 0, `step level ${level}`); }
});

/** Vertices of a smoothed line that turn more than 45 degrees within a 1 px arclength window each side, counted where keep(x, y); returns {n, max}. */
function sharpVertices(pts, closed, win = 1, keep = () => true) {
  const m = pts.length / 2, cum = [0], K = closed ? m : m - 1;
  for (let i = 0; i < K; i++) { const j = (i + 1) % m; cum.push(cum[i] + Math.hypot(pts[2 * j] - pts[2 * i], pts[2 * j + 1] - pts[2 * i + 1])); }
  const tot = cum[K];
  const at = (sa) => {
    if (closed) sa = ((sa % tot) + tot) % tot; else if (sa < 0 || sa > tot) return null;
    let lo = 0, hi = K; while (hi - lo > 1) { const md = (lo + hi) >> 1; if (cum[md] <= sa) lo = md; else hi = md; }
    const j = (lo + 1) % m, t = (sa - cum[lo]) / ((cum[lo + 1] - cum[lo]) || 1);
    return [pts[2 * lo] + t * (pts[2 * j] - pts[2 * lo]), pts[2 * lo + 1] + t * (pts[2 * j + 1] - pts[2 * lo + 1])];
  };
  let n = 0, max = 0;
  for (let i = 0; i < m; i++) {
    const a = at(cum[i] - win), b = at(cum[i]), c = at(cum[i] + win); if (!a || !c || !keep(b[0], b[1])) continue;
    const ang = Math.abs(Math.atan2((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]))) * 180 / Math.PI;
    if (ang > max) max = ang; if (ang > 45) n++;
  }
  return { n, max };
}

test('real integer z500 (recorded-min np05, every 60 gpm): nodes equal to a level leave no sharp smoothed corner, no worse than the same field +0.5', async () => {
  const { isolines } = await load('render/isolines.js');
  const rfx = path.join(root, 'tests/site/fixtures/recorded-min'), rm = JSON.parse(fs.readFileSync(path.join(rfx, 'manifest.json'), 'utf8'));
  const f = rm.fields.z500, d = rm.domains.np05, ch = f.chunks.find((c) => c.steps[0] <= 0 && 0 < c.steps[1]);
  assert.equal(f.scale, 1); assert.equal(f.offset, 0);
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(rfx, ch.files.np05.path))), n = d.nx * d.ny, vals = new Float64Array(n);
  for (let y = 0; y < d.ny; y++) { let acc = 0; for (let x = 0; x < d.nx; x++) { const i = y * d.nx + x; acc = (acc + ((raw[n + i] << 8) | raw[i])) & 0xFFFF; const q = acc >= 0x8000 ? acc - 0x10000 : acc; vals[i] = q === NODATA ? NaN : q; } }
  const nodes = gridNodes(d.nx, d.ny).map((v) => v * 0.4); // 4 px node spacing
  const measure = (v) => { let sharp = 0, max = 0, verts = 0; for (const { lines } of isolines(v, d, nodes, 1e9, {})) for (const l of lines) { const r = sharpVertices(l.pts, l.closed); sharp += r.n; max = Math.max(max, r.max); verts += l.pts.length / 2; } return { sharp, max, verts }; };
  let onLevel = 0; for (let k = 0; k < n; k++) if (vals[k] % 60 === 0) onLevel++;
  assert.ok(onLevel > 0, 'the field has nodes exactly on a level');
  const real = measure(vals), ctl = measure(vals.map((v) => v + 0.5));
  assert.ok(real.verts > 500);
  assert.equal(real.sharp, 0, `vertices turning over 45 degrees within 1 px: ${real.sharp} (max ${real.max.toFixed(1)}); control ${ctl.sharp} (max ${ctl.max.toFixed(1)})`);
  assert.ok(real.max <= ctl.max + 5, `max turn ${real.max.toFixed(1)} vs control ${ctl.max.toFixed(1)}`);
});

test('lines stop at no-data and at the grid edge and stay open', async () => {
  const { isolines } = await load('render/isolines.js');
  const nx = 12, ny = 22, dom = { nx, ny }, nodes = new Float32Array(2 * nx * ny), vals = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; nodes[2 * k] = i * 10; nodes[2 * k + 1] = j * 10; vals[k] = i + 0.1 * j; }
  let out = isolines(vals, dom, nodes, 1e6, { levels: [5.5] });
  assert.equal(out.length, 1); assert.equal(out[0].lines.length, 1); assert.equal(out[0].lines[0].closed, false);
  let ys = out[0].lines[0].pts.filter((_, i) => i % 2); assert.equal(Math.min(...ys), 0); assert.equal(Math.max(...ys), 210); // end points kept on the edge
  for (const j of [10, 11]) { vals[j * nx + 5] = NaN; vals[j * nx + 6] = NaN; } // a hole of no data
  out = isolines(vals, dom, nodes, 1e6, { levels: [5.5] });
  assert.equal(out[0].lines.length, 2, 'the hole splits the line');
  assert.ok(out[0].lines.every((l) => !l.closed));
  // the lines do not run through the hole: no vertex within the cells around nodes (5..6, 10..11)
  for (const l of out[0].lines) for (let i = 0; i < l.pts.length; i += 2) assert.ok(!(l.pts[i] > 40 && l.pts[i] < 70 && l.pts[i + 1] > 90 && l.pts[i + 1] < 120), 'vertex inside the hole');
});

test('short pieces (under 8 vertices) are dropped', async () => {
  const { isolines } = await load('render/isolines.js');
  const nx = 5, ny = 5, dom = { nx, ny }, nodes = new Float32Array(2 * nx * ny), vals = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; nodes[2 * k] = i * 10; nodes[2 * k + 1] = j * 10; vals[k] = (i - 2) ** 2 + (j - 2) ** 2; }
  assert.equal(isolines(vals, dom, nodes, 1e6, { levels: [0.5] }).length, 0); // a 4-vertex ring around one node
  assert.equal(isolines(vals, dom, nodes, 1e6, { levels: [0.5], minVertices: 4 }).length, 1);
});

// ---- labels ----
const labelInput = async (pxPerDeg = 20) => {
  const { isolines } = await load('render/isolines.js');
  const d = man.domains.np05, levels = []; for (let v = 20; v <= 190; v += 10) levels.push(v);
  return { lines: isolines(frame('z500a', 'np05', 0), d, nodesOf(d, pxPerDeg), 1e6, { levels }), W: 3200, H: 1300 };
};
const upright = (a) => a >= -Math.PI / 2 - 1e-12 && a <= Math.PI / 2 + 1e-12;

test('labelSpots: upright, at least minGap apart, inside the canvas, only every-12-dam levels by default', async () => {
  const { labelSpots } = await load('render/isolines.js');
  const { lines, W, H } = await labelInput();
  const spots = labelSpots(lines, W, H, { minGap: 320, every: 2, unit: 10 });
  assert.ok(spots.length >= 4, `only ${spots.length} labels`);
  for (const s of spots) { assert.ok(upright(s.angle), `angle ${s.angle}`); assert.ok(s.x > 0 && s.x < W && s.y > 0 && s.y < H); assert.equal(typeof s.text, 'string'); }
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) assert.ok(Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y) >= 320, `labels ${i} and ${j} closer than 320`);
  assert.deepEqual([...new Set(labelSpots(lines, W, H, { minGap: 40 }).map((s) => s.text))], ['12']); // 120 gpm is the only multiple of 12 dam
});

test('labelSpots: angles are upright for lines running in every direction', async () => {
  const { labelSpots } = await load('render/isolines.js');
  const ring = []; for (let k = 0; k < 120; k++) ring.push(500 + 300 * Math.cos(k / 120 * 2 * Math.PI), 500 + 300 * Math.sin(k / 120 * 2 * Math.PI));
  const lines = [{ level: 120, lines: [{ pts: ring, closed: true }, { pts: [900, 50, 100, 300], closed: false }, { pts: [100, 900, 900, 600], closed: false }, { pts: [50, 100, 50, 900], closed: false }, { pts: [900, 900, 900, 100], closed: false }] }];
  const spots = labelSpots(lines, 1000, 1000, { minGap: 60 });
  assert.ok(spots.length >= 5, `${spots.length} labels`);
  for (const s of spots) assert.ok(upright(s.angle), `angle ${s.angle} at ${s.x},${s.y}`);
  const down = spots.find((s) => Math.abs(s.x - 500) < 80 && s.y > 700 && s.y < 850);
  assert.ok(down === undefined || upright(down.angle));
});

test('labelSpots: no label box touches an avoid rectangle, and the rectangle really removes labels', async () => {
  const { labelSpots } = await load('render/isolines.js');
  const { lines, W, H } = await labelInput();
  const base = labelSpots(lines, W, H, { minGap: 200, every: 2 });
  assert.ok(base.length >= 5);
  const hit = base[0], rect = { x: hit.x - 60, y: hit.y - 30, w: 120, h: 60 };
  const spots = labelSpots(lines, W, H, { minGap: 200, every: 2, avoid: [rect] });
  assert.ok(spots.length >= 1);
  for (const s of spots) assert.ok(!(s.x > rect.x - 10 && s.x < rect.x + rect.w + 10 && s.y > rect.y - 10 && s.y < rect.y + rect.h + 10), `label at ${s.x},${s.y} in the avoid rectangle`);
  assert.ok(!spots.some((s) => s.x === hit.x && s.y === hit.y));
});

test('labelSpots: a stretch that bends sharply gets no label; a line shorter than its label gets none', async () => {
  const { labelSpots } = await load('render/isolines.js');
  const zig = [];
  for (let k = 0; k < 40; k++) { const s = Math.floor(k / 2); zig.push(200 + 12 * (s + (k % 2)), 400 + 12 * s); } // a staircase of 12 px steps
  assert.equal(labelSpots([{ level: 120, lines: [{ pts: zig, closed: false }] }], 1000, 1000).length, 0);
  assert.equal(labelSpots([{ level: 120, lines: [{ pts: [500, 500, 510, 500], closed: false }] }], 1000, 1000).length, 0);
});

// ---- time budget ----
test('time budget: np05 at 15 levels, marching squares, chain and smooth timed apart over 50 runs; chain plus smooth median <= 3 ms', async () => {
  const { chain, smooth } = await load('render/isolines.js');
  const { contourSegments } = await load('render/contours.js');
  const d = man.domains.np05, vals = frame('z500', 'np05', 0), nodes = nodesOf(d, 10);
  let lo = Infinity, hi = -Infinity; for (const v of vals) if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const levels = []; for (let k = 1; k <= 15; k++) levels.push(lo + (k * (hi - lo)) / 16);
  const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const T = { march: [], chain: [], smooth: [] }; let nLines = 0, nSeg = 0, nVert = 0;
  for (let run = -5; run < 50; run++) { // five warm-up runs, not counted
    let t0 = performance.now();
    const byLevel = contourSegments(vals, d, nodes, 1e6, { levels });
    let t1 = performance.now();
    const chained = byLevel.map(({ seg }) => chain(seg, { minVertices: 8 }));
    let t2 = performance.now();
    const sm = chained.map((ls) => ls.map((l) => smooth(l, 2)));
    let t3 = performance.now();
    if (run >= 0) { T.march.push(t1 - t0); T.chain.push(t2 - t1); T.smooth.push(t3 - t2); }
    nSeg = byLevel.reduce((s, l) => s + l.seg.length / 4, 0); nLines = sm.reduce((s, l) => s + l.length, 0); nVert = sm.reduce((s, ls) => s + ls.reduce((q, l) => q + l.pts.length / 2, 0), 0);
  }
  const both = T.chain.map((x, i) => x + T.smooth[i]);
  console.log(`isolines np05 15 levels (${nSeg} segments -> ${nLines} lines, ${nVert} smoothed vertices), median of 50 runs in ms: march ${med(T.march).toFixed(2)}, chain ${med(T.chain).toFixed(2)}, smooth ${med(T.smooth).toFixed(2)}, chain+smooth ${med(both).toFixed(2)}`);
  assert.ok(nLines > 0 && nSeg > 100, 'the field produced contours');
  assert.ok(med(both) <= 3, `chain + smooth median ${med(both).toFixed(2)} ms exceeds the 3 ms budget (report as a blocker, do not edit the budget)`);
});

// ---- merge tolerance under the node layouts the app produces (rescue round 1) ----
// isolines() merges near-node micro-edges with a tolerance scaled by the node spacing. Taking that spacing from the
// first node pair turned the corner fix off whenever node 0 was clipped (NaN: the globe's back side, outside a view)
// or row 0 collapsed (a pole projected to one point). These tests use node layouts like that.

/** recorded-min z500 at hour 0 on domain `dk`, integer gpm, NaN for no data. */
function recordedZ500(dk) {
  const rfx = path.join(root, 'tests/site/fixtures/recorded-min'), rm = JSON.parse(fs.readFileSync(path.join(rfx, 'manifest.json'), 'utf8'));
  const f = rm.fields.z500, d = rm.domains[dk], ch = f.chunks.find((c) => c.steps[0] <= 0 && 0 < c.steps[1]);
  assert.equal(f.scale, 1); assert.equal(f.offset, 0);
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(rfx, ch.files[dk].path))), n = d.nx * d.ny, vals = new Float64Array(n);
  for (let y = 0; y < d.ny; y++) { let acc = 0; for (let x = 0; x < d.nx; x++) { const i = y * d.nx + x; acc = (acc + ((raw[n + i] << 8) | raw[i])) & 0xFFFF; const q = acc >= 0x8000 ? acc - 0x10000 : acc; vals[i] = q === NODATA ? NaN : q; } }
  return { d, vals };
}
/** Orthographic globe of radius R px centred on (lonC, latC), centre of the disc at (R, R); back-side nodes NaN. */
function orthoNodes(d, lonC, latC, R) {
  const rad = Math.PI / 180, P = new Float32Array(2 * d.nx * d.ny).fill(NaN), s0 = Math.sin(latC * rad), c0 = Math.cos(latC * rad);
  for (let j = 0; j < d.ny; j++) for (let i = 0; i < d.nx; i++) {
    const lat = (d.lat0 + j * d.dlat) * rad, dl = (d.lon0 + i * d.dlon - lonC) * rad, k = j * d.nx + i;
    if (s0 * Math.sin(lat) + c0 * Math.cos(lat) * Math.cos(dl) < 0) continue; // far side
    P[2 * k] = R + R * Math.cos(lat) * Math.sin(dl); P[2 * k + 1] = R - R * (c0 * Math.sin(lat) - s0 * Math.cos(lat) * Math.cos(dl));
  }
  return P;
}
/** Proper crossings among the smoothed segments of one level (a line with itself included), bucketed so real fields stay fast. */
function crossingsFast(lines, cell = 8) {
  const S = [];
  for (const { pts, closed } of lines) { const m = pts.length / 2, K = closed ? m : m - 1; for (let i = 0; i < K; i++) { const j = (i + 1) % m; S.push([pts[2 * i], pts[2 * i + 1], pts[2 * j], pts[2 * j + 1]]); } }
  const grid = new Map();
  S.forEach((s, id) => {
    for (let gx = Math.floor(Math.min(s[0], s[2]) / cell); gx <= Math.floor(Math.max(s[0], s[2]) / cell); gx++) {
      for (let gy = Math.floor(Math.min(s[1], s[3]) / cell); gy <= Math.floor(Math.max(s[1], s[3]) / cell); gy++) {
        const key = gx + ',' + gy; let b = grid.get(key); if (!b) grid.set(key, (b = [])); b.push(id);
      }
    }
  });
  const seen = new Set(); let n = 0;
  for (const b of grid.values()) for (let x = 0; x < b.length; x++) for (let y = x + 1; y < b.length; y++) {
    const a = Math.min(b[x], b[y]), c = Math.max(b[x], b[y]), key = a * S.length + c;
    if (seen.has(key)) continue; seen.add(key);
    if (segInter(S[a], S[c])) n++;
  }
  return { n, segs: S.length };
}
/** Sharp vertices (turn over 45 degrees within 1 px) of all levels, counted only where `keep(x, y)`; crossings per level. */
function cornerReport(isolines, vals, d, nodes, keep = () => true) {
  let sharp = 0, max = 0, verts = 0, cross = 0, segs = 0;
  for (const { lines } of isolines(vals, d, nodes, 1e9, {})) {
    const c = crossingsFast(lines); cross += c.n; segs += c.segs;
    for (const l of lines) {
      verts += l.pts.length / 2;
      const r = sharpVertices(l.pts, l.closed, 1, keep); sharp += r.n; max = Math.max(max, r.max);
    }
  }
  return { sharp, max, verts, cross, segs };
}

test('nodeSpacing is the typical neighbour distance whatever node 0, row 0 or the back side do', async () => {
  const { nodeSpacing } = await load('render/isolines.js');
  const nx = 40, ny = 30, dom = { nx, ny }, base = () => gridNodes(nx, ny).map((v) => v * 1.2); // 12 px
  assert.equal(nodeSpacing(base(), dom), 12);
  let P = base(); P[0] = NaN; P[1] = NaN; assert.equal(nodeSpacing(P, dom), 12, 'node 0 clipped');
  P = base(); for (let i = 0; i < nx; i++) { P[2 * i] = 0; P[2 * i + 1] = 0; } assert.equal(nodeSpacing(P, dom), 12, 'row 0 collapsed to one point');
  P = base(); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (i < 22) { P[2 * (j * nx + i)] = NaN; P[2 * (j * nx + i) + 1] = NaN; }
  assert.equal(nodeSpacing(P, dom), 12, 'more than half the nodes on the back side');
  P = base(); for (let j = 0; j < ny; j++) for (let i = 20; i < nx; i++) P[2 * (j * nx + i)] += 5000; // a seam jump between columns 19 and 20
  assert.equal(nodeSpacing(P, dom), 12, 'a seam');
  assert.equal(nodeSpacing(new Float32Array(2 * nx * ny).fill(NaN), dom), 1, 'nothing visible');
  assert.equal(nodeSpacing(null, dom), 1);
  // globe, back side and node 0 clipped: one degree is R*pi/180 = 24.4 px at the disc centre, less with cos(lat) and toward the limb
  const g = recordedZ500('np05').d, G = orthoNodes(g, 300, 10, 1400), gs = nodeSpacing(G, g);
  assert.ok(Number.isNaN(G[0]) && gs > 0.5 * 1400 * Math.PI / 180 && gs <= 1400 * Math.PI / 180, `globe spacing ${gs}`);
});

for (const sp of [12, 30]) {
  test(`real integer z500 at ${sp} px with node 0 clipped: no sharp smoothed corner, no same-level crossing`, async () => {
    const { isolines } = await load('render/isolines.js');
    const { d, vals } = recordedZ500('np05');
    const nodes = gridNodes(d.nx, d.ny).map((v) => v * sp / 10); nodes[0] = NaN; nodes[1] = NaN;
    const r = cornerReport(isolines, vals, d, nodes), ctl = cornerReport(isolines, vals.map((v) => v + 0.5), d, nodes);
    assert.ok(r.verts > 500 && r.segs > 2000, `${r.verts} vertices`);
    assert.equal(r.cross, 0, `same-level crossings among ${r.segs} segments`);
    assert.equal(r.sharp, 0, `vertices turning over 45 degrees within 1 px: ${r.sharp} (max ${r.max.toFixed(1)}); +0.5 control ${ctl.sharp} (max ${ctl.max.toFixed(1)})`);
  });
}

test('real integer z500 with the pole row collapsed to one point: outside the pole cells no sharp corner; no same-level crossing', async () => {
  const { isolines } = await load('render/isolines.js');
  const { d, vals } = recordedZ500('np05'), sp = 12;
  const nodes = gridNodes(d.nx, d.ny).map((v) => v * sp / 10);
  for (let i = 0; i < d.nx; i++) { nodes[2 * i] = 0; nodes[2 * i + 1] = 0; }
  // the cells touching row 0 are slivers fanning into one point: lines there turn sharply in the +0.5 control too
  const keep = (x, y) => y > 1.5 * sp;
  const r = cornerReport(isolines, vals, d, nodes, keep), ctl = cornerReport(isolines, vals.map((v) => v + 0.5), d, nodes, keep);
  assert.ok(r.verts > 500);
  assert.equal(r.cross, 0, `same-level crossings among ${r.segs} segments`);
  assert.equal(ctl.sharp, 0, 'the control has no sharp corner outside the pole cells');
  assert.equal(r.sharp, 0, `sharp vertices below the pole cells: ${r.sharp} (max ${r.max.toFixed(1)}); control max ${ctl.max.toFixed(1)}`);
});

for (const [lonC, latC] of [[300, 10], [280, 0]]) {
  test(`real integer z500 on a globe centred ${lonC},${latC} with the back side clipped (node 0 too): no sharp corner inside the disc, no same-level crossing`, async () => {
    const { isolines } = await load('render/isolines.js');
    const { d, vals } = recordedZ500('np05'), R = 1400, nodes = orthoNodes(d, lonC, latC, R);
    assert.ok(Number.isNaN(nodes[0]), 'node 0 is on the back side');
    let back = 0; for (let k = 0; k < nodes.length; k += 2) if (Number.isNaN(nodes[k])) back++;
    assert.ok(back > 2000, `${back} nodes on the back side`);
    // near the limb the projection squeezes cells to slivers and lines turn sharply in the +0.5 control as well
    const keep = (x, y) => Math.hypot(x - R, y - R) < 0.85 * R;
    const r = cornerReport(isolines, vals, d, nodes, keep), ctl = cornerReport(isolines, vals.map((v) => v + 0.5), d, nodes, keep);
    assert.ok(r.verts > 500);
    assert.equal(r.cross, 0, `same-level crossings among ${r.segs} segments`);
    assert.equal(ctl.sharp, 0, 'the control has no sharp corner inside the disc');
    assert.equal(r.sharp, 0, `sharp vertices inside the disc: ${r.sharp} (max ${r.max.toFixed(1)}); control max ${ctl.max.toFixed(1)}`);
  });
}
