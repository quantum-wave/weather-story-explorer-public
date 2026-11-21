// The Air mass lens (DESIGN-SPEC 6.1, MET-8): the 850 hPa temperature anomaly (about 1.5 km up) in ECMWF's temperature-anomaly
// bins (REF-26, hex for hex in render/palette.js), with no fill inside +-1 C, the 500 hPa height as quiet grey context lines, and
// the ground that rises above that level hatched.
//
// The terrain mask. Over high ground (Rockies, Tahoe, the Himalaya) the 850 hPa level is below the surface, so the pipeline
// stores no value there (surface pressure under 870 hPa, W3-10). The fill leaves those cells unpainted; this lens' `marks` hatch
// them, with the no-data hatch (chart-tokens noDataHatch) running the other way from the doubt hatch ("\" here, "/" for doubt), so
// a person can tell "no value, ground in the way" from "forecasts disagree". The readout says "above this level".
import { PALETTES } from '../render/palette.js';
import * as data from '../data/index.js';
import { toGrid, bilinear } from '../data/grid.js';

const FIELD = 't850a', DOMAIN = 'g1';
const ABOVE = 'The ground here is above this level (about 1.5 km up) · no air-mass value';

/**
 * Cells of a W x H frame, `step` px square, for which masked(x, y) (the cell's centre) is true, as rectangles: each row's
 * consecutive masked cells are one run; a row is `step` tall. [{x, y, w, h}], rows top to bottom, runs left to right.
 */
export function maskRuns(W, H, step, masked) {
  const out = [];
  for (let y = 0; y < H; y += step) {
    const h = Math.min(step, H - y);
    let x0 = -1;
    for (let x = 0; x < W + step; x += step) {
      const on = x < W && masked(Math.min(x + step / 2, W - 0.5), y + h / 2);
      if (on && x0 < 0) x0 = x;
      else if (!on && x0 >= 0) { out.push({ x: x0, y, w: Math.min(x, W) - x0, h }); x0 = -1; }
    }
  }
  return out;
}

/** Is the stored t850a no-data at this place at forecast hour t? false when the field or its grid is not loaded. */
function maskedAt(lon, lat, t) {
  const m = data.getManifest(), dom = m?.domains?.[DOMAIN], arr = dom && m.fields?.[FIELD] && data.fieldAt(FIELD, DOMAIN, t);
  if (!arr) return false;
  const g = toGrid(dom, lon, lat);
  return !!g && Number.isNaN(bilinear(arr, dom, g[0], g[1], NaN));
}

// the last mask, kept while the view, the time and the data are the same
let memo = { key: '', runs: [] };

/** The hatched terrain: drawn after the contours, under the coast and border lines (compose.js). */
function marks(ctx, mv, _sample, tk, env = {}) {
  const s = env.s, p = env.plan;
  if (!s || p?.anom?.palette !== 't850a') return;
  const m = data.getManifest(), dom = m?.domains?.[DOMAIN], arr = dom && data.fieldAt(FIELD, DOMAIN, s.t);
  if (!arr) return;
  const step = env.quality === 'motion' ? 6 : 4, key = `${mv.key}|${mv.W}x${mv.H}|${step}|${s.t}|${data.dataVersion()}`;
  if (memo.key !== key) {
    let any = false;
    for (let i = 0; i < arr.length; i++) if (arr[i] !== arr[i]) { any = true; break; }
    const runs = any ? maskRuns(mv.W, mv.H, step, (x, y) => {
      const ll = mv.invert([x, y]), g = ll && toGrid(dom, ll[0], ll[1]);
      return !!g && Number.isNaN(bilinear(arr, dom, g[0], g[1], NaN));
    }) : [];
    memo = { key, runs };
  }
  const runs = memo.runs;
  if (!runs.length) return;
  const hk = tk.noDataHatch, period = hk.pitch * Math.SQRT2;
  const clip = new Path2D();
  for (const r of runs) clip.rect(r.x, r.y, r.w, r.h);
  ctx.save();
  ctx.clip(clip);
  ctx.globalAlpha = hk.alpha; ctx.strokeStyle = hk.color; ctx.lineWidth = 1; ctx.lineCap = 'butt';
  ctx.beginPath();
  for (let c = -mv.H; c <= mv.W + period; c += period) { ctx.moveTo(c, 0); ctx.lineTo(c + mv.H, mv.H); } // "\" lines, x - y = c
  ctx.stroke();
  ctx.restore();
}

export default {
  code: 'a',
  id: 'airmass',
  name: 'Air mass',
  blurb: 'Warm and cold air about 1.5 km up',
  implemented: true,
  /** Drawable when this run has the temperature anomaly. */
  available(manifest) {
    return manifest?.fields?.[FIELD] ? { ok: true } : { ok: false, reason: 'Not in this run' };
  },
  fill: { field: FIELD, palette: FIELD },
  // The 500 hPa height as context only: grey, thin, every 12 dam (half the Pattern lens' density), no bold levels.
  lines: [{ field: 'z500', step: 120, bold: [], labelEvery: 120, unit: 0.1, style: 'contour', tone: 'context' }],
  marks,
  /** True where this lens has no value because the ground is above its level (for the readout). */
  masked: maskedAt,
  guide: {
    answer: 'This shows how warm or cold the air is about 1.5 km up, compared with the usual for this date. Orange and red are warmer than normal, blue is colder, and nothing is shaded within 1 °C of normal.',
    what: 'The temperature of the air at the 850 mb level, about 1.5 km above sea level, as a difference from the 1990-2019 usual for the date. That height sits above the daily ups and downs near the ground, so it shows the air mass itself: a warm surge, a cold plunge.',
    read: 'Orange to dark red: warmer than normal. Light to deep blue: colder. A blue patch usually arrives with a trough and a red one with a ridge, so compare with the Pattern view. The faint grey lines are the 500 mb height, here only for orientation.',
    worth: [
      'The hatched areas are high ground, such as the Rockies or the Tibetan plateau. The 1.5 km level is under the ground there, so there is no air-mass value, and the hatch says so rather than guessing.',
      'The air 1.5 km up is not the temperature where you stand: it tells you which air is coming, not exactly how warm the afternoon will be.',
      'ECMWF publishes no open anomaly chart for this level, so the colours borrow its 2 m temperature-anomaly scale.',
    ],
  },
  /** Readout words: "+4 °C · warmer than normal"; for a masked place pass {masked: true} and get the "above this level" line. */
  describe(value, extra = {}) {
    if (!Number.isFinite(value)) return extra.masked ? ABOVE : '';
    return PALETTES.t850a.describe(value, extra);
  },
};
