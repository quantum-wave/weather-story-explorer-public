// Boots the app: wires the packages through their frozen interfaces, mounts the shell, plays the loop.
// window.__wse = {ready, store, data, renderer, pins, lastShareMeta, frameTimes, drawnText} (test and debug hook).
// The renderer draws itself (it subscribes to the store); the clock only writes store.t.
//
// First paint. This file imports only a few tiny modules statically. It paints the ground, the graticule and the 110 m coastline of the
// default Regional view at once (ui/firstpaint.js: pre-projected, no d3), puts skeleton cards in the panel, waits for d3 and topojson
// (index.html loads them `async` with `data-lib`, so they never block the parser), then imports the rest of the app with dynamic imports.
// index.html modulepreloads every module this file imports statically, and theirs, so the first paint waits for one round trip, not
// three (S-STATUS fails if the list and the imports drift apart). A blocking d3 <script> in <head> would leave the page blank until d3
// had arrived (S-STATUS checks index.html for this too). Measured on fast 4G (W3-05 fix 3) and not kept: importing the chart's modules
// ahead of the app's and preloading the 110 m basemap (both competed with d3, and the coastline still waited for the module graph).
//
// d3 and topojson: index.html records each script's outcome on the tag the moment it happens (onload / onerror set data-state), so a
// failure that fires before this module runs (blocked CDN, CSP, offline) is still seen; a tag without a state is watched through its
// events, its resource-timing entry and a timeout. A failure shows "Couldn't load the app." with Retry, never an endless loading line.
import { showSkeleton, hideSkeleton, setStatus, clearStatus, statusNow, showToast, mountStatus, partialText, missingText } from './ui/status.js';
import { prefs } from './ui/prefs.js';
import { theme } from './render/theme.js';
import { paintFirst, TIMELINE_H } from './ui/firstpaint.js';

const root = document.documentElement;
const dark = prefs.get('theme', 'dark') !== 'light';
root.setAttribute('data-theme', dark ? 'dark' : 'light');

