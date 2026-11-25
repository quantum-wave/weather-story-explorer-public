// Data facade: manifest, chunk loading and decoding, temporal blending, point sampling.
// Frames are kept as Int16 (as stored); rawFieldAt blends the two bracketing steps into one reused Float32 frame
// per (field, domain), with no-data as NaN. The blend in time is a monotone cubic (data/interp.js) over the two bracketing
// steps and one neighbour on each side, so motion has no jolt at each step; it equals the stored frame at every step and
// stays between the two bracketing values, falling back to the linear blend at the range ends and next to a gap. The pattern fields (z500, z500a) go through patternField, which moves from
// the single high-resolution run to the ensemble mean between 168 h and 240 h (DESIGN-SPEC 7.2); the map and the story
// (patternSeries) share one weight, so a card at day 9 describes what the map at day 9 shows.
import { store, bus, choice } from '../state.js';
import { NODATA } from '../contract.js';
import { decodeChunk } from './decode.js';
import { toGrid, nodeLonLat, bilinear } from './grid.js';
import { tangent, basis } from './interp.js';
import { isLive, isMultiCase, caseForLens } from './kind.js';

let manifest = null;
let base = 'data/';
let fetchImpl = (u) => fetch(u);
let version = 0; // bumps whenever a chunk lands
const frames = new Map(); // `${field}|${domain}` -> Int16Array[] indexed like the field's steps (undefined = not loaded)
const pending = new Map(); // `${field}|${domain}|${chunk}` -> Promise
const blended = new Map(); // `${field}|${domain}` -> {buf, t, ver}: the buffers behind storedFieldAt (the public raw frame)
const inner = new Map(); // same key: patternField's private reads of z500 / z500a / z500em, so no caller's frame is ever overwritten
const patterned = new Map(); // `${kind}|${domain}` -> {buf, t, ver}: patternField's own output buffers (what fieldAt returns)
const deltas = new Map(); // `${domain}` -> {buf, t, ver}: (mean - z500) on a source domain, shared by both kinds
const announced = new Set(); // mean-source notices already sent for this manifest
const spreadCache = new Map(); // `${domain}|${stepIndex}` -> number

/** Test hook: replace fetch (bytes loaded from a directory in Node) and forget everything. */
export function _reset({ fetch: f } = {}) {
  manifest = null; base = 'data/'; version = 0;
  fetchImpl = f || ((u) => fetch(u));
  frames.clear(); pending.clear(); blended.clear(); inner.clear(); patterned.clear(); deltas.clear(); announced.clear(); spreadCache.clear();
}

export async function loadManifest(url = 'data/manifest.json') {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  const m = await res.json();
  frames.clear(); pending.clear(); blended.clear(); inner.clear(); patterned.clear(); deltas.clear(); announced.clear(); spreadCache.clear();
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
  if (t - steps[i] < 1e-9) return { i0: i, i1: i, w: 0 }; // on a step: its own frame, even when a gap follows it
  if (steps[i + 1] - steps[i] > MAX_BLEND_GAP_H) return t >= steps[i + 1] - 1e-6 ? { i0: i + 1, i1: i + 1, w: 0 } : null; // a gap is not drawn through
  const w = (t - steps[i]) / (steps[i + 1] - steps[i]);
  if (w >= 1 - 1e-9) return { i0: i + 1, i1: i + 1, w: 0 };
  return { i0: i, i1: i + 1, w: w < 1e-9 ? 0 : w };
}

/** The steps beyond a bracket that the cubic blend reads: {im, ip}, each -1 when missing (range end, or a gap beyond the blend gap). */
function neighbours(steps, b) {
  if (b.w === 0) return { im: -1, ip: -1 };
  const im = b.i0 - 1, ip = b.i1 + 1;
  return {
    im: im >= 0 && steps[b.i0] - steps[im] <= MAX_BLEND_GAP_H ? im : -1,
    ip: ip < steps.length && steps[ip] - steps[b.i1] <= MAX_BLEND_GAP_H ? ip : -1,
  };
}

