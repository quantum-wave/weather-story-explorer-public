// Toasts and the map status line (design spec 8.5). Mounts into #toasts and #map-status.
//   showToast({text, action?: {label, run}, ms = 6000}) -> {el, close}   at most one action; "Copied" and the like.
//   setStatus({kind: 'loading' | 'partial' | 'error', text, retry?})     one line on the map; kind '' clears it.
//   clearStatus(kind?)                                                   clears only when the kind matches (or no kind given).
// The functions look their elements up on each call, so they work before mountStatus() and in tests.
// Placement: on the phone #toasts sits at the top of the map stage under the map tools; on the desktop it is the last child of the
// story panel (#home), where it takes real space instead of floating over the content; expanded, it goes back into the stage.
// No static imports: main.js imports this file for the first paint, and every level of static imports is a round trip on a slow link.
// h and clear are the two helpers of ui/dom.js, kept here (a dozen lines) for that reason; the store is passed to mountStatus.
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, String(v));
  }
  for (const kid of kids.flat(Infinity)) { if (kid != null && kid !== false) e.append(kid instanceof Node ? kid : document.createTextNode(String(kid))); }
  return e;
}
const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
let store = null;

const CSS_ID = 'wse-status-css';
function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const link = document.createElement('link');
  link.id = CSS_ID; link.rel = 'stylesheet'; link.href = new URL('../../css/status.css', import.meta.url).href;
  document.head.append(link);
}

const MAX_TOASTS = 3;
const toasts = new Set();

function region() {
  let el = document.getElementById('toasts');
  if (!el) {
    el = h('div', { id: 'toasts' });
    (document.getElementById('stage') || document.body).append(el);
  }
  el.setAttribute('aria-live', 'polite');
  return el;
}

/** Show a toast. One action at most (Undo, Retry, Select and copy). Pauses while hovered or focused. */
export function showToast({ text = '', action = null, ms = 6000 } = {}) {
  ensureCss();
  const host = region();
  const el = h('div', { class: 'wse-toast', role: 'status' }, h('span', { class: 'wse-toast-text', text }));
  let timer = 0, closed = false;
  const close = () => {
    if (closed) return;
    closed = true; clearTimeout(timer); toasts.delete(rec); el.remove();
  };
  const rec = { el, close };
  if (action && action.label) {
    el.append(h('button', { class: 'wse-toast-action', type: 'button', onclick: () => { try { action.run?.(); } finally { close(); } } }, action.label));
  }
  const arm = (t) => { clearTimeout(timer); if (ms > 0) timer = setTimeout(close, t); };
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', () => arm(3000));
  el.addEventListener('focusin', () => clearTimeout(timer));
  el.addEventListener('focusout', () => { if (!el.contains(document.activeElement)) arm(3000); });
  toasts.add(rec);
  while (toasts.size > MAX_TOASTS) [...toasts][0].close();
  host.append(el);
  arm(ms);
  return rec;
}

let statusKind = '', statusText = '', statusRetry = null;
/** One status line on the map. `retry` adds a Retry button. kind '' (or no text) clears. An identical call leaves the DOM alone
 *  (a failing chunk is re-requested every few hundred ms; the button must stay put under a finger or pointer). */
export function setStatus({ kind = '', text = '', retry = null } = {}) {
  const el = document.getElementById('map-status');
  if (!el) return;
  ensureCss();
  if (!kind || !text) { clear(el); statusKind = ''; statusText = ''; statusRetry = null; delete el.dataset.kind; return; }
  statusRetry = retry;
  if (kind === statusKind && text === statusText && !!retry === !!el.querySelector('.wse-status-retry')) return;
  clear(el);
  statusKind = kind; statusText = text;
  el.dataset.kind = kind;
  el.append(h('span', { class: 'wse-status-text', text }));
  if (retry) el.append(h('button', { class: 'wse-status-retry', type: 'button', onclick: () => { try { statusRetry?.(); } catch (e) { console.warn('retry failed', e?.message || e); } } }, 'Retry'));
}
/** The partial-data line (design spec 8.5): the days that are in while the later chunks are still loading. */
export const partialText = (days) => `Showing days 1-${days}; later days are loading`;
/** The missing-field line from data.missing() ([{field, reason}]): what this run lacks, in words. '' when nothing is missing. */
const FIELD_WORDS = { z500sd: 'ensemble spread', z500em: 'the ensemble mean', tp6: 'rain', pr1: 'rain', pr10: 'rain', ivt: 'moisture transport', t850a: 'warmth aloft', t2m: 'surface temperature' };
export function missingText(list) {
  const words = [...new Set((list || []).map((m) => FIELD_WORDS[m && m.field] || (m && m.field)).filter(Boolean))];
  if (!words.length) return '';
  const head = words.length === 1 ? words[0] : words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1];
  return `${head.charAt(0).toUpperCase()}${head.slice(1)} ${words.length === 1 ? "isn't" : "aren't"} in this run`;
}
export const statusNow = () => statusKind;
export function clearStatus(kind) { if (!kind || kind === statusKind) setStatus({}); }

/** Panel skeleton cards for the first load: shaped like the cards that replace them, not a sentence. */
export function showSkeleton(body = document.getElementById('home-body')) {
  if (!body || body.querySelector('[data-skeleton]')) return;
  ensureCss();
  const card = () => h('div', { class: 'card wse-skel-card' }, h('div', { class: 'skeleton line', style: { width: '40%', height: '14px' } }), h('div', { class: 'skeleton line' }), h('div', { class: 'skeleton line', style: { width: '70%' } }), h('div', { class: 'skeleton' }));
  body.prepend(h('div', { 'data-skeleton': '', class: 'stack', 'aria-hidden': 'true' }, card(), card()));
  // the phone's peek card shows a skeleton too
  const focus = document.getElementById('focus-card');
  if (focus && !focus.firstChild) focus.append(h('div', { 'data-skeleton': '', class: 'stack', 'aria-hidden': 'true' }, h('div', { class: 'skeleton line' }), h('div', { class: 'skeleton line', style: { width: '75%' } }), h('div', { class: 'skeleton line', style: { width: '45%', height: '14px' } })));
}
export function hideSkeleton() {
  for (const e of document.querySelectorAll('[data-skeleton]')) e.remove();
}

/** Put #toasts where it takes space instead of covering controls (see the header). */
function place() {
  const el = document.getElementById('toasts');
  if (!el) return;
  const phone = window.matchMedia('(max-width: 899px), (orientation: landscape) and (max-height: 500px) and (pointer: coarse)').matches;
  const home = document.getElementById('home'), stage = document.getElementById('stage');
  const target = phone || store?.get().expanded ? stage : home;
  if (target && el.parentElement !== target) target.append(el);
}

/** The pins package's toast (added a place, Undo) creates its own fixed host on <body>, bottom centre, over the timeline. Move that host into
 *  #toasts so every toast in the app shares one region that takes its own space (status.css restyles the host in there). */
function adoptPinsHost() {
  const reg = document.getElementById('toasts');
  const host = document.querySelector('body > .pn-toast-host');
  if (reg && host) reg.append(host);
}

export function mountStatus({ store: st } = {}) {
  store = st || null;
  ensureCss();
  region();
  place();
  adoptPinsHost();
  new MutationObserver(adoptPinsHost).observe(document.body, { childList: true });
  window.matchMedia('(max-width: 899px), (orientation: landscape) and (max-height: 500px) and (pointer: coarse)').addEventListener?.('change', place);
  store?.subscribe((s, p) => { if ('expanded' in p) place(); });
  return { showToast, setStatus, clearStatus };
}