// Ground, graticule and coastline (no d3 needed). The canvas is made visible by an inline style, not a class in a stylesheet that status.js
// loads lazily: shell.css hides #map (opacity 0, 300 ms transition) until .map-ready, and the ground must not wait for any file.
const canvas = document.getElementById('map');
const openView = (/^#(np|nh|gl|wm)-/.exec(location.hash) || [])[1] || 'np'; // a link may open another view; only Regional is pre-projected
const phone0 = matchMedia('(max-width: 899px), (orientation: landscape) and (max-height: 500px) and (pointer: coarse)').matches;
// The scrubber mounts after the manifest; its space is reserved now, so the chart is fitted around it from the first frame (no jump).
// Every way boot ends gives the space back through releaseTimeline(): on success the scrubber has its own height; on a failure (a library,
// a module or the manifest) the scrubber never comes, and a reservation left behind is an empty sheet-coloured band (S-STATUS 2b, 2c).
const timelineEl = document.getElementById('timeline');
if (timelineEl && !timelineEl.firstChild) timelineEl.style.minHeight = `${phone0 ? TIMELINE_H.phone : TIMELINE_H.desktop}px`;
/** Drops the first-paint reservation; true if there was one (the canvas's box may have changed, so the caller repaints). */
const releaseTimeline = () => { if (!timelineEl?.style.minHeight) return false; timelineEl.style.minHeight = ''; return true; };
let first = null, firstCoast = null;
/** Paints the ground, graticule and coastline at the canvas's current box, fitted above whatever #timeline takes now. */
function paintGround() {
  try {
    first = paintFirst(canvas, { view: openView, ocean: theme(dark ? 'dark' : 'light').ocean, ground: dark ? 'night' : 'paper', phone: phone0, timelineH: timelineEl?.getBoundingClientRect().height || 0 });
    if (!first && canvas) {
      const r = canvas.getBoundingClientRect(); // another view, or no geometry: the ground alone, at the box's size (never a stretched bitmap)
      if (r.width >= 2 && r.height >= 2) { canvas.width = Math.round(r.width); canvas.height = Math.round(r.height); }
      const ctx = canvas.getContext('2d'); ctx.fillStyle = theme(dark ? 'dark' : 'light').ocean; ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  } catch (e) { console.warn('first paint', e?.message || e); /* the app draws it again */ }
}
paintGround();
let wseFirst = null;
const dropFirstCoast = () => { firstCoast?.remove(); firstCoast = null; };
addEventListener('resize', () => { first = null; dropFirstCoast(); }, { once: true }); // drawn for one canvas size
if (canvas) { canvas.style.transition = 'none'; canvas.style.opacity = '1'; }
document.getElementById('app')?.classList.add('map-ground');
showSkeleton(); // idempotent
setStatus({ kind: 'loading', text: 'Loading the pressure pattern…' });
// The page's own record of the moment its first paint (ground, coastline, skeleton cards, loading line) is in place, on the page clock:
// S-STATUS holds it to the 300 ms budget, where a timer of its own would run late on a busy machine.
try { performance.mark('wse:first-paint', { detail: { coast: !!first } }); } catch { /* no User Timing: the check says so */ }

const LIB_TIMEOUT_MS = 20000; // nothing heard at all: a very slow link still gets 280 KB of d3 in this time
const LIB_STUCK_MS = 3000; // the file arrived (resource timing) but its global never appeared
const libReady = (s) => (s.dataset.lib === 'd3' ? !!globalThis.d3 : !!globalThis.topojson);
/** Resolves when the library's global exists; rejects when its tag failed, loaded without defining the global, or never reported. */
function waitLib(s) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    let done = false, timer = 0;
    const finish = (ok) => {
      if (done) return;
      done = true; clearInterval(timer);
      if (ok) resolve(); else reject(new Error(`could not load ${s.dataset.lib} (${s.dataset.state || 'no answer'} after ${Math.round(performance.now() - t0)} ms)`));
    };
    const check = () => {
      if (libReady(s)) return finish(true);
      const st = s.dataset.state;
      if (st === 'error' || st === 'load') return finish(false); // load without the global: the file is not the library
      const e = performance.getEntriesByName?.(s.src)?.[0];
      if (e && e.responseEnd > 0 && ((e.responseStatus || 200) >= 400 || performance.now() - Math.max(t0, e.responseEnd) > LIB_STUCK_MS)) { s.dataset.state = 'error'; return finish(false); }
      if (performance.now() - t0 > LIB_TIMEOUT_MS) { s.dataset.state = 'timeout'; return finish(false); }
    };
    s.addEventListener('load', () => { s.dataset.state ||= 'load'; check(); }, { once: true });
    s.addEventListener('error', () => { s.dataset.state = 'error'; check(); }, { once: true });
    timer = setInterval(check, 100);
    check();
  });
}
let modules;
try {
  await Promise.all([...document.querySelectorAll('script[data-lib]')].map(waitLib));
  // a module that fails to load (offline mid-boot, a bad deploy) is the same failure as a library: the app cannot start
  modules = await Promise.all([
    import('./state.js'), import('./data/index.js'), import('./render/index.js'), import('./pins/index.js'), import('./time/clock.js'),
    import('./time/keys.js'), import('./time/scrubber.js'), import('./time/debug.js'), import('./links.js'), import('./links.js'),
    import('./share/index.js'), import('./story/index.js'), import('./ui/layout.js'), import('./ui/header.js'), import('./ui/layers.js'),
    import('./ui/home.js'), import('./ui/focus.js'), import('./ui/maplegend.js'),
    import('./ui/fullscreen.js'), import('./ui/guide.js'), import('./ui/readout.js'), import('./ui/coach.js'), import('./render/basemap.js'),
    import('./pins/mount.js'), import('./ui/datestamp.js'),
  ]);
} catch (e) {
  console.warn(e?.stack || e);
  hideSkeleton();
  setStatus({ kind: 'error', text: "Couldn't load the app.", retry: () => location.reload() });
  if (releaseTimeline()) paintGround(); // the canvas grew into the space on a wide screen: repaint it at its new box
  throw e;
}
const [
  { store, bus }, data, { createRenderer }, { pins }, clock, { installKeys }, { mountScrubber }, { installDebug }, links, { installLinks },
  share, story, { mountLayout }, { mountHeader, applyTheme }, { mountLayers }, { mountHome }, { focusLabelOverlay }, { mountMapLegend },
  { mountFullscreen }, { mountGuide }, { mountReadout }, { mountCoach }, { loadBasemap }, pinsMount, { mountDateStamp },
] = modules;

