// Deep-link grammar (SPEC section 7), pure: #<view>-<layers>-<YYYYMMDDHH>[-<place>].
// Only plain [a-z0-9-] reaches the page through claude.ai, so the grammar stays inside HASH_RE and avoids the
// reserved names. A person's pin never appears: the place token is a gazetteer city id or 'sf', nothing else.
import { HASH_RE, isReservedHash } from '../contract.js';

export const VIEW_IDS = ['np', 'nh', 'gl'];
export const LAYER_ORDER = ['z', 'j', 'c', 't'];
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

/** parts: {view, layers, validTime:'YYYYMMDDHH', place:'sf'|'c<id>'|null} -> '#np-zj-2026112212-sf'. */
export function buildHash({ view, layers, validTime, place }) {
  const parts = [VIEW_IDS.includes(view) ? view : 'np', layersToken(layers), validTime];
  if (place) parts.push(place);
  const h = parts.join('-');
  if (!HASH_RE.test(h) || isReservedHash(h)) throw new Error('hash grammar produced an unsafe hash: ' + h);
  return '#' + h;
}

/** '#np-zj-2026112212-sf' -> {view, layers:{z,j,c,t}, validTime, place, snapped:false}, or null if it is not ours. */
export function parseHash(hash) {
  if (typeof hash !== 'string') return null;
  let h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!HASH_RE.test(h) || h === '' || isReservedHash(h)) return null;
  const parts = h.split('-');
  if (parts[parts.length - 1] === 'debug') parts.pop(); // WP3's #debug readout may ride along
  if (parts.length < 3 || parts.length > 4) return null;
  const [view, lay, stamp, place = null] = parts;
  if (!VIEW_IDS.includes(view)) return null;
  if (!(lay === '0' || (/^[zjct]{1,4}$/.test(lay) && new Set(lay).size === lay.length))) return null;
  if (!dateOfStamp(stamp)) return null;
  if (place !== null && placeIdOf(place) === null) return null;
  const layers = {};
  for (const k of LAYER_ORDER) layers[k] = lay.includes(k);
  return { view, layers, validTime: stamp, place, snapped: false };
}
