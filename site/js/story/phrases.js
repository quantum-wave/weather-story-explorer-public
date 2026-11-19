// Every user-facing story phrase (DESIGN-SPEC sections 3.2-3.5 and 7.3). Deterministic templates, no generated text.
//
// The consequence comes from the rain fields (tp6 for days 1-3, pr1 and pr10 from day 4), the cause from the pattern
// aloft, the doubt from signalAt and confidenceAt. The words "settled" and "unsettled" appear nowhere: the sign of the
// anomaly at a pin is not a weather forecast (rain mostly falls ahead of a trough; a winter ridge can mean cold fog).
// Pure: no DOM, no data facade. Day classes come from story/index.js.
import { NO_CLEAR_SIGNAL, CONFIDENCE_WORDS as CONF } from './confidence.js';
import { addDays, daysBetween, dateLabel, dayNumberLabel, weekdayLong, dayLabel, cityName } from './localday.js';

export { NO_CLEAR_SIGNAL };
export const CONFIDENCE_WORDS = CONF;

export const MAX_SUMMARY = 110;

export const PATTERN_PLAIN = {
  ridge: 'high pressure aloft (a ridge)',
  trough: 'a dip in the jet stream (a trough)',
  'trough-arriving': 'a dip in the jet stream (a trough) arriving',
  'ridge-building': 'high pressure aloft (a ridge) building',
  'near-normal': 'a near-normal pattern aloft',
  'no-signal': '',
  none: '',
};
export const STORM_TRACK_PLAIN = 'storm track overhead';

/** The day line's cause sentence per pattern (no full stop). */
export const PATTERN_LINE = {
  ridge: 'High pressure aloft (a ridge) overhead',
  trough: 'A dip in the jet stream (a trough) overhead',
  'trough-arriving': 'A trough approaches from the west; rain is most likely just ahead of it',
  'ridge-building': 'A ridge builds: high pressure aloft, usually drier',
  'near-normal': 'Near-normal pattern aloft',
};

export const AIR_MASS_WORDS = {
  'much-warmer': 'much warmer air mass',
  warmer: 'warmer air mass',
  'near-normal': 'air mass near normal',
  cooler: 'cooler air mass',
  'much-cooler': 'much cooler air mass',
};

export const PATTERN_FAMILY = {
  ridge: 'ridge', 'ridge-building': 'ridge', trough: 'trough', 'trough-arriving': 'trough', 'near-normal': 'normal', 'no-signal': 'signal-none', none: 'none',
};

export const NOT_IN_RUN = 'not in this run';
export const NOT_IN_SAMPLE = 'not in this sample';

/** Rain consequence for days 1-3 from the day's tp6 sum (mm): under 1 dry, 1-5 light, 5-20 rain, 20 or more heavy. */
export function wetFromAmount(mm) {
  return mm < 1 ? 'dry' : mm < 5 ? 'light' : mm < 20 ? 'moderate' : 'heavy';
}
export const WET_WORDS = { dry: 'dry', light: 'light rain', moderate: 'rain', heavy: 'heavy rain' };
/** Words for a day from tp6 alone: days 1-3 as measured, days 4-7 as a lean (no probabilities in the data), 8-10 a signal. */
export function wetPhraseFor(wet, lead) {
  if (lead > 10) return '';
  if (wet === 'dry') return lead <= 7 ? 'dry' : 'no rain signal';
  if (lead <= 3) return WET_WORDS[wet];
  if (lead <= 7) return wet === 'light' ? 'rain possible' : 'rain likely';
  return 'a rain signal';
}

/** Rain consequence from day 4 on from pr1 (% chance of 1 mm or more in the 24 h window) and pr10 (10 mm or more). */
export function wetFromProbability(pr1, pr10) {
  if (Number.isFinite(pr10) && pr10 >= 40) return { wet: 'heavy', phrase: 'heavy rain possible' };
  if (pr1 >= 60) return { wet: 'moderate', phrase: 'rain likely' };
  if (pr1 >= 30) return { wet: 'light', phrase: 'a chance of rain' };
  return { wet: 'dry', phrase: 'mostly dry' };
}

const upperFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const finite = Number.isFinite;

