// Map views: projections, the pan/zoom transform, and the per-view lookups from screen to grid and grid to screen.
// Pure apart from d3: no DOM, usable from Node unit tests.
import { d3 } from '../vendor.js';
import { toGrid, nodeLonLat } from '../data/grid.js';

export const VIEW_IDS = ['np', 'nh', 'gl', 'wm'];
export const SF = [-122.42, 37.77];
const NH_CLIP = 75;
export const ZOOM_MIN = 1, ZOOM_MAX = 8;
export const GL_ROTATE = [140, -35, 0]; // the globe opens centred on 140W, 35N: the North Pacific and North America
export const WM_ROTATE = [150, 0]; // World: the Pacific (150W) at the middle, so San Francisco and the date line both stay on screen
export const OVERSHOOT_MAX = 22; // px a drag past a pan limit can move the map (spec: at most 24)

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
    if (W >= H) {
      // Landscape: 160E-60W, 15-72N.
      p.fitExtent(fit, boxPoints(-200, -60, 15, 72));
    } else {
      // Portrait: fit by latitude (22-60N along San Francisco's meridian) and let longitude crop, San Francisco 60 % across.
      // The Pacific approach fills the frame; Anchorage and Honolulu fall off the top and bottom edges.
      p.fitExtent(fit, { type: 'MultiPoint', coordinates: [[SF[0], 22], [SF[0], 60]] });
      const t = p.translate(); p.translate([t[0] + x0 + 0.6 * (fit[1][0] - x0) - p(SF)[0], t[1]]);
    }
  } else if (viewId === 'nh') {
    rotate = [-SF[0], -90]; // north pole at the centre, San Francisco's meridian pointing down
    p = d3.geoStereographic().rotate(rotate).clipAngle(NH_CLIP);
    p.fitExtent(fit, { type: 'Sphere' });
  } else if (viewId === 'wm') {
    // World: the flat Equal Earth map of the whole sphere. Pan and zoom only; no rotation.
    p = d3.geoEqualEarth().rotate(WM_ROTATE);
    p.fitExtent(fit, { type: 'Sphere' });
  } else {
    // Globe: orthographic, free rotation. The far side is clipped (clipAngle) and project() returns null there.
    rotate = GL_ROTATE.slice();
    p = d3.geoOrthographic().rotate(rotate).clipAngle(90);
    p.fitExtent(fit, { type: 'Sphere' });
  }
  return { viewId, W, H, inset: padKey(inset), fit, proj: p, scale: p.scale(), translate: p.translate().slice(), rotate, scratch: new Map(), boxes: new Map() };
}

/**
 * Screen bounding box [x0, y0, x1, y1] of a data domain's outline in the un-zoomed view (cached per base). Regional pan
 * stops when this box's edge reaches the frame's edge, so the map never shows past the data it has.
 */
export function domainBox(base, dom) {
  const key = `${dom.lon0}|${dom.lat0}|${dom.nx}|${dom.ny}`;
  let b = base.boxes.get(key);
  if (b) return b;
  const mv = new MapView(base), pts = [];
  const lon1 = dom.lon0 + (dom.nx - 1) * dom.dlon, lat1 = dom.lat0 + (dom.ny - 1) * dom.dlat;
  for (let i = 0; i <= 32; i++) {
    const lon = dom.lon0 + ((lon1 - dom.lon0) * i) / 32, lat = dom.lat0 + ((lat1 - dom.lat0) * i) / 32;
    pts.push([lon, dom.lat0], [lon, lat1], [dom.lon0, lat], [lon1, lat]);
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ll of pts) {
    const q = mv.project(ll);
    if (!q) continue;
    x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]);
  }
  b = x0 <= x1 ? [x0, y0, x1, y1] : null;
  base.boxes.set(key, b);
  return b;
}

/**
 * World: the screen box [x0, y0, x1, y1] of the whole Equal Earth outline in the un-zoomed view, and the free frame
 * [x0, y0, x1, y1] the base fit it into (the canvas less its margin and the reserved edges). Cached per base.
 */
