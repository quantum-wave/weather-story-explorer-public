// Story functions (SPEC section 6): day classes, summary sentence, day line, notability, strip.
// classifyDay, summarize and dayLine are pure. buildDays, notability and stripSVG read the data facade
// or the DOM. All wording lives in phrases.js.
import * as data from '../data/index.js';
import { bus } from '../state.js';
import { anomalyRGBA } from '../render/colormap.js';
import * as P from './phrases.js';

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const pad = (n) => String(n).padStart(2, '0');

let manifest = null;
export function setManifest(m) { manifest = m; }
bus.on('data:manifest', setManifest);
const mf = () => manifest || data.getManifest?.() || null;
/** Valid time for the story: sample data is read as case A at its real dates, whichever case the map shows. */
const vt = (h) => data.validTime(h, mf()?.sample ? 'A' : undefined);

// ---------- day windows ----------

/**
 * Local-day windows in forecast hours.
 * tz 'viewer': days in the viewer's time zone (home and trips); an integer: a fixed UTC offset in hours
 * (other pins: round(lon / 15)). Returns [{date: 'YYYY-MM-DD', startH, endH}] relative to originMs (step 0).
 */
export function dayWindows(originMs, startMs, count, tz = 'viewer') {
  const out = [];
  if (tz === 'viewer') {
    const d0 = new Date(startMs);
    let s = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate());
    for (let i = 0; i < count; i++) {
      const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1);
      out.push({ date: `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`, startH: (s - originMs) / HOUR, endH: (e - originMs) / HOUR });
      s = e;
    }
  } else {
    const off = tz * HOUR;
    let s = Math.floor((startMs + off) / DAY) * DAY - off;
    for (let i = 0; i < count; i++) {
      out.push({ date: new Date(s + off).toISOString().slice(0, 10), startH: (s - originMs) / HOUR, endH: (s + DAY - originMs) / HOUR });
      s += DAY;
    }
  }
  return out;
}

/** Fixed offset for a pin that is not home or a trip. */
export const tzForLon = (lon) => Math.round(lon / 15);

const dayDate = (date) => new Date(date + 'T12:00:00Z');
/** 'Thu' for 'YYYY-MM-DD' (zone independent). */
export const weekdayShort = (date) => dayDate(date).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
export const weekdayInitial = (date) => 'SMTWTFS'[dayDate(date).getUTCDay()];

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
 * @param {{windows:{date:string,startH:number,endH:number}[], z500a?:object, z500sd?:object,
 *   ws250max?:object, tp6?:object, t850a?:object}} series fields are {steps (forecast hours), values}
 *   in the units of SPEC section 9 (gpm, m/s, mm, K); a missing field is null or absent.
 * @param {number} dayIndex index into series.windows
 * @param {number} lead 1 for the first day
 * @returns {import('../contract.js').DayClass}
 */
export function classifyDay(series, dayIndex, lead) {
  const w = series.windows[dayIndex];
  const nextW = series.windows[dayIndex + 1];

  // Pattern (dam)
  const z = within(series.z500a, w).map((v) => v / 10);
  let pattern = 'none';
  if (z.length) {
    const m = mean(z), lo = Math.min(...z), hi = Math.max(...z);
    const nz = nextW ? within(series.z500a, nextW).map((v) => v / 10) : [];
    const nm = nz.length ? mean(nz) : null;
    if (m >= 6) pattern = 'ridge';
    else if (m <= -6) pattern = 'trough';
    else if (lo <= -6 || (nm !== null && nm <= -6)) pattern = 'trough-arriving';
    else if (hi >= 6 || (nm !== null && nm >= 6)) pattern = 'ridge-building';
    else pattern = 'near-normal';
  }
  const jet = within(series.ws250max, w);
  const stormTrack = jet.length > 0 && Math.max(...jet) >= 50;

  // Wet
  const rain = within(series.tp6, w, true);
  let wet = 'none';
  let wetPhrase;
  if (lead > 10) wetPhrase = '';
  else if (!rain.length) wetPhrase = P.NOT_IN_RUN;
  else {
    const sum = rain.reduce((x, y) => x + y, 0);
    wet = sum < 1 ? 'dry' : sum < 5 ? 'light' : sum <= 20 ? 'moderate' : 'heavy';
    wetPhrase = P.wetPhraseFor(wet, lead);
  }
  if (lead > 10) wet = 'none';

  // Air mass (K)
  const t = within(series.t850a, w);
  let airMass = 'none';
  if (t.length) {
    const m = mean(t);
    airMass = m >= 5 ? 'much-warmer' : m >= 2 ? 'warmer' : m <= -5 ? 'much-cooler' : m <= -2 ? 'cooler' : 'near-normal';
  }

  // Pattern confidence
  const anyData = z.length || rain.length || t.length || within(series.z500sd, w).length;
  let confidence = 'none';
  if (anyData) {
    if (lead > 10) confidence = 'pattern-only';
    else {
      const sd = within(series.z500sd, w).map((v) => v / 10);
      if (sd.length) { const m = mean(sd); confidence = m < 3 ? 'high' : m <= 6 ? 'medium' : 'low'; }
      else confidence = lead <= 4 ? 'high' : lead <= 7 ? 'medium' : 'low';
      if (lead >= 8 && confidence === 'high') confidence = 'medium';
      if (lead > 3 && (wet === 'light' || wet === 'moderate' || wet === 'heavy') && confidence === 'high') confidence = 'medium';
    }
  }
  return { dayIndex, date: w.date, lead, pattern, stormTrack, wet, wetPhrase, airMass, confidence };
}

