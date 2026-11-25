// Online place search: the Open-Meteo geocoding API, for a name the bundled gazetteer cannot answer. Progressive
// enhancement only (AGENTS.md, ARCHITECTURE.md Deployment shape): it runs only when the person presses "Search online",
// never by itself; the site is complete without it; the artifact's CSP blocks it and a static host may not. It sends only
// the typed text (no cookies, no referrer, nothing about pins), never throws and never logs: a failure is a status the
// picker shows. Results are snapshots like any other pick (two decimals, snapshotCity), with ids prefixed 'om-' so they
// never collide with a gazetteer id or become a place token in a link.
import { snapshotCity, US_STATES } from './gazetteer.js';

export const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
export const TIMEOUT_MS = 8000;
export const UNAVAILABLE = "Online search isn't available here.";

/** The request URL for `text`: the name and a result count, nothing else. */
export function geocodeUrl(text) {
  return GEOCODE_URL + '?name=' + encodeURIComponent(String(text ?? '').trim().slice(0, 100)) + '&count=5';
}

const STATE_OF = Object.fromEntries(Object.entries(US_STATES).map(([k, v]) => [v.toLowerCase(), k]));
const PROVINCE_OF = {
  alberta: 'AB', 'british columbia': 'BC', manitoba: 'MB', 'new brunswick': 'NB', 'newfoundland and labrador': 'NL', 'nova scotia': 'NS', ontario: 'ON',
  'prince edward island': 'PE', quebec: 'QC', saskatchewan: 'SK', yukon: 'YT', 'northwest territories': 'NT', nunavut: 'NU',
};

/** Open-Meteo's JSON -> city snapshots ({id:'om-<n>', name, admin, cc, lat, lon, online:true}), unusable rows dropped. */
export function parseGeocode(json) {
  const out = [];
  const results = json && Array.isArray(json.results) ? json.results : [];
  for (const r of results) {
    if (!r || typeof r.name !== 'string' || !r.name.trim()) continue;
    const cc = typeof r.country_code === 'string' ? r.country_code.toUpperCase() : '';
    const a1 = typeof r.admin1 === 'string' ? r.admin1.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() : '';
    let admin = '';
    if (cc === 'US') admin = STATE_OF[a1] || '';
    else if (cc === 'CA') admin = PROVINCE_OF[a1] || '';
    const c = snapshotCity({ id: 'om-' + String(r.id ?? out.length).replace(/[^0-9a-z]/gi, ''), name: r.name.trim(), admin, cc, lat: r.latitude, lon: r.longitude });
    if (c && /^[A-Z]{2}$/.test(c.cc)) out.push({ ...c, online: true });
  }
  return out;
}

/**
 * Ask Open-Meteo for `text`. Resolves { ok: true, places } (places may be empty) or { ok: false } when the request is
 * blocked, offline, slow or answered badly. Never rejects.
 */
export async function searchOnline(text, { fetchFn = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const q = String(text ?? '').trim();
  if (q.length < 2 || typeof fetchFn !== 'function') return { ok: false };
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetchFn(geocodeUrl(q), { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: ctl?.signal });
    if (!res || !res.ok) return { ok: false };
    return { ok: true, places: parseGeocode(await res.json()) };
  } catch {
    return { ok: false };
  } finally { if (timer) clearTimeout(timer); }
}
