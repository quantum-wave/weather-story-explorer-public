// Boots the app: wires the packages through their frozen interfaces, mounts the shell, plays the loop.
// window.__wse = {ready, store, data, renderer, pins, lastShareMeta, frameTimes, drawnText} (test and debug hook).
// The renderer draws itself (it subscribes to the store); the clock only writes store.t.
import { store, bus } from './state.js';
import * as data from './data/index.js';
import { createRenderer } from './render/index.js';
import { pins } from './pins/index.js';
import * as clock from './time/clock.js';
import { installKeys } from './time/keys.js';
import { mountScrubber } from './time/scrubber.js';
import { installDebug } from './time/debug.js';
import * as links from './links.js';
import { installLinks } from './links.js';
import * as share from './share/index.js';
import * as story from './story/index.js';
import { showToast } from './pins/toast.js';
import { prefs } from './ui/prefs.js';
import { mountLayout } from './ui/layout.js';
import { mountHeader, applyTheme } from './ui/header.js';
import { mountLayers } from './ui/layers.js';
import { mountHome } from './ui/home.js';
import { focusLabelOverlay } from './ui/focus.js';
import { legendOverlay } from './ui/maplegend.js';

const $ = (id) => document.getElementById(id);
const appEl = $('app'), canvas = $('map'), status = $('map-status');

const renderer = createRenderer(canvas);
const wse = { ready: false, storyReady: false, error: null, store, data, renderer, pins, lastShareMeta: null, frameTimes: [], drawnText: [], recording: false, captureOffscreen: false, ui: {} };
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
const layers = mountLayers({ store, bus, clock, renderer, links, toast: showToast });
renderer.addOverlay(focusLabelOverlay);
renderer.addOverlay(legendOverlay); // the always-visible legend (SPEC section 8)

// ---------- the friend case: a link opened by someone whose home is still the default ----------
const hash0 = location.hash;
const linkOpened = hash0.length > 1 && hash0 !== '#debug';
const friend = { active: () => linkOpened && pins.homeIsDefault() };

const app = { store, bus, data, pins, clock, renderer, story, layout, friend, canvas, manifest: null, now: () => Date.now() };
const home = mountHome(app);
wse.ui = { home, layers, layout, header, app };
status.textContent = 'Reading the forecast…';

// ---------- boot ----------
let manifest = null;
try {
  manifest = await data.loadManifest();
  app.manifest = manifest;
  header.setManifest(manifest);
  layers.setManifest(manifest);
  if (manifest.sample) layers.selectCase('A');
  else store.set({ layers: { z: true, j: false, c: false, t: false } });
  await installLinks(); // applies a link in the address, then mirrors state into the hash
  share.installShare();
  mountScrubber($('timeline'));
  installKeys(document);
  const dbg = installDebug();
  if (dbg?.frameTimes && wse.frameTimes !== dbg.frameTimes) wse.frameTimes = dbg.frameTimes;
  renderer.resize();
  if (!linkOpened) {
    const [r0, r1] = clock.range();
    const nowH = (Date.now() - data.validTime(0).getTime()) / 3600e3;
    clock.seek(nowH >= r0 && nowH <= r1 ? nowH : r0);
  }
  // first frame: wait for the chunks the map needs, but never for long
  await Promise.race([renderer.ensureFor?.() ?? Promise.resolve(), new Promise((r) => setTimeout(r, 4000))]).catch(() => {});
  renderer.draw();
  appEl.classList.add('map-ready');
  status.textContent = '';
  if (!linkOpened) clock.openingPlay(); // plays from now, pauses on the first touch, stays paused under reduced motion
} catch (e) {
  wse.error = String(e?.message || e);
  console.warn(e?.stack || wse.error);
  status.textContent = 'The forecast data could not be loaded. Reload to try again.';
}
wse.ready = true;

if (manifest) {
  await home.start();
  const f = store.get().focus;
  if (linkOpened && f && f.kind !== 'home' && pins.homeIsDefault()) {
    // a link to someone else's place: show it in the focus card without a card of its own
    await home.focusCity({ id: f.placeRef != null ? String(f.placeRef).replace(/^c/, '') : null, name: f.label, lat: f.lat, lon: f.lon, cc: '', admin: '' }, { noTween: true, keepSheet: true });
    layout.setSnap('peek');
  }
}
wse.storyReady = true;
