// Temporal interpolation between two real data steps (used per grid node by data/index.js rawFieldAt).
// A monotone cubic Hermite (Fritsch-Carlson limited Catmull-Rom): each step gets one tangent from its two neighbours, shared by
// the intervals on both sides, so the value's rate of change is continuous across a step (linear blending has a jolt at every
// step). The tangent is zero where the step is a local extreme in time and is limited to three times the smaller secant, so the
// curve between two steps stays inside the range of those two values: no invented highs or lows, rain never below zero.
// A step with no usable neighbour on one side (the range ends, a gap longer than the blend gap, a frame not loaded, no data at
// the node) takes the interval's own secant there; with neither neighbour the curve is exactly the linear blend.

/**
 * The tangent at a step, per hour, from the secant on its left `dl` and on its right `dr` (field units per hour) and the
 * two interval lengths `hl`, `hr` (hours). Pass dl or dr as NaN for a missing neighbour: the other secant is used.
 */
export function tangent(dl, dr, hl, hr) {
  if (dl !== dl) return dr;
  if (dr !== dr) return dl;
  if (dl * dr <= 0) return 0; // a local extreme (or a flat side): the curve levels off at the step
  const m = (hr * dl + hl * dr) / (hl + hr); // the slope of the parabola through the three steps
  const lim = 3 * Math.min(Math.abs(dl), Math.abs(dr));
  return Math.abs(m) > lim ? (m > 0 ? lim : -lim) : m;
}

/** Hermite basis at s in [0, 1]: [h00, h10, h01, h11] (h10 and h11 multiply the tangent times the interval length). */
export function basis(s) {
  const s2 = s * s, s3 = s2 * s;
  return [2 * s3 - 3 * s2 + 1, s3 - 2 * s2 + s, -2 * s3 + 3 * s2, s3 - s2];
}

/**
 * The value at fraction s of the interval [a at t0, c at t1] (h = t1 - t0 hours) with tangents m0, m1 (per hour), held inside
 * [min(a, c), max(a, c)] (the limits already keep it there; the clamp only absorbs rounding).
 */
export function hermite(a, c, m0, m1, h, s, B = basis(s)) {
  const v = B[0] * a + B[1] * h * m0 + B[2] * c + B[3] * h * m1;
  const lo = a < c ? a : c, hi = a < c ? c : a;
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Scalar form for a series: value at hour t given the step times and values around it. `p` / `q` (the steps before t0 and
 * after t1) may be null or NaN when missing. Returns the linear blend when both are missing.
 */
export function cubicAt(t, t0, a, t1, c, prev = null, next = null) {
  const h = t1 - t0;
  if (!(h > 0)) return a;
  const s = (t - t0) / h, d = (c - a) / h;
  const dl = prev && prev.v === prev.v ? (a - prev.v) / (t0 - prev.t) : NaN;
  const dr = next && next.v === next.v ? (next.v - c) / (next.t - t1) : NaN;
  const m0 = tangent(dl, d, prev ? t0 - prev.t : h, h), m1 = tangent(d, dr, h, next ? next.t - t1 : h);
  return hermite(a, c, m0, m1, h, s);
}
