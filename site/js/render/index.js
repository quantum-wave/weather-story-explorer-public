// Map renderer: one canvas, three projections (Regional conic, Hemisphere stereographic, Globe orthographic), the anomaly
// raster, contours, jet, basemap, legend, overlays, and the gestures that move them. Draws only when something changed (no
// idle animation frames). See compose.js for the frame pipeline; globe.js and versor.js for the rotation maths.
import { store, bus } from '../state.js';
import * as data from '../data/index.js';
import { toGrid, bilinear } from '../data/grid.js';
import { makeScene, needed, plan, domainFor } from './compose.js';
import { IDENTITY, clampXf, sameXf, isDefaultXf, domainBox, dampOver, ZOOM_MAX, padKey } from './view.js';
import { dragRotate, inertia } from './globe.js';
import { loadBasemap } from './basemap.js';
import { theme as themeTokens } from './theme.js';
import { VIEWS } from '../contract.js';

const FADE_MS = 300;
const MAX_DPR = 2; // 3x phones draw at 2x: a third of the pixels, hairlines stay crisp
const REST_MS = 150; // rest quality returns this long after the last input
const SPRING_MS = 220; // a drag past a pan limit springs back in this long
const TAP_PX = 6, TAP_MS = 600, DOUBLE_TAP_MS = 320, DOUBLE_TAP_PX = 30;
const KEY_DEG = 5; // arrows rotate or pan by this many degrees
const ease = (u) => 1 - (1 - u) ** 3;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const REDRAW_KEYS = ['t', 'layers', 'view', 'theme', 'case', 'lens', 'overlays', 'ground', 'range'];
const ROTATES = (v) => v === 'nh' || v === 'gl';
const wrap180 = (d) => ((d + 540) % 360) - 180;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const rot3 = (r) => [r?.[0] || 0, r?.[1] || 0, r?.[2] || 0];
const copyXf = (x) => ({ k: x.k, tx: x.tx, ty: x.ty, rot: rot3(x.rot) });
const sameRot = (a, b) => a.rot[0] === b.rot[0] && a.rot[1] === b.rot[1] && (a.rot[2] || 0) === (b.rot[2] || 0);
/** The part of the store that changes what a frame shows, as one string (both frame-cache keys use it). */
const looks = (s) => `${s.view}|${s.theme}|${s.lens}|${s.ground}|${s.range}|${JSON.stringify(s.overlays)}`;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const scene = makeScene();
  const frame = typeof document !== 'undefined' ? document.createElement('canvas') : canvas;
  const frameCtx = frame.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  let xf = IDENTITY(); // committed pan/zoom/rotation
  let live = null; // gesture or animation in flight
  let frameXf = null, frameKey = '', lastKey = '', gen = 0;
  let pad = { top: 0, right: 0, bottom: 0, left: 0 };
  const overlays = [];
  let raf = 0, anim = 0, lastView = store.get().view, destroyed = false, restTimer = 0, coast = null;
  let firstFieldAt = 0, ensureKey = '', warmKey = '';
  const counters = { frames: 0, composes: 0, frameMs: 0, quality: 'rest', lastInputAt: 0, restStartedAt: 0 };
  let resetBtn = null, resetOwned = false, lastDefault = true;

  // ---------- sizing ----------
  function resize() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width || canvas.clientWidth || canvas.width)), h = Math.max(1, Math.round(r.height || canvas.clientHeight || canvas.height));
    const d = Math.min(MAX_DPR, Math.max(1, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1));
    if (w === W && h === H && d === dpr && canvas.width === Math.round(w * d) && canvas.height === Math.round(h * d)) return;
    W = w; H = h; dpr = d;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    frame.width = canvas.width; frame.height = canvas.height;
    frameXf = null; lastKey = '';
    xf = clampX(xf);
    scene.clearLayers();
    requestDraw();
    emitView();
  }

  // ---------- views and limits ----------
  const state = () => store.get();
  const viewNow = (x = live || xf) => scene.viewFor(state().view, W, H, x, pad);
  const rectSize = () => ({ cx: pad.left + (W - pad.left - pad.right) / 2, cy: pad.top + (H - pad.top - pad.bottom) / 2 });
  /** Regional pan may go until the data domain's edge reaches the frame's edge; the other views clamp to the canvas. */
  function boxFor(viewId, w = W, h = H) {
    if (viewId !== 'np') return null;
    const dom = data.getManifest()?.domains?.[VIEWS.np];
    return dom ? domainBox(scene.viewFor(viewId, w, h, IDENTITY(), pad).base, dom) : null;
  }
  const clampX = (x, viewId = state().view) => (W ? clampXf(x, W, H, boxFor(viewId)) : x);
  /** A drag past a limit moves the map by a damped amount, never more than a few px. */
  function softClamp(x) {
    const c = clampX(x);
    return { ...x, k: c.k, tx: c.tx + dampOver(x.tx - c.tx), ty: c.ty + dampOver(x.ty - c.ty) };
  }

  // ---------- drawing ----------
  function chrome(mv, s) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const proj = (ll) => mv.project(ll);
    const x = live || xf;
    const info = { ...s, width: W, height: H, dpr, k: x.k, rot: x.rot };
    for (const fn of overlays.slice()) { try { fn(ctx, proj, info); } catch (e) { console.error('overlay failed', e); } }
  }

  const fadeQ = () => (!firstFieldAt || reducedMotion() ? 32 : Math.round(Math.min(1, (performance.now() - firstFieldAt) / FADE_MS) * 32));
  function composeFrame(s, x, q) {
    const mv = scene.viewFor(s.view, W, H, x, pad);
    frameCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mv.quality = 'rest';
    const { drewField } = scene.compose(frameCtx, mv, { s, dpr, rasterScale: dpr >= 2 ? 0.5 : 0.8, alpha: ease(q / 32), quality: 'rest' });
    counters.composes++; counters.quality = 'rest';
    if (drewField && !firstFieldAt && !reducedMotion()) { firstFieldAt = performance.now(); requestDraw(); }
    else if (drewField && q < 32) requestDraw();
    frameXf = copyXf(x);
    frameKey = looks(s);
    return mv;
  }

  /** Full-quality draw of the committed view, synchronously. */
  function draw() {
    if (destroyed) return;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!W) resize();
    const t0 = now(), s = state();
    if (s.view !== lastView) { lastView = s.view; xf = IDENTITY(); live = null; frameXf = null; }
    const q = fadeQ(), key = [s.t, JSON.stringify(s.layers), s.case, looks(s), data.dataVersion(), W, H, dpr, xf.k, xf.tx, xf.ty, xf.rot[0], xf.rot[1], xf.rot[2], gen, q].join('|');
    // callers may ask for a draw twice for one change: compose once, blit and draw overlays each time
    const mv = frameXf && key === lastKey ? scene.viewFor(s.view, W, H, xf, pad) : composeFrame(s, xf, q);
    lastKey = key;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(frame, 0, 0);
    chrome(mv, s);
    prefetch(s);
    counters.frames++; counters.frameMs = now() - t0;
  }

  /**
   * Draw while a gesture or animation moves. Pan and zoom transform the last composed frame (a similarity) with the overlays
   * live. A rotating globe or hemisphere cannot be transformed: it redraws every frame at rotate quality (coarse raster, 110 m
   * coast, 16 px lookup mesh into preallocated buffers); rest quality follows REST_MS after the last input.
   */
  function drawLive() {
    const t0 = now(), s = state(), x = live;
    if (ROTATES(s.view) && !sameRot(x, frameXf || xf)) {
      const mv = scene.viewFor(s.view, W, H, x, pad);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      mv.quality = 'rotate';
      try { scene.compose(ctx, mv, { s, dpr, rasterScale: 0.25, low: true, quality: 'rotate' }); } finally { mv.quality = 'rest'; }
      counters.composes++; counters.quality = 'rotate';
      chrome(mv, s);
      counters.frames++; counters.frameMs = now() - t0;
      emitView();
      return;
    }
    if (!frameXf || frameKey !== looks(s)) { draw(); if (!live) return; }
    const r = x.k / frameXf.k, th = themeTokens(s.theme);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = th.ocean; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(r, 0, 0, r, dpr * (x.tx - r * frameXf.tx), dpr * (x.ty - r * frameXf.ty));
    ctx.drawImage(frame, 0, 0);
    chrome(scene.viewFor(s.view, W, H, x, pad), s);
    counters.frames++; counters.frameMs = now() - t0;
    emitView();
  }

  function requestDraw() {
    if (raf || destroyed) return;
    raf = requestAnimationFrame(() => { raf = 0; if (live) drawLive(); else draw(); });
  }

  // ---------- view change event and the Reset view button ----------
  let emitted = '';
  function emitView() {
    if (destroyed || !W) return;
    const x = live || xf, def = isDefaultXf(x);
    const key = [state().view, x.k.toFixed(4), x.tx.toFixed(1), x.ty.toFixed(1), x.rot[0].toFixed(2), x.rot[1].toFixed(2), x.rot[2].toFixed(2)].join('|');
    if (key === emitted) return;
    emitted = key;
    const mid = viewNow(x).invert([W / 2, H / 2]);
    bus.emit('map:viewchange', { view: state().view, k: x.k, tx: x.tx, ty: x.ty, rot: x.rot.slice(), centre: mid ? { lon: mid[0], lat: mid[1] } : null, isDefault: def });
    syncReset(def);
  }
  function syncReset(def) {
    if (typeof document === 'undefined') return;
    if (!resetBtn) {
      if (def) return;
      resetBtn = document.getElementById('btn-reset');
      if (!resetBtn) { // the shell has none yet: make a visible one
        resetBtn = document.createElement('button');
        resetBtn.type = 'button'; resetBtn.id = 'btn-reset'; resetBtn.className = 'btn'; resetBtn.textContent = 'Reset view';
        resetBtn.style.cssText = 'position:absolute;right:12px;top:64px;z-index:6;min-width:44px;min-height:44px;padding:0 14px;cursor:pointer;font:600 13px/1 system-ui,sans-serif;border-radius:10px;border:1px solid currentColor;background:rgba(20,24,30,.82);color:#f4f6f8;pointer-events:auto';
        (canvas.parentElement || document.body).appendChild(resetBtn);
        resetOwned = true;
      }
      resetBtn.addEventListener('click', onResetClick);
    }
    resetBtn.hidden = def; lastDefault = def;
  }
  const onResetClick = () => { api.resetView(); };

  // ---------- data ----------
  function prefetch(s) {
    const m = data.getManifest();
    if (!m) return;
    const key = [s.view, s.case, JSON.stringify(s.layers), s.lens, Math.floor(s.t / 6), m.run].join('|');
    if (key === ensureKey) return;
    ensureKey = key;
    const need = needed(s, m);
    for (const [f, d] of need) {
      for (const t of [s.t, s.t + 24]) data.ensure(f, d, t).catch((e) => console.warn('chunk load failed', f, d, e.message));
    }
    const wk = need.map((n) => n.join(':')).join(',') + '|' + m.run;
    if (wk !== warmKey) { // then the rest of the loop, quietly, one field at a time
      warmKey = wk;
      (async () => { for (const [f, d] of need) { try { await data.ensureAll(f, d); } catch (e) { console.warn('chunk load failed', f, d, e.message); } } })();
    }
  }

  // ---------- pan / zoom / rotate ----------
  function zoomAbout(x0, px, py, factor) {
    const k = Math.min(ZOOM_MAX, Math.max(1, x0.k * factor)), q = k / x0.k;
    return clampX({ ...x0, k, tx: px - (px - x0.tx) * q, ty: py - (py - x0.ty) * q });
  }
  function stopMotion() {
    cancelAnimationFrame(anim); anim = 0;
    if (coast) { const c = coast; coast = null; c.cancel(); }
    clearTimeout(restTimer); restTimer = 0;
  }
  function setLive(next) { live = next; requestDraw(); }
  /** Rest quality returns REST_MS after the last input. */
  function scheduleRest() {
    clearTimeout(restTimer);
    counters.lastInputAt = now();
    restTimer = setTimeout(() => { restTimer = 0; counters.restStartedAt = now(); commit(); }, REST_MS);
  }
  function commit() {
    if (!live) { draw(); return; }
    xf = clampX(live); live = null;
    draw();
    emitView();
  }
  function animateTo(target, ms) {
    stopMotion();
    target = clampX(target);
    if (!ms || reducedMotion() || !W) { live = null; xf = target; draw(); emitView(); return Promise.resolve(); }
    const from = live || xf, t0 = performance.now();
    return new Promise((resolve) => {
      const step = (tNow) => {
        const u = Math.min(1, (tNow - t0) / ms), e = ease(u);
        live = { k: from.k + (target.k - from.k) * e, tx: from.tx + (target.tx - from.tx) * e, ty: from.ty + (target.ty - from.ty) * e,
          rot: [0, 1, 2].map((i) => from.rot[i] + (target.rot[i] - from.rot[i]) * e) };
        if (u < 1) { drawLive(); anim = requestAnimationFrame(step); }
        else { anim = 0; live = target; commit(); resolve(); }
      };
      anim = requestAnimationFrame(step);
    });
  }
  function xfCentred(lat, lon, zoom, x0 = xf) {
    const s = state(), k = zoom ?? Math.max(x0.k, 1.5);
    let rot = x0.rot;
    if (s.view === 'gl') { // rotate the place to the middle of the globe first, then pan the middle to the middle of the free area
      const base = scene.viewFor('gl', W, H, IDENTITY(), pad).base.rotate;
      rot = [wrap180(-lon - base[0]), -lat - base[1], 0];
    }
    const mv0 = scene.viewFor(s.view, W, H, { k: 1, tx: 0, ty: 0, rot }, pad);
    const b = mv0.project([lon, lat]);
    if (!b) return x0;
    const { cx, cy } = rectSize();
    return clampX({ k, tx: cx - k * b[0], ty: cy - k * b[1], rot });
  }

  /**
   * Where a one-pointer drag from `from` to `to` takes the transform `b`. Globe: the point under `from` stays under `to` (versor
   * drag, any zoom). Hemisphere: the horizontal component spins about the pole; zoomed, the vertical component pans. Regional:
   * pan. `soft` damps what passes a pan limit (a live drag); inertia clamps hard.
   */
  function dragStep(b, from, to, soft) {
    const view = state().view;
    if (view === 'gl') {
      const mv = scene.viewFor('gl', W, H, b, pad); mv.apply();
      const r1 = dragRotate(mv.base.proj, from, to, mv.rotation()), r0 = mv.base.rotate;
      return { ...b, rot: [wrap180(r1[0] - r0[0]), r1[1] - r0[1], wrap180(r1[2] - (r0[2] || 0))] };
    }
    if (view === 'nh') {
      const c = scene.viewFor('nh', W, H, b, pad).project([0, 90]) || [W / 2, H / 2]; // the pole
      const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]);
      const a1 = Math.atan2((b.k > 1 ? from[1] : to[1]) - c[1], to[0] - c[0]);
      const da = wrap180(((a1 - a0) * 180) / Math.PI);
      const x = { ...b, rot: [b.rot[0] - da, b.rot[1], b.rot[2]] };
      if (b.k > 1) { x.ty = b.ty + to[1] - from[1]; return soft ? softClamp(x) : clampX(x); }
      return x;
    }
    const x = { ...b, tx: b.tx + to[0] - from[0], ty: b.ty + to[1] - from[1] };
    return soft ? softClamp(x) : clampX(x);
  }

  // pointer gestures
  const pointers = new Map();
  let gestureStart = null, wheelTimer = 0, tapInfo = null, lastTap = null, samples = [];
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const pinch = () => { const [a, b] = [...pointers.values()]; return { d: Math.hypot(a[0] - b[0], a[1] - b[1]), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; };
  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stopMotion();
    pointers.set(e.pointerId, local(e));
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    const base = live || xf;
    gestureStart = { xf: copyXf(base), p: pointers.size === 2 ? pinch() : null, at: local(e) };
    if (pointers.size === 1) { const at = local(e); tapInfo = { x: at[0], y: at[1], t: now(), moved: 0, multi: false }; samples = [{ t: now(), x: at[0], y: at[1] }]; }
    else if (tapInfo) tapInfo.multi = true;
    if (!frameXf) draw();
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, local(e));
    const g = gestureStart;
    if (!g) return;
    if (pointers.size >= 2) {
      if (!g.p) { gestureStart = { xf: copyXf(live || xf), p: pinch(), at: null }; return; }
      const nowP = pinch(), f = nowP.d / (g.p.d || 1);
      let nx = zoomAbout(g.xf, g.p.c[0], g.p.c[1], f);
      nx = clampX({ ...nx, tx: nx.tx + (nowP.c[0] - g.p.c[0]), ty: nx.ty + (nowP.c[1] - g.p.c[1]) });
      setLive(nx);
    } else {
      const [x, y] = local(e);
      if (!g.at) { gestureStart = { xf: copyXf(live || xf), p: null, at: [x, y] }; return; }
      if (tapInfo) { tapInfo.moved = Math.max(tapInfo.moved, Math.hypot(x - tapInfo.x, y - tapInfo.y)); samples.push({ t: now(), x, y }); if (samples.length > 12) samples.shift(); }
      if (tapInfo && !tapInfo.multi && tapInfo.moved < TAP_PX) return; // still a tap: do not nudge the map
      setLive(dragStep(g.xf, g.at, [x, y], true));
    }
  }
  /** Release velocity in px/s from the last ~100 ms of the drag, or zero if the finger had already stopped. */
  function releaseVelocity() {
    const t1 = now(), recent = samples.filter((p) => t1 - p.t <= 110);
    if (recent.length < 2 || t1 - recent[recent.length - 1].t > 80) return { x: 0, y: 0 };
    const a = recent[0], b = recent[recent.length - 1], dt = (b.t - a.t) / 1000;
    return dt > 0.008 ? { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt } : { x: 0, y: 0 };
  }
  function startCoast(v) {
    let cur = null;
    const x0 = live || xf, last = samples[samples.length - 1];
    cur = [last.x, last.y];
    coast = inertia({
      velocity: v, reducedMotion: reducedMotion(),
      onStep(dx, dy) {
        const to = [cur[0] + dx, cur[1] + dy];
        setLive(dragStep(live || x0, cur, to, false));
        cur = to;
      },
      onEnd() { coast = null; scheduleRest(); },
    });
  }
  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (pointers.size === 0) {
      gestureStart = null;
      const ti = tapInfo; tapInfo = null;
      if (e.type === 'pointerup' && ti && !ti.multi && ti.moved < TAP_PX && now() - ti.t < TAP_MS) { onTap(ti.x, ti.y); return; }
      const x = live || xf;
      if (!sameXf(x, clampX(x))) { animateTo(clampX(x), SPRING_MS); return; } // past a limit: spring back
      const v = e.type === 'pointerup' && ti && !ti.multi ? releaseVelocity() : { x: 0, y: 0 };
      if (Math.hypot(v.x, v.y) > 60) { startCoast(v); return; }
      scheduleRest();
    } else { const base = live || xf; gestureStart = { xf: copyXf(base), p: pointers.size === 2 ? pinch() : null, at: pointers.size === 1 ? [...pointers.values()][0] : null }; }
  }
  function onTap(x, y) {
    if (live) { live = null; requestDraw(); }
    const double = lastTap && now() - lastTap.t < DOUBLE_TAP_MS && Math.hypot(x - lastTap.x, y - lastTap.y) < DOUBLE_TAP_PX;
    lastTap = double ? null : { t: now(), x, y };
    if (double) { animateTo(zoomAbout(xf, x, y, 2), 200); return; }
    const ll = viewNow().invert([x, y]);
    if (ll) bus.emit('map:tap', { x, y, lon: ll[0], lat: ll[1] });
  }
  function onWheel(e) {
    e.preventDefault();
    stopMotion();
    const [x, y] = local(e), f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
    if (!frameXf) draw();
    setLive(zoomAbout(live || xf, x, y, f));
    clearTimeout(wheelTimer); wheelTimer = setTimeout(commit, REST_MS);
  }
  // keyboard: arrows pan or rotate by KEY_DEG, + - zoom, 0 resets. Every key used calls preventDefault so the document-level
  // handler (time/keys.js) never also steps time.
  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    const k = e.key, s = state(), x = copyXf(live || xf);
    if (k === '+' || k === '=' || k === '-' || k === '_') {
      e.preventDefault();
      const { cx, cy } = rectSize();
      animateTo(zoomAbout(x, cx, cy, k === '+' || k === '=' ? 1.5 : 1 / 1.5), 160);
      return;
    }
    if (k === '0') { e.preventDefault(); api.resetView(); return; }
    const dirs = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[k];
    if (!dirs) return;
    e.preventDefault();
    stopMotion();
    let next = x;
    if (s.view === 'gl') next = { ...x, rot: [wrap180(x.rot[0] - dirs[0] * KEY_DEG), Math.max(-90, Math.min(90, x.rot[1] - dirs[1] * KEY_DEG)), x.rot[2]] };
    else if (s.view === 'nh') {
      next = { ...x, rot: [wrap180(x.rot[0] - dirs[0] * KEY_DEG), x.rot[1], x.rot[2]] };
      if (x.k > 1 && dirs[1]) next.ty = x.ty + dirs[1] * 0.1 * H;
    } else { // Regional: the screen distance of KEY_DEG degrees at the middle of the frame
      const mv = viewNow(x), { cx, cy } = rectSize(), c = mv.invert([cx, cy]);
      if (!c) return;
      const p = mv.project([c[0] + dirs[0] * KEY_DEG, Math.max(-85, Math.min(85, c[1] + dirs[1] * KEY_DEG))]);
      if (!p) return;
      next = { ...x, tx: x.tx - (p[0] - cx), ty: x.ty - (p[1] - cy) };
    }
    setLive(clampX(next));
    scheduleRest();
  }
  canvas.style.touchAction = 'none';
  if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);

  // ---------- subscriptions ----------
  const unsub = store.subscribe((s, patch) => {
    if (REDRAW_KEYS.some((k) => k in patch)) {
      if ('view' in patch && patch.view !== lastView) { lastView = patch.view; stopMotion(); xf = IDENTITY(); live = null; frameXf = null; emitView(); }
      requestDraw();
    }
  });
  const offChunk = bus.on('data:chunk', () => requestDraw());
  const offManifest = bus.on('data:manifest', () => { scene.clear(); frameXf = null; gen++; ensureKey = ''; warmKey = ''; firstFieldAt = 0; requestDraw(); });
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => resize()); ro.observe(canvas); }
  const onWinResize = () => resize();
  if (typeof window !== 'undefined') window.addEventListener('resize', onWinResize);
  const redrawBase = () => { scene.clear(); frameXf = null; gen++; requestDraw(); };
  loadBasemap('geo/', { onUpgrade: redrawBase }).then(redrawBase).catch((e) => console.warn('basemap failed', e.message)); // 110 m first, the 50 m swap redraws again

  // ---------- public API ----------
  /** The renderTo transform: `opts.xf` ({k, tx, ty, rot}, in the on-screen canvas's px) scaled to the target size. */
  function exportXf(opts, s, width, height) {
    if (opts.xf) {
      const sx = W ? width / W : 1, sy = H ? height / H : 1, x = opts.xf;
      return clampXf({ k: x.k ?? 1, tx: (x.tx || 0) * sx, ty: (x.ty || 0) * sy, rot: rot3(x.rot) }, width, height);
    }
    const { centre = null } = opts;
    if (centre) {
      const mv0 = scene.viewFor(s.view, width, height, IDENTITY()), b = mv0.project([centre.lon, centre.lat]);
      const k = centre.zoom ?? 1.5;
      if (b && k > 1) return clampXf({ k, tx: width / 2 - k * b[0], ty: height / 2 - k * b[1], rot: [0, 0, 0] }, width, height);
    }
    return IDENTITY();
  }
  const api = {
    draw, resize,
    setView(id) { if (state().view !== id) store.set({ view: id }); },
    centreOn(lat, lon, ms = 500, zoom = null) { if (!W) resize(); return animateTo(xfCentred(lat, lon, zoom), ms); },
    resetView(ms = 400) { return animateTo(IDENTITY(), ms); },
    project(ll) { if (!W) resize(); return viewNow().project(ll); },
    invert(xy) { if (!W) resize(); return viewNow().invert(xy); },
    addOverlay(fn) { overlays.push(fn); requestDraw(); return () => { const i = overlays.indexOf(fn); if (i >= 0) overlays.splice(i, 1); requestDraw(); }; },
    /** Reserve screen edges (CSS px), e.g. the phone sheet at the bottom: re-centring targets the middle of what is left. */
    setPadding(p) {
      const next = { top: 0, right: 0, bottom: 0, left: 0, ...p };
      if (padKey(next) === padKey(pad)) return;
      pad = next;
      // The view is fitted into what the sheet and scrubber leave free: refit, and keep a zoomed focus in view.
      frameXf = null; lastKey = ''; live = null; scene.clearLayers();
      const f = state().focus, x = xf;
      if (W && f && Number.isFinite(f.lat) && x.k > 1) xf = xfCentred(f.lat, f.lon, x.k, x); else xf = clampX(x);
      requestDraw();
    },
    /** Current pan/zoom/rotation, for tests and debug: {k, tx, ty, rot: [lambda, phi, gamma]}. */
    getTransform() { return copyXf(live || xf); },
    /** Frame cost and counters: the scene's stage timings and `bytes`, plus frameMs (script time of the last frame), frames, composes. */
    stats() { return { ...scene.stats, frameMs: counters.frameMs, frames: counters.frames, composes: counters.composes, quality: counters.quality, lastInputAt: counters.lastInputAt, restStartedAt: counters.restStartedAt, width: W, height: H, dpr }; },
    /** The fields behind what is drawn, at a place and the current time: {values: {fieldId: number}, t, signal: 'clear' | 'none'}. */
    sampleAt(lon, lat) {
      const s = state(), m = data.getManifest(), values = {};
      if (m) {
        const p = plan(s, m), ids = new Set([p.anom?.field, p.contour, p.jet, m.fields?.z500sd ? 'z500sd' : null, m.fields?.z500a ? 'z500a' : null].filter(Boolean));
        for (const f of ids) {
          const meta = m.fields?.[f];
          if (!meta) continue;
          const first = domainFor(f, s.view, m), order = [first, ...meta.domains.filter((d) => d !== first)];
          for (const id of order) {
            const dom = m.domains[id], g = dom && toGrid(dom, lon, lat), arr = g && data.fieldAt(f, id, s.t);
            if (!arr) continue;
            const v = bilinear(arr, dom, g[0], g[1], NaN);
            if (Number.isFinite(v)) { values[f] = v; break; }
          }
        }
      }
      const anom = values.z500a / 10, spread = values.z500sd / 10, hasSpread = Number.isFinite(spread);
      // The mean of disagreeing members shrinks toward zero: with the spread known, at least 4 dam and larger than the anomaly, there is no clear signal.
      const signal = !Number.isFinite(anom) || (hasSpread && spread >= 4 && Math.abs(anom) < spread) ? 'none' : 'clear';
      return { values, t: s.t, signal };
    },
    /** Load what renderTo needs for these options (t, view, layers, case); resolves when decoded. */
    async ensureFor(opts = {}) {
      const s = { ...state(), ...opts, layers: { ...state().layers, ...(opts.layers || {}) } };
      await Promise.all(needed(s).map(([f, d]) => data.ensure(f, d, s.t)));
    },
    /**
     * Render one frame into any 2D context at width x height (CSS px, no dpr scaling): basemap, field, contours,
     * jet; no legend, pins or focus ring. Options: t, view, layers, theme, lens, ground, overlays-flags `flags`, case (default the
     * store), `xf` ({k, tx, ty, rot}: the on-screen transform, so a share keeps a rotated globe), centre {lat, lon, zoom},
     * overlays [fn(ctx, project, state)], rasterScale (default 0.75). `centre` zooms to centre.zoom (default 1.5, 1 = the whole
     * view) and puts the place mid-frame where the view allows. Returns {project, invert} of the drawn view.
     */
    renderTo(c2, opts = {}) {
      const { width, height, overlays: ovs = [], rasterScale = 0.75 } = opts;
      const base = state();
      const s = { ...base, t: opts.t ?? base.t, view: opts.view ?? base.view, theme: opts.theme ?? base.theme, lens: opts.lens ?? base.lens,
        ground: opts.ground ?? base.ground, range: opts.range ?? base.range, case: opts.case ?? base.case,
        layers: { ...base.layers, ...(opts.layers || {}) }, overlays: { ...(base.overlays || {}), ...(opts.flags || {}) } };
      const x = exportXf(opts, s, width, height);
      const mv = scene.viewFor(s.view, width, height, x);
      c2.save();
      mv.quality = 'rest';
      scene.compose(c2, mv, { s, dpr: 1, rasterScale, alpha: 1, force: true, quality: 'rest' });
      const proj = (ll) => mv.project(ll), info = { ...s, width, height, dpr: 1, k: x.k, rot: x.rot };
      for (const fn of ovs) fn(c2, proj, info);
      c2.restore();
      return { project: proj, invert: (xy) => mv.invert(xy) };
    },
    destroy() {
      destroyed = true; cancelAnimationFrame(raf); stopMotion(); clearTimeout(wheelTimer);
      unsub(); offChunk(); offManifest(); ro?.disconnect();
      if (typeof window !== 'undefined') window.removeEventListener('resize', onWinResize);
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('keydown', onKey);
      if (resetBtn) { resetBtn.removeEventListener('click', onResetClick); if (resetOwned) resetBtn.remove(); else resetBtn.hidden = true; }
    },
  };
  return api;
}
