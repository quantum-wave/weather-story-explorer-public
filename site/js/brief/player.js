// The Briefing's player (C1-02): plays a Script (brief/contract.js) beat by beat by driving the app's own store, clock and
// renderer through their existing methods plus renderer.setTransform, and puts everything back on exit. No DOM, no CSS, no timers:
// one raf loop that measures its own elapsed time, so a loaded machine slows the film down instead of skipping it.
//   createPlayer({ app, script, raf, caf, now, reduced, rate, storage }) ->
//   { state(), index(), beat(), progress(), start(), pause(), resume(), next(), prev(), goTo(i), exit({ stay }), on(name, fn) }
//   states: idle | playing | paused | holding | ended; events: 'beat' {index, beat}, 'tick' {index, t, progress},
//   'state' {state}, 'exit' {stay, finished}. `reduced` is a boolean or a function; `rate` divides every beat's ms.
import { BRIEF_KEY } from './contract.js';

/** A beat whose data has not arrived after this long is skipped. */
export const HOLD_SKIP_MS = 8000;
/** The camera glide into a beat. */
export const CAMERA_MS = 600;
/** A frame gap longer than this (a hidden tab, a stalled machine) counts as this much film time. */
const MAX_DT_MS = 250;
/** The longest the forecast waits for a camera glide to report back. */
const CAMERA_WAIT_MAX_MS = 2000;
const DAY_H = 24;
/** Range (days) a beat past the run's loop range switches to. */
const FULL_RANGE = 15;

/** The forecast hours a beat shows: t0, t1 and every 24 h between them, in order. */
export function hoursOf(b) {
  const lo = Math.min(b.t0, b.t1), hi = Math.max(b.t0, b.t1), out = [b.t0, b.t1];
  for (let t = lo + DAY_H; t < hi; t += DAY_H) out.push(t);
  return [...new Set(out)];
}