export function worldLimits(base) {
  let b = base.boxes.get('world');
  if (b) return b;
  const mv = new MapView(base), edge = 180 - 1e-4, lon0 = -WM_ROTATE[0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let lat = -90; lat <= 90; lat += 3) {
    for (const lon of [lon0 + edge, lon0 - edge]) {
      const q = mv.project([lon, lat]);
      if (!q) continue;
      x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]);
    }
  }
  b = { box: [x0, y0, x1, y1], frame: base.fit.flat() };
  base.boxes.set('world', b);
  return b;
}

/**
 * Clamp a zoom transform so the zoomed canvas still covers the canvas. With `box` (a domain's screen box, Regional only)
 * the allowed pan widens to the data's own edge: the map may move until the domain's edge reaches the frame's edge. With `box`
 * and `frame` (World) the map's outline is held against the frame instead.
 */
export function clampXf(xf, W, H, box = null, frame = null) {
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, xf.k));
  if (box && frame) { // contain: the map's own outline stays against the free frame (no blank band); an axis where the map is smaller is centred
    const axis = (t, b0, b1, f0, f1) => {
      if (k * (b1 - b0) < f1 - f0) return (f0 + f1) / 2 - (k * (b0 + b1)) / 2;
      return Math.min(f0 - k * b0, Math.max(f1 - k * b1, t));
    };
    return { ...xf, k, tx: axis(xf.tx, box[0], box[2], frame[0], frame[2]), ty: axis(xf.ty, box[1], box[3], frame[1], frame[3]) };
  }
  let xlo = W - W * k, xhi = 0, ylo = H - H * k, yhi = 0;
  if (box) {
    xlo = Math.min(xlo, W - k * box[2]); xhi = Math.max(xhi, -k * box[0]);
    ylo = Math.min(ylo, H - k * box[3]); yhi = Math.max(yhi, -k * box[1]);
  }
  return { ...xf, k, tx: Math.min(xhi, Math.max(xlo, xf.tx)), ty: Math.min(yhi, Math.max(ylo, xf.ty)) };
}
/** Movement past a pan limit, damped: grows with the drag but never passes OVERSHOOT_MAX px. */
export const dampOver = (over) => Math.sign(over) * OVERSHOOT_MAX * (1 - Math.exp(-Math.abs(over) / 40));

const rot3 = (r) => [r[0] || 0, r[1] || 0, r[2] || 0];
export const sameXf = (a, b) => a.k === b.k && a.tx === b.tx && a.ty === b.ty && a.rot[0] === b.rot[0] && a.rot[1] === b.rot[1] && (a.rot[2] || 0) === (b.rot[2] || 0);
export const IDENTITY = () => ({ k: 1, tx: 0, ty: 0, rot: [0, 0, 0] });
export const isDefaultXf = (x) => x.k === 1 && Math.abs(x.tx) < 0.5 && Math.abs(x.ty) < 0.5 && Math.abs(x.rot[0]) < 0.05 && Math.abs(x.rot[1]) < 0.05 && Math.abs(x.rot[2] || 0) < 0.05;

const RAD = Math.PI / 180;
const centreVec = (r) => { // the unit vector of the view centre [-lambda, -phi]
  const la = -r[1] * RAD, lo = -r[0] * RAD;
  return [Math.sin(la), Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo)];
};

/**
 * A view at one pan/zoom/rotation state. Screen = k * base + (tx, ty); nh and gl also rotate by xf.rot = [dLambda, dPhi, dGamma]
 * added to the base rotation. `proj` is shared with the base (mutated) so a MapView must not outlive the next MapView of
 * the same base. `quality` ('rest' | 'rotate') picks the mesh step and whether buffers come from the base's scratch pool.
 */
