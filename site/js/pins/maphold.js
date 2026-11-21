// Map gestures for pins: press and hold adds a place at the nearest gazetteer city; a tap on a dot focuses it.
// Listens only (never preventDefault on pointer events) so the renderer's pan and pinch keep working: any movement or
// second finger cancels the hold.
import { h } from './dom.js';
import { pins as defaultPins } from './index.js';
import * as gaz from './gazetteer.js';
import { addedToast } from './toast.js';

export const HOLD_MS = 550, SLOP = 6, TAP_MS = 350; // 6 px: a hold that moves further is a pan or a pinch, never an add

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{renderer:object, overlay?:{hits:Array}, pins?:object, gazetteer?:object, onEdit?:Function, holdMs?:number}} o
 * @returns {() => void} detach
 */
export function attachMapHold(canvas, { renderer, overlay = null, pins = defaultPins, gazetteer = gaz, onEdit = null, holdMs = HOLD_MS } = {}) {
  canvas.classList.add('pn-holdable');
  let g = null, ring = null;

  const cancel = () => { if (g) { clearTimeout(g.timer); g = null; } if (ring) { ring.remove(); ring = null; } };
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  async function addAt(x, y) {
    const ll = renderer.invert([x, y]);
    if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return;
    const city = await gazetteer.nearest(ll[1], ll[0]);
    if (!city) return;
    const id = pins.add({ kind: 'place', name: city.name, group: '', city });
    if (!id) return;
    try { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(12); } catch { /* not supported */ }
    addedToast({ ok: true, kind: 'place', id, summary: gaz.cityLabel(city) }, { pins, onEdit });
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (g) { cancel(); return; } // a second finger: this is a pinch
    const [x, y] = local(e);
    g = { id: e.pointerId, x, y, t: performance.now(), fired: false };
    ring = h('div', { class: 'pn-hold' });
    ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px';
    document.body.append(ring);
    requestAnimationFrame(() => ring && ring.classList.add('go'));
    const mine = g;
    g.timer = setTimeout(() => {
      if (g !== mine) return;
      mine.fired = true;
      ring?.classList.add('done');
      const { x: hx, y: hy } = mine;
      setTimeout(() => { if (ring) { ring.remove(); ring = null; } }, 220);
      addAt(hx, hy);
    }, holdMs);
  }
  function onMove(e) {
    if (!g || e.pointerId !== g.id || g.fired) return;
    const [x, y] = local(e);
    if (Math.hypot(x - g.x, y - g.y) > SLOP) cancel();
  }
  function onUp(e) {
    if (!g || e.pointerId !== g.id) return;
    const was = g;
    const [x, y] = local(e);
    const quick = performance.now() - was.t < TAP_MS && Math.hypot(x - was.x, y - was.y) <= SLOP;
    cancel();
    if (!was.fired && quick) tap(x, y);
  }
  function tap(x, y) {
    const hits = overlay?.hits || [];
    let best = null, bd = Infinity;
    for (const hit of hits) { const d = Math.hypot(hit.x - x, hit.y - y); if (d <= hit.r && d < bd) { best = hit; bd = d; } }
    if (!best) return;
    if (best.ids.length > 1) { if (best.lat !== undefined) renderer.centreOn?.(best.lat, best.lon); return; }
    pins.focus(best.ids[0]);
  }
  const noMenu = (e) => e.preventDefault();

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('pointerleave', cancel);
  canvas.addEventListener('contextmenu', noMenu);
  return () => {
    cancel();
    canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', cancel); canvas.removeEventListener('pointerleave', cancel); canvas.removeEventListener('contextmenu', noMenu);
    canvas.classList.remove('pn-holdable');
  };
}
