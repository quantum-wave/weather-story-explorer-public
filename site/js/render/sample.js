// Field sampling and the banded raster (DESIGN-SPEC 4.2, W3-01). Pure: no DOM, no d3; the view comes in as an object with
// `mesh(domId, dom)` and `_invert([x, y])` (MapView).
//
// What it does, in the order the spec gives it:
//   - bilinear sampling on the field grid, Catmull-Rom bicubic at rest from 3x zoom;
//   - one band per pixel: the palette's own bands, opacity always 1, so a pixel's colour is the band's hex at every lead time;
//   - a 1 CSS px hairline in contour ink where a pixel's value crosses a major band edge (every fifth edge: z500a +-10, 20, 30, 40);
//   - the doubt hatch where the ensemble spread is 6 dam or more (ink at 35%, 7 px pitch, 45 degrees); the pixels between the
//     lines are untouched;
//   - the data edge: a coarse global underlay wherever the finer regional field has no data, and a 3 degree smoothstep feather
//     of the regional field over it (the values blend, so every pixel is still a band colour: nothing is ever half-opaque
//     unless no field exists at all beneath the edge, and then the edge feathers to the ground).
// The raster loop interpolates grid coordinates inline from the view's 8 px inverse mesh, a row at a time (rowValues). Its buffers
// are the output pixels, two rows of band indices and a few one-row buffers; the one per-pixel array is a motion raster's playback
// plan (acquirePlan), kept on the mesh while the view stands still, so a playing frame does not redo the geometry.
import { PALETTES, edgeHairline, bandRGBs, colorsOf } from './palette.js';
import { toGrid } from '../data/grid.js';
import { chartTokens } from './chart-tokens.js';

export const MAX_RASTER_PX = 1.5e6; // the rest raster never has more pixels than this (spec 4.2)
export const FEATHER_DEG = 3;
export const BICUBIC_FROM_ZOOM = 3;
export const SLICE_MS = 12;
const QUALITY_SCALE = { rest: 1, motion: 0.5, rotate: 0.25 }; // fraction of the rest raster scale (spec 4.2)

/**
 * The motion raster is bounded in time as well as in size: a playing frame spends at most about MOTION_RASTER_MS on it.
 * `fit` (one of MOTION_FITS) scales the motion raster's side down from half the rest scale towards a quarter of it, chosen from
 * the measured cost of this scene's rasters (motionFit). Half the rest scale stays the ceiling (spec 4.2); the quarter-size
 * 'rotate' raster is the floor.
 */
export const MOTION_RASTER_MS = 6;
export const MOTION_FITS = [1, 0.85, 0.71, 0.6, 0.5];

/**
 * Raster size for a view of w x h CSS px: min(dpr, 2) raster px per CSS px at rest, capped at 1.5 megapixels in total (above
 * the cap the scale drops and the canvas scales the raster up); half that while playing or in a gesture (times `fit`, see
 * MOTION_FITS), a quarter rotating.
 */
export function rasterSize(w, h, dpr = 1, quality = 'rest', fit = 1) {
  let s = Math.min(Math.max(dpr, 1), 2);
  if (w * h * s * s > MAX_RASTER_PX) s = Math.sqrt(MAX_RASTER_PX / (w * h));
  s *= QUALITY_SCALE[quality] ?? 1;
  if (quality === 'motion') s *= fit;
  return { rw: Math.max(2, Math.round(w * s)), rh: Math.max(2, Math.round(h * s)), scale: s };
}

/**
 * The largest MOTION_FITS step whose raster is predicted to take at most `budgetMs`, from the measured cost per raster pixel
 * (ms) and the pixel count at fit 1. Moving to a larger raster than `current` needs 20% headroom, so the size does not flap
 * between two steps. Unknown cost (0 or NaN): fit 1.
 */
export function motionFit(msPerPx, px1, current = 1, budgetMs = MOTION_RASTER_MS) {
  if (!(msPerPx > 0) || !(px1 > 0)) return current;
  for (const f of MOTION_FITS) {
    const ms = msPerPx * px1 * f * f;
    if (ms <= (f > current ? 0.8 : 1) * budgetMs) return f;
  }
  return MOTION_FITS[MOTION_FITS.length - 1];
}

/** The quality an old-style caller asks for with `low` and `rasterScale` (0.5 or less of device pixels is the motion raster). */
export function qualityFrom({ quality, low, rasterScale } = {}) {
  if (quality === 'rest' || quality === 'motion' || quality === 'rotate') return quality;
  if (low) return 'rotate';
  return typeof rasterScale === 'number' && rasterScale <= 0.5 ? 'motion' : 'rest';
}

// ---------- sampling ----------
const bad = (v) => v !== v;

export function bilinearAt(vals, nx, ny, gi, gj) {
  let i0 = gi | 0, j0 = gj | 0;
  if (i0 > nx - 2) i0 = nx - 2; if (j0 > ny - 2) j0 = ny - 2; if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0;
  const x = gi - i0, y = gj - j0, k = j0 * nx + i0;
  return (vals[k] * (1 - x) + vals[k + 1] * x) * (1 - y) + (vals[k + nx] * (1 - x) + vals[k + nx + 1] * x) * y;
}

const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
/** Catmull-Rom bicubic (taps clamped at the grid edge); a NaN anywhere in the 4 x 4 block falls back to the bilinear value. */
export function bicubicAt(vals, nx, ny, gi, gj) {
  let i1 = gi | 0, j1 = gj | 0;
  if (i1 > nx - 2) i1 = nx - 2; if (j1 > ny - 2) j1 = ny - 2; if (i1 < 0) i1 = 0; if (j1 < 0) j1 = 0;
  const tx = gi - i1, ty = gj - j1;
  const xs = [Math.max(0, i1 - 1), i1, i1 + 1, Math.min(nx - 1, i1 + 2)];
  const col = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) {
    const row = Math.min(ny - 1, Math.max(0, j1 - 1 + r)) * nx;
    const a = vals[row + xs[0]], b = vals[row + xs[1]], c = vals[row + xs[2]], d = vals[row + xs[3]];
    if (bad(a) || bad(b) || bad(c) || bad(d)) return bilinearAt(vals, nx, ny, gi, gj);
    col[r] = cr(a, b, c, d, tx);
  }
  return cr(col[0], col[1], col[2], col[3], ty);
}

