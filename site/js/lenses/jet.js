// The Jet stream lens (DESIGN-SPEC 6.1, REFERENCES REF-22 and REF-23; Josh points 11 and 15): the 250 hPa wind speed in ECMWF's
// yellow-to-green 200 hPa bands from 30 m/s with no fade-in, isotachs at 36, 46, 57 and 67 m/s (70, 90, 110 and 130 kt, the US
// convention), and the 500 hPa height lines in grey for context. The fill and its palette are the registry's (compose draws them);
// the isotachs and the grey lines are this lens' marks, drawn after the fill and before the coast, so nothing here changes how the
// fill is painted. The helpers at the bottom are shared with the Confidence lens.
import * as data from '../data/index.js';
import { isMultiCase, caseForLens } from '../data/kind.js';
import { store } from '../state.js';
import { VIEWS } from '../contract.js';
import { isDefaultXf } from '../render/view.js';
import { PALETTES } from '../render/palette.js';
import { isolines, labelSpots } from '../render/isolines.js';
import { refine2x } from '../render/sample.js';
import { chartTokens } from '../render/chart-tokens.js';
import { FONT_CHART } from '../render/theme.js';
import { pins } from '../pins/index.js';

/** The isotach levels in m/s, and the same levels in knots as they are labelled (70 kt is the edge of a jet, NOAA JetStream). */
export const ISOTACHS = Object.freeze([36, 46, 57, 67]);
export const ISOTACH_KT = Object.freeze([70, 90, 110, 130]);

/** Isotach polylines of a ws250 grid (m/s): [{level, lines: [{pts, closed}]}], only the levels the grid reaches. Pure. */
export function isotachLines(vals, dom, nodes, W) {
  // step 1: the nudge that keeps lines apart is a millionth of the step, so a level is not moved by the default 6 dam step
  return isolines(vals, dom, nodes, W, { levels: ISOTACHS, step: 1 });
}

/**
 * Is `field` in this run, and, when `caseId` is given, in that sample case? A multi-case manifest (the synthetic and early sample
 * files) keeps each field in one case; choosing a lens shows the case that holds its field (data/kind.js caseForLens). null manifest or a missing field: not in this run.
 */
export function fieldInRun(manifest, field, caseId) {
  const meta = manifest?.fields?.[field];
  if (!meta) return false;
  if (isMultiCase(manifest) && caseId !== undefined) return meta.case === caseId;
  return true;
}

