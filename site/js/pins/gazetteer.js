// Offline gazetteer over site/geo/cities.json (GeoNames via all-the-cities, CC-BY-4.0; built by tools/gazetteer).
// Rows [id, name, admin, cc, lat, lon, pop100] are sorted by population, so array order is the default rank.
// Loaded on first use (or earlier through gazetteer.load()). Search matches word prefixes, accent-insensitive.

/** @typedef {{id:number|string, name:string, admin:string, cc:string, lat:number, lon:number}} City */

const CITIES_URL = typeof import.meta !== 'undefined' && import.meta.url ? new URL('../../geo/cities.json', import.meta.url).href : 'geo/cities.json';

export const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
// GeoNames admin1 codes for Canada.
export const CA_PROVINCES = {
  '01': 'AB', '02': 'BC', '03': 'MB', '04': 'NB', '05': 'NL', '07': 'NS', '08': 'ON', '09': 'PE', '10': 'QC', '11': 'SK', '12': 'YT', '13': 'NT', '14': 'NU',
};
const CA_NAMES = { AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon', NT: 'Northwest Territories', NU: 'Nunavut' };

/** ASCII fold, lower case, letters and digits only, single spaces. */
export function fold(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/đ/g, 'd').replace(/ł/g, 'l')
    .toLowerCase().replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

let dn = null;
export function countryName(cc) {
  if (dn === null) { try { dn = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { dn = false; } }
  if (dn) { try { return dn.of(cc) || cc; } catch { /* fall through */ } }
  return cc;
}
/** Region shown after the city name: state or province letters for US and CA, otherwise the country name. */
export function regionLabel(c) {
  if (c.cc === 'US' && c.admin) return c.admin;
  if (c.cc === 'CA' && c.admin) return CA_PROVINCES[c.admin] || c.admin.replace(/^\d+$/, '') || 'Canada';
  return countryName(c.cc);
}
/** "Portland, OR" or "Lisbon, Portugal". */
export function cityLabel(c) { return c ? (c.name + (c.cc ? ', ' + regionLabel(c) : '')) : ''; }

/** Normalise a city-like object to the stored snapshot: two decimals, validated. Returns null if unusable. */
export function snapshotCity(c) {
  if (!c || typeof c !== 'object') return null;
  const lat = Number(c.lat), lon = Number(c.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const r2 = (x) => Math.round(x * 100) / 100;
  return { id: c.id ?? '', name: String(c.name ?? '').slice(0, 80), admin: String(c.admin ?? '').slice(0, 8), cc: String(c.cc ?? '').slice(0, 3), lat: r2(lat), lon: r2(lon) };
}

let data = null;        // { rows, fname, qual }
let loading = null;

function prepare(doc) {
  const rows = doc.rows;
  const n = rows.length;
  const fname = new Array(n);
  for (let i = 0; i < n; i++) fname[i] = fold(rows[i][1]);
  return { rows, fname, byId: null };
}

/** Test hook and offline hook: use an already parsed cities.json document. */
export function setData(doc) { data = prepare(doc); loading = Promise.resolve(data); return data; }

/** Start loading (idempotent). Resolves to true when the table is ready, false when it cannot be loaded. */
export function load() {
  if (data) return Promise.resolve(true);
  if (!loading) {
    loading = (async () => {
      const res = await fetch(CITIES_URL);
      if (!res.ok) throw new Error('cities.json ' + res.status);
      data = prepare(await res.json());
      return data;
    })().catch((e) => { loading = null; console.warn('gazetteer: ' + e.message); return null; });
  }
  return loading.then((d) => !!d);
}
export const isReady = () => !!data;

const toCity = (r) => ({ id: r[0], name: r[1], admin: r[2], cc: r[3], lat: r[4], lon: r[5] });

/** Does qualifier text q (folded) name the state/province/country of row r? Exact for codes, prefix for names. */
function qualMatches(q, r, prefixOk = true) {
  const [, , admin, cc] = r;
  if (cc === 'US' && admin) {
    if (fold(admin) === q) return true;
    const sn = fold(US_STATES[admin] || '');
    if (sn && (sn === q || (prefixOk && q.length >= 3 && sn.startsWith(q)))) return true;
  }
  if (cc === 'CA' && admin) {
    const pc = CA_PROVINCES[admin];
    if (pc && fold(pc) === q) return true;
    const pn = fold(CA_NAMES[pc] || '');
    if (pn && (pn === q || (prefixOk && q.length >= 3 && pn.startsWith(q)))) return true;
  }
  if (fold(cc) === q && q.length === 2) return true;
  if (q.length >= 3) { const cn = fold(countryName(cc)); if (cn === q || (prefixOk && cn.startsWith(q))) return true; }
  if (cc === 'GB' && ['uk', 'england', 'great britain'].includes(q)) return true;
  if (cc === 'US' && ['usa', 'us', 'america', 'united states'].includes(q)) return true;
  return false;
}

/** Score row i for folded tokens: 0 no match, else higher is better (before population). */
function scoreName(name, toks) {
  const words = name.split(' ');
  let score = 0;
  const full = toks.join(' ');
  if (name === full) return 4;
  if (name.startsWith(full)) score = 3;
  for (const t of toks) {
    if (!words.some((w) => w.startsWith(t))) return 0;
  }
  return score || 2;
}

function run(toks, qual, n, filterQual, prefixOk = true) {
  const { rows, fname } = data;
  const best = []; // [score, idx]
  const need = n;
  // Rows are population-sorted: collect by score tiers, stop early once top tier is full.
  const tiers = [[], [], [], [], []];
  for (let i = 0; i < rows.length; i++) {
    const s = scoreName(fname[i], toks);
    if (!s) continue;
    if (filterQual && !qualMatches(qual, rows[i], prefixOk)) continue;
    tiers[s].push(i);
    if (tiers[4].length >= need) break; // exact matches fill the list; nothing outranks them
  }
  for (let s = 4; s >= 1 && best.length < need; s--) for (const i of tiers[s]) { best.push(i); if (best.length >= need) break; }
  return best;
}

const ALIASES = { sf: 'San Francisco, CA', sfo: 'San Francisco, CA', nyc: 'New York City, NY', la: 'Los Angeles, CA', dc: 'Washington, DC', mpls: 'Minneapolis, MN', philly: 'Philadelphia, PA', vegas: 'Las Vegas, NV' };

/**
 * City search. Accepts "Portland", "portland or", "Portland, Oregon", "south lake tahoe ca", "Lisbon Portugal".
 * @returns {Promise<City[]>} best first; [] when nothing matches or the table cannot be loaded.
 */
export async function search(q, n = 8) {
  if (!(await load())) return [];
  return searchSync(q, n);
}

export function searchSync(q, n = 8) {
  if (!data) return [];
  const raw = String(q ?? '');
  let name = raw, qual = '';
  const comma = raw.indexOf(',');
  if (comma >= 0) { name = raw.slice(0, comma); qual = fold(raw.slice(comma + 1)); }
  const alias = comma < 0 && ALIASES[fold(name)];
  if (alias) return searchSync(alias, n);
  const toks = fold(name).split(' ').filter(Boolean);
  if (!toks.length) return [];
  const out = [];
  const seen = new Set();
  const add = (idxs) => { for (const i of idxs) { if (!seen.has(i) && out.length < n) { seen.add(i); out.push(i); } } };
  if (qual) {
    add(run(toks, qual, n, true));
    if (out.length < n && qual.length <= 3) add(run(toks, qual, n, false)); // unknown qualifier: still offer name matches
  } else {
    // "Portland OR" / "Portland Oregon": try the trailing 1-3 words as a region qualifier first.
    if (toks.length >= 2) {
      for (let k = Math.min(3, toks.length - 1); k >= 1; k--) {
        const q2 = toks.slice(-k).join(' ');
        const rest = toks.slice(0, -k);
        const hits = run(rest, q2, n, true, false);
        if (hits.length) { add(hits); break; }
      }
    }
    add(run(toks, '', n, false));
  }
  return out.map((i) => toCity(data.rows[i]));
}

/** Nearest city to a point (population breaks near ties). Never fails once the table loads. */
export async function nearest(lat, lon) {
  if (!(await load())) return null;
  return nearestSync(lat, lon);
}
export function nearestSync(lat, lon) {
  if (!data) return null;
  const { rows } = data;
  const k = Math.cos((lat * Math.PI) / 180);
  let bi = -1, bd = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let dl = Math.abs(r[5] - lon); if (dl > 180) dl = 360 - dl;
    const dy = r[4] - lat, dx = dl * k;
    // Mild preference for bigger places: distance shrinks by up to ~12% for megacities.
    const d = (dx * dx + dy * dy) * (1 - 0.12 * Math.min(1, Math.log10(1 + r[6]) / 5));
    if (d < bd) { bd = d; bi = i; }
  }
  return bi < 0 ? null : toCity(rows[bi]);
}

/** City by GeoNames id (number or 'c123'). */
export function byIdSync(id) {
  if (!data) return null;
  const want = Number(String(id).replace(/^c/, ''));
  const r = data.rows.find((x) => x[0] === want);
  return r ? toCity(r) : null;
}

/** City by GeoNames id (number or 'c123'), loading the table first; null if unknown or unloadable. Links resolve through this. */
export async function byId(id) {
  if (!(await load())) return null;
  return byIdSync(id);
}

export const gazetteer = { search, nearest, load, isReady, searchSync, nearestSync, byId, byIdSync, setData, cityLabel };
