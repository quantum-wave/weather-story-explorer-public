// Data facade: manifest, chunk loading and decoding, temporal blending, point sampling.
// Frames are kept as Int16 (as stored); fieldAt blends the two bracketing steps into one reused Float32 frame
// per (field, domain), with no-data as NaN.
import { store, bus } from '../state.js';
import { NODATA } from '../contract.js';
import { decodeChunk } from './decode.js';
import { toGrid, nodeLonLat, bilinear } from './grid.js';

let manifest = null;
let base = 'data/';
let fetchImpl = (u) => fetch(u);
let version = 0; // bumps whenever a chunk lands
const frames = new Map(); // `${field}|${domain}` -> Int16Array[] indexed like the field's steps (undefined = not loaded)
const pending = new Map(); // `${field}|${domain}|${chunk}` -> Promise
const blended = new Map(); // `${field}|${domain}` -> {buf, t, ver}
const spreadCache = new Map(); // `${domain}|${stepIndex}` -> number

/** Test hook: replace fetch (bytes loaded from a directory in Node) and forget everything. */
export function _reset({ fetch: f } = {}) {
  manifest = null; base = 'data/'; version = 0;
  fetchImpl = f || ((u) => fetch(u));
  frames.clear(); pending.clear(); blended.clear(); spreadCache.clear();
}

export async function loadManifest(url = 'data/manifest.json') {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  const m = await res.json();
  frames.clear(); pending.clear(); blended.clear(); spreadCache.clear();
  manifest = m;
  base = url.slice(0, url.lastIndexOf('/') + 1);
  store.set({ sample: !!m.sample });
  bus.emit('data:manifest', m);
  return m;
}

export function getManifest() { return manifest; }
export function dataVersion() { return version; }

const fieldMeta = (id) => manifest?.fields?.[id] ?? null;

const MAX_BLEND_GAP_H = 12; // steps further apart than this are not blended (a partial run leaves holes, not invented frames)
/** Bracketing step indices and blend weight for forecast hour t, or null outside the field's range. */
function bracket(steps, t) {
  const n = steps.length;
  if (!n || !(t >= steps[0] - 1e-6) || !(t <= steps[n - 1] + 1e-6)) return null;
  if (t <= steps[0]) return { i0: 0, i1: 0, w: 0 };
  let i = 0;
  while (i < n - 2 && steps[i + 1] <= t) i++;
  if (n === 1) return { i0: 0, i1: 0, w: 0 };
  if (steps[i + 1] - steps[i] > MAX_BLEND_GAP_H) return t >= steps[i + 1] - 1e-6 ? { i0: i + 1, i1: i + 1, w: 0 } : null; // a gap is not drawn through
  const w = (t - steps[i]) / (steps[i + 1] - steps[i]);
  if (w >= 1 - 1e-9) return { i0: i + 1, i1: i + 1, w: 0 };
  return { i0: i, i1: i + 1, w: w < 1e-9 ? 0 : w };
}

const chunkOf = (meta, idx) => meta.chunks.find((c) => idx >= c.steps[0] && idx < c.steps[1]);