export const SUMMARY_CONFIDENCE = {
  high: 'Pattern: confident.',
  medium: 'Pattern: fairly sure of the timing.',
  low: 'Pattern: timing uncertain.',
  'pattern-only': 'Pattern: timing uncertain.',
  none: '',
};

export const EMPTY = {
  noTrips: 'Add a trip to see what the pattern does to it',
  noPeople: 'Add someone: Maya in Portland',
  tooFar: (date) => `Too far out. First look on ${date}`,
  stale: (n) => `Forecast from ${n} h ago`,
  loading: 'Reading the forecast',
  noStory: 'No forecast data for this place yet',
};

// ---------- context: which words name a day ----------

/**
 * How to name days for a set of day classes: today/tonight/tomorrow only on live data inside the run (never on a
 * recorded or very stale one, where the date is named), otherwise a full weekday, or on non-live data the date.
 */
export function ctxOf(days, o = {}) {
  const cov = days?.coverage || {};
  return {
    todayDate: cov.todayDate ?? null,
    dated: cov.kind ? cov.kind !== 'live' : !!o.dated,
    nowLocalHour: cov.nowLocalHour ?? 0,
    placeName: o.placeName ?? cov.placeName ?? '',
    viewerOffset: o.viewerOffset ?? cov.viewerOffset,
    placeOffset: o.placeOffset ?? cov.offsetMin,
    sample: !!o.sample,
    units: o.units === 'us' ? 'us' : 'metric',
  };
}

/**
 * " (Lisbon time)" when the place's day starts at a different clock time than the viewer's (both offsets known and
 * different, and the place has a name), else "". A person's Thursday is never mistaken for the viewer's.
 */
export function zoneSuffix(ctx = {}) {
  const city = cityName(ctx.placeName);
  const a = ctx.viewerOffset, b = ctx.placeOffset;
  return city && finite(a) && finite(b) && a !== b ? ` (${city} time)` : '';
}

/** 'today' / 'tonight' / 'tomorrow' / 'Thursday' / on non-live data 'Sun 22 Nov'. Marks ctx.named: a day was named. */
export function dayWord(c, ctx = {}) {
  ctx.named = true;
  if (ctx.dated) return dateLabel(c.date);
  if (ctx.todayDate) {
    if (c.date === ctx.todayDate) return ctx.nowLocalHour >= 18 ? 'tonight' : 'today';
    if (c.date === addDays(ctx.todayDate, 1)) return 'tomorrow';
  }
  return weekdayLong(c.date);
}

// ---------- reading a day class ----------

const hasRain = (c) => c.wet === 'dry' || c.wet === 'light' || c.wet === 'moderate' || c.wet === 'heavy';
const rainKnown = (c) => hasRain(c);
const isWet = (c) => c.wet === 'light' || c.wet === 'moderate' || c.wet === 'heavy';
export const hasStoryData = (c) => c.pattern !== 'none' || hasRain(c) || c.airMass !== 'none' || finite(c.hi);
const famOf = (c) => PATTERN_FAMILY[c.pattern] || 'none';
/** A ridge does not go with moderate or heavy rain, a trough does not go with a dry day: never link them in words. */
export function coherent(family, c) {
  if (family === 'ridge') return c.wet !== 'moderate' && c.wet !== 'heavy';
  if (family === 'trough') return c.wet !== 'dry';
  return true;
}
const RANK = { dry: 0, light: 1, moderate: 2, heavy: 3 };
const heaviest = (g) => g.reduce((a, c) => (RANK[c.wet] > RANK[a.wet] ? c : a), g[0]);

// ---------- reason phrase (rows) ----------

const through = (c, n, ctx) => {
  const w = dayWord(c, ctx);
  return n === 1 && w !== 'today' && w !== 'tonight' && w !== 'tomorrow' ? `on ${w}` : n === 1 ? w : `through ${w}`;
};

/**
 * The one short phrase a row shows: "Rain likely from Sunday", "Heavy rain Thursday", "Dry through Saturday", "Dry all
 * week". On a recorded forecast the day carries its date. Without rain fields it is cause-only: "Under a trough from
 * Sunday", "Under a ridge all week".
 */