const $ = (id) => document.getElementById(id);
const appEl = $('app');

// The renderer's first frame (below, in this same task) repaints #map before the basemap has parsed: the coastline moves to an overlay
// until the renderer has drawn its own.
if (first && canvas.isConnected) { try { firstCoast = first.hold(); } catch { /* no overlay: the coastline comes back with the basemap */ } }
wseFirst = first ? { ...first.fit, anchors: first.anchors } : null;
const renderer = createRenderer(canvas);
const wse = { firstPaint: wseFirst, ready: false, storyReady: false, error: null, store, data, renderer, pins, lastShareMeta: null, frameTimes: [], drawnText: [], recording: false, captureOffscreen: false, ui: {} };
window.__wse = wse;

// Text drawn off screen (exports) or inside renderTo is recorded so tests can assert on it.
{
  const proto = window.CanvasRenderingContext2D?.prototype;
  const orig = proto?.fillText;
  if (orig && !orig.__wse) {
    const spy = function fillText(text, ...rest) {
      const c = this.canvas;
      const offscreen = wse.captureOffscreen && c && !c.isConnected && !(c.width === canvas.width && c.height === canvas.height); // not the renderer's own frame buffer
      if ((wse.recording || offscreen) && wse.drawnText.length < 4000) wse.drawnText.push(String(text));
      return orig.call(this, text, ...rest);
    };
    spy.__wse = true;
    proto.fillText = spy;
  }
  const rt = renderer.renderTo?.bind(renderer);
  if (rt) renderer.renderTo = (...a) => { wse.recording = true; try { return rt(...a); } finally { wse.recording = false; } };
}
wse.clearDrawnText = () => { wse.drawnText.length = 0; };

// ---------- theme, layout, header, layers ----------
store.set({ theme: prefs.get('theme', 'dark') === 'light' ? 'light' : 'dark' });
applyTheme(store.get().theme);

const layout = mountLayout({ appEl, home: $('home'), handle: $('sheet-handle'), stage: $('stage'), canvas, timeline: $('timeline'), renderer });
const header = mountHeader({ store, bus });
// layers.js calls toast({message, ms}); the shared toast region takes {text, ms}
// The toasts come from buttons inside the Layers panel (Copy link), which would sit under the toast: the action is done, so the panel closes.
let layers = null;
const toast = (o = {}) => { layers?.open?.(false); return showToast({ text: o.text ?? o.message ?? '', action: o.action, ms: o.ms }); };
layers = mountLayers({ store, bus, clock, renderer, links, toast });
renderer.addOverlay(focusLabelOverlay);
const mapLegend = mountMapLegend({ store, bus }); // the always-visible DOM legend (SPEC section 5.1)

// ---------- the friend case: a link opened by someone whose home is still the default ----------
const hash0 = location.hash;
const linkOpened = hash0.length > 1 && hash0 !== '#debug';
const friend = { active: () => linkOpened && pins.homeIsDefault() };

// Same-wave hooks (renderer.sampleAt from W3-03, openAddSheet from W3-07, data.missing from W3-09) are called only if present: each is looked
// up at call time, so a package that lands later is picked up and one that has not landed yet is skipped.
const sampleAt = (lon, lat) => (typeof renderer.sampleAt === 'function' ? renderer.sampleAt(lon, lat) : null);
const openAddSheet = (o) => (typeof pinsMount.openAddSheet === 'function' ? (pinsMount.openAddSheet(o), true) : false);
const missingFields = () => { try { const r = typeof data.missing === 'function' ? data.missing() : null; return Array.isArray(r) ? r : []; } catch { return []; } };

