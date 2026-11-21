// Frame composition (DESIGN-SPEC 4.2, 4.3, section 15; W3-01): draws the basemap, the banded field, the contours and their
// labels for one view into any 2D context. Used by the on-screen renderer and by renderTo (stills, GIF frames). Holds the
// caches that make a frame cheap: views and meshes, offscreen basemap layers, raster buffers, contour polylines.
//
// Draw order: ground fills, the fill raster (bands, hairlines, doubt hatch), contours, lens marks (hatches and other area marks),
// coast and border linework, contour labels (minus any `lens.labelBoxes` claims), a lens' own type (`lens.labels`: isotach
// knots, the H and L), annotations. The
// overlays the renderer registers are drawn by the renderer after this. W4-05 moved the H and L out of the marks pass, where
// DESIGN-SPEC section 15 put them, under the linework: a coastline through "1004" read "004".
//
// Quality (opts.quality, or the old opts.low / opts.rasterScale mapped to one):
//   'rest'   raster at min(dpr, 2) px per CSS px capped at 1.5 MP, bicubic from 3x zoom; contours and labels.
//   'motion' half that raster, bilinear: playing or a gesture. Contours kept (recomputed at most 10 times a second). Bounded in
//            time too: when this scene's measured cost says half the rest scale would take over MOTION_RASTER_MS (6 ms), its
//            side shrinks, down to a quarter of the rest scale (sample.js motionFit).
//   'rotate' a quarter of it, no hairlines or hatch, no contours, the 110 m coast only.
// `opts.sliceMs` (rest only) renders the raster in row slices: compose draws a coarse raster at once and returns
// {pending: true}; the caller then calls scene.stepPending(budget) on successive frames and composes again when it reports
// done. A new compose with different inputs, or scene.cancelPending(), abandons the job between two rows.
import { VIEWS } from '../contract.js';
import * as data from '../data/index.js';
import { isMultiCase, caseForLens } from '../data/kind.js';
import { choice } from '../state.js';
import { baseProjection, MapView, IDENTITY, clampXf, NO_PAD, padKey } from './view.js';
import { drawFills, drawLines, basemapReady, basemapTier } from './basemap.js';
import { isolines, labelSpots } from './isolines.js';
import { theme as themeTokens, groundFor, FONT_CHART } from './theme.js';
import { chartTokens } from './chart-tokens.js';
import { PALETTES } from './palette.js';
import { RasterJob, rasterSize, qualityFrom, refine2x, motionFit, BICUBIC_FROM_ZOOM, SLICE_MS } from './sample.js';
import { lens as lensOf } from '../lenses/index.js';
import * as annotate from './annotate.js';

const makeCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
};
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Field units -> palette units (a field stored in metres is drawn in dam). */
const FACTOR = { z500a: 0.1, z500sd: 0.1 };
export const DOUBT_GPM = 60; // 6 dam: one contour's worth of doubt
export const DOUBT_LOCK_H = 168; // beyond this the overlay cannot be switched off
/** The Uncertain areas overlay: on by default, can be switched off up to 168 h, locked on beyond. */
export const doubtWanted = (s) => (s.overlays?.doubt ?? true) || s.t > DOUBT_LOCK_H;
const CONTOUR_MS = 100; // while playing, contours are recomputed at most this often (10 per second)

/**
 * What a state draws. `s.lens` ('z' | 'j' | 's' | 'a' | 'r' | 'c'; absent = Pattern) decides it, and for a multi-case sample the
 * lens' own field decides the case (data/kind.js caseForLens).
 * Returns {lens, anom: {field, factor, code, palette} | null, contour: field | null, contourLine: the lens line spec | null,
 * jet: field | null (jet as a fill), jetLine: field | null (the jet as an outline), doubt: boolean}.
 * `anom`, `contour` and `jet` keep the shape the renderer and sampleAt read.
 */
