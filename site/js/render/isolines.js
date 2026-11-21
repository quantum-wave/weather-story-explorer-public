// Isolines: joined, smoothed contour polylines and collision-aware upright labels (DESIGN-SPEC 4.3, W2-04).
// Pure: no DOM, no d3. Marching squares comes from contours.js (contourSegments); this module chains its segments into
// polylines by shared cell edges, smooths them with Chaikin passes and places labels.
//
// A polyline is {pts: number[] (flat x0,y0,x1,y1,...), closed: boolean}. A closed ring does not repeat its first point.
import { contourSegments, CONTOUR_STEP_GPM, BOLD_DAM } from './contours.js';

export { CONTOUR_STEP_GPM, BOLD_DAM };
const NUDGE = 1e-6; // fraction of a step
const MERGE = 1e-3; // vertices closer than this fraction of the node spacing are merged before smoothing
export const MIN_VERTICES = 8; // pieces with fewer vertices are dropped (spec 4.3)

/**
 * Join marching-squares segments (flat x0,y0,x1,y1 per segment) into polylines. Segments of neighbouring cells share an
 * edge crossing computed from the same two node values in the same order, so the shared endpoint is bit-identical and is
 * matched exactly (open-addressing hash on the float bits, no strings). Zero-length segments are ignored. Lines that
 * reach a clipped node or the grid edge are returned open; the rest are closed rings.
 */
export function chain(segments, { minVertices = 1 } = {}) {
  const src = segments instanceof Float64Array ? segments : Float64Array.from(segments);
  const n = Math.floor(src.length / 4);
  // endpoint e (0..2n-1) has coordinates c[2e], c[2e+1]; segment s owns endpoints 2s and 2s+1. -0 is normalised to 0.
  const c = new Float64Array(n * 4);
  for (let k = 0; k < c.length; k++) c[k] = src[k] + 0;
  const u = new Uint32Array(c.buffer);
  let size = 16; while (size < n * 8) size <<= 1;
  const table = new Int32Array(size).fill(-1), mask = size - 1;
  const pt = new Int32Array(2 * n), head = new Int32Array(2 * n).fill(-1), nxt = new Int32Array(2 * n).fill(-1), deg = new Uint8Array(2 * n);
  let np = 0;
  const px = new Int32Array(2 * n); // point id -> a representative endpoint
  for (let e = 0; e < 2 * n; e++) {
    const x = c[2 * e], y = c[2 * e + 1];
    let h = (Math.imul(u[4 * e] ^ Math.imul(u[4 * e + 1], 0x9E3779B1), 0x85EBCA6B) ^ Math.imul(u[4 * e + 2] ^ Math.imul(u[4 * e + 3], 0xC2B2AE35), 0x27D4EB2F));
    h = (h ^ (h >>> 15)) & mask;
    let p;
    for (;;) {
      p = table[h];
      if (p < 0) { p = np++; table[h] = p; px[p] = e; break; }
      const r = px[p];
      if (c[2 * r] === x && c[2 * r + 1] === y) break;
      h = (h + 1) & mask;
    }
    pt[e] = p; nxt[e] = head[p]; head[p] = e; deg[p]++;
  }
  const used = new Uint8Array(n), out = [];
  for (let s = 0; s < n; s++) if (c[4 * s] === c[4 * s + 2] && c[4 * s + 1] === c[4 * s + 3]) used[s] = 1; // zero length
  const unusedAt = (p) => { for (let e = head[p]; e >= 0; e = nxt[e]) if (!used[e >> 1]) return e; return -1; };
  const walk = (e0) => {
    const pts = [c[2 * e0], c[2 * e0 + 1]], startP = pt[e0];
    let e = e0, p = startP;
    for (;;) {
      used[e >> 1] = 1;
      const far = e ^ 1;
      pts.push(c[2 * far], c[2 * far + 1]);
      p = pt[far];
      e = unusedAt(p);
      if (e < 0) break;
    }
    const closed = p === startP && pts.length >= 8;
    if (closed) pts.length -= 2;
    return { pts, closed };
  };
  // Open lines first: start at a point where an odd number of segments meet (a line end), then rings from what is left.
  for (let s = 0; s < n; s++) {
    if (used[s]) continue;
    for (const e of [2 * s, 2 * s + 1]) {
      if (!used[s] && (deg[pt[e]] & 1)) { const l = walk(e); if (l.pts.length >= 2 * minVertices) out.push(l); }
    }
  }
  for (let s = 0; s < n; s++) if (!used[s]) { const l = walk(2 * s); if (l.pts.length >= 2 * minVertices) out.push(l); }
  return out;
}

