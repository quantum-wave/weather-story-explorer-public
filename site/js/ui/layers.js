// Layer toggles, the sample case switch, the view switch and the always-visible legend.
import { h, clear } from './dom.js';
import { LAYER_CODES } from '../contract.js';
import { sampleBadgeText } from './header.js';

const ORDER = ['z', 'j', 'c', 't'];
const NAMES = {
  z: ['Pattern', '500 hPa height vs normal'],
  j: ['Jet stream', '250 hPa wind speed'],
  c: ['Confidence', 'Ensemble spread of the pattern'],
  t: ['Motion demo', 'Surface temperature vs 2-year mean (sample only)'],
};
const LEGEND = {
  z: ['500 hPa height vs normal', 'Blue: lower pressure aloft, usually unsettled. Amber: higher, usually settled.'],
  j: ['250 hPa wind (jet stream)', 'Brighter purple to cream: faster wind, from 30 m/s. 50 m/s or more marks a storm track.'],
  c: ['Pattern confidence', 'Tight spread: the models agree. Wide spread: the timing is uncertain.'],
  t: ['Surface temperature vs 2-year mean', 'Blue: colder than the average. Amber: warmer.'],
};
export const VIEW_LABEL = { np: 'Regional', nh: 'Hemisphere', gl: 'Global' };

/** Layer codes a sample case can show (the first of z, j, t it has is its default). */
export function caseLayers(manifest, caseId) {
  const fields = manifest?.cases?.[caseId]?.fields || [];
  return ORDER.filter((c) => fields.includes(LAYER_CODES[c]));
}

export function mountLayers({ store, bus, clock, renderer, links, toast }) {
  // The on-map legend is drawn by render/legend.js inside the canvas; #legend carries the same words for screen readers.
  const panel = document.getElementById('layers-panel');
  const btn = document.getElementById('btn-layers');
  const legend = document.getElementById('legend');
  const viewSwitch = document.getElementById('view-switch');
  let manifest = null;

  const available = (code) => {
    const f = LAYER_CODES[code];
    if (!manifest?.fields?.[f]) return false;
    if (manifest.sample) return caseLayers(manifest, store.get().case).includes(code);
    return code !== 't';
  };

  function selectCase(id) {
    if (!manifest?.cases?.[id]) return;
    const codes = caseLayers(manifest, id);
    const first = ORDER.find((c) => codes.includes(c) && c !== 'c');
    const layers = { z: false, j: false, c: false, t: false };
    if (first) layers[first] = true;
    store.set({ case: id, layers });
    clock.seek(clock.range()[0]);
  }
  function toggle(code) {
    if (!available(code)) return;
    store.set({ layers: { [code]: !store.get().layers[code] } });
  }

  function buildPanel() {
    clear(panel);
    const s = store.get();
    panel.append(h('h3', { text: 'Layers' }));
    for (const code of ORDER) {
      if (code === 't' && !manifest?.sample) continue;
      const on = !!s.layers[code], ok = available(code);
      const o = h('button', { type: 'button', class: 'opt', role: 'checkbox', 'aria-checked': on ? 'true' : 'false', 'data-layer': code, disabled: !ok, onclick: () => toggle(code) },
        h('span', { class: 'box' }),
        h('span', {}, NAMES[code][0], h('span', { class: 'sub', text: ok ? NAMES[code][1] : manifest?.sample ? 'Not in this sample case' : 'Not in this run' })));
      panel.append(o);
    }
    if (manifest?.sample) {
      panel.append(h('hr'), h('h3', { text: 'Sample case' }));
      for (const id of Object.keys(manifest.cases)) {
        if (!caseLayers(manifest, id).length) continue;
        panel.append(h('button', { type: 'button', class: 'opt radio', role: 'radio', 'aria-checked': s.case === id ? 'true' : 'false', 'data-case': id, onclick: () => selectCase(id) },
          h('span', { class: 'box' }), h('span', {}, manifest.cases[id].label)));
      }
    }
    panel.append(h('hr'), h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn ghost', text: 'Reset view', onclick: () => renderer.resetView() }),
      h('button', { type: 'button', class: 'btn ghost', text: 'Copy link', onclick: async () => {
        const ok = await links.copyLink().catch(() => false);
        toast({ message: ok ? 'Link copied' : 'Could not copy the link', ms: 3000 });
      } })));
  }

  function paintViews() {
    const v = store.get().view;
    for (const b of viewSwitch.querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.view === v ? 'true' : 'false');
  }

  function paintLegend() {
    const s = store.get();
    clear(legend);
    const active = ORDER.filter((c) => s.layers[c]);
    for (const c of active) legend.append(h('p', { 'data-layer': c, text: `${LEGEND[c][0]}. ${LEGEND[c][1]}` }));
    if (manifest && (active.includes('z') || active.includes('t'))) legend.append(h('p', { class: 'lg-base', text: `Anomaly vs ${active.includes('z') ? manifest.climatology?.label || 'climatology' : 'the 2-year mean of this sample'}` }));
    if (manifest?.sample) legend.append(h('p', { class: 'lg-sample', text: sampleBadgeText(manifest, s.case) }));
  }

  function open(on) {
    panel.hidden = !on;
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) buildPanel();
  }
  btn.addEventListener('click', () => open(panel.hidden));
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) open(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { open(false); btn.focus(); } });
  viewSwitch.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) store.set({ view: b.dataset.view });
  });

  store.subscribe((s, p) => {
    if ('view' in p) paintViews();
    if ('layers' in p || 'case' in p || 'theme' in p) { paintLegend(); if (!panel.hidden) buildPanel(); }
  });
  paintViews();
  return { setManifest(m) { manifest = m; paintLegend(); }, selectCase, toggle, open, paintLegend };
}