export function plan(s, m = data.getManifest()) {
  const code = choice(s, 'lens'), caseId = caseForLens(m, code);
  const avail = (f) => { const meta = m?.fields?.[f]; return !!meta && (!isMultiCase(m) || meta.case === caseId); };
  const out = { lens: null, anom: null, contour: null, contourLine: null, jet: null, jetLine: null, doubt: false };
  const L = lensOf(code);
  out.lens = code;
  if (!L?.implemented) return out;
  if (L.fill && avail(L.fill.field)) out.anom = { field: L.fill.field, palette: L.fill.palette, factor: FACTOR[L.fill.palette] ?? 1, code };
  const ln = L.lines?.find((l) => l.style === 'contour');
  if (ln && avail(ln.field)) { out.contour = ln.field; out.contourLine = ln; }
  out.doubt = !!(L.doubt && out.anom && avail(L.doubt.field));
  // The Jet outline overlay: the 36 m/s isotach over any lens but the jet's own
  if (s.overlays?.jetline && code !== 'j' && avail('ws250')) out.jetLine = 'ws250';
  // The Height contours overlay (on by default) switches the lens' lines off
  if (s.overlays?.contours === false) { out.contour = null; out.contourLine = null; }
  // The jet as a fill when it is the lens' own field
  if (!out.jet && out.anom?.palette === 'ws250') { out.jet = out.anom.field; }
  return out;
}

/** The domain a field is drawn from in a view: the view's own if the field has it, else its first. */
export function domainFor(fieldId, view, m = data.getManifest()) {
  const meta = m?.fields?.[fieldId];
  if (!meta) return null;
  const want = VIEWS[view];
  return meta.domains.includes(want) ? want : meta.domains[0] ?? null;
}

/** The coarse global domain drawn beneath a regional one, or null (Regional only, when the field has both). */
export function underlayFor(fieldId, domId, m = data.getManifest()) {
  const meta = m?.fields?.[fieldId];
  return meta && domId === 'np05' && meta.domains.includes('g1') ? 'g1' : null;
}

