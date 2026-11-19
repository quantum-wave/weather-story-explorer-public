// The strip (DESIGN-SPEC section 3.3): one SVG per place, the same component on every card.
//
//  - The wave is the place's pattern series (z500a) as a smooth area about a labelled "normal" line, drawn with a monotone
//    cubic through the model steps: no straight joins and no overshoot beyond the neighbouring samples. Each slice is
//    filled with the band colour of its value from the chart palette (render/palette.js), the same colours the map and the
//    timeline track use for the same numbers; blank inside +-2 dam, neutral ink at 40% where signalAt says "none".
//  - The spread is a soft neutral envelope of +- z500sd behind the wave (none when the field is missing).
//  - Rain is a row of neutral ink bars at four heights (ink, not blue: blue means "below normal"); from day 4 with pr1 each
//    bar is an outline filled to the probability of a wet day. The row is left out when the data carry no rain.
//  - One column per local day that has data, labelled "Thu 19". The zones table (confidence.js zones(), DESIGN-SPEC 7.2)
//    decides each column's texture and note: a dashed rule and "broad pattern" over the blend zone, the diagonal hatch
//    and "pattern only" over the mean zone, or, when the run has no ensemble mean, the hatch and "pattern only" from
//    168 h. The passed part of today is greyed; on a phone, ranges 10 and 15 show days 1-7 and one compressed end cell.
// Columns are tappable rects (.strip-day) with data-day and data-t (the forecast hour to scrub to).
import { bandRGBA } from '../render/palette.js';
import { dayNumberLabel, dateLabel, addDays } from './localday.js';
import { zones, zoneAt, zoneNote } from './confidence.js';

const NS = 'http://www.w3.org/2000/svg';
let uid = 0;
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
const finite = Number.isFinite;
const r2 = (n) => Math.round(n * 100) / 100;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export const KEY_WAVE = 'Orange: higher pressure aloft · Blue: lower';
export const KEY_RAIN = 'Bars: rain';
export const KEY_HATCH = 'Hatch: pattern only, no detail';
/** The inline key as real text: the wave line always, then only the marks this strip actually draws. */
export function keyLines({ rain = false, hatch = false } = {}) {
  const second = [rain ? KEY_RAIN : '', hatch ? KEY_HATCH : ''].filter(Boolean).join(' · ');
  return second ? [KEY_WAVE, second] : [KEY_WAVE];
}
export const END_CELL_WORDS = { 10: 'broad pattern', 15: 'pattern only' };

// ---------- the monotone cubic (Fritsch-Carlson) ----------

/** Slopes of the monotone cubic Hermite interpolant through (xs, ys): never overshoots a neighbouring sample. */
export function tangents(xs, ys) {
  const n = xs.length;
  if (n < 2) return new Array(n).fill(0);
  const d = [], m = new Array(n).fill(0);
  for (let k = 0; k + 1 < n; k++) d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let k = 1; k + 1 < n; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
  for (let k = 0; k + 1 < n; k++) {
    if (d[k] === 0) { m[k] = 0; m[k + 1] = 0; continue; }
    const a = m[k] / d[k], b = m[k + 1] / d[k], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[k] = t * a * d[k]; m[k + 1] = t * b * d[k]; }
  }
  // Beside an extremum (slope 0 there, so the curve never passes the peak) the segment leaving the peak bends hardest at
  // the peak itself. Steepen the far tangent of that segment toward 2 x its secant, which makes it a parabola with an even
  // bend instead of a corner at the peak; only ever steeper, and only while both segments that tangent touches stay inside
  // the monotone region (a^2 + b^2 <= 9), so the no-overshoot guarantee holds. (Real 6-hourly data at 15 days in 336 px:
  // the turn at a peak drops from 31.6 to under 30 degrees.)
  const inside = (j) => { if (j < 0 || j + 1 >= n) return true; if (d[j] === 0) return m[j] === 0 && m[j + 1] === 0; const a = m[j] / d[j], b = m[j + 1] / d[j]; return a >= 0 && b >= 0 && a * a + b * b <= 9 + 1e-9; };
  for (let k = 1; k + 1 < n; k++) {
    if (m[k] !== 0 || d[k - 1] * d[k] >= 0) continue;
    for (const [j, seg] of [[k + 1, k], [k - 1, k - 1]]) {
      const want = 2 * d[seg];
      if (Math.abs(want) <= Math.abs(m[j]) || m[j] * want < 0) continue;
      const keep = m[j];
      for (const f of [1, 0.85, 0.7, 0.55, 0.4]) {
        m[j] = keep + f * (want - keep);
        if (inside(j - 1) && inside(j)) break;
        m[j] = keep;
      }
    }
  }
  return m;
}

