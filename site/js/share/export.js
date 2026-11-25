// exportStill and exportLoop (SPEC section 7).
import { store } from '../state.js';
import * as data from '../data/index.js';
import { VIEWS, LAYER_CODES, LENS_CODES, LENS_FILL } from '../contract.js';
import { LENS_FIELDS } from '../render/palette.js';
import { gifenc } from '../vendor.js';
import { shareMeta, primeManifest, activeField, validDateFor } from './meta.js';
import { gifStamp } from './format.js';
import { getRenderer } from './facade.js';
import { STILL, drawStill, drawGifFrame, PALETTE } from './frame.js';

export const GIF_FPS = 12;
export const GIF_MAX_FRAMES = 96;
export const GIF_SIZES = [720, 540];
export const GIF_BYTE_LIMIT = 8 * 1024 * 1024;
const HOLD_MS = 1000, END_MS = 700;

const nextFrame = () => new Promise((res) => {
  let done = false; const fin = () => { if (!done) { done = true; res(); } };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fin);
  setTimeout(fin, 60); // hidden tabs do not run animation frames
});
const abortError = () => Object.assign(new Error('Cancelled'), { name: 'AbortError', code: 'aborted' });

/** Make sure the chunks that time t needs for this view are loaded: the lens's fill and lines. */
async function ensureFor(state, t) {
  const domain = VIEWS[state.view];
  const fields = new Set();
  const lens = LENS_CODES.includes(state.lens) ? state.lens : 'z';
  fields.add(LENS_FILL[lens]); if (LENS_FIELDS[lens]?.lines) fields.add(LENS_FIELDS[lens].lines);
  for (const f of fields) await data.ensure(f, domain, t);
  // the renderer knows best which chunks renderTo needs (spread, contour source, case)
  try { await getRenderer().ensureFor?.({ t, view: state.view, lens }); } catch { /* renderTo draws what is loaded */ }
}

export async function exportStill({ headline } = {}) {
  await primeManifest();
  const state = store.get();
  const meta = shareMeta(state);
  if (typeof headline === 'string' && headline.trim()) meta.headline = headline.trim().slice(0, 140);
  await ensureFor(state, state.t);
  const canvas = Object.assign(document.createElement('canvas'), { width: STILL.width, height: STILL.height });
  const ctx = canvas.getContext('2d');
  drawStill(ctx, meta, state, getRenderer());
  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'));
  if (globalThis.__wse) globalThis.__wse.lastShareMeta = meta;
  return blob;
}

/** Default loop range: the run's start to one day after the focused day, at most 7 days, inside the layer's steps. */
export function defaultRange(state, field) {
  const steps = data.fieldSteps(field) || [0];
  const min = steps[0], max = steps[steps.length - 1];
  const from = min;
  const to = Math.min((Math.floor(state.t / 24) + 2) * 24, from + 168, max);
  return { from, to: Math.max(to, from) };
}

/** Frame times for a range: about speed/fps hours per frame, at most GIF_MAX_FRAMES frames, at least 2. */
export function frameTimes(from, to, speed) {
  const span = Math.max(0, to - from);
  let n = Math.round(span / Math.max(0.05, (speed || 12) / GIF_FPS)) + 1;
  n = Math.max(2, Math.min(GIF_MAX_FRAMES, n));
  return Array.from({ length: n }, (_, i) => from + (span * i) / (n - 1));
}

function paletteFor(frames) {
  const total = frames.reduce((a, f) => a + f.length, 0);
  const all = new Uint8Array(total);
  let o = 0; for (const f of frames) { all.set(f, o); o += f.length; }
  const pal = gifenc.quantize(all, 128, { format: 'rgb565' });
  const ui = [PALETTE.dark, PALETTE.light].flatMap((p) => [p.bg, p.sheet, p.hair, p.text, p.sub, p.sample, p.sampleInk]);
  for (const hex of ui) {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    if (!pal.some((q) => q[0] === c[0] && q[1] === c[1] && q[2] === c[2])) pal.push(c);
  }
  return pal.slice(0, 256);
}

async function encodeAt(size, { times, holdIndex, state, meta, field, signal, onProgress, probeOnly }) {
  const renderer = getRenderer();
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const from = times[0], to = times[times.length - 1], span = to - from || 1;
  const mark = holdIndex == null ? null : (times[holdIndex] - from) / span;
  const draw = async (i) => {
    const t = times[i];
    await ensureFor(state, t);
    // the stamp the screen shows while playing (nearest hour), plus the UTC hour a viewer elsewhere needs: 'Tue 17 Nov' over '11 pm PST (07Z)'
    const stamp = gifStamp(validDateFor(t, state, field), { year: !!state.sample });
    drawGifFrame(ctx, size, meta, state, renderer, { t, stamp, frac: (t - from) / span, mark });
    return ctx.getImageData(0, 0, size, size);
  };
  // palette from three sample frames
  const picks = [0, Math.floor((times.length - 1) / 2), times.length - 1];
  const samples = [];
  for (const i of new Set(picks)) samples.push(new Uint8Array((await draw(i)).data.buffer.slice(0)));
  const palette = paletteFor(samples);
  const enc = gifenc.GIFEncoder();
  const limit = probeOnly ? Math.min(10, times.length) : times.length;
  for (let i = 0; i < limit; i++) {
    if (signal?.aborted) throw abortError();
    await nextFrame();
    const img = await draw(i);
    const index = gifenc.applyPalette(img.data, palette, 'rgb565');
    let delay = Math.round(1000 / GIF_FPS);
    if (i === holdIndex) delay = HOLD_MS;
    if (i === times.length - 1) delay = Math.max(delay, 0) + END_MS;
    enc.writeFrame(index, size, size, { palette: i === 0 ? palette : undefined, delay, repeat: 0 });
    onProgress?.((i + 1) / times.length);
  }
  if (probeOnly) return { bytes: enc.bytesView().length, frames: limit };
  enc.finish();
  return { bytes: enc.bytes(), frames: times.length };
}

/** exportLoop({from, to, onProgress(0..1), signal}) -> GIF Blob. Rejects with name 'AbortError' on cancel. */
export async function exportLoop({ from, to, onProgress, signal, byteLimit = GIF_BYTE_LIMIT } = {}) {
  await primeManifest();
  const state = store.get();
  const field = activeField(state);
  const def = defaultRange(state, field);
  from = Number.isFinite(from) ? from : def.from;
  to = Number.isFinite(to) ? to : def.to;
  if (to - from > 168) to = from + 168;
  const meta = shareMeta(state);
  const times = frameTimes(from, to, state.speed);
  let holdIndex = 0;
  for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - state.t) < Math.abs(times[holdIndex] - state.t)) holdIndex = i;
  if (state.t < from || state.t > to) holdIndex = null;
  const args = { times, holdIndex, state, meta, field, signal, onProgress };
  let size = GIF_SIZES[0];
  const probe = await encodeAt(size, { ...args, onProgress: null, probeOnly: true });
  if ((probe.bytes / probe.frames) * times.length > byteLimit) size = GIF_SIZES[1];
  const out = await encodeAt(size, args);
  onProgress?.(1);
  const blob = new Blob([out.bytes], { type: 'image/gif' });
  if (globalThis.__wse) globalThis.__wse.lastShareMeta = { ...meta, gifFrames: out.frames, gifSize: size };
  return blob;
}
