// Pure text helpers for shares: valid-time strings, default headline, confidence words, footer, series interpolation.
import { nearestHour } from '../ui/datestamp.js';

const REGION = { np: 'North Pacific', nh: 'Northern Hemisphere', gl: 'Global', wm: 'World' };
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

/**
 * The GIF frames' two-line stamp ({day:'Tue 17 Nov', hour:'11 pm PST (07Z)'}): the valid time rounded to the nearest local hour,
 * as the on-screen date stamp reads while playing (ui/datestamp.js), so the words change once an hour, not every frame. The
 * still image keeps the minute the paused timeline shows (shareMeta uses formatValid directly).
 */
export function gifStamp(date, opts = {}) {
  const v = formatValid(nearestHour(date), opts);
  return { day: v.dayLabel, hour: v.local.slice(v.dayLabel.length + 2) };
}

/** Default headline (SPEC section 7): a factual label, never a person's name. */
export function defaultHeadline({ placeLabel, view, dayLabel }) {
  return `${placeLabel || regionName(view)} · ${dayLabel}`;
}

/**
 * The words a share prints for a confidenceAt() result: "Pattern: confident", "Pattern: fairly sure of the timing",
 * "Pattern only, not specifics", or the reason when there is no claim. The level and its words are story/confidence.js's, one table
 * for the card, the legend and the share; this only phrases them.
 */
export function confidencePhrase(c) {
  if (!c || c.level === 'none') return `Pattern confidence: not shown${c?.reason ? ` (${c.reason})` : ''}`;
  if (c.level === 'pattern-only') return 'Pattern only, not specifics';
  return `Pattern: ${c.phrase}`;
}

export function footerLine({ attribution, climatologyLabel }) {
  const parts = ['Model output, not an official forecast'];
  if (attribution) parts.push(attribution);
  if (climatologyLabel) parts.push(`anomaly vs ${climatologyLabel}`);
  return parts.join(' · ');
}

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
