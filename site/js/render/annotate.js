// Ridge and trough annotations (DESIGN-SPEC 4.5): the chart labels its own main features, as a forecaster does by hand.
//   - Local extrema of the anomaly with magnitude of at least 12 dam, found on a 4 degree decimation of the pattern field.
//   - At most three ridges and three troughs in view (two of each on a phone at zoom 1), at least 1,500 km AND 120 screen px apart.
//   - Not drawn where the no-clear-signal rule holds at the extremum, and never over a higher-priority label (a contour label, a
//     control or the legend): a plate that would touch one is dropped, the next candidate takes the slot.
//   - Tracked between frames: the nearest previous label of the same kind within 800 km keeps its identity and eases to the new place.
// The finding, selecting and tracking parts are pure (no DOM) so tests drive them with plain arrays; `draw` is the only part that
// reads the data client and the canvas. compose calls `draw` after the contour labels (section 15).
import * as data from '../data/index.js';
import { VIEWS } from '../contract.js';
import { signalAt } from '../story/confidence.js';

export const MIN_DAM = 12;
export const DECIMATE_DEG = 4;
export const MIN_KM = 1500;
export const MIN_PX = 120;
export const KEEP_KM = 800;
const SLACK = 6; // px of room kept around every keep-out rectangle (the checks in tests ask for 4)
export const CAP = Object.freeze({ default: 3, phone: 2 });
const R_KM = 6371;
const RAD = Math.PI / 180;
const FONT_UI = '-apple-system, "SF Pro Text", system-ui, sans-serif';

/** Great-circle distance in km between [lon, lat] points. */
export function distKm(a, b) {
  const la = a[1] * RAD, lb = b[1] * RAD, dl = (b[0] - a[0]) * RAD;
  const c = Math.sin(la) * Math.sin(lb) + Math.cos(la) * Math.cos(lb) * Math.cos(dl);
  return R_KM * Math.acos(Math.max(-1, Math.min(1, c)));
}

/**
 * Local extrema of a field on a 4 degree decimation. `vals` is the domain's Float32Array (metres; NaN = no data), `dom` the manifest
 * domain {nx, ny, lon0, lat0, dlon, dlat}, `unit` converts a stored value to dam (0.1). A node is an extremum when it is the strict
 * maximum (or minimum) of its decimated 3 x 3 neighbourhood (ties go to the first in scan order) and at least `minDam` from zero.
 * `spread(i, j)` may return the ensemble spread in dam at a node (or NaN), for the no-clear-signal rule.
 * @returns {{lon:number, lat:number, dam:number, kind:'ridge'|'trough', spread:number, signal:'clear'|'none'}[]}
 */
export function findExtrema(vals, dom, { unit = 0.1, minDam = MIN_DAM, spread = null } = {}) {
  if (!vals || !dom) return [];
  const si = Math.max(1, Math.round(DECIMATE_DEG / Math.abs(dom.dlon))), sj = Math.max(1, Math.round(DECIMATE_DEG / Math.abs(dom.dlat)));
  const nI = Math.floor((dom.nx - 1) / si) + 1, nJ = Math.floor((dom.ny - 1) / sj) + 1;
  const wrap = Math.abs(dom.dlon) * dom.nx >= 359.99; // a global grid closes on itself in longitude
  const at = (a, b) => { // decimated coordinates -> value in dam, NaN off the grid
    if (b < 0 || b >= nJ) return NaN;
    if (a < 0 || a >= nI) { if (!wrap) return NaN; a = ((a % nI) + nI) % nI; }
    const v = vals[(b * sj) * dom.nx + a * si];
    return Number.isFinite(v) ? v * unit : NaN;
  };
  const out = [];
  for (let b = 0; b < nJ; b++) {
    const lat = dom.lat0 + b * sj * dom.dlat;
    if (Math.abs(lat) > 85) continue;
    for (let a = 0; a < nI; a++) {
      const v = at(a, b);
      if (!Number.isFinite(v) || Math.abs(v) < minDam) continue;
      let max = true, min = true;
      for (let db = -1; db <= 1 && (max || min); db++) for (let da = -1; da <= 1; da++) {
        if (!da && !db) continue;
        const w = at(a + da, b + db);
        if (!Number.isFinite(w)) { if (b + db < 0 || b + db >= nJ || a + da < 0 || a + da >= nI) continue; max = min = false; break; } // a hole inside the grid: not an extremum we can vouch for; the grid's own edge is no neighbour
        const earlier = db < 0 || (db === 0 && da < 0); // ties go to the first node in scan order
        if (w > v || (w === v && earlier)) max = false;
        if (w < v || (w === v && earlier)) min = false;
      }
      if (!(v > 0 ? max : min)) continue;
      const lon = (((dom.lon0 + a * si * dom.dlon + 180) % 360) + 360) % 360 - 180;
      const sp = spread ? spread(a * si, b * sj) : NaN;
      out.push({ lon, lat, dam: v, kind: v > 0 ? 'ridge' : 'trough', spread: sp, signal: signalAt({ anomDam: v, spreadDam: sp, hasSpread: Number.isFinite(sp) }) });
    }
  }
  return out;
}