/**
 * Merge consecutive vertices closer than `tol` into their midpoint (rings also across the wrap). A nudged crossing sits
 * about NUDGE of a cell from a node that equals the level, so two crossings around that node form a micro-edge; Chaikin
 * would cut that edge and leave the real corner at the node sharp. Merged, the corner is one vertex and gets rounded.
 */
export function mergeClose(line, tol) {
  const { pts, closed } = line, m = pts.length / 2, t2 = tol * tol;
  const out = [];
  let i = 0;
  while (i < m) {
    let sx = pts[2 * i], sy = pts[2 * i + 1], n = 1, j = i + 1;
    while (j < m) { // grow the run while the next vertex is close to the run's last vertex
      const dx = pts[2 * j] - pts[2 * j - 2], dy = pts[2 * j + 1] - pts[2 * j - 1];
      if (dx * dx + dy * dy > t2) break;
      sx += pts[2 * j]; sy += pts[2 * j + 1]; n++; j++;
    }
    if (!(n > 1 && !closed && (i === 0 || j === m))) out.push(sx / n, sy / n);
    else if (i === 0) out.push(pts[0], pts[1]); // open ends stay put
    else out.push(pts[2 * m - 2], pts[2 * m - 1]);
    i = j;
  }
  if (closed && out.length >= 4) { // wrap: last and first vertex of a ring
    const dx = out[out.length - 2] - out[0], dy = out[out.length - 1] - out[1];
    if (dx * dx + dy * dy <= t2) { out[0] = (out[0] + out[out.length - 2]) / 2; out[1] = (out[1] + out[out.length - 1]) / 2; out.length -= 2; }
  }
  return { pts: out, closed };
}

/**
 * Typical node spacing in px: the median distance between grid neighbours (east and south of each node, `nodes` x,y
 * pairs row-major over dom.nx x dom.ny) over the pairs whose four coordinates are finite and whose distance is above
 * zero. Clipped nodes (NaN: off the globe's near side, outside a view), collapsed rows (a pole projected to one point)
 * and the odd seam jump do not move it; any one node pair would. 1 when no pair qualifies (no cell is drawn then).
 */
export function nodeSpacing(nodes, dom) {
  const nx = dom && dom.nx, ny = dom && dom.ny;
  if (!nodes || !(nx > 0) || !(ny > 0) || nodes.length < 2 * nx * ny) return 1;
  const d = new Float64Array(2 * nx * ny);
  let n = 0;
  // squared distances (same order, so the same median element); NaN fails both comparisons, Infinity the second
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = 2 * (j * nx + i), x0 = nodes[p], y0 = nodes[p + 1];
      if (i + 1 < nx) { const dx = nodes[p + 2] - x0, dy = nodes[p + 3] - y0, v = dx * dx + dy * dy; if (v > 0 && v < Infinity) d[n++] = v; }
      if (j + 1 < ny) { const q = p + 2 * nx, dx = nodes[q] - x0, dy = nodes[q + 1] - y0, v = dx * dx + dy * dy; if (v > 0 && v < Infinity) d[n++] = v; }
    }
  }
  if (!n) return 1;
  // median by quickselect (O(n), the grid may hold ~80k pairs and this runs per contour pass)
  const k = n >> 1;
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const piv = d[(lo + hi) >> 1];
    let a = lo, b = hi;
    while (a <= b) {
      while (d[a] < piv) a++;
      while (d[b] > piv) b--;
      if (a <= b) { const t = d[a]; d[a] = d[b]; d[b] = t; a++; b--; }
    }
    if (k <= b) hi = b; else if (k >= a) lo = a; else break;
  }
  return Math.sqrt(d[k]);
}

