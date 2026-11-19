// Pure helpers for the timeline (no DOM, no store): day bands, trip spans, ribbon, steps, easing, formatting.
// All times are forecast hours (floats); `validTime(h)` maps them to Dates (js/data validTime).

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
