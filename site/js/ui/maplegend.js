// The always-visible map legend as a DOM card (DESIGN-SPEC 5.1, W3-11). It answers "is this the pressure pattern?" in
// Josh's words: a title, a stepped bar that matches the bands (the unshaded +-2 dam gap shown as a gap), countable ticks
// only on the hairlined edges plus +-2, what the contour lines are, the doubt hatch when it is drawing, the baseline
// footer and one provenance line. Every word and colour comes from palette.legendSpec(); the run line from runLine() (the active case's chip text).
// It works with or without store.lens (Pattern by default) and with or without a guide to open.
import { legendSpec, LENS_FIELDS, colorsOf } from '../render/palette.js';
import { runLabel, caseForLens } from '../data/kind.js';
import { sampleBadgeText } from './header.js';
import { getManifest } from '../data/index.js';
import { store as defaultStore, bus as defaultBus } from '../state.js';
import { prefs } from './prefs.js';

const LO = -42, HI = 42; // the bar's span in dam: the +-40 hairlines sit just inside its ends
const NO_SPREAD = 'Spread not in this run: see the timeline for how far to trust it';
const WARM_NOTE = 'Data covers part of this view';

/** The ground the chart is drawn on: an explicit store.ground, else Night in the dark theme and Paper in the light one. */
export function groundOf(s) {
  if (s?.ground === 'paper' || s?.ground === 'night') return s.ground;
  return s?.theme === 'light' ? 'paper' : 'night';
}

/** Which palette the legend explains: the active lens's fill, Pattern when there is no lens (or one the table lacks). */
export function fillOf(s) {
  const lens = s?.lens;
  return LENS_FIELDS[lens]?.fill ? lens : 'z';
}

/**
 * The legend as data, no DOM: what to draw for a store state and a manifest.
 * `{lens, fill, ground, colors, spec, bar: [{from, to, left, width, color, gap}], ticks: [{value, label, left, major, align}],
 *   hatch: bool, hatchNote: string|null, run: string}`
 */
export function legendModel(s, manifest) {
  const lens = fillOf(s), fill = LENS_FIELDS[lens].fill, ground = groundOf(s), colors = colorsOf(s?.colors);
  const signed = fill === 'z500a' || fill === 't850a';
  const units = s?.units === 'us' ? 'us' : 'metric';
  const spec = legendSpec(fill, ground, signed ? LO : null, signed ? HI : null, units, colors);
  const lo = spec.stops[0]?.from ?? LO, hi = spec.stops[spec.stops.length - 1]?.to ?? HI, span = hi - lo || 1;
  const pct = (v) => ((v - lo) / span) * 100;
  let bar = spec.stops.map((st) => ({ from: st.from, to: st.to, left: pct(st.from), width: pct(st.to) - pct(st.from), color: st.color, gap: !!st.gap }));
  const gapStop = spec.stops.find((st) => st.gap);
  let ticks = spec.ticks.map((t) => ({
    value: t.value, label: t.label, left: pct(t.value), major: t.major,
    // the two labels beside the unshaded gap lean away from it so they never overlap
    align: gapStop && t.value === gapStop.from ? 'end' : gapStop && t.value === gapStop.to ? 'start' : 'mid',
  }));
  if (fill === 'tp6') {
    // Rain bands run 0.1 to 300 mm: drawn to scale the common ones would be hairlines, so the bar is one equal step per band
    // (as ECMWF's own rain legend is), each edge labelled, neighbours on alternate rows. Two labels on one row are two bands apart, so
    // they clear each other only if the bar is inset enough for every label to centre on its edge: legend.css .mlg-scale-rain.
    const bands = spec.stops.filter((st) => !st.gap), n = bands.length; // the shaded bands only: below 0.1 mm nothing is drawn
    bar = bands.map((st, i) => ({ from: st.from, to: st.to, left: (i / n) * 100, width: 100 / n, color: st.color, gap: false }));
    ticks = spec.ticks.map((t, k) => ({ value: t.value, label: t.label, left: (bands.findIndex((st) => st.from === t.value) / n) * 100, major: true, align: 'mid', row: k % 2 ? 2 : 1 }));
  }
  const doubtOn = s?.overlays?.doubt !== false;
  const hasSpread = !manifest || !!manifest.fields?.z500sd;
  const wantsHatch = fill === 'z500a' && !!spec.hatch && doubtOn;
  return {
    lens, fill, ground, colors, spec, bar, ticks, units,
    hatch: wantsHatch && hasSpread,
    hatchNote: wantsHatch && !hasSpread ? NO_SPREAD : null,
    run: runLine(s, manifest),
  };
}