export default {
  code: 'j',
  id: 'jet',
  name: 'Jet stream',
  blurb: 'The fast river of wind about 10 km up',
  implemented: true,
  /** Drawable when this run has the 250 hPa wind (and, in a multi-case sample, in the case being shown). */
  available(manifest, caseId) {
    return fieldInRun(manifest, 'ws250', caseId) ? { ok: true } : { ok: false, reason: 'Not in this run' };
  },
  fill: { field: 'ws250', palette: 'ws250' },
  // Neither line is style 'contour' (compose draws that one in ink from the lens' first line): both are this lens' marks.
  lines: [
    { field: 'ws250', levels: [36, 46, 57, 67], style: 'isotach', color: '#00724b', width: 1.5, unit: 'kt' },
    { field: 'z500', step: 60, style: 'context' },
  ],
  guide: {
    answer: 'The jet stream is the strip of fast wind high in the atmosphere that steers storms. Here it is the wind speed at the 250 hPa level, about 10 km up, so this map shows where storms are being carried, not where it rains.',
    what: 'Wind speed at the 250 hPa level, about 10 km up. The colours follow ECMWF\'s chart of the 200 hPa wind, a little higher up: yellow from 30 m/s (about 67 mph), then green, darker as the wind gets faster, in 10 m/s steps. Below 30 m/s nothing is shaded.',
    read: 'The yellow-green ribbon is the jet stream; the darker the green, the faster the wind. The dark green lines mark 36, 46, 57 and 67 m/s (70, 90, 110 and 130 knots, the levels US forecasters draw); 36 m/s is the usual edge of a jet. Storms tend to form and travel along the ribbon, strongest where it speeds up. The thin grey lines are the 500 hPa height lines, for position.',
    worth: [
      'Where the ribbon dips south, cold air and storms usually follow; where it bends north, the weather is milder and calmer.',
      'No shading does not mean no wind: it means under 30 m/s.',
    ],
  },
  /** Readout words for a speed in m/s: "35 m/s · strong wind aloft, below jet strength". `extra` may carry {units: 'us'}. */
  describe(value, extra) { return PALETTES.ws250.describe(value, extra); },
  /** Drawn after the coast and border linework (DESIGN-SPEC 15: contour labels come last): the isotach labels in knots. */
  labels(ctx, mv, sample, tk, info) {
    if (!info?.s || info.quality === 'motion') return;
    const { s } = info;
    const iso = polylines('jet-isotach', 'ws250', s, mv, { levels: ISOTACHS, step: 1 }, !!s.playing);
    if (iso) labelIsotachs(ctx, iso.iso, mv, tk);
  },
  /** Drawn after the fill: grey height lines for context (unless Height contours is off), then the isotachs and their labels in knots. */
  marks(ctx, mv, sample, tk, info) {
    if (!info?.s) return;
    const { s, quality } = info;
    const playing = !!s.playing || quality === 'motion';
    if (s.overlays?.contours !== false) {
      const ctxLines = polylines('jet-context', 'z500', s, mv, { step: 60 }, playing);
      if (ctxLines) strokeContext(ctx, ctxLines.iso, tk);
    }
    const iso = polylines('jet-isotach', 'ws250', s, mv, { levels: ISOTACHS, step: 1 }, playing);
    if (iso) {
      strokeIsotachs(ctx, iso.iso, tk);
    }
  },
};

// ---------- shared drawing helpers (also used by confidence.js) ----------

const memo = new Map(); // kind -> {key, viewKey, at, iso}
const asked = new Set();
const CONTOUR_MS = 100; // while playing, the lines of the last computation are reused for 100 ms
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
let refined = { key: '', vals: null, dom: null };

/**
 * Polylines of `field` at the state's time for this view, memoised by view, field, time and data version (a computation is 2 to 8 ms
 * on a global grid). A field that is not loaded yet starts loading and returns null: the data:chunk event redraws the map.
 * Returns {iso, dom} or null.
 */
export function polylines(kind, field, s, mv, opts, playing = false) {
  const m = data.getManifest(), meta = m?.fields?.[field];
  if (!meta || !fieldInRun(m, field, caseForLens(m, s.lens))) return null;
  const want = VIEWS[s.view], domId = meta.domains.includes(want) ? want : meta.domains[0];
  let dom = domId && m.domains[domId], vals = dom && data.fieldAt(field, domId, s.t);
  if (!vals) {
    const k = `${field}|${domId}|${s.t}|${data.dataVersion()}`;
    if (dom && !asked.has(k)) { asked.add(k); data.ensure(field, domId, s.t).catch(() => {}); if (asked.size > 200) asked.clear(); }
    return null;
  }
  let nodesKey = domId;
  if (domId === 'g1' && mv.xf.k > 2) { // a global grid zoomed past 2x: lines on a 2x refined grid (DESIGN-SPEC 4.3)
    const rk = `${field}|${s.t}|${data.dataVersion()}`;
    if (refined.key !== rk) refined = { key: rk, ...refine2x(vals, dom) };
    vals = refined.vals; dom = refined.dom; nodesKey = 'g1x2';
  }
  const lv = opts.levels ? opts.levels.join(',') : `s${opts.step}`;
  const viewKey = `${mv.key}|${nodesKey}|${field}|${lv}`, key = `${viewKey}|${s.t}|${data.dataVersion()}`;
  const hit = memo.get(kind), t0 = nowMs();
  if (hit && hit.key === key) return hit;
  if (hit && playing && hit.viewKey === viewKey && t0 - hit.at < CONTOUR_MS) return hit;
  const out = { key, viewKey, at: t0, dom, iso: isolines(vals, dom, mv.nodes(nodesKey, dom), mv.W, opts) };
  memo.set(kind, out);
  return out;
}

