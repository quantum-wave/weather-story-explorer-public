// Pure helpers for the timeline (no DOM, no store): day bands, trip spans, ribbon, steps, easing, formatting.
// All times are forecast hours (floats); `validTime(h)` maps them to Dates (js/data validTime).

import { bandRGBA } from '../render/palette.js';
import { zones, signalAt, BLEND_START_H, BLEND_END_H } from '../story/confidence.js';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HOUR = 3600e3;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** Min and max over several step arrays; null when there are none. */
export function spanOf(stepArrays) {
  let lo = Infinity, hi = -Infinity;
  for (const a of stepArrays) for (const s of a || []) { if (s < lo) lo = s; if (s > hi) hi = s; }
  return lo <= hi ? [lo, hi] : null;
}
/** Sorted union of step arrays. */
export function unionSteps(stepArrays) {
  const set = new Set();
  for (const a of stepArrays) for (const s of a || []) set.add(s);
  return [...set].sort((a, b) => a - b);
}

/** Playhead position after dtMs at `speed` forecast hours per second, looping inside [lo, hi]. */
export function advance(t, dtMs, speed, lo, hi) {
  const span = hi - lo;
  let n = t + (dtMs / 1000) * speed;
  if (span <= 0) return lo;
  if (n > hi) n = lo + ((n - lo) % span);
  if (n < lo) n = lo;
  return n;
}

/** Next data step strictly after (dir > 0) or before (dir < 0) `t`; clamps at the ends. `steps` sorted. */
export function nextStep(steps, t, dir) {
  if (!steps.length) return t;
  const eps = 0.01;
  if (dir > 0) { for (const s of steps) if (s > t + eps) return s; return steps[steps.length - 1]; }
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i] < t - eps) return steps[i];
  return steps[0];
}

/**
 * Local-day bands over [t0, t1]. Each: {t0, t1, tick, weekday, initial, date}; `tick` is the hour of the
 * local midnight that starts the band (null for a partial first band), `date` the local midnight Date.
 * Midnights come from the calendar, so DST days are 23 or 25 hours long.
 */
export function dayBands(validTime, t0, t1) {
  const out = [];
  if (!(t1 > t0)) return out;
  const base = validTime(0).getTime();
  const hoursOf = (d) => (d.getTime() - base) / HOUR;
  const first = validTime(t0);
  let day = new Date(first.getFullYear(), first.getMonth(), first.getDate());
  for (let guard = 0; guard < 40; guard++) {
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    const a = Math.max(hoursOf(day), t0), b = Math.min(hoursOf(next), t1);
    if (a >= t1) break;
    if (b > a) {
      const w = DAY[day.getDay()];
      out.push({ t0: a, t1: b, tick: hoursOf(day) >= t0 - 1e-9 ? hoursOf(day) : null, weekday: w, initial: w[0], date: day });
    }
    if (hoursOf(next) >= t1) break;
    day = next;
  }
  return out;
}

/** 'YYYY-MM-DD' to a local-midnight Date plus `plusDays`; null when malformed. */
function localDate(s, plusDays = 0) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3] + plusDays);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Trips as spans [t0, t1] in forecast hours, end date inclusive, clipped to [lo, hi]; outside spans dropped. */
export function tripSpans(trips, validTime, lo, hi) {
  const base = validTime(0).getTime();
  const out = [];
  for (const tr of trips || []) {
    const a = localDate(tr.start), b = localDate(tr.end, 1);
    if (!a || !b) continue;
    const s = (a.getTime() - base) / HOUR, e = (b.getTime() - base) / HOUR;
    if (e <= lo || s >= hi || e <= s) continue;
    out.push({ id: tr.id, label: String(tr.label ?? ''), t0: Math.max(s, lo), t1: Math.min(e, hi), clipStart: s < lo, clipEnd: e > hi });
  }
  return out;
}

export const SPREAD_TO_DAM = 0.1; // z500sd is stored in gpm
export const BAND_WORD = { high: 'Confident', medium: 'Fairly sure', low: 'Uncertain', 'pattern-only': 'Pattern only' };

/**
 * Pattern-confidence band (SPEC section 6): spread < 3 dam high, 3-6 medium, > 6 low; from day 8 (168 h) at most
 * medium; from day 11 (240 h) "pattern only". Without a spread: days 1-4 high, 5-7 medium, 8-10 low.
 */
export function confidenceBand(spreadDam, leadH) {
  if (leadH >= 240) return 'pattern-only';
  let band;
  if (spreadDam == null || !Number.isFinite(spreadDam)) band = leadH < 96 ? 'high' : leadH < 168 ? 'medium' : 'low';
  else band = spreadDam < 3 ? 'high' : spreadDam <= 6 ? 'medium' : 'low';
  if (leadH >= 168 && band === 'high') band = 'medium';
  return band;
}

