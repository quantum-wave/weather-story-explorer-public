// The one sheet (W2-08, design spec 8.1): the only modal surface in the app. A bottom sheet on the phone, a 420 px dialog from
// 900 px. Its height is its content's height (up to 92% of the visual viewport); it changes only on open, setContent() and
// resize(), over 180 ms, so a text change that the caller does not mark never moves it. Dragging down more than 24 px from the
// handle, a tap on the scrim and Escape dismiss it; a dirty draft asks once, inline. Focus moves in, is trapped, and returns to
// the opener; the page behind is inert. Nothing here touches the document until openSheet() is called (it imports under Node).
import { h } from './dom.js';

export const DURATION_MS = 180;
export const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
export const MAX_FRACTION = 0.92;
export const DISMISS_DRAG_PX = 24;
export const FLICK_PX_PER_MS = 0.5;
export const PHONE_MAX_WIDTH = 899.98;

/** The tallest the sheet may be: 92% of the visual viewport. */
export const maxHeight = (viewportH) => Math.floor(Math.max(0, viewportH) * MAX_FRACTION);
/** Height for a content height: the content's, rounded up to a whole pixel, capped at the maximum. */
export const targetHeight = (naturalH, viewportH) => Math.min(Math.ceil(naturalH), maxHeight(viewportH));
/** What a finished drag does: 'dismiss' past 24 px, or a quick flick (more than 8 px at over 0.5 px/ms); otherwise 'snap' back. */
export function dragOutcome({ dy, ms }) {
  if (dy > DISMISS_DRAG_PX) return 'dismiss';
  if (dy > 8 && ms > 0 && dy / ms > FLICK_PX_PER_MS) return 'dismiss';
  return 'snap';
}
/** Where Tab goes inside a trap of n controls from index i (-1 = focus is outside the controls). Null = let the browser move it. */
export function trapTarget(i, n, shift) {
  if (n === 0) return -2; // nothing focusable: stay on the panel
  if (i < 0) return shift ? n - 1 : 0;
  if (!shift && i === n - 1) return 0;
  if (shift && i === 0) return n - 1;
  return null;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let current = null;
let counter = 0;

const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const isPhone = () => window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`).matches;
const viewport = () => { const v = window.visualViewport; return v ? { top: v.offsetTop, h: v.height } : { top: 0, h: window.innerHeight }; };

/** Load css/sheet.css next to the page's own styles. Null when it is already there and loaded. */
function ensureCss() {
  const href = new URL('../../css/sheet.css', import.meta.url).href;
  const have = [...document.querySelectorAll('link[rel="stylesheet"]')].find((l) => l.href === href || /\/sheet\.css(\?|$)/.test(l.href));
  if (have) return have.sheet ? null : new Promise((r) => { have.addEventListener('load', r); have.addEventListener('error', r); });
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = href;
  const p = new Promise((r) => { link.addEventListener('load', r); link.addEventListener('error', r); });
  document.head.append(link);
  return p;
}

/**
 * openSheet({ title, content, actions?, onClose?, dismissable = true, isDirty? })
 *   -> { el, close(reason), setContent(el), setTitle(text), resize(), setActions(actions), ready }
 * actions: [{ id?, label, kind: 'primary' | 'secondary' | 'danger', disabled?, onClick(sheet, event) }] or an element.
 * onClose(reason) runs once after the sheet has left. Reasons: 'escape', 'scrim', 'drag', 'close', 'discard', or what close() got.
 */
export function openSheet({ title = '', content = null, actions = null, onClose = null, dismissable = true, isDirty = null } = {}) {
  if (current) current.teardown();
  const cssWait = ensureCss();
  const id = ++counter;
  const titleId = `wse-sheet-title-${id}`;
  const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;

  const titleEl = h('h2', { class: 'wse-sheet-title', id: titleId, text: title });
  const closeBtn = h('button', { class: 'wse-sheet-close', type: 'button', 'aria-label': 'Close', text: '✕', onclick: () => requestDismiss('close') });
  if (!dismissable) closeBtn.hidden = true;
  const top = h('div', { class: 'wse-sheet-top' }, h('div', { class: 'wse-sheet-handle', 'aria-hidden': 'true' }, h('span')), h('div', { class: 'wse-sheet-head' }, titleEl, closeBtn));
  const body = h('div', { class: 'wse-sheet-body' });
  if (content) body.append(content);
  const buttons = h('div', { class: 'wse-sheet-buttons' });
  const confirmEl = h('div', { class: 'wse-sheet-confirm', role: 'group', 'aria-label': 'Discard changes?', hidden: true },
    h('p', { text: 'Discard changes?' }),
    h('button', { class: 'wse-sheet-btn', type: 'button', 'data-action': 'keep', text: 'Keep editing', onclick: () => hideConfirm() }),
    h('button', { class: 'wse-sheet-btn', type: 'button', 'data-kind': 'danger', 'data-action': 'discard', text: 'Discard', onclick: () => close('discard') }));
  const foot = h('div', { class: 'wse-sheet-actions' }, buttons, confirmEl);
  const panel = h('div', { class: 'wse-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' }, top, body, foot);
  const scrim = h('div', { class: 'wse-sheet-scrim', onclick: () => requestDismiss('scrim') });
  const root = h('div', { class: 'wse-sheet-root', 'data-pending': '' }, scrim, panel);
  root.dataset.state = 'opening';

  let wanted = 0, heightAnim = null, moveAnim = null, openAnim = null, closing = false, gone = false, drag = null, confirmFrom = null;
  const inerted = [];
  let api_ready;
  const readyP = new Promise((res) => { api_ready = res; });

  const setActions = (list) => {
    buttons.replaceChildren();
    foot.hidden = !list || (Array.isArray(list) && !list.length);
    if (!list) return;
    if (list instanceof Node) { buttons.append(list); return; }
    for (const a of list) {
      buttons.append(h('button', {
        class: 'wse-sheet-btn', type: 'button', 'data-kind': a.kind || 'secondary', 'data-action': a.id || a.label, disabled: !!a.disabled, text: a.label,
        onclick: (e) => { if (a.onClick) a.onClick(api, e); },
      }));
    }
  };
  setActions(actions);

  const syncViewport = () => {
    const v = viewport();
    root.style.setProperty('--wse-vv-top', v.top + 'px');
    root.style.setProperty('--wse-vv-h', v.h + 'px');
    panel.style.setProperty('--wse-max', maxHeight(v.h) + 'px');
    return v;
  };
  /** The content's own height, measured with the pin and the cap off. */
  const natural = () => {
    const keepH = panel.style.height, keepMax = panel.style.maxHeight;
    panel.style.height = 'auto'; panel.style.maxHeight = 'none';
    const n = panel.getBoundingClientRect().height;
    panel.style.height = keepH; panel.style.maxHeight = keepMax;
    return n;
  };
  const stopHeightAnim = () => { if (heightAnim) { heightAnim.cancel(); heightAnim = null; } };

  /** A viewport change (keyboard, rotation) re-fits the pin at once. It is not a structural change, so it never animates. */
  const onViewport = () => {
    if (gone) return;
    const v = syncViewport();
    stopHeightAnim();
    panel.style.height = targetHeight(wanted, v.h) + 'px';
  };

  /** Measure, pin the new height, and animate from where the panel is now to it. The only place the height changes. */
  const resize = () => {
    if (gone) return Promise.resolve();
    const v = syncViewport();
    const from = panel.getBoundingClientRect().height;
    stopHeightAnim();
    wanted = natural();
    const to = targetHeight(wanted, v.h);
    panel.style.height = to + 'px';
    if (!from || Math.abs(from - to) < 0.5 || reduced() || closing) return Promise.resolve();
    heightAnim = panel.animate([{ height: from + 'px' }, { height: to + 'px' }], { duration: DURATION_MS, easing: EASE });
    const a = heightAnim;
    return a.finished.then(() => { if (heightAnim === a) heightAnim = null; }, () => {});
  };

  const focusables = () => [...panel.querySelectorAll(FOCUSABLE)].filter((e) => !e.closest('[hidden]') && e.getClientRects().length);
  const focusIn = () => {
    const list = focusables();
    const target = panel.querySelector('[autofocus]') || list.find((e) => !e.classList.contains('wse-sheet-close')) || list[0] || panel;
    target.focus({ preventScroll: true });
  };

  const showConfirm = () => {
    if (!confirmEl.hidden) return;
    confirmFrom = document.activeElement;
    buttons.hidden = true; confirmEl.hidden = false;
    resize();
    confirmEl.querySelector('[data-action="keep"]').focus({ preventScroll: true });
  };
  const hideConfirm = () => {
    if (confirmEl.hidden) return;
    confirmEl.hidden = true; buttons.hidden = false;
    resize();
    (confirmFrom && confirmFrom.isConnected && panel.contains(confirmFrom) ? confirmFrom : panel).focus({ preventScroll: true });
    confirmFrom = null;
  };

  /** A person asked to leave (Escape, scrim, drag, the close button). Returns true when the sheet is going. */
  function requestDismiss(reason) {
    if (!dismissable || closing) return false;
    if (typeof isDirty === 'function' && isDirty()) { showConfirm(); return false; }
    close(reason);
    return true;
  }

  function teardown() {
    if (gone) return;
    gone = true; closing = true;
    stopHeightAnim();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('focusin', onFocusIn, true);
    window.removeEventListener('resize', onViewport);
    if (window.visualViewport) { window.visualViewport.removeEventListener('resize', onViewport); window.visualViewport.removeEventListener('scroll', onViewport); }
    for (const [el, was] of inerted) el.inert = was;
    root.remove();
    if (current === api) current = null;
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
  }

  /** Close for good (no draft check: the caller has decided). Resolves after the leaving animation. */
  function close(reason = 'closed') {
    if (closing) return Promise.resolve();
    closing = true;
    root.dataset.state = 'closing';
    stopHeightAnim();
    if (openAnim) { openAnim.cancel(); openAnim = null; }
    const finish = () => { teardown(false); if (onClose) onClose(reason); };
    if (reduced()) { finish(); return Promise.resolve(); }
    const offset = drag ? drag.dy : 0;
    if (moveAnim) { moveAnim.cancel(); moveAnim = null; }
    const out = isPhone() ? [{ transform: `translateY(${offset}px)` }, { transform: 'translateY(100%)' }] : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px)' }];
    panel.style.transform = ''; panel.style.opacity = '';
    const pa = panel.animate(out, { duration: DURATION_MS, easing: EASE, fill: 'forwards' });
    scrim.animate([{ opacity: +scrim.style.opacity || 1 }, { opacity: 0 }], { duration: DURATION_MS, easing: EASE, fill: 'forwards' });
    return pa.finished.then(finish, finish);
  }

  // ---- keyboard: Escape dismisses, Tab is trapped, focus that escapes is brought back ----
  function onKey(e) {
    if (gone || current !== api) return;
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      if (!confirmEl.hidden) hideConfirm(); else requestDismiss('escape');
    } else if (e.key === 'Tab') {
      const list = focusables();
      const i = list.indexOf(document.activeElement);
      const t = trapTarget(i, list.length, e.shiftKey);
      if (t === null) return;
      e.preventDefault();
      (t === -2 ? panel : list[t]).focus({ preventScroll: true });
    }
  }
  function onFocusIn(e) { if (!gone && !panel.contains(e.target)) focusIn(); }

  // ---- drag down from the handle or the title row (phone) ----
  top.addEventListener('pointerdown', (e) => {
    if (!isPhone() || closing || !dismissable || e.target.closest('button') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (openAnim) { openAnim.cancel(); openAnim = null; }
    drag = { id: e.pointerId, y0: e.clientY, t0: performance.now(), dy: 0 };
    try { top.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
  });
  top.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dy = Math.max(0, e.clientY - drag.y0);
    panel.style.transform = `translateY(${drag.dy}px)`;
    scrim.style.opacity = String(Math.max(0, 1 - drag.dy / Math.max(1, panel.offsetHeight)));
  });
  const endDrag = (e, cancelled) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    const outcome = cancelled ? 'snap' : dragOutcome({ dy: d.dy, ms: performance.now() - d.t0 });
    if (outcome === 'dismiss') {
      drag = d; // close() animates out from the dragged offset
      if (requestDismiss('drag')) return;
      drag = null;
    }
    // snap back
    if (d.dy > 0 && !reduced()) {
      moveAnim = panel.animate([{ transform: `translateY(${d.dy}px)` }, { transform: 'translateY(0)' }], { duration: DURATION_MS, easing: EASE });
      scrim.animate([{ opacity: +scrim.style.opacity || 1 }, { opacity: 1 }], { duration: DURATION_MS, easing: EASE });
    }
    panel.style.transform = ''; scrim.style.opacity = '';
  };
  top.addEventListener('pointerup', (e) => endDrag(e, false));
  top.addEventListener('pointercancel', (e) => endDrag(e, true));

  const api = {
    el: panel, root, body, ready: readyP,
    close, resize, setActions, teardown,
    setTitle(text) { titleEl.textContent = text; },
    setContent(el) { body.replaceChildren(...(el ? [el] : [])); return resize(); },
  };

  const start = () => {
    if (gone) return;
    document.body.append(root);
    for (const el of [...document.body.children]) {
      if (el === root || el.tagName === 'SCRIPT') continue;
      inerted.push([el, !!el.inert]);
      el.inert = true;
    }
    const v = syncViewport();
    wanted = natural();
    panel.style.height = targetHeight(wanted, v.h) + 'px';
    root.removeAttribute('data-pending');
    current = api;
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn, true);
    window.addEventListener('resize', onViewport);
    if (window.visualViewport) { window.visualViewport.addEventListener('resize', onViewport); window.visualViewport.addEventListener('scroll', onViewport); }
    focusIn();
    if (!reduced()) {
      const phone = isPhone();
      openAnim = panel.animate(phone ? [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }] : [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: DURATION_MS, easing: EASE });
      scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION_MS, easing: EASE });
      openAnim.finished.then(() => { openAnim = null; root.dataset.state = 'open'; }, () => {});
    } else root.dataset.state = 'open';
    api_ready(api);
  };
  if (cssWait) { root.dataset.state = 'pending'; cssWait.then(start); } else start();
  return api;
}

/** True while a sheet is open. */
export const isSheetOpen = () => !!current;