const chunkOf = (meta, idx) => meta.chunks.find((c) => idx >= c.steps[0] && idx < c.steps[1]);

/** A chunk that could not be had (missing file, bad status, corrupt bytes) is announced once per attempt, then rejects. */
function loadChunk(fieldId, domain, chunk) {
  const key = `${fieldId}|${domain}|${chunk.id}`;
  if (pending.has(key)) return pending.get(key);
  const meta = fieldMeta(fieldId), file = chunk.files?.[domain], dom = manifest.domains[domain];
  const fail = (e) => bus.emit('data:error', { field: fieldId, domain, chunk: chunk.id, message: String(e?.message ?? e) });
  if (!file) { // the field lists the domain but the manifest has no file for this chunk: say so once, then stay quiet
    fail(new Error(`${fieldId} ${domain} chunk ${chunk.id} is not in the manifest`));
    const p = Promise.resolve(); pending.set(key, p); return p;
  }
  const mf = manifest;
  const p = (async () => {
    try {
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
    } catch (e) {
      if (mf === manifest) fail(e);
      throw e;
    }
  })();
  pending.set(key, p);
  p.catch(() => { if (pending.get(key) === p) pending.delete(key); });
  return p;
}

async function ensureRaw(fieldId, domain, tHours) {
  const meta = fieldMeta(fieldId);
  if (!meta || !meta.domains.includes(domain)) return;
  const b = bracket(meta.steps, tHours);
  if (!b) return;
  const need = new Map(), nb = neighbours(meta.steps, b);
  for (const idx of [b.i0, b.i1, nb.im, nb.ip]) {
    if (idx < 0) continue; const c = chunkOf(meta, idx); if (c) need.set(c.id, c); }
  await Promise.all([...need.values()].map((c) => loadChunk(fieldId, domain, c)));
}

async function ensureAllRaw(fieldId, domain) {
  const meta = fieldMeta(fieldId);
  if (!meta || !meta.domains.includes(domain)) return;
  await Promise.all(meta.chunks.map((c) => loadChunk(fieldId, domain, c)));
}

/**
 * Load the chunks that hold the two steps around t. Resolves quietly for unknown fields, domains or times.
 * For z500 and z500a it also loads what a blended frame at t needs (z500 and the ensemble mean) once t is past 168 h.
 */
export async function ensure(fieldId, domain, tHours) {
  const jobs = [ensureRaw(fieldId, domain, tHours)];
  if (isPatternKind(fieldId) && tHours > BLEND_START_H) {
    const src = meanSource(domain);
    if (fieldId !== 'z500') jobs.push(ensureRaw('z500', domain, tHours));
    if (src) { jobs.push(ensureRaw('z500', src.from, tHours), ensureRaw(MEAN_FIELD, src.from, tHours)); }
  }
  await Promise.all(jobs);
}

/** Load every chunk of a field in a domain (for z500 and z500a, the ensemble mean's and z500's too when the run has a mean). */
export async function ensureAll(fieldId, domain) {
  const jobs = [ensureAllRaw(fieldId, domain)];
  if (isPatternKind(fieldId)) {
    const src = meanSource(domain);
    if (src) { if (fieldId !== 'z500') jobs.push(ensureAllRaw('z500', domain)); jobs.push(ensureAllRaw('z500', src.from), ensureAllRaw(MEAN_FIELD, src.from)); }
  }
  await Promise.all(jobs);
}

/**
 * The field at forecast hour t on a domain: a Float32Array (ny*nx, NaN = no data) blending the field's own two
 * adjacent steps (a monotone cubic in time that also reads the step on each side when it is loaded; linear without them). The array is reused: it stays valid until the next call for the same field and domain.
 * Null when t is outside the field's steps or a needed frame is not loaded yet.
 * Private: what the file holds, with no ensemble blending. Callers use fieldAt / patternField.
 */