export const hasData = (c) => c.pattern !== 'none' || c.wet === 'dry' || c.wet === 'light' || c.wet === 'moderate' || c.wet === 'heavy' || c.airMass !== 'none';
const wetKnown = (c) => c.wet !== 'none';
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const upperFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * What the day feels like. Without rain data a live run still says "Settled"/"Unsettled" from the pattern; a
 * sample has no rain, so it states only what it has: the pattern itself (`patternOnly`).
 */
function consequence(c, patternOnly = false) {
  const fam = P.PATTERN_FAMILY[c.pattern];
  const base = wetKnown(c) ? upperFirst(c.wetPhrase) : patternOnly ? upperFirst(P.PATTERN_PLAIN[c.pattern] || '') : P.FAMILY_CONSEQUENCE[fam];
  const tail = P.AIR_MASS_TAIL[c.airMass] || '';
  if (!base) return tail ? upperFirst(tail.replace(/^ and /, '')) : '';
  return base + tail;
}
/**
 * Meteorological coherence: a ridge (high pressure aloft) does not go with moderate or heavy rain, and a trough
 * does not go with a dry day. When the data say so anyway we state both facts but never link them ("rain under a
 * ridge", "dry as a trough moves in"), and a storm track is not reported overhead of a ridge.
 */
export function coherent(family, c) {
  if (family === 'ridge') return c.wet !== 'moderate' && c.wet !== 'heavy';
  if (family === 'trough') return c.wet !== 'dry';
  return true;
}
const spellKey = (c) => {
  const air = c.airMass === 'warmer' || c.airMass === 'much-warmer' ? 'warm' : c.airMass === 'cooler' || c.airMass === 'much-cooler' ? 'cool' : 'n';
  if (wetKnown(c)) return `${c.wet === 'dry' ? 'dry' : 'wet'}|${air}`;
  return `p:${P.PATTERN_FAMILY[c.pattern]}|${air}`;
};
const CONF_RANK = { low: 0, 'pattern-only': 0, medium: 1, high: 2 };

/**
 * One plain sentence about the days given (SPEC section 6). Only days with lead 1 to 7 count; days without
 * data are skipped and the sentence says where the data stops.
 * @param {import('../contract.js').DayClass[]} days
 */
