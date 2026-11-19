// Text and CSV serialisation for pins (pure; no DOM, no storage).
import { cityLabel, snapshotCity, CA_PROVINCES } from './gazetteer.js';

export const groupTag = (g) => '#' + String(g.name).trim().toLowerCase().replace(/\s+/g, '-');

/** Copy-all lines. Round trip: quick-add grammar, em-dash separator, ISO trip dates, `@lat,lon` for custom places. */
export function copyAllLines(doc) {
  const lines = [];
  if (doc.homeSet && doc.home) lines.push('Home: ' + cityLabel(doc.home));
  const gById = new Map(doc.groups.map((g) => [g.id, g]));
  const clean = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
  for (const p of doc.pins) {
    const g = gById.get(p.group);
    const tag = g ? groupTag(g) + ' ' : '';
    const note = p.note ? ' | ' + clean(p.note) : '';
    const where = cityLabel(p.city);
    if (p.kind === 'person') lines.push(`${tag}${clean(p.name)} — ${where}${note}`);
    else if (clean(p.name) === p.city.name) lines.push(`${tag}${where}${note}`);
    else {
      const c = snapshotCity({ ...p.city, lat: p.city.lat, lon: p.city.lon });
      lines.push(`${tag}Place: ${clean(p.name)} — ${where} @${c.lat},${c.lon}${note}`);
    }
  }
  const trips = [...doc.trips].sort((a, b) => a.start.localeCompare(b.start) || a.label.localeCompare(b.label));
  for (const t of trips) {
    const where = cityLabel(t.city);
    const label = clean(t.label) === t.city.name ? where : `${clean(t.label)} — ${where}`;
    lines.push(`Trip: ${label} ${t.start}${t.end !== t.start ? ' to ' + t.end : ''}`);
  }
  return lines;
}

/** Cells that a spreadsheet could read as a formula get a leading apostrophe (text columns only). */
export function csvText(v) {
  let s = String(v ?? '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return csvCell(s);
}
function csvCell(s) { return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
const num = (n) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '');

export const CSV_HEADER = ['type', 'name', 'group', 'city', 'region', 'country', 'lat', 'lon', 'start', 'end', 'note'];

export function toCSV(doc) {
  const gName = new Map(doc.groups.map((g) => [g.id, g.name]));
  const row = (type, name, group, c, start, end, note) =>
    [type, csvText(name), csvText(group), csvText(c.name), csvText(c.cc === 'CA' ? (CA_PROVINCES[c.admin] || '') : c.admin), csvText(c.cc), num(c.lat), num(c.lon), start, end, csvText(note)].join(',');
  const out = [CSV_HEADER.join(',')];
  for (const p of doc.pins) out.push(row(p.kind, p.name, gName.get(p.group) || '', p.city, '', '', p.note));
  for (const t of [...doc.trips].sort((a, b) => a.start.localeCompare(b.start))) out.push(row('trip', t.label, '', t.city, t.start, t.end, ''));
  return out.join('\r\n') + '\r\n';
}