function rawFieldAt(fieldId, domain, tHours, slots = blended) {
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
  let slot = slots.get(key);
  if (!slot) { slot = { buf: new Float32Array(n), t: NaN, ver: -1 }; slots.set(key, slot); }
  if (slot.t === tHours && slot.ver === version) return slot.buf;
  const out = slot.buf, { scale, offset } = meta, nd = meta.nodata ?? NODATA;
  if (b.w === 0) {
    for (let k = 0; k < n; k++) { const a = A[k]; out[k] = a === nd ? NaN : a * scale + offset; }
  } else {
    // Monotone cubic Hermite in stored units (scale and offset are applied after; a linear map keeps it monotone).
    const st = meta.steps, nb = neighbours(st, b);
    const P = nb.im >= 0 ? arr[nb.im] : null, Q = nb.ip >= 0 ? arr[nb.ip] : null;
    const h = st[b.i1] - st[b.i0], hl = P ? st[b.i0] - st[nb.im] : h, hr = Q ? st[nb.ip] - st[b.i1] : h;
    const [h00, h10, h01, h11] = basis(b.w);
    const ih = 1 / h, ihl = 1 / hl, ihr = 1 / hr, k10 = h10 * h, k11 = h11 * h;
    for (let k = 0; k < n; k++) {
      const a = A[k], c = B[k];
      if (a === nd || c === nd) { out[k] = NaN; continue; }
      const d = (c - a) * ih;
      let m0 = d, m1 = d;
      if (P) { const p = P[k]; if (p !== nd) m0 = tangent((a - p) * ihl, d, hl, h); }
      if (Q) { const q = Q[k]; if (q !== nd) m1 = tangent(d, (q - c) * ihr, h, hr); }
      let x = h00 * a + k10 * m0 + h01 * c + k11 * m1;
      if (a < c) { if (x < a) x = a; else if (x > c) x = c; } else if (x < c) x = c; else if (x > a) x = a;
      out[k] = x * scale + offset;
    }
  }
  slot.t = tHours; slot.ver = version;
  return out;
}

/** The stored field exactly as the build wrote it (no blending), for the decode check against the manifest probes. */
export const storedFieldAt = rawFieldAt;

const MEAN_FIELD = 'z500em';
const BLEND_START_H = 168, BLEND_END_H = 240; // DESIGN-SPEC 7.2 zones: the single run to 168 h, the mean from 240 h
const isPatternKind = (f) => f === 'z500' || f === 'z500a';

const meanListed = () => {
  const meta = fieldMeta(MEAN_FIELD);
  return !!meta && meta.steps?.length > 0 && !(manifest?.missing || []).some((x) => x?.field === MEAN_FIELD);
};

/**
 * Where the ensemble mean for a pattern frame on `domain` comes from, so the map never goes blank when the mean was
 * recorded on fewer domains than z500 (the build gives z500 and z500a an extra domain, np05, that z500em may lack):
 *  { from: domain }            the mean and z500 are both on the domain itself;
 *  { from: other, resample }  the finest other domain that has both and covers the whole of this one (bilinear);
 *  null                       no usable mean for this domain: the single run is shown, and says so (data:mean).
 */
function meanSource(domain) {
  if (!meanListed() || !manifest.domains?.[domain]) return null;
  const em = fieldMeta(MEAN_FIELD), z = fieldMeta('z500');
  const both = (d) => em.domains.includes(d) && z?.domains.includes(d) && manifest.domains[d];
  if (both(domain)) return { from: domain, resample: false };
  const dom = manifest.domains[domain];
  const corners = [[0, 0], [dom.nx - 1, 0], [0, dom.ny - 1], [dom.nx - 1, dom.ny - 1], [(dom.nx - 1) / 2, (dom.ny - 1) / 2]].map(([i, j]) => nodeLonLat(dom, i, j));
  const cands = em.domains.filter((d) => d !== domain && both(d) && corners.every(([lo, la]) => toGrid(manifest.domains[d], lo, la)));
  cands.sort((a, b) => Math.abs(manifest.domains[a].dlon) - Math.abs(manifest.domains[b].dlon));
  return cands.length ? { from: cands[0], resample: true } : null;
}