export function reasonPhrase(days, opts = {}) {
  const ctx = ctxOf(days, opts);
  const r = reasonCore(days, ctx);
  return r && ctx.named ? r + zoneSuffix(ctx) : r;
}
function reasonCore(days, ctx) {
  const used = (days || []).filter((c) => c.lead <= 7 && hasStoryData(c));
  if (!used.length) return '';
  const last = used[used.length - 1];
  const reach = (days || []).filter((c) => c.lead <= 10 && hasStoryData(c)); // a spell may run on past day 7
  if (used.some(rainKnown)) {
    const known = used.filter(rainKnown);
    const wi = used.findIndex(isWet);
    if (wi < 0) return used.length >= 7 && known.length >= 7 ? 'Dry all week' : `Dry through ${dayWord(known[known.length - 1], ctx)}`;
    const w = used[wi];
    const ri = reach.indexOf(w);
    let end = ri;
    while (end + 1 < reach.length && isWet(reach[end + 1])) end++;
    const label = upperFirst(w.wetPhrase);
    if (end === ri) return `${label} ${dayWord(w, ctx)}`;
    return wi === 0 ? `${label} through ${dayWord(reach[end], ctx)}` : `${label} from ${dayWord(w, ctx)}`;
  }
  const i = used.findIndex((c) => famOf(c) === 'ridge' || famOf(c) === 'trough');
  if (i < 0) {
    if (used.some((c) => c.signal === 'none')) return NO_CLEAR_SIGNAL.split(':')[0];
    return used.length >= 7 ? 'Near-normal pattern all week' : `Near-normal pattern through ${dayWord(last, ctx)}`;
  }
  const fam = famOf(used[i]);
  const under = fam === 'ridge' ? 'Under a ridge' : 'Under a trough';
  if (i > 0) return `${under} from ${dayWord(used[i], ctx)}`;
  let end = 0;
  while (end + 1 < used.length && famOf(used[end + 1]) === fam) end++;
  return end === used.length - 1 && used.length >= 7 ? `${under} all week` : `${under} through ${dayWord(used[end], ctx)}`;
}

// ---------- summary sentence ----------

const spellKey = (c, known) => (known ? (isWet(c) ? 'wet' : 'dry') : `p:${famOf(c)}`);
function groups(used, known) {
  const out = [];
  for (const c of used) {
    const k = spellKey(c, known);
    const g = out[out.length - 1];
    if (g && g.key === k) g.days.push(c); else out.push({ key: k, days: [c] });
  }
  return out;
}
const causeUnder = (days) => {
  const fam = famOf(days[0]);
  if (!days.every((c) => famOf(c) === fam && coherent(fam, c))) return '';
  return fam === 'ridge' ? 'under a ridge' : fam === 'trough' ? 'under a trough' : '';
};
// A spell that mixes pattern families can still end on the approach of a trough (or the build of a ridge): the cause is
// the last day's, said after the spell ("Rain through Thu 19 Nov as a trough approaches"). Only where it agrees with the rain.
const causeTail = (d) => {
  if (d.pattern === 'trough-arriving' && coherent('trough', d)) return 'as a trough approaches';
  if (d.pattern === 'ridge-building' && coherent('ridge', d)) return 'as a ridge builds';
  return '';
};
const causeOfSpell = (days) => causeUnder(days) || causeTail(days[days.length - 1]);
const causeChange = (d, prev) => {
  const fd = famOf(d), fp = famOf(prev);
  if (!coherent(fd, d)) return '';
  if (prev.pattern === 'trough-arriving' || d.pattern === 'trough-arriving' || (fd === 'trough' && fp !== 'trough')) return 'as a trough approaches';
  if (fd === 'trough') return 'under a trough';
  if (fd === 'ridge') return fp !== 'ridge' ? 'as a ridge builds' : 'under a ridge';
  if (fd === 'normal' && fp === 'trough') return 'behind the trough';
  return '';
};
const consequenceOf = (g, known) => (known ? heaviest(g.days).wetPhrase : { ridge: 'under a ridge', trough: 'under a trough', normal: 'a near-normal pattern', 'signal-none': NO_CLEAR_SIGNAL.split(':')[0].toLowerCase(), none: '' }[famOf(g.days[0])]);

