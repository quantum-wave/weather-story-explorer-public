// The Storms and rain lens (DESIGN-SPEC 6.1, W4-05): six-hour rain in the ECMWF bands (REF-28) from 0.1 mm, under sea-level
// pressure isobars every 4 hPa with two-digit labels (1000 and 1020 drawn heavier), and H and L at the centres of closed isobars.
// The fill, the lines and their labels are drawn by render/compose.js from this descriptor; `labels` lays out and draws the H and
// L in compose's label pass, over the isobars and the coast and border linework. The legend text and the mm / in switch come
// from palette.legendSpec('tp6'); the readout words from `describe`.
import { PALETTES } from '../render/palette.js';
import { VIEWS } from '../contract.js';
import * as data from '../data/index.js';
import { avoidRects, MAP_CONTROLS } from './jet.js';

/** msl is stored in Pa: 400 Pa is 4 hPa. 1000 and 1020 hPa are bold. */
export const ISOBAR_STEP_PA = 400;

/** "1008" -> "08", "996" -> "96": isobar labels are the last two digits (a forecaster reads 08 as 1008). */
export const isobarLabel = (text) => String(Math.round(Number(text))).slice(-2).padStart(2, '0');

/** Significance rules for a centre (a forecaster's H and L: a handful of systems, not every dimple of the grid). */
export const CENTRE_RULES = {
  minDepthPa: 400,   // a full 4 hPa isobar closes round it: the first drawn contour at least 4 hPa above the low's value (below the high's)
  minAreaKm2: 1.0e6, // the region inside that isobar covers at least this much ground (about 1000 km across, a synoptic system): smaller is a dimple, not a system
  minLat: 15,        // nearer the equator than this a pressure centre is not a weather system (no geostrophic balance, only tides and noise)
  minSepKm: 1500,    // two marks of one kind are at least this far apart (the more significant one stays)
};
const R_KM = 6371;
const kmBetween = (lon1, lat1, lon2, lat2) => {
  const r = Math.PI / 180, a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
};

/**
 * Centres of closed isobars in a pressure grid `vals` (Pa, row-major over domain `dom`): [{kind: 'L' | 'H', i, j, lon, lat, value,
 * depth, areaKm2}]. A node is a centre only when it is the lowest (highest) node of a region that a drawn isobar closes: the
 * region of nodes below (above) the first 4 hPa level at least `minDepthPa` above (below) the node, grown from it, must stay
 * inside the grid and short of missing data, hold no deeper node (that one is the system's centre, not this), and cover
 * `minAreaKm2`. A minimum in an open trough, on the edge of a regional grid, beside missing data, or a dimple of a larger system has
 * no such isobar and is not marked, and neither is one within `minLat` degrees of the equator. Of the centres left, two of one
 * kind closer than `minSepKm` leave only the deeper (higher). The result depends on `vals` and `dom` alone, so the marks on the
 * map are the same whatever else happens to be loaded.
 */
