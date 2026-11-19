// Layout: the phone bottom sheet with three snap points (peek 170 px, half, full), the scrubber docked to its
// top edge through --sheet-h / --timeline-h, and the map canvas sized to its stage.
import { store } from '../state.js';

export const PEEK_H = 170; // the 44 px handle plus the focus card
const VIEW_ROW_H = 56;
const SNAPS = ['peek', 'half', 'full'];
export const phoneQuery = window.matchMedia('(max-width: 899px)');
export const isPhone = () => phoneQuery.matches;

export function mountLayout({ appEl, home, handle, stage, canvas, timeline, renderer }) {
  const snapHeights = () => {
    const H = appEl.clientHeight || window.innerHeight;
    const top = 48; // header
    return { peek: PEEK_H, half: Math.round(H * 0.5), full: Math.max(PEEK_H, H - top - 44) }; // full keeps the 44 px scrubber bar above the content
  };
  let current = store.get().sheet || 'peek';

  function setHeight(px) { appEl.style.setProperty('--sheet-h', `${Math.round(px)}px`); }
  function apply(snap) {
    current = snap;
    appEl.dataset.snap = snap;
    const body = document.getElementById('home-body');
    if (body) body.inert = isPhone() && snap === 'peek';
    handle.setAttribute('aria-label', `Resize panel, now ${snap}`);
    if (isPhone()) { setHeight(snapHeights()[snap]); pad(snapHeights()[snap]); }
    else { appEl.style.removeProperty('--sheet-h'); pad(0); }
    timeline.dataset.dock = isPhone() ? 'sheet' : '';
  }
  // The map keeps its legend and re-centring clear of the sheet and the docked scrubber.
  function pad(sheetPx) {
    const tl = timeline.getBoundingClientRect().height || 0;
    // top 56 clears the view-switch row; the view is fitted into the rectangle between it and the sheet
    renderer.setPadding?.({ top: isPhone() ? VIEW_ROW_H : 0, bottom: isPhone() ? Math.round(sheetPx + tl) : 0 });
  }
  function setSnap(snap) {
    if (!SNAPS.includes(snap)) return;
    apply(snap);
    if (store.get().sheet !== snap) store.set({ sheet: snap });
  }
  store.subscribe((s, p) => { if ('sheet' in p && s.sheet !== current) apply(s.sheet); });

  // Dragging the sheet: from the handle (a 44 px strip) or from anywhere on the focus card. A press only becomes a
  // drag after 5 px of movement, so taps still reach the buttons on the card.
  const card = document.getElementById('focus-card');
  let startY = 0, startH = 0, moved = 0, samples = [], pressed = null, dragging = false;
  function begin(el, e) {
    if (!isPhone() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pressed = el; dragging = false; moved = 0; startY = e.clientY; startH = snapHeights()[current]; samples = [[e.timeStamp, e.clientY]];
  }
  function move(el, e) {
    if (pressed !== el) return;
    moved = Math.max(moved, Math.abs(e.clientY - startY));
    if (!dragging) {
      if (moved < 5) return;
      dragging = true;
      try { el.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ }
      appEl.classList.add('dragging');
    }
    const hs = snapHeights();
    setHeight(Math.min(hs.full, Math.max(hs.peek, startH + (startY - e.clientY)))); // the map is refitted when the sheet settles
    samples.push([e.timeStamp, e.clientY]); if (samples.length > 5) samples.shift();
  }
  function end(el, e) {
    if (pressed !== el) return;
    pressed = null;
    if (!dragging) {
      if (el === handle) setSnap(SNAPS[(SNAPS.indexOf(current) + 1) % 3]); // a tap: step up, wrapping from full to peek
      else if (current === 'peek' && !e.target.closest?.('button, a, input, textarea, select')) setSnap('half');
      return;
    }
    dragging = false;
    appEl.classList.remove('dragging');
    const hs = snapHeights();
    const nowH = parseFloat(getComputedStyle(appEl).getPropertyValue('--sheet-h')) || hs[current];
    const a = samples[0], b = samples[samples.length - 1];
    const v = b && a && b[0] > a[0] ? (a[1] - b[1]) / (b[0] - a[0]) : 0; // px per ms, up positive
    const target = nowH + v * 180;
    let best = 'peek', bd = Infinity;
    for (const k of SNAPS) { const d = Math.abs(hs[k] - target); if (d < bd) { bd = d; best = k; } }
    setSnap(best);
  }
  for (const el of [handle, card].filter(Boolean)) {
    el.addEventListener('pointerdown', (e) => begin(el, e));
    el.addEventListener('pointermove', (e) => move(el, e));
    el.addEventListener('pointerup', (e) => end(el, e));
    el.addEventListener('pointercancel', (e) => { if (pressed === el) { pressed = null; if (dragging) { dragging = false; appEl.classList.remove('dragging'); setSnap(current); } } });
  }
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { setSnap(SNAPS[Math.min(2, SNAPS.indexOf(current) + 1)]); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { setSnap(SNAPS[Math.max(0, SNAPS.indexOf(current) - 1)]); e.preventDefault(); }
  });

  // the renderer sizes its own canvas; the timeline height feeds the docked layout
  new ResizeObserver(() => { appEl.style.setProperty('--timeline-h', `${Math.round(timeline.getBoundingClientRect().height)}px`); pad(snapHeights()[current]); }).observe(timeline);
  const reapply = () => apply(current);
  window.addEventListener('resize', reapply);
  phoneQuery.addEventListener('change', reapply);
  apply(current);
  return { setSnap, snap: () => current };
}
