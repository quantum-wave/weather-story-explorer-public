// Expand: the map takes the whole viewport (design spec 4.7). W3-05 ships the CSS mode, which holds inside any iframe
// (artifact host included); W4-06 adds native fullscreen where document.fullscreenEnabled and the divider.
//   mountFullscreen(app)  wires #btn-expand (created inside #map-tools when the shell has none) and the F and Escape keys.
//   toggleExpand(force?)  flips store.expanded; #app[data-expanded] follows the store.
// Expanded hides the header, which carries the sample label. Sample data is always labelled (brief), so while expanded a chip on the map
// carries the same label (data/kind.js sampleLabel). The wide legend draws its own sample badge, so frame.css shows the chip at phone width.
import { h } from './dom.js';
import { store } from '../state.js';
import { sampleLabel } from '../data/kind.js';
import { isPhone } from './layout.js';

let ctx = null; // {app, btn, chip}

function ensureCss() {
  if (document.getElementById('wse-frame-css')) return;
  const link = document.createElement('link');
  link.id = 'wse-frame-css'; link.rel = 'stylesheet'; link.href = new URL('../../css/frame.css', import.meta.url).href;
  document.head.append(link);
}

function typing(el) {
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
}
const sheetOpen = () => !!document.querySelector('.wse-sheet-root');
// Escape belongs to the topmost layer: an open Layers panel or a modal (the city picker) takes it first and expanded mode stays.
const layerOpen = () => { const p = document.getElementById('layers-panel'); return (!!p && !p.hidden) || !!document.querySelector('.modal-scrim'); };

function paint() {
  const on = !!store.get().expanded;
  const appEl = document.getElementById('app');
  if (appEl) { if (on) appEl.setAttribute('data-expanded', ''); else appEl.removeAttribute('data-expanded'); }
  const btn = ctx?.btn;
  if (btn) {
    btn.textContent = on ? 'Exit' : 'Expand';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on ? 'Exit full screen map' : 'Expand the map to full screen');
  }
  const app = ctx?.app;
  paintChip();
  // the renderer fits the chart between the sheet and the scrubber; expanded, only the scrubber is left
  if (app?.renderer?.setPadding) {
    if (on) {
      const tl = document.getElementById('timeline')?.getBoundingClientRect().height || 0;
      const phone = isPhone();
      app.renderer.setPadding({ top: phone ? 56 : 0, bottom: Math.round(tl) });
    } else app.layout?.setSnap?.(store.get().sheet || 'peek');
  }
  requestAnimationFrame(() => app?.renderer?.resize?.());
}

/**
 * The sample chip: shown while expanded when the data is not live, hidden otherwise. One line, so the pill hugs its words (a wrapped
 * label kept the pill at its full max-width with an empty right half). The full label (kind.js sampleLabel) when it fits on the line,
 * else the short contract form ("Sample · 5 Sep · not live"); both say sample and not live. The chip is pointer-events:none, so a title
 * tooltip could never show: when the short form is drawn, the chip is hidden from assistive technology and a visually hidden twin
 * (#expanded-sample-name) carries the full label, dataset name included.
 * Fitted only when something that changes the fit changes: expanded, the manifest, the viewport width, the fonts. Never on a clock tick
 * (playback sets the store every frame; refitting there forced a synchronous layout per frame, rescue-2 review).
 */
let fitted = null; // the `${full}|${short}|${innerWidth}` the chip was last fitted for
function paintChip({ force = false } = {}) {
  const chip = ctx?.chip;
  if (!chip) return;
  let full = '', short = '';
  try {
    const m = store.get().expanded ? (ctx.app?.data?.getManifest?.() || ctx.app?.manifest) : null;
    full = m ? sampleLabel(m) : ''; short = m ? sampleLabel(m, { short: true }) : '';
  } catch { full = short = ''; }
  const key = full ? `${full}|${short}|${window.innerWidth}` : '';
  if (!force && key === fitted) return;
  fitted = key;
  chip.hidden = !full;
  chip.textContent = full;
  chip.removeAttribute('aria-hidden');
  chip.removeAttribute('title');
  // measured only while the chip is laid out (expanded at phone width); elsewhere it is display:none and keeps the full label
  const useShort = !!(full && short && short !== full && chip.getClientRects().length > 0 && chip.scrollWidth > chip.clientWidth + 1);
  if (useShort) { chip.textContent = short; chip.setAttribute('aria-hidden', 'true'); }
  if (ctx.name) ctx.name.textContent = useShort ? full : '';
}

