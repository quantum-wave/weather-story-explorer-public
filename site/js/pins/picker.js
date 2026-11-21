// City picker: a text field with a reserved list of tappable matches. Used by the add and edit sheet, the inline box's
// suggestions and "set your home". It never picks for the person: a name that more than one place answers to (Tahoe,
// Portland) waits for a choice; Enter accepts only when exactly one place matches (design spec 8.2, UX-6).
import { h } from './dom.js';
import * as gaz from './gazetteer.js';

export const ROWS = 5;
const KIND_WORD = { region: 'region', resort: 'ski area', park: 'park', town: '', city: '' };

/** The small word after a place's region: "region" for curated entries that are not cities, else nothing. */
export const kindWord = (c) => (c && c.kind && c.kind in KIND_WORD ? KIND_WORD[c.kind] : c && c.kind ? String(c.kind) : '');

/**
 * What a query means. state 'none' (no place), 'one' (settled: exactly one match, or a name nothing else shares), or 'choose'
 * (several places answer; nothing is chosen until the person chooses). `found` always holds the matches, best first.
 * @returns {Promise<{state:'none'|'one'|'choose', city?:object, found:object[]}>}
 */
export async function resolvePlace(q, gazetteer = gaz, n = ROWS) {
  const found = await gazetteer.search(q, n);
  if (!found.length) return { state: 'none', found };
  const several = found.length > 1 && (gazetteer.ambiguous ? gazetteer.ambiguous(q) : true);
  if (several) return { state: 'choose', found };
  return { state: 'one', city: found[0], found };
}

/** One match row: the name, the state or country, and "region" for curated entries. */
export function matchRow(c, onPick) {
  const word = kindWord(c);
  return h('button', { type: 'button', role: 'option', class: 'pn-opt', 'data-id': String(c.id), onclick: () => onPick(c) },
    h('span', { class: 'pn-opt-name', text: c.name }),
    h('span', { class: 'pn-opt-sub', text: gaz.regionLabel(c) + (word ? ' · ' + word : '') }));
}

/**
 * @param {{value?:object|null, onPick:(city:object)=>void, onInput?:(text:string)=>void, label?:string, placeholder?:string,
 *   gazetteer?:object, reserve?:boolean, hint?:string, onLayout?:()=>void}} o  reserve: keep a list area of five rows, even when empty
 * @returns {{el:HTMLElement, input:HTMLInputElement, setValue:(city:object|null)=>void, choose:(city:object)=>void, setQuery:(text:string)=>Promise<object>,
 *   city:()=>object|null, list:HTMLElement}}
 */
export function mountCityPicker({ value = null, onPick, onInput = null, label = 'City', placeholder = 'Search for a city', gazetteer = gaz, reserve = false, hint = 'Matches appear here', onLayout = null, engaged: engagedAtStart = false } = {}) {
  const input = h('input', { type: 'text', placeholder, autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'search', 'aria-label': label, spellcheck: 'false', 'data-f': 'city', role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list' });
  const list = h('div', { class: 'pn-suggest' + (reserve && engagedAtStart ? ' reserved' : ''), role: 'listbox', 'aria-label': label + ' matches' });
  const msg = h('div', { class: 'pn-msg' + (reserve && engagedAtStart ? ' reserved' : ''), role: 'status' });
  const el = h('label', { class: 'pn-field' }, h('span', { text: label }), input, list, msg);
  let seq = 0, found = [], chosen = null, active = -1;
  let shown = false, ready = false, engaged = engagedAtStart;
  const layout = () => { const now = list.childElementCount > 0; if (now !== shown) { shown = now; if (ready) onLayout?.(); } };
  const rows = () => [...list.querySelectorAll('[role=option]')];
  const paintActive = () => rows().forEach((b, i) => b.classList.toggle('active', i === active));
  const showHint = (t) => { list.replaceChildren(...(reserve && engaged && t ? [h('div', { class: 'pn-hint', text: t })] : [])); input.setAttribute('aria-expanded', 'false'); layout(); };
  const setValue = (c) => { chosen = c || null; input.value = c ? gaz.cityLabel(c) : ''; found = []; active = -1; showHint(reserve && !c ? hint : ''); msg.textContent = ''; };
  if (value) setValue(value);
  else showHint(hint);
  shown = list.childElementCount > 0; ready = true;
  const pick = (c) => { setValue(c); onPick(c); };
  async function setQuery(text) {
    const q = String(text ?? '').trim(); const my = ++seq;
    if (q.length < 2) { found = []; active = -1; showHint(hint); msg.textContent = ''; return { state: 'none', found }; }
    const r = await resolvePlace(q, gazetteer, ROWS);
    if (my !== seq) return r;
    found = r.found; active = -1;
    list.replaceChildren(...found.map((c) => matchRow(c, pick)));
    input.setAttribute('aria-expanded', found.length ? 'true' : 'false');
    layout();
    if (!found.length) showHint(hint);
    msg.textContent = found.length ? (r.state === 'choose' ? 'More than one place matches. Choose one.' : '') : `No place called ${q}. Try a nearby town.`;
    return r;
  }
  const engage = () => { if (!reserve || engaged) return; engaged = true; if (!list.childElementCount) showHint(hint); list.classList.add('reserved'); msg.classList.add('reserved'); };
  input.addEventListener('focus', () => { engage(); if (chosen) input.select(); });
  input.addEventListener('input', () => { engage(); chosen = null; onInput?.(input.value); setQuery(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const n = rows().length; if (!n) return;
      e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; paintActive(); rows()[active].scrollIntoView?.({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && found[active]) pick(found[active]);
      else if (found.length === 1) pick(found[0]); // exactly one match: Enter accepts it. Several: nothing until one is chosen.
    }
  });
  return { el, input, setValue, choose: pick, setQuery, city: () => chosen, list };
}
