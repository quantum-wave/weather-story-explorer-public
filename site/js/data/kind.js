// Dataset kinds and the one run / sample formatters (DESIGN-SPEC sections 9 and 15). Pure: no DOM, no fetch, no store.
//
// Three kinds of data, two predicates:
//   live          sample is absent or false: the scheduled pipeline's run
//   multi-case    a manifest with `cases` (the old sample cases, and the synthetic fixtures); has a case switch
//   recorded      `sample: true` and no `cases`: one real run, stored and shipped as the product's sample
// No client code reads `manifest.sample` to mean "has cases": it asks isMultiCase.

const HOUR = 3600e3;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const isLive = (m) => !!m && !m.sample;
export const isMultiCase = (m) => !!m && !!m.cases;
export const isRecorded = (m) => !!m && !!m.sample && !m.cases;

/** Hours of age at which a live run counts as one missed cycle, and as old (a normal cycle is 10-22 h old). */
export const STALE_AFTER_H = 26;
export const VERY_STALE_AFTER_H = 48;

const parseUTC = (s) => Date.parse(String(s).length === 17 ? String(s).replace(/Z$/, ':00Z') : s);

/** Epoch ms of the run's origin (forecast hour 0), or NaN. */
export const runMs = (m) => (m?.run ? parseUTC(m.run) : NaN);

/** Hours between the run's origin and `now` (a Date or epoch ms; default the clock). NaN without a run. */
export function ageHours(m, now = Date.now()) {
  return (+now - runMs(m)) / HOUR;
}

/**
 * 'fresh' under 26 h, 'stale' up to 48 h, 'very-stale' beyond, for a live run. A recorded or multi-case dataset is
 * 'recorded': it is not live, so it never goes stale.
 */
export function staleness(m, now = Date.now()) {
  if (!isLive(m)) return 'recorded';
  const a = ageHours(m, now);
  if (!(a === a)) return 'fresh';
  return a < STALE_AFTER_H ? 'fresh' : a <= VERY_STALE_AFTER_H ? 'stale' : 'very-stale';
}

const fmtDayMonth = (ms) => { const d = new Date(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

/**
 * The one sample label. Long: the manifest's `sample_label` (else a plain fallback) plus " · not live". Short, for the
 * phone chip: "Recorded · 19 Nov · not live" (the date is the run's UTC date). '' for live data.
 */
export function sampleLabel(m, { short = false } = {}) {
  if (!m || isLive(m)) return '';
  if (short) {
    const r = runMs(m);
    return `${isRecorded(m) ? 'Recorded' : 'Sample'}${r === r ? ' · ' + fmtDayMonth(r) : ''} · not live`;
  }
  const base = m.sample_label || (isRecorded(m) ? `Recorded forecast${m.model ? ' · ' + m.model : ''}` : `Sample data${m.model ? ' · ' + m.model : ''}`);
  return `${base} · not live`;
}

const modelName = (m) => (/ecmwf/i.test(m?.model || '') ? 'ECMWF' : (m?.model || 'Model'));

/**
 * The one provenance formatter: "ECMWF run Wed 18 Nov, 4 pm PST", in the viewer's zone or `zone` (an IANA name).
 * A dataset that is not live returns its sample label instead, so every caller can use this one function.
 */
export function runLabel(m, { zone } = {}) {
  if (!m) return '';
  if (!isLive(m)) return sampleLabel(m);
  const r = runMs(m);
  if (!(r === r)) return modelName(m) + ' run';
  const opts = { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' };
  if (zone) opts.timeZone = zone;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', opts).formatToParts(new Date(r)).map((x) => [x.type, x.value]));
  const time = p.minute === '00' ? `${p.hour} ${p.dayPeriod.toLowerCase()}` : `${p.hour}:${p.minute} ${p.dayPeriod.toLowerCase()}`;
  return `${modelName(m)} run ${p.weekday} ${p.day} ${p.month}, ${time} ${p.timeZoneName}`;
}