/** The interpolant's value at x (xs ascending), clamped to the first and last sample. */
export function hermiteAt(xs, ys, m, x) {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let k = 0;
  while (k + 2 < n && x > xs[k + 1]) k++;
  const h = xs[k + 1] - xs[k], t = (x - xs[k]) / h, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
}

/** SVG path commands "C ..." for the cubic Bezier through the points (control points at thirds, so x stays linear). */
export function cubicSegments(xs, ys, m) {
  let d = '';
  for (let k = 0; k + 1 < xs.length; k++) {
    const h = (xs[k + 1] - xs[k]) / 3;
    d += `C${r2(xs[k] + h)} ${r2(ys[k] + m[k] * h)} ${r2(xs[k + 1] - h)} ${r2(ys[k + 1] - m[k + 1] * h)} ${r2(xs[k + 1])} ${r2(ys[k + 1])}`;
  }
  return d;
}

// ---------- column labels: fitted by width ----------

// 12 px UI font. Estimated, not measured (the strip is built before it is in the page): advance widths of the glyphs the
// labels use, measured once in the system UI font (SF Pro), +2% for other fonts and +6% more for the semibold active label.
// The browser check in S-STORY measures the real boxes with getBBox.
const GLYPH = { 0: 7.56, 1: 5.57, 2: 7.24, 3: 7.52, 4: 7.72, 5: 7.42, 6: 7.64, 7: 7.04, 8: 7.66, 9: 7.64, S: 7.65, u: 7, n: 7, M: 10.49, o: 7.09, T: 7.61, e: 6.86, W: 11.61, d: 7.37, h: 7.06, F: 6.87, r: 4.68, i: 2.97, a: 6.62, t: 4.36, m: 10.44, w: 9.29, D: 8.72, y: 6.52, s: 6.18, '–': 7, ' ': 3.38 };
const WORD = { Today: 33.8, Tomorrow: 56.3 }; // whole words, kerning included
const labelWidth = (str, bold) => {
  let w = 0;
  if (WORD[str]) w = WORD[str];
  else for (const ch of str) w += GLYPH[ch] ?? (/[A-Z]/.test(ch) ? 8.6 : 7.2);
  return Math.ceil(w * 1.02 * (bold ? 1.06 : 1));
};
export const LABEL_GAP = 1;

/**
 * Which day labels to draw and where, so no two boxes meet and none leaves its region [0, regionW]. Each day offers its
 * forms longest first ("Today"; "Tomorrow" then "Fri 20"; "Sat 21"). Labels are thinned (every 2nd, 3rd, ...) only when
 * the shortest forms still collide; Today (the first column) and the active day are always kept, and a label that
 * would touch the active one gives way. A label near an edge slides inward. Returns [{i, text, cx, w}].
 */
export function layoutDayLabels(forms, colW, regionW, active) {
  const n = forms.length;
  const place = (i, text) => {
    const w = labelWidth(text, i === active);
    return { i, text, w, cx: clamp(colW * (i + 0.5), w / 2, Math.max(w / 2, regionW - w / 2)) };
  };
  const clash = (a, b) => Math.min(a.cx + a.w / 2, b.cx + b.w / 2) - Math.max(a.cx - a.w / 2, b.cx - b.w / 2) > -LABEL_GAP;
  const ok = (L) => L.every((a, k) => k === 0 || !clash(L[k - 1], a));
  let fallback = [];
  for (let k = 1; k <= Math.max(1, n); k++) {
    // per step: long forms, then short forms, then short forms with the labels that would touch the active one dropped
    for (const [f, yieldToActive] of [[0, false], [1, false], [1, true]]) {
      const pick = (i) => forms[i][Math.min(f, forms[i].length - 1)];
      let L = [];
      for (let i = 0; i < n; i++) if (i % k === 0 || i === active) L.push(place(i, pick(i)));
      if (yieldToActive && active >= 0 && active < n) {
        const a = L.find((x) => x.i === active);
        L = L.filter((x) => x.i === active || !clash(x, a));
      }
      if (ok(L)) return L;
      fallback = L;
    }
  }
  return fallback.length ? [fallback[0]] : [];
}

