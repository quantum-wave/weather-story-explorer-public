// City picker: a text field with a reserved list of tappable matches. Used by the add and edit sheet, the inline box's
// suggestions and "set your home". It never picks for the person: a name that more than one place answers to (Tahoe,
// Portland) waits for a choice; Enter accepts only when exactly one place matches (design spec 8.2, UX-6). A typo match
// ("coastanoa" -> Costanoa) is a suggestion, never settled. When nothing matches, it offers "Search online" (online.js): a
// button the person presses, never a request made by itself.
import { h } from './dom.js';
import * as gaz from './gazetteer.js';
import { searchOnline, UNAVAILABLE } from './online.js';

export const ROWS = 5;
let viaSeq = 0; // a per-offer id, so two open pickers never share one
const KIND_WORD = { region: 'region', resort: 'ski area', park: 'park', lodge: 'lodge', town: '', city: '' };

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
  if (found[0].fuzzy) return { state: 'choose', found, fuzzy: true }; // a guess at a typo waits for the person
  const several = found.length > 1 && (gazetteer.ambiguous ? gazetteer.ambiguous(q) : true);
  if (several) return { state: 'choose', found };
  return { state: 'one', city: found[0], found };
}

/** One match row: the name, the state or country, and "region" for curated entries. */
export function matchRow(c, onPick) {
  const word = kindWord(c);
  return h('button', { type: 'button', role: 'option', class: 'pn-opt', 'data-id': String(c.id), onclick: () => onPick(c) },
    h('span', { class: 'pn-opt-name', text: c.name }),
    h('span', { class: 'pn-opt-sub', text: gaz.regionLabel(c) + (word ? ' · ' + word : '') + (c.online ? ' · found online' : '') }));
}

/** What the picker says when nothing in the bundled list matches `q` (typo matches included). */
export const noneText = (q) => `No place called ${q} in the built-in list.`;
/** The way on from there: holding the map only where the map can take a pin (`mapHold`). */
export const elseText = (mapHold) => (mapHold ? 'Or press and hold the map to drop a pin there.' : 'Or try a nearby town.');
const elseAfterOnline = (mapHold) => (mapHold ? 'Try a nearby town, or press and hold the map to drop a pin there.' : 'Try a nearby town.');

/**
 * @param {{value?:object|null, onPick:(city:object)=>void, onInput?:(text:string)=>void, label?:string, placeholder?:string,
 *   gazetteer?:object, reserve?:boolean, hint?:string, onLayout?:()=>void, mapHold?:boolean, online?:((text:string)=>Promise<{ok:boolean, places?:object[]}>)|null}} o
 *   reserve: keep a list area of five rows, even when empty. mapHold: the map behind can take a pin, so say so when nothing
 *   matches. online: the "Search online" lookup (online.js); null offers no button.
 * @returns {{el:HTMLElement, input:HTMLInputElement, setValue:(city:object|null)=>void, choose:(city:object)=>void, setQuery:(text:string)=>Promise<object>,
 *   city:()=>object|null, list:HTMLElement}}
 */
