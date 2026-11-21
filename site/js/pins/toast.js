// One toast at a time, in the shell's #toasts region (design spec 8.5), so a toast never floats over a sheet, a field or a
// button the person is using. Carries at most one action besides Undo. Added and removed items offer Undo; group choice
// lives in the sheet, not here (UX-10). Falls back to its own fixed region only where the page has no #toasts.
import { h, themed } from './dom.js';
import { pins as defaultPins } from './index.js';

export const UNDO_MS = 5000;
let host = null, unTheme = null, cur = null;

function ensureHost() {
  const shell = document.getElementById('toasts');
  if (shell) { if (shell !== host) { unTheme?.(); unTheme = themed(shell); host = shell; } return shell; }
  if (host && host.isConnected) return host;
  host = h('div', { class: 'pn-toast-host', id: 'toasts', 'aria-live': 'polite', 'aria-atomic': 'false' });
  unTheme?.();
  unTheme = themed(host);
  document.body.append(host);
  return host;
}

// What a toast must never cover (design spec 8.5): a button, a field or the timeline.
const CONTROLS = 'button, a[href], input, select, textarea, [role=button], [role=slider], [role=option], #timeline';
const GAP = 8;

// The safe-area insets, read from one hidden probe that is attached once and then only read. place() must never add or remove
// body children: the layout watcher below observes body's children, so a probe made per call re-triggered place() every frame.
let probe = null;
function safeInsets() {
  if (!probe || !probe.isConnected) {
    probe = document.createElement('div');
    probe.className = 'pn-safe-probe';
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
    document.body.append(probe);
  }
  const cs = getComputedStyle(probe);
  return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
}

/** A control a person can see inside the box: hit-tested, so one under the raised story panel or the sheet does not count. */
function seenIn(e, x0, y0, x1, y1) {
  const b = e.getBoundingClientRect();
  const l = Math.max(b.left, x0), r = Math.min(b.right, x1), t = Math.max(b.top, y0), btm = Math.min(b.bottom, y1);
  if (r - l < 1 || btm - t < 1) return false;
  for (let y = t + 1; y < btm; y += 4) for (let x = l + 1; x < r; x += 4) {
    const u = document.elementFromPoint(x, y);
    if (u && (u === e || e.contains(u))) return true;
  }
  return false;
}

/**
 * Put the shell's region where the toast covers no visible control (design spec 8.5). First choice: under the map tools
 * (view switch, Layers). When something covers that spot (on the phone, the story panel raised over the map, its resize handle
 * and its buttons), the next clear place: under the panel's handle, then above the bottom safe area, then the first clear
 * band from the top down. A region already clear stays put, so a toast never jumps from under a finger.
 */
function place(el, { keep = false } = {}) {
  if (el.id !== 'toasts' || !el.firstElementChild) return;
  const box = el.firstElementChild.getBoundingClientRect(), h = el.firstElementChild.offsetHeight;
  if (!h) return;
  const x0 = box.left, x1 = box.right, ins = safeInsets(), vh = window.innerHeight, was = el.style.visibility;
  el.style.visibility = 'hidden'; // out of the hit-test while measuring what a person sees under it
  try {
    const controls = [...document.querySelectorAll(CONTROLS)].filter((e) => !el.contains(e) && !e.closest('[inert]')).map((e) => [e, e.getBoundingClientRect()])
      .filter(([, b]) => b.width >= 2 && b.height >= 2 && b.left < x1 && b.right > x0);
    const clear = (top) => top >= ins.top + GAP / 2 && top + h <= vh - ins.bottom - GAP / 2 &&
      !controls.some(([e, b]) => b.top < top + h + GAP / 2 && b.bottom > top - GAP / 2 && seenIn(e, x0, top - GAP / 2, x1, top + h + GAP / 2));
    if (keep && el.style.top && clear(parseFloat(el.style.top))) return;
    const below = (id) => { const b = document.getElementById(id)?.getBoundingClientRect(); return b && b.height > 0 ? Math.ceil(b.bottom + GAP) : null; };
    const tries = [below('map-tools'), below('sheet-handle'), Math.floor(vh - ins.bottom - GAP - h)];
    for (let y = Math.ceil(ins.top + GAP); y + h <= vh - ins.bottom; y += GAP) tries.push(y);
    const at = tries.find((y) => y != null && clear(y));
    if (at != null) el.style.top = at + 'px';
  } finally { el.style.visibility = was; }
}