/** The cap per kind: three, or two on a phone-width frame at zoom 1. */
export const capFor = (W, k = 1) => (W <= 600 && k <= 1.05 ? CAP.phone : CAP.default);

/**
 * Choose which extrema get a label. `cands` come from findExtrema; `project([lon, lat])` gives screen px or null (far side).
 * Dropped: where the signal is none; off screen (a 4 px margin keeps a plate whole); under a `blocked` rectangle {x, y, w, h} (the
 * legend, the tools, higher-priority labels); too close to an earlier pick. Strongest first, at most `cap` of each kind, every pair of
 * kept labels at least `minKm` and `minPx` apart.
 * @returns {{lon,lat,dam,kind,x,y}[]}
 */
export function selectLabels(cands, project, { W, H, cap = CAP.default, blocked = [], plate = { w: 76, h: 34 }, minKm = MIN_KM, minPx = MIN_PX } = {}) {
  const sorted = cands.filter((c) => c.signal !== 'none').sort((a, b) => Math.abs(b.dam) - Math.abs(a.dam));
  const kept = [], count = { ridge: 0, trough: 0 };
  for (const c of sorted) {
    if (count[c.kind] >= cap) continue;
    const p = project([c.lon, c.lat]);
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const box = { x: p[0] - plate.w / 2, y: p[1] - plate.h / 2, w: plate.w, h: plate.h };
    if (box.x < 4 || box.y < 4 || box.x + box.w > W - 4 || box.y + box.h > H - 4) continue;
    if (blocked.some((r) => box.x < r.x + r.w && box.x + box.w > r.x && box.y < r.y + r.h && box.y + box.h > r.y)) continue;
    if (kept.some((k) => distKm([k.lon, k.lat], [c.lon, c.lat]) < minKm || Math.hypot(k.x - p[0], k.y - p[1]) < minPx)) continue;
    kept.push({ ...c, x: p[0], y: p[1] });
    count[c.kind]++;
  }
  return kept;
}

/**
 * Identity across frames. `update(picked)` matches each pick to the nearest previous label of the same kind within 800 km (greedy,
 * closest pairs first), gives it that label's id, and returns {id, kind, lon, lat (eased), pick}: `ease` is the share of the way to
 * the new place covered each frame (1 = no easing); `update(picked, {snap: true})` puts every plate on its place at once (a still map). A pick with no match gets a new id; a previous label with no pick is dropped.
 */
export function createTracker({ ease = 0.35, keepKm = KEEP_KM } = {}) {
  let prev = []; // {id, kind, lon, lat (displayed), tlon, tlat (target)}
  let next = 1;
  const wrapLon = (x) => ((((x + 180) % 360) + 360) % 360) - 180;
  return {
    update(picked, { snap = false } = {}) {
      const pairs = [];
      picked.forEach((p, i) => prev.forEach((q, j) => { if (q.kind === p.kind) { const d = distKm([q.tlon, q.tlat], [p.lon, p.lat]); if (d <= keepKm) pairs.push({ i, j, d }); } }));
      pairs.sort((a, b) => a.d - b.d);
      const takenI = new Set(), takenJ = new Set(), match = new Map();
      for (const { i, j } of pairs) { if (takenI.has(i) || takenJ.has(j)) continue; takenI.add(i); takenJ.add(j); match.set(i, prev[j]); }
      const out = picked.map((p, i) => {
        const q = match.get(i);
        if (!q) return { id: next++, kind: p.kind, lon: p.lon, lat: p.lat, tlon: p.lon, tlat: p.lat, pick: p };
        const e = snap ? 1 : ease;
        return { id: q.id, kind: p.kind, lon: e >= 1 ? p.lon : wrapLon(q.lon + wrapLon(p.lon - q.lon) * e), lat: e >= 1 ? p.lat : q.lat + (p.lat - q.lat) * e, tlon: p.lon, tlat: p.lat, pick: p };
      });
      prev = out.map((o) => ({ id: o.id, kind: o.kind, lon: o.lon, lat: o.lat, tlon: o.tlon, tlat: o.tlat }));
      return out;
    },
    /** Put label `id` exactly on its target (a plate that must not sit at an eased place). */
    snap(id) { const q = prev.find((o) => o.id === id); if (q) { q.lon = q.tlon; q.lat = q.tlat; } },
    reset() { prev = []; },
  };
}

