// The quick-add field: one box for people, places, trips, a home, or several pasted lines (design spec 8.2). It adds directly only
// when the parse is complete and the place is settled; anything else (a place several matches answer to, a trip without dates)
// opens the Add sheet with the fields filled and the choice pending. It never picks a place for the person.
import { h, themed } from './dom.js';
import { pins as defaultPins } from './index.js';
import * as gaz from './gazetteer.js';
import { parseQuickAdd } from './quickadd.js';
import { addedToast } from './toast.js';
import { resolvePlace, matchRow } from './picker.js';
import { openAddSheet as defaultOpenAdd, highlight } from './addsheet.js';

const PLACEHOLDER = 'Add someone: Maya in Portland, OR';

/**
 * @param {HTMLElement} root container; the field is built inside it
 * @param {{pins?:object, gazetteer?:object, onAdded?:(r:object)=>void, onEdit?:(id:string)=>void, openAdd?:(o:object)=>any, placeholder?:string, today?:()=>string}} [o]
 * @returns {{destroy:()=>void, focus:()=>void, submit:()=>Promise<object>, textarea:HTMLTextAreaElement}}
 */
export function mountQuickAdd(root, { pins = defaultPins, gazetteer = gaz, onAdded = null, onEdit = null, openAdd = null, placeholder = PLACEHOLDER, today } = {}) {
  const ta = h('textarea', { rows: 1, placeholder, enterkeyhint: 'done', autocomplete: 'off', autocapitalize: 'sentences', spellcheck: 'false', 'aria-label': 'Add a person, place or trip' });
  const btn = h('button', { class: 'pn-btn primary', type: 'submit' }, 'Add');
  const more = h('button', { class: 'pn-btn quiet pn-more', type: 'button', 'data-act': 'details' }, 'Add with details');
  const sug = h('div', { class: 'pn-suggest', role: 'listbox', 'aria-label': 'Place matches' });
  const msg = h('div', { class: 'pn-msg', role: 'status' });
  const form = h('form', { class: 'pn-qa', novalidate: true }, h('div', { class: 'pn-qa-row' }, ta, btn), sug, h('div', { class: 'pn-qa-more' }, more), msg);
  const un = themed(form);
  root.append(form);

  let seq = 0, busy = false, timer = null;
  const opts = () => (today ? { today: today() } : {});
  const grow = () => { ta.style.height = 'auto'; ta.style.overflowY = 'hidden'; const need = ta.scrollHeight + 2; ta.style.height = Math.min(need, 140) + 'px'; ta.style.overflowY = need > 140 ? 'auto' : 'hidden'; };
  const say = (t, warn = false) => { msg.className = 'pn-msg' + (warn ? ' warn' : ''); msg.replaceChildren(t); };
  const clearSug = () => { sug.replaceChildren(); };
  // Empty the box once what it held is added: the text, the message and the match list, and any lookup still in flight (bumping
  // seq drops its answer), so no stale choice is left to add the same thing twice.
  const clearBox = () => { clearTimeout(timer); seq++; ta.value = ''; grow(); say(''); clearSug(); };
  // The Add sheet opened from the box (a place to choose, a trip without dates, "Add with details") reports back through onAdded:
  // when it adds, the box it came from is cleared. If the sheet is dismissed instead, the text stays to be fixed.
  const sheet = (o) => {
    const x = { ...o, onAdded: (r) => { clearBox(); onAdded?.(r); } };
    return openAdd ? openAdd(x) : defaultOpenAdd({ pins, gazetteer, onEdit, ...(today ? { today } : {}), ...x });
  };

  /**
   * The matches for the place part of the line, shown as the person types: several when there is a choice to make (nothing is
   * added until one is chosen), or the one place the line has settled on, so "North Lake Tahoe" is seen to be found before Add.
   * Choosing a row adds that place.
   */
  async function refreshSuggestions() {
    const my = ++seq;
    const text = ta.value;
    if (!text.trim() || /\n/.test(text.trim())) { clearSug(); return; }
    const q = (parseQuickAdd(text, today?.()).cityQuery || '').trim();
    if (q.length < 2) { clearSug(); return; }
    const r = await resolvePlace(q, gazetteer);
    if (my !== seq) return;
    sug.replaceChildren(...(r.state === 'choose' ? r.found : r.state === 'one' ? [r.city] : []).map((c) => matchRow(c, (city) => submit({ city }))));
    revealSuggestions();
  }

  /**
   * Bring the match list into view while the person is typing in the box. On desktop the box sits at the bottom edge of the
   * panel, so the list it grows opens below the fold and the place looks missing (Josh point 2). Only the nearest scrolling
   * ancestor moves (never an overflow:hidden shell or the page, as scrollIntoView would), only as far as the last row needs,
   * and never so far that the box itself leaves the top. The keyboard on a phone shrinks the visible area: use the visual viewport.
   */
  function revealSuggestions() {
    const last = sug.lastElementChild;
    if (!last || document.activeElement !== ta) return;
    let sc = form.parentElement;
    while (sc && sc !== document.body) {
      const oy = getComputedStyle(sc).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && sc.scrollHeight > sc.clientHeight) break;
      sc = sc.parentElement;
    }
    if (!sc || sc === document.body) return;
    const box = sc.getBoundingClientRect(), vv = window.visualViewport;
    const bottom = Math.min(box.top + sc.clientHeight, vv ? vv.offsetTop + vv.height : innerHeight);
    const top = Math.max(box.top, vv ? vv.offsetTop : 0);
    const need = last.getBoundingClientRect().bottom + 8 - bottom;
    if (need <= 0) return;
    const by = Math.min(need, ta.getBoundingClientRect().top - top - 8);
    if (by <= 0) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    sc.scrollBy({ top: by, behavior: still ? 'auto' : 'smooth' });
  }

  /** Several lines at once. A line whose place is not settled stays in the box to be fixed: nothing is picked for it. */
  async function pasteBulk(lines) {
    let added = 0, duplicates = 0;
    const left = [];
    for (const line of lines) {
      const p = parseQuickAdd(line, today?.());
      const q = (p.cityQuery || '').trim();
      if (!q) { left.push({ line, reason: 'no place' }); continue; }
      const r = await resolvePlace(q, gazetteer);
      if (r.state === 'none') { left.push({ line, reason: `no place called ${q}` }); continue; }
      if (r.state === 'choose') { left.push({ line, reason: `which ${q}? add it on its own and choose` }); continue; }
      const res = await pins.quickAdd(line, { ...opts(), city: r.city, dedupe: true });
      if (res.ok) added++;
      else if (res.reason === 'duplicate') duplicates++;
      else left.push({ line, reason: res.reason === 'dates' ? 'trip needs dates (like Nov 27-30)' : res.reason === 'name' ? 'no name' : 'not understood' });
    }
    return { bulk: true, ok: added > 0, added, duplicates, unresolved: left };
  }

  function showBulk(r) {
    ta.value = r.unresolved.map((u) => u.line).join('\n');
    const parts = [`Added ${r.added}.`];
    if (r.duplicates) parts.push(`${r.duplicates} already here.`);
    if (r.unresolved.length) {
      const ul = h('ul', {}, r.unresolved.map((u) => h('li', {}, h('b', { text: u.line }), ' · ' + u.reason)));
      msg.className = 'pn-msg warn'; msg.replaceChildren(parts.join(' ') + ` ${r.unresolved.length} to fix, left in the box:`, ul);
    } else say(parts.join(' '));
    grow();
  }

  /** Add what the box holds, or open the sheet for what it cannot settle. Returns {ok} or {ok:false, reason, sheet?}. */
  async function submit(extra = {}) {
    const raw = ta.value.trim();
    if (!raw || busy) return { ok: false, reason: 'empty' };
    busy = true; btn.disabled = true;
    try {
      const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length > 1) {
        const r = await pasteBulk(lines);
        showBulk(r); clearSug();
        if (r.added) onAdded?.(r);
        return r;
      }
      const p = parseQuickAdd(raw, today?.());
      let city = extra.city || null;
      const q = (p.cityQuery || '').trim();
      if (!city) {
        if (!q) { say(p.kind === 'person' ? 'Add a name and a city, like: Maya in Portland, OR' : 'Add a place first, like: Lisbon', true); return { ok: false, reason: 'no-city' }; }
        const r = await resolvePlace(q, gazetteer);
        if (r.state === 'none') { say(`No place called ${q}. Try a nearby town or press and hold the map.`, true); return { ok: false, reason: 'no-city', query: q }; }
        if (r.state === 'choose') {
          if (p.kind === 'home') { say('More than one place matches. Choose one below.', true); return { ok: false, reason: 'choose' }; }
          sheet({ text: raw }); say(''); return { ok: false, reason: 'choose', sheet: true };
        }
        city = r.city;
      }
      if (p.kind === 'trip' && !p.trip) { sheet({ text: raw, kind: 'trip' }); say(''); return { ok: false, reason: 'dates', sheet: true }; }
      let line = raw;
      // A place typed as just a name ("Tahoe") and then chosen from the list takes the chosen place's name.
      if (extra.city && p.kind === 'place' && p.name === p.cityQuery) { const k = raw.lastIndexOf(p.cityQuery); if (k >= 0) line = raw.slice(0, k) + gaz.cityLabel(city); }
      const r = await pins.quickAdd(line, { ...opts(), city });
      if (r.ok) { clearBox(); addedToast(r, { pins, onEdit }); if (r.id) highlight(r.id); onAdded?.(r); return r; }
      say(r.reason === 'name' ? 'Add a name first, like: Maya in Portland, OR' : 'Could not add that.', true);
      return r;
    } finally { busy = false; btn.disabled = false; }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
  ta.addEventListener('input', () => { grow(); say(''); clearTimeout(timer); timer = setTimeout(refreshSuggestions, 90); });
  ta.addEventListener('paste', (e) => {
    const t = e.clipboardData?.getData('text') || '';
    if (t.split(/\r?\n/).filter((l) => l.trim()).length > 1) { e.preventDefault(); ta.value = t.trim(); grow(); submit(); }
  });
  more.addEventListener('click', () => { const t = ta.value.trim(); sheet(t ? { text: t } : {}); });
  grow();
  return { destroy() { un(); form.remove(); clearTimeout(timer); }, focus: () => ta.focus(), submit, textarea: ta };
}