// The page can move under a toast (the panel dragged, an overlay opened, the window resized): move the region only if it
// now covers a control. At most one re-place per frame, the observer runs only while a toast is up, and the toast's own nodes
// (its region, the inset probe) never count as the page moving, so placing a toast can never schedule another place.
let watching = false, frame = 0, mo = null;
function rePlace() { if (cur && host && host.style.visibility !== 'hidden') place(host, { keep: true }); }
function soon() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; rePlace(); }); }
const ours = (n) => n === probe || n === host;
function pageMoved(records) { return records.some((r) => [...r.addedNodes, ...r.removedNodes].some((n) => !ours(n))); }
function watchLayout() {
  if (!watching) {
    watching = true;
    window.addEventListener('resize', rePlace);
    document.addEventListener('transitionend', rePlace, true);
    document.addEventListener('pointerup', soon, true);
    document.addEventListener('scroll', soon, true); // a panel scrolled under the toast (scroll does not bubble: capture)
    mo = new MutationObserver((records) => { if (cur && pageMoved(records)) soon(); });
  }
  mo.observe(document.body, { childList: true });
  // the home panel re-renders after a save (a new trip card above the Add field): its controls move with no body-level change
  const panel = document.getElementById('home-body');
  if (panel) mo.observe(panel, { childList: true, subtree: true });
}
function unwatchLayout() { mo?.disconnect(); if (frame) { cancelAnimationFrame(frame); frame = 0; } }

/**
 * A sheet that is still leaving (ui/sheet.js marks it data-state="closing") covers the page and keeps it inert, so a place
 * measured now would be measured against the wrong page. Resolves once it has gone (at most 1 s).
 */
function sheetGone() {
  const leaving = document.querySelector('.wse-sheet-root[data-state="closing"]');
  if (!leaving) return null;
  return new Promise((done) => {
    const mo = new MutationObserver(() => { if (!leaving.isConnected) finish(); });
    const t = setTimeout(() => finish(), 1000);
    function finish() { mo.disconnect(); clearTimeout(t); done(); }
    mo.observe(leaving.parentNode || document.body, { childList: true });
  });
}

export function closeToast() { cur?.close(); }

/**
 * @param {{message?:string, lead?:string, body?:Node, undo?:Function, actions?:Array<{label:string, run:Function}>, ms?:number}} o
 * @returns {{el:HTMLElement, close:Function, extend:Function}}
 */
export function showToast({ message = '', lead = '', body = null, undo = null, actions = [], ms = 6000 } = {}) {
  cur?.close();
  const el = h('div', { class: 'pn-toast', role: 'status', 'data-ms': String(ms) });
  const text = h('div', { class: 'pn-toast-text' }, lead, message ? h('b', { text: message }) : null);
  const top = h('div', { class: 'pn-toast-top' }, text);
  for (const a of actions.slice(0, 1)) top.append(h('button', { class: 'pn-btn quiet', type: 'button', onclick: () => a.run() }, a.label));
  let timer = null, closed = false;
  const close = () => { if (closed) return; closed = true; clearTimeout(timer); el.remove(); if (cur && cur.el === el) { cur = null; unwatchLayout(); } };
  if (undo) top.append(h('button', { class: 'pn-btn quiet', type: 'button', 'data-undo': '1', onclick: () => { undo(); close(); } }, 'Undo'));
  el.append(top);
  if (body) el.append(body);
  const arm = (t) => { clearTimeout(timer); timer = setTimeout(close, t); };
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', () => arm(3000));
  el.addEventListener('focusin', () => clearTimeout(timer));
  el.addEventListener('focusout', () => { if (!el.contains(document.activeElement)) arm(3000); });
  const region = ensureHost();
  region.replaceChildren(el);
  cur = { el, close, extend: () => arm(ms) };
  watchLayout();
  const wait = sheetGone();
  if (!wait) { place(region); arm(ms); return cur; }
  // the toast follows the sheet out: shown, placed and timed once the sheet has left
  region.style.visibility = 'hidden';
  wait.then(() => {
    if (closed) return;
    place(region);
    region.style.visibility = '';
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    arm(ms);
  });
  return cur;
}

/** The toast after an add: "Added Maya · Portland, OR", Edit and Undo. */
export function addedToast(result, { pins = defaultPins, onEdit = null, ms = 8000 } = {}) {
  const id = result.id;
  const undo = () => { pins.remove(id); };
  const actions = onEdit && id ? [{ label: 'Edit', run: () => { closeToast(); onEdit(id); } }] : [];
  return showToast({ lead: result.kind === 'trip' ? 'Added trip ' : 'Added ', message: result.summary, undo: id ? undo : null, actions, ms });
}

/** The toast after Remove: the word "Removed", the name, and a 5 second Undo. */
export function removedToast(label, undo) {
  return showToast({ lead: 'Removed ', message: label, undo, ms: UNDO_MS });
}