const pathOf = (lines) => {
  const P = new Path2D();
  for (const { pts, closed } of lines) { P.moveTo(pts[0], pts[1]); for (let k = 2; k < pts.length; k += 2) P.lineTo(pts[k], pts[k + 1]); if (closed) P.closePath(); }
  return P;
};

/** The 500 hPa height lines in grey, behind the lens' own marks (the chart token `contextContour`; DESIGN-SPEC 6.1). */
export function strokeContext(ctx, iso, tk) {
  const c = tk.contextContour;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = c.color; ctx.globalAlpha = c.alpha; ctx.lineWidth = c.width;
  for (const L of iso) ctx.stroke(pathOf(L.lines)); // one stroke per level
  ctx.restore();
}

/** The line colour on a ground: Paper uses the lens colour; Night lifts it to the light end of the jet ramp so it clears the dark ground. */
const isotachInk = (tk) => (tk.ground === 'night' ? '#a7e700' : '#00724b');

function strokeIsotachs(ctx, iso, tk) {
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const paths = iso.map((L) => pathOf(L.lines));
  // a thin halo of the ground colour under the core, so the line reads over a band of its own colour
  ctx.strokeStyle = tk.ground === 'night' ? '#0B0D10' : '#FFFFFF'; ctx.globalAlpha = 0.6; ctx.lineWidth = 3.25;
  for (const P of paths) ctx.stroke(P);
  ctx.globalAlpha = 1; ctx.strokeStyle = isotachInk(tk); ctx.lineWidth = 1.5;
  for (const P of paths) ctx.stroke(P);
  ctx.restore();
}

/** The floating map controls by id; with them, every visible element laid over the canvas in its container is kept clear too. */
export const MAP_CONTROLS = Object.freeze(['map-legend', 'legend', 'map-tools', 'btn-reset', 'map-status', 'layers-panel']);
// The Reset view button render/index.js makes when the shell has none (render/index.js syncReset: right 12 px, top 64 px, 44 px tall,
// "Reset view" in 600 13px with 14 px padding). It is shown only after the first frame of a moved view is drawn (commit() draws, then
// emitView() unhides it), so that frame reserves the slot it is about to take: its last seen box, or this one before it was ever seen.
const RESET_SLOT = { right: 12, top: 64, w: 112, h: 44 };
let resetSeen = null; // {dx from the container's right, dy from its top, w, h}