const app = { store, bus, data, pins, clock, renderer, story, layout, friend, canvas, manifest: null, now: () => Date.now(), sampleAt, openAddSheet, missingFields, toast };
const home = mountHome(app);
app.home = home; // the briefing reads a pin's day classes from the card's own build (one source per place)
wse.ui = { home, layers, layout, header, app, mapLegend };
mountStatus({ store });
// Feature stubs: each package fills its own module.
mountFullscreen(app);
mountGuide(app);
mountReadout(app);
mountCoach(app);
wse.ui.dateStamp = mountDateStamp(app); // the valid time in large letters over the chart
// The ground and graticule draw at once and the coastline as soon as the bundled basemap parses, before any forecast data.
renderer.resize(); renderer.draw();
// The first-paint coastline stays over the map until the renderer has drawn its own (the frame before the basemap parses has none).
// It also goes the moment the renderer's view stops matching it (the canvas resized when the scrubber mounted, or the phone's padding
// changed), so a frame never shows the overlay's coastline beside the renderer's.
loadBasemap().then(() => { renderer.resize(); renderer.draw(); }).catch(() => {}).finally(() => requestAnimationFrame(dropFirstCoast));
if (firstCoast && wseFirst) {
  let { k, tx, ty } = wseFirst;
  const { anchors, W, H } = wseFirst;
  const watch = () => {
    if (!firstCoast) return;
    const ps = anchors.map(([ll]) => renderer.project(ll));
    const off = anchors.some(([, u], i) => !ps[i] || Math.hypot(ps[i][0] - (tx + k * u[0]), ps[i][1] - (ty + k * u[1])) > 0.5);
    if (off) {
      // the same canvas re-padded (the phone sheet settling on its measured peek): the Regional view is the pre-projected one scaled and
      // shifted, so the two anchors give the new fit and the overlay follows it; anything else (a resize, another view) drops it
      const r = canvas.getBoundingClientRect(), [[, u0], [, u1]] = anchors;
      const du = Math.hypot(u1[0] - u0[0], u1[1] - u0[1]);
      if (ps[0] && ps[1] && du > 0 && Math.round(r.width) === W && Math.round(r.height) === H && typeof firstCoast.refit === 'function') {
        k = Math.hypot(ps[1][0] - ps[0][0], ps[1][1] - ps[0][1]) / du; tx = ps[0][0] - k * u0[0]; ty = ps[0][1] - k * u0[1];
        const fits = anchors.every(([, u], i) => Math.hypot(ps[i][0] - (tx + k * u[0]), ps[i][1] - (ty + k * u[1])) <= 0.5);
        if (fits) { firstCoast.refit({ k, tx, ty }); requestAnimationFrame(watch); } else dropFirstCoast();
      } else dropFirstCoast();
    } else requestAnimationFrame(watch);
  };
  bus.on('map:viewchange', watch);
  watch();
}

// ---------- chunk failures and partial data (UX-15: they used to reach only the console) ----------
// A chunk that fails to load or decode shows on the map with Retry. Two sources: the data:error event (W3-09 emits it), and this file's own
// watch: renderer.ensureFor() resolves when the chunks the current view needs are decoded and rejects when one fails, so the failure is
// seen even where data:error is not emitted. Both go through the same status line.
const failed = new Map(); // key -> {field, domain} for data:error failures; 'watch' for a failure seen by the probe
const retryAll = () => {
  const events = [...failed.values()].filter((d) => d.field);
  failed.clear();
  setStatus({ kind: 'loading', text: 'Loading the pressure pattern…' });
  return Promise.all([...events.map((d) => data.ensureAll(d.field, d.domain).catch(() => noteFailure({ ...d }))), probe()]);
};
function noteFailure(d = {}) {
  failed.set(d.field ? `${d.field}|${d.domain}` : 'watch', d);
  setStatus({ kind: 'error', text: "Couldn't load this layer.", retry: retryAll });
}
function noteOk() {
  failed.delete('watch');
  if (wse.ready && !failed.size && (statusNow() === 'error' || statusNow() === 'loading')) clearStatus(); // a Retry that worked, or the probe after a failure
  refreshNotes();
}
async function probe() {
  try { await renderer.ensureFor?.(); } catch (e) { noteFailure({ message: String(e?.message || e) }); return false; }
  noteOk();
  return true;
}
bus.on('data:error', (d) => noteFailure(d || {}));
const loaded = new Map(); // `${field}|${domain}` -> Set of chunk ids that have arrived
bus.on('data:chunk', ({ field, domain, chunk } = {}) => {
  failed.delete(`${field}|${domain}`);
  let set = loaded.get(`${field}|${domain}`); if (!set) loaded.set(`${field}|${domain}`, set = new Set());
  set.add(chunk);
  if (statusNow() === 'loading' || (statusNow() === 'error' && !failed.size)) clearStatus();
  refreshNotes();
});
// re-check when the chunks the view needs change (a new 6 h bucket, layer, view or case), not on every frame
let probeKey = '', probeTimer = 0;
store.subscribe((s) => {
  if (!wse.ready) return;
  const key = [s.view, s.lens, Math.floor(s.t / 6)].join('|');
  if (key === probeKey) return;
  probeKey = key;
  clearTimeout(probeTimer); probeTimer = setTimeout(probe, 150);
});