// Native fullscreen, in addition to the CSS mode, where the document allows it (design spec 4.7). It is only ever an extra: a host that
// refuses it (the artifact frame) keeps the CSS mode alone, and the layout is the same in both. The expanded state is the intent; native
// fullscreen is brought to it whenever no request or exit is in flight, because both land asynchronously (macOS animates the change for
// about half a second) and a press may arrive in between: a fast Expand then Exit, or F F.
//   mine      the root fullscreen that is on, or asked for, is this module's. Only it changes the expanded state when the browser
//             leaves it (Escape), so a fullscreen the page did not ask for never does.
//   entering  a requestFullscreen() is in flight; when it lands (fullscreenchange or its promise, whichever comes first) and expanded
//             is off by then, native is left again.
//   exiting   an exitFullscreen() is in flight; when it lands and expanded is on again, native is asked for again.
let mine = false, entering = false, exiting = false;
const nativeElement = () => document.fullscreenElement || null;
const rootNative = () => !!nativeElement() && nativeElement() === document.documentElement;
function enterNative() {
  const el = document.documentElement;
  if (document.fullscreenEnabled !== true || !el.requestFullscreen) return;
  if (entering || exiting) return; // resolved when the change in flight lands (nativeLanded, onFullscreenChange)
  if (rootNative()) { mine = true; return; } // already on (a request that landed late): expanded now owns it
  if (nativeElement()) return; // some other element is fullscreen: not ours to replace
  mine = true; entering = true;
  try {
    const p = el.requestFullscreen({ navigationUI: 'hide' });
    if (p && p.then) p.then(nativeLanded, () => { entering = false; mine = false; }); // refused (no user activation, a policy): the CSS mode stays
    else entering = false;
  } catch { entering = false; mine = false; }
}
function leaveNative() {
  if (entering || exiting) return; // resolved when the change in flight lands
  if (!rootNative() || !mine || !document.exitFullscreen) return;
  exiting = true;
  try { const p = document.exitFullscreen(); if (p && p.catch) p.catch(() => { exiting = false; }); else exiting = false; } catch { exiting = false; }
}
// A request landed: keep it while expanded, leave it again if expanded was switched off while it was in flight.
function nativeLanded() {
  entering = false;
  if (rootNative() && mine && !store.get().expanded) leaveNative();
}
// Escape in native fullscreen is taken by the browser and never reaches the page; fullscreenchange is the only signal.
function onFullscreenChange() {
  if (nativeElement()) {
    if (rootNative() && entering) nativeLanded();
  } else if (exiting) {
    exiting = false; mine = false;
    if (store.get().expanded) enterNative(); // Expand was pressed again while the exit was in flight
  } else if (mine) {
    mine = false; entering = false;
    if (store.get().expanded) toggleExpand(false); // the browser left it (Escape)
  }
  paint(); // the viewport changed: the padding and the canvas follow it
}

export function toggleExpand(force) {
  const next = typeof force === 'boolean' ? force : !store.get().expanded;
  if (next === !!store.get().expanded) return next;
  if (next) enterNative(); else leaveNative();
  store.set({ expanded: next });
  const live = document.getElementById('live');
  if (live) live.textContent = next ? 'Map expanded. Press Escape to exit.' : 'Map restored.';
  return next;
}

export function mountFullscreen(app) {
  ensureCss();
  let btn = document.getElementById('btn-expand');
  if (!btn) {
    const tools = document.getElementById('map-tools');
    btn = h('button', { id: 'btn-expand', class: 'tool-btn', type: 'button' });
    (tools?.querySelector('.tools-end') || tools || document.body).append(btn);
  }
  const stage = document.getElementById('stage');
  let chip = document.getElementById('expanded-sample');
  if (!chip && stage) { chip = h('p', { id: 'expanded-sample', class: 'badge wse-sample-chip' }); chip.hidden = true; stage.append(chip); }
  let name = document.getElementById('expanded-sample-name');
  if (!name && chip) { name = h('span', { id: 'expanded-sample-name', class: 'sr-only' }); chip.after(name); }
  ctx = { app, btn, chip, name };
  btn.addEventListener('click', () => toggleExpand());
  // Capture phase: the Layers panel and the city picker close themselves on a bubbling Escape listener, so by the time a bubbling
  // listener of ours ran they would already be gone and one key press would also leave expanded mode.
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    if (e.key === 'Escape') {
      if (!store.get().expanded || sheetOpen() || layerOpen()) return;
      toggleExpand(false); e.preventDefault();
    } else if ((e.key === 'f' || e.key === 'F') && !sheetOpen()) {
      toggleExpand(); e.preventDefault();
    }
  }, true);
  store.subscribe((s, p) => { if ('expanded' in p) paint(); });
  document.addEventListener('fullscreenchange', onFullscreenChange);
  app?.bus?.on?.('data:manifest', () => paintChip());
  addEventListener('resize', () => paintChip()); // a rotated phone may fit the full label, or no longer (the key holds the width)
  document.fonts?.addEventListener?.('loadingdone', () => paintChip({ force: true })); // a late web font changes the width the label takes
  paint();
  return { toggleExpand };
}
