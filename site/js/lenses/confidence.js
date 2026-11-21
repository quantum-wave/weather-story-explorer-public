// The Confidence lens (DESIGN-SPEC 6.1, 5.5; Josh point 8, "how confident are we"): the ensemble spread of the 500 hPa height drawn as
// bands (paper to slate-violet at 2, 4, 6, 8 and 12 dam), the height lines in grey for context, and the 6 dam spread line emphasised
// and labelled "one contour's worth of doubt". The fill is the spread itself, so the Pattern lens' doubt hatch is not drawn here.
// The MVP's Confidence toggle drew nothing; this one draws exactly what it says, or is not offered ("Not in this run").
import { PALETTES } from '../render/palette.js';
import { labelSpots } from '../render/isolines.js';
import { FONT_CHART } from '../render/theme.js';
import { fieldInRun, polylines, strokeContext, avoidRects, drawLabelSpots } from './jet.js';

/** 6 dam in the field's own units (z500sd is stored in whole metres, gpm): the height line interval, one contour's worth. */
export const SPREAD_LINE_GPM = 60;
export const SPREAD_LABEL = "one contour's worth of doubt";

export default {
  code: 'c',
  id: 'confidence',
  name: 'Confidence',
  blurb: 'Where the forecasts agree and where they do not',
  implemented: true,
  /** Drawable when this run carries the spread (a partial build does not), in the sample case being shown. */
  available(manifest, caseId) {
    return fieldInRun(manifest, 'z500sd', caseId) ? { ok: true } : { ok: false, reason: 'Not in this run' };
  },
  fill: { field: 'z500sd', palette: 'z500sd' },
  // Neither line is style 'contour' (compose draws that one in ink): both are this lens' marks.
  lines: [
    { field: 'z500', step: 60, style: 'context' },
    { field: 'z500sd', levels: [60], style: 'spread-line', width: 2.5, label: "one contour's worth of doubt" },
  ],
  guide: {
    answer: 'This map is not the weather. It shows how much the forecasts disagree with each other about the pressure pattern: pale where they agree, darker where they do not. The wider the disagreement, the less to lean on the pattern there.',
    what: 'The spread of the forecast ensemble: many runs of the same model, each started from a slightly different picture of today. The colour is how far apart their 500 hPa heights are, in tens of metres (dam). Pale means the runs sit together; deep slate-violet means they scatter.',
    read: 'Pale: the forecasts agree closely, so the pattern is a good guide. Darker: they disagree, and the Pattern map is hatched there. The thick line marks 6 dam of spread, one contour\'s worth of doubt: where the spread is past it, the runs disagree by more than the gap between two height lines. The thin grey lines are the 500 hPa height lines, for position.',
    worth: [
      'Spread grows with lead time, so the map darkens as you move later in the week. Beyond about a week most of the map is past the thick line.',
      'Agreement is not accuracy: the runs can agree and still be wrong, which is why a pale map is a better sign than a promise.',
    ],
  },
  /** Readout words for a spread in dam: "7 dam · forecasts disagree". */
  describe(value, extra) { return PALETTES.z500sd.describe(value, extra); },
  /** Drawn after the coast and border linework (DESIGN-SPEC 15): the one teaching label, on a straight stretch of the 6 dam line. */
  labels(ctx, mv, sample, tk, info) {
    if (!info?.s || info.quality === 'motion') return;
    const sp = polylines('conf-spread', 'z500sd', info.s, mv, { levels: [SPREAD_LINE_GPM], step: 1 }, !!info.s.playing);
    if (!sp || !sp.iso.length) return;
    const lines = sp.iso.map((L) => ({ level: 60, lines: L.lines }));
    const width = (t) => { ctx.save(); ctx.font = FONT_CHART; const w = ctx.measureText(t).width; ctx.restore(); return w; };
    // a long label needs a long straight run: strictest first, then relaxed a little, never past 0.975 or 6 px off the chord
    const avoid = avoidRects(mv);
    const place = (w, rungs) => {
      for (const [straight, maxDev] of rungs) {
        const got = labelSpots(lines, mv.W, mv.H, { minGap: Math.max(360, mv.W * 0.6), avoid, unit: 10, every: 6, bold: [], charW: w + 2, straight, maxDev });
        if (got.length) return got;
      }
      return [];
    };
    const ONE_ROW = [[0.99, 4], [0.985, 4], [0.975, 6]];
    // two rows are 29 px tall, so a stretch up to 7 px off its chord still enters and leaves the cleared box through its sides
    const TWO_ROWS = [...ONE_ROW, [0.96, 7]];
    const mid = SPREAD_LABEL.length / 2, cuts = [...SPREAD_LABEL].flatMap((c, i) => (c === ' ' ? [i] : []));
    const cut = cuts.reduce((best, i) => (Math.abs(i - mid) < Math.abs(best - mid) ? i : best), cuts[0]);
    const twoRows = [SPREAD_LABEL.slice(0, cut), SPREAD_LABEL.slice(cut + 1)];
    let spots = place(width(SPREAD_LABEL), ONE_ROW), rows = null;
    if (!spots.length) { // no straight run is long enough (a phone): the same words on two rows, which need half the run
      rows = twoRows;
      spots = place(Math.max(...rows.map(width)), TWO_ROWS);
    }
    if (!spots.length) {
      // still none: at mid leads the 6 dam line is many small loops, none straight for long. The phrase is then set level just
      // outside the largest loop in view (above its top, below its bottom or to one side), clear of every 6 dam line, so the thick
      // line is never on the map unexplained. One row where it fits, else two.
      for (const r of [null, twoRows]) {
        const w = Math.max(...(r || [SPREAD_LABEL]).map(width)) + 6, h = 16 + (r ? 13 : 0);
        const at = besideSpot(sp.iso, mv.W, mv.H, { w, h, avoid });
        if (at) { spots = [at]; rows = r; break; }
      }
    }
    drawLabelSpots(ctx, spots.slice(0, 2).map((p) => ({ ...p, text: SPREAD_LABEL, rows })), tk);
  },
  /** Drawn after the fill: grey height lines (unless Height contours is off), then the 6 dam spread line with its label. */
  marks(ctx, mv, sample, tk, info) {
    if (!info?.s) return;
    const { s, quality } = info;
    const playing = !!s.playing || quality === 'motion';
    if (s.overlays?.contours !== false) {
      const ctxLines = polylines('conf-context', 'z500', s, mv, { step: 60 }, playing);
      if (ctxLines) strokeContext(ctx, ctxLines.iso, tk);
    }
    const sp = polylines('conf-spread', 'z500sd', s, mv, { levels: [SPREAD_LINE_GPM], step: 1 }, playing);
    if (!sp || !sp.iso.length) return;
    const night = tk.ground === 'night';
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const P = new Path2D();
    for (const L of sp.iso) for (const { pts, closed } of L.lines) { P.moveTo(pts[0], pts[1]); for (let k = 2; k < pts.length; k += 2) P.lineTo(pts[k], pts[k + 1]); if (closed) P.closePath(); }
    ctx.strokeStyle = night ? '#0B0D10' : '#FFFFFF'; ctx.globalAlpha = 0.7; ctx.lineWidth = SPREAD_CASING; ctx.stroke(P);
    ctx.globalAlpha = 1; ctx.strokeStyle = tk.contour.color; ctx.lineWidth = 2.5; ctx.stroke(P);
    ctx.restore();
  },
};

