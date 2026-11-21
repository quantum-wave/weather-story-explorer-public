// Deep-link grammar (SPEC section 7), pure: #<view>-<layers>-<YYYYMMDDHH>[-<place>].
// Only plain [a-z0-9-] reaches the page through claude.ai, so the grammar stays inside HASH_RE and avoids the
// reserved names. A person's pin never appears: the place token is a gazetteer city id or 'sf', nothing else.
import { HASH_RE, isReservedHash, LENS_CODES } from '../contract.js';

export const VIEW_IDS = ['np', 'nh', 'gl', 'wm'];
export const LAYER_ORDER = ['z', 'j', 'c', 't'];
/** Letters a layers token may hold: the lens codes plus the retired 't' (2 m temperature anomaly, now the Air mass lens). */
const TOKEN_LETTERS = [...new Set([...LAYER_ORDER, ...LENS_CODES])];
const LEGACY_LENS = { t: 'a' };
export const SF_ID = 5391959;
export const SF_FOCUS = { lat: 37.77, lon: -122.42, label: 'San Francisco', kind: 'place', placeRef: SF_ID };

export function layersToken(layers) {
  const s = LAYER_ORDER.filter((k) => layers && layers[k]).join('');
  return s || '0';
}

/** A focus's `placeRef` (a numeric gazetteer city id) -> 'sf' | 'c<id>'; anything else (null, a pin id) -> null. */
export function placeToken(placeRef) {
  if (placeRef == null) return null;
  const s = String(placeRef).replace(/^c/, '');
  if (!/^\d{1,9}$/.test(s)) return null;
  return Number(s) === SF_ID ? 'sf' : 'c' + s;
}
/** 'sf' | 'c<id>' -> numeric id, or null. */
export function placeIdOf(token) {
  if (token === 'sf') return SF_ID;
  const m = /^c(\d{1,9})$/.exec(token || '');
  return m ? Number(m[1]) : null;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
/** Date -> 'YYYYMMDDHH' in UTC (minutes dropped). */
export function utcStamp(date) {
  return pad(date.getUTCFullYear(), 4) + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate()) + pad(date.getUTCHours());
}
/** 'YYYYMMDDHH' -> Date (UTC) or null when it is not a real date. */
export function dateOfStamp(stamp) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(stamp || '');
  if (!m) return null;
  const [y, mo, d, h] = m.slice(1).map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, h));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || h > 23) return null;
  return dt;
}

/**
 * The layers token of a lens: its code, then 'j' when the Jet outline overlay is on over a lens other than the jet
 * ('z', 'zj', 'j', 's', 'sj'). Old tokens read the same way: 'zj' was the pattern with the jet, now the pattern with the jet outline.
 */
export function lensToken(lens, jetline) {
  return LENS_CODES.includes(lens) ? lens + (jetline && lens !== 'j' ? 'j' : '') : '0';
}

/**
 * parts: {view, layers, lens?, jetline?, validTime:'YYYYMMDDHH', place:'sf'|'c<id>'|null} -> '#np-zj-2026112212-sf'.
 * With a lens the token is the lens (and the jet outline); without one it is the legacy layers.
 */
export function buildHash({ view, layers, lens, jetline, validTime, place }) {
  const parts = [VIEW_IDS.includes(view) ? view : 'np', LENS_CODES.includes(lens) ? lensToken(lens, jetline) : layersToken(layers), validTime];
  if (place) parts.push(place);
  const h = parts.join('-');
  if (!HASH_RE.test(h) || isReservedHash(h)) throw new Error('hash grammar produced an unsafe hash: ' + h);
  return '#' + h;
}

/**
 * '#np-zj-2026112212-sf' -> {view, layers:{z,j,c,t}, lens, jetline, validTime, place, snapped:false}, or null if it is not ours.
 * `layers` is the letters present (the retired model); `lens` is the first letter ('t' reads as the Air mass lens 'a'; null for
 * '0'), `jetline` is a 'j' after another lens.
 */
export function parseHash(hash) {
  if (typeof hash !== 'string') return null;
  let h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!HASH_RE.test(h) || h === '' || isReservedHash(h)) return null;
  const parts = h.split('-');
  if (parts[parts.length - 1] === 'debug') parts.pop(); // WP3's #debug readout may ride along
  if (parts.length < 3 || parts.length > 4) return null;
  const [view, lay, stamp, place = null] = parts;
  if (!VIEW_IDS.includes(view)) return null;
  if (!(lay === '0' || (new RegExp(`^[${TOKEN_LETTERS.join('')}]{1,4}$`).test(lay) && new Set(lay).size === lay.length))) return null;
  if (!dateOfStamp(stamp)) return null;
  if (place !== null && placeIdOf(place) === null) return null;
  const layers = {};
  for (const k of LAYER_ORDER) layers[k] = lay.includes(k);
  const first = lay === '0' ? null : lay[0];
  const lens = first ? LEGACY_LENS[first] || first : null;
  return { view, layers, lens, jetline: !!lens && lens !== 'j' && lay.includes('j'), validTime: stamp, place, snapped: false };
}