/** Fields (with domains) a state needs loaded, for prefetching. */
export function needed(s, m = data.getManifest()) {
  const p = plan(s, m), out = [];
  const ids = [p.anom?.field, p.contour, p.jet, p.jetLine];
  if (p.doubt) ids.push('z500sd');
  for (const f of ids) {
    if (!f) continue;
    const d = domainFor(f, s.view, m);
    if (!d) continue;
    out.push([f, d]);
    const u = underlayFor(f, d, m);
    if (u && f !== p.contour && f !== p.jetLine) out.push([f, u]); // the g1 underlay of a fill
  }
  return out;
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

/** Retired: the fill never fades (a band's colour does not depend on the spread). Kept so old callers still get a number. */
export function anomalySaturation() { return 1; }

/** Does contour label `sp` ({x, y, text}, at FONT_CHART, any angle) touch box `b`? Its rotated box is bounded by a circle. */
function labelHits(sp, b) {
  const r = Math.hypot(String(sp.text).length * 7 + 6, 17) / 2;
  const nx = Math.max(b.x, Math.min(sp.x, b.x + b.w)), ny = Math.max(b.y, Math.min(sp.y, b.y + b.h));
  return Math.hypot(sp.x - nx, sp.y - ny) < r;
}

/** Screen rectangles the labels must stay out from: the legend and the map tools, in the canvas' CSS px. */
function domAvoid(mv) {
  if (typeof document === 'undefined') return [];
  const cv = document.getElementById('map');
  if (!cv) return [];
  const cr = cv.getBoundingClientRect();
  if (!cr.width || !cr.height) return [];
  if (Math.abs(mv.W - cr.width) > 2 || Math.abs(mv.H - cr.height) > 2) return []; // a still (a share image) has no controls on it
  const kx = 1, ky = 1, out = [];
  for (const id of ['map-legend', 'map-tools']) { // the legend card (maplegend.js mounts #map-legend; #legend is only its 1 x 1 anchor) and the tools
    const el = document.getElementById(id);
    if (!el && id !== 'map-legend') continue;
    const r = el ? el.getBoundingClientRect() : { width: 0, height: 0 };
    if (id === 'map-legend' && (r.width < 40 || r.height < 40)) { // no legend card on the page: keep clear of where a legend sits, bottom-left
      const [, , pb = 0, pl = 0] = String(mv.base.inset || '').split(',').map(Number); // the free area the renderer fitted the view into
      out.push({ x: pl, y: mv.H - pb - 200, w: Math.min(mv.W * 0.9, 340), h: 200 });
      continue;
    }
    if (!r.width || !r.height) continue;
    out.push({ x: (r.left - cr.left) * kx, y: (r.top - cr.top) * ky, w: r.width * kx, h: r.height * ky });
  }
  return out;
}

export function makeScene() {
  const bases = new Map(); // `${view}|${W}|${H}` -> base projection
  const views = new Map(); // mv.key -> MapView (LRU)
  const layers = new Map(); // key -> {fills, lines, w, h} offscreen canvases (LRU, 2)
  const rasters = new Map(); // `${slot}|${rw}x${rh}` -> {canvas, ctx, img, u32, key}
  const cState = { key: '', at: 0, iso: null, labels: null, refined: null };
  let pending = null; // {job, R, key, mv}
  // measured raster cost (ms per raster pixel, bilinear), a moving average over the rasters this scene has painted; and the
  // motion raster's current MOTION_FITS step
  const cost = { msPerPx: 0, fit: 1 };
  function learnCost(job, px) {
    if (!(px > 0) || !(job.stats.ms > 0)) return;
    const m = job.stats.ms / px;
    cost.msPerPx = cost.msPerPx > 0 ? cost.msPerPx * 0.6 + m * 0.4 : m;
    stats.rasterMsPerMpx = +(cost.msPerPx * 1e6).toFixed(2); stats.motionFit = cost.fit;
  }
  const stats = { composeMs: 0, contourMs: 0, contourPaintMs: 0, rasterMs: 0, rasterPaintMs: 0, baseMs: 0, lastLookupMs: 0, contourSkips: 0, contourComputes: 0, labelMs: 0, labelCount: 0, bytes: 0, rasterPx: 0, restRasterPx: 0, sliceMaxMs: 0, slices: 0, rasterQuality: 'rest', rasterMsPerMpx: 0, motionFit: 1 };

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

  function baseLayers(mv, themeName, ground, dpr, low) {
    // the tier is in the key: a layer drawn from the 110 m files is never reused once the 50 m files have swapped in (loadBasemap
    // calls only its first caller's onUpgrade, so a second renderer's scene is not cleared by the swap)
    const key = `${mv.key}|${themeName}|${ground}|${dpr}|${basemapReady() ? basemapTier() : 0}|${low ? 1 : 0}`;
    let L = layers.get(key);
    if (L) { layers.delete(key); layers.set(key, L); return L; }
    const th = themeTokens(themeName), w = Math.round(mv.W * dpr), h = Math.round(mv.H * dpr);
    const fills = makeCanvas(w, h), lines = makeCanvas(w, h);
    for (const [cv, fn] of [[fills, drawFills], [lines, drawLines]]) {
      const c = cv.getContext('2d'); c.scale(w / mv.W, h / mv.H); fn(c, mv, th, low, ground);
    }
    L = { fills, lines, w, h };
    if (!low) { layers.set(key, L); if (layers.size > 2) layers.delete(layers.keys().next().value); }
    return L;
  }

  function rasterBuf(slot, rw, rh) {
    const key = `${slot}|${rw}x${rh}`;
    let r = rasters.get(key);
    if (r) { rasters.delete(key); rasters.set(key, r); } // most recently used last
    else {
      const canvas = makeCanvas(rw, rh), ctx = canvas.getContext('2d'), img = ctx.createImageData(rw, rh);
      r = { canvas, ctx, img, u32: new Uint32Array(img.data.buffer), key: null, rw, rh };
      rasters.set(key, r); if (rasters.size > 4) rasters.delete(rasters.keys().next().value);
    }
    return r;
  }

  /** The grids a fill reads: the view's own domain feathered over a global underlay when it has one. null when not loaded yet. */
  function gridsFor(field, view, t, m) {
    const domId = domainFor(field, view, m), dom = domId && m.domains[domId], vals = dom && data.fieldAt(field, domId, t);
    if (!vals) return null;
    const out = [{ domId, dom, vals, feather: false }];
    const uId = underlayFor(field, domId, m);
    if (uId) {
      const uv = data.fieldAt(field, uId, t);
      if (uv) { out[0].feather = true; out.push({ domId: uId, dom: m.domains[uId], vals: uv, feather: false }); }
      else out[0].feather = true; // no underlay yet: the edge feathers to the ground
    } else if (domId === 'np05') out[0].feather = true;
    return out;
  }

  /** Paint the field and the doubt hatch into a raster buffer and draw it. Returns {drew, pending, partial}. */
  function drawFill(ctx, mv, s, p, ground, quality, opts) {
    const m = data.getManifest(), { dpr = 1, alpha = 1 } = opts;
    const pal = p.anom || (p.jet ? { field: p.jet, palette: 'ws250', factor: 1, code: 'j' } : null);
    if (!pal) return { drew: false, pending: false, partial: false };
    const grids = gridsFor(pal.field, s.view, s.t, m);
    if (!grids) return { drew: false, pending: false, partial: false };
    // the motion raster is bounded in time: its side shrinks (to a quarter of the rest scale at most) when this scene's measured
    // cost per pixel says half the rest scale would take more than MOTION_RASTER_MS
    if (quality === 'motion' && !opts.cachedOnly) { const f1 = rasterSize(mv.W, mv.H, dpr, 'motion'); cost.fit = motionFit(cost.msPerPx, f1.rw * f1.rh, cost.fit); stats.motionFit = cost.fit; }
    const { rw, rh, scale } = rasterSize(mv.W, mv.H, dpr, quality, quality === 'motion' ? cost.fit : 1);
    const wantDoubt = p.doubt && quality !== 'rotate' && doubtWanted(s);
    const dgrids = wantDoubt ? gridsFor('z500sd', s.view, s.t, m) : null;
    const doubt = dgrids ? { layers: dgrids, limit: DOUBT_GPM } : null;
    const bicubic = quality === 'rest' && mv.xf.k >= BICUBIC_FROM_ZOOM;
    const hairlines = quality !== 'rotate' && PALETTES[pal.palette].majorEdges.length > 0;
    const baseKey = [mv.key, pal.field, pal.palette, s.t, data.dataVersion(), ground, doubt ? 1 : 0, hairlines ? 1 : 0, grids.map((g) => g.domId + (g.feather ? 'f' : '')).join('+')].join('|');
    const key = `${baseKey}|${rw}x${rh}|${bicubic ? 1 : 0}`;
    // a compose of other inputs abandons a running job (the coarse draw a job's own compose makes is `internal`)
    if (pending && pending.baseKey !== baseKey && !opts.internal) { pending.job.cancel(); pending = null; }
    const slot = quality === 'rest' ? 'rest' : 'coarse';
    const R = rasterBuf(slot, rw, rh);
    if (opts.cachedOnly && R.key !== key) return { drew: false, pending: false, partial: false }; // the caller wants no new raster work
    stats.rasterPx = rw * rh; stats.rasterQuality = quality; if (quality === 'rest') stats.restRasterPx = rw * rh;
    const spec = () => ({ mv, W: mv.W, H: mv.H, rw, rh, u32: R.u32, pool: quality === 'rotate', layers: grids, factor: pal.factor, palette: pal.palette, ground, bicubic, hairlines, doubt });
    const paint = () => {
      const t2 = nowMs();
      R.ctx.putImageData(R.img, 0, 0);
      ctx.save();
      ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(R.canvas, 0, 0, mv.W, mv.H);
      ctx.restore();
      stats.rasterPaintMs = nowMs() - t2;
    };
    // already painted for these inputs
    if (R.key === key) { paint(); return { drew: true, pending: false, partial: false }; }
    if (quality === 'rest' && pending && pending.key === key) return coarseThenPending(ctx, mv, s, p, ground, opts); // the job is running
    if (quality === 'rest' && pending) { pending.job.cancel(); pending = null; } // same inputs, another size or zoom
    const t0 = nowMs();
    if (quality === 'rest' && opts.sliceMs > 0) {
      R.key = null;
      // data.fieldAt hands out one reused buffer per field and domain, and others (the scrubber) read other times into it between
      // two slices: the job works on its own copy
      const own = (g) => ({ ...g, vals: g.vals.slice() });
      const sp = spec(); sp.layers = grids.map(own); if (doubt) sp.doubt = { ...doubt, layers: doubt.layers.map(own) };
      const job = new RasterJob(sp);
      job.ownBytes = sp.layers.reduce((n, g) => n + g.vals.byteLength, 0) + (sp.doubt ? sp.doubt.layers.reduce((n, g) => n + g.vals.byteLength, 0) : 0);
      pending = { job, R, key, baseKey };
      const done = job.step(0); // the slices follow on successive frames (stepPending); this compose stays cheap
      stats.rasterMs = nowMs() - t0; stats.sliceMaxMs = Math.max(stats.sliceMaxMs, job.stats.maxSliceMs); stats.slices++;
      if (done) { pending = null; R.key = key; paint(); return { drew: true, pending: false, partial: false }; }
      return coarseThenPending(ctx, mv, s, p, ground, opts);
    }
    const job = new RasterJob(spec());
    R.key = null;
    job.step(Infinity);
    R.key = key;
    stats.rasterMs = nowMs() - t0;
    if (!bicubic && quality !== 'rotate') learnCost(job, rw * rh); // a rotate raster skips hairlines and hatch: cheaper per pixel than the motion raster it would size
    paint();
    return { drew: true, pending: false, partial: false };
  }

  /**
   * While a rest job runs: the half-size bilinear raster the frame before it (playback, a scrub or a step) already painted for
   * these inputs, so the field does not drop to a coarser one as the crisp one starts; else the cheap quarter-size raster
   * (a cold half-size raster is too long a frame to spend on every cancelled job).
   */
  function coarseThenPending(ctx, mv, s, p, ground, opts) {
    if (drawFill(ctx, mv, s, p, ground, 'motion', { ...opts, sliceMs: 0, internal: true, cachedOnly: true }).drew) return { drew: true, pending: true, partial: false };
    drawFill(ctx, mv, s, p, ground, 'rotate', { ...opts, sliceMs: 0, internal: true });
    return { drew: true, pending: true, partial: false };
  }

  // ---------- contours ----------
  function strokeLevels(ctx, iso, bold, tk, tone) {
    const isBold = (lv) => bold.some((b) => Math.abs(b - lv) < 1e-6);
    const pathOf = (lines) => { const P = new Path2D(); for (const { pts, closed } of lines) { P.moveTo(pts[0], pts[1]); for (let k = 2; k < pts.length; k += 2) P.lineTo(pts[k], pts[k + 1]); if (closed) P.closePath(); } return P; };
    const paths = iso.map((L) => ({ P: pathOf(L.lines), bold: isBold(L.level) }));
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (tone === 'context') { // a lens' quiet context lines (Air mass: the height in grey): one thin stroke, no casing, no bold levels
      const cx = tk.contextContour;
      ctx.globalAlpha = cx.alpha; ctx.strokeStyle = cx.color; ctx.lineWidth = cx.width;
      for (const { P } of paths) ctx.stroke(P);
      ctx.restore();
      return;
    }
    if (tk.contour.casing) { // Night: a dark casing under every core, so light lines read over the bands
      ctx.globalAlpha = tk.contour.casingAlpha; ctx.strokeStyle = tk.contour.casing;
      for (const { P, bold } of paths) { ctx.lineWidth = tk.contour.casingWidth + (bold ? tk.contour.boldWidth - tk.contour.width : 0); ctx.stroke(P); }
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = tk.contour.color;
    for (const { P, bold } of paths) { ctx.lineWidth = bold ? tk.contour.boldWidth : tk.contour.width; ctx.stroke(P); } // one stroke per level
    ctx.restore();
  }

  /** Compute (or reuse) the contour lines and label layout, and stroke the lines. Returns the labels to draw after the linework. */
  function drawContours(ctx, mv, s, p, tk, quality, opts) {
    const m = data.getManifest(), line = p.contourLine, field = p.contour;
    let domId = domainFor(field, s.view, m), dom = domId && m.domains[domId];
    let vals = dom && data.fieldAt(field, domId, s.t);
    if (!vals) return [];
    // a global grid zoomed past 2x: contours on a 2x refined grid (spec 4.3)
    let nodesKey = domId;
    if (domId === 'g1' && mv.xf.k > 2) {
      const rk = `${field}|${s.t}|${data.dataVersion()}`;
      if (cState.refined?.key !== rk) { const r = refine2x(vals, dom); cState.refined = { key: rk, ...r }; }
      vals = cState.refined.vals; dom = cState.refined.dom; nodesKey = 'g1x2';
    }
    const avoid = opts.avoid ?? domAvoid(mv);
    const avoidKey = avoid.map((r) => [r.x, r.y, r.w, r.h].map(Math.round).join(',')).join(';');
    const viewKey = `${mv.key}|${nodesKey}|${field}|${line.step}|${line.from ?? ''}|${line.bold.join(',')}|${line.labelEvery}|${avoidKey}|${s.ground}|${s.theme}`;
    const key = `${viewKey}|${s.t}|${data.dataVersion()}`;
    const t0 = nowMs();
    const playing = s.playing || quality === 'motion';
    let hit = cState.key === key && cState.iso;
    // while playing, the lines of the last computation are kept for 100 ms (10 recomputations a second) when the view is the same
    if (!hit && !opts.force && playing && cState.viewKey === viewKey && cState.iso && t0 - cState.at < CONTOUR_MS) { hit = true; stats.contourSkips++; }
    if (opts.cachedOnly && !hit) return [];
    if (!hit || opts.force) {
      const iso = isolines(vals, dom, mv.nodes(nodesKey, dom), mv.W, { step: line.step }).filter((L) => line.from == null || L.level >= line.from); // `from`: no level below it (IVT has no 0 line)
      const boldDam = line.bold.map((b) => b * line.unit);
      // 320 px apart on a full-size map; a small frame (a share image, a phone) keeps the same density per area
      const minGap = Math.round(Math.min(320, 320 * Math.sqrt((mv.W * mv.H) / 600000)));
      let labels = labelSpots(iso, mv.W, mv.H, { avoid, minGap, bold: boldDam, every: line.labelEvery * line.unit, unit: 1 / line.unit });
      if (line.labelText) labels = labels.map((sp) => ({ ...sp, text: line.labelText(sp.text) })); // e.g. isobars: 1008 reads "08"
      Object.assign(cState, { key, viewKey, at: t0, iso, labels, bold: line.bold });
      stats.contourComputes++;
    }
    const tp = nowMs();
    stats.contourMs = tp - t0;
    strokeLevels(ctx, cState.iso, cState.bold, tk, line.tone);
    stats.contourPaintMs = nowMs() - tp;
    return cState.labels;
  }

  function drawLabels(ctx, labels, tk) {
    stats.labelCount = labels.length;
    stats.labelSpots = labels.map((sp) => ({ x: sp.x, y: sp.y, text: String(sp.text), angle: sp.angle })); // what is drawn, for the tests
    if (!labels.length) return;
    const t0 = nowMs();
    ctx.save();
    ctx.font = FONT_CHART; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.2px';
    if ('fontVariantNumeric' in ctx) { try { ctx.fontVariantNumeric = 'tabular-nums'; } catch { /* not supported */ } }
    ctx.lineJoin = 'round';
    for (const sp of labels) {
      ctx.save(); ctx.translate(sp.x, sp.y); ctx.rotate(sp.angle);
      ctx.lineWidth = tk.label.haloWidth; ctx.strokeStyle = tk.label.halo; ctx.strokeText(sp.text, 0, 0);
      ctx.fillStyle = tk.label.ink; ctx.fillText(sp.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
    stats.labelMs = nowMs() - t0;
  }

  /** The jet as an outline over another lens: the 36 m/s isotach (70 kt, the edge of a jet). */
  function drawJetLine(ctx, mv, s, field, tk) {
    const m = data.getManifest(), domId = domainFor(field, s.view, m), dom = domId && m.domains[domId], vals = dom && data.fieldAt(field, domId, s.t);
    if (!vals) return;
    const iso = isolines(vals, dom, mv.nodes(domId, dom), mv.W, { levels: [36] });
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = 1.5; ctx.strokeStyle = tk.ground === 'night' ? '#a7e700' : '#00724b';
    for (const L of iso) for (const { pts, closed } of L.lines) {
      ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
      for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]);
      if (closed) ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Draw one frame of view `mv` into `ctx` (CSS px units for mv.W x mv.H; the context may be scaled for dpr).
   * opts: s {t, lens, layers, theme, ground, overlays, case, playing}, dpr (resolution of the offscreen layers), quality
   * ('rest' | 'motion' | 'rotate'; or the old low / rasterScale), sliceMs (rest raster in slices), alpha (field opacity: 1 but for
   * the first-field fade-in), force (always recompute contours), avoid (label keep-out rects; default the legend and tools).
   * Returns {drewField, pending}.
   */
  function compose(ctx, mv, opts) {
    const { s, dpr = 1, alpha = 1 } = opts;
    let quality = qualityFrom(opts);
    if (quality === 'rest' && s.playing && !opts.sliceMs) quality = 'motion'; // playing: half-size raster (spec 4.2) whatever the caller asked for
    const low = quality === 'rotate';
    const t0 = nowMs(), ground = groundFor(s), tk = chartTokens(ground), p = plan(s), m = data.getManifest();
    const L = baseLayers(mv, s.theme, ground, dpr, low);
    ctx.drawImage(L.fills, 0, 0, mv.W, mv.H);
    stats.baseMs = nowMs() - t0;
    let drewField = false, isPending = false, labels = [];
    if (m) {
      const f = drawFill(ctx, mv, s, p, ground, quality, { ...opts, alpha });
      drewField = f.drew; isPending = f.pending;
      // while a rest raster is pending the contours already computed for these inputs stay on screen (no pop); none are computed for a frame about to be replaced
      if (p.contour && !low) labels = drawContours(ctx, mv, s, p, tk, quality, { ...opts, force: opts.force && !isPending, cachedOnly: isPending });
      if (p.jetLine && !low && !isPending) drawJetLine(ctx, mv, s, p.jetLine, tk);
    }
    // lens marks (terrain hatch and the like) go under the linework, as the draw order says
    const D = s.lens ? lensOf(s.lens) : null;
    if (m && D?.implemented && typeof D.marks === 'function' && !low) { try { D.marks(ctx, mv, (lon, lat) => null, tk, { s, plan: p, ground, quality }); } catch (e) { console.error('lens marks failed', e); } }
    ctx.drawImage(L.lines, 0, 0, mv.W, mv.H);
    // a lens' own type that sits at fixed points (the Storms lens' H and L and their values) claims its boxes first: a contour
    // label it would cover gives way to it
    const lensInfo = { s, ground, quality, plan: p };
    if (m && D?.implemented && typeof D.labelBoxes === 'function' && !low && labels.length) {
      try { const boxes = D.labelBoxes(ctx, mv, tk, lensInfo) || []; if (boxes.length) labels = labels.filter((sp) => !boxes.some((b) => labelHits(sp, b))); } catch (e) { console.error('lens label boxes failed', e); }
    }
    drawLabels(ctx, labels, tk);
    // lens labels (isotach knots, the spread phrase, the H and L) are drawn after the linework too, over the coast and borders
    if (m && D?.implemented && typeof D.labels === 'function' && !low) { try { D.labels(ctx, mv, (lon, lat) => null, tk, lensInfo); } catch (e) { console.error('lens labels failed', e); } }
    if (!low) annotate.draw(ctx, mv, { s, ground, tokens: tk, plan: p, taken: labels, avoid: opts.avoid ?? domAvoid(mv), settle: quality === 'rest' });
    stats.composeMs = nowMs() - t0;
    stats.bytes = bytes();
    return { drewField, pending: isPending };
  }

  /** Run the pending rest raster for up to `budgetMs`. Returns {pending: bool, done: bool}: when done, compose again to show it. */
  function stepPending(budgetMs = SLICE_MS) {
    if (!pending) return { pending: false, done: false };
    const { job, R, key } = pending, t0 = nowMs();
    const done = job.step(budgetMs);
    stats.sliceMaxMs = Math.max(stats.sliceMaxMs, nowMs() - t0); stats.slices++;
    if (done) { R.key = key; pending = null; if (!job.bicubic) learnCost(job, job.rw * job.rh); return { pending: false, done: true }; }
    return { pending: true, done: false };
  }
  function cancelPending() { if (pending) { pending.job.cancel(); pending = null; } }
  const hasPending = () => !!pending;

  /** Summed byteLength of every cached typed array, ImageData and offscreen canvas (4 bytes a pixel) this scene holds. */
  function bytes() {
    let n = 0;
    for (const r of rasters.values()) n += r.img.data.byteLength + r.rw * r.rh * 4;
    for (const l of layers.values()) n += 2 * l.w * l.h * 4;
    if (pending) n += pending.job.ownBytes || 0;
    for (const mv of views.values()) {
      for (const M of mv.meshes.values()) n += M.mgi.byteLength + M.mgj.byteLength + M.mok.byteLength + (M.kinds ? M.kinds.byteLength : 0);
      for (const P of mv.nodeCache.values()) n += P.byteLength;
      for (const Lk of mv.lookups.values()) n += Lk.li.byteLength + Lk.fx.byteLength + Lk.fy.byteLength;
    }
    if (cState.iso) for (const L of cState.iso) for (const l of L.lines) n += l.pts.length * 8;
    if (cState.refined) n += cState.refined.vals.byteLength;
    return n;
  }

  function clear() { cancelPending(); bases.clear(); views.clear(); layers.clear(); rasters.clear(); cState.key = ''; cState.iso = null; cState.labels = null; cState.refined = null; stats.bytes = 0; }
  function clearLayers() { layers.clear(); }
  return { viewFor, compose, stats, clear, clearLayers, clampXf, stepPending, cancelPending, hasPending, bytes };
}
