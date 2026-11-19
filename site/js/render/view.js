// Map views: projections, the pan/zoom transform, and the per-view lookups from screen to grid and grid to screen.
// Pure apart from d3: no DOM, usable from Node unit tests.
import { d3 } from '../vendor.js';
import { toGrid, nodeLonLat } from '../data/grid.js';

export const VIEW_IDS = ['np', 'nh', 'gl'];
export const SF = [-122.42, 37.77];
const NH_CLIP = 75;
export const ZOOM_MIN = 1, ZOOM_MAX = 6;

const boxPoints = (lon0, lon1, lat0, lat1) => {
  const pts = [];
  for (let x = lon0; x <= lon1; x += 4) { pts.push([x, lat0], [x, lat1]); }
  for (let y = lat0; y <= lat1; y += 4) { pts.push([lon0, y], [lon1, y]); }
  return { type: 'MultiPoint', coordinates: pts };
};

export const NO_PAD = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
export const padKey = (q) => (q ? [q.top, q.right, q.bottom, q.left].map((v) => Math.round(v || 0)).join(',') : '0,0,0,0');

/**
 * The un-zoomed projection of a view fitted to a W x H canvas (CSS px), and its base parameters. `inset` reserves
 * canvas edges (the phone sheet, scrubber and view switch): the view is fitted into what is left, so the whole
 * map the person sees is the view, not a canvas that is mostly hidden.
 */
export function baseProjection(viewId, W, H, inset = NO_PAD) {
  const m = Math.round(Math.min(W, H) * 0.01);
  const x0 = m + (inset.left || 0), y0 = m + (inset.top || 0), x1 = W - m - (inset.right || 0), y1 = H - m - (inset.bottom || 0);
  const fit = [[x0, y0], [Math.max(x0 + 1, x1), Math.max(y0 + 1, y1)]];
  let p, rotate = null;
  if (viewId === 'np') {
    p = d3.geoConicConformal().parallels([30, 60]).rotate([150, 0]).center([0, 45]);
    // Landscape: 160E-60W, 15-72N. Portrait: about 175W-105W, 22-60N, San Francisco 70 % across.
    const box = W >= H ? boxPoints(-200, -60, 15, 72) : boxPoints(-175, -105, 22, 60);
    p.fitExtent(fit, box);
    if (W < H) { const t = p.translate(); p.translate([t[0] + x0 + 0.7 * (fit[1][0] - x0) - p(SF)[0], t[1]]); }
  } else if (viewId === 'nh') {
    rotate = [-SF[0], -90]; // north pole at the centre, San Francisco's meridian pointing down
    p = d3.geoStereographic().rotate(rotate).clipAngle(NH_CLIP);
    p.fitExtent(fit, { type: 'Sphere' });
  } else {
    p = d3.geoEqualEarth().rotate([150, 0]);
    p.fitExtent(fit, { type: 'Sphere' });
  }
  return { viewId, W, H, inset: padKey(inset), proj: p, scale: p.scale(), translate: p.translate().slice(), rotate };
}

/** Clamp a zoom transform so the zoomed canvas still covers the canvas. */
export function clampXf(xf, W, H) {
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, xf.k));
  return { ...xf, k, tx: Math.min(0, Math.max(W - W * k, xf.tx)), ty: Math.min(0, Math.max(H - H * k, xf.ty)) };
}
export const sameXf = (a, b) => a.k === b.k && a.tx === b.tx && a.ty === b.ty && a.rot[0] === b.rot[0] && a.rot[1] === b.rot[1];
export const IDENTITY = () => ({ k: 1, tx: 0, ty: 0, rot: [0, 0] });

/**
 * A view at one pan/zoom state. Screen = k * base + (tx, ty); nh also rotates by xf.rot.
 * `proj` is shared with the base (mutated) so a MapView must not outlive the next MapView of the same base.
 */
export class MapView {
  constructor(base, xf = IDENTITY()) {
    this.base = base; this.W = base.W; this.H = base.H; this.viewId = base.viewId;
    this.xf = { k: xf.k, tx: xf.tx, ty: xf.ty, rot: xf.rot.slice() };
    this.key = [base.viewId, base.W, base.H, base.inset, xf.k.toFixed(4), xf.tx.toFixed(1), xf.ty.toFixed(1), xf.rot[0].toFixed(2), xf.rot[1].toFixed(2)].join('|');
    this.lookups = new Map(); this.nodeCache = new Map();
    this.apply();
  }
  /** (Re)apply this view's transform to the shared projection. */
  apply() {
    const { proj, scale, translate, rotate } = this.base, { k, tx, ty, rot } = this.xf;
    if (rotate) {
      const r = [rotate[0] + rot[0], Math.max(-90, Math.min(-45, rotate[1] + rot[1]))];
      proj.rotate(r);
      const la = (-r[1] * Math.PI) / 180, lo = (-r[0] * Math.PI) / 180; // the projection centre, for the clip test
      this._clip = [Math.sin(la), Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.cos((NH_CLIP * Math.PI) / 180)];
    }
    proj.scale(scale * k).translate([translate[0] * k + tx, translate[1] * k + ty]);
    return this;
  }
  project(ll) { this.apply(); return this._project(ll); }
  /** nh: is the point within the clip circle? (d3 applies clipAngle to shapes, not to single points.) */
  _insideClip(lon, lat) {
    const c = this._clip, la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
    return Math.sin(la) * c[0] + Math.cos(la) * (Math.cos(lo) * c[1] + Math.sin(lo) * c[2]) >= c[3];
  }
  _project(ll) {
    if (this.viewId === 'nh' && !this._insideClip(ll[0], ll[1])) return null;
    const r = this.base.proj(ll);
    return r && r[0] === r[0] && r[1] === r[1] ? r : null;
  }
  invert(xy) { this.apply(); return this._invert(xy); }
  _invert(xy) {
    const p = this.base.proj, ll = p.invert(xy);
    if (!ll || ll[0] !== ll[0] || ll[1] !== ll[1]) return null;
    if (this.viewId === 'gl') { // equal earth inverts points outside the sphere onto its rim: reject them
      const q = p(ll);
      if (!q || Math.abs(q[0] - xy[0]) > 0.75 || Math.abs(q[1] - xy[1]) > 0.75) return null;
    } else if (this.viewId === 'nh' && !this._insideClip(ll[0], ll[1])) return null;
    return ll;
  }