export class MapView {
  constructor(base, xf = IDENTITY()) {
    this.base = base; this.W = base.W; this.H = base.H; this.viewId = base.viewId;
    this.xf = { k: xf.k, tx: xf.tx, ty: xf.ty, rot: rot3(xf.rot) };
    this.quality = 'rest';
    const r = this.xf.rot;
    this.key = [base.viewId, base.W, base.H, base.inset, xf.k.toFixed(4), xf.tx.toFixed(1), xf.ty.toFixed(1), r[0].toFixed(2), r[1].toFixed(2), r[2].toFixed(2)].join('|');
    this.lookups = new Map(); this.nodeCache = new Map(); this.meshes = new Map();
    this.apply();
  }
  /** The absolute d3 rotation of this view (nh and gl), or null. */
  rotation() {
    const { rotate } = this.base, { rot } = this.xf;
    if (!rotate) return null;
    if (this.viewId === 'nh') return [rotate[0] + rot[0], Math.max(-90, Math.min(-45, rotate[1] + rot[1]))];
    return [rotate[0] + rot[0], Math.max(-90, Math.min(90, rotate[1] + rot[1])), (rotate[2] || 0) + rot[2]];
  }
  /** (Re)apply this view's transform to the shared projection. */
  apply() {
    const { proj, scale, translate } = this.base, { k, tx, ty } = this.xf;
    const r = this.rotation();
    if (r) {
      proj.rotate(r);
      if (this.viewId === 'nh') {
        const la = (-r[1] * RAD), lo = (-r[0] * RAD); // the projection centre, for the clip test
        this._clip = [Math.sin(la), Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.cos(NH_CLIP * RAD)];
      } else this._clip = [...centreVec(r), 1e-9]; // gl: the near hemisphere
    }
    proj.scale(scale * k).translate([translate[0] * k + tx, translate[1] * k + ty]);
    return this;
  }
  project(ll) { this.apply(); return this._project(ll); }
  /** nh and gl: is the point inside the visible cap? (d3 applies clipAngle to shapes, not to single points.) */
  _insideClip(lon, lat) {
    const c = this._clip, la = lat * RAD, lo = lon * RAD;
    return Math.sin(la) * c[0] + Math.cos(la) * (Math.cos(lo) * c[1] + Math.sin(lo) * c[2]) >= c[3];
  }
  _project(ll) {
    if (this._clip && !this._insideClip(ll[0], ll[1])) return null;
    const r = this.base.proj(ll);
    return r && r[0] === r[0] && r[1] === r[1] ? r : null;
  }
  invert(xy) { this.apply(); return this._invert(xy); }
  _invert(xy) {
    const p = this.base.proj, ll = p.invert(xy);
    if (!ll || ll[0] !== ll[0] || ll[1] !== ll[1]) return null;
    if (this.viewId === 'wm') { // off the Equal Earth outline the inverse extrapolates: accept only points that project back onto themselves
      const q = p(ll);
      if (!q || Math.abs(q[0] - xy[0]) > 0.75 || Math.abs(q[1] - xy[1]) > 0.75) return null;
    } else if (this.viewId === 'gl') { // off the disc the inverse extrapolates: accept only points that project back onto themselves
      const q = p(ll);
      if (!q || Math.abs(q[0] - xy[0]) > 0.75 || Math.abs(q[1] - xy[1]) > 0.75 || !this._insideClip(ll[0], ll[1])) return null;
    } else if (this.viewId === 'nh' && !this._insideClip(ll[0], ll[1])) return null;
    return ll;
  }

  /** A buffer of `Type` for this view: fresh at rest quality, from the base's scratch pool (owned by the latest view that asked) at rotate quality. */
  _buf(name, Type, n, fill) {
    if (this.quality !== 'rotate') { const a = new Type(n); if (fill !== undefined) a.fill(fill); return a; }
    const pool = this.base.scratch, key = `${name}|${n}`;
    let a = pool.get(key);
    if (!a) { a = new Type(n); pool.set(key, a); }
    if (fill !== undefined) a.fill(fill); else if (Type !== Float32Array) a.fill(0);
    return a;
  }

