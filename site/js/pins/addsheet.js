// The Add and Edit flow on the one sheet (ui/sheet.js, design spec 8.2). Add starts small: a kind switch and one free-text field
// that understands "Maya in Portland", "Lisbon" and "Trip: Tahoe Nov 27-30". When the text settles it expands once into labelled
// fields pre-filled from the parse; clearing them contracts it; choosing a kind by hand shows that kind's fields directly.
// Nothing is stored until Save. A place that more than one match answers to (Tahoe) waits for a choice, never picked here.
// Edit is the same sheet filled, plus Remove (inline confirm, then a 5 s Undo toast). Dates edit a draft (daterange.js).
import { h, themed } from './dom.js';
import { openSheet } from '../ui/sheet.js';
import { pins as defaultPins, fmtRange } from './index.js';
import * as gaz from './gazetteer.js';
import { parseQuickAdd, todayISO } from './quickadd.js';
import { mountCityPicker } from './picker.js';
import { createDraft, mountDateRange } from './daterange.js';
import { addedToast, removedToast } from './toast.js';
import { groupColor } from './color.js';
import { store } from '../state.js';

export const SETTLE_MS = 450; // free text expands after the person pauses this long (or on Enter, paste, leaving the field)
const KINDS = [['person', 'Person'], ['place', 'Place'], ['trip', 'Trip']];
const TITLE = { person: 'a person', place: 'a place', trip: 'a trip' };
const fold = (s) => gaz.fold(String(s ?? ''));

let current = null;

/** Highlight a newly added row in the home lists. The shell redraws its lists as stories load, so the mark is re-applied for 3 s. */
export function highlight(id, doc = document) {
  const sel = [`.person[data-pin="${CSS.escape(String(id))}"]`, `[data-key="pin:${CSS.escape(String(id))}"]`, `[data-key="trip:${CSS.escape(String(id))}"]`].join(',');
  let first = true;
  const apply = () => {
    const el = doc.querySelector(sel);
    if (!el || el.classList.contains('pn-new')) return;
    el.classList.add('pn-new');
    if (first) { first = false; el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }
  };
  apply();
  const mo = new MutationObserver(apply);
  mo.observe(doc.body, { childList: true, subtree: true });
  setTimeout(() => { mo.disconnect(); doc.querySelectorAll('.pn-new').forEach((e) => e.classList.remove('pn-new')); }, 3000);
}

/**
 * Open the Add sheet. With `text` the fields open pre-filled from the parse and a place that is not settled waits for a choice;
 * with `kind` that kind's fields show directly; with neither it opens small.
 * @param {{kind?:'person'|'place'|'trip'|null, text?:string, pins?:object, gazetteer?:object, onAdded?:(r:object)=>void, onEdit?:(id:string)=>void, today?:()=>string, opener?:HTMLElement}} [o]
 */
export function openAddSheet(o = {}) { return openFlow({ mode: 'add', ...o }); }

/** Open the edit sheet for a pin or trip id. Returns null for an unknown id. */
export function openEditFlow(id, o = {}) {
  const item = (o.pins || defaultPins).get(id);
  return item ? openFlow({ mode: 'edit', id, item, ...o }) : null;
}