export function summarize(days, opts = {}) {
  const week = days.filter((d) => d.lead <= 7);
  const used = week.filter(hasData);
  if (!used.length) return '';
  const name = (c) => weekdayShort(c.date);
  const first = used[0];
  const idx = used.findIndex((c, i) => i > 0 && spellKey(c) !== spellKey(first));
  let sentence, conf;
  if (idx < 0) {
    const last = used[used.length - 1];
    const span = used.length >= 7 ? 'all week' : used.length === 1 ? `on ${name(first)}` : `through ${name(last)}`;
    const fam = P.PATTERN_FAMILY[first.pattern];
    const po = !!opts.sample && !wetKnown(first);
    const linked = !po && used.every((c) => coherent(P.PATTERN_FAMILY[c.pattern], c)) && coherent(fam, first);
    const under = !linked ? '' : fam === 'ridge' ? P.PATTERN_PLAIN.ridge : fam === 'trough' ? P.PATTERN_PLAIN.trough : '';
    const onItsWay = po && used.every((c) => c.pattern === first.pattern) && (first.pattern === 'trough-arriving' || first.pattern === 'ridge-building');
    sentence = onItsWay
      ? `${upperFirst(first.pattern === 'trough-arriving' ? P.PATTERN_PLAIN.trough : P.PATTERN_PLAIN.ridge)} ${first.pattern === 'trough-arriving' ? 'moves in' : 'builds'} by ${name(last)}.`
      : `${consequence(first, po)} ${span}${under ? ' under ' + under : ''}.`;
    const known = used.map((c) => c.confidence).filter((c) => c !== 'none');
    conf = known.sort((a, b) => CONF_RANK[a] - CONF_RANK[b])[0] || 'none';
  } else {
    const c2 = used[idx];
    const poFirst = !!opts.sample && !wetKnown(first), poSecond = !!opts.sample && !wetKnown(c2);
    const part1 = `${consequence(first, poFirst)} ${idx === 1 ? 'on' : 'through'} ${name(used[idx - 1])}`;
    let fam = P.PATTERN_FAMILY[c2.pattern];
    if (fam === 'normal' || fam === 'none') fam = P.PATTERN_FAMILY[used[idx - 1].pattern];
    const cause = !poSecond && coherent(fam, c2) ? P.CAUSE[fam] || '' : '';
    const lastOne = idx === used.length - 1;
    const part2 = `${lowerFirst(consequence(c2, poSecond))} ${lastOne ? 'on' : 'from'} ${name(c2)}${cause ? ' ' + cause : ''}`;
    sentence = `${part1}; ${part2}.`;
    conf = c2.confidence !== 'none' ? c2.confidence : first.confidence;
  }
  const out = [sentence];
  // Sample spreads are not forecast spreads (SPEC section 11): no confidence claim in sample mode.
  const phrase = opts.sample ? '' : P.SUMMARY_CONFIDENCE[conf];
  if (phrase) out.push(phrase);
  const lastWithData = used[used.length - 1];
  if (week.length && lastWithData.lead < Math.min(7, week[week.length - 1].lead) ) out.push(P.EMPTY.noData(name(lastWithData)) + '.');
  return out.join(' ');
}

/**
 * Day line for a focused place. `opts.sample` swaps "not in this run" for "not in this sample".
 */
export function dayLine(label, dayName, cls, opts = {}) {
  const miss = opts.sample ? 'in this sample' : 'in this run';
  const parts = [];
  let noRain = false, noAir = false;
  if (cls.wet === 'none') { if (cls.wetPhrase !== '') noRain = true; }
  else if (cls.wet === 'dry' || cls.lead > 7) parts.push(cls.wetPhrase);
  else parts.push(`${cls.wetPhrase} in the latest forecast`);
  if (cls.airMass !== 'none') parts.push(P.AIR_MASS_WORDS[cls.airMass]);
  else if (cls.lead <= 10) noAir = true;
  const fam = P.PATTERN_FAMILY[cls.pattern];
  let pat = coherent(fam, cls) ? P.PATTERN_PLAIN[cls.pattern] : '';
  const track = cls.stormTrack && fam !== 'ridge';
  if (track) pat = pat ? `${pat}, ${P.STORM_TRACK_PLAIN}` : P.STORM_TRACK_PLAIN;
  let line = `${label} · ${dayName}:`;
  if (!hasData(cls)) return `${line} no forecast data.`;
  // consequence first: what the data say, then what it lacks
  if (parts.length) line += ` ${parts.join(', ')}${pat ? ` — ${pat}` : ''}.`;
  else if (pat) line += ` ${upperFirst(pat)}${!track && (cls.pattern === 'ridge' || cls.pattern === 'trough') ? ' overhead' : ''}.`;
  const lacking = noRain && noAir ? 'Rain and temperature aren’t' : noRain ? 'Rain isn’t' : noAir ? 'Temperature isn’t' : '';
  if (lacking) line += ` ${lacking} ${miss}.`;
  if (opts.sample) { /* sample spread is not a forecast spread: no confidence claim */ }
  else if (cls.confidence === 'pattern-only') line += ' Pattern only, not specifics.';
  else if (P.CONFIDENCE_WORDS[cls.confidence]) line += ` Pattern: ${P.CONFIDENCE_WORDS[cls.confidence]}.`;
  return line;
}

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

