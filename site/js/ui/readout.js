// The readout (DESIGN-SPEC 5.4): a small card at the point you touch, in words. On touch it appears on a tap and stays until the next
// tap; on a mouse it follows the pointer after a 120 ms rest and a click pins it. From the keyboard, Enter on the focused map
// reads the map's centre. The words come from the active lens (descriptor.describe): "+14 dam · strong ridge", the height itself
// ("height 576 dam (5,760 m)") for Pattern, then the valid time and day. Where the no-clear-signal rule holds the first line is
// "No clear signal yet", then the average of the forecasts in smaller type. Between model steps the card says so. It carries
// "Add a place here", which opens the Add sheet with the nearest town.
import { h } from './dom.js';
import { lens as lensOf } from '../lenses/index.js';
import * as annotate from '../render/annotate.js';

export const HOVER_REST_MS = 120;
const FACTOR = { z500a: 0.1, z500sd: 0.1 }; // stored field -> palette units (the renderer's own table)

const fmtTime = (d, year) => {
  try {
    const o = { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' };
    if (year) o.year = 'numeric';
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', o).formatToParts(d).map((x) => [x.type, x.value]));
    const time = p.minute === '00' ? `${p.hour} ${p.dayPeriod.toLowerCase()}` : `${p.hour}:${p.minute} ${p.dayPeriod.toLowerCase()}`;
    return `${p.weekday} ${p.day} ${p.month}${year ? ' ' + p.year : ''}, ${time} ${p.timeZoneName}`;
  } catch { return ''; }
};

/**
 * What the card says, as data. `sample` is renderer.sampleAt()'s {values, t, signal}. Returns
 * {first, second, height, time, step, none}: `first` the headline, `second` the line under a no-signal headline (else ''), `height`
 * the height line for Pattern, `time` the valid time and day, `step` "between model steps" or ''.
 */
export function readoutModel({ lens, sample, units = 'metric', validTime = null, steps = [], playing = false, year = false } = {}) {
  const L = lens || lensOf('z');
  const v = sample?.values || {};
  const field = L.fill?.field || 'z500a';
  const raw = v[field], val = Number.isFinite(raw) ? raw * (FACTOR[field] ?? 1) : NaN;
  const spread = Number.isFinite(v.z500sd) ? v.z500sd * 0.1 : NaN;
  const t = sample?.t ?? 0;
  const none = field === 'z500a' && sample?.signal === 'none' && Number.isFinite(val);
  let first = '', second = '';
  if (!Number.isFinite(val)) first = 'No data here';
  else {
    const words = String(L.describe ? L.describe(val, { signal: sample?.signal, spread, units }) : '');
    [first, second = ''] = words.split('\n');
  }
  const z = v.z500;
  const height = L.code === 'z' && Number.isFinite(z) && !none ? `height ${Math.round(z / 10)} dam (${Math.round(z).toLocaleString('en-US')} m)` : '';
  const lead = Math.max(1, Math.ceil(t / 24));
  const time = validTime ? `${fmtTime(validTime, year)} · day ${lead}` : `day ${lead}`;
  const off = steps.length && !playing && steps.every((s) => Math.abs(s - t) > 1e-6) && t >= steps[0] && t <= steps[steps.length - 1];
  return { first, second, height, time, step: off ? 'between model steps' : '', none };
}

/** A zero-size layer at the stage's corner that holds the readout and the coach: the lenses keep their labels clear of every
 *  sizeable child of the stage (jet.js avoidRects), and a transient card or hint must not push a label off the map. */
export function explainLayer(stage) {
  let l = stage.querySelector(':scope > #explain-layer');
  if (!l) { l = document.createElement('div'); l.id = 'explain-layer'; l.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:9;overflow:visible'; stage.append(l); }
  return l;
}

const safe = (f) => { try { return f(); } catch { return null; } };

export function mountReadout(app) {
  const { store, bus, renderer } = app;
  const stage = document.getElementById('stage'), canvas = document.getElementById('map');
  if (!stage || !canvas) return {};
  const dot = h('span', { class: 'rdo-dot', 'aria-hidden': 'true', hidden: true });
  const card = h('div', { id: 'readout', class: 'rdo', role: 'group', 'aria-label': 'Reading at this point', tabindex: '-1', hidden: true });
  const live = h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  explainLayer(stage).append(dot, card, live);
  let at = null; // {x, y, lon, lat, pinned}
  let hoverTimer = 0, raf = 0;

  function paint() {
    if (!at) return;
    const s = store.get(), m = app.data.getManifest();
    const L = lensOf(s.lens ?? 'z') || lensOf('z');
    const sm = app.sampleAt(at.lon, at.lat);
    const steps = app.data.fieldSteps?.(L.fill?.field || 'z500a') || [];
    const model = readoutModel({ lens: L, sample: sm, units: s.units, validTime: safe(() => app.data.validTime(sm?.t ?? s.t)), steps, playing: s.playing, year: !!m?.cases });
    const kids = [h('p', { class: 'rdo-first', text: model.first })];
    if (model.second) kids.push(h('p', { class: 'rdo-second', text: model.second }));
    if (model.height) kids.push(h('p', { class: 'rdo-line', text: model.height }));
    kids.push(h('p', { class: 'rdo-line rdo-time', text: model.time }));
    if (model.step) kids.push(h('p', { class: 'rdo-line rdo-step', text: model.step }));
    if (at.pinned) {
      kids.push(h('div', { class: 'rdo-act' },
        h('button', { type: 'button', class: 'rdo-add', onclick: addHere, text: 'Add a place here' }),
        h('button', { type: 'button', class: 'rdo-x', onclick: () => hide(true), text: 'Close' })));
    }
    card.replaceChildren(...kids);
    card.dataset.mode = at.pinned ? 'pinned' : 'hover';
    card.dataset.signal = model.none ? 'none' : 'clear';
    live.textContent = at.pinned ? [model.first, model.second, model.height, model.time].filter(Boolean).join('. ') : '';
    place();
  }

  /** Put the card beside the point, inside the stage and clear of the legend and the map tools where it can. */
  function place() {
    const sr = stage.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
    const px = cr.left - sr.left + at.x, py = cr.top - sr.top + at.y;
    dot.style.transform = `translate(${px}px, ${py}px)`;
    dot.hidden = false;
    card.hidden = false;
    const w = card.offsetWidth, hh = card.offsetHeight, pad = 8;
    const avoid = ['#map-legend', '#map-tools .seg', '#map-tools .tools-end', '#layers-panel:not([hidden])', '#brief-pill:not([hidden])'].flatMap((q) => [...stage.querySelectorAll(q)]).map((e) => { const r = e.getBoundingClientRect(); return { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height }; }).filter((r) => r.w > 0);
    // the ridge and trough plates drawn on the canvas are obstacles too: a pinned card never half-covers one (4 px of slack)
    const plates = annotate.shown.map((q) => ({ x: cr.left - sr.left + q.x - q.w / 2, y: cr.top - sr.top + q.y - q.h / 2, w: q.w, h: q.h }));
    const offs = [14, 40, 70].flatMap((gx) => [14, 40, 70].map((gy) => [gx, gy])).sort((p, q) => (p[0] + p[1]) - (q[0] + q[1]));
    // every candidate sits at least 14 px above or below the point; one pushed past a stage edge is slid back in (a phone is narrower than the card is wide)
    const lim = (c) => [Math.max(pad, Math.min(sr.width - w - pad, c[0])), Math.max(pad, Math.min(sr.height - hh - pad, c[1]))];
    const cands = offs.flatMap(([gx, gy]) => [[px + gx, py - gy - hh], [px - gx - w, py - gy - hh], [px + gx, py + gy], [px - gx - w, py + gy], [px - w / 2, py - gy - hh], [px - w / 2, py + gy]]).map(lim);
    const fits = ([x, y]) => x >= pad && y >= pad && x + w <= sr.width - pad && y + hh <= sr.height - pad;
    const hitsAny = (list, [x, y]) => list.some((r) => x < r.x + r.w + 4 && x + w > r.x - 4 && y < r.y + r.h + 4 && y + hh > r.y - 4);
    const clear = (c) => !hitsAny(avoid, c), clearOfPlates = (c) => !hitsAny(plates, c);
    let pick = cands.find((c) => fits(c) && clear(c) && clearOfPlates(c)) || cands.find((c) => fits(c) && clearOfPlates(c)) || cands.find((c) => fits(c) && clear(c)) || cands.find(fits) || cands[0];
    pick = [Math.max(pad, Math.min(sr.width - w - pad, pick[0])), Math.max(pad, Math.min(sr.height - hh - pad, pick[1]))];
    card.style.transform = `translate(${Math.round(pick[0])}px, ${Math.round(pick[1])}px)`;
  }

  function show(p, pinned) {
    at = { ...p, pinned };
    paint();
  }
  function hide(refocus = false) {
    clearTimeout(hoverTimer);
    at = null; card.hidden = true; dot.hidden = true; live.textContent = '';
    if (refocus) { try { canvas.focus({ preventScroll: true }); } catch { /* none */ } }
  }

  async function addHere() {
    if (!at) return;
    const { lat, lon } = at;
    let text = '';
    try { const { gazetteer } = await import('../pins/gazetteer.js'); const c = await gazetteer.nearest(lat, lon); text = c ? gazetteer.cityLabel(c) : ''; } catch { /* the sheet opens empty */ }
    hide(false);
    if (!app.openAddSheet({ kind: 'place', text })) app.toast?.({ text: 'Adding a place from the map is not available yet.' });
  }

  // a tap (the renderer's own tap: a drag, pinch and double tap are not taps) pins the card at the point
  bus.on('map:tap', (p) => show(p, true));
  // a pan, zoom or rotation moves the map out from under the point: the reading goes with it
  bus.on('map:viewchange', () => { if (at) hide(false); });
  // the clock, the lens or the units change what the point reads: the same point, new words (once a frame)
  store.subscribe((_s, patch) => {
    if (!at) return;
    if ('view' in patch) { hide(false); return; }
    if ('t' in patch || 'lens' in patch || 'units' in patch) { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (at) paint(); }); }
  });

  // the plates settle on their places after the frame that moved them: a card standing then steps clear of them
  annotate.onPlatesChanged(() => { if (at && !card.hidden) place(); });

  // a mouse hovering: after a rest, a card that follows the pointer (never while a button is down or a card is pinned)
  canvas.addEventListener('pointermove', (e) => {
    clearTimeout(hoverTimer);
    if (e.pointerType !== 'mouse' || e.buttons || at?.pinned) return;
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    hoverTimer = setTimeout(() => {
      if (at?.pinned) return;
      const ll = renderer.invert([x, y]);
      if (ll) show({ x, y, lon: ll[0], lat: ll[1] }, false); else hide(false);
    }, HOVER_REST_MS);
  });
  canvas.addEventListener('pointerleave', () => { clearTimeout(hoverTimer); if (at && !at.pinned) hide(false); });
  canvas.addEventListener('pointerdown', () => { clearTimeout(hoverTimer); if (at && !at.pinned) hide(false); });

  // keyboard: Enter on the focused map reads the centre; focus moves to the card (Tab reaches Add a place here)
  canvas.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.key !== 'Enter') return;
    const r = canvas.getBoundingClientRect(), x = r.width / 2, y = r.height / 2, ll = renderer.invert([x, y]);
    if (!ll) return;
    e.preventDefault();
    show({ x, y, lon: ll[0], lat: ll[1] }, true);
    card.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !at || card.hidden || e.defaultPrevented) return;
    if (document.querySelector('.wse-sheet-root')) return;
    e.preventDefault();
    hide(card.contains(document.activeElement));
  });

  const api = { hide, show: (p) => show(p, true), model: () => at && { ...at }, card };
  if (window.__wse?.ui) window.__wse.ui.readout = api;
  return api;
}