/**
 * The provenance line: for a sample manifest with named cases, the ACTIVE case's chip string (the same sentence the header chip
 * shows, so the card and the map never describe different datasets); otherwise the one provenance formatter (live run, or a
 * sample/recorded dataset with no cases, whose sample label names it).
 */
export function runLine(s, manifest) {
  if (!manifest) return '';
  const caseId = caseForLens(manifest, s?.lens);
  if (manifest.sample && manifest.cases?.[caseId]?.label) return sampleBadgeText(manifest, caseId);
  return runLabel(manifest);
}

const el = (tag, attrs = {}, kids = []) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else if (v != null) e.setAttribute(k, v); }
  for (const c of [].concat(kids)) if (c) e.append(c);
  return e;
};
const svgLine = (cls) => {
  const ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 28 8'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', cls);
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', 'M1 5 C 8 0, 14 8, 27 3');
  s.append(p); return s;
};

function ensureStyles() {
  if (document.querySelector('link[data-mlg]')) return;
  const l = el('link', { rel: 'stylesheet', href: new URL('../../css/legend.css', import.meta.url).href, 'data-mlg': '' });
  document.head.append(l);
}

/**
 * Mount the legend in the stage. Options: {store, bus, host (the element to fill), openGuide (function), collapsed
 * (initial state; default collapsed on a phone-width screen)}. Returns {root, refresh, setCollapsed, destroy}.
 */
