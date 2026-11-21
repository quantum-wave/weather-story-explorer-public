// Bundled basemap (Natural Earth via world-atlas, US Census states via us-atlas): ocean, land, graticule, coastlines,
// borders, US state lines. DESIGN-SPEC 4.4 (W3-02).
//
// Load order (E-D5): the small 110 m files (countries-110m.json: land and borders) load first and the chart draws at once;
// the 50 m files (land-50m, countries-50m) and the US states file load when the browser is idle and swap in, and
// `onUpgrade` tells the renderer to redraw. Each view projects the geometry once into a cached Path2D; the casing and the
// core of a line are two strokes of that one path, and the land fill is its own polygon path (the strokes use a line mesh).
// While the globe rotates (`low`) only the 110 m coastline core is drawn: no borders, no casing.
import { d3, topojson } from '../vendor.js';
import { chartTokens } from './chart-tokens.js';

let geo = null, loading = null, full = null;
const events = [];
const note = (e) => events.push({ e, t: typeof performance !== 'undefined' ? performance.now() : 0 });

const ok = (r) => { if (!r.ok) throw new Error(`basemap ${r.status}`); return r.json(); };
// After the first frame has been requested (one animation frame), then when the browser is idle.
const idle = (fn) => {
  const go = () => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 60));
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go); else go();
};
const interior = (topo, obj) => topojson.mesh(topo, obj, (a, b) => a !== b);
/**
 * The coastline as a line mesh. The land POLYGON is closed along the pole (Antarctica) and cut along the antimeridian, and
 * d3 closes it again wherever a view clips it, so stroking the polygon draws those seams as if they were shoreline. The
 * mesh is the real arcs with the closure segments dropped: any segment lying on the pole (lat <= -89.9) or on the
 * antimeridian (both ends at |lon| >= 179.999). Lines are clipped as lines, so a view's rim is never stroked.
 */
export function coastMesh(topo, obj = topo.objects.land) {
  const m = topojson.mesh(topo, obj), out = [];
  const seam = (a, b) => (a[1] <= -89.9 && b[1] <= -89.9) || (Math.abs(a[0]) >= 179.999 && Math.abs(b[0]) >= 179.999 && a[0] * b[0] > 0);
  for (const line of m.coordinates) {
    let cur = [];
    for (let i = 0; i < line.length; i++) {
      if (i && seam(line[i - 1], line[i])) { if (cur.length > 1) out.push(cur); cur = []; }
      cur.push(line[i]);
    }
    if (cur.length > 1) out.push(cur);
  }
  return { type: 'MultiLineString', coordinates: out };
}

/**
 * Fetch and decode the bundled TopoJSON. Resolves with the 110 m basemap as soon as it is parsed (the first chart can
 * draw); the 50 m files follow when idle. geo: {tier 1|2, land, landLow, borders, states}. `onUpgrade(geo)` runs when
 * the 50 m files have swapped in.
 */
export function loadBasemap(base = 'geo/', { onUpgrade } = {}) {
  if (geo) return Promise.resolve(geo);
  loading ||= fetch(base + 'countries-110m.json').then(ok).then((c) => {
    const landLow = topojson.feature(c, c.objects.land);
    const coastLow = coastMesh(c);
    geo = { tier: 1, land: landLow, landLow, coast: coastLow, coastLow, borders: interior(c, c.objects.countries), states: null };
    note('ready110');
    full = new Promise((resolve) => {
      idle(async () => {
        note('request50');
        const [l, c50, st] = await Promise.all([land50(base), countries50(base), states(base)]);
        const next = { ...geo, tier: l || c50 || st ? 2 : 1, land: l ? l.feature : geo.land, coast: l ? l.mesh : geo.coast, borders: c50 || geo.borders, states: st };
        if (next.tier === 2) { try { await warm(next); } catch (e) { console.warn('basemap 50 m warm-up failed', e.message); } }
        geo = next;
        note('ready50');
        if (onUpgrade) { try { onUpgrade(geo); } catch (e) { console.warn('basemap upgrade handler failed', e.message); } }
        resolve(geo);
      });
    });
    return geo;
  });
  loading.catch(() => { loading = null; });
  return loading;
}
const quiet = (what, p) => p.catch((e) => { console.warn(`basemap ${what} failed`, e.message); return null; });
const land50 = (base) => quiet('land 50 m', fetch(base + 'land-50m.json').then(ok).then((l) => ({ feature: topojson.feature(l, l.objects.land), mesh: coastMesh(l) })));
const countries50 = (base) => quiet('borders 50 m', fetch(base + 'countries-50m.json').then(ok).then((c) => interior(c, c.objects.countries)));
const states = (base) => quiet('states', fetch(base + 'states-10m.json').then(ok).then((s) => interior(s, s.objects.states)));