export function pressureCentres(vals, dom, opts = {}) {
  const { step = ISOBAR_STEP_PA, maxFraction = 0.6 } = opts;
  const { minDepthPa, minAreaKm2, minSepKm, minLat } = { ...CENTRE_RULES, ...opts };
  const { nx, ny } = dom, ring = Math.abs(dom.dlon) * (nx - 1) >= 360 - 1e-6, cols = ring ? nx - 1 : nx;
  const colOf = (i) => (ring ? ((i % cols) + cols) % cols : i);
  const at = (i, j) => vals[j * nx + colOf(i)];
  const cellKm2 = (j) => { const lat = dom.lat0 + j * dom.dlat; return (111.2 * Math.abs(dom.dlat)) * (111.2 * Math.abs(dom.dlon) * Math.max(0.05, Math.cos(lat * Math.PI / 180))); };
  const out = [];
  const stamp = new Int32Array(nx * ny); let stampId = 0;
  const stack = new Int32Array(nx * ny);
  for (const [kind, sgn] of [['L', 1], ['H', -1]]) {
    const cand = [];
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 0; i < cols; i++) {
        const v = sgn * at(i, j);
        if (!Number.isFinite(v)) continue;
        let isMin = true;
        for (let dj = -1; dj <= 1 && isMin; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue;
            const ni = i + di;
            if (!ring && (ni < 0 || ni >= nx)) { isMin = false; break; }
            const w = sgn * at(ni, j + dj);
            if (!Number.isFinite(w)) { isMin = false; break; }
            // ties: the lower-indexed node of a plateau wins
            if (w < v || (w === v && (j + dj) * nx + colOf(ni) < j * nx + i)) { isMin = false; break; }
          }
        }
        if (isMin) cand.push({ i, j, w: v });
      }
    }
    cand.sort((a, b) => a.w - b.w);
    const kept = [];
    for (const c of cand) {
      if (Math.abs(dom.lat0 + c.j * dom.dlat) < minLat) continue;
      // The region below a drawn isobar, grown from the node: clean when it stays inside the grid, short of missing data and the
      // size cap, and holds no deeper node. Clean at the first drawn level at least minDepthPa up, and then at as many of the next
      // three as it stays clean for: the outermost clean isobar measures the system's extent (a tight, deep low is still a system).
      const start = c.j * nx + c.i;
      const grow = (level) => {
        stampId++;
        let top = 0, area = 0, count = 0;
        stamp[start] = stampId; stack[top++] = start;
        while (top) {
          const k = stack[--top], i = k % nx, j = (k - i) / nx; count++; area += cellKm2(j);
          if (count > maxFraction * nx * ny) return null; // a broad low: no isobar of this size closes round one centre
          if (j === 0 || j === ny - 1 || (!ring && (i === 0 || i === nx - 1))) return null; // the region reaches the grid edge: no closed isobar
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ni = colOf(i + di), nj = j + dj, nk = nj * nx + ni, w = sgn * vals[nk];
            if (!Number.isFinite(w)) return null; // missing data inside: the isobar is not known to close
            if (w < level && stamp[nk] !== stampId) {
              if (w < c.w) return null; // a deeper node inside the same closed isobar is the system's centre
              stamp[nk] = stampId; stack[top++] = nk;
            }
          }
        }
        return area;
      };
      const first = Math.ceil((c.w + minDepthPa) / step) * step;
      let level = first, area = grow(level);
      if (area === null) continue;
      for (let k = 0; k < 3; k++) { const a2 = grow(level + step); if (a2 === null) break; level += step; area = a2; }
      if (area < minAreaKm2) continue;
      const lon = ((dom.lon0 + c.i * dom.dlon + 180) % 360 + 360) % 360 - 180, lat = dom.lat0 + c.j * dom.dlat;
      if (kept.some((k) => kmBetween(k.lon, k.lat, lon, lat) < minSepKm)) continue;
      kept.push({ kind, i: c.i, j: c.j, lon, lat, value: vals[start], depth: (level - c.w) / 100, areaKm2: Math.round(area) });
    }
    out.push(...kept);
  }
  return out;
}

// ---- marks (H and L) ----
// The letters and their values are type, so they go in the label pass, over the isobars and the coast and border linework (a
// coastline through the "1" of 1004 reads "004"). Each glyph carries a solid knockout halo, wider than the contour labels' because
// the letter is larger: no line shows through a letter or between two digits. The value sits below the letter, or above, right or
// left of it when below would run into the place label, the legend or tools, the frame edge or another mark.
const MARK = {
  paper: { L: '#B3261E', H: '#1D4FD7' },
  night: { L: '#FF8F8A', H: '#9DBCFF' },
};
const FAMILY = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
export const MARK_FONT = { letter: `700 22px ${FAMILY}`, value: `600 12px ${FAMILY}` };
export const MARK_HALO = { letter: 6, value: 5 }; // stroke widths: 3 px and 2.5 px of knockout round each glyph
// cap heights (px) of the two faces at their sizes: the boxes hug the glyphs; textBaseline 'middle' centres them on y
const MARK_FONT_CAP = { letter: 16, value: 9 };
const EDGE = 18; // a centre closer than this to the frame's edge is not marked
// The focus label (ui/focus.js focusLabelOverlay, drawn over the map after this): 600 13px, 17 px right of the place, centred on it
const FOCUS = { font: '600 13px -apple-system, "SF Pro Text", system-ui, sans-serif', dx: 17, ring: 11 };
let lastMarks = [];
/** The H and L the last draw placed: [{kind, lon, lat, value, x, y, text, vx, vy, boxes}] (for tests and the readout). */
export const lastDrawn = () => lastMarks.map((m) => ({ ...m, boxes: m.boxes.map((b) => ({ ...b })) }));
let memo = { key: '', centres: [] };

const hit = (a, b, slack = 0) => a.x - slack < b.x + b.w && b.x - slack < a.x + a.w && a.y - slack < b.y + b.h && b.y - slack < a.y + a.h;
/** Clear air kept round every mark (px): the wider glyph metrics of a Linux browser must not make two boxes touch (2026-11-19 ruling). */
export const MARK_SLACK = 4;

/** Screen boxes the H and L must keep clear of: the focus ring and its city label. */
function focusBoxes(ctx, mv, focus) {
  if (!focus || !Number.isFinite(focus.lon) || !Number.isFinite(focus.lat)) return [];
  const p = mv.project([focus.lon, focus.lat]);
  if (!p) return [];
  const out = [{ x: p[0] - FOCUS.ring, y: p[1] - FOCUS.ring, w: 2 * FOCUS.ring, h: 2 * FOCUS.ring }];
  if (focus.label) {
    ctx.save(); ctx.font = FOCUS.font; const w = ctx.measureText(String(focus.label)).width; ctx.restore();
    out.push({ x: p[0] + FOCUS.dx - 3, y: p[1] - 10, w: w + 6, h: 20 });
  }
  return out;
}