export const smoothstep = (x) => { const t = x <= 0 ? 0 : x >= 1 ? 1 : x; return t * t * (3 - 2 * t); };

/** Feather weight 0..1 of a regional domain at fractional grid coordinates: 0 on its edge, 1 from `deg` degrees inside. */
export function edgeWeight(dom, gi, gj, deg = FEATHER_DEG) {
  const dx = Math.abs(dom.dlon), dy = Math.abs(dom.dlat);
  const d = Math.min(gi * dx, (dom.nx - 1 - gi) * dx, gj * dy, (dom.ny - 1 - gj) * dy);
  return smoothstep(d / deg);
}

/** A field on a 2x finer grid (bilinear, NaN where any corner is NaN): for contours of a global grid zoomed past 2x. */
export function refine2x(vals, dom) {
  const nx = dom.nx, ny = dom.ny, nx2 = 2 * nx - 1, ny2 = 2 * ny - 1, out = new Float32Array(nx2 * ny2);
  for (let j = 0; j < ny2; j++) {
    const j0 = j >> 1, j1 = Math.min(ny - 1, (j + 1) >> 1);
    for (let i = 0; i < nx2; i++) {
      const i0 = i >> 1, i1 = Math.min(nx - 1, (i + 1) >> 1);
      out[j * nx2 + i] = (vals[j0 * nx + i0] + vals[j0 * nx + i1] + vals[j1 * nx + i0] + vals[j1 * nx + i1]) / 4;
    }
  }
  return { vals: out, dom: { ...dom, nx: nx2, ny: ny2, dlon: dom.dlon / 2, dlat: dom.dlat / 2 } };
}

// ---------- bands ----------
/**
 * v -> interval index of palette `id`: the same rule as palette.bandIndex. A value table over the palette's range answers most
 * values in one read: the range is cut into 4096 cells, and a cell with no edge (and no neutral bound) anywhere in it, closed
 * and widened by a hair for rounding, has one interval for every value in it. A cell an edge touches, and a value outside the
 * range, take the exact search. The table is per palette (a few KB), not per pixel.
 */
const edgeCache = new Map(), banderCache = new Map();
const BAND_CELLS = 4096;
export function makeBander(id) {
  const hit = banderCache.get(id);
  if (hit) return hit;
  const p = PALETTES[id], n = p.edges.length, e = edgeCache.get(id) || (edgeCache.set(id, Float64Array.from(p.edges)), edgeCache.get(id)), [lo, hi] = p.neutral, seq = lo === -Infinity, nI = p.neutralInterval;
  const exact = (v, hint) => {
    let a = 0, b = n;
    // `hint` is the interval of the neighbouring pixel: the interval is unique, so when v is still inside it nothing is searched
    if (seq || v < lo) { if (hint !== undefined && (hint === 0 || e[hint - 1] <= v) && (hint === n || v < e[hint])) return hint; while (a < b) { const m = (a + b) >> 1; if (e[m] <= v) a = m + 1; else b = m; } return a; } // an edge value goes up
    if (v <= hi) return nI;
    if (hint !== undefined && hint !== nI && (hint === 0 || e[hint - 1] < v) && (hint === n || v <= e[hint])) return hint;
    while (a < b) { const m = (a + b) >> 1; if (e[m] < v) a = m + 1; else b = m; } // above the gap an edge value goes down
    return a;
  };
  const span = (e[n - 1] - e[0]) * 1.1 || 1, v0 = e[0] - span * 0.05, inv = BAND_CELLS / span, hair = span * 1e-9;
  const marks = [...e, ...[lo, hi].filter(Number.isFinite)];
  const lut = new Int16Array(BAND_CELLS);
  for (let k = 0; k < BAND_CELLS; k++) {
    const a = v0 + k / inv - hair, b = v0 + (k + 1) / inv + hair;
    lut[k] = marks.some((m) => m >= a && m <= b) ? -1 : exact((a + b) / 2);
  }
  const bander = (v, hint) => {
    const q = (v - v0) * inv;
    if (q >= 0 && q < BAND_CELLS) { const j = lut[q | 0]; if (j >= 0) return j; }
    return exact(v, hint);
  };
  // the table's parts, so the raster loop can read the table inline and call `exact` only for the values it does not answer
  bander.lut = lut; bander.v0 = v0; bander.inv = inv; bander.exact = exact;
  banderCache.set(id, bander);
  return bander;
}