  /**
   * The inverse mesh of a domain: every `step` CSS px (8, or 16 at rotate quality) the screen point is inverted once to grid
   * coordinates. Returns {mgi, mgj, mok, mw, mh, step}: (mw + 1) x (mh + 1) nodes, row-major; mok is 1 where the node is in
   * the domain. Cached per view; at rotate quality the arrays are the base's scratch buffers, valid until the next view's mesh.
   */
  mesh(domId, dom) {
    const step = this.quality === 'rotate' ? 16 : 8, key = `${domId}|${step}`, shared = this.quality === 'rotate';
    const hit = this.meshes.get(key);
    if (hit && (!shared || this.base.scratch.get(`mesh|${key}`) === this)) return hit;
    this.apply();
    const { W, H } = this, mw = Math.ceil(W / step), mh = Math.ceil(H / step), mn = (mw + 1) * (mh + 1);
    const mgi = this._buf(`mgi|${key}`, Float32Array, mn), mgj = this._buf(`mgj|${key}`, Float32Array, mn), mok = this._buf(`mok|${key}`, Uint8Array, mn);
    for (let n = 0; n <= mh; n++) {
      for (let m = 0; m <= mw; m++) {
        const ll = this._invert([m * step, n * step]), g = ll && toGrid(dom, ll[0], ll[1]);
        if (g) { const k = n * (mw + 1) + m; mgi[k] = g[0]; mgj[k] = g[1]; mok[k] = 1; }
      }
    }
    const M = { mgi, mgj, mok, mw, mh, step };
    this.meshes.set(key, M);
    if (shared) this.base.scratch.set(`mesh|${key}`, this);
    return M;
  }

  /**
   * Screen -> grid lookup for a domain at raster size rw x rh, built from `mesh`: pixels in cells whose four corners are in
   * the domain (and do not straddle the longitude seam) interpolate their grid coordinates, the rest are inverted exactly.
   * Returns {li: Int32Array (top-left node index, -1 outside), fx, fy: Float32Array}.
   */
  lookup(domId, dom, rw, rh) {
    const shared = this.quality === 'rotate', key = `${domId}|${rw}x${rh}|${this.quality}`;
    let L = this.lookups.get(key);
    if (L && (!shared || this.base.scratch.get(`lookup|${key}`) === this)) return L;
    const M = this.mesh(domId, dom);
    this.apply();
    const { W, H } = this, { mgi, mgj, mok, mw, mh, step: STEP } = M;
    const li = this._buf(`li|${key}`, Int32Array, rw * rh, -1), fxs = this._buf(`fx|${key}`, Float32Array, rw * rh), fys = this._buf(`fy|${key}`, Float32Array, rw * rh);
    const sx = W / rw, sy = H / rh, nx = dom.nx, ny = dom.ny;
    const put = (idx, gi, gj) => {
      let i0 = Math.floor(gi), j0 = Math.floor(gj);
      if (i0 > nx - 2) i0 = nx - 2; if (j0 > ny - 2) j0 = ny - 2; if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0;
      li[idx] = j0 * nx + i0; fxs[idx] = gi - i0; fys[idx] = gj - j0;
    };
    const cellOk = this._buf(`cell|${key}`, Uint8Array, mw * mh);
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
    if (shared) this.base.scratch.set(`lookup|${key}`, this);
    return L;
  }

  /** Screen positions of every grid node of a domain: Float32Array(2 * nx * ny), NaN where clipped (the globe's far side included). */
  nodes(domId, dom) {
    const shared = this.quality === 'rotate', key = `${domId}|${this.quality}`;
    let P = this.nodeCache.get(key);
    if (P && (!shared || this.base.scratch.get(`nodes|${key}`) === this)) return P;
    this.apply();
    P = this._buf(`nodes|${key}`, Float32Array, 2 * dom.nx * dom.ny, NaN);
    for (let j = 0; j < dom.ny; j++) {
      for (let i = 0; i < dom.nx; i++) {
        const r = this._project(nodeLonLat(dom, i, j));
        if (r) { const k = 2 * (j * dom.nx + i); P[k] = r[0]; P[k + 1] = r[1]; }
      }
    }
    this.nodeCache.set(key, P);
    if (shared) this.base.scratch.set(`nodes|${key}`, this);
    return P;
  }
}