function loadChunk(fieldId, domain, chunk) {
  const key = `${fieldId}|${domain}|${chunk.id}`;
  if (pending.has(key)) return pending.get(key);
  const meta = fieldMeta(fieldId), file = chunk.files?.[domain], dom = manifest.domains[domain];
  if (!file) return Promise.resolve();
  const mf = manifest;
  const p = (async () => {
    const res = await fetchImpl(base + file.path);
    if (!res.ok) throw new Error(`${file.path} ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const nFrames = chunk.steps[1] - chunk.steps[0];
    const decoded = await decodeChunk(bytes, { nx: dom.nx, ny: dom.ny, nFrames, filter: meta.filter });
    if (mf !== manifest) return; // manifest replaced while loading
    const fk = `${fieldId}|${domain}`;
    let arr = frames.get(fk);
    if (!arr) { arr = new Array(meta.steps.length); frames.set(fk, arr); }
    decoded.forEach((f, i) => { arr[chunk.steps[0] + i] = f; });
    version++;
    bus.emit('data:chunk', { field: fieldId, domain, chunk: chunk.id });
  })();
  pending.set(key, p);
  p.catch(() => { if (pending.get(key) === p) pending.delete(key); });
  return p;
}

/** Load the chunks that hold the two steps around t. Resolves quietly for unknown fields, domains or times. */
export async function ensure(fieldId, domain, tHours) {
  const meta = fieldMeta(fieldId);
  if (!meta || !meta.domains.includes(domain)) return;
  const b = bracket(meta.steps, tHours);
  if (!b) return;
  const need = new Map();
  for (const idx of [b.i0, b.i1]) { const c = chunkOf(meta, idx); if (c) need.set(c.id, c); }
  await Promise.all([...need.values()].map((c) => loadChunk(fieldId, domain, c)));
}

/** Load every chunk of a field in a domain. */
export async function ensureAll(fieldId, domain) {
  const meta = fieldMeta(fieldId);
  if (!meta || !meta.domains.includes(domain)) return;
  await Promise.all(meta.chunks.map((c) => loadChunk(fieldId, domain, c)));
}

/**
 * The field at forecast hour t on a domain: a Float32Array (ny*nx, NaN = no data) blending the field's own two
 * adjacent steps. The array is reused: it stays valid until the next call for the same field and domain.
 * Null when t is outside the field's steps or a needed frame is not loaded yet.
 */
export function fieldAt(fieldId, domain, tHours) {
  const meta = fieldMeta(fieldId);
  if (!meta) return null;
  const arr = frames.get(`${fieldId}|${domain}`);
  if (!arr) return null;
  const b = bracket(meta.steps, tHours);
  if (!b) return null;
  const A = arr[b.i0], B = arr[b.i1];
  if (!A || !B) return null;
  const dom = manifest.domains[domain], n = dom.nx * dom.ny;
  const key = `${fieldId}|${domain}`;
  let slot = blended.get(key);
  if (!slot) { slot = { buf: new Float32Array(n), t: NaN, ver: -1 }; blended.set(key, slot); }
  if (slot.t === tHours && slot.ver === version) return slot.buf;
  const out = slot.buf, { scale, offset } = meta, nd = meta.nodata ?? NODATA;
  if (b.w === 0) {
    for (let k = 0; k < n; k++) { const a = A[k]; out[k] = a === nd ? NaN : a * scale + offset; }
  } else {
    const w = b.w, v = 1 - w;
    for (let k = 0; k < n; k++) {
      const a = A[k], c = B[k];
      out[k] = (a === nd || c === nd) ? NaN : (a * v + c * w) * scale + offset;
    }
  }
  slot.t = tHours; slot.ver = version;
  return out;
}

export function fieldSteps(fieldId) { return fieldMeta(fieldId)?.steps ?? []; }

/** Domains of a field that contain (lat, lon), finest first. */
function candidateDomains(fieldId, lat, lon) {
  const meta = fieldMeta(fieldId);
  if (!meta) return [];
  return meta.domains
    .map((id) => ({ id, d: manifest.domains[id] }))
    .filter(({ d }) => d && toGrid(d, lon, lat))
    .sort((a, b) => Math.abs(a.d.dlon) - Math.abs(b.d.dlon));
}

function pickLoaded(fieldId, cands) {
  for (const c of cands) {
    const arr = frames.get(`${fieldId}|${c.id}`);
    if (arr && arr.some(Boolean)) return c;
  }
  return null;
}

/**
 * The field's value at a place for every step: {steps, values} (field units). Steps whose chunk is not loaded
 * hold NaN, and the missing chunks start loading (a `data:chunk` event follows). Null if the field is unknown
 * or the place is outside every domain of the field.
 */
export function sampleSeries(fieldId, lat, lon) {
  const meta = fieldMeta(fieldId);
  if (!meta) return null;
  const cands = candidateDomains(fieldId, lat, lon);
  if (!cands.length) return null;
  const use = pickLoaded(fieldId, cands) ?? cands[0];
  const arr = frames.get(`${fieldId}|${use.id}`);
  for (const c of cands.slice(0, 1)) ensureAll(fieldId, c.id).catch(() => {});
  const steps = meta.steps, values = new Float32Array(steps.length).fill(NaN);
  const [gi, gj] = toGrid(use.d, lon, lat);
  for (let s = 0; s < steps.length; s++) {
    const f = arr?.[s];
    if (!f) continue;
    const v = bilinear(f, use.d, gi, gj, meta.nodata ?? NODATA);
    values[s] = v === v ? v * meta.scale + meta.offset : NaN;
  }
  return { steps: steps.slice(), values };
}

/** Largest value of the field within `km` of a place at step index `stepIndex`, or null when unavailable. */
export function maxWithin(fieldId, lat, lon, km, stepIndex) {
  const meta = fieldMeta(fieldId);
  if (!meta) return null;
  const cands = candidateDomains(fieldId, lat, lon);
  for (const c of cands.slice(0, 1)) ensureAll(fieldId, c.id).catch(() => {});
  for (const c of cands) {
    const f = frames.get(`${fieldId}|${c.id}`)?.[stepIndex];
    if (!f) continue;
    const d = c.d, nd = meta.nodata ?? NODATA;
    const dLat = km / 111.19, dLon = km / (111.19 * Math.max(0.05, Math.cos(lat * Math.PI / 180)));
    const [gi0, gj0] = toGrid(d, lon, lat);
    const ri = Math.ceil(Math.min(dLon, 360) / Math.abs(d.dlon)) + 1, rj = Math.ceil(dLat / Math.abs(d.dlat)) + 1;
    let best = -Infinity;
    for (let j = Math.max(0, Math.floor(gj0) - rj); j <= Math.min(d.ny - 1, Math.ceil(gj0) + rj); j++) {
      for (let i = Math.max(0, Math.floor(gi0) - ri); i <= Math.min(d.nx - 1, Math.ceil(gi0) + ri); i++) {
        const v = f[j * d.nx + i];
        if (v === nd) continue;
        const [nlon, nlat] = nodeLonLat(d, i, j);
        const p1 = lat * Math.PI / 180, p2 = nlat * Math.PI / 180, dl = (nlon - lon) * Math.PI / 180;
        const x = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
        if (12742 * Math.asin(Math.sqrt(x)) <= km) { const u = v * meta.scale + meta.offset; if (u > best) best = u; }
      }
    }
    return best === -Infinity ? null : best;
  }
  return null;
}

/** Area-weighted mean of z500sd over 30-60N, 150E-60W for each step, in field units (gpm; dam = gpm / 10). */
export function sampleDomainSpread() {
  const meta = fieldMeta('z500sd');
  if (!meta) return null;
  const order = meta.domains.slice().sort((a, b) => Math.abs(manifest.domains[a].dlon) - Math.abs(manifest.domains[b].dlon));
  for (const id of order) ensureAll('z500sd', id).catch(() => {}); // the ribbon needs every step
  const values = new Float32Array(meta.steps.length).fill(NaN);
  for (let s = 0; s < meta.steps.length; s++) {
    for (const id of order) {
      const f = frames.get(`z500sd|${id}`)?.[s];
      if (!f) continue;
      const ck = `${id}|${s}|${manifest.run}`;
      let v = spreadCache.get(ck);
      if (v === undefined) {
        const d = manifest.domains[id], nd = meta.nodata ?? NODATA;
        let sum = 0, wsum = 0;
        for (let j = 0; j < d.ny; j++) {
          const lat = d.lat0 + j * d.dlat;
          if (lat < 30 || lat > 60) continue;
          const w = Math.cos(lat * Math.PI / 180);
          for (let i = 0; i < d.nx; i++) {
            const lon = nodeLonLat(d, i, j)[0];
            if (!(lon >= 150 || lon <= -60)) continue;
            const x = f[j * d.nx + i];
            if (x === nd) continue;
            sum += x * w; wsum += w;
          }
        }
        v = wsum ? (sum / wsum) * meta.scale + meta.offset : NaN;
        spreadCache.set(ck, v);
      }
      values[s] = v;
      break;
    }
  }
  return { steps: meta.steps.slice(), values };
}

const MS_H = 3600e3;
const parseUTC = (s) => Date.parse(s.length === 17 ? s.replace(/Z$/, ':00Z') : s);

/**
 * Real-world time of the origin (forecast hour 0) of a sample case, from the case's first field's source.valid.
 * Null when the manifest is not a sample or the case has no dated field.
 */
export function caseOrigin(caseId) {
  if (!manifest?.sample) return null;
  const id = caseId ?? store.get().case;
  for (const f of manifest.cases?.[id]?.fields || []) {
    const meta = fieldMeta(f), v = meta?.source?.valid?.[0];
    if (v) return new Date(parseUTC(v) - (meta.steps?.[0] ?? 0) * MS_H);
  }
  return null;
}

/**
 * Valid time of forecast hour t. A live manifest: its run plus t hours. A sample manifest: the REAL date of the
 * case (default the active one), never a date rebased to today. `caseId` pins the case (the story reads case A).
 */
export function validTime(tHours, caseId) {
  const o = caseOrigin(caseId);
  if (o) return new Date(o.getTime() + tHours * MS_H);
  return new Date(parseUTC(manifest?.run ?? '2026-01-01T00:00Z') + tHours * MS_H);
}

/** Sample data only: the real valid time (Date) of forecast hour t for a field, from source.valid; else null. */
export function realValidTime(fieldId, tHours) {
  const meta = fieldMeta(fieldId), valid = meta?.source?.valid;
  const b = meta && valid ? bracket(meta.steps, tHours) : null;
  if (!b) return null;
  const a = parseUTC(valid[b.i0]), c = parseUTC(valid[b.i1]);
  return new Date(a + (c - a) * b.w);
}

export function caseOf(fieldId) {
  const c = fieldMeta(fieldId)?.case;
  return c ? { id: c, label: manifest.cases?.[c]?.label ?? c, source: manifest.fields[fieldId].source ?? null } : null;
}

/** Contiguous forecast-hour ranges [[from, to], ...] whose frames are loaded for a field (any domain). */
export function loadedRanges(fieldId) {
  const meta = fieldMeta(fieldId);
  if (!meta) return [];
  const have = meta.steps.map((_, s) => meta.domains.some((d) => frames.get(`${fieldId}|${d}`)?.[s]));
  const out = [];
  let start = -1;
  for (let s = 0; s <= have.length; s++) {
    if (have[s] && start < 0) start = s;
    if (!have[s] && start >= 0) { out.push([meta.steps[start], meta.steps[s - 1]]); start = -1; }
  }
  return out;
}
