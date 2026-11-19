// City picker: a text field with tappable matches. Used by the edit sheet and "set your home".
import { h } from './dom.js';
import * as gaz from './gazetteer.js';

/**
 * @param {{value?:object|null, onPick:(city:object)=>void, label?:string, placeholder?:string, gazetteer?:object}} o
 * @returns {{el:HTMLElement, input:HTMLInputElement, setValue:(city:object)=>void}}
 */
export function mountCityPicker({ value = null, onPick, label = 'City', placeholder = 'Search for a city', gazetteer = gaz } = {}) {
  const input = h('input', { type: 'text', placeholder, autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'search', 'aria-label': label, spellcheck: 'false' });
  const list = h('div', { class: 'pn-suggest', role: 'listbox' });
  const msg = h('div', { class: 'pn-msg', role: 'status' });
  const el = h('label', { class: 'pn-field' }, h('span', { text: label }), input, list, msg);
  let seq = 0, found = [];
  const setValue = (c) => { input.value = c ? gaz.cityLabel(c) : ''; list.replaceChildren(); msg.textContent = ''; };
  if (value) setValue(value);
  const pick = (c) => { setValue(c); onPick(c); };
  input.addEventListener('focus', () => input.select());
  input.addEventListener('input', async () => {
    const q = input.value.trim(); const my = ++seq;
    if (q.length < 2) { list.replaceChildren(); msg.textContent = ''; found = []; return; }
    found = await gazetteer.search(q, 5);
    if (my !== seq) return;
    list.replaceChildren(...found.map((c) => h('button', { type: 'button', role: 'option', onclick: () => pick(c) }, h('span', { text: gaz.cityLabel(c) }))));
    msg.textContent = found.length ? '' : `No city called ${q}. Try a nearby town.`;
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (found[0]) pick(found[0]); } });
  return { el, input, setValue };
}
