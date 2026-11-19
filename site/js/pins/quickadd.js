// Pure quick-add parser (SPEC section 5). No DOM, no storage, no gazetteer: text in, a plain description out.
//
//   Maya in Portland              person (copy-all writes "Maya — Portland, OR"; the em dash is also accepted)
//   #friends Maya in Portland, OR person in a group
//   Lisbon                        place
//   Place: Yosemite in Mariposa   place with its own label
//   Trip: Tahoe Nov 27-30         trip (label and city are both "Tahoe")
//   Trip: Ski weekend in Tahoe Nov 27-30 | note
//   Home: Oakland, CA             the viewer's home
//
// Dates: "Nov 27-30", "Nov 27 - Dec 2", "27-30 Nov", "11/27-11/30", "2026-11-27 to 2026-12-02", "Nov 27" (one day).
// A year-less range whose end is already past rolls to next year. Copy-all lines parse back through here.

const MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const SEP = '\\s*(?:-|–|—|to|through|thru|until)\\s*';
const YR = '(?:,?\\s+(\\d{4}))?';

const pad = (n) => String(n).padStart(2, '0');
export function isoDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
export function todayISO(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function asISO(today) {
  if (!today) return todayISO();
  if (today instanceof Date) return todayISO(today);
  return String(today).slice(0, 10);
}

/** Resolve month/day pairs to ISO dates: explicit year wins, else this year, rolling to next year when the end is past. */
function resolveRange(today, y1, m1, d1, y2, m2, d2) {
  const ty = Number(today.slice(0, 4));
  const build = (year) => {
    const s = isoDate(y1 ?? year, m1, d1);
    if (!s) return null;
    let ey = y2 ?? (y1 ?? year);
    let e = isoDate(ey, m2, d2);
    if (e && e < s && y2 == null) { ey += 1; e = isoDate(ey, m2, d2); }
    return e && e >= s ? { start: s, end: e } : null;
  };
  let r = build(ty);
  if (!r) return null;
  if (y1 == null && y2 == null && r.end < today) r = build(ty + 1);
  return r;
}

/** Find a trailing date expression. @returns {{rest:string, start:string, end:string}|null} */
export function extractDates(str, today) {
  const t = asISO(today);
  let m;
  // ISO range or single day.
  m = str.match(/^(.*?)[\s,]*(\d{4})-(\d{2})-(\d{2})(?:\s*(?:-|–|—|to|through|thru|until)\s*(\d{4})-(\d{2})-(\d{2}))?\s*$/i);
  if (m) {
    const s = isoDate(+m[2], +m[3], +m[4]);
    const e = m[5] ? isoDate(+m[5], +m[6], +m[7]) : s;
    if (s && e && e >= s) return { rest: m[1], start: s, end: e };
    return null;
  }
  // "Nov 27 - Dec 2[, 2026]", "Nov 27-30", "Nov 27"
  m = str.match(new RegExp(`^(.*?)[\\s,]*(?:\\bfrom\\s+)?\\b${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:${SEP}(?:${MON}\\.?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?)?${YR}\\s*$`, 'i'));
  if (m) {
    const m1 = MONTHS[m[2].toLowerCase()], d1 = +m[3];
    const m2 = m[4] ? MONTHS[m[4].toLowerCase()] : m1;
    const d2 = m[5] ? +m[5] : d1;
    const y = m[6] ? +m[6] : null;
    const r = resolveRange(t, y, m1, d1, y, m2, d2);
    return r ? { rest: m[1], ...r } : null;
  }
  // "27-30 Nov", "27 Nov - 2 Dec"
  m = str.match(new RegExp(`^(.*?)[\\s,]*\\b(\\d{1,2})(?:\\s+${MON}\\.?)?${SEP}(\\d{1,2})\\s+${MON}\\.?${YR}\\s*$`, 'i'));
  if (m) {
    const d1 = +m[2], m2 = MONTHS[m[5].toLowerCase()];
    const m1 = m[3] ? MONTHS[m[3].toLowerCase()] : m2;
    const y = m[6] ? +m[6] : null;
    const r = resolveRange(t, y, m1, d1, y, m2, +m[4]);
    return r ? { rest: m[1], ...r } : null;
  }
  // "11/27-11/30", "11/27-30", "11/27"
  m = str.match(/^(.*?)[\s,]*\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s*(?:-|–|—|to)\s*(?:(\d{1,2})\/)?(\d{1,2})(?:\/(\d{2,4}))?)?\s*$/);
  if (m) {
    const yr = (v) => (v ? (v.length === 2 ? 2000 + +v : +v) : null);
    const m1 = +m[2], d1 = +m[3], m2 = m[5] ? +m[5] : m1, d2 = m[6] ? +m[6] : d1;
    const y1 = yr(m[4]), y2 = yr(m[7]) ?? y1;
    const r = resolveRange(t, y1, m1, d1, y2, m2, d2);
    return r ? { rest: m[1], ...r } : null;
  }
  return null;
}

