// Offline gazetteer over site/geo/cities.json (GeoNames via all-the-cities, CC-BY-4.0; built by tools/gazetteer)
// plus site/geo/places-extra.json (hand-curated regions, resorts, parks and small towns; see that file's "fields").
// cities.json rows [id, name, admin, cc, lat, lon, pop100] are sorted by population. The curated entries are merged in
// by weight (their `w` is on the pop100 scale), so array order is the default rank. Merged rows carry an 8th
// element, the kind ('region' | 'resort' | 'park' | 'town'), or undefined for a plain city.
// Nothing is fetched at import. Both files load together on first use (search, nearest, byId, or an explicit load()).
// Search matches word prefixes, accent-insensitive; curated aliases ("Palisades Tahoe") match too.

/** @typedef {{id:number|string, name:string, admin:string, cc:string, lat:number, lon:number}} City */

const geoUrl = (f) => (typeof import.meta !== 'undefined' && import.meta.url ? new URL('../../geo/' + f, import.meta.url).href : 'geo/' + f);
const CITIES_URL = geoUrl('cities.json');
const EXTRA_URL = geoUrl('places-extra.json');

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

let data = null;        // { rows, fname, falias }
let loading = null;

/** Merge the curated places into the population-sorted rows (stable: ties keep cities first), drop what they replace. */
function prepare(doc, extra) {
  const places = (extra && Array.isArray(extra.places)) ? extra.places : [];
  const drop = new Set();
  for (const p of places) for (const id of p.replaces || []) drop.add(Number(id));
  let rows = drop.size ? doc.rows.filter((r) => !drop.has(r[0])) : doc.rows;
  if (places.length) {
    const add = places.map((p) => [p.id, p.name, p.admin || '', p.cc, p.lat, p.lon, p.w, p.kind, p.aliases || null]);
    rows = rows.slice();
    for (const a of add) { // insert before the first row of lower weight
      let lo = 0, hi = rows.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid][6] >= a[6]) lo = mid + 1; else hi = mid; }
      rows.splice(lo, 0, a);
    }
  }
  const n = rows.length;
  const fname = new Array(n);
  const falias = new Map();
  for (let i = 0; i < n; i++) {
    fname[i] = fold(rows[i][1]);
    if (rows[i][8]) falias.set(i, rows[i][8].map(fold));
  }
  return { rows, fname, falias, exactQuals: null };
}

/** Every folded string an exact (no prefix) qualifier can be, so "san fran" skips a full scan for the qualifier "fran". */
function exactQuals() {
  if (data.exactQuals) return data.exactQuals;
  const set = new Set(['uk', 'england', 'great britain', 'usa', 'us', 'america', 'united states']);
  const seen = new Set();
  for (const r of data.rows) {
    const key = r[3] + '|' + r[2];
    if (seen.has(key)) continue;
    seen.add(key);
    const [, , admin, cc] = r;
    set.add(fold(cc)); set.add(fold(countryName(cc)));
    if (cc === 'US' && admin) { set.add(fold(admin)); set.add(fold(US_STATES[admin] || '')); }
    if (cc === 'CA' && admin) { const pc = CA_PROVINCES[admin]; set.add(fold(pc || '')); set.add(fold(CA_NAMES[pc] || '')); }
  }
  set.delete('');
  return (data.exactQuals = set);
}

/** Test hook and offline hook: use an already parsed cities.json document (and, optionally, places-extra.json). */
export function setData(doc, extra = null) { data = prepare(doc, extra); loading = Promise.resolve(data); return data; }

/** Start loading (idempotent). Resolves to true when the table is ready, false when it cannot be loaded. */
export function load() {
  if (data) return Promise.resolve(true);
  if (!loading) {
    loading = (async () => {
      const get = async (url, name, optional) => {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(name + ' ' + res.status);
          return await res.json();
        } catch (e) { if (optional) { console.warn('gazetteer: ' + e.message + ' (curated places skipped)'); return null; } throw e; }
      };
      const [doc, extra] = await Promise.all([get(CITIES_URL, 'cities.json', false), get(EXTRA_URL, 'places-extra.json', true)]);
      data = prepare(doc, extra);
      return data;
    })().catch((e) => { loading = null; console.warn('gazetteer: ' + e.message); return null; });
  }
  return loading.then((d) => !!d);
}
export const isReady = () => !!data;

const toCity = (r) => { const c = { id: r[0], name: r[1], admin: r[2], cc: r[3], lat: r[4], lon: r[5] }; if (r[7]) c.kind = r[7]; return c; };

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
function scoreName(name, toks, full) {
  for (const t of toks) if (name.indexOf(t) < 0) return 0; // cheap reject before splitting into words
  if (name === full) return 4;
  const words = name.split(' ');
  for (const t of toks) {
    if (!words.some((w) => w.startsWith(t))) return 0;
  }
  return 2; // a prefix of every token in some word; population and weight order within the tier
}

// An exact-name match is demoted to the partial tier only when it is small in absolute terms (under 10,000 people) AND
// heavily outweighed by the best match. A ratio alone would push Bern (pop100 1216) below Sao Bernardo do Campo.
const SMALL_W = 100;
const OUTWEIGH = 4;
const outweighed = (w, wBest) => w < SMALL_W && w * OUTWEIGH < wBest;