export const basemapReady = () => geo !== null;
/** 0 before anything is parsed, 1 with the 110 m files, 2 once the 50 m files have swapped in. */
export const basemapTier = () => (geo ? geo.tier : 0);
/** Resolves once the 50 m upgrade has finished (or failed); null before the 110 m files have parsed. */
export const basemapFull = () => full;
/** The decoded geometry, for tests and tools: {tier, land, landLow, borders, states}. */
export const basemapData = () => geo;
/** What happened and when, for the load-order test: [{e: 'ready110' | 'firstDraw110' | 'request50' | 'ready50', t}]. */
export const basemapLog = () => events.slice();
/** Test hook. */
export function setBasemap(g) { geo = g; pathCache.clear(); }

// ---------- one Path2D per view and layer ----------
const pathCache = new Map();
// fills take the polygons, strokes take the line meshes (no pole or antimeridian closure, no clip-edge stroke)
const objOf = (g, kind) => ({ land: g.land, landLow: g.landLow, coast: g.coast, coastLow: g.coastLow, border: g.borders, state: g.states })[kind];
const keep = (key, p) => { pathCache.set(key, p); if (pathCache.size > 24) pathCache.delete(pathCache.keys().next().value); };
let recent = null; // the last view whose rest linework was asked for: the one on screen, which the 50 m warm-up builds first
function pathFor(mv, kind) {
  const tier = kind === 'coastLow' || kind === 'landLow' ? 1 : geo.tier, key = `${mv.key}|${kind}|${tier}`;
  if (kind !== 'coastLow' && kind !== 'landLow') recent = mv;
  let p = pathCache.get(key);
  if (p) { pathCache.delete(key); pathCache.set(key, p); return p; }
  mv.apply();
  p = new Path2D();
  const obj = objOf(geo, kind);
  if (obj) d3.geoPath(mv.base.proj, p)(obj);
  keep(key, p);
  return p;
}

// ---------- the 50 m swap, projected in slices ----------
// Projecting the 50 m land, coast and borders for one view takes about 150 ms of d3 (measured 2026-11-19 in thread CPU time: one
// ~150 ms long task right after 'ready50', inside the first half second). Done in the swap's redraw, that blocked the main thread
// while the page was first painted (input, timers and frames all late). So the swap is staged: the 50 m paths of the view on
// screen are built first, a few polygons at a time in tasks of at most SLICE_MS, into the same Path2D a single call would make (d3
// streams each polygon and each line on its own, so the pieces add up to the whole); only then do the 50 m files swap in, and the
// swap's redraw finds its paths cached. A view drawn while the warm-up runs (a pan, another view) is built next, up to three views.
const SLICE_MS = 8;
const yieldTask = () => new Promise((r) => setTimeout(r, 0));
/** The geometry as a list of pieces d3 streams independently: features, then each polygon and each line. */
function pieces(obj, out = []) {
  if (!obj) return out;
  if (obj.type === 'FeatureCollection') for (const f of obj.features) pieces(f, out);
  else if (obj.type === 'Feature') pieces(obj.geometry, out);
  else if (obj.type === 'GeometryCollection') for (const g of obj.geometries) pieces(g, out);
  else if (obj.type === 'MultiPolygon') for (const c of obj.coordinates) out.push({ type: 'Polygon', coordinates: c });
  else if (obj.type === 'MultiLineString') for (const c of obj.coordinates) out.push({ type: 'LineString', coordinates: c });
  else out.push(obj);
  return out;
}
/** The projection's state as MapView.apply sets it; restored after each slice, so code in other tasks finds it as it left it. */
const snap = (proj) => ({ r: proj.rotate ? proj.rotate() : null, s: proj.scale(), t: proj.translate() });
const restore = (proj, x) => { if (x.r && proj.rotate) proj.rotate(x.r); proj.scale(x.s).translate(x.t); };
async function slicedPath(mv, obj) {
  const parts = pieces(obj), p = new Path2D(), proj = mv.base.proj;
  for (let i = 0; i < parts.length;) {
    const t0 = performance.now(), was = snap(proj);
    mv.apply();
    const path = d3.geoPath(proj, p);
    try { do path(parts[i++]); while (i < parts.length && performance.now() - t0 < SLICE_MS); } finally { restore(proj, was); }
    if (i < parts.length) await yieldTask();
  }
  return p;
}
/** Builds the 50 m paths of the view on screen (and of any view drawn meanwhile) before the swap. */
async function warm(next) {
  for (let n = 0; n < 3; n++) {
    const mv = recent;
    if (!mv) return;
    const kinds = ['land', 'coast', 'border', ...(mv.viewId === 'np' && next.states ? ['state'] : [])];
    for (const kind of kinds) {
      const key = `${mv.key}|${kind}|2`;
      if (!pathCache.has(key)) keep(key, await slicedPath(mv, objOf(next, kind)));
    }
    note('warm50');
    if (recent.key === mv.key) return;
  }
}