/** Rectangles of the controls shown over the map (the legend, the tools, Reset view...), in the canvas' CSS px. */
function controlRects(mv) {
  if (typeof document === 'undefined') return [];
  const cv = document.getElementById('map'), cr = cv?.getBoundingClientRect();
  if (!cr?.width || Math.abs(mv.W - cr.width) > 2 || Math.abs(mv.H - cr.height) > 2) return []; // a still has no controls on it
  const out = [];
  for (const id of MAP_CONTROLS) {
    const el = document.getElementById(id);
    if (!el || el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (r.width >= 8 && r.height >= 8) out.push({ x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height });
  }
  return out;
}

/**
 * Lay out the H and L for this frame: [{kind, lon, lat, value, x, y, text, vx, vy, boxes: [letter box, value box]}]. `ctx` is used
 * only to measure; `extra` carries {s}. Keep-outs come from the page (jet.js avoidRects: the controls, pins and the focused place).
 */
function placeMarks(ctx, mv, tk, extra = {}) {
  lastMarks = [];
  const s = extra.s, m = data.getManifest();
  if (!s || !m?.fields?.msl) return [];
  const meta = m.fields.msl, want = VIEWS[s.view], domId = meta.domains.includes(want) ? want : meta.domains[0], dom = m.domains[domId];
  const key = `${domId}|${s.t}|${data.dataVersion()}`;
  if (memo.key !== key) {
    // msl alone decides: a rule that read another field (t850a's below-ground mask, say) would change the marks whenever
    // that field happened to load, since this lens never asks for it
    const vals = dom && data.fieldAt('msl', domId, s.t);
    memo = { key: vals ? key : '', centres: vals ? pressureCentres(vals, dom) : [] };
  }
  const W = mv.W, H = mv.H, frame = { x: 2, y: 2, w: W - 4, h: H - 4 };
  const inside = (b) => b.x >= frame.x && b.y >= frame.y && b.x + b.w <= frame.x + frame.w && b.y + b.h <= frame.y + frame.h;
  // the controls over the map hide a letter outright; the values also keep clear of every pin's name and the focused place's label
  const controls = controlRects(mv);
  const keepOut = [...focusBoxes(ctx, mv, s.focus), ...avoidRects(mv)];
  const placed = [];
  ctx.save();
  // the deepest low and the highest high claim their room first
  const order = memo.centres.slice().sort((a, b) => Math.abs(b.value - 101325) - Math.abs(a.value - 101325));
  for (const c of order) {
    const p = mv.project([c.lon, c.lat]);
    if (!p || p[0] < EDGE || p[1] < EDGE || p[0] > W - EDGE || p[1] > H - EDGE) continue;
    ctx.font = MARK_FONT.letter;
    const lw = ctx.measureText(c.kind).width, lh = MARK_FONT_CAP.letter, hl = MARK_HALO.letter / 2;
    const letter = { x: p[0] - lw / 2 - hl, y: p[1] - lh / 2 - hl, w: lw + 2 * hl, h: lh + 2 * hl };
    if (!inside(letter) || controls.some((r) => hit(letter, r, MARK_SLACK))) continue; // under the legend or a map control: not visible, not marked
    // every box already placed (letters and values), the focus ring and its label, the pins and their names keep clear of this letter
    const others = placed.flatMap((q) => q.boxes);
    if (keepOut.some((r) => hit(letter, r, MARK_SLACK)) || others.some((r) => hit(letter, r, MARK_SLACK))) continue;
    const text = String(Math.round(c.value / 100));
    ctx.font = MARK_FONT.value;
    const vw = ctx.measureText(text).width, vh = MARK_FONT_CAP.value, hv = MARK_HALO.value / 2;
    const box = (cx, cy) => ({ x: cx - vw / 2 - hv, y: cy - vh / 2 - hv, w: vw + 2 * hv, h: vh + 2 * hv });
    const gap = 2, dy = letter.h / 2 + gap + (vh / 2 + hv), dx = letter.w / 2 + gap + (vw / 2 + hv);
    const spots = [[0, dy], [0, -dy], [dx, 0], [-dx, 0]].map(([ox, oy]) => ({ cx: p[0] + ox, cy: p[1] + oy, b: box(p[0] + ox, p[1] + oy) }));
    const clear = (b) => inside(b) && !controls.some((r) => hit(b, r, MARK_SLACK)) && !keepOut.some((r) => hit(b, r, MARK_SLACK)) && !others.some((r) => hit(b, r, MARK_SLACK));
    const spot = spots.find((sp) => clear(sp.b));
    if (!spot) continue; // a mark that cannot be placed cleanly, letter and value both, is not drawn: no letter without its pressure
    const item = { kind: c.kind, lon: c.lon, lat: c.lat, value: c.value, x: p[0], y: p[1], text, vx: spot.cx, vy: spot.cy, boxes: [letter, spot.b] };
    placed.push(item);
  }
  ctx.restore();
  lastMarks = placed;
  return placed;
}

/** Draw the laid-out H and L: knockout halo, then ink, letter and value. */
function drawMarks(ctx, items, tk) {
  if (!items?.length) return;
  const ink = MARK[tk.ground] || MARK.paper;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  if ('fontVariantNumeric' in ctx) { try { ctx.fontVariantNumeric = 'tabular-nums'; } catch { /* not supported */ } }
  ctx.strokeStyle = tk.label.halo;
  for (const it of items) {
    ctx.font = MARK_FONT.letter; ctx.lineWidth = MARK_HALO.letter; ctx.strokeText(it.kind, it.x, it.y);
    ctx.fillStyle = ink[it.kind]; ctx.fillText(it.kind, it.x, it.y);
    if (it.text) {
      ctx.font = MARK_FONT.value; ctx.lineWidth = MARK_HALO.value; ctx.strokeText(it.text, it.vx, it.vy);
      ctx.fillStyle = tk.label.ink; ctx.fillText(it.text, it.vx, it.vy);
    }
  }
  ctx.restore();
}

const plainNum = (n, d) => String(Number(n.toFixed(d)));

export default {
  code: 's',
  id: 'surface',
  name: 'Storms and rain',
  blurb: 'Where it rains, and the highs and lows steering it',
  implemented: true,
  /** Drawable when this run has rain and sea-level pressure. */
  available(manifest) {
    return manifest?.fields?.tp6 && manifest?.fields?.msl ? { ok: true } : { ok: false, reason: 'Not in this run' };
  },
  fill: { field: 'tp6', palette: 'tp6' },
  // msl is stored in Pa: a level every 400 Pa is every 4 hPa; 1000 and 1020 hPa are heavier; every isobar carries a two-digit label.
  lines: [{ field: 'msl', step: ISOBAR_STEP_PA, bold: [100000, 102000], labelEvery: ISOBAR_STEP_PA, unit: 0.01, style: 'contour', labelText: isobarLabel }],
  // H and L are type: compose.js draws them in the label pass, over every line (see placeMarks). labelBoxes runs first so the
  // isobar labels give way to them; labels lays them out again (the same inputs give the same layout) and draws them.
  labelBoxes(ctx, mv, tk, info) { return placeMarks(ctx, mv, tk, info).flatMap((it) => it.boxes); },
  labels(ctx, mv, _sample, tk, info) { drawMarks(ctx, placeMarks(ctx, mv, tk, info), tk); },
  guide: {
    answer: 'This is the weather at ground level: where rain is expected in each 6 hours (the colour) and the pressure pattern that drives it (the thin lines, called isobars).',
    what: 'The colour is rain expected to fall in the 6 hours before the time shown, from a trace of 0.1 mm up. The lines join places with the same sea-level pressure, one every 4 hPa. L marks the centre of a low-pressure system, H a high.',
    read: 'Rain gathers around lows and their fronts, where air is rising. Lines packed close together mean strong wind; far apart means light wind. Winds spiral counter-clockwise into a low and clockwise out of a high in the northern hemisphere. Labels are the last two digits: 08 is 1008 hPa, 96 is 996.',
    worth: [
      'The heavier lines are 1000 and 1020 hPa, so you can tell a deep low from an ordinary one at a glance.',
      'A letter is drawn only where a ring of lines closes round the centre; a stretch of low pressure that runs off the map has no L. Only the main systems are lettered: a small or shallow ring, one near a deeper centre of its kind, or one near the equator has no H or L.',
      'Rain is shown in 6-hour totals, not an hourly rate: 10 mm in 6 hours is a steady heavy rain.',
    ],
  },
  /** Readout words for 6-hour rain in mm: "0.8 mm in 6 h · light rain". `extra` may carry {units: 'us' | 'metric', msl: Pa}. */
  describe(value, extra = {}) {
    const us = extra.units === 'us';
    let words;
    if (!Number.isFinite(value)) words = '';
    else if (value < 0.1) words = `dry · under ${us ? '0.004 in' : '0.1 mm'} in 6 h`;
    else words = PALETTES.tp6.describe(value, extra);
    if (Number.isFinite(extra.msl)) words += `${words ? ' · ' : ''}${plainNum(extra.msl / 100, 0)} hPa`;
    return words;
  },
};