/**
 * True when the run carries the ensemble mean (z500em) and does not list it as missing. With a domain (a string) or a
 * place ({lat, lon}) it answers for that one: true only when the pattern there really can move to the mean.
 */
export function hasMean(where) {
  if (where == null) return meanListed();
  if (typeof where === 'string') return meanSource(where) !== null;
  return meanListed() && candidateDomains(MEAN_FIELD, where.lat, where.lon).length > 0;
}

/** Weight of the ensemble mean at forecast hour t, 0 to 1 (0 at 168 h, 0.5 at 204 h, 1 at 240 h); 0 at every t without a mean. */
function weightAt(t, where) {
  if (!hasMean(where) || !(t > BLEND_START_H)) return 0;
  return t >= BLEND_END_H ? 1 : (t - BLEND_START_H) / (BLEND_END_H - BLEND_START_H);
}

/** Which source the pattern shows at t, as the zones table names them: 'hres' | 'blend' | 'mean'. Domain or place aware. */
export function patternSource(t, where) {
  if (!hasMean(where) || !(t >= BLEND_START_H)) return 'hres';
  return t >= BLEND_END_H ? 'mean' : 'blend';
}

/** (mean - z500) at t on the source domain, in a buffer of its own; null while a frame is not loaded. */
function deltaAt(from, tHours) {
  const z = rawFieldAt('z500', from, tHours, inner), em = rawFieldAt(MEAN_FIELD, from, tHours, inner);
  if (!z || !em) return null;
  let slot = deltas.get(from);
  if (!slot) { slot = { buf: new Float32Array(z.length), t: NaN, ver: -1 }; deltas.set(from, slot); }
  if (slot.t === tHours && slot.ver === version) return slot.buf;
  for (let k = 0; k < z.length; k++) slot.buf[k] = em[k] - z[k];
  slot.t = tHours; slot.ver = version;
  return slot.buf;
}

/**
 * The pattern field at forecast hour t on a domain, kind 'z500' or 'z500a' (Float32Array, NaN = no data): the single run
 * before 168 h, a linear blend to the ensemble mean by 240 h, the mean after, and the single run at every t when the
 * domain has no mean. The anomaly of the mean is z500em - (z500 - z500a) at the same step, so the blended anomaly is
 * z500a + w * (z500em - z500). The frame is always the kind's own buffer (a copy even when w is 0), valid until the next
 * call for the same kind and domain; it reads private slots, so no frame a caller holds (fieldAt, storedFieldAt) is
 * ever overwritten. When the mean is not on this domain it is resampled from another that covers it (announced once as
 * data:mean). Null only when a needed frame is not loaded.
 */
export function patternField(kind, domain, tHours) {
  if (!isPatternKind(kind)) return null;
  const base = rawFieldAt(kind, domain, tHours, inner);
  if (!base) return null;
  const src = tHours > BLEND_START_H ? meanSource(domain) : null;
  const w = src ? weightAt(tHours, domain) : 0;
  if (tHours > BLEND_START_H && meanListed()) {
    const key = `${domain}|${src ? src.from : '-'}`;
    if ((!src || src.resample) && !announced.has(key)) {
      announced.add(key);
      bus.emit('data:mean', src ? { domain, source: 'resampled', from: src.from } : { domain, source: 'none' });
    }
  }
  let delta = null;
  if (w > 0) { delta = deltaAt(src.from, tHours); if (!delta) return null; }
  const key = `${kind}|${domain}`;
  let slot = patterned.get(key);
  if (!slot) { slot = { buf: new Float32Array(base.length), t: NaN, ver: -1 }; patterned.set(key, slot); }
  if (slot.t === tHours && slot.ver === version) return slot.buf;
  const out = slot.buf;
  if (!delta) out.set(base);
  else if (!src.resample) for (let k = 0; k < out.length; k++) out[k] = base[k] + w * delta[k];
  else {
    const dom = manifest.domains[domain], sd = manifest.domains[src.from];
    for (let j = 0, k = 0; j < dom.ny; j++) for (let i = 0; i < dom.nx; i++, k++) {
      const [lo, la] = nodeLonLat(dom, i, j), g = toGrid(sd, lo, la);
      out[k] = g ? base[k] + w * bilinear(delta, sd, g[0], g[1], NaN) : NaN;
    }
  }
  slot.t = tHours; slot.ver = version;
  return out;
}