const SPREAD_CASING = 4.5;

/**
 * A level spot for a label of `w` x `h` px set beside a line rather than on it: just outside the extreme points (top, bottom, left,
 * right) of each piece of line in view, `gap` px off the line: closed loops wholly in view first (largest first), then the other
 * pieces longest first. The box stays inside the canvas by `margin`, outside every `avoid` rect, and crossed by no segment of any
 * line in `iso`. Returns {x, y, angle: 0} or null. Pure.
 */
export function besideSpot(iso, W, H, { w, h, avoid = [], margin = 12, gap = 3 }) {
  const inView = (x, y) => x >= 0 && y >= 0 && x <= W && y <= H;
  const pieces = [], segs = [];
  for (const L of iso) for (const { pts, closed } of L.lines) {
    const m = pts.length / 2;
    let len = 0, top = null, bot = null, left = null, right = null, whole = closed;
    for (let i = 0; i < m; i++) {
      const x = pts[2 * i], y = pts[2 * i + 1];
      const j = i + 1 < m ? i + 1 : (closed ? 0 : -1);
      if (j >= 0) segs.push(x, y, pts[2 * j], pts[2 * j + 1]);
      if (!inView(x, y)) { whole = false; continue; }
      if (j >= 0 && inView(pts[2 * j], pts[2 * j + 1])) len += Math.hypot(pts[2 * j] - x, pts[2 * j + 1] - y);
      if (!top || y < top[1]) top = [x, y];
      if (!bot || y > bot[1]) bot = [x, y];
      if (!left || x < left[0]) left = [x, y];
      if (!right || x > right[0]) right = [x, y];
    }
    if (top) pieces.push({ len, whole, cands: [[top[0], top[1] - gap - h / 2], [bot[0], bot[1] + gap + h / 2], [left[0] - gap - w / 2, left[1]], [right[0] + gap + w / 2, right[1]]] });
  }
  // a loop wholly in view reads plainly as the line the phrase names, so loops come first, the largest first; then the rest by length
  pieces.sort((a, b) => (b.whole - a.whole) || (b.len - a.len));
  for (const { cands } of pieces) {
    for (const [x, y] of cands) {
      const x0 = x - w / 2, x1 = x + w / 2, y0 = y - h / 2, y1 = y + h / 2;
      if (x0 < margin || y0 < margin || x1 > W - margin || y1 > H - margin) continue;
      if (avoid.some((r) => x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h)) continue;
      let hit = false;
      for (let k = 0; k < segs.length && !hit; k += 4) hit = segHitsBox(segs[k], segs[k + 1], segs[k + 2], segs[k + 3], x0 - 1, y0 - 1, x1 + 1, y1 + 1);
      if (!hit) return { x, y, angle: 0 };
    }
  }
  return null;
}

/** Does the segment (ax, ay)-(bx, by) touch the box [x0, x1] x [y0, y1]? Liang-Barsky clipping. */
function segHitsBox(ax, ay, bx, by, x0, y0, x1, y1) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}
