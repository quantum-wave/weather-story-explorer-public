// Local days (DESIGN-SPEC section 3.2, "Whose day"). A place's day is binned in its own local time, approximated from
// its longitude to the nearest hour: Lisbon's Thursday starts when Lisbon's clock says so, not the viewer's. Pure.

const MIN = 60e3, HOUR = 3600e3, DAY = 24 * HOUR;
const pad = (n) => String(n).padStart(2, '0');
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The place's UTC offset in minutes: longitude / 15 rounded to the nearest hour (Lisbon, 9.1 W, is -60). */
export function offsetMinutes(lon) {
  const h = Math.round(lon / 15);
  return (h === 0 ? 0 : h) * 60;
}

/** The viewer's own UTC offset in minutes at `ms`. */
export const viewerOffsetMinutes = (ms = Date.now()) => -new Date(ms).getTimezoneOffset();

/** Local calendar date 'YYYY-MM-DD' of an instant at a UTC offset in minutes. */
export function localDate(ms, offMin) {
  return new Date(ms + offMin * MIN).toISOString().slice(0, 10);
}

/** Epoch ms of the local midnight that starts the local day containing `ms`. */
export function dayStartMs(ms, offMin) {
  const off = offMin * MIN;
  return Math.floor((ms + off) / DAY) * DAY - off;
}

/**
 * `count` consecutive local-day windows from the day containing startMs, as forecast hours from originMs:
 * [{date, startH, endH}]. A window may start before the data (startH < 0).
 */
export function dayWindowsAt(originMs, startMs, count, offMin) {
  const out = [];
  let s = dayStartMs(startMs, offMin);
  for (let i = 0; i < count; i++) {
    out.push({ date: localDate(s, offMin), startH: (s - originMs) / HOUR, endH: (s + DAY - originMs) / HOUR });
    s += DAY;
  }
  return out;
}

/** The date `n` days after 'YYYY-MM-DD' (n may be negative). */
export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** Whole days from date a to date b. */
export function daysBetween(a, b) {
  const t = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / DAY);
}

const noon = (date) => new Date(date + 'T12:00:00Z');
/** 'Thursday' for 'YYYY-MM-DD' (zone independent). */
export const weekdayLong = (date) => WEEKDAYS[noon(date).getUTCDay()];
export const weekdayShort = (date) => weekdayLong(date).slice(0, 3);
/** 'Thu 19': the column label form (never a single initial). */
export const dayNumberLabel = (date) => `${weekdayShort(date)} ${noon(date).getUTCDate()}`;
/** 'Fri 20 Nov'. */
export const dateLabel = (date) => `${weekdayShort(date)} ${noon(date).getUTCDate()} ${MONTHS[noon(date).getUTCMonth()]}`;

/** 'Lisbon' from 'Lisbon, Portugal'. */
export const cityName = (placeName) => String(placeName || '').split(',')[0].trim();

/**
 * The day's full weekday, with "(Lisbon time)" when the place's day starts at a different clock time than the
 * viewer's, so a person's Thursday is never mistaken for the viewer's.
 */
export function dayLabel(date, viewerOffset, placeOffset, placeName) {
  const name = weekdayLong(date);
  const city = cityName(placeName);
  return city && viewerOffset !== placeOffset ? `${name} (${city} time)` : name;
}