/** One Chaikin corner-cutting pass. Open lines keep both end points. */
function chaikin(pts, closed) {
  const m = pts.length / 2, out = [];
  if (closed) {
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m, ax = pts[2 * i], ay = pts[2 * i + 1], bx = pts[2 * j], by = pts[2 * j + 1];
      out.push(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by, 0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by);
    }
    return out;
  }
  out.push(pts[0], pts[1]);
  for (let i = 0; i < m - 1; i++) {
    const ax = pts[2 * i], ay = pts[2 * i + 1], bx = pts[2 * i + 2], by = pts[2 * i + 3];
    out.push(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by, 0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by);
  }
  out.push(pts[2 * m - 2], pts[2 * m - 1]);
  return out;
}

/** Smooth a polyline {pts, closed} with `iterations` Chaikin passes (default 2). Returns a new polyline. */
export function smooth(line, iterations = 2) {
  let pts = line.pts;
  for (let k = 0; k < iterations; k++) pts = chaikin(pts, line.closed);
  return { pts, closed: line.closed };
}

/**
 * Contour polylines per level: marching squares, chain, smooth. Same arguments as contourSegments, plus
 * `iterations` (2) and `minVertices` (8, counted before smoothing). Returns [{level, lines: [{pts, closed}]}], levels
 * ascending, levels with no surviving line omitted.
 */
export function isolines(vals, dom, nodes, W, { step = CONTOUR_STEP_GPM, levels = null, iterations = 2, minVertices = MIN_VERTICES } = {}) {
  // Classify against a level nudged just below the real one. A node that equals the level exactly (integer data on a
  // multiple of the step) then counts as high with a crossing a hair away from it on each of its edges, never on the
  // node itself, so no vertex is shared by four segments and no two lines of a level touch, let alone cross.
  const eps = NUDGE * step;
  let list = levels;
  if (!list) {
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < vals.length; k++) { const v = vals[k]; if (v < lo) lo = v; if (v > hi) hi = v; }
    list = [];
    if (hi >= lo) for (let q = Math.ceil(lo / step); q <= Math.floor(hi / step); q++) list.push(q * step);
  }
  const out = [];
  if (!list.length) return out;
  const tol = MERGE * nodeSpacing(nodes, dom);
  const real = new Map(list.map((v) => [v - eps, v]));
  for (const { level, seg } of contourSegments(vals, dom, nodes, W, { step, levels: [...real.keys()] })) {
    const lines = chain(seg, { minVertices }).map((l) => mergeClose(l, tol)).filter((l) => l.pts.length >= (l.closed ? 6 : 4)).map((l) => smooth(l, iterations));
    if (lines.length) out.push({ level: real.get(level), lines });
  }
  return out;
}

const LABEL_H = 14, LABEL_PAD = 3;

/** Axis-aligned box of a label of width w, height h centred at (x, y) and turned by `angle`. */
function labelBox(x, y, w, h, angle) {
  const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  const hw = (w * c + h * s) / 2, hh = (w * s + h * c) / 2;
  return { x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh };
}

/**
 * Label positions along the lines of `isolines()` output: levels that are multiples of `every` dam (12) only, the
 * `bold` dam levels first. Each label sits on a nearly straight stretch of a line, turned along it and never upside
 * down (angle in [-pi/2, pi/2]), at least `minGap` px (320) from every other label, inside the margin, and its box
 * touches no `avoid` rectangle ({x, y, w, h}). Returns [{x, y, angle, text}].
 */
