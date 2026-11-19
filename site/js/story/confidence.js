// One confidence module (DESIGN-SPEC section 7.2): the zones table, the no-clear-signal rule and the confidence level.
// Every caption in the app (timeline, legend, guide, cards, "How sure") is taken from here. Pure.

/** Hour at which the blend from the single run to the ensemble mean starts, and at which the mean takes over. */
export const BLEND_START_H = 168;
export const BLEND_END_H = 240;
/** The ensemble spread (dam) from which a mean anomaly smaller than it reads as "forecasts disagree". */
export const SIGNAL_MIN_SPREAD_DAM = 4;

export const NO_CLEAR_SIGNAL = 'No clear signal yet: forecasts disagree';

/** The captions of the zones table, exported so no surface types its own copy. */
export const CAPTIONS = Object.freeze({
  hres: 'one high-resolution forecast',
  blend: 'moving to the average of 51 forecasts · broad pattern',
  mean: 'average of 51 forecasts · pattern only',
  'hres-late': 'one forecast, no ensemble average in this run · pattern only',
});

const ROWS = Object.freeze({
  hres: { from: 0, to: BLEND_START_H, kind: 'hres', days: [1, 7], source: 'run', texture: 'solid' },
  blend: { from: BLEND_START_H, to: BLEND_END_H, kind: 'blend', days: [8, 10], source: 'blend', texture: 'dashed' },
  mean: { from: BLEND_END_H, to: 360, kind: 'mean', days: [11, 15], source: 'mean', texture: 'hatch' },
  late: { from: BLEND_START_H, to: 360, kind: 'hres-late', days: [8, 15], source: 'run', texture: 'hatch' },
});

/**
 * The zones for a run of `maxStep` forecast hours (default 360), non-overlapping, `to` exclusive except the last.
 * With no ensemble mean the last two rows are one `hres-late` row. A run shorter than a zone ends that zone at maxStep.
 * @returns {{from:number,to:number,kind:'hres'|'blend'|'mean'|'hres-late',caption:string,texture:string,days:number[],source:string}[]}
 */
export function zones(maxStep = 360, { hasMean = true } = {}) {
  const rows = hasMean ? [ROWS.hres, ROWS.blend, ROWS.mean] : [ROWS.hres, ROWS.late];
  const out = [];
  for (const r of rows) {
    if (r.from > 0 && r.from >= maxStep) break;
    out.push({ ...r, to: Math.min(r.to, maxStep), days: r.days.slice(), caption: CAPTIONS[r.kind] });
  }
  return out;
}

/** The short note a zone carries on the strip: the part of its caption after " · " ('broad pattern', 'pattern only'), or '' (hres). */
export function zoneNote(zone) {
  const c = zone?.caption || '';
  const i = c.lastIndexOf(' · ');
  return i >= 0 ? c.slice(i + 3) : '';
}

/** The zone holding forecast hour t (the last zone is closed at its end). Null before 0 or past the last zone. */
export function zoneAt(t, maxStep = 360, opts = {}) {
  const z = zones(maxStep, opts);
  if (!(t >= 0)) return null;
  for (let i = 0; i < z.length; i++) if (t < z[i].to || (i === z.length - 1 && t <= z[i].to)) return z[i];
  return null;
}

/**
 * 'none' where the ensemble spread is known, is at least 4 dam and the mean anomaly is smaller than the spread (a mean
 * shrinks toward zero when its members disagree, which would read as "near normal"); otherwise 'clear'.
 */
export function signalAt({ anomDam, spreadDam, hasSpread } = {}) {
  if (!hasSpread || !Number.isFinite(spreadDam) || !Number.isFinite(anomDam)) return 'clear';
  return spreadDam >= SIGNAL_MIN_SPREAD_DAM && Math.abs(anomDam) < spreadDam ? 'none' : 'clear';
}

/** Words after "Pattern: " (and the stand-alone phrase for pattern-only). */
export const CONFIDENCE_WORDS = Object.freeze({
  high: 'confident',
  medium: 'fairly sure of the timing',
  low: 'timing uncertain',
  'pattern-only': 'pattern only, not specifics',
  none: '',
});

/**
 * How sure the timing is at a forecast hour (docs/SPEC.md section 6). With a spread (dam): under 3 high, 3 to 6
 * medium, above 6 low. Without: days 1-4 high, 5-7 medium, 8-10 low. Days 8-10 are at most medium; beyond day 10 the
 * answer is 'pattern-only'. A spread that is not a positive number returns level 'none' with the reason, never a
 * "confident" claim from nothing (UX-8).
 * @returns {{level:'high'|'medium'|'low'|'pattern-only'|'none', phrase:string, source:'spread'|'lead'|'none', reason?:string}}
 */
export function confidenceAt(tHours, { spreadDam, hasSpread } = {}) {
  const lead = Math.max(1, Math.ceil((tHours || 0) / 24));
  const out = (level, source, reason) => ({ level, phrase: CONFIDENCE_WORDS[level], source, ...(reason ? { reason } : {}) });
  if (lead > 10) return out('pattern-only', hasSpread ? 'spread' : 'lead', 'beyond day 10 only the pattern is forecast');
  let level, source;
  if (hasSpread) {
    if (!Number.isFinite(spreadDam) || spreadDam <= 0) return out('none', 'none', 'the ensemble spread is not meaningful here');
    level = spreadDam < 3 ? 'high' : spreadDam <= 6 ? 'medium' : 'low';
    source = 'spread';
  } else {
    level = lead <= 4 ? 'high' : lead <= 7 ? 'medium' : 'low';
    source = 'lead';
  }
  if (lead >= 8 && level === 'high') level = 'medium';
  return out(level, source);
}