/** Ribbon brightness 0.2 to 1: bright when tight (<= 2 dam), dim when spread (>= 8 dam); lead caps it so a long lead never looks sure. */
export function ribbonAlpha(spreadDam, leadH) {
  let a = spreadDam == null || !Number.isFinite(spreadDam)
    ? (leadH < 96 ? 0.85 : leadH < 168 ? 0.5 : 0.3)
    : clamp(1 - ((spreadDam - 2) / 6) * 0.8, 0.2, 1);
  const cap = leadH >= 240 ? 0.25 : leadH >= 168 ? 0.6 : 1;
  return Math.min(a, cap);
}

/** Linear interpolation of a {steps, values} series at hour t (clamped to its ends); null if empty. */
export function seriesAt(series, t) {
  const s = series?.steps, v = series?.values;
  if (!s || !s.length) return null;
  if (t <= s[0]) return v[0];
  if (t >= s[s.length - 1]) return v[s.length - 1];
  let i = 1; while (s[i] < t) i++;
  const f = (t - s[i - 1]) / (s[i] - s[i - 1]);
  return v[i - 1] + (v[i] - v[i - 1]) * f;
}

/**
 * Ribbon over [t0, t1]: sample points (every step of the spread series inside the range, else every 6 h) with
 * brightness and band, plus runs of equal band for the words. `spread` is {steps, values(gpm)} or null.
 */
export function ribbon(spread, t0, t1, stepH = 6) {
  const ts = new Set([t0, t1]);
  if (spread?.steps?.length) {
    for (const s of spread.steps) if (s > t0 && s < t1) ts.add(s);
  } else {
    for (let h = Math.ceil(t0 / stepH) * stepH; h < t1; h += stepH) ts.add(h);
  }
  const pts = [...ts].sort((a, b) => a - b).map((t) => {
    const g = spread ? seriesAt(spread, t) : null;
    const dam = g == null ? null : g * SPREAD_TO_DAM;
    return { t, dam, alpha: ribbonAlpha(dam, t), band: confidenceBand(dam, t) };
  });
  const runs = [];
  for (const p of pts) if (!runs.length || runs[runs.length - 1].band !== p.band) runs.push({ t: p.t, band: p.band, word: BAND_WORD[p.band] });
  return { pts, runs, bySpread: !!(spread?.steps?.length) };
}

/** Drop labels closer than minPx (greedy, left to right). items: [{t,...}] */
export function thinLabels(items, t0, t1, widthPx, minPx) {
  const out = []; let lastX = -Infinity;
  const span = t1 - t0;
  for (const it of items) {
    const x = ((it.t - t0) / span) * widthPx;
    if (x - lastX >= minPx) { out.push(it); lastX = x; }
  }
  return out;
}

/** 'Sat 22 Nov, 4 am PST' (viewer time zone) and '12Z' (UTC), from a Date. */
export function formatReadout(date, tzName, { year = false } = {}) {
  const h = date.getHours();
  const hh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const mins = date.getMinutes();
  const clock = mins ? `${hh}:${String(mins).padStart(2, '0')}` : `${hh}`;
  const main = `${DAY[date.getDay()]} ${date.getDate()} ${MON[date.getMonth()]}${year ? ' ' + date.getFullYear() : ''}, ${clock} ${h < 12 ? 'am' : 'pm'}${tzName ? ' ' + tzName : ''}`;
  return { main, short: main.slice(0, tzName ? main.length - tzName.length - 1 : main.length), tz: tzName || '', utc: `${String(date.getUTCHours()).padStart(2, '0')}Z` };
}

export function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}


// ---- W3-08: the data-coloured track, the zones, the readout (DESIGN-SPEC 7.1, 7.2)

/** Track sample times: every step to 168 h, every 12 h after (the track never smears 6-hourly detail into the late days). */
export function trackTimes(steps) {
  return (steps || []).filter((s) => s <= BLEND_START_H || Math.abs(s % 12) < 1e-9);
}

/** Linear interpolation at t without extrapolation: null outside the series' own steps. */
function seriesInside(series, t) {
  const s = series?.steps;
  if (!s || !s.length || t < s[0] - 1e-9 || t > s[s.length - 1] + 1e-9) return null;
  const v = seriesAt(series, t);
  return Number.isFinite(v) ? v : null;
}

/**
 * The pattern series the track is drawn from when the data client has not already blended it: the single run to 168 h,
 * a linear blend to the ensemble mean by 240 h, the mean after (the same rule the map and the story use). With no mean
 * the run stays the run. Returns a new {steps, values} on the run's steps.
 */