// One quiet line under the loading and error states: "Showing days 1-7; later days are loading", else what this run lacks (data.missing()).
function partialDays() {
  const m = data.getManifest();
  const f = m?.fields?.z500a ? 'z500a' : m?.fields?.z500 ? 'z500' : null;
  if (!f) return null;
  for (const [key, set] of loaded) {
    if (!key.startsWith(f + '|')) continue;
    const dom = key.slice(f.length + 1), chunks = (m.fields[f].chunks || []).filter((c) => c.files?.[dom]);
    if (chunks.length < 2 || set.size >= chunks.length) return null;
    let last = -1;
    for (const c of chunks) { if (!set.has(c.id)) break; last = c.steps[1] - 1; }
    return last < 0 ? null : Math.max(1, Math.floor(m.fields[f].steps[last] / 24));
  }
  return null;
}
function refreshNotes() {
  if (!wse.ready || statusNow() === 'loading' || statusNow() === 'error') return;
  const days = partialDays();
  const text = days ? partialText(days) : missingText(missingFields());
  if (text) setStatus({ kind: 'partial', text }); else clearStatus('partial');
}

// ---------- boot ----------
let manifest = null;
try {
  manifest = await data.loadManifest();
  app.manifest = manifest;
  header.setManifest(manifest);
  layers.setManifest(manifest);
  if (manifest.sample) clock.seek(clock.range()[0]); // a sample opens at the start of its own dataset
  await installLinks(); // applies a link in the address, then mirrors state into the hash
  share.installShare();
  mountScrubber($('timeline'));
  releaseTimeline(); // the scrubber has its own height now
  installKeys(document);
  const dbg = installDebug();
  if (dbg?.frameTimes && wse.frameTimes !== dbg.frameTimes) wse.frameTimes = dbg.frameTimes;
  renderer.resize();
  if (!linkOpened) {
    const [r0, r1] = clock.range();
    const nowH = (Date.now() - data.validTime(0).getTime()) / 3600e3;
    clock.seek(nowH >= r0 && nowH <= r1 ? nowH : r0);
  }
  // first frame: wait for the chunks the map needs, but never for long; a failure shows its status at once (not after the 4 s)
  const first = probe();
  await Promise.race([first, new Promise((r) => setTimeout(r, 4000))]);
  renderer.draw();
  appEl.classList.add('map-ready');
  if (statusNow() === 'loading') clearStatus();
  if (!linkOpened) clock.openingPlay(); // plays from now, pauses on the first touch, stays paused under reduced motion
} catch (e) {
  wse.error = String(e?.message || e);
  console.warn(e?.stack || wse.error);
  hideSkeleton();
  setStatus({ kind: 'error', text: "Couldn't load the forecast.", retry: () => location.reload() });
  if (releaseTimeline()) { try { renderer.resize(); renderer.draw(); } catch { /* the status line is what matters now */ } }
}
wse.ready = true;
probeKey = [store.get().view, store.get().lens, Math.floor(store.get().t / 6)].join('|');
if (manifest) refreshNotes();

if (manifest) {
  hideSkeleton();
  await home.start();
  const f = store.get().focus;
  if (linkOpened && f && f.kind !== 'home' && pins.homeIsDefault()) {
    // a link to someone else's place: show it in the focus card without a card of its own
    await home.focusCity({ id: f.placeRef != null ? String(f.placeRef).replace(/^c/, '') : null, name: f.label, lat: f.lat, lon: f.lon, cc: '', admin: '' }, { noTween: true, keepSheet: true });
    layout.setSnap('peek');
  }
}
wse.storyReady = true;

// The Briefing (C1-04): one dynamic import, mounted last. A failure here is logged and the app carries on without the pill.
if (manifest) {
  try { const { mountBriefing } = await import('./brief/index.js'); wse.ui.brief = await mountBriefing(app); } catch (e) { console.warn('briefing: not mounted', e?.stack || e); }
}
