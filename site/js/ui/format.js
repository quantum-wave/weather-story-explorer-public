// Date helpers for labels. Days are local to the viewer unless a caller says otherwise.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const pad2 = (n) => String(n).padStart(2, '0');
/** 'YYYY-MM-DD' -> local Date at noon. */
export function parseDay(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); }
export function isoDay(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
export function shortDate(d) { return `${d.getDate()} ${MONTHS[d.getMonth()]}`; }
export function weekdayDate(d, { year = false } = {}) { return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${shortDate(d)}${year ? ' ' + d.getFullYear() : ''}`; }
/** 'Nov 27-30' / 'Nov 29 - Dec 2' from two ISO days. */
export function tripDates(start, end) {
  const a = parseDay(start), b = parseDay(end);
  if (start === end) return `${MONTHS[a.getMonth()]} ${a.getDate()}`;
  if (a.getMonth() === b.getMonth()) return `${MONTHS[a.getMonth()]} ${a.getDate()}–${b.getDate()}`;
  return `${MONTHS[a.getMonth()]} ${a.getDate()} – ${MONTHS[b.getMonth()]} ${b.getDate()}`;
}
/** '2026-11-17T00:00Z' -> Date. */
export function parseRun(run) { return new Date(String(run).replace(/Z$/, ':00Z').replace(/(:\d\d):00Z$/, '$1Z')); }
/** '17 Nov 00Z' */
export function runLabel(run) {
  const d = parseRun(run);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${pad2(d.getUTCHours())}Z`;
}
export function ageHours(run, now = Date.now()) { return Math.max(0, Math.round((now - parseRun(run).getTime()) / 3600e3)); }
export function monthYearUTC(iso) { const d = new Date(iso); return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }); }

/**
 * A live run is called stale past this age. Runs are built about 9.5 h after 00Z and 12Z, so a healthy site shows a
 * run up to about 22 h old just before the next one lands; 30 h means a slot was missed.
 */
export const STALE_AFTER_H = 30;
export const isStale = (ageH) => ageH > STALE_AFTER_H;