export function blendSeries(run, mean) {
  if (!run?.steps) return null;
  const values = Float32Array.from(run.steps, (t, i) => {
    const r = run.values[i];
    if (!mean || t <= BLEND_START_H) return r;
    const e = seriesInside(mean, t);
    if (e == null) return r;
    const w = Math.min(1, (t - BLEND_START_H) / (BLEND_END_H - BLEND_START_H));
    return Number.isFinite(r) ? r + (e - r) * w : e * (w >= 1 ? 1 : NaN);
  });
  return { steps: run.steps.slice(), values };
}

/**
 * The anomaly of the ensemble mean on the run's steps: z500em is an absolute height (gpm), so its anomaly is
 * z500em - (z500 - z500a) at the same step (DESIGN-SPEC 15, data client). Null where z500 or z500em is missing, so
 * the caller keeps the single run rather than blending an absolute height into an anomaly.
 */
export function meanAnomalySeries(z500a, z500, z500em) {
  if (!z500a?.steps || !z500 || !z500em) return null;
  const values = Float32Array.from(z500a.steps, (t, i) => {
    const e = seriesInside(z500em, t), h = seriesInside(z500, t), a = z500a.values[i];
    return e == null || h == null || !Number.isFinite(a) ? NaN : e - (h - a);
  });
  return { steps: z500a.steps.slice(), values };
}

/**
 * One cell per time, tiling [times[0], times[last]] (cell edges at the midpoints between times). `z500a` and `z500sd`
 * are {steps, values} in gpm (stored units). Each cell: {t, from, to, state, rgba, anomDam}; state is 'band' (rgba is
 * bandRGBA('z500a', dam, ground)), 'blank' (inside the neutral +-2 dam), 'none' (no clear signal: forecasts disagree)
 * or 'nodata'. rgba is null unless state is 'band'.
 */
export function trackCells(times, { z500a, z500sd, ground = 'paper' } = {}) {
  const out = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const from = i === 0 ? t : (times[i - 1] + t) / 2, to = i === times.length - 1 ? t : (t + times[i + 1]) / 2;
    const g = seriesInside(z500a, t);
    const cell = { t, from, to, state: 'nodata', rgba: null, anomDam: NaN };
    if (g != null) {
      const dam = g * SPREAD_TO_DAM, sd = seriesInside(z500sd, t);
      cell.anomDam = dam;
      if (signalAt({ anomDam: dam, spreadDam: sd == null ? NaN : sd * SPREAD_TO_DAM, hasSpread: sd != null }) === 'none') cell.state = 'none';
      else {
        const c = bandRGBA('z500a', dam, ground);
        if (c[3] === 0) cell.state = 'blank'; else { cell.state = 'band'; cell.rgba = c; }
      }
    }
    out.push(cell);
  }
  return out;
}

/** The step nearest t (a tie goes to the later step); t itself when there are no steps. */
export function nearestStep(steps, t) {
  if (!steps?.length) return t;
  let best = steps[0], d = Math.abs(t - best);
  for (const s of steps) { const e = Math.abs(t - s); if (e <= d + 1e-9) { best = s; d = e; } }
  return best;
}
/** True when t sits on a model step (within 0.05 h). */
export function isOnStep(steps, t) { return !!steps?.length && Math.abs(nearestStep(steps, t) - t) < 0.05; }

/** "Day n of N" over the loop range [lo, hi] (N whole days, at least 1). */
export function dayOf(t, lo, hi) {
  const of = Math.max(1, Math.ceil((hi - lo) / 24 - 1e-9));
  return { n: Math.min(of, Math.max(1, Math.floor((t - lo) / 24 + 1e-9) + 1)), of };
}

/**
 * The two-line readout. Line 1: local date and time with the zone's name. Line 2: "Day n of N", "between model steps"
 * when paused off a step, and the run text (runLabel(), one formatter). Never a bare UTC hour beside a local date.
 */
export function readoutLines({ date, tz, t, lo, hi, run = '', between = false, year = false }) {
  const f = formatReadout(date, tz, { year });
  const { n, of } = dayOf(t, lo, hi);
  const parts = [`Day ${n} of ${of}`];
  if (between) parts.push('between model steps');
  if (run) parts.push(run);
  return { line1: f.main.replace(', ', ' · '), line2: parts.join(' · '), utc: f.utc };
}

/** Ruler label for a day band: "Tue 24"; "Today" for the first day of live data. */
export function rulerLabel(band, { today = false } = {}) {
  return today ? 'Today' : `${band.weekday} ${band.date.getDate()}`;
}

/** The zones of the one zones table for a track ending at `maxStep`; the only source of kinds, hours and captions. */
export function zoneSpans(maxStep, { hasMean = true } = {}) {
  return zones(maxStep, { hasMean });
}