export function mountCityPicker({ value = null, onPick, onInput = null, label = 'City', placeholder = 'Search for a city', gazetteer = gaz, reserve = false, hint = 'Matches appear here', onLayout = null, engaged: engagedAtStart = false, mapHold = false, online = searchOnline } = {}) {
  const input = h('input', { type: 'text', placeholder, autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'search', 'aria-label': label, spellcheck: 'false', 'data-f': 'city', role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list' });
  const list = h('div', { class: 'pn-suggest' + (reserve && engagedAtStart ? ' reserved' : ''), role: 'listbox', 'aria-label': label + ' matches' });
  // Shown in the list's place when nothing matches: the "Search online" offer and the other ways on. Outside the listbox,
  // which holds only options.
  const offer = h('div', { class: 'pn-online', hidden: true });
  const msg = h('div', { class: 'pn-msg' + (reserve && engagedAtStart ? ' reserved' : ''), role: 'status' });
  const el = h('label', { class: 'pn-field' }, h('span', { text: label }), input, list, offer, msg);
  let seq = 0, found = [], chosen = null, active = -1;
  let shown = false, ready = false, engaged = engagedAtStart;
  const layout = () => { const now = list.childElementCount > 0; if (now !== shown) { shown = now; if (ready) onLayout?.(); } };
  const rows = () => [...list.querySelectorAll('[role=option]')];
  const paintActive = () => rows().forEach((b, i) => b.classList.toggle('active', i === active));
  const showHint = (t) => { list.replaceChildren(...(reserve && engaged && t ? [h('div', { class: 'pn-hint', text: t })] : [])); input.setAttribute('aria-expanded', 'false'); layout(); };
  const hideOffer = () => { if (offer.hidden) return; offer.hidden = true; offer.replaceChildren(); list.hidden = false; if (ready) onLayout?.(); };
  const showOffer = (...kids) => {
    list.replaceChildren(); list.hidden = true; input.setAttribute('aria-expanded', 'false');
    offer.replaceChildren(...kids); offer.classList.toggle('reserved', reserve && engaged);
    const was = offer.hidden; offer.hidden = false; shown = false;
    if (was && ready) onLayout?.();
  };
  const note = (t) => h('p', { class: 'pn-online-note', text: t });
  const lead = (t) => h('p', { class: 'pn-online-lead', role: 'status', text: t });
  const setValue = (c) => { chosen = c || null; input.value = c ? gaz.cityLabel(c) : ''; found = []; active = -1; hideOffer(); showHint(reserve && !c ? hint : ''); msg.textContent = ''; };
  if (value) setValue(value);
  else showHint(hint);
  shown = list.childElementCount > 0; ready = true;
  const pick = (c) => { setValue(c); onPick(c); };
  const showRows = () => { hideOffer(); list.replaceChildren(...found.map((c) => matchRow(c, pick))); input.setAttribute('aria-expanded', found.length ? 'true' : 'false'); layout(); };

  // Nothing matched, typos included: offer the online search (only when the person presses it) and the other ways on.
  function offerOnline(q) {
    if (!online) { showOffer(lead(noneText(q)), note(elseAfterOnline(mapHold))); return; }
    const btn = h('button', { type: 'button', class: 'pn-btn pn-online-btn', text: 'Search online', onclick: () => goOnline(q, btn) });
    // the typed name goes to a third party: say so beside the button, and tie the words to it for screen readers
    const via = h('p', { class: 'pn-online-via', id: 'pn-online-via-' + (++viaSeq), text: '(via Open-Meteo: the name you typed is sent to them)' });
    btn.setAttribute('aria-describedby', via.id);
    showOffer(lead(noneText(q)), btn, via, note(elseText(mapHold)));
  }
  async function goOnline(q, btn) {
    const my = seq;
    btn.disabled = true; btn.textContent = 'Searching online…';
    const r = await online(q);
    if (my !== seq) return; // typed on since: that query owns the list now
    if (!r || !r.ok) { showOffer(lead(UNAVAILABLE), note(elseAfterOnline(mapHold))); return; }
    if (!r.places.length) { showOffer(lead(`Nothing online is called ${q} either.`), note(elseAfterOnline(mapHold))); return; }
    found = r.places; active = -1; showRows();
    msg.textContent = found.length > 1 ? 'Found online. Choose one.' : 'Found online.';
  }

  async function setQuery(text) {
    const q = String(text ?? '').trim(); const my = ++seq;
    if (q.length < 2) { found = []; active = -1; hideOffer(); showHint(hint); msg.textContent = ''; return { state: 'none', found }; }
    const r = await resolvePlace(q, gazetteer, ROWS);
    if (my !== seq) return r;
    found = r.found; active = -1;
    if (found.length) showRows();
    else offerOnline(q);
    msg.textContent = !found.length ? '' : r.fuzzy ? (found.length > 1 ? 'Did you mean one of these?' : `Did you mean ${found[0].name}?`) : r.state === 'choose' ? 'More than one place matches. Choose one.' : '';
    return r;
  }
  const engage = () => { if (!reserve || engaged) return; engaged = true; if (!list.childElementCount) showHint(hint); list.classList.add('reserved'); msg.classList.add('reserved'); offer.classList.toggle('reserved', !offer.hidden); };
  input.addEventListener('focus', () => { engage(); if (chosen) input.select(); });
  input.addEventListener('input', () => { engage(); chosen = null; onInput?.(input.value); setQuery(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const n = rows().length; if (!n) return;
      e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; paintActive(); rows()[active].scrollIntoView?.({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && found[active]) pick(found[active]);
      else if (found.length === 1 && !found[0].fuzzy) pick(found[0]); // exactly one match: Enter accepts it. Several, or a typo guess: nothing until one is chosen.
    }
  });
  return { el, input, setValue, choose: pick, setQuery, city: () => chosen, list };
}