/** Screen rectangles labels keep out of: the legend, the map tools, Reset view and any other control over the map, in the canvas' CSS px. */
export function avoidRects(mv) {
  if (typeof document === 'undefined') return [];
  const cv = document.getElementById('map');
  if (!cv) return [];
  const cr = cv.getBoundingClientRect();
  if (!cr.width || Math.abs(mv.W - cr.width) > 2 || Math.abs(mv.H - cr.height) > 2) return []; // a still has no controls on it
  const out = [], seen = new Set();
  const add = (r) => {
    const x0 = Math.max(r.left, cr.left), y0 = Math.max(r.top, cr.top), x1 = Math.min(r.right, cr.right), y1 = Math.min(r.bottom, cr.bottom);
    if (x1 > x0 && y1 > y0) out.push({ x: x0 - cr.left, y: y0 - cr.top, w: x1 - x0, h: y1 - y0 });
  };
  const shown = (el) => {
    if (!el || el.hidden || el === cv) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) > 0;
  };
  const host = cv.parentElement;
  for (const el of [...MAP_CONTROLS.map((id) => document.getElementById(id)), ...(host ? host.children : [])]) {
    if (!el || seen.has(el) || !shown(el)) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (r.width >= 8 && r.height >= 8) add(r); // an empty status line or a zero-size container keeps nothing clear
  }
  const reset = document.getElementById('btn-reset'), hr = host ? host.getBoundingClientRect() : cr;
  if (reset && shown(reset)) {
    const r = reset.getBoundingClientRect();
    if (r.width && r.height) resetSeen = { dx: hr.right - r.right, dy: r.top - hr.top, w: r.width, h: r.height };
  } else if (mv.xf && !isDefaultXf(mv.xf)) {
    const s = resetSeen || { dx: RESET_SLOT.right, dy: RESET_SLOT.top, w: RESET_SLOT.w, h: RESET_SLOT.h };
    add({ left: hr.right - s.dx - s.w, top: hr.top + s.dy, right: hr.right - s.dx, bottom: hr.top + s.dy + s.h });
  }
  // a pin's dot and its name (drawn to its right, up to about 150 px): a label on a line is not set under one
  try {
    for (const p of pins.all()) {
      const xy = mv.project([p.city.lon, p.city.lat]);
      if (xy) out.push({ x: xy[0] - 14, y: xy[1] - 14, w: 180, h: 28 });
    }
    const f = store.get().focus, xy = f && Number.isFinite(f.lat) ? mv.project([f.lon, f.lat]) : null; // the focused place and its name
    if (xy) out.push({ x: xy[0] - 14, y: xy[1] - 14, w: 200, h: 28 });
  } catch { /* pins not ready: nothing to keep clear of */ }
  return out;
}

/** Text on a line: the line is cleared under the label box (ground colour), then ink on a halo, set along the line, upright. `rows` sets it on several rows. */
export function drawLabelSpots(ctx, spots, tk) {
  if (!spots.length) return;
  ctx.save();
  ctx.font = FONT_CHART; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (const sp of spots) {
    ctx.save(); ctx.translate(sp.x, sp.y); ctx.rotate(sp.angle);
    const rows = sp.rows || [sp.text], lh = 13, top = -(rows.length - 1) * lh / 2;
    const hw = Math.max(...rows.map((r) => ctx.measureText(r).width)) / 2 + 3;
    ctx.fillStyle = tk.label.halo; ctx.fillRect(-hw, top - 8, 2 * hw, 16 + (rows.length - 1) * lh); // nothing shows through the gaps between the words
    rows.forEach((r, i) => {
      ctx.lineWidth = tk.label.haloWidth; ctx.strokeStyle = tk.label.halo; ctx.strokeText(r, 0, top + i * lh);
      ctx.fillStyle = sp.ink || tk.label.ink; ctx.fillText(r, 0, top + i * lh);
    });
    ctx.restore();
  }
  ctx.restore();
}

function labelIsotachs(ctx, iso, mv, tk) {
  // labelSpots reads a level's last digits; feeding it the knots makes the text "70", "90", "110", "130" and the suffix is added here.
  // Every level in view is labelled once before any level gets a second label: the rarest (130 kt) first, so the 70 kt line
  // does not take every spot. Labels of different levels keep 130 px apart in the first round, any two labels 260 px in the second.
  const kt = iso.map((L) => ({ level: ISOTACH_KT[ISOTACHS.indexOf(L.level)], lines: L.lines })).sort((a, b) => b.level - a.level);
  const avoid = avoidRects(mv), spots = [];
  const base = { avoid, unit: 1, every: 10, bold: [], charW: 14, straight: 0.97, maxDev: 4 };
  for (let round = 0; round < 2; round++) {
    for (const L of kt) {
      const got = labelSpots([L], mv.W, mv.H, { ...base, minGap: round === 0 ? 130 : 260, taken: spots, max: 1 });
      for (const g of got) spots.push({ ...g, level: L.level });
    }
  }
  drawLabelSpots(ctx, spots.map((sp) => ({ ...sp, text: `${sp.text} kt`, ink: isotachInk(chartTokens(tk.ground)) })), tk);
}
