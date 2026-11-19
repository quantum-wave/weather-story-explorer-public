// The edit sheet: name, city, group, note, Remove with undo. Opened from a card's "..." button (no swipe gestures).
import { h, themed, isCoarse } from './dom.js';
import { groupColor } from './color.js';
import { store } from '../state.js';
import { pins as defaultPins } from './index.js';
import { mountCityPicker } from './picker.js';
import { showToast } from './toast.js';

let open = null;

export function closeEditSheet() { open?.close(); }

/**
 * @param {string} id pin or trip id
 * @param {{pins?:object, gazetteer?:object, opener?:HTMLElement}} [o]
 * @returns {{el:HTMLElement, close:Function}|null}
 */
export function openEditSheet(id, { pins = defaultPins, gazetteer, opener = document.activeElement } = {}) {
  const item = pins.get(id);
  if (!item) return null;
  open?.close();
  const isTrip = item.label !== undefined;
  const sheet = h('div', { class: 'pn-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': isTrip ? 'Edit trip' : 'Edit pin' });
  const scrim = h('div', { class: 'pn-scrim' }, sheet);
  const unTheme = themed(scrim);

  const fields = [];
  const name = h('input', { type: 'text', value: isTrip ? item.label : item.name, maxlength: 80, autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'done', spellcheck: 'false' });
  name.addEventListener('change', () => pins.update(id, isTrip ? { label: name.value } : { name: name.value }));
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { name.blur(); } });
  fields.push(h('label', { class: 'pn-field' }, h('span', { text: isTrip ? 'Trip name' : item.kind === 'place' ? 'Place name' : 'Name' }), name));

  const picker = mountCityPicker({ value: item.city, label: isTrip ? 'Where' : item.kind === 'person' ? 'City' : 'Nearest city', gazetteer, onPick: (c) => pins.update(id, { city: c }) });
  fields.push(picker.el);

  if (isTrip) {
    const from = h('input', { type: 'date', value: item.start });
    const to = h('input', { type: 'date', value: item.end });
    const sync = () => { const t = pins.get(id); if (t) { from.value = t.start; to.value = t.end; } };
    from.addEventListener('change', () => { pins.update(id, { start: from.value }); sync(); });
    to.addEventListener('change', () => { pins.update(id, { end: to.value }); sync(); });
    fields.push(h('div', { class: 'pn-row' }, h('label', { class: 'pn-field' }, h('span', { text: 'From' }), from), h('label', { class: 'pn-field' }, h('span', { text: 'To' }), to)));
  } else {
    const chips = h('div', { class: 'pn-chips', role: 'group', 'aria-label': 'Group' });
    const renderChips = () => {
      const cur = pins.get(id); if (!cur) return;
      chips.replaceChildren();
      const theme = store.get().theme === 'light' ? 'light' : 'dark';
      for (const g of pins.groups()) {
        const sw = h('span', { class: 'sw' }); sw.style.background = groupColor(g.hue, theme);
        chips.append(h('button', { class: 'pn-chip', type: 'button', 'data-group': g.id, 'aria-pressed': cur.group === g.id ? 'true' : 'false',
          onclick: () => { pins.update(id, { group: cur.group === g.id ? '' : g.id }); renderChips(); } }, sw, g.name));
      }
      const add = h('input', { class: 'pn-chip-input', type: 'text', placeholder: '+ New group', maxlength: 30, enterkeyhint: 'done', autocomplete: 'off', 'aria-label': 'New group name' });
      const commit = () => { const v = add.value.trim(); if (v) { const gid = pins.addGroup(v); if (gid) pins.update(id, { group: gid }); } renderChips(); };
      add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
      add.addEventListener('blur', () => { if (add.value.trim()) commit(); });
      chips.append(add);
    };
    renderChips();
    fields.push(h('div', { class: 'pn-field' }, h('span', { text: 'Group' }), chips));
    const note = h('textarea', { maxlength: 500, rows: 3, placeholder: 'Optional' }); note.value = item.note || '';
    note.addEventListener('change', () => pins.update(id, { note: note.value }));
    fields.push(h('label', { class: 'pn-field' }, h('span', { text: 'Note' }), note));
  }

  const remove = h('button', { class: 'pn-btn danger', type: 'button', 'data-remove': '1' }, 'Remove');
  const done = h('button', { class: 'pn-btn primary', type: 'button', 'data-done': '1' }, 'Done');
  sheet.append(h('div', { class: 'pn-sheet-head' }, h('h2', { text: isTrip ? 'Edit trip' : item.kind === 'place' ? 'Edit place' : 'Edit person' })), ...fields, h('div', { class: 'pn-sheet-foot' }, remove, done));

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    document.removeEventListener('keydown', onKey);
    // Commit a field the user was typing in when they tapped Done.
    if (document.activeElement && sheet.contains(document.activeElement)) document.activeElement.blur();
    scrim.remove(); unTheme();
    if (open && open.el === scrim) open = null;
    try { opener?.focus?.(); } catch { /* opener gone */ }
  };
  scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) close(); });
  done.addEventListener('click', close);
  remove.addEventListener('click', () => {
    const now = pins.get(id) || item;
    const label = isTrip ? now.label : now.name;
    const undo = pins.remove(id);
    close();
    showToast({ lead: 'Removed ', message: label, undo, ms: 5000 });
  });
  document.addEventListener('keydown', onKey);
  document.body.append(scrim);
  if (!isCoarse()) name.focus();
  open = { el: scrim, close };
  return open;
}
