// Keyboard: Space play/pause, Left/Right one data step, Shift+Left/Right one day, 1 2 3 4 switch view (np, nh, gl, wm). Nothing else (SPEC section 4).
import { store } from '../state.js';
import * as clock from './clock.js';

const VIEW_KEYS = { 1: 'np', 2: 'nh', 3: 'gl', 4: 'wm' };

function typing(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}
function onButton(el) { return !!el && (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute?.('role') === 'button'); }

/** Pure key handler, also used by tests. Returns true when the event was consumed. */
export function handleKey(e) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return false;
  const el = e.target;
  if (typing(el)) return false;
  if (e.key === ' ' || e.code === 'Space') {
    if (onButton(el)) return false; // the button's own Space activation wins
    clock.toggle(); e.preventDefault(); return true;
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    if (e.shiftKey) clock.stepDay(dir); else clock.step(dir);
    e.preventDefault(); return true;
  }
  if (VIEW_KEYS[e.key]) { store.set({ view: VIEW_KEYS[e.key] }); return true; }
  return false;
}

/** Install the handler on `target`; returns an uninstall function. */
export function installKeys(target = document) {
  target.addEventListener('keydown', handleKey); // the same function on the same target registers once: idempotent
  return () => target.removeEventListener('keydown', handleKey);
}