/**
 * One plain sentence about the first seven days: a consequence from the rain fields and its cause from the pattern,
 * at most 110 characters: "Dry through Saturday under a ridge; rain likely from Sunday as a trough approaches."
 * With no rain fields it is cause-only and says "Rain isn't in this run". The confidence phrase is separate
 * (summaryConfidence): it is not part of this sentence.
 */
export function summary(days, opts = {}) {
  const ctx = ctxOf(days, opts);
  const used = (days || []).filter((c) => c.lead <= 7 && hasStoryData(c));
  if (!used.length) return '';
  const known = used.some(rainKnown);
  const gs = groups(known ? used.filter(rainKnown) : used, known);
  const g0 = gs[0], g1 = gs[1];
  const sentenceEnd = '.';
  const missing = known ? '' : ` Rain isn’t in this ${ctx.sample ? 'sample' : 'run'}.`;
  const head = (withCause) => {
    const first = known ? upperFirst(consequenceOf(g0, true)) : upperFirst(consequenceOf(g0, false));
    if (!g1) {
      const span = g0.days.length >= 7 ? 'all week' : through(g0.days[g0.days.length - 1], g0.days.length, ctx);
      const under = withCause && known ? causeOfSpell(g0.days) : '';
      // cause-only wording already says "under a ridge"; do not say it twice
      return known ? `${first} ${span}${under ? ' ' + under : ''}` : `${first} ${span}`;
    }
    const under = withCause && known ? causeOfSpell(g0.days) : '';
    const p1 = known ? `${first} ${through(g0.days[g0.days.length - 1], g0.days.length, ctx)}${under ? ' ' + under : ''}` : `${first} ${through(g0.days[g0.days.length - 1], g0.days.length, ctx)}`;
    const w1 = g1.days[0];
    const when = g1.days.length === 1 && gs.length > 2 ? (dayWord(w1, ctx) === 'today' || dayWord(w1, ctx) === 'tonight' || dayWord(w1, ctx) === 'tomorrow' ? dayWord(w1, ctx) : `on ${dayWord(w1, ctx)}`) : `from ${dayWord(w1, ctx)}`;
    const cause = withCause && known ? causeChange(w1, g0.days[g0.days.length - 1]) : '';
    const second = lowerFirst(consequenceOf(g1, known));
    return `${p1}; ${second} ${when}${cause ? ' ' + cause : ''}`;
  };
  // the zone note goes in whenever it fits the cap; the cause then the missing-field note give way before it does
  const heads = [true, false].map((wc) => head(wc));
  const z = ctx.named ? zoneSuffix(ctx) : '';
  for (const zn of z ? [z, ''] : ['']) for (const h of heads) {
    const s = h + zn + sentenceEnd + missing;
    if (s.length <= MAX_SUMMARY) return s;
    const t = h + zn + sentenceEnd;
    if (t.length <= MAX_SUMMARY) return t;
  }
  return reasonPhrase(days, opts) + sentenceEnd;
}

/** "Pattern: confident." and the like: the weakest of the first seven days with a confidence (empty for a sample). */
export function summaryConfidence(days, opts = {}) {
  if (opts.sample) return '';
  const rank = { low: 0, 'pattern-only': 0, medium: 1, high: 2 };
  const known = (days || []).filter((c) => c.lead <= 7 && rank[c.confidence] !== undefined);
  if (!known.length) return '';
  return SUMMARY_CONFIDENCE[known.sort((a, b) => rank[a.confidence] - rank[b.confidence])[0].confidence] || '';
}

// ---------- day line ----------

const MINUS = '−';
/** A temperature in °C as "9°" or "−2°", in °F when units is 'us'. */
export function degrees(c, units = 'metric') {
  const v = Math.round(units === 'us' ? (c * 9) / 5 + 32 : c);
  return `${v < 0 ? MINUS : ''}${Math.abs(v)}°`;
}
/** "midnight", "noon", "4 pm". */
export function hourWord(h) {
  const x = ((Math.round(h) % 24) + 24) % 24;
  return x === 0 ? 'midnight' : x === 12 ? 'noon' : `${x % 12} ${x < 12 ? 'am' : 'pm'}`;
}