/**
 * The two zone notes share one lane above the wave, so they are placed together (DESIGN-SPEC 3.3). The words are the
 * zones' own notes (zoneNote: "broad pattern" for the dashed zone, "pattern only" for the hatched one). "pattern only" starts
 * 4 px into the first hatched day, sliding left to stay inside [0, regionW]; "broad pattern" starts 3 px into the
 * first of days 8-10 and gives way: it shortens to its first word, then is left out (the dashed rule still marks the zone),
 * whenever it would come within NOTE_GAP of "pattern only" or the edge. Widths are the same conservative estimate the
 * day labels use. Returns [{text, x, w}] (x is the left edge, text-anchor start), left to right.
 */
export const NOTE_GAP = 6;
export function layoutZoneNotes(broadX, patternX, regionW, { broad = 'broad pattern', pattern = 'pattern only' } = {}) {
  const out = [];
  let limit = regionW - 2;
  if (patternX != null && pattern) {
    const w = labelWidth(pattern);
    if (w <= regionW - 2) {
      const x = Math.max(0, Math.min(patternX + 4, regionW - 2 - w));
      out.push({ text: pattern, x, w });
      limit = x - NOTE_GAP;
    }
  }
  if (broadX != null && broad) {
    const x = broadX + 3;
    const text = [broad, broad.split(' ')[0]].find((t) => x + labelWidth(t) <= limit);
    if (text) out.unshift({ text, x, w: labelWidth(text) });
  }
  return out;
}

// ---------- helpers on a series ----------

function interp(f, h) {
  const s = f.steps, v = f.values;
  if (!s.length) return NaN;
  if (h <= s[0]) return finite(v[0]) ? v[0] : NaN;
  for (let i = 0; i + 1 < s.length; i++) if (h <= s[i + 1]) {
    const a = v[i], b = v[i + 1];
    if (!finite(a) || !finite(b)) return NaN;
    return a + ((b - a) * (h - s[i])) / (s[i + 1] - s[i]);
  }
  return finite(v[v.length - 1]) ? v[v.length - 1] : NaN;
}

const NOTE_STYLE = 'fill:var(--ink-2);font:12px var(--font-ui);paint-order:stroke;stroke:var(--card,transparent);stroke-width:3px';
const BAR_H = { dry: 1.5, light: 6, moderate: 12, heavy: 20 };
const hasRain = (c) => c.wet === 'dry' || c.wet === 'light' || c.wet === 'moderate' || c.wet === 'heavy';
const hasAny = (c) => c.pattern !== 'none' || hasRain(c) || c.airMass !== 'none' || finite(c.hi);

/**
 * Draws the wave of one stretch of forecast hours into `svg`: area (clipped band-colour slices), envelope, line.
 * Returns the knots drawn. `x0..x1` is the pixel span for hours h0..h1.
 */
