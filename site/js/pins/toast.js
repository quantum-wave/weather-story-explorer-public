// One toast at a time, bottom centre, above the sheet. Group chips and Undo live here (SPEC section 5).
import { h, themed } from './dom.js';
import { groupColor } from './color.js';
import { store } from '../state.js';
import { pins as defaultPins } from './index.js';

let host = null, unTheme = null, cur = null;

function ensureHost() {
  if (host && host.isConnected) return host;
  host = h('div', { class: 'pn-toast-host', 'aria-live': 'polite', 'aria-atomic': 'false' });
  unTheme?.();
  unTheme = themed(host);
  document.body.append(host);
  return host;
}

export function closeToast() { cur?.close(); }

/**
 * @param {{message?:string, body?:Node, undo?:Function, actions?:Array<{label:string, run:Function}>, ms?:number}} o
 * @returns {{el:HTMLElement, close:Function}}
 */
export function showToast({ message = '', lead = '', body = null, undo = null, actions = [], ms = 6000 } = {}) {
  cur?.close();
  const el = h('div', { class: 'pn-toast', role: 'status' });
  const text = h('div', { class: 'pn-toast-text' }, lead, message ? h('b', { text: message }) : null);
  const top = h('div', { class: 'pn-toast-top' }, text);
  for (const a of actions) top.append(h('button', { class: 'pn-btn quiet', type: 'button', onclick: () => a.run() }, a.label));
  let timer = null, closed = false, left = ms;
  const close = () => { if (closed) return; closed = true; clearTimeout(timer); el.remove(); if (cur && cur.el === el) cur = null; };
  if (undo) top.append(h('button', { class: 'pn-btn quiet', type: 'button', 'data-undo': '1', onclick: () => { undo(); close(); } }, 'Undo'));
  el.append(top);
  if (body) el.append(body);
  const arm = (t) => { clearTimeout(timer); timer = setTimeout(close, t); };
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', () => arm(3000));
  el.addEventListener('focusin', () => clearTimeout(timer));
  el.addEventListener('focusout', () => { if (!el.contains(document.activeElement)) arm(3000); });
  ensureHost().replaceChildren(el);
  arm(left);
  cur = { el, close, extend: () => arm(ms) };
  return cur;
}

/** The toast after an add: "Added Maya · Portland, OR", group chips for people and places, Edit, Undo. */
export function addedToast(result, { pins = defaultPins, onEdit = null, ms = 8000 } = {}) {
  const id = result.id;
  const isTrip = result.kind === 'trip';
  const undo = () => { pins.remove(id); };
  const actions = onEdit ? [{ label: 'Edit', run: () => { closeToast(); onEdit(id); } }] : [];
  let body = null, t = null;
  if (!isTrip && result.kind !== 'home') {
    body = h('div', { class: 'pn-chips', role: 'group', 'aria-label': 'Group' });
    const render = () => {
      const cur = pins.get(id);
      if (!cur) return;
      body.replaceChildren();
      const theme = store.get().theme === 'light' ? 'light' : 'dark';
      for (const g of pins.groups()) {
        const sw = h('span', { class: 'sw' });
        sw.style.background = groupColor(g.hue, theme);
        body.append(h('button', {
          class: 'pn-chip', type: 'button', 'aria-pressed': cur.group === g.id ? 'true' : 'false', 'data-group': g.id,
          onclick: () => { pins.update(id, { group: cur.group === g.id ? '' : g.id }); render(); t.extend?.(); },
        }, sw, g.name));
      }
      body.append(h('button', { class: 'pn-chip add', type: 'button', 'aria-label': 'New group', onclick: () => newGroup() }, '+'));
    };
    const newGroup = () => {
      const input = h('input', { class: 'pn-chip-input', type: 'text', placeholder: 'Group name', enterkeyhint: 'done', maxlength: 30, autocomplete: 'off', 'aria-label': 'New group name' });
      const finish = (commit) => {
        const v = input.value.trim();
        if (commit && v) { const gid = pins.addGroup(v); if (gid) pins.update(id, { group: gid }); }
        render();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') finish(false); });
      input.addEventListener('blur', () => finish(true));
      body.querySelector('.add')?.replaceWith(input);
      input.focus();
    };
    t = showToast({ lead: 'Added ', message: result.summary, body, undo, actions, ms });
    render();
    return t;
  }
  return showToast({ lead: isTrip ? 'Added trip ' : 'Added ', message: result.summary, undo, actions, ms });
}
