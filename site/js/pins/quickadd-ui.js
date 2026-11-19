// The quick-add field: one box for people, places, trips, a home, or several pasted lines (SPEC section 5).
import { h, themed } from './dom.js';
import { pins as defaultPins } from './index.js';
import * as gaz from './gazetteer.js';
import { parseQuickAdd } from './quickadd.js';
import { addedToast } from './toast.js';

const PLACEHOLDER = 'Add someone: Maya in Portland';

/**
 * @param {HTMLElement} root container; the field is built inside it
 * @param {{pins?:object, gazetteer?:object, onAdded?:(r:object)=>void, onEdit?:(id:string)=>void, placeholder?:string, today?:()=>string}} [o]
 * @returns {{destroy:()=>void, focus:()=>void, submit:()=>Promise<object>, textarea:HTMLTextAreaElement}}
 */
export function mountQuickAdd(root, { pins = defaultPins, gazetteer = gaz, onAdded = null, onEdit = null, placeholder = PLACEHOLDER, today } = {}) {
  const ta = h('textarea', { rows: 1, placeholder, enterkeyhint: 'done', autocomplete: 'off', autocapitalize: 'sentences', spellcheck: 'false', 'aria-label': 'Add a person, place or trip' });
  const btn = h('button', { class: 'pn-btn primary', type: 'submit' }, 'Add');
  const sug = h('div', { class: 'pn-suggest', role: 'listbox', 'aria-label': 'City matches' });
  const msg = h('div', { class: 'pn-msg', role: 'status' });
  const dFrom = h('input', { type: 'date', 'aria-label': 'Trip start' });
  const dTo = h('input', { type: 'date', 'aria-label': 'Trip end' });
  const addTrip = h('button', { class: 'pn-btn primary', type: 'button' }, 'Add trip');
  const dates = h('div', { class: 'pn-dates', hidden: true }, h('label', {}, 'From', dFrom), h('label', {}, 'To', dTo), addTrip);
  const form = h('form', { class: 'pn-qa', novalidate: true }, h('div', { class: 'pn-qa-row' }, ta, btn), sug, dates, msg);
  const un = themed(form);
  root.append(form);

  let seq = 0, matches = [], pendingTrip = null, busy = false, timer = null;
  const opts = () => (today ? { today: today() } : {});
  const grow = () => { ta.style.height = 'auto'; ta.style.overflowY = 'hidden'; const need = ta.scrollHeight + 2; ta.style.height = Math.min(need, 140) + 'px'; ta.style.overflowY = need > 140 ? 'auto' : 'hidden'; };
  const say = (t, warn = false) => { msg.className = 'pn-msg' + (warn ? ' warn' : ''); msg.replaceChildren(t); };
  const clearSug = () => { sug.replaceChildren(); matches = []; };

  async function refreshSuggestions() {
    const my = ++seq;
    const text = ta.value;
    if (!text.trim() || /\n/.test(text.trim())) { clearSug(); return; }
    const p = parseQuickAdd(text, today?.());
    const q = (p.cityQuery || '').trim();
    if (q.length < 2) { clearSug(); return; }
    const found = await gazetteer.search(q, 4);
    if (my !== seq) return;
    matches = found;
    // With one clear match the Enter key is enough; show alternatives only when there is a choice.
    sug.replaceChildren(...(found.length > 1 || (found.length === 1 && gaz.fold(found[0].name) !== gaz.fold(q))
      ? found.map((c) => h('button', { type: 'button', role: 'option', onclick: () => submit({ city: c }) }, h('span', { text: gaz.cityLabel(c) })))
      : []));
  }

  function showResult(r, raw) {
    if (r.bulk) {
      ta.value = r.unresolved.map((u) => u.line).join('\n');
      const parts = [`Added ${r.added}.`];
      if (r.duplicates) parts.push(`${r.duplicates} already here.`);
      if (r.unresolved.length) {
        const ul = h('ul', {}, r.unresolved.map((u) => h('li', {}, h('b', { text: u.line }), ' · ' + u.reason)));
        msg.className = 'pn-msg warn'; msg.replaceChildren(parts.join(' ') + ` ${r.unresolved.length} to fix, left in the box:`, ul);
      } else say(parts.join(' '));
      grow();
      return;
    }
    if (r.ok) { ta.value = ''; grow(); say(''); dates.hidden = true; pendingTrip = null; addedToast(r, { pins, onEdit }); return; }
    if (r.reason === 'no-city') { say(`No city called ${r.query}. Try a nearby town or press and hold the map.`, true); return; }
    if (r.reason === 'dates') {
      pendingTrip = raw; dates.hidden = false; say('When is it? Pick dates, or type them: Trip: Tahoe Nov 27-30', true); dFrom.focus(); return;
    }
    say(r.reason === 'name' ? 'Add a name first, like: Maya in Portland' : 'Could not add that.', true);
  }

  async function submit(extra = {}) {
    const raw = ta.value.trim();
    if (!raw || busy) return { ok: false, reason: 'empty' };
    busy = true; btn.disabled = true;
    try {
      const r = await pins.quickAdd(raw, { ...opts(), ...extra });
      showResult(r, raw);
      if (r.ok && !r.bulk) { clearSug(); onAdded?.(r); }
      else if (r.bulk) { clearSug(); if (r.added) onAdded?.(r); }
      return r;
    } finally { busy = false; btn.disabled = false; }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
  ta.addEventListener('input', () => { grow(); say(''); dates.hidden = true; clearTimeout(timer); timer = setTimeout(refreshSuggestions, 90); });
  ta.addEventListener('paste', (e) => {
    const t = e.clipboardData?.getData('text') || '';
    if (t.split(/\r?\n/).filter((l) => l.trim()).length > 1) {
      e.preventDefault();
      ta.value = t.trim(); grow();
      submit();
    }
  });
  addTrip.addEventListener('click', async () => {
    if (!dFrom.value) { say('Pick a start date.', true); dFrom.focus(); return; }
    const r = await submit({ trip: { start: dFrom.value, end: dTo.value && dTo.value >= dFrom.value ? dTo.value : dFrom.value } });
    if (r?.ok) { dFrom.value = ''; dTo.value = ''; }
  });
  grow();
  return { destroy() { un(); form.remove(); clearTimeout(timer); }, focus: () => ta.focus(), submit, textarea: ta };
}
