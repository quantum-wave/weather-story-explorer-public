// The Layers panel and the always-readable legend text (DESIGN-SPEC 6.1, 11.4; Josh points 5, 13, 15).
// One lens is active at a time: the panel lists the lenses that are finished (lenses/index.js listed()) as radio rows, each with
// its one-line blurb and a swatch strip of the bands it draws, then the six overlays as switches. A listed lens whose field is not
// in the loaded data is disabled with a data reason ("Not in this run") and nothing else; an unfinished lens is not listed at all.
// Uncertain areas is locked on beyond day 7 (compose.js DOUBT_LOCK_H) and says why. On the phone the panel is the one sheet
// (ui/sheet.js); from 900 px it is a popover under the Layers button, inside the stage, so the timeline can never cover it.
// The store keys it writes are `lens` and `overlays`; the retired layer-flag and sample-case keys are gone (tests/lint/legacy-keys.test.mjs).
import { h, clear } from './dom.js';
import { listed } from '../lenses/index.js';
import { legendModel } from './maplegend.js';
import { DOUBT_LOCK_H } from '../render/compose.js';
import { openSheet, PHONE_MAX_WIDTH } from './sheet.js';
import { choice } from '../state.js';

export const VIEW_LABEL = { np: 'Regional', nh: 'Hemisphere', gl: 'Globe', wm: 'World' };

/** The overlays in panel order: store.overlays key, name, one line of what it does. */
export const OVERLAYS = Object.freeze([
  ['contours', 'Height contours', 'The lines of equal height'],
  ['marks', 'Ridge and trough labels', 'Names the big bends in the pattern'],
  ['doubt', 'Uncertain areas', 'Hatches where the forecasts disagree'],
  ['jetline', 'Jet outline', 'The 36 m/s jet edge over any lens'],
  ['pins', 'Pins and names', 'Your places on the map'],
  ['places', 'Place labels', 'City names'],
]);
export const DOUBT_LOCKED_REASON = 'Always on after day 7, where forecasts spread out';

/** Is the Uncertain areas switch locked on at forecast hour t? */
export const doubtLocked = (t) => Number.isFinite(t) && t > DOUBT_LOCK_H;

