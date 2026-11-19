// Map renderer: one canvas, three projections, the anomaly raster, contours, jet, basemap, legend, overlays,
// pan/zoom. Draws only when something changed (no idle animation frames). See compose.js for the frame pipeline.
import { store, bus } from '../state.js';
import * as data from '../data/index.js';
import { makeScene, needed } from './compose.js';
import { IDENTITY, clampXf, ZOOM_MAX, padKey } from './view.js';
import { loadBasemap } from './basemap.js';
import { theme as themeTokens } from './theme.js';

const FADE_MS = 300;
const MAX_DPR = 2; // 3x phones draw at 2x: a third of the pixels, hairlines stay crisp
const ease = (u) => 1 - (1 - u) ** 3;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const REDRAW_KEYS = ['t', 'layers', 'view', 'theme', 'case'];

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const scene = makeScene();
  const frame = typeof document !== 'undefined' ? document.createElement('canvas') : canvas;
  const frameCtx = frame.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  let xf = IDENTITY(); // committed pan/zoom
  let live = null; // gesture or animation in flight
  let frameXf = null, frameKey = '', lastKey = '', gen = 0;
  let pad = { top: 0, right: 0, bottom: 0, left: 0 };
  const overlays = [];
  let raf = 0, anim = 0, lastView = store.get().view, destroyed = false;
  let firstFieldAt = 0, ensureKey = '', warmKey = '';

  // ---------- sizing ----------
  function resize() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width || canvas.clientWidth || canvas.width)), h = Math.max(1, Math.round(r.height || canvas.clientHeight || canvas.height));
    const d = Math.min(MAX_DPR, Math.max(1, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1));
    if (w === W && h === H && d === dpr && canvas.width === Math.round(w * d)) return;
    W = w; H = h; dpr = d;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    frame.width = canvas.width; frame.height = canvas.height;
    frameXf = null; lastKey = '';
    xf = clampXf(xf, W, H);
    scene.clearLayers();
    requestDraw();
  }

  // ---------- views ----------
  const state = () => store.get();
  const viewNow = (x = live || xf) => scene.viewFor(state().view, W, H, x, pad);
  const rectSize = () => ({ cx: pad.left + (W - pad.left - pad.right) / 2, cy: pad.top + (H - pad.top - pad.bottom) / 2 });

  // ---------- drawing ----------
  function chrome(mv, s) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const proj = (ll) => mv.project(ll);
    const info = { ...s, width: W, height: H, dpr, k: (live || xf).k, rot: (live || xf).rot };
    for (const fn of overlays.slice()) { try { fn(ctx, proj, info); } catch (e) { console.error('overlay failed', e); } }
  }

  const fadeQ = () => (!firstFieldAt || reducedMotion() ? 32 : Math.round(Math.min(1, (performance.now() - firstFieldAt) / FADE_MS) * 32));
  function composeFrame(s, x, q) {
    const mv = scene.viewFor(s.view, W, H, x, pad);
    frameCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { drewField } = scene.compose(frameCtx, mv, { s, dpr, rasterScale: dpr >= 2 ? 0.5 : 0.8, alpha: ease(q / 32) });
    if (drewField && !firstFieldAt && !reducedMotion()) { firstFieldAt = performance.now(); requestDraw(); }
    else if (drewField && q < 32) requestDraw();
    frameXf = { k: x.k, tx: x.tx, ty: x.ty, rot: x.rot.slice() };
    frameKey = s.view + '|' + s.theme;
    return mv;
  }

  /** Full-quality draw of the committed view, synchronously. */
  function draw() {
    if (destroyed) return;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!W) resize();
    const s = state();
    if (s.view !== lastView) { lastView = s.view; xf = IDENTITY(); live = null; frameXf = null; }
    const q = fadeQ(), key = [s.t, JSON.stringify(s.layers), s.view, s.theme, s.case, data.dataVersion(), W, H, dpr, xf.k, xf.tx, xf.ty, xf.rot[0], xf.rot[1], gen, q].join('|');
    // callers may ask for a draw twice for one change: compose once, blit and draw overlays each time
    const mv = frameXf && key === lastKey ? scene.viewFor(s.view, W, H, xf, pad) : composeFrame(s, xf, q);
    lastKey = key;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(frame, 0, 0);
    chrome(mv, s);
    prefetch(s);
  }

  /** Draw while a gesture or animation moves: transform the last composed frame (a similarity), overlays live. */
  function drawLive() {
    const s = state();
    if (!frameXf || frameKey !== s.view + '|' + s.theme) { draw(); if (!live) return; }
    const x = live, r = x.k / frameXf.k, th = themeTokens(s.theme);
    if (s.view === 'nh' && (x.rot[0] !== frameXf.rot[0] || x.rot[1] !== frameXf.rot[1])) {
      // rotating: redraw with the cheap basemap and a coarse raster, every frame
      const mv = scene.viewFor(s.view, W, H, x, pad);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scene.compose(ctx, mv, { s, dpr, rasterScale: 0.25, low: true });
      chrome(mv, s);
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = th.ocean; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(r, 0, 0, r, dpr * (x.tx - r * frameXf.tx), dpr * (x.ty - r * frameXf.ty));
    ctx.drawImage(frame, 0, 0);
    chrome(scene.viewFor(s.view, W, H, x, pad), s);
  }

  function requestDraw() {
    if (raf || destroyed) return;
    raf = requestAnimationFrame(() => { raf = 0; if (live && frameXf) drawLive(); else draw(); });
  }

  // ---------- data ----------
  function prefetch(s) {
    const m = data.getManifest();
    if (!m) return;
    const key = [s.view, s.case, JSON.stringify(s.layers), Math.floor(s.t / 6), m.run].join('|');
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

  // ---------- pan / zoom ----------
  function zoomAbout(x0, px, py, factor) {
    const k = Math.min(ZOOM_MAX, Math.max(1, x0.k * factor)), q = k / x0.k;
    return clampXf({ ...x0, k, tx: px - (px - x0.tx) * q, ty: py - (py - x0.ty) * q }, W, H);
  }
  function setLive(next) { live = next; requestDraw(); }
  function commit() {
    if (!live) return;
    xf = clampXf(live, W, H); live = null;
    draw();
  }
  function animateTo(target, ms) {
    cancelAnimationFrame(anim); anim = 0;
    target = clampXf(target, W, H);
    if (!ms || reducedMotion() || !W) { live = null; xf = target; draw(); return Promise.resolve(); }
    const from = live || xf, t0 = performance.now();
    return new Promise((resolve) => {
      const step = (now) => {
        const u = Math.min(1, (now - t0) / ms), e = ease(u);
        live = { k: from.k + (target.k - from.k) * e, tx: from.tx + (target.tx - from.tx) * e, ty: from.ty + (target.ty - from.ty) * e,
          rot: [from.rot[0] + (target.rot[0] - from.rot[0]) * e, from.rot[1] + (target.rot[1] - from.rot[1]) * e] };
        if (u < 1) { drawLive(); anim = requestAnimationFrame(step); }
        else { anim = 0; live = target; commit(); resolve(); }
      };
      anim = requestAnimationFrame(step);
    });
  }
  function xfCentred(lat, lon, zoom, x0 = xf) {
    const s = state(), k = zoom ?? Math.max(x0.k, 1.5);
    const mv0 = scene.viewFor(s.view, W, H, { k: 1, tx: 0, ty: 0, rot: x0.rot }, pad);
    const b = mv0.project([lon, lat]);
    if (!b) return x0;
    const { cx, cy } = rectSize();
    return clampXf({ k, tx: cx - k * b[0], ty: cy - k * b[1], rot: x0.rot }, W, H);
  }

  // pointer gestures
  const pointers = new Map();
  let gestureStart = null, wheelTimer = 0;
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const pinch = () => { const [a, b] = [...pointers.values()]; return { d: Math.hypot(a[0] - b[0], a[1] - b[1]), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; };
  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancelAnimationFrame(anim); anim = 0;
    pointers.set(e.pointerId, local(e));
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    const base = live || xf;
    gestureStart = { xf: { ...base, rot: base.rot.slice() }, p: pointers.size === 2 ? pinch() : null, at: local(e) };
    if (!frameXf) draw();
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, local(e));
    const g = gestureStart, s = state();
    if (!g) return;
    if (pointers.size >= 2) {
      if (!g.p) { gestureStart = { xf: live || xf, p: pinch(), at: null }; return; }
      const now = pinch(), f = now.d / (g.p.d || 1);
      let nx = zoomAbout(g.xf, g.p.c[0], g.p.c[1], f);
      nx = clampXf({ ...nx, tx: nx.tx + (now.c[0] - g.p.c[0]), ty: nx.ty + (now.c[1] - g.p.c[1]) }, W, H);
      setLive(nx);
    } else {
      const [x, y] = local(e);
      if (!g.at) { gestureStart = { xf: live || xf, p: null, at: [x, y] }; return; }
      if (s.view === 'nh' && g.xf.k === 1) {
        const c = scene.viewFor('nh', W, H, g.xf, pad).project([0, 90]) || [W / 2, H / 2]; // the pole
        const a0 = Math.atan2(g.at[1] - c[1], g.at[0] - c[0]), a1 = Math.atan2(y - c[1], x - c[0]);
        let da = ((a1 - a0) * 180) / Math.PI;
        da = ((da + 540) % 360) - 180;
        setLive({ ...g.xf, rot: [g.xf.rot[0] - da, g.xf.rot[1]] });
      } else {
        setLive(clampXf({ ...g.xf, tx: g.xf.tx + x - g.at[0], ty: g.xf.ty + y - g.at[1] }, W, H));
      }
    }
  }
  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (pointers.size === 0) { gestureStart = null; commit(); }
    else { const base = live || xf; gestureStart = { xf: base, p: pointers.size === 2 ? pinch() : null, at: pointers.size === 1 ? [...pointers.values()][0] : null }; }
  }
  function onWheel(e) {
    e.preventDefault();
    cancelAnimationFrame(anim); anim = 0;
    const [x, y] = local(e), f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
    if (!frameXf) draw();
    setLive(zoomAbout(live || xf, x, y, f));
    clearTimeout(wheelTimer); wheelTimer = setTimeout(commit, 140);
  }
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // ---------- subscriptions ----------
  const unsub = store.subscribe((s, patch) => {
    if (REDRAW_KEYS.some((k) => k in patch)) {
      if ('view' in patch && patch.view !== lastView) { lastView = patch.view; xf = IDENTITY(); live = null; frameXf = null; }
      requestDraw();
    }
  });
  const offChunk = bus.on('data:chunk', () => requestDraw());
  const offManifest = bus.on('data:manifest', () => { scene.clear(); frameXf = null; gen++; ensureKey = ''; warmKey = ''; firstFieldAt = 0; requestDraw(); });
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => resize()); ro.observe(canvas); }
  loadBasemap().then(() => { scene.clear(); frameXf = null; gen++; requestDraw(); }).catch((e) => console.warn('basemap failed', e.message));

  // ---------- public API ----------
  const api = {
    draw, resize,
    setView(id) { if (state().view !== id) store.set({ view: id }); },
    centreOn(lat, lon, ms = 500, zoom = null) { if (!W) resize(); return animateTo({ ...xfCentred(lat, lon, zoom), rot: (live || xf).rot }, ms); },
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
      if (W && f && Number.isFinite(f.lat) && x.k > 1) xf = xfCentred(f.lat, f.lon, x.k, x); else xf = clampXf(x, W, H);
      requestDraw();
    },
    /** Current pan/zoom, for tests and debug: {k, tx, ty, rot}. */
    getTransform() { const x = live || xf; return { k: x.k, tx: x.tx, ty: x.ty, rot: x.rot.slice() }; },
    stats() { return { ...scene.stats, width: W, height: H, dpr }; },
    /** Load what renderTo needs for these options (t, view, layers, case); resolves when decoded. */
    async ensureFor(opts = {}) {
      const s = { ...state(), ...opts, layers: { ...state().layers, ...(opts.layers || {}) } };
      await Promise.all(needed(s).map(([f, d]) => data.ensure(f, d, s.t)));
    },
    /**
     * Render one frame into any 2D context at width x height (CSS px, no dpr scaling): basemap, field, contours,
     * jet; no legend, pins or focus ring. Options: t, view, layers, theme (default the store), centre {lat, lon, zoom},
     * overlays [fn(ctx, project, state)], rasterScale (default 0.75). `centre` zooms to centre.zoom (default 1.5, 1 = the whole view) and puts the place mid-frame where the view allows. Returns {project, invert} of the drawn view.
     */
    renderTo(c2, opts = {}) {
      const { width, height, centre = null, overlays: ovs = [], rasterScale = 0.75 } = opts;
      const base = state();
      const s = { ...base, t: opts.t ?? base.t, view: opts.view ?? base.view, theme: opts.theme ?? base.theme,
        case: opts.case ?? base.case, layers: { ...base.layers, ...(opts.layers || {}) } };
      let x = IDENTITY();
      if (centre) {
        const mv0 = scene.viewFor(s.view, width, height, IDENTITY()), b = mv0.project([centre.lon, centre.lat]);
        const k = centre.zoom ?? 1.5;
        if (b && k > 1) x = clampXf({ k, tx: width / 2 - k * b[0], ty: height / 2 - k * b[1], rot: [0, 0] }, width, height);
      }
      const mv = scene.viewFor(s.view, width, height, x);
      c2.save();
      scene.compose(c2, mv, { s, dpr: 1, rasterScale, alpha: 1, force: true });
      const proj = (ll) => mv.project(ll), info = { ...s, width, height, dpr: 1, k: x.k };
      for (const fn of ovs) fn(c2, proj, info);
      c2.restore();
      return { project: proj, invert: (xy) => mv.invert(xy) };
    },
    destroy() {
      destroyed = true; cancelAnimationFrame(raf); cancelAnimationFrame(anim); clearTimeout(wheelTimer);
      unsub(); offChunk(); offManifest(); ro?.disconnect();
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
  return api;
}