export function createPlayer({ app, script, raf, caf, now, reduced, rate = 1, storage } = {}) {
  const { store, clock, renderer, story } = app;
  const beats = script.beats;
  const requestFrame = raf || ((fn) => requestAnimationFrame(fn));
  const cancelFrame = caf || ((id) => cancelAnimationFrame(id));
  const clockNow = now || (() => performance.now());
  const isReduced = () => (typeof reduced === 'function' ? !!reduced() : reduced !== undefined ? !!reduced : !!clock.reducedMotion?.());
  const speedUp = rate > 0 ? rate : 1;

  const listeners = new Map();
  let saved = null;            // what the app looked like before start(); null = idle
  let unsub = null;
  let idx = -1, token = 0;
  let phase = 'loading';       // loading: the beat's data is not here yet; running: it plays
  let paused = false, ended = false, finished = false;
  let holdMs = 0, elapsedMs = 0, last = null, rafId = 0;
  let rangeTouched = false;
  // The camera is still gliding out to a lower zoom: store.t stays where the previous frame left it (an hour already on screen at
  // that tighter zoom; k only falls from there, so no frame pairs an hour with more zoom than it already had), no beat time counts,
  // and the beat's own t0 is sought only when the glide lands or the wait cap releases it.
  let camWait = false, camMs = 0;
  const loads = new Map();     // beat index -> promise of its data
  const loaded = new Set();    // beat indexes whose data has arrived
  let lastState = 'idle';

  const emit = (name, detail) => { for (const fn of [...(listeners.get(name) || [])]) fn(detail); };
  const duration = (b) => Math.max(1, (b.ms || 0) / speedUp);
  const state = () => (!saved ? 'idle' : ended ? 'ended' : paused ? 'paused' : phase === 'loading' ? 'holding' : 'playing');
  const sync = () => { const s = state(); if (s !== lastState) { lastState = s; emit('state', { state: s }); } };

  function stopFrames() { if (rafId) { cancelFrame(rafId); rafId = 0; } }
  function schedule() { if (!rafId && saved && !ended && !paused) rafId = requestFrame(tick); }

  function load(i) {
    if (loads.has(i)) return loads.get(i);
    const b = beats[i];
    const jobs = hoursOf(b).map((t) => renderer.ensureFor({ view: b.view, lens: b.lens, t }));
    if (b.place) jobs.push(story.ensureStoryData(b.place.lat, b.place.lon));
    const p = Promise.all(jobs.map((j) => Promise.resolve(j))).then(() => { loaded.add(i); });
    loads.set(i, p);
    p.catch(() => { loads.delete(i); }); // a failed load can be tried again; the hold timer skips the beat meanwhile
    return p;
  }

  function enter(i) {
    token++; camWait = false; idx = i; ended = false; phase = 'loading'; holdMs = 0; elapsedMs = 0;
    if (isReduced()) paused = false;
    const mine = token;
    emit('beat', { index: i, beat: beats[i] });
    if (loaded.has(i)) setup(mine);
    else load(i).then(() => { if (token === mine && saved) setup(mine); }, () => {});
    sync(); schedule();
  }

  /** The beat's data is here: set what it shows, move the camera, put the clock at the start (or, reduced, the end). */
  function setup(mine) {
    if (mine !== token) return;
    const b = beats[idx], cut = isReduced();
    phase = 'running';
    const patch = { view: b.view, lens: b.lens };
    if (store.get().overlays?.doubt !== true) patch.overlays = { doubt: true };
    store.set(patch); // the lens first: the loop range depends on it
    // The beat's own need: the range the viewer recorded, judged with this beat's lens, not whatever range an earlier beat left.
    if (rangeTouched) { store.set({ range: saved.range }); rangeTouched = false; }
    if (Math.max(b.t0, b.t1) > clock.range()[1]) { store.set({ range: FULL_RANGE }); rangeTouched = true; }
    const ms = cut ? 0 : CAMERA_MS;
    // A glide that lowers the zoom keeps a zoom tighter than this beat allows for a while. Showing this beat's t0 then would pair
    // a later (or no-signal) hour with the previous beat's zoom, so the forecast stays on the hour already on screen and moves to
    // t0 only when the glide lands (releaseCamera).
    const k = renderer.getTransform()?.k, target = b.camera ? b.camera.zoom : 1;
    const holdForCamera = !cut && Number.isFinite(k) && Number.isFinite(target) && k > target + 1e-6;
    const glide = Promise.resolve(b.camera ? renderer.centreOn(b.camera.lat, b.camera.lon, ms, b.camera.zoom) : renderer.resetView(ms));
    camWait = holdForCamera; camMs = 0;
    const mine2 = token;
    glide.catch(() => {}).then(() => { if (token === mine2 && camWait) releaseCamera(); });
    if (!holdForCamera) clock.seek(cut ? b.t1 : b.t0);
    if (cut) { paused = true; elapsedMs = duration(b); emit('tick', { index: idx, t: b.t1, progress: 1 }); }
    last = null;
    if (idx + 1 < beats.length) load(idx + 1).catch(() => {}); // the next beat's chunks arrive while this one plays
    if (paused) stopFrames();
    sync(); schedule();
  }

  /** The glide has landed: now the beat's own first hour goes on screen and its time starts. When the wait cap gives up on a glide
   *  that never reported back (`cut`), the camera is cut to the beat's zoom first, so t0 is never drawn at a tighter zoom. */
  function releaseCamera(cut = false) {
    const b = beats[idx];
    camWait = false; last = null;
    if (cut) Promise.resolve(b.camera ? renderer.centreOn(b.camera.lat, b.camera.lon, 0, b.camera.zoom) : renderer.resetView(0)).catch(() => {});
    clock.seek(b.t0);
  }

  function advance() { if (idx + 1 < beats.length) enter(idx + 1); else finish(); }

  function tick() {
    rafId = 0;
    if (!saved || ended || paused) return;
    const n = clockNow(), dt = last === null ? 0 : Math.max(0, Math.min(MAX_DT_MS, n - last));
    last = n;
    if (phase === 'loading') {
      holdMs += dt;
      if (holdMs >= HOLD_SKIP_MS) { advance(); return; }
    } else if (camWait) {
      camMs += dt;
      if (camMs >= CAMERA_WAIT_MAX_MS) releaseCamera(true); // a glide that never reports back must not stall the film
    } else {
      const b = beats[idx];
      elapsedMs += dt;
      const p = Math.min(1, elapsedMs / duration(b)), t = b.t0 + (b.t1 - b.t0) * p;
      if (b.t0 !== b.t1) clock.seek(t);
      emit('tick', { index: idx, t, progress: p });
      if (p >= 1) { advance(); return; }
    }
    schedule();
  }

  function finish() {
    ended = true; paused = false; finished = true; stopFrames();
    try {
      const s = storage ?? globalThis.localStorage;
      let prev = null; try { prev = JSON.parse(s.getItem(BRIEF_KEY)); } catch { /* a missing or damaged record counts as none */ }
      const plays = (Number.isFinite(prev?.plays) ? prev.plays : 0) + 1;
      s.setItem(BRIEF_KEY, JSON.stringify({ run: script.run, finishedAt: new Date(app.now ? app.now() : Date.now()).toISOString(), plays }));
    } catch { /* storage may be blocked */ }
    sync();
  }

  function start() {
    if (saved) return;
    const s = store.get();
    saved = {
      view: s.view, lens: s.lens, t: s.t, playing: s.playing, speed: s.speed, focus: s.focus, expanded: s.expanded,
      overlays: s.overlays, range: s.range, sheet: s.sheet, transform: renderer.getTransform(),
    };
    finished = false; paused = false; ended = false; rangeTouched = false;
    clock.pause();
    store.set({ expanded: true, overlays: { doubt: true } });
    unsub = store.subscribe((_s, patch) => {
      if (patch?.playing === true) pause();
      if (patch && 'expanded' in patch && patch.expanded === false) exit({ stay: true });
    });
    enter(0);
  }

  function pause() { if (!saved || ended || paused) return; paused = true; stopFrames(); sync(); }
  function resume() {
    if (!saved || ended || !paused) return;
    if (isReduced()) { next(); return; }
    paused = false; last = null;
    if (store.get().playing) clock.pause();
    sync(); schedule();
  }
  function next() { if (!saved || ended) return; if (idx + 1 < beats.length) enter(idx + 1); else finish(); }
  function prev() { if (!saved) return; enter(ended ? beats.length - 1 : Math.max(0, idx - 1)); }
  function goTo(i) { if (!saved || !Number.isInteger(i)) return; enter(Math.max(0, Math.min(beats.length - 1, i))); }

  function exit({ stay = false } = {}) {
    if (!saved) return;
    const r = saved;
    token++; stopFrames(); unsub?.(); unsub = null;
    loads.clear(); loaded.clear();
    saved = null; paused = false; ended = false; idx = -1; phase = 'loading';
    const patch = { expanded: r.expanded, overlays: r.overlays, range: r.range, sheet: r.sheet };
    if (stay) store.set(patch);
    else {
      store.set({ ...patch, view: r.view, lens: r.lens, focus: r.focus, speed: r.speed });
      clock.seek(r.t);
      store.set({ playing: r.playing }); // put back what was recorded, false included: an outside play during the briefing does not stick
      renderer.setTransform(r.transform, 0);
    }
    sync();
    emit('exit', { stay, finished });
  }

  return {
    state, index: () => idx, beat: () => (idx >= 0 ? beats[idx] : null),
    progress: () => (!saved || phase === 'loading' ? 0 : Math.min(1, elapsedMs / duration(beats[idx]))),
    start, pause, resume, next, prev, goTo, exit,
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name).delete(fn); },
  };
}
