// Layout: the phone bottom sheet with three snap points (peek 170 px, half, full), the scrubber docked to its
// top edge through --sheet-h / --timeline-h, and the map canvas sized to its stage.
import { store } from '../state.js';
import { prefs } from './prefs.js';

export const FULL_BAR = 56; // spec 7.1: the scrubber bar that stays above the content at full
export const PEEK_MAX = 180; // spec 11.1: the peek is as tall as its content, never more than this
// The half snap puts the sheet's top edge at 58% of the viewport height. Spec 11.1 says 54%, but at 54% the chart (under the 44 px
// header, the one row of map tools, the always-visible legend and the 72 px timeline) is about 32% of a 390 x 844 screen, under the
// spec's own 35% guarantee. The guarantee wins: 58% is the smallest whole percent that keeps 35% (measured 35.8%). A reversible
// default taken for Josh to overturn; S-SHELL prints the share at 54% beside it every run.
export const HALF_TOP = 0.58;
export const PEEK_H = PEEK_MAX; // kept for older importers
const VIEW_ROW_H = 60; // the one row of map tools: 12 px inset plus the 48 px glass bar
const SNAPS = ['peek', 'half', 'full'];
// A landscape phone is matched by its short height and touch input, not by width: a 932 x 430 iPhone Pro Max or a 915 x 412 Pixel is wider
// than 899 px and still has no room for the desktop layout. A narrow short window with a mouse keeps the strip too.
const LANDSCAPE_PHONE = '(orientation: landscape) and (max-height: 500px) and (pointer: coarse)';
const LANDSCAPE_NARROW = '(max-width: 899px) and (orientation: landscape) and (max-height: 500px)';
export const phoneQuery = window.matchMedia(`(max-width: 899px), ${LANDSCAPE_PHONE}`);
export const isPhone = () => phoneQuery.matches;
// A phone on its side (spec 4.7, REF-9): the sheet becomes a strip down the left edge, the chart and the scrubber take the rest.
// The same two conditions are in frame.css (the landscape blocks and the desktop divider block); they must agree.
export const landscapeQuery = window.matchMedia(`${LANDSCAPE_NARROW}, ${LANDSCAPE_PHONE}`);
export const isLandscapePhone = () => landscapeQuery.matches;

// The desktop divider (spec 4.7): the story panel is PANEL_MIN to PANEL_MAX wide and folds to a RAIL wide strip. A width the viewer
// sets with the divider is remembered; until then the width follows the window (autoPanelW): PANEL_WEEK where the window has room,
// so the week card's table shows all seven days at 60 px a column (story/daytable.js; the table is the panel less 66 px of padding
// and card edges), never more than PANEL_SHARE of the window, never less than PANEL_DEFAULT, and never past the divider's maximum.
// shell.css gives --panel-w the same width before this module runs, so the first paint already has the panel's real width.
export const PANEL_MIN = 300, PANEL_MAX = 560, PANEL_DEFAULT = 380, PANEL_WEEK = 486, PANEL_SHARE = 0.4, RAIL_W = 44;
/** The panel's width on a `vw` px wide desktop window where the viewer has not set one. */
export const autoPanelW = (vw) => Math.round(Math.min(PANEL_WEEK, Math.max(PANEL_DEFAULT, PANEL_SHARE * vw)));
const KEY_STEP = 16, KEY_BIG = 48, MAP_MIN = 340; // the floor for the map column when its controls cannot be measured
const FIT_SLACK = 4; // px left over beside the measured controls (wider fonts on other platforms)
const WIDEST_STAMP = 'Wed 30 Sep 2026 \u00b7 10:30 pm GMT+10:30'; // the longest first line the scrubber readout can show

