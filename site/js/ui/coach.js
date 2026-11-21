// The first-visit coach (DESIGN-SPEC 5.3): three short hints that never block the map, shown ONE AT A TIME, each anchored to its
// control (a ring on the control, the words beside it), dismissed by the first interaction with that control, shown once per browser
// and reopenable from the guide ("Show the tips again"). A hint's box is placed clear of the legend, the timeline and the map
// tools (candidates are tried until one touches none of them). Under reduced motion the hint appears without animation.
import { h } from './dom.js';
import { prefs } from './prefs.js';
import { explainLayer } from './readout.js';

export const HINTS = Object.freeze([
  { id: 'drag', text: 'Drag the map to look around. Pinch or scroll to zoom.', anchor: '#map', on: 'pointerdown' },
  { id: 'play', text: 'Press play to watch the pattern move through the days.', anchor: '.tl-play', also: '.tl-time', on: 'click' },
  { id: 'tap', text: 'Tap the chart for a reading in words.', anchor: '#map', bus: 'map:tap', key: ['Enter'] },
]);
const KEY = 'coachSeen';
const TOOLS = ['#map-tools .seg', '#map-tools .tools-end', '#map-tools button', '#view-switch', '#btn-layers', '#btn-expand'];
const AVOID = ['#map-legend', '#timeline', ...TOOLS, '#toasts', '#map-status'];

const seen = () => { const v = prefs.get(KEY, []); return Array.isArray(v) ? v : []; };