function drawWave(svg, defs, o) {
  const { series, days, wins, h0, h1, x0, x1, top, wh, ground, px, mini } = o;
  const z = series.z500a;
  if (!z?.steps?.length) return null;
  const mid = top + wh / 2;
  const X = (h) => x0 + ((h - h0) / (h1 - h0)) * (x1 - x0);
  const pts = [];
  z.steps.forEach((st, i) => { const v = z.values[i]; if (finite(v) && st >= h0 - 1e-6 && st <= h1 + 1e-6) pts.push({ h: st, x: X(st), dam: v / 10 }); });
  if (!pts.length) return null;
  const Y = (dam) => mid - clamp(dam, -20, 20) * px;
  if (pts.length === 1) {
    el('circle', { cx: r2(pts[0].x), cy: r2(Y(pts[0].dam)), r: 2.5, class: 'wave-dot', style: 'fill:var(--ink)' }, svg);
    const cx = pts[0].x, cy = Y(pts[0].dam);
    return { knots: [[cx, cy]], damAt: () => pts[0].dam, xMin: cx - 2.5, xMax: cx + 2.5, yAt: () => cy, fillAt: () => null, bands: [{ l: cx - 2.5, r: cx + 2.5, t: cy - 2.5, b: cy + 2.5 }] };
  }
  const xs = pts.map((p) => p.x), ys = pts.map((p) => Y(p.dam));
  const m = tangents(xs, ys);
  const knots = xs.map((x, i) => [r2(x), r2(ys[i])]);
  const seg = cubicSegments(xs, ys, m);
  const lineD = `M${r2(xs[0])} ${r2(ys[0])}${seg}`;

  // the area between the curve and the "normal" line, the clip for the band-colour slices
  const cid = `wclip${++uid}`;
  const clip = el('clipPath', { id: cid }, defs);
  el('path', { d: `M${r2(xs[0])} ${r2(mid)}L${r2(xs[0])} ${r2(ys[0])}${seg}L${r2(xs[xs.length - 1])} ${r2(mid)}Z` }, clip);
  const g = el('g', { 'clip-path': `url(#${cid})`, class: mini ? 'wave-fill wave-mini' : 'wave-fill' }, svg);

  // spread envelope: +- z500sd about the curve
  const sdf = series.z500sd;
  if (!mini && sdf?.values && Array.from(sdf.values).some(finite)) {
    const up = [], dn = [];
    for (let x = xs[0]; x <= xs[xs.length - 1] + 0.01; x += 3) {
      const h = h0 + ((x - x0) / (x1 - x0)) * (h1 - h0), s = interp(sdf, h) / 10;
      const dam = hermiteAt(xs, pts.map((p) => p.dam), tangents(xs, pts.map((p) => p.dam)), x);
      if (!finite(s)) continue;
      up.push(`${r2(x)},${r2(Y(dam + s))}`); dn.push(`${r2(x)},${r2(Y(dam - s))}`);
    }
    if (up.length > 1) el('polygon', { points: [...up, ...dn.reverse()].join(' '), class: 'envelope', style: 'fill:var(--ink);opacity:.12' }, svg);
  }

  // band-colour slices (2 px), merged into runs of one colour; neutral ink at 40% where there is no clear signal
  const dam = pts.map((p) => p.dam);
  const md = tangents(xs, dam);
  const noSignalAt = (h) => { const i = wins.findIndex((w) => h >= w.startH && h < w.endH); return i >= 0 && days[i]?.signal === 'none'; };
  const runs = [];
  for (let x = xs[0]; x < xs[xs.length - 1]; x += 2) {
    const xe = Math.min(x + 2, xs[xs.length - 1]), xc = (x + xe) / 2;
    const h = h0 + ((xc - x0) / (x1 - x0)) * (h1 - h0);
    let key = null;
    if (noSignalAt(h)) key = 'none';
    else { const c = bandRGBA('z500a', hermiteAt(xs, dam, md, xc), ground); key = c[3] ? `rgb(${c[0]},${c[1]},${c[2]})` : null; }
    const last = runs[runs.length - 1];
    if (last && last.key === key && Math.abs(last.x1 - x) < 0.01) last.x1 = xe; else runs.push({ key, x0: x, x1: xe });
  }
  for (const run of runs) {
    if (!run.key || run.key === 'none') continue;
    el('rect', { x: r2(run.x0), y: top, width: r2(run.x1 - run.x0 + 0.4), height: wh, class: 'slice', style: `fill:${run.key}` }, g);
  }
  // No clear signal: a neutral band about the normal line, not clipped to the curve (the curve there sits near normal,
  // so a fill between it and the line would be a sliver and read as a near-normal day). Half-height is the spread
  // (+- z500sd) of the day, at least 5 px (3 px in the end cell).
  const bandG = el('g', { class: 'nosignal-band' }, svg);
  const minHalf = mini ? 3 : 5;
  const bands = [];
  for (const run of runs) {
    if (run.key !== 'none') continue;
    const h = h0 + (((run.x0 + run.x1) / 2 - x0) / (x1 - x0)) * (h1 - h0);
    const sd = series.z500sd ? interp(series.z500sd, h) / 10 : NaN;
    const half = clamp(finite(sd) ? sd * px : 0, minHalf, wh / 2 - 2);
    el('rect', { x: r2(run.x0), y: r2(mid - half), width: r2(run.x1 - run.x0 + 0.4), height: r2(2 * half), class: 'slice nosignal', style: 'fill:var(--ink);opacity:.4' }, bandG);
    bands.push({ l: run.x0, r: run.x1 + 0.4, t: mid - half, b: mid + half });
  }
  el('path', { d: lineD, class: mini ? 'wave-line wave-line-mini' : 'wave-line', 'data-knots': JSON.stringify(knots), style: 'fill:none;stroke:var(--ink);stroke-width:1.25;stroke-linejoin:round;stroke-linecap:round' }, svg);
  // what the "normal" label must stay clear of: the curve (yAt), the band-colour fill between it and the line (fillAt
  // gives the filled y interval at x, or null) and the no-signal bands
  const yAt = (x) => Y(hermiteAt(xs, dam, md, x));
  const fillAt = (x) => {
    const run = runs.find((q) => x >= q.x0 && x <= q.x1 + 0.4);
    if (!run?.key || run.key === 'none') return null;
    const y = yAt(x);
    return [Math.min(y, mid), Math.max(y, mid)];
  };
  return { knots, damAt: (x) => hermiteAt(xs, dam, md, x), xMin: xs[0], xMax: xs[xs.length - 1], yAt, fillAt, bands };
}