function openFlow({ mode, id = null, item = null, kind = null, text = '', pins = defaultPins, gazetteer = gaz, onAdded = null, onEdit = null, today = null } = {}) {
  current?.close?.('replaced');
  const edit = mode === 'edit';
  const isTrip = edit && item.label !== undefined;
  const todayStr = () => (today ? today() : todayISO());

  // ---- the draft: nothing here touches the store until Save ----
  const st = { kind: edit ? (isTrip ? 'trip' : item.kind === 'place' ? 'place' : 'person') : kind, name: '', city: null, group: '', newGroup: '', note: '', auto: false, nameAuto: '' };
  const dates = createDraft(edit && isTrip ? { start: item.start, end: item.end } : {});
  if (edit) { st.name = isTrip ? item.label : item.name; st.city = item.city; st.group = isTrip ? '' : item.group || ''; st.note = item.note || ''; }
  const initial = () => JSON.stringify([st.name, st.city?.id ?? '', st.city ? gaz.cityLabel(st.city) : '', st.group, st.newGroup, st.note, dates.value()]);
  let baseline = '';

  const root = h('div', { class: 'as' });
  const unTheme = themed(root);
  const slot = h('div', { class: 'as-slot' });
  const kindBar = edit ? null : h('div', { class: 'as-kinds', role: 'group', 'aria-label': 'What are you adding?' },
    KINDS.map(([k, label]) => h('button', { type: 'button', class: 'as-kind', 'data-kind-btn': k, 'aria-pressed': 'false', onclick: () => chooseKind(k) }, label)));
  root.append(...(kindBar ? [kindBar] : []), slot);

  let wantFocus = null, sheet = null, picker = null, drange = null, freeInput = null, confirming = false, settle = null, gone = false;
  const query = (sel) => sheet?.el.querySelector(sel);
  const resize = () => { if (sheet && !gone) sheet.resize(); };

  // ---- save rules ----
  const cityOk = () => !!st.city;
  const canSave = () => {
    if (!st.kind || !cityOk()) return false;
    if (st.kind === 'person') return !!st.name.trim();
    if (st.kind === 'trip') return dates.valid().ok;
    return true;
  };
  const updateSave = () => { const b = query('[data-action="save"]'); if (b) b.disabled = !canSave(); };
  const isDirty = () => (sheet && !confirming ? (freeInput && !st.kind ? !!freeInput.value.trim() : initial() !== baseline) : false);

  // ---- group chips ----
  function chips() {
    const wrap = h('div', { class: 'pn-chips', role: 'group', 'aria-label': 'Group' });
    const theme = store.get().theme === 'light' ? 'light' : 'dark';
    const paint = () => {
      wrap.replaceChildren();
      for (const g of pins.groups()) {
        const sw = h('span', { class: 'sw' }); sw.style.background = groupColor(g.hue, theme);
        wrap.append(h('button', { class: 'pn-chip', type: 'button', 'data-group': g.id, 'aria-pressed': st.group === g.id ? 'true' : 'false',
          onclick: () => { st.group = st.group === g.id ? '' : g.id; st.newGroup = ''; paint(); } }, sw, g.name));
      }
      const add = h('input', { class: 'pn-chip-input', type: 'text', placeholder: '+ New group', maxlength: 30, enterkeyhint: 'done', autocomplete: 'off', 'aria-label': 'New group name', value: st.newGroup });
      add.addEventListener('input', () => { st.newGroup = add.value; if (add.value.trim()) { st.group = ''; wrap.querySelectorAll('.pn-chip').forEach((c) => c.setAttribute('aria-pressed', 'false')); } });
      add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (canSave()) save(); } });
      wrap.append(add);
    };
    paint();
    return h('div', { class: 'pn-field' }, h('span', { text: 'Group' }), wrap);
  }

  // ---- the fields of one kind ----
  const nameLabel = () => (st.kind === 'trip' ? 'Label' : st.kind === 'place' ? 'Place name' : 'Name');
  function fields(focus) {
    const out = [];
    const name = h('input', { type: 'text', maxlength: 80, autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'next', spellcheck: 'false', 'data-f': 'name', value: st.name, placeholder: st.kind === 'place' ? 'Optional: defaults to the city' : '' });
    name.addEventListener('input', () => { st.name = name.value; updateSave(); maybeContract(); });
    out.push(h('label', { class: 'pn-field' }, h('span', { text: nameLabel() }), name));
    picker = mountCityPicker({
      value: st.city, label: st.kind === 'trip' ? 'Where' : st.kind === 'person' ? 'City' : 'Nearest city', gazetteer, reserve: true, engaged: !st.city && (focus === 'city' || (focus === 'auto' && st.kind !== 'trip')),
      placeholder: 'Search for a city or place', onLayout: resize, mapHold: true,
      onInput: () => { st.city = null; updateSave(); maybeContract(); },
      onPick: (c) => {
        st.city = c;
        if (st.kind === 'place' && (!st.name.trim() || st.name === st.nameAuto)) { st.name = c.name; st.nameAuto = c.name; name.value = c.name; }
        updateSave(); resize();
      },
    });
    out.push(picker.el);
    if (st.kind === 'trip') {
      const box = h('div', { class: 'as-dates' });
      out.push(box);
      drange = mountDateRange(box, dates, { onChange: () => { updateSave(); } });
    } else {
      out.push(chips());
      if (edit) {
        const note = h('textarea', { maxlength: 500, rows: 2, placeholder: 'Optional' }); note.value = st.note;
        note.addEventListener('input', () => { st.note = note.value; });
        out.push(h('label', { class: 'pn-field' }, h('span', { text: 'Note' }), note));
      }
    }
    if (edit) out.push(h('p', { class: 'as-confirm', 'data-confirm': '', hidden: true, role: 'alert' }));
    return { out, name };
  }

  function title() { return edit ? `Edit ${isTrip ? 'trip' : st.kind}` : st.kind ? `Add ${TITLE[st.kind]}` : 'Add'; }

  function paintKinds() { kindBar?.querySelectorAll('[data-kind-btn]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.kindBtn === st.kind ? 'true' : 'false')); }

  function showForm(focus = 'auto') {
    freeInput = null; drange = null;
    const { out, name } = fields(focus);
    slot.replaceChildren(...out);
    paintKinds(); sheet?.setTitle(title());
    // The expansion is one structural change: measured and animated once.
    if (sheet) { resize(); updateSave(); }
    const target = focus === 'name' ? name : focus === 'city' ? picker.input : (st.city || st.kind === 'trip' ? name : picker.input);
    wantFocus = focus === 'none' ? null : target;
    if (sheet && wantFocus) focusWanted();
  }
  function focusWanted() {
    const t = wantFocus; wantFocus = null;
    if (!t || gone) return;
    t.focus({ preventScroll: true });
    const n = t.value.length; try { t.setSelectionRange(n, n); } catch { /* not a text field */ }
  }

  function showFree(refocus = true) {
    st.kind = null; st.auto = false; picker = null; drange = null;
    freeInput = h('input', { type: 'text', class: 'as-free', autofocus: true, 'data-f': 'free', placeholder: 'Maya in Portland, or Trip: Tahoe', 'aria-label': 'Add a person, place or trip', enterkeyhint: 'done', autocomplete: 'off', autocapitalize: 'sentences', spellcheck: 'false' });
    freeInput.addEventListener('input', () => { clearTimeout(settle); if (freeInput.value.trim()) settle = setTimeout(expandFromFree, SETTLE_MS); });
    freeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); expandFromFree(); } });
    freeInput.addEventListener('paste', () => { setTimeout(expandFromFree, 0); });
    slot.replaceChildren(h('label', { class: 'pn-field' }, h('span', { class: 'sr', text: 'Add a person, place or trip' }), freeInput), h('p', { class: 'as-or', text: 'or press and hold the map' }));
    paintKinds(); sheet?.setTitle(title());
    if (sheet) { resize(); updateSave(); if (refocus) freeInput.focus({ preventScroll: true }); }
    baseline = initial();
  }

  /** Pre-fill the draft from a parse. A place that is not settled stays pending: the list shows the choices. */
  function fill(p) {
    st.kind = p.kind === 'home' ? 'place' : p.kind;
    st.auto = true; st.nameAuto = '';
    const q = (p.cityQuery || '').trim();
    st.name = st.kind === 'place' ? (p.name && fold(p.name) !== fold(q) ? p.name : '') : (p.name || '');
    st.city = null;
    if (p.group) { const g = pins.groups().find((x) => fold(x.name) === fold(p.group) || x.id === fold(p.group).replace(/ /g, '-')); if (g) st.group = g.id; else st.newGroup = p.group; }
    if (p.note) st.note = p.note;
    if (st.kind === 'trip' && p.trip) { dates.set('start', p.trip.start); dates.set('end', p.trip.end); }
    return q;
  }

  async function resolveInto(q) {
    if (!picker || !q) return;
    const p = picker;
    p.input.value = q;
    const r = await p.setQuery(q);
    if (gone || p !== picker) return;
    if (r.state === 'one') p.choose(r.city); // settled: exactly one place answers; otherwise the person chooses
    updateSave();
  }

  function expandFromFree() {
    clearTimeout(settle);
    if (!freeInput || gone) return;
    const t = freeInput.value.trim();
    if (!t) return;
    const q = fill(parseQuickAdd(t, todayStr()));
    showForm(q ? 'city' : 'name');
    if (q) { st.city = null; resolveInto(q); }
  }

  /** Clearing the text contracts the sheet again (only when it opened from text, never after a kind was chosen by hand). */
  function maybeContract() {
    if (!st.auto || edit) return;
    if (st.name.trim() || st.city || (picker && picker.input.value.trim())) return;
    showFree(true);
  }

  function chooseKind(k) {
    if (edit) return;
    if (st.kind === k) return;
    clearTimeout(settle);
    st.kind = k; st.auto = false;
    showForm(k === 'place' || k === 'trip' ? 'city' : 'name');
  }

  // ---- save, remove ----
  function save() {
    if (!canSave()) return;
    let gid = st.group;
    if (st.newGroup.trim() && st.kind !== 'trip') gid = pins.addGroup(st.newGroup) || '';
    const c = st.city;
    if (edit) {
      const ok = isTrip
        ? pins.update(id, { label: st.name.trim() || c.name, city: c, start: dates.value().start, end: dates.value().end })
        : pins.update(id, { name: st.name.trim() || c.name, city: c, group: gid, note: st.note, kind: st.kind });
      if (!ok) { const m = query('.dr-summary'); if (m) m.textContent = pins.lastError() || 'Could not save'; return; }
      closeNow('save');
      return;
    }
    let newId = null, summary = '', kindDone = st.kind;
    const where = gaz.cityLabel(c);
    if (st.kind === 'trip') {
      const label = st.name.trim() || c.name;
      newId = pins.addTrip({ label, city: c, start: dates.value().start, end: dates.value().end });
      summary = `${label} · ${where} · ${fmtRange(dates.value().start, dates.value().end)}`;
    } else {
      const nm = st.name.trim() || c.name;
      newId = pins.add({ kind: st.kind, name: nm, group: gid, city: c, note: st.note });
      summary = st.kind === 'person' ? `${nm} · ${where}` : (nm === c.name ? where : `${nm} · ${where}`);
    }
    if (!newId) return;
    closeNow('save');
    const r = { ok: true, kind: kindDone, id: newId, summary };
    addedToast(r, { pins, onEdit: onEdit || ((i) => openEditFlow(i, { pins, gazetteer }))});
    highlight(newId);
    onAdded?.(r);
  }

  function askRemove() {
    if (confirming) return;
    confirming = true;
    const label = st.name || (st.city && st.city.name) || 'this';
    const msg = query('[data-confirm]');
    if (msg) { msg.textContent = `Remove ${label}? You can undo for 5 seconds.`; msg.hidden = false; }
    sheet.setActions([
      { id: 'keep', label: 'Keep', kind: 'secondary', onClick: () => { confirming = false; if (msg) msg.hidden = true; sheet.setActions(actionsFor()); resize(); } },
      { id: 'remove-confirm', label: `Remove ${label}`, kind: 'danger', onClick: () => doRemove(label) },
    ]);
    resize();
  }
  function doRemove(label) {
    const undo = pins.remove(id);
    closeNow('remove');
    removedToast(label, undo);
  }

  function closeNow(reason) { confirming = false; sheet?.close(reason); }

  function actionsFor() {
    const a = [];
    if (edit) a.push({ id: 'remove', label: 'Remove', kind: 'danger', onClick: askRemove });
    a.push({ id: 'cancel', label: 'Cancel', kind: 'secondary', onClick: () => query('.wse-sheet-close')?.click() });
    a.push({ id: 'save', label: edit ? 'Save' : 'Add', kind: 'primary', disabled: true, onClick: save });
    return a;
  }

  // ---- open: the first render happens before the sheet measures itself, so the opening height already includes it ----
  let pendingQuery = '';
  if (edit) showForm('none');
  else if (text.trim()) { pendingQuery = fill(parseQuickAdd(text, todayStr())); if (kind) st.kind = kind; showForm(pendingQuery ? 'city' : 'name'); }
  else if (kind) { st.kind = kind; showForm('name'); }
  else showFree(false);
  baseline = text.trim() && !edit ? '[]' : initial();
  const handle = { close: (r) => sheet.close(r), get state() { return { ...st }; }, save };
  sheet = openSheet({
    title: title(), content: root, actions: actionsFor(), isDirty,
    onClose: () => { gone = true; clearTimeout(settle); unTheme(); drange = null; if (current === handle) current = null; },
  });
  handle.sheet = sheet;
  current = handle;
  sheet.ready.then(async () => {
    if (gone) return;
    updateSave();
    if (freeInput && !st.kind) freeInput.focus({ preventScroll: true });
    else focusWanted();
    if (pendingQuery) await resolveInto(pendingQuery);
  });
  return handle;
}