export function mountLayout({ appEl, home, handle, stage, canvas, timeline, renderer }) {
  const headerH = () => document.getElementById('topbar')?.getBoundingClientRect().height || 44;
  let peekH = 150; // measured from the focus card whenever the sheet is at peek
  function measurePeek() {
    const card = document.getElementById('focus-card');
    if (!card) return;
    const inset = parseFloat(getComputedStyle(home).paddingBottom) || 0;
    const natural = Math.ceil(handle.offsetHeight + card.offsetHeight + inset);
    peekH = Math.min(PEEK_MAX, natural);
  }
  const snapHeights = () => {
    const H = appEl.clientHeight || window.innerHeight;
    return { peek: peekH, half: Math.round(H * (1 - HALF_TOP)), full: Math.max(peekH, H - headerH() - FULL_BAR) }; // full keeps the 56 px scrubber bar (spec 7.1) above the content
  };
  let current = store.get().sheet || 'peek';

  function setHeight(px) { appEl.style.setProperty('--sheet-h', `${Math.round(px)}px`); }
  // What the person last touched in the panel. When the sheet lowers (full to half, say after a day tap), the body keeps its scroll
  // and its lower part slides off the screen; the touched control is brought back into view once the sheet has stopped moving.
  let touched = null, keepInView = null;
  document.getElementById('home-body')?.addEventListener('pointerdown', (e) => { touched = e.target; }, { capture: true, passive: true });
  function apply(snap) {
    if (isPhone() && SNAPS.indexOf(snap) < SNAPS.indexOf(current) && snap !== 'peek' && touched?.isConnected) {
      // where it sits in the body's content (a re-render may replace the element itself, as the strip does on a day tap)
      const body = document.getElementById('home-body'), r = touched.getBoundingClientRect(), b = body.getBoundingClientRect();
      keepInView = { top: r.top - b.top + body.scrollTop, h: r.height };
    }
    current = snap;
    const land = isLandscapePhone();
    const shown = land ? 'half' : snap; // the strip is always as open as the half sheet: the panel's content, no collapsed card
    appEl.dataset.snap = shown;
    if (snap === 'peek') measurePeek();
    const body = document.getElementById('home-body');
    if (body) body.inert = isPhone() && shown === 'peek';
    handle.setAttribute('aria-label', `Resize panel, now ${snap}`);
    if (land) { appEl.style.removeProperty('--sheet-h'); pad(0); }
    else if (isPhone()) { setHeight(snapHeights()[snap]); pad(snapHeights()[snap]); }
    else { appEl.style.removeProperty('--sheet-h'); pad(0); }
    timeline.dataset.dock = isPhone() ? 'sheet' : '';
    redrawWhenSettled();
  }
  // The sheet and the docked timeline reach their new place a frame or more after --sheet-h changes (a CSS transition,
  // 380 ms or, with reduced motion, a near-instant one that still lands on a later frame). Once both boxes have held still for
  // two frames, the map is refitted once to the room they leave (setPadding redraws when the padding changed).
  let settleRaf = 0;
  function redrawWhenSettled() {
    if (settleRaf) cancelAnimationFrame(settleRaf);
    let last = '', still = 0, n = 0;
    const step = () => {
      settleRaf = 0;
      if (appEl.classList.contains('dragging')) return; // the drag ends in setSnap, which settles again
      const t = timeline.getBoundingClientRect(), h = home.getBoundingClientRect();
      const key = `${t.top}|${t.height}|${h.top}|${h.height}`;
      still = key === last ? still + 1 : 0; last = key;
      if (still < 2 && ++n < 120) { settleRaf = requestAnimationFrame(step); return; }
      pad(isPhone() && !isLandscapePhone() ? snapHeights()[current] : 0);
      revealTouched();
    };
    settleRaf = requestAnimationFrame(step);
  }
  function revealTouched() {
    const k = keepInView; keepInView = null;
    const body = document.getElementById('home-body');
    if (!k || !body) return;
    const b = body.getBoundingClientRect(), visible = Math.min(b.bottom, window.innerHeight) - b.top;
    const top = k.top - body.scrollTop, bottom = top + k.h; // in the body's visible box
    if (bottom > visible) body.scrollTop += Math.min(bottom - visible + 8, top); // the whole control, never its top past the body's
    else if (top < 0) body.scrollTop += top - 8;
  }
  // The map keeps its legend and re-centring clear of the sheet and the docked scrubber.
  function pad(sheetPx) {
    const tl = timeline.getBoundingClientRect().height || 0;
    // top 56 clears the view-switch row; the view is fitted into the rectangle between it and the sheet
    // on its side the strip is beside the stage, not over it: only the scrubber takes room from the chart
    renderer.setPadding?.({ top: isPhone() ? VIEW_ROW_H : 0, bottom: isLandscapePhone() ? Math.round(tl) : isPhone() ? Math.round(sheetPx + tl) : 0 });
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
  let startX = 0, startY = 0, startH = 0, moved = 0, samples = [], pressed = null, dragging = false;
  function begin(el, e) {
    if (!isPhone() || isLandscapePhone() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pressed = el; dragging = false; moved = 0; startX = e.clientX; startY = e.clientY; startH = snapHeights()[current]; samples = [[e.timeStamp, e.clientY]];
  }
  function move(el, e) {
    if (pressed !== el) return;
    moved = Math.max(moved, Math.abs(e.clientY - startY));
    if (!dragging) {
      if (moved < 5) return;
      if (Math.abs(e.clientX - startX) > Math.abs(e.clientY - startY)) { pressed = null; return; } // a mostly horizontal drag is not the sheet's
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
    settle();
  }
  function settle() {
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
  // Dragging from the body: only when it is scrolled to the top (a body scrolled down scrolls, never moves the sheet). Down always
  // collapses; up raises the sheet until it is full, then the body scrolls. Decided on the first move so the browser does not scroll.
  const bodyEl = document.getElementById('home-body');
  let bt = null;
  bodyEl?.addEventListener('touchstart', (e) => {
    if (!isPhone() || isLandscapePhone() || current === 'peek' || e.touches.length !== 1) { bt = null; return; }
    bt = { x: e.touches[0].clientX, y: e.touches[0].clientY, top: bodyEl.scrollTop <= 0, mode: null, h: snapHeights()[current], s: [[e.timeStamp, e.touches[0].clientY]] };
  }, { passive: true });
  bodyEl?.addEventListener('touchmove', (e) => {
    if (!bt) return;
    const y = e.touches[0].clientY, dy = y - bt.y, dx = e.touches[0].clientX - bt.x;
    if (!bt.mode) {
      if (Math.max(Math.abs(dy), Math.abs(dx)) < 4) return;
      // axis lock (spec 14.3): the sheet is claimed only by a mostly vertical drag; a horizontal one never moves it
      bt.mode = Math.abs(dy) > Math.abs(dx) && bt.top && (dy > 0 || current !== 'full') ? 'sheet' : 'scroll';
      if (bt.mode === 'sheet') appEl.classList.add('dragging');
    }
    if (bt.mode !== 'sheet') return;
    if (e.cancelable) e.preventDefault();
    const hs = snapHeights();
    setHeight(Math.min(hs.full, Math.max(hs.peek, bt.h - dy)));
    bt.s.push([e.timeStamp, y]); if (bt.s.length > 5) bt.s.shift();
  }, { passive: false });
  const bodyEnd = () => {
    const t = bt; bt = null;
    if (!t || t.mode !== 'sheet') return;
    appEl.classList.remove('dragging');
    samples = t.s.map(([ts, yy]) => [ts, yy]);
    settle();
  };
  bodyEl?.addEventListener('touchend', bodyEnd);
  bodyEl?.addEventListener('touchcancel', bodyEnd);
  const card2 = document.getElementById('focus-card');
  if (card2) new MutationObserver(() => { if (current === 'peek' && isPhone()) { measurePeek(); apply('peek'); } }).observe(card2, { childList: true, subtree: true, characterData: true });
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { setSnap(SNAPS[Math.min(2, SNAPS.indexOf(current) + 1)]); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { setSnap(SNAPS[Math.max(0, SNAPS.indexOf(current) - 1)]); e.preventDefault(); }
  });

  // the renderer sizes its own canvas; the timeline height feeds the docked layout
  new ResizeObserver(() => { appEl.style.setProperty('--timeline-h', `${Math.round(timeline.getBoundingClientRect().height)}px`); pad(isPhone() && !isLandscapePhone() ? snapHeights()[current] : 0); redrawWhenSettled(); }).observe(timeline);
  const reapply = () => { apply(current); paintPanel(); };
  window.addEventListener('resize', reapply);
  phoneQuery.addEventListener('change', reapply);
  landscapeQuery.addEventListener('change', reapply);

  // ---------- desktop divider and fold ----------
  const divider = document.getElementById('divider');
  // the viewer's width, or null to follow the window. Older builds wrote the key 'panelW' on every fold as well as on a resize,
  // so its fixed default (380) there is no choice; any other value there is one.
  const legacyW = Number(prefs.get('panelW', 0));
  let panelW = Number(prefs.get('panelWidth', 0)) || (legacyW && legacyW !== PANEL_DEFAULT ? legacyW : null);
  let folded = prefs.get('panelFolded', false) === true;
  // The widest the panel may be: the map column must keep the room its own controls need. That is the one row of map tools (Layers
  // and Expand, and Reset when shown, beside the view switch) and the scrubber's header (its fixed buttons plus the readout's widest
  // first line), measured from the real elements, plus FIT_SLACK. The column's width is the window less the panel and fixed chrome, so
  // the maximum is the panel's current width plus the column's spare room; the same value whether the panel is open or folded.
  let ruler = null;
  function mapColumnNeed() {
    const tools = document.getElementById('map-tools'), head = timeline.querySelector('.tl-head'), line1 = head?.querySelector('.tl-line1');
    const row = (el) => { const k = [...el.children].filter((c) => c.getClientRects().length); return k.reduce((n, c) => n + c.getBoundingClientRect().width, 0) + Math.max(0, k.length - 1) * (parseFloat(getComputedStyle(el).columnGap) || 0); };
    let need = MAP_MIN;
    if (tools) { // children of .tools-end stand in for it, so the row is counted as it lays out when nothing is squeezed
      const gap = parseFloat(getComputedStyle(tools).columnGap) || 0, end = tools.querySelector('.tools-end');
      const parts = [...tools.children].filter((c) => c.getClientRects().length).map((c) => (c === end ? row(end) : c.getBoundingClientRect().width));
      const inset = parseFloat(getComputedStyle(tools).left) || 0;
      need = Math.max(need, parts.reduce((n, w) => n + w, 0) + Math.max(0, parts.length - 1) * gap + 2 * inset);
    }
    if (head && line1) {
      const cs = getComputedStyle(line1), time = line1.closest('.tl-time'), tcs = time && getComputedStyle(time);
      ruler ||= document.createElement('canvas').getContext('2d');
      ruler.font = cs.font;
      const readout = Math.max(ruler.measureText(WIDEST_STAMP).width, line1.scrollWidth) + (tcs ? parseFloat(tcs.paddingLeft) + parseFloat(tcs.paddingRight) : 16);
      // every flex item takes a gap, the empty spacer too; the readout stands at its widest, the other items at their own width
      const items = [...head.children].filter((c) => c.getClientRects().length), hgap = parseFloat(getComputedStyle(head).columnGap) || 0;
      const fixed = items.filter((c) => c !== time).reduce((n, c) => n + c.getBoundingClientRect().width, 0);
      const tcsr = getComputedStyle(timeline);
      need = Math.max(need, fixed + readout + Math.max(0, items.length - 1) * hgap + (parseFloat(tcsr.paddingLeft) || 0) + (parseFloat(tcsr.paddingRight) || 0));
    }
    return Math.ceil(need) + FIT_SLACK;
  }
  const maxW = () => {
    let room = window.innerWidth - MAP_MIN;
    const stage = document.getElementById('stage'), hw = home.getBoundingClientRect().width;
    if (stage && hw > 0 && !appEl.hasAttribute('data-expanded') && !isPhone()) {
      const col = Math.min(stage.getBoundingClientRect().width, timeline.getBoundingClientRect().width);
      room = hw + col - mapColumnNeed();
    }
    return Math.round(Math.max(PANEL_MIN, Math.min(PANEL_MAX, room)));
  };
  const clampW = (w) => Math.round(Math.min(maxW(), Math.max(PANEL_MIN, w)));
  const curW = () => clampW(panelW ?? autoPanelW(window.innerWidth));
  let foldBtn = null;
  if (divider) {
    divider.setAttribute('aria-label', 'Resize story panel');
    divider.setAttribute('aria-controls', 'home');
    divider.tabIndex = 0;
    divider.title = 'Drag to resize. Double-click to fold.';
    foldBtn = document.createElement('button');
    foldBtn.id = 'btn-fold'; foldBtn.type = 'button'; foldBtn.className = 'icon-btn';
    foldBtn.setAttribute('aria-controls', 'home');
    foldBtn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9.5 5v14" stroke="currentColor" stroke-width="1.6"/></svg><span class="fold-label">Panel</span>'; // visible text (spec 3.1: no icon-only control); it sits inside the name "Hide the story panel"
    document.getElementById('topbar')?.prepend(foldBtn);
  }
  function paintPanel() {
    if (!divider) return;
    const desktop = !isPhone();
    divider.hidden = !desktop; if (foldBtn) foldBtn.hidden = !desktop;
    if (!desktop) { appEl.style.removeProperty('--panel-w'); appEl.removeAttribute('data-folded'); return; }
    const w = folded ? RAIL_W : curW();
    appEl.style.setProperty('--panel-w', `${w}px`);
    if (folded) appEl.setAttribute('data-folded', ''); else appEl.removeAttribute('data-folded');
    divider.setAttribute('aria-valuemin', String(PANEL_MIN)); divider.setAttribute('aria-valuemax', String(maxW()));
    divider.setAttribute('aria-valuenow', String(w));
    divider.setAttribute('aria-valuetext', folded ? 'Panel folded' : `${w} pixels wide`);
    if (foldBtn) {
      foldBtn.setAttribute('aria-label', folded ? 'Show the story panel' : 'Hide the story panel');
      foldBtn.setAttribute('aria-expanded', folded ? 'false' : 'true');
      foldBtn.title = folded ? 'Show the story panel' : 'Hide the story panel';
    }
  }
  function setPanel(w, { save = true } = {}) { panelW = clampW(w); folded = false; if (save) saveHome(); paintPanel(); }
  function setFolded(f) { folded = !!f; saveHome(); paintPanel(); }
  function saveHome() { if (panelW != null) prefs.set('panelWidth', panelW); prefs.set('panelFolded', folded); }
  if (divider) {
    let drag = null, raf = 0;
    divider.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault(); divider.focus({ preventScroll: true });
      drag = { x: e.clientX, w: curW(), moved: false };
      try { divider.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ }
    });
    divider.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (!drag.moved && Math.abs(e.clientX - drag.x) < 3) return; // a click or a double-click is not a drag
      drag.moved = true;
      appEl.classList.add('resizing');
      const w = clampW(drag.w + e.clientX - drag.x);
      panelW = w; folded = false;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; paintPanel(); });
    });
    const endDrag = () => {
      if (!drag) return;
      const moved = drag.moved; drag = null; appEl.classList.remove('resizing');
      if (moved) { if (raf) { cancelAnimationFrame(raf); raf = 0; } saveHome(); paintPanel(); }
    };
    divider.addEventListener('pointerup', endDrag);
    divider.addEventListener('pointercancel', endDrag);
    divider.addEventListener('dblclick', (e) => { e.preventDefault(); setFolded(!folded); });
    divider.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const step = e.shiftKey ? KEY_BIG : KEY_STEP, cur = curW();
      let handled = true;
      if (e.key === 'ArrowRight') { if (folded) setFolded(false); else setPanel(cur + step); }
      else if (e.key === 'ArrowLeft') { if (folded) setFolded(false); else setPanel(cur - step); }
      else if (e.key === 'Home') setPanel(PANEL_MIN);
      else if (e.key === 'End') setPanel(maxW());
      else if (e.key === 'Enter') setFolded(!folded);
      else handled = false;
      if (handled) { e.preventDefault(); e.stopPropagation(); }
    });
    foldBtn.addEventListener('click', () => setFolded(!folded));
    home.addEventListener('click', (e) => { if (folded && !isPhone() && e.target === home) setFolded(false); }); // the rail itself opens the panel
    store.subscribe((s, p) => { if ('expanded' in p) paintPanel(); });
  }
  apply(current);
  paintPanel();
  return { setSnap, snap: () => current, setPanelWidth: (w) => setPanel(w), foldPanel: setFolded, panelWidth: () => (folded ? RAIL_W : curW()) };
}
