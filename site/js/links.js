// Deep links (SPEC section 7). Grammar lives in share/hashgrammar.js; this file ties it to the store.
//   formatHash(state)  -> '#np-zj-2026112212-sf'   (never a person's name or place)
//   parseHash(hash)    -> parts or null
//   applyHash(hash)    -> sets the store from a link, snapping the time to a real step; returns {applied, snapped, notice}
//   installLinks()     -> applies the opening hash, mirrors state into the hash (<= 2 per second), listens for hashchange
//   copyLink()         -> copies canonicalUrl + hash; true on success
import { store } from './state.js';
import * as data from './data/index.js';
import { isReservedHash } from './contract.js';
import { buildHash, parseHash as parseGrammar, placeToken, placeIdOf, utcStamp, dateOfStamp, SF_FOCUS } from './share/hashgrammar.js';
import { activeField, nearestStep } from './share/meta.js';
import { formatValid } from './share/format.js';

export { parseGrammar as parseHash };

const HOUR = 3600e3;

/** The valid time (UTC hour stamp) a link should carry for forecast hour t, snapped to a real step of the layer's field. */
function stampFor(state) {
  const field = activeField(state);
  const ns = nearestStep(field, state.t);
  const t = ns ? ns.step : state.t;
  return utcStamp(new Date(Math.round(data.validTime(t).getTime() / HOUR) * HOUR));
}

/** State -> hash. A person's pin (focus.kind 'person', or no numeric gazetteer placeRef) contributes no place. */
export function formatHash(state = store.get()) {
  const f = state.focus;
  const place = f && f.kind !== 'person' ? placeToken(f.placeRef) : null;
  return buildHash({ view: state.view, layers: state.layers, validTime: stampFor(state), place });
}

/** Resolve a place token to a focus. 'sf' is built in; other ids need `gazetteer.byId` (optional, see report). */
async function resolvePlace(token) {
  if (token === 'sf') return { ...SF_FOCUS };
  const id = placeIdOf(token);
  if (id == null) return null;
  try {
    const mod = await import('./pins/gazetteer.js');
    const city = await mod.byId?.(id) ?? await mod.gazetteer?.byId?.(id);
    if (city) return { lat: city.lat, lon: city.lon, label: city.name, kind: 'place', placeRef: city.id };
  } catch { /* unresolved: the view still opens at the linked time */ }
  return null;
}

let noticeTimer = null;
export function showNotice(text) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('share-notice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'share-notice'; el.className = 'share-notice';
    el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  el.textContent = text; el.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

let applying = false;
/** Apply a link to the store. Ignores anything that is not ours (reserved names, #debug, junk). */
export async function applyHash(hash = location.hash) {
  const p = parseGrammar(hash);
  if (!p) return { applied: false, snapped: false, notice: null };
  applying = true;
  try {
    const patch = { view: p.view, layers: p.layers };
    const st = store.get();
    if (st.sample) {
      if (p.layers.t) patch.case = 'C';
      else if (p.layers.j && !p.layers.z) patch.case = 'B';
      else if (st.case !== 'A') patch.case = 'A';
    }
    const probe = { ...st, ...patch, layers: p.layers };
    const field = activeField(probe);
    const steps = data.fieldSteps(field) || [];
    let notice = null, snapped = false;
    const asked = (dateOfStamp(p.validTime).getTime() - data.validTime(0).getTime()) / HOUR;
    if (steps.length) {
      const ns = nearestStep(field, asked);
      patch.t = ns.step;
      if (Math.abs(ns.step - asked) > 0.5) {
        snapped = true;
        const when = formatValid(data.validTime(ns.step));
        notice = `That moment is not in this forecast. Showing the nearest step: ${when.local}.`;
      }
    }
    const focus = p.place ? await resolvePlace(p.place) : null;
    if (focus) patch.focus = focus;
    patch.playing = false;
    store.set(patch);
    if (notice) showNotice(notice);
    return { applied: true, snapped, notice, place: p.place };
  } finally { applying = false; }
}

let installed = false;
/** Call once after the manifest has loaded. Returns an uninstall function. */
export async function installLinks() {
  if (installed) return () => {};
  installed = true;
  await applyHash(location.hash);
  let last = 0, timer = null, lastWritten = '';
  const write = () => {
    timer = null; last = Date.now();
    try {
      const cur = location.hash.slice(1);
      if (cur === 'debug' || isReservedHash(cur)) return; // never clobber the debug readout or the host's own hashes
      const h = formatHash(store.get());
      if (h === lastWritten) return;
      lastWritten = h;
      history.replaceState(null, '', h);
    } catch { /* sandboxed frames may refuse; links still copy */ }
  };
  const schedule = () => {
    if (applying || timer) return;
    const wait = Math.max(0, 500 - (Date.now() - last));
    timer = setTimeout(write, wait);
  };
  const unsub = store.subscribe((_s, patch) => {
    if ('view' in patch || 'layers' in patch || 't' in patch || 'focus' in patch || 'case' in patch) schedule();
  });
  const onHash = () => { if (parseGrammar(location.hash) && location.hash !== lastWritten) applyHash(location.hash); };
  addEventListener('hashchange', onHash);
  schedule();
  return () => { unsub(); removeEventListener('hashchange', onHash); clearTimeout(timer); installed = false; };
}

let canonical;
async function canonicalUrl() {
  if (canonical !== undefined) return canonical;
  canonical = null;
  try {
    const res = await fetch('config.json');
    if (res.ok) canonical = (await res.json()).canonicalUrl || null;
  } catch { /* none */ }
  return canonical;
}
/** The shareable link: canonicalUrl (config.json) + hash; off the artifact the page's own address. */
export async function linkText(state = store.get()) {
  const base = (await canonicalUrl()) || (/^https?:/.test(location.href) ? location.href.split('#')[0] : '');
  return base + formatHash(state);
}

export async function copyLink() {
  const text = await linkText();
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    return !!ok;
  } catch { return false; }
}