const signedDam = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))} dam`;
/** The plate's two lines: "RIDGE" or "TROUGH", then the value ("+18 dam"). */
export const plateText = (kind, dam) => [kind === 'ridge' ? 'RIDGE' : 'TROUGH', signedDam(dam)];

const tracker = createTracker();
let memo = { key: '', cands: [] };
/** What the last draw put on screen, for tests and the debug hook: [{id, kind, dam, lon, lat, x, y, w, h}]. */
export let shown = [];
const drawnListeners = new Set();
/** Call `fn()` after a draw that left a different set of plates (positions to the pixel) than the one before; returns the way to stop. */
export function onPlatesChanged(fn) { drawnListeners.add(fn); return () => drawnListeners.delete(fn); }
let shownKey = '';
const notePlates = () => { const k = shown.map((q) => `${q.id}@${Math.round(q.x)},${Math.round(q.y)}`).join('|'); if (k === shownKey) return; shownKey = k; for (const fn of drawnListeners) { try { fn(); } catch { /* a listener never stops the draw */ } } };
/** The inputs of the last draw's selection (every candidate with its signal, the keep-out rectangles, the cap and the frame), for tests. */
export let lastDraw = { cands: [], blocked: [], cap: 0, W: 0, H: 0 };

/** True for the Pattern lens (the lens plan's fill is the 500 hPa anomaly). */
const patternOn = (p) => p?.anom?.field === 'z500a' && (p.lens === 'z' || p.lens == null);

/**
 * Draw the plates for the active lens. `opts`: {s, ground, tokens, plan, taken (contour label spots {x, y, text}, which win),
 * avoid (rectangles to keep out of)}. A no-op for any lens but Pattern, and when the overlay "Ridge and trough labels" is off
 * (`s.overlays.marks === false`, the store key the Layers switch writes).
 */
export function draw(ctx, mv, opts = {}) {
  const { s, tokens: tk, plan } = opts;
  shown = [];
  if (!s || !tk || !patternOn(plan) || s.overlays?.marks === false) { tracker.reset(); notePlates(); return; }
  const m = data.getManifest();
  const want = VIEWS[s.view], meta = m?.fields?.z500a;
  const domId = meta ? (meta.domains.includes(want) ? want : meta.domains[0]) : null, dom = domId && m.domains[domId];
  const vals = dom && data.fieldAt('z500a', domId, s.t);
  if (!vals) { notePlates(); return; }
  // Pattern only (patternOn), so the field and its sample case are fixed: the domain, the time and the data version identify the grid
  const key = `${domId}|${s.t}|${data.dataVersion()}`;
  if (memo.key !== key) {
    let sd = null;
    if (m.fields.z500sd?.domains.includes(domId)) { const arr = data.fieldAt('z500sd', domId, s.t); if (arr) sd = (i, j) => arr[j * dom.nx + i] * 0.1; }
    memo = { key, cands: findExtrema(vals, dom, { unit: 0.1, spread: sd }) };
  }
  const blocked = [...(opts.avoid || [])];
  const pad = (r) => ({ x: r.x - SLACK, y: r.y - SLACK, w: r.w + 2 * SLACK, h: r.h + 2 * SLACK });
  blocked.splice(0, blocked.length, ...blocked.map(pad)); // at least 4 px of slack around every keep-out rectangle
  for (const sp of opts.taken || []) { const r = Math.hypot(String(sp.text).length * 7 + 6, 17) / 2; blocked.push({ x: sp.x - r, y: sp.y - r, w: 2 * r, h: 2 * r }); }
  // the focused place's pin and name are drawn after these plates: they win the spot
  const f = s.focus && Number.isFinite(s.focus.lat) && Number.isFinite(s.focus.lon) ? mv.project([s.focus.lon, s.focus.lat]) : null;
  if (f) {
    // the ring and, 17 px to its right, the name in a 13 px 600 face (ui/focus.js focusLabelOverlay): the box is the name's measured width
    ctx.save(); ctx.font = `600 13px ${FONT_UI}`; if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    const nameW = s.focus.label ? ctx.measureText(String(s.focus.label)).width : 0; ctx.restore();
    blocked.push({ x: f[0] - 16, y: f[1] - 16, w: Math.max(32, 17 + nameW + 6 + 16), h: 32 });
  }
  const picked = selectLabels(memo.cands, (ll) => mv.project(ll), { W: mv.W, H: mv.H, cap: capFor(mv.W, mv.xf?.k ?? 1), blocked });
  lastDraw = { cands: memo.cands, blocked, cap: capFor(mv.W, mv.xf?.k ?? 1), W: mv.W, H: mv.H };
  const tracked = tracker.update(picked, { snap: opts.settle === true }); // at rest plates stand on their picks; while moving they ease
  // the checks that ran on the picks run again on what is drawn: an eased plate that would touch a keep-out rectangle, leave the
  // frame, or come within 120 px of another drawn plate is put on its pick, which passed them
  const sizeOf = (t) => { const [a, b] = plateText(t.kind, t.pick.dam); ctx.save(); ctx.font = `700 10px ${FONT_UI}`; if ('letterSpacing' in ctx) ctx.letterSpacing = '1.2px'; const wA = ctx.measureText(a).width; ctx.font = `600 12px ${FONT_UI}`; if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; const wB = ctx.measureText(b).width; ctx.restore(); return { w: Math.max(wA, wB) + 14, h: 32 }; };
  const hits = (t, p, w, h) => { const x = p[0] - w / 2, y = p[1] - h / 2; return x < 4 || y < 4 || x + w > mv.W - 4 || y + h > mv.H - 4 || blocked.some((r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y); };
  const spots = tracked.map((t) => { const { w, h } = sizeOf(t); return { t, w, h, p: mv.project([t.lon, t.lat]) }; });
  const bad = spots.some((o, i) => (o.t.lon !== o.t.pick.lon || o.t.lat !== o.t.pick.lat) && (!o.p || hits(o.t, o.p, o.w, o.h)))
    || spots.some((o, i) => spots.some((q, j) => j > i && o.p && q.p && Math.hypot(o.p[0] - q.p[0], o.p[1] - q.p[1]) < MIN_PX));
  if (bad) for (const t of tracked) { tracker.snap(t.id); t.lon = t.pick.lon; t.lat = t.pick.lat; } // the picks passed every rule
  const night = tk.ground === 'night';
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const face = (px, wt, track) => { ctx.font = `${wt} ${px}px ${FONT_UI}`; if ('letterSpacing' in ctx) ctx.letterSpacing = track; };
  for (const t of tracked) {
    const p = mv.project([t.lon, t.lat]);
    if (!p) continue;
    const [a, b] = plateText(t.kind, t.pick.dam);
    face(10, 700, '1.2px'); const wA = ctx.measureText(a).width;
    face(12, 600, '0px'); const wB = ctx.measureText(b).width;
    const w = Math.max(wA, wB) + 14, h = 32, x0 = p[0] - w / 2, y0 = p[1] - h / 2;
    ctx.fillStyle = night ? 'rgba(18,22,27,0.78)' : 'rgba(246,247,249,0.84)';
    ctx.strokeStyle = night ? 'rgba(230,233,237,0.4)' : 'rgba(17,20,23,0.34)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x0, y0, w, h, 6); else ctx.rect(x0, y0, w, h);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = tk.label.ink;
    face(10, 700, '1.2px'); ctx.fillText(a, p[0], p[1] - 7);
    face(12, 600, '0px'); ctx.fillText(b, p[0], p[1] + 7);
    shown.push({ id: t.id, kind: t.kind, dam: t.pick.dam, lon: t.lon, lat: t.lat, x: p[0], y: p[1], w, h });
  }
  ctx.restore();
  notePlates();
}