export function mountMapLegend({ store = defaultStore, bus = defaultBus, host, openGuide, collapsed } = {}) {
  ensureStyles();
  const stage = host?.parentElement ? host.parentElement : document.getElementById('stage');
  const root = host || el('section', { id: 'map-legend', class: 'mlg', 'aria-label': 'Map legend' });
  root.classList.add('mlg');
  if (!root.parentElement) stage.append(root);
  const phone = window.matchMedia('(max-width: 899px), (orientation: landscape) and (max-height: 500px) and (pointer: coarse)');
  // open on a roomy desktop stage; a phone or a small stage starts as the one-row legend so the map keeps its room
  const sb = stage?.getBoundingClientRect?.() || { width: 0, height: 0 };
  let isCollapsed = collapsed ?? (phone.matches || sb.width < 760 || sb.height < 560);
  let lastKey = '', bodyId = 'mlg-body';

  function build() {
    const m = legendModel(store.get(), getManifest());
    const key = JSON.stringify([m.fill, m.ground, m.colors, m.units, m.hatch, m.hatchNote, m.run, isCollapsed]);
    if (key === lastKey) return;
    lastKey = key;
    const { spec } = m;
    root.dataset.lens = m.lens; root.dataset.ground = m.ground; root.dataset.colors = m.colors; root.dataset.collapsed = String(isCollapsed);

    const mini = el('span', { class: 'mlg-mini', 'aria-hidden': 'true' }, m.bar.map((b) => el('i', { style: b.gap ? `left:${b.left}%;width:${b.width}%` : `left:${b.left}%;width:${b.width}%;background:${b.color}` })));
    const toggle = el('button', { type: 'button', class: 'mlg-toggle', 'aria-expanded': String(!isCollapsed), 'aria-controls': bodyId },
      [el('span', { class: 'mlg-title', text: spec.title }), mini, el('span', { class: 'mlg-chev', 'aria-hidden': 'true' })]);
    toggle.addEventListener('click', () => api.setCollapsed(!isCollapsed));
    const what = el('button', { type: 'button', class: 'mlg-what', text: 'What is this?' });
    what.addEventListener('click', () => {
      const g = openGuide ?? window.__wse?.ui?.openGuide;
      if (typeof g === 'function') g(); else if (isCollapsed) api.setCollapsed(false); // no guide yet: the open legend is the answer
    });
    const head = el('div', { class: 'mlg-head' }, [toggle, what]);

    const bar = el('div', { class: 'mlg-bar', role: 'img', 'aria-label': `${spec.title}: colour scale in ${spec.unit}` },
      m.bar.map((b) => el('i', { class: 'mlg-stop' + (b.gap ? ' gap' : ''), 'data-from': String(b.from), 'data-to': String(b.to), 'data-hex': b.color || '', style: `left:${b.left}%;width:${b.width}%` + (b.gap ? '' : `;background:${b.color}`) })));
    const ticks = el('div', { class: 'mlg-ticks' },
      m.ticks.map((t) => el('span', { class: 'mlg-tick' + (t.major ? ' major' : ''), 'data-value': String(t.value), 'data-align': t.align, 'data-row': t.row === 2 ? '2' : null, 'data-edge': t.edge || null, style: `left:${t.left}%`, text: t.label })));
    const scale = el('div', { class: 'mlg-scale' + (m.fill === 'tp6' ? ' mlg-scale-rain' : '') }, [bar, ticks]);
    const unit = el('p', { class: 'mlg-unit' }, [el('span', { class: 'mlg-unit-name', text: spec.unit }),
      spec.ends ? el('span', { class: 'mlg-ends' }, [el('span', { text: spec.ends.low }), el('span', { text: spec.ends.high })]) : null]);

    // The mm / in switch (rain only): a two-button group; the choice is the store's `units`, kept for next time
    const sw = spec.unitSwitch ? el('div', { class: 'mlg-units', role: 'group', 'aria-label': 'Rain units' }, spec.unitSwitch.options.map((o) => {
      const b = el('button', { type: 'button', class: 'mlg-unit-btn', 'data-units': o === 'in' ? 'us' : 'metric', 'aria-pressed': String(o === spec.unitSwitch.active), text: o });
      b.addEventListener('click', () => { const u = o === 'in' ? 'us' : 'metric'; prefs.set('units', u); store.set({ units: u }); });
      return b;
    })) : null;

    const rows = [];
    if (spec.lineSample) rows.push(el('p', { class: 'mlg-row mlg-lines' }, [svgLine('mlg-swatch mlg-line'), el('span', { class: 'mlg-label-num', text: spec.lineSample.label }), el('span', { text: spec.lineSample.text })]));
    if (m.hatch) rows.push(el('p', { class: 'mlg-row mlg-hatch' }, [el('span', { class: 'mlg-swatch mlg-hatch-swatch', 'aria-hidden': 'true' }), el('span', { text: spec.hatch })]));
    if (m.hatchNote) rows.push(el('p', { class: 'mlg-row mlg-nospread', text: m.hatchNote }));

    const body = el('div', { class: 'mlg-body', id: bodyId }, [
      el('p', { class: 'mlg-sub', text: spec.subtitle }), scale, unit, sw, ...rows,
      el('p', { class: 'mlg-foot', text: spec.footer }),
      m.run ? el('p', { class: 'mlg-run', text: m.run }) : null,
    ]);
    body.hidden = isCollapsed;
    root.replaceChildren(head, body);
  }

  const api = {
    root,
    refresh: build,
    setCollapsed(v) { isCollapsed = !!v; build(); },
    destroy() { off(); offBus?.(); root.remove(); },
  };
  { const u = prefs.get('units'); if ((u === 'us' || u === 'metric') && store.get().units == null) store.set({ units: u }); }
  const off = store.subscribe(() => build());
  const offBus = bus?.on?.('data:manifest', () => build());
  build();
  return api;
}