  /**
   * Screen -> grid lookup for a domain at raster size rw x rh. A mesh every 8 CSS px is inverted once; pixels in
   * cells whose four corners are all in the domain (and do not straddle the longitude seam) interpolate their
   * grid coordinates, the rest (domain edges, globe edges, seam) are inverted exactly.
   * Returns {li: Int32Array (top-left node index, -1 outside), fx, fy: Float32Array}.
   */
  lookup(domId, dom, rw, rh) {
    const key = `${domId}|${rw}x${rh}`;
    let L = this.lookups.get(key);
    if (L) return L;
    this.apply();
    const { W, H } = this, STEP = 8, mw = Math.ceil(W / STEP), mh = Math.ceil(H / STEP), mn = (mw + 1) * (mh + 1);
    const mgi = new Float32Array(mn), mgj = new Float32Array(mn), mok = new Uint8Array(mn);
    for (let n = 0; n <= mh; n++) {
      for (let m = 0; m <= mw; m++) {
        const ll = this._invert([m * STEP, n * STEP]), g = ll && toGrid(dom, ll[0], ll[1]);
        const k = n * (mw + 1) + m;
        if (g) { mgi[k] = g[0]; mgj[k] = g[1]; mok[k] = 1; }
      }
    }
    const li = new Int32Array(rw * rh).fill(-1), fxs = new Float32Array(rw * rh), fys = new Float32Array(rw * rh);
    const sx = W / rw, sy = H / rh, nx = dom.nx, ny = dom.ny;
    const put = (idx, gi, gj) => {
      let i0 = Math.floor(gi), j0 = Math.floor(gj);
      if (i0 > nx - 2) i0 = nx - 2; if (j0 > ny - 2) j0 = ny - 2; if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0;
      li[idx] = j0 * nx + i0; fxs[idx] = gi - i0; fys[idx] = gj - j0;
    };
    const cellOk = new Uint8Array(mw * mh);
    for (let n = 0; n < mh; n++) {
      for (let m = 0; m < mw; m++) {
        const a = n * (mw + 1) + m, b = a + 1, c = a + mw + 1, d = c + 1;
        const nOk = mok[a] + mok[b] + mok[c] + mok[d];
        if (nOk === 0) cellOk[n * mw + m] = 2; // entirely outside: skipped
        else if (nOk === 4) {
          // interpolate only where grid coordinates vary gently across the cell (not at the seam, not at flat poles)
          const lo = Math.min(mgi[a], mgi[b], mgi[c], mgi[d]), hi = Math.max(mgi[a], mgi[b], mgi[c], mgi[d]);
          const jl = Math.min(mgj[a], mgj[b], mgj[c], mgj[d]), jh = Math.max(mgj[a], mgj[b], mgj[c], mgj[d]);
          if (hi - lo < 6 && jh - jl < 6) cellOk[n * mw + m] = 1;
        }
      }
    }
    for (let py = 0; py < rh; py++) {
      const y = (py + 0.5) * sy, n = Math.min(mh - 1, Math.floor(y / STEP)), v = y / STEP - n;
      for (let px = 0; px < rw; px++) {
        const x = (px + 0.5) * sx, m = Math.min(mw - 1, Math.floor(x / STEP)), idx = py * rw + px;
        const kind = cellOk[n * mw + m];
        if (kind === 2) continue;
        if (kind === 1) {
          const u = x / STEP - m, a = n * (mw + 1) + m, b = a + 1, c = a + mw + 1, d = c + 1;
          const gi = (mgi[a] * (1 - u) + mgi[b] * u) * (1 - v) + (mgi[c] * (1 - u) + mgi[d] * u) * v;
          const gj = (mgj[a] * (1 - u) + mgj[b] * u) * (1 - v) + (mgj[c] * (1 - u) + mgj[d] * u) * v;
          put(idx, gi, gj);
        } else {
          const ll = this._invert([x, y]), g = ll && toGrid(dom, ll[0], ll[1]);
          if (g) put(idx, g[0], g[1]);
        }
      }
    }
    L = { li, fx: fxs, fy: fys, rw, rh };
    this.lookups.set(key, L);
    return L;
  }

  /** Screen positions of every grid node of a domain: Float32Array(2 * nx * ny), NaN where clipped. */
  nodes(domId, dom) {
    let P = this.nodeCache.get(domId);
    if (P) return P;
    this.apply();
    P = new Float32Array(2 * dom.nx * dom.ny).fill(NaN);
    for (let j = 0; j < dom.ny; j++) {
      for (let i = 0; i < dom.nx; i++) {
        const r = this._project(nodeLonLat(dom, i, j));
        if (r) { const k = 2 * (j * dom.nx + i); P[k] = r[0]; P[k + 1] = r[1]; }
      }
    }
    this.nodeCache.set(domId, P);
    return P;
  }
}
