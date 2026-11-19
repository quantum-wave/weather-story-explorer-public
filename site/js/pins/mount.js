// One call wires the pins UI into the shell (WP4 calls this from main.js):
//
//   import { mountPins } from './pins/mount.js';
//   const ui = mountPins({ canvas, renderer, quickAddEl, panelEl });
//
// - the map overlay (dots, trips, home) is added to the renderer and redrawn when pins change;
// - press and hold on the map adds a place; a tap on a dot focuses it (store.focus + 'pin:focus');
// - quickAddEl gets the Add box, panelEl the backup / copy all / CSV cards. Both optional.
// Everything returns a handle with destroy().
import { bus } from '../state.js';
import { pins as defaultPins } from './index.js';
import { pinOverlay } from './overlay.js';
import { attachMapHold } from './maphold.js';
import { mountQuickAdd } from './quickadd-ui.js';
import { mountPinsPanel } from './panel.js';
import { openEditSheet } from './edit.js';
import { ensureStyles } from './dom.js';

const MOUNTED = Symbol.for('wse.pins.mounted');

export function mountPins({ canvas = null, renderer = null, quickAddEl = null, panelEl = null, pins = defaultPins } = {}) {
  ensureStyles();
  // The map part (overlay, hold, tap) is wired once per canvas; a second call only mounts the DOM pieces it is given.
  const mapDone = !!(canvas && canvas[MOUNTED]);
  const undo = [];
  const onEdit = (id) => openEditSheet(id, { pins });
  let overlay = null;
  if (renderer && !mapDone) {
    overlay = pinOverlay(renderer, { pins });
    renderer.addOverlay(overlay);
    undo.push(bus.on('pins:changed', () => renderer.draw?.()));
    if (canvas) { undo.push(attachMapHold(canvas, { renderer, overlay, pins, onEdit })); canvas[MOUNTED] = true; undo.push(() => { canvas[MOUNTED] = false; }); }
  }
  const qa = quickAddEl ? mountQuickAdd(quickAddEl, { pins, onEdit }) : null;
  const panel = panelEl ? mountPinsPanel(panelEl, { pins }) : null;
  return { overlay, quickAdd: qa, panel, openEditSheet: onEdit, destroy() { undo.forEach((f) => f()); qa?.destroy(); panel?.destroy(); } };
}

export { openEditSheet, mountQuickAdd, mountPinsPanel, attachMapHold };
export { showToast, addedToast, closeToast } from './toast.js';
export { mountCityPicker } from './picker.js';