function run(toks, qual, n, filterQual, prefixOk = true, demote = true) {
  const { rows, fname } = data;
  const best = []; // [score, idx]
  const need = n;
  // Rows are population-sorted: collect by score tiers, stop early once top tier is full.
  const tiers = [[], [], [], [], [], []];
  const { falias } = data;
  const full = toks.join(' ');
  // A curated alias that is the whole query ("Squaw Valley" for Olympic Valley) outranks an exact name elsewhere.
  for (const [i, al] of falias) {
    if (al.includes(full) && (!filterQual || qualMatches(qual, rows[i], prefixOk))) tiers[5].push(i);
  }
  // Rows are weight-sorted, so the first match found is the heaviest. An exact name outranks partial matches unless it is
  // a small place (pop100 < SMALL_W) heavily outweighed (OUTWEIGH x) by that heaviest match: "Mammoth" (AZ, 1,500
  // people) ranks among the partials after Mammoth Lakes, but Bern, Porto and York still lead with themselves.
  let wBest = -1;
  for (let i = 0; i < rows.length; i++) {
    let s = scoreName(fname[i], toks, full);
    const al = s < 4 && falias.get(i);
    if (al) for (const a of al) s = Math.max(s, scoreName(a, toks, full));
    if (!s || tiers[5].includes(i)) continue;
    if (filterQual && !qualMatches(qual, rows[i], prefixOk)) continue;
    if (wBest < 0) wBest = rows[i][6];
    else if (demote && s === 4 && outweighed(rows[i][6], wBest)) s = 2;
    tiers[s].push(i);
    if (tiers[4].length >= need) break; // exact matches fill the list; nothing outranks them
  }
  for (let s = 5; s >= 1 && best.length < need; s--) for (const i of tiers[s]) { best.push(i); if (best.length >= need) break; }
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
  // Collapse rows with the same label ("Reno, TX" twice): keep the first in rank order, the heaviest of its tier. Fetch
  // exactly n first (run() stops early once n exact names are found, which keeps a search fast); only when something was
  // collapsed or repeated and the list came up short, fetch again with room to spare.
  const collect = (m) => {
    const out = [];
    const seen = new Set();
    const labels = new Set();
    let skipped = false;
    const add = (idxs) => {
      for (const i of idxs) {
        if (out.length >= n) break;
        if (seen.has(i)) { skipped = true; continue; }
        seen.add(i);
        const lab = cityLabel(toCity(data.rows[i]));
        if (labels.has(lab)) { skipped = true; continue; }
        labels.add(lab); out.push(i);
      }
    };
    if (qual) {
      add(run(toks, qual, m, true));
      if (out.length < n && qual.length <= 3) add(run(toks, qual, m, false)); // unknown qualifier: still offer name matches
    } else {
      // "Portland OR" / "Portland Oregon": try the trailing 1-3 words as a region qualifier first.
      if (toks.length >= 2) {
        for (let k = Math.min(3, toks.length - 1); k >= 1; k--) {
          const q2 = toks.slice(-k).join(' ');
          if (!exactQuals().has(q2)) continue;
          const rest = toks.slice(0, -k);
          const hits = run(rest, q2, m, true, false);
          if (hits.length) { add(hits); break; }
        }
      }
      add(run(toks, '', m, false));
    }
    return { out, short: skipped && out.length < n };
  };
  let res = collect(n);
  if (res.short) res = collect(n * 4 + 8);
  const out = res.out;
  return out.map((i) => toCity(data.rows[i]));
}

/**
 * True when the query is a name that more than one distinct place answers to and nothing in it settles which
 * (no comma qualifier, no trailing state or country, not an alias): "Tahoe", "Portland". A second place counts when it
 * matches as well as the first and carries at least a tenth of its weight, so "Seattle" and "San Francisco" are not
 * ambiguous but "Portland" and "Tahoe" are. The UI should ask rather than pick (W3-07). Needs the table loaded.
 */
export function ambiguous(q) {
  if (!data) return false;
  const raw = String(q ?? '');
  if (raw.indexOf(',') >= 0) return false;
  const name = fold(raw);
  if (!name || ALIASES[name]) return false;
  const toks = name.split(' ');
  if (toks.length >= 2) { // "Portland OR": a trailing qualifier that selects rows settles it
    for (let k = Math.min(3, toks.length - 1); k >= 1; k--) {
      const q2 = toks.slice(-k).join(' ');
      if (exactQuals().has(q2) && run(toks.slice(0, -k), q2, 1, true, false, false).length) return false;
    }
  }
  // Judge on the undemoted ranking (every exact name first): whether a name is ambiguous must not depend on where search
  // happens to list a small namesake for display.
  const idx = run(toks, '', 5, false, true, false);
  if (idx.length < 2) return false;
  const full = toks.join(' ');
  const { rows, fname } = data;
  // One exact name and the rest only partial settles it, but only when the exact place is at least comparable in weight
  // to the best partial match ("Seattle" vs "Seattle Heights"; not "Mammoth", a tiny town, vs Mammoth Lakes).
  const wBest = Math.max(...idx.map((i) => rows[i][6]));
  if (fname[idx[0]] === full && !(fname[idx[1]] === full) && rows[idx[0]][6] * 2 >= wBest) return false;
  const w0 = Math.max(rows[idx[0]][6], 1);
  const distinct = idx.slice(1).filter((i) => rows[i][6] * 10 >= w0 && (rows[i][0] !== rows[idx[0]][0]));
  return distinct.length > 0;
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
    if (r[7] && r[7] !== 'town') continue; // regions, resorts and parks are areas, not a place to pin to
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
  const s = String(id);
  const want = /^x-/.test(s) ? s : Number(s.replace(/^c/, ''));
  const r = data.rows.find((x) => x[0] === want);
  return r ? toCity(r) : null;
}

/** City by GeoNames id (number or 'c123'), loading the table first; null if unknown or unloadable. Links resolve through this. */
export async function byId(id) {
  if (!(await load())) return null;
  return byIdSync(id);
}

export const gazetteer = { search, nearest, load, isReady, searchSync, nearestSync, byId, byIdSync, setData, cityLabel, ambiguous };