export function labelSpots(lines, W, H, { minGap = 320, avoid = [], unit = 10, every = 12, bold = BOLD_DAM, margin = 24, charW = 6.5, straight = 0.985, maxDev = Infinity, taken = [], max = Infinity } = {}) {
  // `taken`: spots already placed by another call ({x, y}); every new one keeps `minGap` from them. `max`: at most that many new spots.
  // `maxDev`: the stretch under a label may sit at most that many px off its chord at three inner points (a corner inside it fails).
  const spots = [], boxes = [];
  const rank = (l) => (bold.includes(l.level / unit) ? 0 : 1);
  const levels = lines.filter((l) => (l.level / unit) % every === 0).sort((a, b) => rank(a) - rank(b) || a.level - b.level);
  for (const { level, lines: polys } of levels) {
    if (spots.length >= max) break;
    const text = String(level / unit), w = text.length * charW + 2 * LABEL_PAD;
    for (const { pts, closed } of polys) {
      const m = pts.length / 2, cum = [0];
      const total = (() => { const k = closed ? m : m - 1; for (let i = 0; i < k; i++) { const j = (i + 1) % m; cum.push(cum[i] + Math.hypot(pts[2 * j] - pts[2 * i], pts[2 * j + 1] - pts[2 * i + 1])); } return cum[k]; })();
      if (total < 2 * w) continue;
      const at = (sArc) => { // point at arclength sArc (wrapped for rings)
        let sa = closed ? ((sArc % total) + total) % total : Math.min(Math.max(sArc, 0), total);
        let lo = 0, hi = cum.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= sa) lo = mid; else hi = mid; }
        const j = (lo + 1) % m, t = (sa - cum[lo]) / ((cum[lo + 1] - cum[lo]) || 1);
        return [pts[2 * lo] + t * (pts[2 * j] - pts[2 * lo]), pts[2 * lo + 1] + t * (pts[2 * j + 1] - pts[2 * lo + 1])];
      };
      const stepArc = Math.max(12, w / 2), cands = [];
      for (let sArc = closed ? 0 : w / 2; closed ? sArc < total : sArc <= total - w / 2; sArc += stepArc) cands.push(sArc);
      const mid = total / 2;
      cands.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
      for (const sArc of cands) {
        const [x, y] = at(sArc);
        if (x < margin || y < margin || x > W - margin || y > H - margin) continue;
        const [x0, y0] = at(sArc - w / 2), [x1, y1] = at(sArc + w / 2);
        const chord = Math.hypot(x1 - x0, y1 - y0);
        if (chord < straight * w) continue; // the stretch under the label bends too much
        if (maxDev < Infinity) {
          let bent = false;
          for (const f of [0.25, 0.5, 0.75]) {
            const [px, py] = at(sArc - w / 2 + f * w);
            if (Math.abs((px - x0) * (y1 - y0) - (py - y0) * (x1 - x0)) / (chord || 1) > maxDev) { bent = true; break; }
          }
          if (bent) continue;
        }
        // the middle of the stretch must sit on the chord as well (an S-curve has a short chord but not a long detour)
        let angle = Math.atan2(y1 - y0, x1 - x0);
        if (angle > Math.PI / 2) angle -= Math.PI; else if (angle < -Math.PI / 2) angle += Math.PI;
        if (angle === -Math.PI / 2) angle = Math.PI / 2;
        if (spots.some((q) => Math.hypot(q.x - x, q.y - y) < minGap) || taken.some((q) => Math.hypot(q.x - x, q.y - y) < minGap)) continue;
        const b = labelBox(x, y, w, LABEL_H, angle);
        if (b.x0 < margin / 2 || b.y0 < margin / 2 || b.x1 > W - margin / 2 || b.y1 > H - margin / 2) continue;
        if (avoid.some((r) => b.x1 > r.x && b.x0 < r.x + r.w && b.y1 > r.y && b.y0 < r.y + r.h)) continue;
        spots.push({ x, y, angle, text });
        boxes.push(b);
        if (spots.length >= max) break;
      }
    }
  }
  return spots;
}