/** Fields the story may combine: in sample mode only case A (cases are never mixed). */
function allowedFields() {
  const m = mf();
  if (!m) return null;
  if (m.sample) return new Set(m.cases?.A?.fields || []);
  return new Set(Object.keys(m.fields || {}));
}
const STORY_FIELDS = ['z500a', 'z500sd', 'tp6', 't850a', 'ws250'];

/** Synchronous series for a place from whatever the facade has loaded (windows left empty). */
export function seriesFor(lat, lon) {
  const ok = allowedFields();
  const get = (f) => {
    if (ok && !ok.has(f)) return null;
    try { return data.sampleSeries(f, lat, lon) || null; } catch { return null; }
  };
  let ws = null;
  if (!ok || ok.has('ws250')) {
    try {
      const steps = data.fieldSteps('ws250');
      const values = Float32Array.from(steps, (_, i) => { const v = data.maxWithin('ws250', lat, lon, 250, i); return v == null ? NaN : v; });
      if (steps.length && values.some(finite)) ws = { steps, values };
    } catch { ws = null; }
  }
  return { windows: [], z500a: get('z500a'), z500sd: get('z500sd'), tp6: get('tp6'), t850a: get('t850a'), ws250max: ws };
}

/** Loads every chunk of the story fields for the place's domain (the facade samples whatever is loaded). */
export async function ensureStoryData(lat, lon) {
  const ok = allowedFields();
  const jobs = [];
  for (const f of STORY_FIELDS) {
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
 * Where "day 1" starts: now when it falls inside the loaded range, else the first valid time (sample data is
 * rebased and old by the time it is opened).
 */
export function anchorMs(now = Date.now()) {
  const o = vt(0).getTime();
  let last = o;
  try { const st = data.fieldSteps('z500a'); if (st.length) last = vt(st[st.length - 1]).getTime(); } catch { /* origin only */ }
  return now >= o && now <= last ? now : o;
}

/**
 * Day classes for a place, from the local day of `from` to the day of `to`, at most 15 days.
 * `from` and `to` are Dates or epoch ms; a number under a million counts days from the anchor (0, 7 is eight
 * days from day 1). Awaits the chunks it needs. The array carries its `series` and `windows` for stripSVG.
 * @param {{tz?:'viewer'|number, anchor?:number}} opts tz defaults to the viewer's zone (tzForLon(lon) for other
 *   pins); anchor is the start of day 1 for lead grading (default anchorMs())
 * @returns {Promise<import('../contract.js').DayClass[]>}
 */
export async function buildDays(lat, lon, from, to, opts = {}) {
  const origin = vt(0).getTime();
  const tz = opts.tz ?? 'viewer';
  const anchor = opts.anchor ?? anchorMs();
  const abs = (v) => (v instanceof Date ? +v : typeof v === 'number' && Math.abs(v) < 1e6 ? anchor + v * DAY : +v);
  const fromMs = abs(from), toMs = abs(to);
  const probe = dayWindows(origin, fromMs, 16, tz);
  const firstAfter = probe.findIndex((w) => origin + w.startH * HOUR > toMs);
  const windows = probe.slice(0, firstAfter < 1 ? (firstAfter === 0 ? 1 : 15) : Math.min(firstAfter, 15));
  await ensureStoryData(lat, lon);
  const series = seriesFor(lat, lon);
  series.windows = windows;
  const base = dayWindows(origin, anchor, 1, tz)[0].startH;
  const days = windows.map((w, i) => classifyDay(series, i, Math.round((w.startH - base) / 24) + 1));
  days.series = series;
  days.windows = windows;
  return days;
}

/**
 * Notability of a place over the first seven days (SPEC section 2): max |z500a| in dam over 6·f, with
 * f = clamp(|lat| / 45, 0.5, 1.5), plus the precipitation sum in mm over 10. Synchronous; uses what is loaded.
 * @returns {{score:number, reason:string}}
 */
export function notability(lat, lon) {
  const s = seriesFor(lat, lon);
  const has = (f) => f && f.values.some(finite);
  if (!has(s.z500a) && !has(s.tp6)) return { score: 0, reason: '' };
  const f = clamp(Math.abs(lat) / 45, 0.5, 1.5);
  const hMax = 168;
  let zPeak = 0, zStep = 0;
  if (s.z500a) s.z500a.steps.forEach((st, i) => { const v = Math.abs(s.z500a.values[i]) / 10; if (st <= hMax && finite(v) && v > zPeak) { zPeak = v; zStep = i; } });
  let rain = 0;
  if (s.tp6) s.tp6.steps.forEach((st, i) => { if (st <= hMax && finite(s.tp6.values[i])) rain += s.tp6.values[i]; });
  const score = zPeak / (6 * f) + rain / 10;
  // Reason: the wettest local day if it is notable, else the strongest pattern day, else settled.
  let reason = has(s.z500a) ? 'Settled' : '';
  const perDay = new Map();
  if (s.tp6) s.tp6.steps.forEach((st, i) => { if (st > hMax || !finite(s.tp6.values[i])) return; const d = vt(st - 3).toLocaleDateString('en-CA'); perDay.set(d, (perDay.get(d) || 0) + s.tp6.values[i]); });
  let wetDay = null, wetMax = 0;
  for (const [d, v] of perDay) if (v > wetMax) { wetMax = v; wetDay = d; }
  if (wetMax > 20) reason = `Heavy rain ${weekdayShort(wetDay)}`;
  else if (wetMax >= 5) reason = `Rain ${weekdayShort(wetDay)}`;
  else if (zPeak >= 6) {
    const kind = s.z500a.values[zStep] > 0 ? 'Ridge' : 'Trough';
    reason = `${kind} ${weekdayShort(vt(s.z500a.steps[zStep]).toLocaleDateString('en-CA'))}`;
  } else if (wetMax >= 1) reason = `Light rain ${weekdayShort(wetDay)}`;
  return { score, reason };
}

// ---------- the strip ----------

const NS = 'http://www.w3.org/2000/svg';
let stripId = 0;
function svgEl(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
const BAR_H = { dry: 1.5, light: 5, moderate: 10, heavy: 16 };

/**
 * The strip (SPEC section 6): 56 px tall. Top: the z500a line filled in the anomaly colours inside a band of
 * +/- z500sd; bottom: daily rain bars; day initials beneath; days without data or past day 10 hatched.
 * Each day is a tappable rect with data-day and data-t (forecast hour to scrub to).
 * @param {import('../contract.js').DayClass[]} days
 * @param {object} series as returned by seriesFor with windows set (defaults to days.series)
 * @param {'dark'|'light'} theme
 * @param {{width?:number, activeDay?:number, label?:(c:object)=>string}} opts
 */
export function stripSVG(days, series = days?.series, theme = 'dark', opts = {}) {
  const width = opts.width || 336;
  const H = 56, mid = 13, chartH = 26, barsBottom = 44;
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${H}`, width, height: H, class: 'strip', role: 'group', 'aria-label': 'Forecast strip for the coming days' });
  const n = days?.length || 0;
  if (!n || !series?.windows?.length) return svg;
  const wins = series.windows;
  const h0 = wins[0].startH, h1 = wins[n - 1].endH;
  const colW = width / n;
  const X = (h) => ((h - h0) / (h1 - h0)) * width;
  const id = `hatch${++stripId}`;
  const defs = svgEl('defs', {}, svg);
  const pat = svgEl('pattern', { id, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 6, style: 'stroke:var(--hairline);stroke-width:2' }, pat);

  // zero line
  svgEl('line', { x1: 0, y1: mid, x2: width, y2: mid, style: 'stroke:var(--hairline);stroke-width:1' }, svg);

  // anomaly line, fill, spread band
  const z = series.z500a;
  const PX = 12 / 18; // px per dam
  if (z && z.steps.length) {
    const pts = [];
    z.steps.forEach((st, i) => {
      const v = z.values[i];
      if (!finite(v) || st < h0 || st > h1) return;
      pts.push({ x: X(st), dam: clamp(v / 10, -24, 24), sd: series.z500sd ? interp(series.z500sd, st) / 10 : 0 });
    });
    const rgba = (dam) => { const c = anomalyRGBA(dam, theme); return c[3] ? `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(3)})` : null; };
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const fill = rgba((a.dam + b.dam) / 2);
      if (!fill) continue;
      svgEl('path', { d: `M${a.x} ${mid}L${a.x} ${mid - a.dam * PX}L${b.x} ${mid - b.dam * PX}L${b.x} ${mid}Z`, style: `fill:${fill};stroke:${fill};stroke-width:.5` }, svg);
    }
    if (pts.length > 1 && pts.some((p) => p.sd * PX >= 0.6)) {
      const up = pts.map((p) => `${p.x},${mid - (p.dam + p.sd) * PX}`);
      const dn = pts.slice().reverse().map((p) => `${p.x},${mid - (p.dam - p.sd) * PX}`);
      svgEl('polygon', { points: [...up, ...dn].join(' '), style: 'fill:var(--ink);opacity:.14' }, svg);
    }
    if (pts.length === 1) svgEl('circle', { cx: pts[0].x, cy: mid - pts[0].dam * PX, r: 2.5, style: 'fill:var(--ink)' }, svg);
    if (pts.length > 1) svgEl('path', { d: 'M' + pts.map((p) => `${p.x} ${mid - p.dam * PX}`).join('L'), style: 'fill:none;stroke:var(--ink);stroke-width:1.25;stroke-linejoin:round' }, svg);
  }

  let patternOnlyDone = false;
  days.forEach((c, i) => {
    const x = i * colW;
    // rain bars
    if (BAR_H[c.wet] && c.lead <= 10) {
      const bh = BAR_H[c.wet];
      svgEl('rect', { x: x + colW * 0.2, y: barsBottom - bh, width: colW * 0.6, height: bh, rx: 1.5, class: `bar bar-${c.wet}`, style: c.wet === 'dry' ? 'fill:var(--hairline)' : 'fill:var(--rain)' }, svg);
    }
    const noData = !hasData(c);
    const past10 = c.lead > 10;
    if (noData || past10) svgEl('rect', { x, y: 0, width: colW, height: barsBottom + 2, fill: `url(#${id})`, class: noData ? 'hatch-nodata' : 'hatch-pattern-only', opacity: noData ? 1 : 0.6 }, svg);
    if (past10 && !noData && !patternOnlyDone) {
      patternOnlyDone = true;
      const room = width - x;
      const t = svgEl('text', { x: room >= 84 ? x + 4 : width - 2, y: 9, 'text-anchor': room >= 84 ? 'start' : 'end', style: 'fill:var(--ink-2);font:12px var(--font-ui)', class: 'strip-note' }, svg);
      t.textContent = 'pattern only';
    }
    const t = svgEl('text', { x: x + colW / 2, y: 55, 'text-anchor': 'middle', class: 'strip-initial', style: `fill:${i === opts.activeDay ? 'var(--ink)' : 'var(--ink-2)'};font:${i === opts.activeDay ? 600 : 400} 12px var(--font-ui)` }, svg);
    t.textContent = weekdayInitial(c.date);
    if (i === opts.activeDay) svgEl('rect', { x: x + 2, y: 0, width: colW - 4, height: 48, rx: 4, style: 'fill:none;stroke:var(--ring);stroke-width:1' }, svg);
    const w = wins[i];
    const zs = series.z500a?.steps;
    const first = zs?.[0] ?? w.startH, last = zs?.[zs.length - 1] ?? w.endH;
    const lo = Math.max(w.startH, first), hi = Math.min(w.endH, last);
    const mid = hi > lo ? (lo + hi) / 2 : Math.min(last, Math.max(first, w.startH)); // never past the loaded range
    const tap = svgEl('rect', { x, y: 0, width: colW, height: H, fill: 'transparent', class: 'strip-day', role: 'button', tabindex: 0, 'data-day': i, 'data-t': mid.toFixed(1), 'aria-label': opts.label ? opts.label(c) : `${weekdayShort(c.date)}` }, svg);
    tap.style.cursor = 'pointer';
  });
  return svg;
}

function interp(f, h) {
  const s = f.steps, v = f.values;
  if (!s.length) return 0;
  if (h <= s[0]) return finite(v[0]) ? v[0] : 0;
  for (let i = 0; i + 1 < s.length; i++) if (h <= s[i + 1]) {
    const a = v[i], b = v[i + 1];
    if (!finite(a) || !finite(b)) return 0;
    return a + ((b - a) * (h - s[i])) / (s[i + 1] - s[i]);
  }
  return finite(v[v.length - 1]) ? v[v.length - 1] : 0;
}