/**
 * Where the "normal" label goes: clear of the curve, the band-colour fill, the no-signal bands and any other obstacle
 * box, inside [0, regionW] and inside the wave area [yMin, yMax]. Tries the label hugging the line first: the two ends
 * (the preferred end first, each on the side the wave is not), then every 2 px across the strip, nearest the preferred
 * end first; then the same a few px further from the line (clear of a no-signal band that spans the strip). Returns
 * {x, y, anchor, box} or null when nothing is clear (the label is then left out; the line still reads as the zero of
 * the key). Text box of 12 px type: baseline - 12 to baseline + 3, width estimated from the glyph table (an upper bound).
 */
export function placeNormalLabel({ wave, mid, regionW, yMin = -Infinity, yMax = Infinity, preferRight = false, obstacles = [] }) {
  const w = labelWidth('normal');
  if (w > regionW - 4) return null;
  const PAD = 1;
  const boxOf = (l, side, off) => { const y = side === 'above' ? mid - 4 - off : mid + 13 + off; return { l, r: l + w, t: y - 12, b: y + 3, y }; };
  const meets = (a, b) => a.l < b.r + PAD && b.l < a.r + PAD && a.t < b.b + PAD && b.t < a.b + PAD;
  const clear = (B) => {
    if (B.l < 0 || B.r > regionW || B.t < yMin || B.b > yMax) return false;
    if (obstacles.some((o) => meets(B, o))) return false;
    if (!wave) return true;
    if (wave.bands.some((o) => meets(B, o))) return false;
    for (let x = Math.max(B.l - PAD, wave.xMin); x <= Math.min(B.r + PAD, wave.xMax) + 1e-9; x += 1) {
      const y = wave.yAt(x);
      if (y > B.t - PAD && y < B.b + PAD) return false;
      const f = wave.fillAt(x);
      if (f && f[0] < B.b + PAD && f[1] > B.t - PAD) return false;
    }
    return true;
  };
  // the side the wave is not, over the label's span (the wave's mean offset there; above when it sits on the line)
  const sides = (l) => {
    if (!wave) return ['above', 'below'];
    let t = 0, c = 0;
    for (let x = Math.max(l, wave.xMin); x <= Math.min(l + w, wave.xMax); x += 2) { t += wave.yAt(x) - mid; c++; }
    return c && t / c < 0 ? ['below', 'above'] : ['above', 'below'];
  };
  const L0 = 2, L1 = regionW - 2 - w;
  const ends = preferRight ? [L1, L0] : [L0, L1];
  const scan = [];
  for (let l = L0; l <= L1; l += 2) scan.push(l);
  scan.sort((a, b) => (preferRight ? b - a : a - b));
  for (let off = 0; off <= 10; off++) {
    for (const l of [...ends, ...scan]) {
      for (const side of sides(l)) {
        const B = boxOf(l, side, off);
        if (clear(B)) {
          const atRight = l === L1;
          return { x: atRight ? regionW - 2 : l, y: B.y, anchor: atRight ? 'end' : 'start', box: B };
        }
      }
    }
  }
  return null;
}

/**
 * @param {object[]} days day classes from buildDays (only days with data)
 * @param {object} series as returned by seriesFor with `windows` set (defaults to days.series)
 * @param {{compact?:boolean, range?:7|10|15, phone?:boolean, expanded?:boolean, width?:number, activeDay?:number,
 *   label?:(c:object)=>string, ground?:'paper'|'night', key?:boolean}} opts
 */