function ensureCss() {
  if (document.querySelector('link[data-layers-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('../../css/layers.css', import.meta.url).href; l.setAttribute('data-layers-css', '');
  document.head.append(l);
}

/** The lens rows as data: [{code, name, blurb, ok, reason, active, bar: [{left, width, color, gap}]}]. Pure given the manifest and a store state. */
export function lensRows(s, manifest) {
  const on = choice(s, 'lens');
  return listed().map((l) => {
    const a = manifest ? (l.available?.(manifest) ?? { ok: true }) : { ok: false, reason: 'Not in this run' };
    const m = legendModel({ ...s, lens: l.code }, manifest);
    return { code: l.code, name: l.name, blurb: l.blurb, ok: !!a.ok, reason: a.ok ? '' : a.reason || 'Not in this run', active: l.code === on, bar: m.bar };
  });
}

export function mountLayers({ store, bus, links, toast }) {
  ensureCss();
  // The words of the legend for screen readers; the picture is the DOM legend card (ui/maplegend.js) and, in shares, the canvas one.
  const panel = document.getElementById('layers-panel');
  const btn = document.getElementById('btn-layers');
  const legend = document.getElementById('legend');
  const viewSwitch = document.getElementById('view-switch');
  const home = panel.parentElement; // the stage: the popover's place, and where the panel returns after a sheet
  let manifest = null, sheet = null, locked = doubtLocked(store.get().t);
  const isPhone = () => window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`).matches;

  function selectLens(code) {
    const r = lensRows(store.get(), manifest).find((x) => x.code === code);
    if (!r || !r.ok || r.active) return;
    store.set({ lens: code });
  }
  function toggleOverlay(key) {
    if (key === 'doubt' && doubtLocked(store.get().t)) return;
    store.set({ overlays: { [key]: !(store.get().overlays?.[key] ?? true) } });
  }

  const swatch = (bar) => h('span', { class: 'lyr-swatch', 'aria-hidden': 'true' },
    bar.map((b) => h('i', { style: `left:${b.left}%;width:${b.width}%` + (b.gap ? '' : `;background:${b.color}`) })));

  function lensRow(r) {
    return h('button', {
      type: 'button', class: 'lyr-row lyr-lens', role: 'radio', 'aria-checked': String(r.active), 'data-lens': r.code,
      disabled: !r.ok, tabindex: r.active ? '0' : '-1', onclick: () => selectLens(r.code),
    }, h('span', { class: 'lyr-mark', 'aria-hidden': 'true' }),
    h('span', { class: 'lyr-text' }, h('span', { class: 'lyr-name', text: r.name }), h('span', { class: 'lyr-sub', text: r.ok ? r.blurb : r.reason })),
    r.ok ? swatch(r.bar) : null);
  }
  function overlayRow([key, name, sub], s) {
    const lockedOn = key === 'doubt' && doubtLocked(s.t);
    const on = lockedOn || (s.overlays?.[key] ?? true);
    return h('button', {
      type: 'button', class: 'lyr-row lyr-overlay', role: 'switch', 'aria-checked': String(on), 'data-overlay': key, title: sub,
      'aria-disabled': lockedOn ? 'true' : null, 'data-locked': lockedOn ? '1' : null, onclick: () => toggleOverlay(key),
    }, h('span', { class: 'lyr-text' }, h('span', { class: 'lyr-name', text: name }), h('span', { class: 'lyr-sub', text: lockedOn ? DOUBT_LOCKED_REASON : sub })),
    h('span', { class: 'lyr-switch', 'aria-hidden': 'true' }));
  }

  function buildPanel() {
    const s = store.get();
    const hadFocus = panel.contains(document.activeElement) ? document.activeElement : null;
    const key = hadFocus?.getAttribute('data-lens') ? `[data-lens="${hadFocus.getAttribute('data-lens')}"]` : hadFocus?.getAttribute('data-overlay') ? `[data-overlay="${hadFocus.getAttribute('data-overlay')}"]` : null;
    // A rebuild empties the panel, which sends any scroller around it back to the top: keep both scroll positions (the popover scrolls
    // itself; the phone sheet scrolls .wse-sheet-body) so the row a person just tapped stays where it was.
    const scrollers = [panel, panel.closest('.wse-sheet-body')].filter(Boolean).map((el) => [el, el.scrollTop]);
    const restore = () => { for (const [el, top] of scrollers) if (el.scrollTop !== top) el.scrollTop = top; };
    clear(panel);
    const rows = lensRows(s, manifest);
    const group = h('div', { class: 'lyr-group', role: 'radiogroup', 'aria-labelledby': 'lyr-h-lens' }, rows.map(lensRow));
    group.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      const live = [...group.querySelectorAll('[role=radio]:not([disabled])')];
      const i = live.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const next = live[(i + d + live.length) % live.length];
      next.focus(); next.click();
    });
    panel.append(
      h('h3', { class: 'lyr-h lyr-title', id: 'lyr-h-lens', text: 'Show' }), group,
      h('h3', { class: 'lyr-h', text: 'On the map' }), h('div', { class: 'lyr-group lyr-overlays' }, OVERLAYS.map((o) => overlayRow(o, s))),
      h('div', { class: 'lyr-foot' }, h('button', { type: 'button', class: 'lyr-link', text: 'Copy link', onclick: async () => {
        const ok = await links.copyLink().catch(() => false);
        toast({ message: ok ? 'Link copied' : 'Could not copy the link', ms: 3000 });
      } })));
    restore();
    if (key) panel.querySelector(key)?.focus({ preventScroll: true });
    sheet?.resize?.();
    restore();
  }

  function paintViews() {
    const v = store.get().view;
    for (const b of viewSwitch.querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.view === v ? 'true' : 'false');
  }

  /** The legend's words as one readable block: the same title, sentence, unit, footer and provenance the legend card and a share draw. */
  function paintLegend() {
    const m = legendModel(store.get(), manifest), { spec } = m;
    clear(legend);
    legend.append(h('p', { 'data-lens': m.lens, text: `${spec.title}. ${spec.subtitle} ${spec.unit}.` }), h('p', { class: 'lg-base', text: spec.footer }));
    if (m.run) legend.append(h('p', { class: 'lg-sample', text: m.run }));
  }

  const isOpen = () => !panel.hidden;
  function open(on) {
    if (on === isOpen()) return;
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (!on) {
      if (sheet) { sheet.close('close'); return; }
      panel.hidden = true;
      return;
    }
    buildPanel();
    panel.hidden = false;
    if (isPhone()) {
      panel.classList.add('in-sheet');
      sheet = openSheet({ title: 'Layers', content: panel, onClose: () => {
        sheet = null; panel.classList.remove('in-sheet'); panel.hidden = true; home.append(panel);
        btn.setAttribute('aria-expanded', 'false');
      } });
    }
  }
  btn.addEventListener('click', () => open(!isOpen()));
  document.addEventListener('pointerdown', (e) => {
    if (isOpen() && !sheet && !panel.contains(e.target) && !btn.contains(e.target)) open(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen() && !sheet) { open(false); btn.focus(); } });
  viewSwitch.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) store.set({ view: b.dataset.view });
  });

  store.subscribe((s, p) => {
    if ('view' in p) paintViews();
    if ('lens' in p || 'ground' in p || 'colors' in p || 'theme' in p || 'units' in p) { paintLegend(); if (isOpen()) buildPanel(); }
    if ('overlays' in p && isOpen()) buildPanel();
    if ('t' in p) { const l = doubtLocked(s.t); if (l !== locked) { locked = l; if (isOpen()) buildPanel(); } }
  });
  bus?.on?.('data:manifest', (m) => { manifest = m; paintLegend(); if (isOpen()) buildPanel(); });
  paintViews();
  paintLegend();
  return { setManifest(m) { manifest = m; paintLegend(); if (isOpen()) buildPanel(); }, selectLens, toggleOverlay, open, paintLegend };
}
