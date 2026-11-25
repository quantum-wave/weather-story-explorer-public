// Story functions (DESIGN-SPEC sections 3, 7.2, 7.3, 15): day classes, local-day binning, coverage, the sentence builders,
// the strip and the day table. classifyDay and daysFromSeries are pure; buildDays and notability read the data facade. All wording
// lives in phrases.js, all confidence logic in confidence.js, local-day arithmetic in localday.js, drawing in strip.js
// (the pattern wave) and daytable.js (the cards' day columns).
//
// buildDays returns the day classes as an array (so existing callers keep working) that also carries
// `.days` (the same array), `.series` (with `.windows`) and `.coverage`: {requested, withData, firstDate, lastDate,
// nextUpdate, todayDate, kind, ...}. It holds only local days that have data: the number of columns equals the number of
// days with data, never a hatched phantom day.
import * as data from '../data/index.js';
import { store, bus } from '../state.js';
import { isLive, isMultiCase, isRecorded, staleness } from '../data/kind.js';
import * as P from './phrases.js';
import { signalAt, confidenceAt } from './confidence.js';
import { offsetMinutes, viewerOffsetMinutes, localDate, dayWindowsAt, weekdayShort as wkShort } from './localday.js';
import { stripSVG as drawStrip } from './strip.js';
export { dayTable, cellsFor, fitNames, fitBands } from './daytable.js';

export { reasonPhrase, tripState, tripLine, weekTitle, coverageNote, laterDaysNote, daysOfData, summaryConfidence } from './phrases.js';
export { zones, zoneAt, signalAt, confidenceAt, CAPTIONS, NO_CLEAR_SIGNAL } from './confidence.js';
export { dayLabel, offsetMinutes } from './localday.js';

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const MIN = 60e3;
const pad = (n) => String(n).padStart(2, '0');

let manifest = null;
export function setManifest(m) { manifest = m; }
bus.on('data:manifest', setManifest);
const mf = () => manifest || data.getManifest?.() || null;

/** The case the map shows (data.activeCase: the case of the active lens' field), or undefined for a live or recorded run. */
const activeCaseId = () => {
  const m = mf();
  return data.activeCase?.() ?? undefined;
};
/** Valid time for the story: the dataset's own clock, at the active case's real dates for a multi-case sample. */
const vt = (h) => data.validTime(h, activeCaseId());

// ---------- day windows ----------

/**
 * Local-day windows in forecast hours (kept for existing callers).
 * tz 'viewer': days in the viewer's time zone; an integer: a fixed UTC offset in hours (round(lon / 15)).
 * Returns [{date: 'YYYY-MM-DD', startH, endH}] relative to originMs (step 0).
 */
export function dayWindows(originMs, startMs, count, tz = 'viewer') {
  if (tz !== 'viewer') return dayWindowsAt(originMs, startMs, count, tz * 60);
  const out = [];
  const d0 = new Date(startMs);
  let s = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate());
  for (let i = 0; i < count; i++) {
    const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1);
    out.push({ date: `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`, startH: (s - originMs) / HOUR, endH: (e - originMs) / HOUR });
    s = e;
  }
  return out;
}

/** Fixed offset in hours for a place: round(lon / 15). */
export const tzForLon = (lon) => offsetMinutes(lon) / 60;

/** 'Thu' for 'YYYY-MM-DD' (zone independent). */
export const weekdayShort = wkShort;
export const weekdayInitial = (date) => 'SMTWTFS'[new Date(date + 'T12:00:00Z').getUTCDay()];

// ---------- classification ----------