/**
 * The field at forecast hour t on a domain: a Float32Array (ny*nx, NaN = no data). z500 and z500a are the pattern
 * (patternField, so the map moves to the ensemble mean after day 7); every other field blends its own two adjacent steps.
 * The array is reused: it stays valid until the next call for the same field and domain.
 */
export function fieldAt(fieldId, domain, tHours) {
  return isPatternKind(fieldId) ? patternField(fieldId, domain, tHours) : rawFieldAt(fieldId, domain, tHours);
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

/** Linear value of a series {steps, values} at hour t (NaN outside it or across a gap longer than the blend gap). */
function seriesAt(S, t) {
  const b = S && bracket(S.steps, t);
  if (!b) return NaN;
  const a = S.values[b.i0], c = S.values[b.i1];
  return b.w === 0 ? a : a + (c - a) * b.w;
}

/**
 * sampleSeries for the pattern ('z500' | 'z500a') with the same weights as patternField, so a story built from the series
 * describes the map: each step's value moves from the single run to the ensemble mean between 168 h and 240 h; without a
 * mean it is the single run. Null when the kind is not a pattern field or the place is outside every domain.
 */
export function patternSeries(kind, lat, lon) {
  if (!isPatternKind(kind)) return null;
  const own = sampleSeries(kind, lat, lon);
  if (!own || !hasMean({ lat, lon })) return own;
  const z = kind === 'z500' ? own : sampleSeries('z500', lat, lon), em = sampleSeries(MEAN_FIELD, lat, lon);
  const values = Float32Array.from(own.values);
  own.steps.forEach((t, i) => {
    const w = weightAt(t, { lat, lon });
    if (w === 0) return;
    values[i] = own.values[i] + w * (seriesAt(em, t) - seriesAt(z, t)); // NaN when the mean is not there yet
  });
  return { steps: own.steps, values };
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
 * Real-world time of the origin (forecast hour 0) of a sample dataset, from the first dated field's source.valid: the
 * named case's fields for a multi-case manifest (default the active case), the whole manifest otherwise (a recorded
 * forecast has no cases; a case id from an old link is ignored). A recorded forecast without dates is its run.
 * Null for live data (its origin is the run, which validTime reads) and for an undated multi-case sample.
 */
export function caseOrigin(caseId) {
  if (!manifest || isLive(manifest)) return null;
  const multi = isMultiCase(manifest);
  const names = multi ? manifest.cases[caseId ?? activeCase()]?.fields || [] : Object.keys(manifest.fields || {});
  for (const f of names) {
    const meta = fieldMeta(f), v = meta?.source?.valid?.[0];
    if (v) return new Date(parseUTC(v) - (meta.steps?.[0] ?? 0) * MS_H);
  }
  const run = manifest.run ? parseUTC(manifest.run) : NaN;
  return !multi && run === run ? new Date(run) : null;
}

/** The case the map shows: the one that holds the active lens' field in a multi-case manifest, else null. */
export function activeCase() {
  return caseForLens(manifest, choice(store.get(), 'lens'));
}

/** Fields the manifest says this run lacks, [{field, reason}], so each consumer can degrade in words. */
export function missing() {
  return (manifest?.missing || []).filter((x) => x && x.field).map((x) => ({ field: x.field, reason: x.reason || '' }));
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
