// Every user-facing story phrase (SPEC section 6). Deterministic templates, no generated text.
// Wording rule: consequence first, the term in brackets; amounts say "in the latest forecast", never "will".

export const PATTERN_PLAIN = {
  ridge: 'high pressure aloft (a ridge)',
  trough: 'a dip in the jet stream (a trough)',
  'trough-arriving': 'a dip in the jet stream (a trough) arriving',
  'ridge-building': 'high pressure aloft (a ridge) building',
  'near-normal': 'a near-normal pattern aloft',
  none: '',
};
export const STORM_TRACK_PLAIN = 'storm track overhead';

/** Confidence phrase after "Pattern: ". */
export const CONFIDENCE_WORDS = {
  high: 'confident',
  medium: 'fairly sure of the timing',
  low: 'timing uncertain',
  'pattern-only': 'pattern only, not specifics',
  none: '',
};

export const AIR_MASS_WORDS = {
  'much-warmer': 'much warmer air mass',
  warmer: 'warmer air mass',
  'near-normal': 'air mass near normal',
  cooler: 'cooler air mass',
  'much-cooler': 'much cooler air mass',
};
/** Short tail used inside the summary sentence: "Dry and mild". */
export const AIR_MASS_TAIL = {
  'much-warmer': ' and much warmer than normal',
  warmer: ' and mild',
  cooler: ' and cool',
  'much-cooler': ' and much colder than normal',
};

export const NOT_IN_RUN = 'not in this run';
export const NOT_IN_SAMPLE = 'not in this sample';

/** Wet phrase by amount class and lead day (1 = first day). Beyond day 10 the rain row is dropped. */
export function wetPhraseFor(wet, lead) {
  if (lead > 10) return '';
  if (wet === 'dry') return lead <= 7 ? 'dry' : 'no rain signal';
  if (lead <= 3) return wet === 'light' ? 'light rain' : wet === 'heavy' ? 'heavy rain' : 'rain';
  if (lead <= 7) return wet === 'light' ? 'rain possible' : 'rain likely';
  return 'a rain signal';
}

export const PATTERN_FAMILY = {
  ridge: 'ridge', 'ridge-building': 'ridge', trough: 'trough', 'trough-arriving': 'trough', 'near-normal': 'normal', none: 'none',
};
export const FAMILY_CONSEQUENCE = { ridge: 'Settled', trough: 'Unsettled', normal: 'Near-normal pattern', none: '' };
export const CAUSE = {
  trough: 'as a dip in the jet stream (a trough) moves in',
  ridge: 'as high pressure aloft (a ridge) builds',
  normal: '',
  none: '',
};
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
  noData: (day) => `No data past ${day}`,
  loading: 'Reading the forecast',
  noStory: 'No forecast data for this place yet',
};