const finite = Number.isFinite;
/** Values of a {steps, values} series with step in [a, b) (closedEnd: (a, b]). */
function within(f, w, closedEnd = false) {
  if (!f || !f.steps) return [];
  const out = [];
  for (let i = 0; i < f.steps.length; i++) {
    const s = f.steps[i], v = f.values[i];
    if (!finite(v)) continue;
    if (closedEnd ? s > w.startH && s <= w.endH : s >= w.startH && s < w.endH) out.push(v);
  }
  return out;
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/**
 * @param {{windows:{date:string,startH:number,endH:number}[], z500a?:object, z500sd?:object, ws250max?:object,
 *   tp6?:object, t850a?:object, t2m?:object, pr1?:object, pr10?:object, originMs?:number, offsetMin?:number}} series
 *   fields are {steps (forecast hours), values} in the stored units (gpm, m/s, mm, K, %); a missing field is null.
 * @param {number} dayIndex index into series.windows
 * @param {number} lead 1 for the first day
 */
export function classifyDay(series, dayIndex, lead) {
  const w = series.windows[dayIndex];
  const nextW = series.windows[dayIndex + 1];

  // Pattern (dam) and the doubt about it
  const z = within(series.z500a, w).map((v) => v / 10);
  const sd = within(series.z500sd, w).map((v) => v / 10);
  const anomDam = z.length ? mean(z) : NaN;
  const spreadDam = sd.length ? mean(sd) : NaN;
  const signal = z.length ? signalAt({ anomDam, spreadDam, hasSpread: sd.length > 0 }) : 'clear';
  let pattern = 'none';
  if (z.length) {
    const lo = Math.min(...z), hi = Math.max(...z);
    const nz = nextW ? within(series.z500a, nextW).map((v) => v / 10) : [];
    const nm = nz.length ? mean(nz) : null;
    if (signal === 'none') pattern = 'no-signal';
    else if (anomDam >= 6) pattern = 'ridge';
    else if (anomDam <= -6) pattern = 'trough';
    else if (lo <= -6 || (nm !== null && nm <= -6)) pattern = 'trough-arriving';
    else if (hi >= 6 || (nm !== null && nm >= 6)) pattern = 'ridge-building';
    else pattern = 'near-normal';
  }
  const jet = within(series.ws250max, w);
  const stormTrack = jet.length > 0 && Math.max(...jet) >= 50;

  // Wet: tp6 summed over the local day for days 1-3, pr1 / pr10 from day 4 (the window ending nearest the day's end)
  const rainField = !!(series.tp6 || series.pr1);
  const rainMissing = lead <= 10 && !rainField;
  let wet = 'none', wetPhrase = '', wetSource = 'none', rainMm, pr1, pr10, prEndHour;
  if (lead <= 10) {
    if (lead >= 4 && series.pr1) {
      let best = -1, bd = Infinity;
      series.pr1.steps.forEach((s, i) => {
        if (!finite(series.pr1.values[i]) || s <= w.startH) return;
        const d = Math.abs(s - w.endH);
        if (d <= 6 && d < bd) { bd = d; best = i; }
      });
      if (best >= 0) {
        pr1 = series.pr1.values[best];
        const k = series.pr10 ? series.pr10.steps.indexOf(series.pr1.steps[best]) : -1;
        pr10 = k >= 0 && finite(series.pr10.values[k]) ? series.pr10.values[k] : NaN;
        const r = P.wetFromProbability(pr1, pr10);
        wet = r.wet; wetPhrase = r.phrase; wetSource = 'pr';
        if (finite(series.originMs) && finite(series.offsetMin)) {
          const endMs = series.originMs + series.pr1.steps[best] * HOUR + series.offsetMin * MIN;
          prEndHour = (((endMs % DAY) + DAY) % DAY) / HOUR;
        }
      }
    }
    if (wetSource === 'none') {
      const rain = within(series.tp6, w, true);
      if (rain.length) {
        rainMm = rain.reduce((x, y) => x + y, 0);
        wet = P.wetFromAmount(rainMm);
        wetPhrase = P.wetPhraseFor(wet, lead);
        wetSource = 'tp6';
      } else if (rainMissing) wetPhrase = P.NOT_IN_RUN;
    }
  }

  // Air mass (K): dropped where the field is masked to no-data (high ground), and never reported missing then
  const t = within(series.t850a, w);
  let airMass = 'none';
  if (t.length) {
    const m = mean(t);
    airMass = m >= 5 ? 'much-warmer' : m >= 2 ? 'warmer' : m <= -5 ? 'much-cooler' : m <= -2 ? 'cooler' : 'near-normal';
  }
  const tempMissing = lead <= 10 && !series.t850a && !series.t2m;

  // High and low through day 7 from t2m (K), "near" because 6-hourly steps miss the extremes by a degree or two
  let hi, lo;
  const tt = within(series.t2m, w);
  if (lead <= 7 && tt.length >= 2) { hi = Math.max(...tt) - 273.15; lo = Math.min(...tt) - 273.15; }

  // Pattern confidence
  const anyData = z.length || wet !== 'none' || t.length || sd.length;
  let confidence = 'none';
  if (anyData) {
    const c = confidenceAt((lead - 0.5) * 24, { spreadDam, hasSpread: sd.length > 0 });
    confidence = c.level;
    if (lead > 3 && (wet === 'light' || wet === 'moderate' || wet === 'heavy') && confidence === 'high') confidence = 'medium';
  }
  return {
    dayIndex, date: w.date, lead, pattern, signal, anomDam, spreadDam, stormTrack,
    wet, wetPhrase, wetSource, rainMm, pr1, pr10, prEndHour, rainMissing, airMass, tempMissing, hi, lo, confidence,
    partial: false,
  };
}

export const hasData = P.hasStoryData;
export const coherent = P.coherent;

// ---------- sentences (the one implementation is phrases.js; these are the stable entry points) ----------

/** One plain sentence about the first seven days (consequence plus cause, at most 110 characters). */
export function summarize(days, opts = {}) { return P.summary(days, opts); }
/** Day line for a focused place. `opts.sample` swaps "not in this run" for "not in this sample". */
export function dayLine(label, dayName, cls, opts = {}) { return P.dayLine(cls, { ...opts, label, dayName }); }

// ---------- reading the data facade ----------

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const NP_BOX = { latMin: 10, latMax: 75, lonMin: 150, lonMax: 310 };
const mod360 = (x) => ((x % 360) + 360) % 360;

/** Which domain the facade samples for this place (the finest that covers it). */
export function domainFor(fieldId, lat, lon) {
  const doms = mf()?.fields?.[fieldId]?.domains || ['g1'];
  const l = mod360(lon);
  const inNp = lat >= NP_BOX.latMin && lat <= NP_BOX.latMax && l >= NP_BOX.lonMin && l <= NP_BOX.lonMax;
  if (inNp && doms.includes('np05')) return 'np05';
  return doms.includes('g1') ? 'g1' : doms[0];
}

/** Fields the story may combine: for a multi-case manifest only the active case's (cases are never mixed). */
function allowedFields() {
  const m = mf();
  if (!m) return null;
  if (isMultiCase(m)) return new Set(m.cases[activeCaseId()]?.fields || []);
  return new Set(Object.keys(m.fields || {}));
}
const STORY_FIELDS = ['z500a', 'z500sd', 'tp6', 't850a', 't2m', 'pr1', 'pr10', 'ws250'];

/** Synchronous series for a place from whatever the facade has loaded (windows left empty). */
export function seriesFor(lat, lon) {
  const ok = allowedFields();
  const get = (f, pattern) => {
    if (ok && !ok.has(f)) return null;
    try { return (pattern && data.patternSeries?.(f, lat, lon)) || data.sampleSeries(f, lat, lon) || null; } catch { return null; }
  };
  let ws = null;
  if (!ok || ok.has('ws250')) {
    try {
      const steps = data.fieldSteps('ws250');
      const values = Float32Array.from(steps, (_, i) => { const v = data.maxWithin('ws250', lat, lon, 250, i); return v == null ? NaN : v; });
      if (steps.length && values.some(finite)) ws = { steps, values };
    } catch { ws = null; }
  }
  // hasMean: the run carries the ensemble mean (z500em), so the zones table has its blend and mean rows (DESIGN-SPEC
  // 7.2). Unknown (no manifest) counts as no mean: nothing then implies a blend toward an average.
  return {
    hasMean: !!ok?.has('z500em') && (typeof data.hasMean === 'function' ? data.hasMean({ lat, lon }) : true), // a place no mean covers is the single run, say so
    windows: [], z500a: get('z500a', true), z500sd: get('z500sd'), tp6: get('tp6'), t850a: get('t850a'),
    t2m: get('t2m'), pr1: get('pr1'), pr10: get('pr10'), ws250max: ws,
  };
}

/** Loads every chunk of the story fields for the place's domain (the facade samples whatever is loaded). */
export async function ensureStoryData(lat, lon) {
  const ok = allowedFields();
  const jobs = [];
  const fields = data.patternSeries ? [...STORY_FIELDS, 'z500em'] : STORY_FIELDS;
  for (const f of fields) {
    if (ok && !ok.has(f)) continue;
    let steps; try { steps = data.fieldSteps(f); } catch { continue; }
    if (!steps?.length) continue;
    const dom = domainFor(f, lat, lon);
    const load = data.ensureAll || ((ff, dd) => data.ensure(ff, dd, steps[0]));
    jobs.push(Promise.resolve(load(f, dom)).catch(() => {}));
  }
  await Promise.all(jobs);
}

/**
 * Where "day 1" starts: now when it falls inside a live run's range, else the first valid time (a recorded forecast
 * starts at its own first local day; old sample data is rebased and old by the time it is opened).
 */
export function anchorMs(now = Date.now()) {
  const o = vt(0).getTime();
  if (!isLive(mf())) return o;
  let last = o;
  try { const st = data.fieldSteps('z500a'); if (st.length) last = vt(st[st.length - 1]).getTime(); } catch { /* origin only */ }
  return now >= o && now <= last ? now : o;
}

// ---------- building the days ----------

const SPAN_FIELDS = ['z500a', 'z500sd', 'tp6', 't850a', 't2m', 'pr1', 'pr10', 'ws250max'];
/** [first, last] forecast hour across the story fields that hold any value, or null. */
function spanOf(series) {
  let a = Infinity, b = -Infinity;
  for (const k of SPAN_FIELDS) {
    const f = series[k];
    if (!f?.steps) continue;
    f.steps.forEach((s, i) => { if (finite(f.values[i])) { if (s < a) a = s; if (s > b) b = s; } });
  }
  return a <= b ? [a, b] : null;
}

/**
 * The pure core of buildDays: local days from the day containing fromMs, up to the day containing toMs (at most 15),
 * keeping only days the data overlap. `o` = {originMs, fromMs, toMs, anchorMs, offsetMin, nowMs?, manifest?, placeName?}.
 */
export function daysFromSeries(series, o) {
  const { originMs, offsetMin } = o;
  const m = o.manifest || null;
  const probe = dayWindowsAt(originMs, o.fromMs, 16, offsetMin);
  const firstAfter = probe.findIndex((w) => originMs + w.startH * HOUR > o.toMs);
  const asked = probe.slice(0, firstAfter < 1 ? (firstAfter === 0 ? 1 : 15) : Math.min(firstAfter, 15));
  const span = spanOf(series);
  const windows = span ? asked.filter((w) => w.startH < span[1] && w.endH > span[0]) : [];
  series.windows = windows;
  series.originMs = originMs;
  series.offsetMin = offsetMin;
  const base = dayWindowsAt(originMs, o.anchorMs ?? o.fromMs, 1, offsetMin)[0].startH;
  const days = windows.map((w, i) => {
    const c = classifyDay(series, i, Math.max(1, Math.round((w.startH - base) / 24) + 1));
    c.partial = w.startH < span[0] || w.endH > span[1];
    return c;
  });

  const nowMs = o.nowMs ?? Date.now();
  const kind = !m || isLive(m) ? 'live' : isRecorded(m) ? 'recorded' : 'multi';
  const stale = m ? staleness(m, nowMs) : 'fresh';
  const nowH = (nowMs - originMs) / HOUR;
  const inRun = span && nowH >= span[0] && nowH <= span[1];
  const todayMode = kind === 'live' && inRun && stale !== 'very-stale';
  const todayDate = todayMode ? localDate(nowMs, offsetMin) : null;
  if (todayMode) days.forEach((c) => { if (c.date === todayDate) { c.today = true; c.passedH = nowH; } });
  const requested = asked.length;
  let nextUpdate = null;
  if (kind === 'live' && days.length < requested && m?.generated) {
    const g = Date.parse(String(m.generated).length === 17 ? m.generated.replace(/Z$/, ':00Z') : m.generated);
    if (g === g) { let t = g + 12 * HOUR; while (t < nowMs) t += 12 * HOUR; nextUpdate = new Date(t); }
  }
  const coverage = {
    requested, withData: days.length, firstDate: days[0]?.date ?? null, lastDate: days[days.length - 1]?.date ?? null,
    nextUpdate, todayDate, kind, staleness: stale, offsetMin, viewerOffset: viewerOffsetMinutes(nowMs), placeName: o.placeName || '',
    nowH: todayMode ? nowH : null, nowLocalHour: todayMode ? (((nowMs + offsetMin * MIN) % DAY) + DAY) % DAY / HOUR : 0,
  };
  // each day class carries the coverage (not enumerable), so dayLine(c) can say today/tomorrow and the place's zone
  days.forEach((c) => Object.defineProperty(c, 'coverage', { value: coverage, enumerable: false, writable: true, configurable: true }));
  for (const [k, v] of Object.entries({ days, series, windows, coverage })) Object.defineProperty(days, k, { value: v, enumerable: false, writable: true, configurable: true });
  return days;
}

function context(lat, lon, from, to, opts) {
  const origin = vt(0).getTime();
  const anchor = opts.anchor ?? anchorMs(opts.now);
  const abs = (v) => (v instanceof Date ? +v : typeof v === 'number' && Math.abs(v) < 1e6 ? anchor + v * DAY : +v);
  // A place's days are binned in its own local time, from its longitude to the nearest hour. tz 'viewer' (the old
  // home and trip default) now means the same: the place's own days, so every viewer sees the same columns.
  const offsetMin = typeof opts.tz === 'number' ? opts.tz * 60 : offsetMinutes(lon);
  return { originMs: origin, fromMs: abs(from), toMs: abs(to), anchorMs: anchor, offsetMin, nowMs: opts.now, manifest: mf(), placeName: opts.placeName };
}

/**
 * Day classes for a place, from the local day of `from` to the day of `to`, at most 15 days, only the days that have
 * data. `from` and `to` are Dates or epoch ms; a number under a million counts days from the anchor (0, 6 is seven
 * days from day 1). Awaits the chunks it needs.
 * @param {{tz?:'viewer'|number, anchor?:number, now?:number, placeName?:string}} opts tz: a UTC offset in hours
 *   overrides the longitude-derived one; anchor is the start of day 1 for lead grading (default anchorMs()); now is the clock
 * @returns {Promise<object[] & {days:object[], series:object, coverage:object, windows:object[]}>}
 */
export async function buildDays(lat, lon, from, to, opts = {}) {
  await ensureStoryData(lat, lon);
  return daysFromSeries(seriesFor(lat, lon), context(lat, lon, from, to, opts));
}

/**
 * Notability of a place over the first seven days (docs/SPEC.md section 2): max |z500a| in dam over 6·f, with
 * f = clamp(|lat| / 45, 0.5, 1.5), plus the precipitation sum in mm over 10. Synchronous; uses what is loaded.
 * The reason is the place's reason phrase ("Rain likely from Sunday", "Under a trough from Sun 1 Jan").
 * @returns {{score:number, reason:string}}
 */
export function notability(lat, lon) {
  const s = seriesFor(lat, lon);
  const has = (f) => f && f.values.some(finite);
  if (!has(s.z500a) && !has(s.tp6)) return { score: 0, reason: '' };
  const f = clamp(Math.abs(lat) / 45, 0.5, 1.5);
  const hMax = 168;
  let zPeak = 0;
  if (s.z500a) s.z500a.steps.forEach((st, i) => { const v = Math.abs(s.z500a.values[i]) / 10; if (st <= hMax && finite(v) && v > zPeak) zPeak = v; });
  let rain = 0;
  if (s.tp6) s.tp6.steps.forEach((st, i) => { if (st <= hMax && finite(s.tp6.values[i])) rain += s.tp6.values[i]; });
  const score = zPeak / (6 * f) + rain / 10;
  let reason = '';
  try {
    const a = anchorMs();
    reason = P.reasonPhrase(daysFromSeries(s, context(lat, lon, a, a + 6 * DAY, { anchor: a })));
  } catch { reason = ''; }
  return { score, reason };
}

// ---------- the strip ----------

/**
 * The strip (DESIGN-SPEC section 3.3). Legacy call `stripSVG(days, series, 'dark' | 'light', {width, activeDay, label})`
 * and the new `stripSVG(days, series, {compact, range, phone, width, activeDay, label, ground, colors})` both work; the
 * drawing is story/strip.js.
 */
export function stripSVG(days, series = days?.series, themeOrOpts = 'dark', opts = {}) {
  const o = typeof themeOrOpts === 'string' ? { ...opts, ground: themeOrOpts === 'light' ? 'paper' : 'night' } : { ...themeOrOpts };
  return drawStrip(days, series, o);
}
