// Frame composition: draws the basemap, the field rasters, the lines and the contours for one view into any 2D
// context. Used by the on-screen renderer and by renderTo (stills, GIF frames). Holds the caches that make a frame cheap:
// views and lookups, offscreen basemap layers, raster buffers, contour polylines.
import { VIEWS } from '../contract.js';
import * as data from '../data/index.js';
import { baseProjection, MapView, IDENTITY, clampXf, NO_PAD, padKey } from './view.js';
import { anomalyLUT, jetLUT, fadeSaturation, LUT_SIZE, ANOM_RANGE, JET_MAX } from './colormap.js';
import { drawFills, drawLines, basemapReady } from './basemap.js';
import { contourSegments, labelSpots, BOLD_DAM } from './contours.js';
import { theme as themeTokens, FONT_MONO } from './theme.js';

const makeCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
};

/** Which fields a state draws: the anomaly raster, the height contours, the jet. Sample manifests show one case at a time. */
export function plan(s, m = data.getManifest()) {
  const avail = (f) => { const meta = m?.fields?.[f]; return !!meta && (!m.sample || meta.case === s.case); };
  const lay = s.layers || {};
  const out = { anom: null, contour: null, jet: null };
  if (lay.z && avail('z500a')) out.anom = { field: 'z500a', factor: 0.1, code: 'z' }; // gpm -> dam
  else if (lay.t && avail('t2a')) out.anom = { field: 't2a', factor: 2, code: 't' }; // +-12 K spans the +-24 dam ramp
  if (lay.z && avail('z500')) out.contour = 'z500';
  if (lay.j && avail('ws250')) out.jet = 'ws250';
  return out;
}

/** The domain a field is drawn from in a view: the view's own if the field has it, else its first. */
export function domainFor(fieldId, view, m = data.getManifest()) {
  const meta = m?.fields?.[fieldId];
  if (!meta) return null;
  const want = VIEWS[view];
  return meta.domains.includes(want) ? want : meta.domains[0] ?? null;
}

/** Fields (with domains) a state needs loaded, for prefetching. */
export function needed(s, m = data.getManifest()) {
  const p = plan(s, m), out = [];
  for (const f of [p.anom?.field, p.contour, p.jet]) if (f) out.push([f, domainFor(f, s.view, m)]);
  if (p.anom?.code === 'z' && m?.fields?.z500sd) out.push(['z500sd', domainFor('z500sd', s.view, m)]);
  return out.filter(([, d]) => d);
}

let spreadMemo = { ver: -1, run: null, sp: null };
/** Domain-mean ensemble spread (gpm) at forecast hour t, or NaN. */
export function spreadAt(t) {
  const ver = data.dataVersion(), m = data.getManifest();
  if (spreadMemo.ver !== ver || spreadMemo.run !== m?.run) spreadMemo = { ver, run: m?.run, sp: data.sampleDomainSpread() };
  const sp = spreadMemo.sp;
  if (!sp) return NaN;
  const { steps, values } = sp;
  if (!(t >= steps[0]) || !(t <= steps[steps.length - 1])) return NaN;
  let i = 0;
  while (i < steps.length - 2 && steps[i + 1] <= t) i++;
  if (steps.length === 1) return values[0];
  const w = (t - steps[i]) / (steps[i + 1] - steps[i]);
  const a = values[i], b = values[i + 1];
  if (w < 1e-9) return a;
  return a === a && b === b ? a + (b - a) * w : NaN;
}

/** Saturation multiplier for the anomaly raster: the confidence fade, halved while the jet is shown. */
export function anomalySaturation(s, p) {
  let sat = 1;
  if (p.anom?.code === 'z') { const sp = spreadAt(s.t); sat *= fadeSaturation(sp); }
  if (p.jet) sat *= 0.5;
  return sat;
}

