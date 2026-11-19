// Small DOM helpers shared by the pins UI. All user text goes through textContent (never innerHTML).
import { store } from '../state.js';

/** h('button', {class:'pn-btn', onclick: fn, 'aria-label': 'x'}, 'text', childNode) */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid !== undefined && kid !== null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

let cssLink = null;
/** Load pins.css once (a <link> to our own file, so it works wherever the site's own files are served). */
export function ensureStyles() {
  if (cssLink || typeof document === 'undefined') return;
  cssLink = document.createElement('link');
  cssLink.rel = 'stylesheet';
  cssLink.href = new URL('./pins.css', import.meta.url).href;
  document.head.append(cssLink);
}

/** Give `el` the .pn class and keep data-theme in step with the store. Returns an unsubscribe. */
export function themed(el) {
  ensureStyles();
  el.classList.add('pn');
  const apply = () => el.setAttribute('data-theme', store.get().theme === 'light' ? 'light' : 'dark');
  apply();
  return store.subscribe(apply);
}

export const isCoarse = () => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } };
export const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