function rainPiece(c, miss) {
  if (!hasRain(c)) return '';
  if (c.wetSource === 'pr') {
    const bits = [`${Math.round(c.pr1)}% chance of a wet day`];
    if (finite(c.pr10)) bits[0] += `, ${Math.round(c.pr10)}% of a very wet one`;
    return `${c.wetPhrase}: ${bits[0]}${finite(c.prEndHour) ? ` (24 h to ${hourWord(c.prEndHour)})` : ''}`;
  }
  return c.wet === 'dry' ? 'dry' : `${c.wetPhrase} in the latest forecast`;
}

/**
 * The day line for a focused place: consequence first (rain, air mass, high and low), then the cause from the pattern,
 * then what the data lack, then the confidence. `opts.label` and `opts.dayName` head it; `opts.sample` says "sample"
 * for what is missing and drops the confidence (a sample spread is not a forecast spread).
 */
export function dayLine(c, opts = {}) {
  const ctx = opts.ctx || ctxOf(opts.days || c, opts); // a day class from buildDays carries its coverage
  const label = opts.label ?? '';
  const rawName = opts.dayName ?? (c.date ? dayWord(c, ctx) : '');
  const dayName = rawName && !/ time\)$/.test(rawName) ? rawName + zoneSuffix(ctx) : rawName;
  const head = label ? `${label} · ${dayName}:` : `${dayName}:`;
  if (!hasStoryData(c)) return `${head} no forecast data.`;
  const miss = opts.sample || ctx.sample ? NOT_IN_SAMPLE : NOT_IN_RUN;
  const parts = [];
  const rp = rainPiece(c);
  if (rp) parts.push(upperFirst(rp) + '.');
  const s1 = [];
  if (c.airMass !== 'none' && AIR_MASS_WORDS[c.airMass]) s1.push(AIR_MASS_WORDS[c.airMass]);
  if (c.lead <= 7 && finite(c.hi) && finite(c.lo)) s1.push(`high near ${degrees(c.hi, opts.units || ctx.units)}, low near ${degrees(c.lo, opts.units || ctx.units)}`);
  if (s1.length) parts.push(upperFirst(s1.join('; ')) + '.');
  // cause: the pattern in plain words, never linked to a rain class it does not go with
  if (c.signal === 'none' || c.pattern === 'no-signal') parts.push(NO_CLEAR_SIGNAL + '.');
  else {
    const fam = famOf(c);
    let pat = coherent(fam, c) ? PATTERN_LINE[c.pattern] || '' : '';
    const track = c.stormTrack && fam !== 'ridge';
    if (track) pat = pat ? `${pat}, ${STORM_TRACK_PLAIN}` : upperFirst(STORM_TRACK_PLAIN);
    if (pat) parts.push(pat + '.');
  }
  const rainMissing = c.rainMissing ?? (c.wet === 'none' && c.wetPhrase !== '');
  const tempMissing = c.tempMissing ?? false;
  const lacking = rainMissing && tempMissing ? 'Rain and temperature aren’t' : rainMissing ? 'Rain isn’t' : tempMissing ? 'Temperature isn’t' : '';
  if (lacking) parts.push(`${lacking} ${miss.replace(/^not /, '')}.`);
  if (!(opts.sample || ctx.sample) && c.signal !== 'none' && c.pattern !== 'no-signal') {
    if (c.confidence === 'pattern-only') parts.push('Pattern only, not specifics.');
    else if (CONF[c.confidence]) parts.push(`Pattern: ${CONF[c.confidence]}.`);
  }
  return `${head} ${parts.join(' ')}`.trim();
}

/** The day name for a day line: the full weekday with "(Lisbon time)" when the place's day differs from the viewer's. */
export const dayLineName = (c, viewerOffset, placeOffset, placeName) => dayLabel(c.date, viewerOffset, placeOffset, placeName);

// ---------- titles and dataset notes ----------

/** "1 day of data", "2 days of data". */
export const daysOfData = (n) => `${n} day${n === 1 ? '' : 's'} of data`;

/** The card title: "Your week", "Your next 10 days", "A recorded week", or "{n} day(s) of data" for a short dataset. */
export function weekTitle(coverage, { range = 7 } = {}) {
  if (coverage.withData < 3) return daysOfData(coverage.withData);
  if (coverage.kind && coverage.kind !== 'live') return 'A recorded week';
  return range === 7 ? 'Your week' : `Your next ${range} days`;
}

