// Frozen data contract (PLAN Interfaces, SPEC sections 3, 7, 9, 11). Ids and conventions only:
// the manifest is authoritative for grid sizes, scales and offsets. Changing this file is a Departure.

export const FIELD_IDS = ['z500', 'z500a', 'z500sd', 'z500em', 'ws250', 'tp6', 'pr1', 'pr10', 't850a', 't2m', 'msl', 'ivt', 't2a'];
export const DOMAIN_IDS = ['g1', 'np05'];
/** View id -> the domain it draws. */
export const VIEWS = { np: 'np05', nh: 'g1', gl: 'g1', wm: 'g1' };
/** The retired layer letters of old hashes -> field id (the store no longer has a layers key; the lens decides what is drawn). */
export const LAYER_CODES = { z: 'z500a', j: 'ws250', c: 'z500sd', t: 't2a' };
/** Lens code (store.lens and the hash) -> the field its fill draws. Pattern, Jet stream, Storms and rain, Air mass, Atmospheric rivers, Confidence. */
export const LENS_CODES = ['z', 'j', 's', 'a', 'r', 'c'];
export const LENS_FILL = { z: 'z500a', j: 'ws250', s: 'tp6', a: 't850a', r: 'ivt', c: 'z500sd' };
export const NODATA = -32768;
export const STORE_KEY = 'wse.v1.store';
export const HASH_RE = /^[a-z0-9-]{0,64}$/;
export const RESERVED_HASHES = ['settings', 'sidebar', 'customize', 'upgrade', 'downloads'];
export const RESERVED_HASH_PREFIXES = ['comment-'];
export function isReservedHash(h) {
  return RESERVED_HASHES.includes(h) || RESERVED_HASH_PREFIXES.some((p) => h.startsWith(p));
}
export const CHUNK_IDS = ['a', 'b', 'c'];
/** Chunk id -> inclusive forecast-hour range that chunk holds. */
export const CHUNK_HOURS = { a: [0, 120], b: [126, 240], c: [246, 360] };

/**
 * Domain geometry (manifest.domains[id]). Node (i, j) is at lon = lon0 + i*dlon, lat = lat0 + j*dlat
 * (rows run north to south, dlat < 0). Longitudes of np05 run east 150..310; compare modulo 360.
 * A domain has a wrap column (last column repeats the first, 360 degrees on) when (nx-1)*dlon == 360 (g1).
 */
export function domainWraps(d) { return Math.abs((d.nx - 1) * d.dlon - 360) < 1e-6; }

/**
 * Binary chunk (data/<field>.<domain>.<chunk>.bin), frozen:
 *   gzip( frame_0 ++ frame_1 ++ ... ), one frame per entry of the chunk's step index range, each frame
 *   ny*nx Int16 little-endian, row-major, north to south, then filtered per `filter`:
 *   "none":      the Int16 values as they are.
 *   "dx-shuffle": per row, the difference to the previous column (first column raw; Int16 wraps mod 65536),
 *                 then, for the whole frame, all low bytes in row-major order followed by all high bytes.
 *   Decode: un-shuffle, per-row cumulative sum mod 65536, reinterpret as Int16. value = int16*scale + offset;
 *   NODATA (-32768) is no data. Check the gzip magic (1f 8b) and inflate with DecompressionStream or fflate.
 *
 * Manifest `chunks[].steps` is a half-open range of indices into the field's own `steps` array.
 * `probes[].step` is a forecast hour (a member of the field's steps); `value` is the dequantized value at the
 * node nearest to (lat, lon) in that domain, null where that node is NODATA (such probes are not listed).
 * Sample manifests: `run` is the rebased step-0 time; per field `source.valid` holds the real valid times.
 *
 * @typedef {{lon0:number, lat0:number, dlon:number, dlat:number, nx:number, ny:number}} Domain
 * @typedef {{id:string, steps:[number,number], files:Object<string,{path:string, bytes:number, sha256:string}>}} Chunk
 * @typedef {{units:string, scale:number, offset:number, nodata:number, filter:'none'|'dx-shuffle',
 *   steps:number[], domains:string[], chunks:Chunk[], case?:string,
 *   source?:{dataset:string, file?:string, valid:(string[]|null)}}} FieldMeta
 * @typedef {{name:string, lat:number, lon:number, field:string, domain:string, step:number, value:number}} Probe
 * @typedef {{schema:1, sample:boolean, sample_note?:string, model:string, run:string, generated:string,
 *   attribution:string, climatology:{label:string, source:string, method:string},
 *   domains:Object<string,Domain>, fields:Object<string,FieldMeta>, probes:Probe[],
 *   cases?:Object<string,{label:string, fields:string[]}>}} Manifest
 *
 * Story (SPEC section 6):
 * @typedef {{dayIndex:number, date:string, lead:number,
 *   pattern:'ridge'|'trough'|'trough-arriving'|'ridge-building'|'near-normal'|'none', stormTrack:boolean,
 *   wet:'dry'|'light'|'moderate'|'heavy'|'none', wetPhrase:string,
 *   airMass:'much-warmer'|'warmer'|'near-normal'|'cooler'|'much-cooler'|'none',
 *   confidence:'high'|'medium'|'low'|'pattern-only'|'none'}} DayClass
 *
 * Pins (SPEC section 5; names and notes are user text, render with textContent only):
 * @typedef {{id:number|string, name:string, admin:string, cc:string, lat:number, lon:number}} City
 * @typedef {{id:string, kind:'person'|'place', name:string, group:string, city:City, note:string, updated:number}} Pin
 * @typedef {{id:string, label:string, city:City, start:string, end:string, updated:number}} Trip
 * @typedef {{lat:number, lon:number, label:string, kind:string, placeRef:(string|null)}} Focus
 */
