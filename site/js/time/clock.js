// Animation clock (PLAN: js/time). The clock is a float in forecast hours and drives store.t. One rAF loop,
// running only while playing or tweening and the page is visible. store.playing is the single source of truth:
// play()/pause() write it, and the loop follows it, so any module may set it directly.
import { store, bus } from '../state.js';
import * as data from '../data/index.js';
import { FIELD_IDS, VIEWS, LAYER_CODES } from '../contract.js';
import { advance, clamp, easeInOutCubic, nextStep, spanOf, unionSteps } from './model.js';

const env = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  raf: (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(() => fn(env.now()), 16)),
  caf: (id) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id)),
  hidden: () => typeof document !== 'undefined' && document.hidden === true,
  reduced: () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  src: { fieldSteps: (f) => data.fieldSteps(f), caseOf: (f) => data.caseOf(f), ensure: (f, d, t) => data.ensure(f, d, t) },
};
/** Test hook: replace the scheduler, clock, motion preference or data source ({fieldSteps, caseOf, ensure}). */
export function configure(patch) { Object.assign(env, patch); }

const SHORT_SPAN_H = 60; // a case this short (sample case A, 36 h) plays at 3 h/s
let cache = null; // {key, steps, lo, hi}
let rafId = 0, last = 0, lastPrefetch = 0;
let tween = null; // {from, to, start, ms, resolve}
let speedChosen = false;
const frameHooks = new Set();

function caseFields() {
  const c = store.get().case;
  const inCase = FIELD_IDS.filter((f) => { try { return env.src.caseOf(f)?.id === c; } catch { return false; } });
  return inCase.length ? inCase : ['z500a', 'z500'];
}
function compute() {
  const arrays = caseFields().map((f) => { try { return env.src.fieldSteps(f) || []; } catch { return []; } });
  const sp = spanOf(arrays) || [0, 0];
  return { key: store.get().case, steps: unionSteps(arrays), lo: sp[0], hi: sp[1] };
}
function info() { return cache || (cache = compute()); }

/** Recompute the active range (call after the manifest or the case changes). Clamps t, picks the case's default speed. */
export function refresh() {
  cache = compute();
  const { lo, hi } = cache;
  const s = store.get();
  if (!speedChosen) {
    const want = hi - lo <= SHORT_SPAN_H ? 3 : 12;
    if (s.speed !== want) store.set({ speed: want });
  }
  if (hi > lo && (s.t < lo || s.t > hi)) store.set({ t: clamp(s.t, lo, hi) });
}

/** The active case's loop range [lo, hi] in forecast hours. */
export function range() { const { lo, hi } = info(); return [lo, hi]; }
/** Sorted data steps of the active case. */
export function steps() { return info().steps.slice(); }
/** Speed choices for the active range (forecast hours per second). */
export function speeds() { const [lo, hi] = range(); return hi - lo <= SHORT_SPAN_H ? [1.5, 3, 6] : [6, 12, 24]; }
export function reducedMotion() { return env.reduced(); }
export function isRunning() { return rafId !== 0; }
/** Register fn(intervalMs, workMs) called once per loop frame (debug readout). Returns remove. */
export function onFrame(fn) { frameHooks.add(fn); return () => frameHooks.delete(fn); }

function wanted() { return store.get().playing || tween !== null; }
function ensureLoop(fromTick = false) {
  if (rafId || !wanted() || env.hidden()) return;
  // Called from tick(), `last` is already the frame timestamp; resetting it to now() would make the next interval
  // (rAF timestamp minus now) negative or short, and the clock would stall.
  if (!fromTick) last = env.now();
  rafId = env.raf(tick);
}
function stopLoop() { if (rafId) { env.caf(rafId); rafId = 0; } }

function prefetch(t) {
  const s = store.get();
  const domain = VIEWS[s.view] || 'np05';
  const fields = new Set(['z500a', 'z500']);
  for (const [code, on] of Object.entries(s.layers)) if (on && LAYER_CODES[code]) fields.add(LAYER_CODES[code]);
  const { hi } = info();
  for (const f of fields) {
    try { Promise.resolve(env.src.ensure(f, domain, Math.min(hi, t + 36))).catch(() => {}); } catch { /* no data module yet */ }
  }
}

function tick(ts) {
  rafId = 0;
  if (!wanted()) return;
  const started = env.now();
  const interval = ts - last;
  const { lo, hi } = info();
  let t = store.get().t;
  if (tween) {
    const k = clamp((ts - tween.start) / tween.ms, 0, 1);
    t = tween.from + (tween.to - tween.from) * easeInOutCubic(k);
    if (k >= 1) { t = tween.to; const done = tween; tween = null; store.set({ t }); done.resolve(true); }
    else store.set({ t });
  } else {
    t = advance(t, Math.max(0, Math.min(100, interval)), store.get().speed, lo, hi); // a stalled tab never leaps
    store.set({ t });
  }
  if (ts - lastPrefetch > 500) { lastPrefetch = ts; prefetch(t); }
  last = ts;
  const work = env.now() - started;
  for (const h of frameHooks) h(interval, work);
  ensureLoop(true);
}

export function play() { store.set({ playing: true }); }
export function pause() { store.set({ playing: false }); }
export function toggle() { store.set({ playing: !store.get().playing }); }

/** Jump to t (clamped to the range), cancelling any tween. Does not change play state. */
export function seek(t) {
  cancelTween(false);
  const { lo, hi } = info();
  store.set({ t: clamp(t, lo, hi) });
  prefetch(store.get().t);
}
function cancelTween(value) {
  if (tween) { const d = tween; tween = null; d.resolve(value); }
}

/** Ease to t over `ms` (default 500). Pauses playback first (a deliberate jump is a touch). Resolves true on arrival, false if interrupted. */
export function tweenTo(t, ms = 500) {
  const { lo, hi } = info();
  const to = clamp(t, lo, hi);
  cancelTween(false);
  if (store.get().playing) store.set({ playing: false });
  if (ms <= 0 || env.reduced() || Math.abs(to - store.get().t) < 1e-6) { store.set({ t: to }); prefetch(to); return Promise.resolve(true); }
  prefetch(to);
  return new Promise((resolve) => {
    tween = { from: store.get().t, to, start: env.now(), ms, resolve };
    ensureLoop();
  });
}

/** Move one data step (dir +1 or -1); clamps at the ends. Pauses playback. Resolves when settled. */
export function step(dir) {
  const { steps: st } = info();
  const to = nextStep(st, store.get().t, dir);
  return tweenTo(to, 180);
}

export function setSpeed(h) { speedChosen = true; store.set({ speed: h }); }

/** The opening loop (SPEC section 2): play now, pause on first touch; stays paused under reduced motion. */
export function openingPlay() {
  if (env.reduced()) return false;
  play();
  if (typeof document !== 'undefined') {
    const once = () => { document.removeEventListener('pointerdown', once, true); document.removeEventListener('keydown', once, true); pause(); };
    document.addEventListener('pointerdown', once, true);
    document.addEventListener('keydown', once, true);
  }
  return true;
}

// Wiring
store.subscribe((s, patch) => {
  if ('playing' in patch) { if (s.playing) { cancelTween(false); ensureLoop(); } else if (!tween) stopLoop(); }
  if ('case' in patch) refresh();
});
bus.on('data:manifest', () => refresh());
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopLoop(); else ensureLoop(); });
}
