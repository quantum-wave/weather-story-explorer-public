// Pure text helpers for shares: valid-time strings, default headline, confidence words, footer, legend words.

const REGION = { np: 'North Pacific', nh: 'Northern Hemisphere', gl: 'Global' };
export const regionName = (view) => REGION[view] || REGION.np;

/**
 * A Date -> {dayLabel:'Sat 22 Nov', local:'Sat 22 Nov, 4 am PST (12Z)', short:'Sat 22 Nov, 4 am', utc:'12Z'}
 * in the viewer's time zone (or `timeZone`), with the UTC hour beside it.
 */
export function formatValid(date, { timeZone, year = false } = {}) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    hourCycle: 'h12', timeZoneName: 'short', ...(year ? { year: 'numeric' } : {}),
  });
  const p = Object.fromEntries(fmt.formatToParts(date).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  const dayLabel = `${p.weekday} ${p.day} ${p.month}${year ? ' ' + p.year : ''}`;
  const clock = `${p.hour}${p.minute === '00' ? '' : ':' + p.minute} ${String(p.dayPeriod || '').toLowerCase()}`.trim();
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = date.getUTCMinutes();
  const utc = `${hh}${mm ? ':' + String(mm).padStart(2, '0') : ''}Z`;
  return { dayLabel, short: `${dayLabel}, ${clock}`, local: `${dayLabel}, ${clock} ${p.timeZoneName} (${utc})`, utc };
}

/** Default headline (SPEC section 7): a factual label, never a person's name. */
export function defaultHeadline({ placeLabel, view, dayLabel }) {
  return `${placeLabel || regionName(view)} · ${dayLabel}`;
}

const PHRASE = {
  high: 'Pattern: confident',
  medium: 'Pattern: fairly sure of the timing',
  low: 'Pattern: timing uncertain',
  'pattern-only': 'Pattern only: details are not reliable this far out',
};
/**
 * Pattern confidence word (SPEC section 6 thresholds). sd: ensemble spread of z500 in dam (or null);
 * leadHours: hours from the run. Day 1 is the first 24 h.
 */
export function confidenceFor({ sd, leadHours }) {
  const day = Math.floor(Math.max(0, leadHours) / 24) + 1;
  let level;
  if (day > 10) level = 'pattern-only';
  else if (sd == null || !Number.isFinite(sd)) level = day <= 4 ? 'high' : day <= 7 ? 'medium' : 'low';
  else {
    level = sd < 3 ? 'high' : sd <= 6 ? 'medium' : 'low';
    if (day >= 8 && level === 'high') level = 'medium';
  }
  return { level, phrase: PHRASE[level] };
}

export function footerLine({ attribution, climatologyLabel }) {
  const parts = ['Model output, not an official forecast'];
  if (attribution) parts.push(attribution);
  if (climatologyLabel) parts.push(`anomaly vs ${climatologyLabel}`);
  return parts.join(' · ');
}

export const sampleBanner = (caseLabel) => `SAMPLE DATA · ${caseLabel || 'demo'} · not a forecast`;

const WORDS = {
  z: 'Blue: lower pressure aloft, usually unsettled. Amber: higher, usually settled.',
  j: 'Purple to cream: faster jet-stream winds, where storms tend to travel.',
  c: 'Brighter: the forecasts agree. Dimmer: the pattern is less certain.',
  t: 'Blue: cooler than usual. Amber: warmer than usual.',
};
export const legendWords = (layerCode) => WORDS[layerCode] || WORDS.z;

/** Linear interpolation of a {steps, values} series at t (clamped to the ends); null if the series is empty. */
export function valueAt(series, t) {
  if (!series || !series.steps?.length) return null;
  const { steps, values } = series;
  if (t <= steps[0]) return values[0];
  for (let i = 1; i < steps.length; i++) {
    if (t <= steps[i]) {
      const f = (t - steps[i - 1]) / (steps[i] - steps[i - 1] || 1);
      return values[i - 1] + f * (values[i] - values[i - 1]);
    }
  }
  return values[steps.length - 1];
}