/** The line under a short dataset's strip: "This dataset covers Sat 31 Dec to Mon 2 Jan only." */
export function coverageNote(coverage) {
  if (!coverage.withData) return '';
  const a = dateLabel(coverage.firstDate), b = dateLabel(coverage.lastDate);
  return coverage.firstDate === coverage.lastDate ? `This dataset covers ${a} only.` : `This dataset covers ${a} to ${b} only.`;
}

/** The end cell of a live run short of the chosen range: "later days arrive with the next update (about 9 pm)". */
export function laterDaysNote(coverage, { zone } = {}) {
  const d = coverage.nextUpdate;
  if (!d) return 'later days are not in this forecast';
  const t = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: true, ...(zone ? { timeZone: zone } : {}) }).format(d).toLowerCase();
  return `later days arrive with the next update (about ${t})`;
}

// ---------- trips (DESIGN-SPEC section 3.5) ----------

/**
 * Which of four states a trip card is in, from where its dates fall against the loaded forecast:
 * 'over' (ended before today), 'too-far' (starts after the last forecast day), 'broad' (starts on forecast day 8 or
 * later), 'detail' (starts within days 1-7; any later days of a long trip are described as broad by tripLine).
 * `trip` = {start, end} as 'YYYY-MM-DD'; `coverage` = {firstDate, lastDate, todayDate?}; `now` is a Date or epoch ms.
 */
export function tripState(trip, coverage, now = Date.now()) {
  const today = coverage.todayDate || new Date(+now).toISOString().slice(0, 10);
  if (trip.end < today) return 'over';
  if (trip.start > coverage.lastDate) return 'too-far';
  return daysBetween(coverage.firstDate, trip.start) >= 7 ? 'broad' : 'detail';
}

const TRIP_COVER_LEAD = 14, TRIP_DETAIL_LEAD = 6;
const leaning = (days) => {
  const d = days.filter((c) => c.pattern !== 'none');
  if (!d.length) return 'unknown';
  if (d.filter((c) => c.signal === 'none').length * 2 > d.length) return 'none';
  const m = d.reduce((a, c) => a + (finite(c.anomDam) ? c.anomDam : 0), 0) / d.length;
  return m >= 2 ? 'ridge' : m <= -2 ? 'trough' : 'normal';
};

/** The sentence a trip card shows, per state (see tripState). `days` are the day classes for the trip's dates. */
export function tripLine(trip, days, coverage, opts = {}) {
  const state = opts.state || tripState(trip, coverage, opts.now);
  const label = trip.label || trip.name || 'Trip';
  if (state === 'over') return `${label} · ended ${dateLabel(trip.end)}`;
  // Dates are the days tripState actually changes: the forecast's last day is first + 14, so it reaches the trip's first
  // day once first = start - 14 (broad), and day 7 is first + 6, so the trip is detail once first = start - 6. (The spec's
  // "15 days before" and "minus 7" count days from 1; this reads them against the same day numbering tripState uses.)
  if (state === 'too-far') return `Too far out. The forecast starts covering it on ${dateLabel(addDays(trip.start, -TRIP_COVER_LEAD))}.`;
  const inTrip = (days || []).filter((c) => c.date >= trip.start && c.date <= trip.end);
  if (state === 'detail') {
    const s = summary(Object.assign(inTrip, { coverage: days?.coverage }), opts);
    return s || '';
  }
  const lean = leaning(inTrip.filter((c) => c.lead >= 8));
  const core = lean === 'unknown' ? 'No broad-pattern data for these days yet.' : lean === 'ridge' ? 'The broad pattern leans toward a ridge (drier).' : lean === 'trough' ? 'The broad pattern leans toward a trough (wetter).' : lean === 'normal' ? 'The broad pattern looks near normal.' : `${NO_CLEAR_SIGNAL}.`;
  return `Too early for details. ${core} Firmer from ${dateLabel(addDays(trip.start, -TRIP_DETAIL_LEAD))}.`;
}

export { dayNumberLabel, cityName };
