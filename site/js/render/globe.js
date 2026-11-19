// Globe rotation helpers: drag that keeps the grabbed point under the pointer, a horizontal-only spin, a coasting flick,
// and near-hemisphere visibility. Pure apart from the projection object passed in (a d3.geoOrthographic): no DOM, no
// d3 import, usable from Node unit tests. Rotations are d3's [lambda, phi, gamma] in degrees.
import versor from './versor.js';

// New rotation after dragging screen point p0 to p1, starting from rotation r0. The geographic point under p0 at r0 ends
// up under p1. The projection's own rotation is left as it was. A pointer off the globe (invert gives null or NaN)
// returns r0 unchanged.
export function dragRotate(projection, p0, p1, r0) {
  const keep = projection.rotate();
  try {
    projection.rotate(r0);
    const g0 = projection.invert(p0), g1 = projection.invert(p1);
    // d3's orthographic invert extrapolates past the disc edge: accept a point only if it projects back onto itself.
    const bad = (g, p) => {
      if (!g || !Number.isFinite(g[0]) || !Number.isFinite(g[1])) return true;
      const b = projection(g);
      return !b || Math.hypot(b[0] - p[0], b[1] - p[1]) > 0.5;
    };
    if (bad(g0, p0) || bad(g1, p1)) return r0.slice(0, 3);
    const q = versor.multiply(versor(r0), versor.delta(versor.cartesian(g0), versor.cartesian(g1)));
    return versor.rotation(q);
  } finally { projection.rotate(keep); }
}

// Horizontal spin only: lambda moves by dxDeg (wrapped to [-180, 180)), phi and gamma are kept.
export function spinOnly(r0, dxDeg) {
  const l = (((r0[0] + dxDeg + 180) % 360) + 360) % 360 - 180;
  return [l, r0[1], r0[2] || 0];
}

export const INERTIA = { tau: 0.12, stopSpeed: 10 }; // seconds, px/s: 1,000 px/s coasts ~119 px and rests in ~0.55 s

// Coast after a flick. velocity is px/s, a number (horizontal) or {x, y}. onStep(dx, dy) gets the pixels travelled since
// the previous frame; onEnd() fires once at rest or when cancelled. Speed decays exponentially. Under reduced motion no
// step is taken and no frame is requested (onEnd fires once so the caller can finish up). Returns {cancel}.
// Optional raf, caf and now (ms) allow a fake clock.
export function inertia({ velocity, onStep, onEnd, reducedMotion = false, raf, caf, now, tau = INERTIA.tau, stopSpeed = INERTIA.stopSpeed } = {}) {
  const v = typeof velocity === 'number' ? { x: velocity, y: 0 } : { x: velocity?.x || 0, y: velocity?.y || 0 };
  const speed0 = Math.hypot(v.x, v.y);
  let done = false, id = null;
  const R = raf || globalThis.requestAnimationFrame?.bind(globalThis), C = caf || globalThis.cancelAnimationFrame?.bind(globalThis);
  const clock = now || (() => globalThis.performance.now());
  const finish = () => { if (done) return; done = true; if (id != null && C) C(id); id = null; onEnd?.(); };
  if (reducedMotion || !R || !(speed0 > stopSpeed)) { finish(); return { cancel() {} }; }
  const t0 = clock();
  let last = 0; // distance fraction already applied, as 1 - exp(-t / tau)
  const frame = () => {
    id = null;
    if (done) return;
    const t = Math.max(0, (clock() - t0) / 1000);
    const stopped = speed0 * Math.exp(-t / tau) <= stopSpeed;
    const f = stopped ? 1 - stopSpeed / speed0 : 1 - Math.exp(-t / tau); // land where the speed crosses the floor
    const k = Math.max(0, f - last) * tau;
    last = Math.max(last, f);
    if (k > 0) onStep?.(v.x * k, v.y * k);
    if (stopped) finish(); else id = R(frame);
  };
  id = R(frame);
  return { cancel: finish };
}

// Is [lon, lat] on the near hemisphere for a view whose d3 rotation is `rotation`? The view centre is
// [-lambda, -phi]; points exactly on the horizon count as hidden.
export function visible(rotation, lon, lat) {
  const c = versor.cartesian([-rotation[0], -rotation[1]]), p = versor.cartesian([lon, lat]);
  return c[0] * p[0] + c[1] * p[1] + c[2] * p[2] > 1e-12;
}