export function mountCoach(app) {
  const stage = document.getElementById('stage');
  if (!stage) return {};
  const reduce = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  let el = null, cur = null, cleanup = [], timer = 0, started = false, gen = 0;

  const rectIn = (e) => { const r = e.getBoundingClientRect(), s = stage.getBoundingClientRect(); return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height }; };
  const hit = (a, b, m = 6) => a.x < b.x + b.w + m && a.x + a.w > b.x - m && a.y < b.y + b.h + m && a.y + a.h > b.y - m;

  function place(hint, node) {
    const s = stage.getBoundingClientRect(), w = node.offsetWidth, hh = node.offsetHeight, pad = 8;
    const avoid = AVOID.flatMap((q) => [...document.querySelectorAll(q)]).filter((e) => (e.id !== 'toasts' && e.id !== 'map-status') || e.textContent.trim()).map(rectIn).filter((r) => r.w > 0 && r.h > 0);
    const legend = document.querySelector('#map-legend'), lr = legend && rectIn(legend);
    const anchor = document.querySelector(hint.anchor), ar = anchor && rectIn(anchor);
    // below the lowest map tool actually drawn (the #map-tools box itself can be zero-sized around its positioned children)
    const toolRects = TOOLS.flatMap((q) => [...document.querySelectorAll(q)]).map(rectIn).filter((r) => r.w > 0 && r.h > 0);
    const top = Math.max(pad, ...toolRects.map((r) => r.y + r.h + 12));
    const bottom = s.height - pad;
    const cands = [];
    if (hint.id === 'play') {
      // by the play button: its left edge, standing on the timeline's top edge; beside or above the legend when that is in the way
      const tl = rectIn(document.getElementById('timeline') || stage);
      const left = ar ? Math.max(pad, Math.min(s.width - w - pad, ar.x)) : pad;
      cands.push([left, tl.y - hh - 10]);
      if (lr) { cands.push([Math.max(left, lr.x + lr.w + 10), tl.y - hh - 10]); cands.push([left, lr.y - hh - 10]); }
    }
    cands.push([(s.width - w) / 2, top + 8], [(s.width - w) / 2, (s.height - hh) / 2], [pad, top + 8], [s.width - w - pad, top + 8]);
    const ok = ([x, y]) => x >= pad && y >= pad && x + w <= s.width - pad && y + hh <= bottom + pad && !avoid.some((r) => hit({ x, y, w, h: hh }, r));
    // a spot clear of everything, or none: a hint never sits over the legend, the timeline or a map control (5.3)
    const pick = cands.find(ok);
    if (!pick) return false;
    node.style.transform = `translate(${Math.round(pick[0])}px, ${Math.round(pick[1])}px)`;
    return true;
  }

  function end(id, { all = false } = {}) {
    gen++;
    for (const f of cleanup) f();
    cleanup = [];
    el?.remove(); el = null; cur = null;
    document.querySelectorAll('.coach-target').forEach((n) => n.classList.remove('coach-target'));
    const list = new Set(seen());
    if (all) HINTS.forEach((x) => list.add(x.id)); else if (id) list.add(id);
    prefs.set(KEY, [...list]);
    if (!all) timer = setTimeout(next, reduce() ? 150 : 500);
  }

  function busy() {
    const open = (id) => { const e = document.getElementById(id); return !!e && !e.hidden; };
    return !!document.querySelector('.wse-sheet-root') || !!document.querySelector('.modal-scrim') || open('readout') || open('layers-panel') || open('display-menu') || open('data-popover')
      || !!document.querySelector('#toasts .wse-toast') || !!document.getElementById('map-status')?.textContent.trim()
      || document.getElementById('app')?.dataset.snap === 'full';
  }

  function next() {
    clearTimeout(timer);
    const hint = HINTS.find((x) => !seen().includes(x.id));
    if (!hint) return;
    const anchor = document.querySelector(hint.anchor);
    if (!anchor || busy() || !stage.isConnected) { timer = setTimeout(next, 1500); return; }
    const my = ++gen;
    el = h('div', { id: 'coach-hint', class: 'coach', role: 'status', 'data-hint': hint.id }, h('p', { class: 'coach-text', text: hint.text }),
      h('button', { type: 'button', class: 'coach-skip', onclick: () => end(null, { all: true }), text: 'Skip tips' }));
    if (reduce()) el.dataset.still = '';
    explainLayer(stage).append(el);
    cur = hint;
    if (!place(hint, el)) { el.remove(); el = null; cur = null; timer = setTimeout(next, 1500); return; } // no clear spot yet: try again later
    if (hint.anchor !== '#map') anchor.classList.add('coach-target');
    const done = () => { if (gen === my) end(hint.id); };
    const targets = [anchor, ...(hint.also ? [document.querySelector(hint.also)] : [])].filter(Boolean);
    if (hint.on) for (const t of targets) { t.addEventListener(hint.on, done, { once: true, capture: true }); cleanup.push(() => t.removeEventListener(hint.on, done, true)); }
    if (hint.bus) cleanup.push(app.bus.on(hint.bus, done));
    if (hint.key) { const k = (e) => { if (hint.key.includes(e.key)) done(); }; anchor.addEventListener('keydown', k); cleanup.push(() => anchor.removeEventListener('keydown', k)); }
    const re = () => { if (el && cur === hint && !place(hint, el)) park(); };
    addEventListener('resize', re); cleanup.push(() => removeEventListener('resize', re));
    // a hint never covers what opened after it: a sheet or a pinned reading puts it away until they close
    const park = () => { for (const f of cleanup) f(); cleanup = []; el?.remove(); el = null; cur = null; document.querySelectorAll('.coach-target').forEach((n) => n.classList.remove('coach-target')); timer = setTimeout(next, 1500); };
    const check = () => { if (gen !== my) return; if (busy() || (el && !place(hint, el))) park(); };
    const watch = setInterval(check, 400);
    cleanup.push(() => clearInterval(watch));
    const mo = new MutationObserver(() => { if (gen === my && busy()) park(); });
    const tz = document.getElementById('toasts'); if (tz) mo.observe(tz, { childList: true });
    const ms = document.getElementById('map-status'); if (ms) mo.observe(ms, { childList: true, characterData: true, subtree: true });
    cleanup.push(() => mo.disconnect());
  }

  function start() {
    if (started) return;
    started = true;
    // after the app is up and the map has been shown for a moment (the legend is at rest, collapsed or open)
    const wait = setInterval(() => {
      const w = window.__wse;
      if (w?.ready && w.storyReady && document.getElementById('app')?.classList.contains('map-ready') && document.querySelector('.tl-play')) { clearInterval(wait); timer = setTimeout(next, 1200); }
    }, 300);
    setTimeout(() => clearInterval(wait), 60000);
  }

  const api = {
    /** Show the tips again (the guide's "Show the tips again"). */
    reset() { prefs.set(KEY, []); gen++; for (const f of cleanup) f(); cleanup = []; el?.remove(); el = null; cur = null; clearTimeout(timer); timer = setTimeout(next, 600); },
    /** The hint on screen now, or null. */
    current: () => (cur ? { id: cur.id, el } : null),
    seen,
    next,
  };
  app.coach = api;
  if (window.__wse?.ui) window.__wse.ui.coach = api;
  if (seen().length < HINTS.length) start();
  return api;
}