export function stripSVG(days, series = days?.series, opts = {}) {
  const width = opts.width || 336;
  const compact = !!opts.compact;
  const n = days?.length || 0;
  const wins = series?.windows || [];
  const ground = opts.ground === 'paper' ? 'paper' : 'night';
  const rainRow = !compact && n > 0 && days.some(hasRain);
  const endCell = !!opts.phone && n > 7 && !opts.expanded;
  const mainN = endCell ? 7 : n;
  // Each column's zone from the one zones table (DESIGN-SPEC 7.2), with the ensemble mean or without it. A day belongs
  // to the latest zone any of its hours reach, so a day that straddles 168 h is already "pattern only" (or "broad
  // pattern"): the strip never claims more detail than the data hold.
  const hasMean = typeof opts.hasMean === 'boolean' ? opts.hasMean : typeof series?.hasMean === 'boolean' ? series.hasMean : !!series?.z500em;
  const zst = series?.z500a?.steps;
  const maxStep = zst?.length ? zst[zst.length - 1] : wins.length ? wins[wins.length - 1].endH : 360;
  const lastZone = zones(maxStep, { hasMean }).at(-1);
  const colZone = Array.from({ length: n }, (_, i) => {
    const w = wins[i];
    if (!w) return null;
    return zoneAt(clamp(Math.min(w.endH, maxStep) - 1e-6, 0, maxStep), maxStep, { hasMean }) || lastZone;
  });
  const texture = (i) => colZone[i]?.texture || 'solid';
  // the zone notes ("broad pattern", "pattern only") have a lane of their own between the day labels and the wave, so they
  // never sit on the fill, the hatch or the curve
  const noteH = n > 0 && days.slice(0, mainN).some((c, i) => hasAny(c) && zoneNote(colZone[i])) ? 16 : 0;
  const labelH = compact ? 0 : 16, waveH = compact ? 40 : 46, rainH = rainRow ? 26 : 0;
  const showKey = !compact && opts.key !== false && n > 0;
  const hatchDrawn = n > 0 && days.some((c, i) => texture(i) === 'hatch' || !hasAny(c));
  const keyRows = showKey ? keyLines({ rain: rainRow, hatch: hatchDrawn }) : [];
  const keyH = keyRows.length * 14 + (keyRows.length ? 2 : 0);
  const H = labelH + noteH + waveH + rainH + keyH;
  const svg = el('svg', { viewBox: `0 0 ${width} ${H}`, width, height: H, class: 'strip', role: 'group', 'aria-label': 'Forecast strip for the coming days' });
  if (!n || !wins.length) return svg;

  const defs = el('defs', {}, svg);
  const hid = `hatch${++uid}`;
  const pat = el('pattern', { id: hid, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  el('line', { x1: 0, y1: 0, x2: 0, y2: 6, style: 'stroke:var(--hairline);stroke-width:2' }, pat);

  const endW = endCell ? 56 : 0, gap = endCell ? 4 : 0;
  const mainW = width - endW - gap;
  const colW = mainW / mainN;
  const top = labelH + noteH, mid = top + waveH / 2, px = (waveH / 2 - 4) / 20;
  const h0 = wins[0].startH, h1 = wins[mainN - 1].endH;
  const X = (h) => ((h - h0) / (h1 - h0)) * mainW;
  const cov = days.coverage || {};

  // the "normal" line and its label
  el('line', { x1: 0, y1: mid, x2: mainW, y2: mid, class: 'normal-line', style: 'stroke:var(--hairline);stroke-width:1' }, svg);

  // wave (main), then the mini wave of the end cell
  const main = drawWave(svg, defs, { series, days, wins, h0, h1, x0: 0, x1: mainW, top, wh: waveH, ground, px });
  if (endCell) {
    const ex = mainW + gap;
    el('rect', { x: ex, y: top, width: endW, height: waveH + rainH, rx: 4, class: 'strip-end-bg', style: 'fill:var(--ink);opacity:.05' }, svg);
    el('line', { x1: ex, y1: mid, x2: ex + endW, y2: mid, class: 'end-normal-line', style: 'stroke:var(--hairline);stroke-width:1' }, svg);
    drawWave(svg, defs, { series, days, wins, h0: wins[mainN].startH, h1: wins[n - 1].endH, x0: ex + 3, x1: ex + endW - 3, top: top + waveH * 0.2, wh: waveH * 0.6, ground, px: px * 0.6, mini: true });
  }
  // columns
  const labelAt = (c) => (c.today ? ['Today'] : cov.todayDate && c.date === addDays(cov.todayDate, 1) ? ['Tomorrow', dayNumberLabel(c.date)] : [dayNumberLabel(c.date)]);
  let broadDone = false, patternDone = false, broadX = null, patternX = null, broadNote = '', patternNote = '', earlier = null;
  for (let i = 0; i < mainN; i++) {
    const c = days[i], w = wins[i], x = i * colW;
    const noData = !hasAny(c);
    const hatched = texture(i) === 'hatch';
    if (i === opts.activeDay) {
      el('rect', { x, y: top, width: colW, height: waveH + rainH, class: 'strip-sel', style: 'fill:var(--ink);opacity:.06' }, svg);
    }
    if (c.today && finite(c.passedH)) {
      const pw = clamp(X(c.passedH) - x, 0, colW);
      if (pw > 0) {
        const g = el('g', { class: 'passed' }, svg);
        el('title', {}, g).textContent = 'earlier today';
        el('rect', { x, y: top, width: r2(pw), height: waveH + rainH, style: 'fill:var(--hairline);opacity:.75' }, g);
        if (pw >= 76) {
          const t = el('text', { x: x + 4, y: top + waveH - 4, style: 'fill:var(--ink-2);font:12px var(--font-ui)' }, g); t.textContent = 'earlier today';
          earlier = { l: x + 4, r: x + 4 + 76, t: top + waveH - 16, b: top + waveH - 1 };
        }
      }
    }
    if (rainRow && !hatched && hasRain(c)) {
      const bottom = top + waveH + rainH - 3, bw = Math.min(colW * 0.5, 30), bx = x + (colW - bw) / 2;
      if (c.wetSource === 'pr' && finite(c.pr1)) {
        const full = BAR_H.heavy, fill = (clamp(c.pr1, 0, 100) / 100) * full;
        el('rect', { x: r2(bx), y: bottom - full, width: r2(bw), height: full, rx: 1.5, class: 'bar bar-prob', 'data-pr1': Math.round(c.pr1), style: 'fill:none;stroke:var(--ink);stroke-width:1;opacity:.6' }, svg);
        if (fill > 0) el('rect', { x: r2(bx), y: r2(bottom - fill), width: r2(bw), height: r2(fill), rx: 1.5, class: 'bar bar-prob-fill', style: 'fill:var(--ink);opacity:.55' }, svg);
      } else {
        const bh = BAR_H[c.wet];
        el('rect', { x: r2(bx), y: bottom - bh, width: r2(bw), height: bh, rx: 1.5, class: `bar bar-${c.wet}`, style: c.wet === 'dry' ? 'fill:var(--ink);opacity:.25' : 'fill:var(--ink);opacity:.6' }, svg);
      }
    }
    if (noData) el('rect', { x, y: top, width: colW, height: waveH + rainH, fill: `url(#${hid})`, class: 'hatch-nodata', opacity: 1 }, svg);
    else if (hatched) el('rect', { x, y: top, width: colW, height: waveH + rainH, fill: `url(#${hid})`, class: 'hatch-pattern-only', opacity: 0.6 }, svg);
    if (!noData && texture(i) === 'dashed' && !broadDone) {
      broadDone = true;
      let k = i; while (k < mainN && texture(k) === 'dashed') k++;
      el('line', { x1: x, y1: top - 1.5, x2: k * colW, y2: top - 1.5, class: 'zone-dashed', style: 'stroke:var(--ink-2);stroke-width:1;stroke-dasharray:3 3' }, svg);
      broadX = x; broadNote = zoneNote(colZone[i]);
    }
    if (!noData && hatched && !patternDone) {
      patternDone = true;
      patternX = x; patternNote = zoneNote(colZone[i]);
    }
    if (!compact) {
      if (i === opts.activeDay) el('rect', { x: r2(x + 3), y: 14, width: r2(colW - 6), height: 2, class: 'strip-underline', style: 'fill:var(--ink)' }, svg);
    }
    // the tappable column: forecast hour to scrub to, never past the loaded range
    const zs = series.z500a?.steps;
    const first = zs?.[0] ?? w.startH, last = zs?.[zs.length - 1] ?? w.endH;
    const lo = Math.max(w.startH, first), hi = Math.min(w.endH, last);
    const tmid = hi > lo ? (lo + hi) / 2 : Math.min(last, Math.max(first, w.startH));
    const tap = el('rect', { x, y: 0, width: colW, height: labelH + noteH + waveH + rainH, fill: 'transparent', class: 'strip-day', role: 'button', tabindex: 0, 'data-day': i, 'data-t': tmid.toFixed(1), 'aria-label': opts.label ? opts.label(c) : dateLabel(c.date) }, svg);
    tap.style.cursor = 'pointer';
  }
  for (const N of layoutZoneNotes(broadX, patternX, mainW, { broad: broadNote, pattern: patternNote })) {
    const t = el('text', { x: r2(N.x), y: top - 4, class: 'strip-note strip-zone-note', style: NOTE_STYLE }, svg);
    t.textContent = N.text;
  }
  if (rainRow) el('line', { x1: 0, y1: top + waveH, x2: mainW, y2: top + waveH, class: 'rain-sep', style: 'stroke:var(--hairline);stroke-width:1' }, svg);

  // day labels: fitted to the column width, thinned by width, the active day always named, clear of the end cell
  if (!compact) {
    const act = Number.isInteger(opts.activeDay) && opts.activeDay >= 0 && opts.activeDay < mainN ? opts.activeDay : -1;
    for (const L of layoutDayLabels(days.slice(0, mainN).map(labelAt), colW, mainW, act)) {
      const on = L.i === act;
      const t = el('text', { x: r2(L.cx), y: 12, 'text-anchor': 'middle', class: 'strip-label', style: `fill:${on ? 'var(--ink)' : 'var(--ink-2)'};font:${on ? 600 : 400} 12px var(--font-ui)` }, svg);
      t.textContent = L.text;
    }
  }

  // the "normal" label, drawn last so the passed-hours block never covers it, and placed clear of the curve, the fill and
  // the no-signal band (placeNormalLabel). The preferred end is the one where the wave is nearest the line; the right
  // when the passed block of today sits at the left edge. Left out when no place is clear.
  if (!compact) {
    const avg = (a, b) => { if (!main) return 0; let t = 0, c = 0; for (let x = a; x <= b; x += 4) { t += main.damAt(x); c++; } return t / c; };
    const left = avg(2, 46), right = avg(mainW - 46, mainW - 2);
    const passedLeft = days[0]?.today && finite(days[0].passedH) && X(days[0].passedH) > 0;
    const spot = placeNormalLabel({ wave: main, mid, regionW: mainW, yMin: top, yMax: top + waveH, preferRight: passedLeft || Math.abs(right) < Math.abs(left), obstacles: earlier ? [earlier] : [] });
    if (spot) {
      const nl = el('text', { x: r2(spot.x), y: spot.y, 'text-anchor': spot.anchor, class: 'strip-normal', style: 'fill:var(--ink-2);font:12px var(--font-ui);paint-order:stroke;stroke:var(--card,transparent);stroke-width:3px' }, svg);
      nl.textContent = 'normal';
    }
  }

  // the compressed end cell of a phone strip: days 8-10 or 8-15, with the zone's note
  if (endCell) {
    const ex = mainW + gap, lastDay = days[n - 1];
    // the end cell's words are the note of the last day's zone: "broad pattern" only when the run has the blend
    const words = zoneNote(colZone[n - 1]) || END_CELL_WORDS[opts.range === 15 || lastDay.lead > 10 ? 15 : 10];
    const lbl = `8–${lastDay.lead}`, lblFull = `Days ${lbl}`;
    if (!compact) { const t = el('text', { x: r2(ex + endW / 2), y: 12, 'text-anchor': 'middle', class: 'strip-label strip-label-end', style: 'fill:var(--ink-2);font:12px var(--font-ui)' }, svg); t.textContent = lbl; }
    const w8 = wins[7];
    const zs = series.z500a?.steps;
    const t8 = zs ? clamp(w8.startH, zs[0], zs[zs.length - 1]) : w8.startH;
    const tap = el('rect', { x: ex, y: 0, width: endW, height: labelH + noteH + waveH + rainH, fill: 'transparent', class: 'strip-end', role: 'button', tabindex: 0, 'data-t': t8.toFixed(1), 'aria-label': `${lblFull}, ${words}. Show all days` }, svg);
    tap.style.cursor = 'pointer';
    if (rainRow) for (const [k, wd] of words.split(' ').entries()) { const t = el('text', { x: ex + endW / 2, y: top + waveH + 11 + k * 12, 'text-anchor': 'middle', class: 'strip-note', style: 'fill:var(--ink-2);font:12px var(--font-ui)' }, svg); t.textContent = wd; }
  }

  if (showKey) {
    keyRows.forEach((line, k) => { const t = el('text', { x: 0, y: labelH + noteH + waveH + rainH + 13 + k * 14, class: 'strip-key', style: 'fill:var(--ink-2);font:12px var(--font-ui)' }, svg); t.textContent = line; });
  }
  return svg;
}