/**
 * @param {string} text one line
 * @param {string|Date} [today] ISO date or Date; default: now
 * @returns {{kind:'person'|'place'|'trip'|'home', name:string, group:string|null, cityQuery:string,
 *   trip?:{start:string,end:string}|null, coords?:{lat:number,lon:number}, note?:string}}
 */
export function parseQuickAdd(text, today) {
  let s = String(text ?? '').replace(/[​ ]/g, ' ').replace(/\s+/g, ' ').trim();
  const out = { kind: 'place', name: '', group: null, cityQuery: '' };

  let m = s.match(/\s\|\s(.*)$/);
  if (m) { out.note = m[1].trim(); s = s.slice(0, m.index).trim(); }

  m = s.match(/^#([^\s#]+)\s*/);
  if (m) { out.group = m[1].replace(/[-_]+/g, ' ').trim(); s = s.slice(m[0].length); }

  m = s.match(/\s@\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (m) {
    const lat = +m[1], lon = +m[2];
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.coords = { lat, lon };
    s = s.slice(0, m.index).trim();
  }

  let forced = null;
  m = s.match(/^(trip|place|person|home)\s*:\s*/i) || s.match(/^(trip)\s+(?:to\s+)?(?=\S)/i);
  if (m) { forced = m[1].toLowerCase(); s = s.slice(m[0].length); }

  let dates = null;
  if (forced !== 'home' && forced !== 'person') {
    dates = extractDates(s, today);
    if (dates) s = dates.rest.trim();
    else if (forced === 'trip') dates = null;
  }
  s = s.replace(/[\s,;:-]+$/, '').trim();

  // Split on the last " in " (or a spaced dash): label before, city after. Month-name trouble is handled above.
  let label = '', city = s;
  // An em dash wins over the other separators: copy-all lines use it because a few city names contain " in " or " - ".
  let sp = [...s.matchAll(/\s—\s/g)];
  if (!sp.length) sp = [...s.matchAll(/\s(?:in|-|–)\s/gi)];
  if (sp.length) { const k = sp[sp.length - 1]; label = s.slice(0, k.index).trim(); city = s.slice(k.index + k[0].length).trim(); }

  if (forced === 'home') { out.kind = 'home'; out.cityQuery = s; return out; }
  if (dates || forced === 'trip') {
    out.kind = 'trip';
    out.name = label || city;
    out.cityQuery = city;
    out.trip = dates ? { start: dates.start, end: dates.end } : null;
    return out;
  }
  if (forced === 'place') { out.kind = 'place'; out.name = label || city; out.cityQuery = city; return out; }
  if (forced === 'person' || label) { out.kind = 'person'; out.name = label; out.cityQuery = city; return out; }
  out.kind = 'place'; out.name = s; out.cityQuery = s;
  return out;
}