export function makeScene() {
  const bases = new Map(); // `${view}|${W}|${H}` -> base projection
  const views = new Map(); // mv.key -> MapView (LRU)
  const layers = new Map(); // key -> {fills, lines} offscreen canvases (LRU, 2)
  const rasters = new Map(); // `${slot}|${rw}x${rh}` -> {canvas, ctx, img, u32}
  const contourState = { cost: 0, n: 0, key: '', lines: null, labels: null, t: NaN };
  const stats = { composeMs: 0, contourMs: 0, contourPaintMs: 0, rasterMs: 0, rasterPaintMs: 0, baseMs: 0, lastLookupMs: 0, contourSkips: 0 };

  function viewFor(viewId, W, H, xf = IDENTITY(), inset = NO_PAD) {
    const bk = `${viewId}|${W}|${H}|${padKey(inset)}`;
    let base = bases.get(bk);
    if (!base) { base = baseProjection(viewId, W, H, inset); bases.set(bk, base); if (bases.size > 12) bases.delete(bases.keys().next().value); }
    const probe = new MapView(base, xf), hit = views.get(probe.key);
    if (hit) { hit.apply(); views.delete(probe.key); views.set(probe.key, hit); return hit; }
    views.set(probe.key, probe);
    if (views.size > 5) views.delete(views.keys().next().value);
    return probe;
  }

  function baseLayers(mv, themeName, dpr, low) {
    const key = `${mv.key}|${themeName}|${dpr}|${basemapReady() ? 1 : 0}|${low ? 1 : 0}`;
    let L = layers.get(key);
    if (L) { layers.delete(key); layers.set(key, L); return L; }
    const th = themeTokens(themeName), w = Math.round(mv.W * dpr), h = Math.round(mv.H * dpr);
    const fills = makeCanvas(w, h), lines = makeCanvas(w, h);
    for (const [cv, fn] of [[fills, drawFills], [lines, drawLines]]) {
      const c = cv.getContext('2d'); c.scale(w / mv.W, h / mv.H); fn(c, mv, th, low);
    }
    L = { fills, lines };
    if (!low) { layers.set(key, L); if (layers.size > 2) layers.delete(layers.keys().next().value); }
    return L;
  }

  function rasterBuf(slot, rw, rh) {
    const key = `${slot}|${rw}x${rh}`;
    let r = rasters.get(key);
    if (!r) {
      const canvas = makeCanvas(rw, rh), ctx = canvas.getContext('2d'), img = ctx.createImageData(rw, rh);
      r = { canvas, ctx, img, u32: new Uint32Array(img.data.buffer) };
      rasters.set(key, r); if (rasters.size > 6) rasters.delete(rasters.keys().next().value);
    }
    return r;
  }

  /** Colour a blended field through a LUT into the raster canvas and draw it over the frame. */
  function drawRaster(ctx, mv, slot, domId, vals, lut, mul, add, rs, dpr, alpha) {
    const dom = data.getManifest().domains[domId];
    const rw = Math.max(2, Math.round(mv.W * dpr * rs)), rh = Math.max(2, Math.round(mv.H * dpr * rs));
    const t0 = performance.now();
    const L = mv.lookup(domId, dom, rw, rh), t1 = performance.now();
    stats.lastLookupMs = Math.max(stats.lastLookupMs, t1 - t0);
    const R = rasterBuf(slot, rw, rh), { u32 } = R, { li, fx, fy } = L, nx = dom.nx, n = rw * rh;
    const k = (LUT_SIZE - 1) * mul, top = LUT_SIZE - 1;
    for (let p = 0; p < n; p++) {
      const i = li[p];
      if (i < 0) { u32[p] = 0; continue; }
      const x = fx[p], y = fy[p];
      const v = (vals[i] * (1 - x) + vals[i + 1] * x) * (1 - y) + (vals[i + nx] * (1 - x) + vals[i + nx + 1] * x) * y;
      if (v !== v) { u32[p] = 0; continue; }
      let q = (v + add) * k | 0;
      if (q < 0) q = 0; else if (q > top) q = top;
      u32[p] = lut[q];
    }
    R.ctx.putImageData(R.img, 0, 0);
    const t2 = performance.now();
    ctx.save();
    ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(R.canvas, 0, 0, mv.W, mv.H);
    ctx.restore();
    stats.rasterMs = t2 - t1; stats.rasterPaintMs = performance.now() - t2;
  }

  function strokeSegs(ctx, segs) { // segs: [flat x0,y0,x1,y1 arrays]
    ctx.beginPath();
    for (const seg of segs) for (let k = 0; k < seg.length; k += 4) { ctx.moveTo(seg[k], seg[k + 1]); ctx.lineTo(seg[k + 2], seg[k + 3]); }
    ctx.stroke();
  }

  function drawContours(ctx, mv, domId, vals, th, { force, t }) {
    const dom = data.getManifest().domains[domId], st = contourState, key = `${mv.key}|${domId}`;
    const t0 = performance.now();
    let lines, labels;
    if (!force && st.cost > 8 && st.key === key && st.lines && (st.n++ & 1)) {
      lines = st.lines; labels = st.labels; stats.contourSkips++; // over budget: every second frame
    } else {
      lines = contourSegments(vals, dom, mv.nodes(domId, dom), mv.W);
      labels = labelSpots(lines, mv.W, mv.H);
      st.cost = performance.now() - t0; st.key = key; st.lines = lines; st.labels = labels; st.n = 0;
    }
    const tp = performance.now();
    stats.contourMs = tp - t0;
    const thin = [], bold = [];
    for (const l of lines) (BOLD_DAM.includes(l.level / 10) ? bold : thin).push(l.seg);
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.lineWidth = 0.75; ctx.strokeStyle = th.contour; strokeSegs(ctx, thin);
    ctx.lineWidth = 1.25; ctx.strokeStyle = th.contourBold; strokeSegs(ctx, bold);
    ctx.font = `12px ${FONT_MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const s of labels) {
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.angle);
      ctx.lineWidth = 3; ctx.strokeStyle = th.halo; ctx.strokeText(s.text, 0, 0);
      ctx.fillStyle = th.text; ctx.globalAlpha = 0.85; ctx.fillText(s.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
    stats.contourPaintMs = performance.now() - tp;
  }

  function drawIsotachs(ctx, mv, domId, vals, th) {
    const dom = data.getManifest().domains[domId];
    const lines = contourSegments(vals, dom, mv.nodes(domId, dom), mv.W, { levels: [50, 70] });
    ctx.save();
    ctx.lineCap = 'round'; ctx.strokeStyle = th.isotach; ctx.lineWidth = 0.75;
    strokeSegs(ctx, lines.map((l) => l.seg));
    ctx.restore();
  }

  /**
   * Draw one frame of view `mv` into `ctx` (CSS px units for mv.W x mv.H; the context may be scaled for dpr).
   * opts: s {t, layers, theme, case}, dpr (resolution of the offscreen layers), rasterScale (0.5 = half of
   * device pixels), alpha (field opacity), force (always recompute contours), low (cheap basemap, no contours).
   * Returns {drewField}.
   */
  function compose(ctx, mv, opts) {
    const { s, dpr = 1, rasterScale = 0.5, alpha = 1, force = false, low = false } = opts;
    const t0 = performance.now(), th = themeTokens(s.theme), p = plan(s), m = data.getManifest();
    const L = baseLayers(mv, s.theme, dpr, low);
    ctx.drawImage(L.fills, 0, 0, mv.W, mv.H);
    stats.baseMs = performance.now() - t0;
    let drewField = false;
    if (m) {
      if (p.anom) {
        const dom = domainFor(p.anom.field, s.view), vals = dom && data.fieldAt(p.anom.field, dom, s.t);
        if (vals) {
          drawRaster(ctx, mv, 'a', dom, vals, anomalyLUT(s.theme, anomalySaturation(s, p)), p.anom.factor / (2 * ANOM_RANGE), ANOM_RANGE / p.anom.factor, rasterScale, dpr, alpha);
          drewField = true;
        }
      }
      if (p.jet) {
        const dom = domainFor(p.jet, s.view), vals = dom && data.fieldAt(p.jet, dom, s.t);
        if (vals) {
          drawRaster(ctx, mv, 'j', dom, vals, jetLUT(), 1 / JET_MAX, 0, rasterScale, dpr, alpha);
          if (!low) drawIsotachs(ctx, mv, dom, vals, th);
          drewField = true;
        }
      }
    }
    ctx.drawImage(L.lines, 0, 0, mv.W, mv.H);
    if (m && p.contour && !low) {
      const dom = domainFor(p.contour, s.view), vals = dom && data.fieldAt(p.contour, dom, s.t);
      if (vals) drawContours(ctx, mv, dom, vals, th, { force, t: s.t });
    }
    stats.composeMs = performance.now() - t0;
    return { drewField };
  }

  function clear() { bases.clear(); views.clear(); layers.clear(); rasters.clear(); contourState.key = ''; contourState.lines = null; }
  function clearLayers() { layers.clear(); }
  return { viewFor, compose, stats, clear, clearLayers, clampXf };
}