/** The chart ground a legacy theme token set stands for: light themes draw on Paper, dark on Night. */
export function groundOf(th) {
  if (th && th.ground) return th.ground;
  const hex = String(th?.ocean || '#000').replace('#', '');
  return parseInt(hex.slice(0, 2), 16) > 0x80 ? 'paper' : 'night';
}

const GRATICULE = d3.geoGraticule().step([30, 30])();

/**
 * Ocean, graticule, land fill. ctx is in CSS px (already scaled for dpr). `low` uses the 110 m coastline. With `ground`
 * given, ocean and land come from chartTokens(ground); without it they come from `th` (the legacy theme).
 */
export function drawFills(ctx, mv, th, low = false, ground = undefined) {
  const { W, H } = mv, tk = chartTokens(ground || groundOf(th));
  const ocean = ground ? tk.ocean : th.ocean, land = ground ? tk.land : th.land;
  mv.apply();
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, W, H);
  const path = d3.geoPath(mv.base.proj, ctx);
  if (mv.viewId !== 'np') {
    ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = ocean; ctx.fill();
  }
  if (geo) {
    if (geo.tier === 1) note('firstDraw110');
    ctx.fillStyle = land; ctx.fill(pathFor(mv, low ? 'landLow' : 'land'));
  }
  ctx.beginPath(); path(GRATICULE);
  ctx.strokeStyle = tk.graticule.color; ctx.globalAlpha = tk.graticule.alpha; ctx.lineWidth = tk.graticule.width; ctx.stroke(); ctx.globalAlpha = 1;
  if (mv.viewId !== 'np') { ctx.beginPath(); path({ type: 'Sphere' }); ctx.strokeStyle = th.hairline; ctx.lineWidth = 1; ctx.stroke(); }
}

/**
 * Coastlines, borders and (Regional) US state lines on a transparent canvas: each a core over a casing in the
 * contrasting colour, so a line stays legible over any band of the field (REF-5, REF-34). `ground` defaults to the one
 * `th` stands for.
 */
export function drawLines(ctx, mv, th, low = false, ground = undefined) {
  if (!geo) return;
  const tk = chartTokens(ground || groundOf(th));
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const stroke = (p, color, alpha, width) => { ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(p); };
  if (low) { // rotating: the 110 m coastline core only
    stroke(pathFor(mv, 'coastLow'), tk.coast.color, tk.coast.alpha, tk.coast.width);
    ctx.globalAlpha = 1;
    return;
  }
  const coast = pathFor(mv, 'coast'), border = pathFor(mv, 'border');
  const stateLines = mv.viewId === 'np' && geo.states ? pathFor(mv, 'state') : null;
  stroke(border, tk.border.casing, tk.border.casingAlpha, tk.border.casingWidth);
  stroke(coast, tk.coast.casing, tk.coast.casingAlpha, tk.coast.casingWidth);
  if (stateLines) stroke(stateLines, tk.stateLine.color, tk.stateLine.alpha, tk.stateLine.width);
  stroke(border, tk.border.color, tk.border.alpha, tk.border.width);
  stroke(coast, tk.coast.color, tk.coast.alpha, tk.coast.width);
  ctx.globalAlpha = 1;
}