const pack = (r, g, b, a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** One packed RGBA per interval (0 for the unshaded gap), and the hairline ink per interval edge (or null). Cached per palette, ground and colour family. */
const tableCache = new Map();
export function bandTables(id, ground, family) {
  const fam = colorsOf(family), key = `${id}|${ground}|${fam}`;
  let T = tableCache.get(key);
  if (T) return T;
  const p = PALETTES[id], rgb = bandRGBs(id, ground, fam), nI = p.neutralInterval;
  const colors = new Uint32Array(p.edges.length + 1), rgbs = [];
  for (let j = 0; j < colors.length; j++) {
    if (j === nI) { colors[j] = 0; rgbs.push(null); continue; } // the unshaded interval (the gap, or everything below a sequential palette's first edge)
    const i = p.neutral[0] === -Infinity ? j - 1 : (j < nI ? j : j - 1), c = rgb[Math.max(0, Math.min(rgb.length - 1, i))];
    colors[j] = pack(c[0], c[1], c[2], 255); rgbs.push(c);
  }
  // sequential palettes: interval 0 is below the first edge (unshaded), the neutral interval is 0 (p.neutralInterval)
  const major = p.edges.map((e, j) => {
    const h = edgeHairline(id, ground, e, fam);
    return h ? { rgb: hexRGB(h.color), a: h.alpha, edge: e, j } : null;
  });
  const hasMajor = major.some(Boolean);
  // cross[a * nIntervals + b]: the first major edge between intervals a and b (firstMajor), -1 for none
  const nIv = colors.length, cross = new Int16Array(nIv * nIv).fill(-1);
  if (hasMajor) for (let a = 0; a < nIv; a++) for (let b = 0; b < nIv; b++) { const m = firstMajor(major, a, b); if (m) cross[a * nIv + b] = m.j; }
  T = { colors, rgbs, major, hasMajor, cross, nIntervals: nIv };
  tableCache.set(key, T);
  return T;
}

// ---------- the raster job ----------
/** The 8 px inverse mesh of a domain from `mv.invert`, for a view that has no `mesh()` (the same shape MapView.mesh returns). */
export function meshFromInvert(mv, domId, dom, step = 8) {
  const mw = Math.ceil(mv.W / step), mh = Math.ceil(mv.H / step), n = (mw + 1) * (mh + 1);
  const mgi = new Float32Array(n), mgj = new Float32Array(n), mok = new Uint8Array(n);
  for (let r = 0; r <= mh; r++) {
    for (let c = 0; c <= mw; c++) {
      const ll = mv.invert([c * step, r * step]), g = ll && toGrid(dom, ll[0], ll[1]);
      if (g) { const k = r * (mw + 1) + c; mgi[k] = g[0]; mgj[k] = g[1]; mok[k] = 1; }
    }
  }
  return { mgi, mgj, mok, mw, mh, step };
}

// Scratch buffers a rotating frame reuses (the globe redraws every frame: no allocation there, S-GESTURE).
const POOL = new Map();
const pooled = (name, Type, n) => { const k = `${name}|${n}`; let a = POOL.get(k); if (!a) { a = new Type(n); POOL.set(k, a); } return a; };

const kindsOf = (M, pool, slot) => {
  if (M.kinds && !pool) return M.kinds;
  const { mgi, mgj, mok, mw, mh } = M, kinds = pool ? pooled(`kinds${slot}`, Uint8Array, mw * mh).fill(0) : new Uint8Array(mw * mh);
  for (let n = 0; n < mh; n++) {
    for (let m = 0; m < mw; m++) {
      const a = n * (mw + 1) + m, b = a + 1, c = a + mw + 1, d = c + 1, ok = mok[a] + mok[b] + mok[c] + mok[d];
      if (ok === 0) kinds[n * mw + m] = 2; // wholly outside the domain
      else if (ok === 4) {
        const lo = Math.min(mgi[a], mgi[b], mgi[c], mgi[d]), hi = Math.max(mgi[a], mgi[b], mgi[c], mgi[d]);
        const jl = Math.min(mgj[a], mgj[b], mgj[c], mgj[d]), jh = Math.max(mgj[a], mgj[b], mgj[c], mgj[d]);
        if (hi - lo < 6 && jh - jl < 6) kinds[n * mw + m] = 1; // smooth: interpolate; seams and poles are inverted exactly
      }
    }
  }
  if (!pool) M.kinds = kinds;
  return kinds;
};

// ---------- the per-row fast sampler ----------
// The common pixel of a raster row: its layer's mesh cell is smooth (kind 1), so its grid coordinates are a linear blend of two
// per-row node buffers (the layer's two mesh rows around this raster row, blended once per row), and the field is sampled
// inline. It is the same interpolation as RasterJob._layer (the mesh is bilinear: blending rows first and columns second is the
// same function), with no per-pixel lookup array. Anything else (a seam or pole cell, a partly covered cell) answers SLOW and the
// pixel takes the general path.
const SLOW = Infinity, OUT = -Infinity; // OUT: wholly outside the layer (kind 2)

/** Blend the layer's two mesh rows around screen row y into its row buffers. */
function prepRow(L, y) {
  const fy = y * L.invStep; let n = fy | 0; if (n > L.mh - 1) n = L.mh - 1;
  const v = fy - n, iv = 1 - v, mw = L.mw, gi = L.mgi, gj = L.mgj, ri = L.rowGi, rj = L.rowGj;
  L.kRow = n * mw;
  for (let m = 0, a = n * (mw + 1), c = a + mw + 1; m <= mw; m++, a++, c++) { ri[m] = gi[a] * iv + gi[c] * v; rj[m] = gj[a] * iv + gj[c] * v; }
}

/** The layer's value at screen x on the prepared row; OUT outside it, SLOW when the general path must decide. */
function rowSample(L, x, cubic) {
  const fx = x * L.invStep; let m = fx | 0; if (m > L.mw - 1) m = L.mw - 1;
  const kind = L.kinds[L.kRow + m];
  if (kind !== 1) return kind === 2 ? OUT : SLOW;
  const u = fx - m, ri = L.rowGi, rj = L.rowGj, gi = ri[m] + (ri[m + 1] - ri[m]) * u, gj = rj[m] + (rj[m + 1] - rj[m]) * u;
  L.gi = gi; L.gj = gj;
  const vals = L.vals, nx = L.nx, ny = L.ny;
  if (cubic) return bicubicAt(vals, nx, ny, gi, gj);
  let i0 = gi | 0, j0 = gj | 0;
  if (i0 > nx - 2) i0 = nx - 2; if (j0 > ny - 2) j0 = ny - 2; if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0;
  const tx = gi - i0, ty = gj - j0, k = j0 * nx + i0, k2 = k + nx;
  return (vals[k] * (1 - tx) + vals[k + 1] * tx) * (1 - ty) + (vals[k2] * (1 - tx) + vals[k2 + 1] * tx) * ty;
}

/**
 * A layer set's value at screen x on the prepared row (primary, else the first underlay), or SLOW. Never a feathered blend.
 * The per-pixel form of rowValues, which the raster uses: kept as its specification (the unit test holds rowValues to it).
 */
export function fastValue(LS, x, cubic) {
  const L0 = LS[0], v0 = rowSample(L0, x, cubic);
  if (v0 === OUT) {
    if (LS.length < 2) return SLOW;
    const u = rowSample(LS[1], x, cubic);
    return u === u && u !== OUT && u !== SLOW ? u : SLOW;
  }
  if (v0 !== v0 || v0 === SLOW) return SLOW;
  if (!L0.feather || (L0.gi >= L0.fx && L0.gi <= L0.fHi && L0.gj >= L0.fy && L0.gj <= L0.gHi)) return v0;
  return SLOW; // inside the feather: the general path blends
}

/**
 * A layer set's value at every raster px of the prepared row (screen x = (px + 0.5) * sx) into `out` (NaN where no layer has
 * data), and its alpha into `outA` (1 but where the primary layer fades to the ground): fastValue for each pixel, else
 * job._value, with fastValue and rowSample written out inline (a call that returns a fraction boxes it on the heap). With `sel`,
 * only the pixels where sel[px] is 1 are sampled (the others are left as they are). With a plan P (see acquirePlan) the row's
 * geometry comes from the plan, built first if this is the row it has reached; `only` is the plan's pixel set (null: every pixel).
 */
function rowValues(job, LS, rw, sx, y, cubic, out, outA, sel, P, py, only) {
  if (P !== null) {
    if (P.rowsBuilt === py) planRow(job, P, LS, py, y, rw, sx, only);
    if (P.rowsBuilt > py) return plannedRow(job, P, LS, py, y, sx, out, outA, sel);
  }
  const L0 = LS[0], has1 = LS.length > 1, L1 = has1 ? LS[1] : L0;
  const k0 = L0.kinds, r0i = L0.rowGi, r0j = L0.rowGj, s0 = L0.invStep, mx0 = L0.mw - 1, kr0 = L0.kRow, w0 = L0.vals, nx0 = L0.nx, ny0 = L0.ny;
  const fe0 = L0.feather, fx0 = L0.fx, fHi0 = L0.fHi, fy0 = L0.fy, gHi0 = L0.gHi;
  const k1 = L1.kinds, r1i = L1.rowGi, r1j = L1.rowGj, s1 = L1.invStep, mx1 = L1.mw - 1, kr1 = L1.kRow, w1 = L1.vals, nx1 = L1.nx, ny1 = L1.ny;
  for (let px = 0; px < rw; px++) {
    if (sel !== null && sel[px] === 0) continue;
    const x = (px + 0.5) * sx;
    let v = SLOW;
    const f0 = x * s0; let m0 = f0 | 0; if (m0 > mx0) m0 = mx0;
    const kind0 = k0[kr0 + m0];
    if (kind0 === 1) { // rowSample(L0), then fastValue's test of the value and the feather
      const u = f0 - m0, gi = r0i[m0] + (r0i[m0 + 1] - r0i[m0]) * u, gj = r0j[m0] + (r0j[m0 + 1] - r0j[m0]) * u;
      let s;
      if (cubic) s = bicubicAt(w0, nx0, ny0, gi, gj);
      else {
        let i0 = gi | 0, j0 = gj | 0;
        if (i0 > nx0 - 2) i0 = nx0 - 2; if (j0 > ny0 - 2) j0 = ny0 - 2; if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0;
        const tx = gi - i0, ty = gj - j0, k = j0 * nx0 + i0, k2 = k + nx0;
        s = (w0[k] * (1 - tx) + w0[k + 1] * tx) * (1 - ty) + (w0[k2] * (1 - tx) + w0[k2 + 1] * tx) * ty;
      }
      if (s === s && (!fe0 || (gi >= fx0 && gi <= fHi0 && gj >= fy0 && gj <= gHi0))) v = s;
    } else if (kind0 === 2 && has1) { // wholly outside the primary: rowSample(L1)
      const f1 = x * s1; let m1 = f1 | 0; if (m1 > mx1) m1 = mx1;
      if (k1[kr1 + m1] === 1) {
        const u = f1 - m1, gi = r1i[m1] + (r1i[m1 + 1] - r1i[m1]) * u, gj = r1j[m1] + (r1j[m1 + 1] - r1j[m1]) * u;
        let s;
        if (cubic) s = bicubicAt(w1, nx1, ny1, gi, gj);
        else {
          let i0 = gi | 0, j0 = gj | 0;
          if (i0 > nx1 - 2) i0 = nx1 - 2; if (j0 > ny1 - 2) j0 = ny1 - 2; if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0;
          const tx = gi - i0, ty = gj - j0, k = j0 * nx1 + i0, k2 = k + nx1;
          s = (w1[k] * (1 - tx) + w1[k + 1] * tx) * (1 - ty) + (w1[k2] * (1 - tx) + w1[k2 + 1] * tx) * ty;
        }
        if (s === s) v = s;
      }
    }
    if (v === SLOW) { out[px] = job._value(LS, x, y, cubic); outA[px] = job.fa; } else { out[px] = v; outA[px] = 1; }
  }
}

// ---------- the playback plan ----------
// While playing, the view and the motion raster's size stay put and only the field moves, so every frame samples the same grid
// cells with the same weights. A plan keeps that geometry for one layer set at one raster size: per pixel, which layer it reads
// (code 0 the primary, 1 the underlay) with its cell's first node k and the two weights, or (code 2) the general path's grid
// coordinates on each layer. A playing frame then reads four values and blends them, the same arithmetic on the same numbers
// as rowValues and job._value, so the same pixels bit for bit; a pixel whose cell has no data this frame takes job._value.
// A raster builds a plan when its caller asks for one (spec.plan: compose.js asks for a motion raster of the view the last
// motion raster drew, so a gesture, which moves the view every frame, never does) and uses it while it matches. One plan per
// layer set is held in all: building one drops the last (from whichever mesh holds it), so the memory is one set, however many
// views have been played on. The plan lives on its mesh, and goes with its view too.
const PLAN_CODE_PRIMARY = 0, PLAN_CODE_UNDER = 1, PLAN_CODE_GENERAL = 2;
const heldPlans = new Map(); // role -> {P, M0}: the one plan held for each layer set

/**
 * The plan for layer set LSet (role 'L' the field, 'D' the spread) at raster size rw x rh of a view W x H: the built plan when
 * its mesh holds one for this key, else a new one to build from row 0 (dropping the plan held before it). `extra` adds to the
 * key whatever else decides the pixel set (the hatch geometry for 'D'). null for a set of more than two layers.
 */
function acquirePlan(LSet, role, rw, rh, W, H, extra) {
  if (LSet.length > 2) return null;
  const M0 = LSet[0].M, M1 = LSet.length > 1 ? LSet[1].M : null;
  const key = [role, rw, rh, W, H, LSet[0].feather ? 1 : 0, extra, ...LSet.map((L) => `${L.domId}:${L.nx}x${L.ny}`)].join('|');
  const list = (M0.plans ||= []), hit = list.find((p) => p.key === key && p.M1 === M1);
  if (hit && hit.complete) return hit;
  const P = hit || { key, role, M1, complete: false, rowsBuilt: 0, n: 0, gn: 0, rowStart: null, epx: null, code: null, k: null, tx: null, ty: null, G: null };
  const old = heldPlans.get(role);
  if (old && old.P !== P) { const ol = old.M0.plans, j = ol ? ol.indexOf(old.P) : -1; if (j >= 0) ol.splice(j, 1); }
  if (!hit) list.push(P);
  heldPlans.set(role, { P, M0 });
  // build it from row 0 (a build a cancelled job left unfinished starts again)
  const cap = role === 'D' ? Math.ceil(rw * rh / 4) : rw * rh;
  if (!P.epx || P.epx.length < cap) { P.epx = new Int32Array(cap); P.code = new Uint8Array(cap); P.k = new Int32Array(cap); P.tx = new Float64Array(cap); P.ty = new Float64Array(cap); }
  if (!P.G) P.G = new Float64Array(4096);
  P.rowStart = new Int32Array(rh + 1); P.rowsBuilt = 0; P.n = 0; P.gn = 0;
  return P;
}

/** Bytes a mesh's plans hold (compose.js counts them in scene.stats.bytes). */
export function planBytes(M) {
  let n = 0;
  if (M.plans) for (const P of M.plans) if (P.epx) n += P.epx.byteLength + P.code.byteLength + P.k.byteLength + P.tx.byteLength + P.ty.byteLength + P.G.byteLength + P.rowStart.byteLength;
  return n;
}

function growPlan(P) {
  const cap = P.epx.length * 2, g = (A, T) => { const B = new T(cap); B.set(A); return B; };
  P.epx = g(P.epx, Int32Array); P.code = g(P.code, Uint8Array); P.k = g(P.k, Int32Array); P.tx = g(P.tx, Float64Array); P.ty = g(P.ty, Float64Array);
}

/** Record row py of plan P (rows in order): the geometry rowValues and job._value would use at each of its pixels (`only`: those where only[px] is 1). */
function planRow(job, P, LS, py, y, rw, sx, only) {
  const L0 = LS[0], has1 = LS.length > 1, L1 = has1 ? LS[1] : L0;
  const k0 = L0.kinds, r0i = L0.rowGi, r0j = L0.rowGj, s0 = L0.invStep, mx0 = L0.mw - 1, kr0 = L0.kRow, nx0 = L0.nx, ny0 = L0.ny;
  const fe0 = L0.feather, fx0 = L0.fx, fHi0 = L0.fHi, fy0 = L0.fy, gHi0 = L0.gHi;
  const k1 = L1.kinds, r1i = L1.rowGi, r1j = L1.rowGj, s1 = L1.invStep, mx1 = L1.mw - 1, kr1 = L1.kRow, nx1 = L1.nx, ny1 = L1.ny;
  P.rowStart[py] = P.n;
  for (let px = 0; px < rw; px++) {
    if (only !== null && only[px] === 0) continue;
    if (P.n === P.epx.length) growPlan(P);
    const e = P.n++, x = (px + 0.5) * sx;
    P.epx[e] = px;
    let code = PLAN_CODE_GENERAL, gi = 0, gj = 0, nx = nx0, ny = ny0;
    const f0 = x * s0; let m0 = f0 | 0; if (m0 > mx0) m0 = mx0;
    const kind0 = k0[kr0 + m0];
    if (kind0 === 1) {
      const u = f0 - m0; gi = r0i[m0] + (r0i[m0 + 1] - r0i[m0]) * u; gj = r0j[m0] + (r0j[m0 + 1] - r0j[m0]) * u;
      if (!fe0 || (gi >= fx0 && gi <= fHi0 && gj >= fy0 && gj <= gHi0)) code = PLAN_CODE_PRIMARY;
    } else if (kind0 === 2 && has1) {
      const f1 = x * s1; let m1 = f1 | 0; if (m1 > mx1) m1 = mx1;
      if (k1[kr1 + m1] === 1) {
        const u = f1 - m1; gi = r1i[m1] + (r1i[m1 + 1] - r1i[m1]) * u; gj = r1j[m1] + (r1j[m1 + 1] - r1j[m1]) * u;
        code = PLAN_CODE_UNDER; nx = nx1; ny = ny1;
      }
    }
    P.code[e] = code;
    if (code !== PLAN_CODE_GENERAL) {
      let i0 = gi | 0, j0 = gj | 0;
      if (i0 > nx - 2) i0 = nx - 2; if (j0 > ny - 2) j0 = ny - 2; if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0;
      P.k[e] = j0 * nx + i0; P.tx[e] = gi - i0; P.ty[e] = gj - j0;
    } else {
      if (P.gn + 4 > P.G.length) { const G = new Float64Array(P.G.length * 2); G.set(P.G); P.G = G; }
      const o = P.gn; P.gn += 4; P.k[e] = o;
      for (let li = 0; li < 2; li++) {
        const ok = li < LS.length && job._coords(LS[li], x, y);
        P.G[o + 2 * li] = ok ? job.gi : NaN; P.G[o + 2 * li + 1] = ok ? job.gj : NaN;
      }
    }
  }
  P.rowStart[py + 1] = P.n;
  P.rowsBuilt = py + 1;
  job.stats.planRows++;
  if (P.rowsBuilt === job.rh) P.complete = true;
}

/** rowValues from a built plan row (bilinear). */
function plannedRow(job, P, LS, py, y, sx, out, outA, sel) {
  const L0 = LS[0], L1 = LS.length > 1 ? LS[1] : L0, w0 = L0.vals, nx0 = L0.nx, w1 = L1.vals, nx1 = L1.nx;
  const epx = P.epx, code = P.code, pk = P.k, ptx = P.tx, pty = P.ty, G = P.G, e1 = P.rowStart[py + 1];
  for (let e = P.rowStart[py]; e < e1; e++) {
    const px = epx[e];
    if (sel !== null && sel[px] === 0) continue;
    const c = code[e];
    if (c === PLAN_CODE_GENERAL) { out[px] = job._valueAt(LS, G, pk[e]); outA[px] = job.fa; continue; }
    const k = pk[e], tx = ptx[e], ty = pty[e];
    let v;
    if (c === PLAN_CODE_PRIMARY) { const k2 = k + nx0; v = (w0[k] * (1 - tx) + w0[k + 1] * tx) * (1 - ty) + (w0[k2] * (1 - tx) + w0[k2 + 1] * tx) * ty; }
    else { const k2 = k + nx1; v = (w1[k] * (1 - tx) + w1[k + 1] * tx) * (1 - ty) + (w1[k2] * (1 - tx) + w1[k2 + 1] * tx) * ty; }
    if (v === v) { out[px] = v; outA[px] = 1; } else { out[px] = job._value(LS, (px + 0.5) * sx, y, false); outA[px] = job.fa; }
  }
}

/**
 * Paints the bands of one field into `u32` (rw x rh), row by row, resumable: `step(budgetMs)` does rows until the budget is
 * spent (never starting a row it expects to overrun) and returns true when the last row is done; `cancel()` stops it for good.
 *
 * spec: {
 *   mv, W, H, rw, rh, u32,
 *   layers: [{domId, dom, vals, feather?: bool}, ...]  primary (finest) first; later layers are underlays,
 *   factor: field units -> palette units (z500a: 0.1, gpm -> dam),
 *   palette: id, ground: 'paper' | 'night', colors: 'soft' | 'reference' (absent: Soft),
 *   bicubic: bool,
 *   hairlines: bool,
 *   doubt: null | {layers: [...same shape], limit: spread in field units at which the hatch starts (60 gpm = 6 dam)},
 * }
 */
export class RasterJob {
  constructor(spec) {
    const { mv, W, H, rw, rh, palette, ground } = spec;
    Object.assign(this, spec);
    this.y = 0; this.cancelled = false; this.doneAll = false; this.rowMs = 0.05;
    this.sx = W / rw; this.sy = H / rh; this.scale = rw / W;
    this.bander = makeBander(palette);
    this.T = bandTables(palette, ground, spec.colors);
    const tk = chartTokens(ground), hx = hexRGB(tk.hatch.color);
    this.hatchInk = { r: hx[0], g: hx[1], b: hx[2], rgb: hx, solo: pack(hx[0], hx[1], hx[2], Math.round(tk.hatch.alpha * 255)), a: tk.hatch.alpha, pitch: tk.hatch.pitch, width: tk.hatch.width };
    const prep = (L, slot) => { const M = mv.mesh?.(L.domId, L.dom) ?? meshFromInvert(mv, L.domId, L.dom); return { M, domId: L.domId, kinds: kindsOf(M, spec.pool, slot), mgi: M.mgi, mgj: M.mgj, mw: M.mw, mh: M.mh, step: M.step, invStep: 1 / M.step, kRow: 0, gi: 0, gj: 0, fHi: L.dom.nx - 1 - FEATHER_DEG / Math.abs(L.dom.dlon), gHi: L.dom.ny - 1 - FEATHER_DEG / Math.abs(L.dom.dlat), rowGi: new Float64Array(M.mw + 1), rowGj: new Float64Array(M.mw + 1), twin: null, dom: L.dom, nx: L.dom.nx, ny: L.dom.ny, vals: L.vals, feather: !!L.feather, fx: FEATHER_DEG / Math.abs(L.dom.dlon), fy: FEATHER_DEG / Math.abs(L.dom.dlat) }; };
    this.LS = spec.layers.map((L, i) => prep(L, `L${i}`));
    this.DS = spec.doubt ? spec.doubt.layers.map((L, i) => prep(L, `D${i}`)) : null;
    // a spread layer on the same mesh as a field layer (the same domain in the same view) shares its row buffers: one prepRow for both
    if (this.DS) for (const D of this.DS) { const t = this.LS.find((L) => L.M === D.M); if (t) { D.twin = t; D.rowGi = t.rowGi; D.rowGj = t.rowGj; } }
    const take = (name, Type, n) => (spec.pool ? pooled(name, Type, n) : new Type(n));
    this.ivPrev = take('ivA', Uint8Array, rw).fill(255); this.ivCur = take('ivB', Uint8Array, rw);
    this.runV = take('run', Uint8Array, rw).fill(0);
    // one row's field value and alpha, the hatch-line pixels and their spread (filled and read within one _row call)
    this.rowV = take('rowV', Float64Array, rw); this.rowA = take('rowA', Float64Array, rw);
    this.rowSel = take('rowSel', Uint8Array, rw); this.rowSD = take('rowSD', Float64Array, rw); this.rowSDA = take('rowSDA', Float64Array, rw);
    this.vInk = spec.pool ? (POOL.get(`vInk|${rw}`) || (POOL.set(`vInk|${rw}`, new Array(rw)), POOL.get(`vInk|${rw}`))).fill(null) : new Array(rw).fill(null);
    this.wLine = Math.max(1, Math.round(this.scale * 1)); // hairline width in raster px: 1 CSS px
    this.gi = 0; this.gj = 0; this.fa = 1;
    // playback plans (motion rasters only: spec.plan), see acquirePlan
    const usePlan = !!spec.plan && !spec.pool && !spec.bicubic;
    this.planL = usePlan ? acquirePlan(this.LS, 'L', rw, rh, W, H, '') : null;
    this.planD = usePlan && this.DS ? acquirePlan(this.DS, 'D', rw, rh, W, H, `${tk.hatch.pitch}|${tk.hatch.width}`) : null;
    this.rowPhase = take('rowPhase', Uint8Array, rw);
    this.stats = { rows: 0, maxRowMs: 0, slices: 0, maxSliceMs: 0, ms: 0, planRows: 0 };
  }

  /** The grid coordinates of one layer at screen point (x, y), into this.gi, this.gj; false outside the layer. */
  _coords(L, x, y) {
    const STEP = L.step, mw = L.mw, mh = L.mh, fx = x / STEP, fy = y / STEP;
    let m = fx | 0, n = fy | 0;
    if (m > mw - 1) m = mw - 1; if (n > mh - 1) n = mh - 1;
    const kind = L.kinds[n * mw + m];
    if (kind === 2) return false;
    let gi, gj;
    if (kind === 1) {
      const u = fx - m, v = fy - n, a = n * (mw + 1) + m, c = a + mw + 1, mgi = L.mgi, mgj = L.mgj, iu = 1 - u, iv = 1 - v;
      gi = (mgi[a] * iu + mgi[a + 1] * u) * iv + (mgi[c] * iu + mgi[c + 1] * u) * v;
      gj = (mgj[a] * iu + mgj[a + 1] * u) * iv + (mgj[c] * iu + mgj[c + 1] * u) * v;
    } else {
      const ll = (this.mv._invert ? this.mv._invert([x, y]) : this.mv.invert([x, y])), g = ll && toGrid(L.dom, ll[0], ll[1]);
      if (!g) return false;
      gi = g[0]; gj = g[1];
    }
    this.gi = gi; this.gj = gj;
    return true;
  }

  /** The value of one layer at screen point (x, y), or NaN outside it or where it has no data. Leaves the grid coordinates in this.gi, this.gj. */
  _layer(L, x, y, cubic) {
    if (!this._coords(L, x, y)) return NaN;
    const gi = this.gi, gj = this.gj;
    return cubic ? bicubicAt(L.vals, L.nx, L.ny, gi, gj) : bilinearAt(L.vals, L.nx, L.ny, gi, gj);
  }

  /**
   * _value (bilinear) from grid coordinates already known: layer li's at G[o + 2 * li], G[o + 2 * li + 1] (NaN outside it), as
   * _coords gave them. The same steps and arithmetic as _value, so the same number.
   */
  _valueAt(LS, G, o) {
    this.fa = 1;
    const n = LS.length, L0 = LS[0], gi = G[o], gj = G[o + 1];
    const v0 = gi === gi ? bilinearAt(L0.vals, L0.nx, L0.ny, gi, gj) : NaN;
    if (v0 === v0) {
      if (!L0.feather) return v0;
      if (gi >= L0.fx && gi <= L0.nx - 1 - L0.fx && gj >= L0.fy && gj <= L0.ny - 1 - L0.fy) return v0;
      const w = edgeWeight(L0.dom, gi, gj);
      if (w >= 1) return v0;
      if (n === 1) { this.fa = w; return v0; }
      const u = this._underAt(LS, G, o);
      return u === u ? u + (v0 - u) * w : v0;
    }
    return n > 1 ? this._underAt(LS, G, o) : NaN;
  }

  _underAt(LS, G, o) {
    for (let li = 1; li < LS.length; li++) {
      const L = LS[li], gi = G[o + 2 * li], gj = G[o + 2 * li + 1];
      if (gi === gi) { const v = bilinearAt(L.vals, L.nx, L.ny, gi, gj); if (v === v) return v; }
    }
    return NaN;
  }

  /** The field at screen point (x, y): the primary layer feathered over the underlay; NaN where no layer has data. this.fa < 1 only with nothing beneath the edge. */
  _value(LS, x, y, cubic) {
    this.fa = 1;
    const n = LS.length, L0 = LS[0];
    const v0 = this._layer(L0, x, y, cubic);
    if (v0 === v0) {
      if (!L0.feather) return v0;
      const gi = this.gi, gj = this.gj;
      if (gi >= L0.fx && gi <= L0.nx - 1 - L0.fx && gj >= L0.fy && gj <= L0.ny - 1 - L0.fy) return v0; // deeper than the feather: weight 1
      const w = edgeWeight(L0.dom, gi, gj);
      if (w >= 1) return v0;
      if (n === 1) { this.fa = w; return v0; } // nothing beneath: fade to the ground
      const u = this._under(LS, x, y, cubic);
      return u === u ? u + (v0 - u) * w : v0;
    }
    return n > 1 ? this._under(LS, x, y, cubic) : NaN;
  }

  _under(LS, x, y, cubic) { // the first underlay that has data at the point
    for (let li = 1; li < LS.length; li++) { const v = this._layer(LS[li], x, y, cubic); if (v === v) return v; }
    return NaN;
  }

  /** Do up to `budgetMs` of rows. Returns true when the raster is complete. */
  step(budgetMs = SLICE_MS) {
    if (this.cancelled) return false;
    if (this.doneAll) return true;
    this.mv.apply?.();
    const t0 = performance.now(), rh = this.rh;
    this.stats.slices++;
    let rowsDone = 0;
    while (this.y < rh) {
      const rt = performance.now();
      if (rowsDone > 0 && rt - t0 + this.rowMs > budgetMs) break; // a slice always does at least one row, never starts one it expects to overrun
      this._row(this.y);
      this.y++; this.stats.rows++; rowsDone++;
      const dt = performance.now() - rt;
      this.rowMs = Math.max(dt, this.rowMs * 0.9);
      if (dt > this.stats.maxRowMs) this.stats.maxRowMs = dt;
    }
    const sl = performance.now() - t0;
    this.stats.ms += sl;
    if (sl > this.stats.maxSliceMs) this.stats.maxSliceMs = sl;
    this.doneAll = this.y >= rh;
    return this.doneAll;
  }

  /**
   * Paint raster row py. A method of its own (not the body of step's loop) so the engine optimises it as an ordinary hot
   * function with full type feedback, rather than by on-stack replacement inside a long first call.
   */
  _row(py) {
    const { rw, u32, factor, T, bander, hairlines, bicubic, LS, DS, sx, runV, vInk } = this;
    const hatchOn = DS !== null, limit = hatchOn ? this.doubt.limit : 0, hk = this.hatchInk, period = hk.pitch * Math.SQRT2, line = hk.width * Math.SQRT2;
    const major = T.major, anyMajor = hairlines && T.hasMajor, colors = T.colors, wl = this.wLine, crossT = T.cross, nIv = T.nIntervals;
    const blut = bander.lut, bv0 = bander.v0, binv = bander.inv, bexact = bander.exact;
    const y = (py + 0.5) * this.sy, iv = this.ivCur, prev = this.ivPrev, base = py * rw;
    let runH = 0, hInk = null, pj = undefined;
    // a built plan row needs no mesh rows (prepRow): only a row sampled without a plan, or the row a plan is being built from
    const PL = this.planL, PD = this.planD, needL = PL === null || PL.rowsBuilt <= py, needD = hatchOn && (PD === null || PD.rowsBuilt <= py);
    if (needL || needD) for (let li = 0; li < LS.length; li++) prepRow(LS[li], y);
    if (needD) for (let li = 0; li < DS.length; li++) { const D = DS[li]; if (D.twin !== null) D.kRow = D.twin.kRow; else prepRow(D, y); }
    // the field along the row first (rowValues), then the hatch-line pixels and the spread on them, then the colours
    const rowV = this.rowV, rowA = this.rowA, sel = this.rowSel, rowSD = this.rowSD, phase = this.rowPhase;
    rowValues(this, LS, rw, sx, y, bicubic, rowV, rowA, null, PL, py, null);
    if (hatchOn) {
      // hatch phase along the row: ((px + 0.5) + (py + 0.5)) / scale modulo the period, advanced by 1 / scale a pixel
      const invScale = 1 / this.scale; let ph = (((0.5 + py + 0.5) * invScale) % period + period) % period;
      for (let px = 0; px < rw; px++, ph += invScale) {
        if (ph >= period) ph -= period * Math.floor(ph / period);
        const on = ph < line ? 1 : 0;
        phase[px] = on; sel[px] = on === 1 && rowV[px] === rowV[px] ? 1 : 0;
      }
      rowValues(this, DS, rw, sx, y, false, rowSD, this.rowSDA, sel, PD, py, phase); // the spread's alpha is not used
    }
    for (let px = 0; px < rw; px++) {
      const v = rowV[px], a = rowA[px];
      if (v !== v) { u32[base + px] = 0; iv[px] = 255; runH = 0; runV[px] = 0; continue; }
      const fv = v * factor, q = (fv - bv0) * binv; // bander(fv, pj), its table read inline
      let j = -1;
      if (q >= 0 && q < BAND_CELLS) j = blut[q | 0];
      if (j < 0) j = bexact(fv, pj);
      pj = j;
      iv[px] = j;
      let col = colors[j];
      // hairline on a major edge crossed between this pixel and its left or upper neighbour; it runs `wl` raster px on
      let ink = null;
      if (anyMajor) {
        let cross = null;
        const l = px ? iv[px - 1] : 255, u = py ? prev[px] : 255;
        if (l !== 255 && l !== j) { const e = crossT[l * nIv + j]; if (e >= 0) cross = major[e]; } // firstMajor(major, l, j)
        if (!cross && u !== 255 && u !== j) { const e = crossT[u * nIv + j]; if (e >= 0) cross = major[e]; }
        if (cross) { ink = cross; runH = wl - 1; hInk = cross; runV[px] = wl - 1; vInk[px] = cross; }
        else if (runH > 0) { ink = hInk; runH--; }
        else if (runV[px] > 0) { ink = vInk[px]; runV[px]--; }
      }
      if (ink) col = mixInk(col, ink.rgb, ink.a);
      if (hatchOn && sel[px] === 1) { // on a hatch line: is the spread here 6 dam or more?
        const sd = rowSD[px];
        if (sd === sd && sd >= limit) col = col === 0 ? hk.solo : mixInk(col, hk.rgb, hk.a);
      }
      if (a < 1 && col !== 0) col = (col & 0x00ffffff) | (Math.round(((col >>> 24) * a)) << 24);
      u32[base + px] = col >>> 0;
    }
    this.ivCur = prev; this.ivPrev = iv; // the row just done becomes "previous"
  }

  cancel() { this.cancelled = true; }
}

function firstMajor(major, a, b) {
  const lo = a < b ? a : b, hi = a < b ? b : a;
  for (let e = lo; e < hi; e++) if (major[e]) return major[e];
  return null;
}

/** Blend ink (rgb, alpha) over a packed pixel. A pixel with no colour (the unshaded gap) becomes the ink at its alpha. */
function mixInk(col, rgb, a) {
  if (col === 0) return pack(rgb[0], rgb[1], rgb[2], Math.round(a * 255));
  const r = col & 255, g = (col >>> 8) & 255, b = (col >>> 16) & 255, al = col >>> 24;
  return pack(Math.round(r + (rgb[0] - r) * a), Math.round(g + (rgb[1] - g) * a), Math.round(b + (rgb[2] - b) * a), al);
}
