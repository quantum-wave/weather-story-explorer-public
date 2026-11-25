// The Briefing, wired into the app (C1-04). One call, mountBriefing(app), from main.js after the story is ready:
//   builds the script from the live app (script.js gatherInput + buildScript), shows the entry pill in the stage, and on open connects
//   the player (player.js) to the card (card.js). While open the briefing owns the chart (rule H8): the map tools are hidden, the
//   timeline is inert, a transparent tap layer takes the left and right thirds and blocks pan, pinch and wheel, and one capture-phase
//   key handler on window takes Space, the arrows, Escape, F, 1-4, plus, minus and 0 so none of them reaches the app.
//   Returns { open, close, isOpen, script, player, testRate, refresh }; main.js puts it at window.__wse.ui.brief.
// Everything is relative and same-origin: the stylesheet is new URL('../../css/brief.css', import.meta.url), nothing is fetched here.
import { BRIEF_KEY } from './contract.js';
import { buildScript, gatherInput, digestOf } from './script.js';
import { createMemory } from './memory.js';
import { createPlayer } from './player.js';
import { mountCard } from './card.js';
import { mountPill } from './pill.js';

const CSS_HREF = new URL('../../css/brief.css', import.meta.url).href;
const SWALLOW = new Set([' ', 'ArrowLeft', 'ArrowRight', 'Escape', 'f', 'F', '1', '2', '3', '4', '+', '=', '-', '_', '0']);
const TAP_SLOP = 10;   // px a press may move and still be a tap
const TAP_MAX_MS = 700;
const RESTORE_HASH_MS = 650;

function ensureCss() {
  if (document.getElementById('wse-brief-css')) return;
  const link = document.createElement('link');
  link.id = 'wse-brief-css'; link.rel = 'stylesheet'; link.href = CSS_HREF;
  document.head.append(link);
}

const typing = (el) => !!el && el.tagName && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true);
const isPhone = () => { try { return matchMedia('(max-width: 899px)').matches; } catch { return false; } };

/** "Thu 19 Nov, 3 pm" in the viewer's own zone: the valid date and time of the forecast hour on screen. */
function dateText(app, t) {
  try {
    const d = app.data.validTime(t, app.data.activeCase?.());
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d).map((p) => [p.type, p.value]));
    return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod || '').toLowerCase()}`.trim();
  } catch { return ''; }
}
/** The viewer's local calendar day (YYYY-MM-DD) of a forecast hour, the key the strip's day classes use. */
function localDay(app, t) {
  try {
    const d = app.data.validTime(t, app.data.activeCase?.());
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  } catch { return ''; }
}

/** The briefing's memory over the browser's storage; none when the storage is blocked (the feature is then off, without an error). */
function memoryOf() { try { return createMemory(localStorage); } catch { return null; } }

function readBrief() { try { return JSON.parse(localStorage.getItem(BRIEF_KEY)); } catch { return null; } }

/** The pill's words (the acceptance order: a friend's link, recorded data, a run not yet played, else the length). */
function pillWords(app, input, script) {
  const m = input?.manifest || app.manifest || app.data.getManifest();
  const live = !!input?.live;
  if (input?.friendPlace) return { text: `Play the briefing for ${input.friendPlace.city || input.friendPlace.name || 'this place'}`, isNew: false };
  if (!live) return { text: 'Play briefing · recorded forecast', isNew: false };
  const seen = readBrief();
  if (!seen || seen.run !== m?.run) {
    const g = Date.parse(String(m?.generated || '').replace(/Z$/, ':00Z').replace(/(:\d\d):00Z$/, '$1Z'));
    let when = '';
    if (Number.isFinite(g)) {
      const d = new Date(g);
      when = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      if (d.toDateString() !== new Date(app.now ? app.now() : Date.now()).toDateString()) when = `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${when}`;
    }
    return { text: when ? `briefing · updated ${when}` : 'briefing · updated', isNew: true };
  }
  const mins = Math.max(1, Math.round((script?.totalMs || 60000) / 60000));
  return { text: `Play briefing · about ${mins} min`, isNew: false };
}

export function mountBriefing(app) {
  ensureCss();
  const { store, renderer } = app;
  const stage = document.getElementById('stage') || document.body;
  const appEl = document.getElementById('app');
  let input = null, script = null, st = null, building = 0, opening = false, destroyed = false, rebuildTimer = 0;
  const api = { testRate: 1 };

  // ---------- the pill ----------
  const blocked = () => !!document.querySelector('.wse-sheet-root') || !!document.querySelector('.modal-scrim')
    || (() => { const p = document.getElementById('layers-panel'); return !!p && !p.hidden; })();
  const pill = mountPill(stage, { onOpen: () => { open(); } });
  const pillEl = () => document.getElementById('brief-pill');
  /** A reading pinned on the map (a tap) owns the stage's lower corner while it is open: the pill steps out of its way. */
  const readoutPinned = () => { const r = document.getElementById('readout'); return !!r && !r.hidden && r.dataset.mode === 'pinned'; };
  function paintPill() {
    if (destroyed) return;
    if (!script) { const el = pillEl(); if (el) el.hidden = true; return; }
    const w = pillWords(app, input, script);
    pill.set({ text: w.text, isNew: w.isNew, inert: blocked() || opening });
    const el = pillEl(); if (el) el.hidden = !!st || readoutPinned();
  }
  /** The pill stands on the legend: its bottom edge 8 px above the legend's top, or above the timeline when there is none. */
  function placePill() {
    const el = pillEl(); if (!el) return;
    const sr = stage.getBoundingClientRect();
    const lg = stage.querySelector('.mlg');
    const lr = lg && lg.getClientRects().length ? lg.getBoundingClientRect() : null;
    const tl = store.get().expanded ? (document.getElementById('timeline')?.getBoundingClientRect().height || 0) : 0;
    const floor = Math.round(12 + tl);
    const bottom = lr ? Math.max(floor, Math.round(sr.bottom - lr.top + 8)) : floor;
    el.style.bottom = `${bottom}px`;
    // a stage squeezed by a tall sheet has no room under the tools row: the pill steps aside rather than be cut off
    el.style.visibility = sr.height >= bottom + el.offsetHeight + 64 ? '' : 'hidden';
  }
  // The legend moves without changing size when the sheet or the timeline changes, so a trigger starts a short burst of frames that
  // re-place the pill until the layout has settled (the sheet's own transition is 380 ms).
  let placeRaf = 0, burst = 0;
  const placeSoon = () => {
    burst = 36;
    if (placeRaf) return;
    const step = () => { placeRaf = 0; placePill(); if (--burst > 0) placeRaf = requestAnimationFrame(step); };
    placeRaf = requestAnimationFrame(step);
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(placeSoon) : null;
  for (const e of [stage, stage.querySelector('.mlg'), document.getElementById('home'), document.getElementById('timeline')]) if (e) ro?.observe(e);
  const unPlace = store.subscribe((_s, patch) => { if (patch && ('expanded' in patch || 'sheet' in patch || 'view' in patch || 'lens' in patch)) placeSoon(); });
  addEventListener('resize', placeSoon);
  placeSoon();
  async function rebuild() {
    const mine = ++building;
    try {
      const next = await gatherInput(app);
      if (mine !== building || destroyed) return false; // a newer build is on its way
      // the digest of an earlier run, when the browser holds one: live data only, never a friend's link
      next.previous = next.live && !next.friendPlace && next.manifest?.run ? memoryOf()?.previous(next.manifest.run) ?? null : null;
      input = next; script = buildScript(next);
    } catch (e) { console.warn('briefing: could not build the script', e?.stack || e); if (!script) return false; }
    paintPill();
    return true;
  }
  const rebuildSoon = () => { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(() => { if (!st && !opening) rebuild(); }, 300); };
  app.bus?.on?.('pins:changed', rebuildSoon);
  app.bus?.on?.('data:manifest', rebuildSoon);
  let wasBlocked = blocked();
  // paintPill itself mutates the DOM: only a change in what blocks the briefing repaints it, or the observer would feed itself
  const mo = new MutationObserver(() => { const b = blocked(); if (b !== wasBlocked) { wasBlocked = b; paintPill(); } });
  mo.observe(document.body, { childList: true, subtree: true });
  const lp = document.getElementById('layers-panel');
  if (lp) mo.observe(lp, { attributes: true, attributeFilter: ['hidden'] });
  // the same discipline for the pinned reading: only a change in whether one is open repaints the pill
  let wasPinned = readoutPinned();
  const rmo = new MutationObserver(() => { const p = readoutPinned(); if (p !== wasPinned) { wasPinned = p; paintPill(); } });
  rmo.observe(stage, { attributes: true, subtree: true, attributeFilter: ['hidden', 'data-mode'] });

  // ---------- opening ----------
  async function open() {
    if (st || opening || blocked()) return false;
    opening = true; paintPill();
    try {
      for (let i = 0; i < 4; i++) if (await rebuild()) break; // opens on a script built after the last change, never a stale one
      if (!script || blocked()) return false;
      start();
      return true;
    } finally { opening = false; paintPill(); }
  }

  function start() {
    hold?.stop(); // a pan and zoom still held from the last Close gives way to the new briefing
    const sc = script, inp = input;
    const rate = Number(api.testRate) > 0 ? Number(api.testRate) : 1;
    const hash0 = location.hash;
    const s = { sc, inp, hash0, player: null, card: null, taps: null, offs: [], zone: null, drawnDay: undefined, closed: false };
    st = s;
    try { s.xf0 = renderer.getTransform(); } catch { s.xf0 = null; }
    appEl.setAttribute('data-brief', '');
    guardPadding();
    const player = createPlayer({ app, script: sc, rate });
    s.player = player;
    const card = mountCard(stage, {
      onPause: () => player.pause(), onResume: () => player.resume(), onNext: () => player.next(), onPrev: () => player.prev(),
      onClose: () => close(), onStay: () => close({ stay: true }), onReplay: () => player.goTo(0),
      onAdd: () => { close(); try { app.openAddSheet?.({}); } catch { /* the sheet is optional */ } },
    });
    s.card = card;
    const cardEl = document.getElementById('brief-card');
    // the chart's tap layer
    const taps = document.createElement('div'); taps.id = 'brief-taps'; taps.setAttribute('aria-hidden', 'true');
    stage.insertBefore(taps, cardEl); s.taps = taps;
    wireTaps(s);
    const onResize = () => { fixHeight(s); layoutVars(s); };
    addEventListener('resize', onResize); s.offs.push(() => removeEventListener('resize', onResize));
    const onKey = (e) => handleKey(e, s);
    window.addEventListener('keydown', onKey, true); s.offs.push(() => window.removeEventListener('keydown', onKey, true));
    const un1 = store.subscribe((_s, patch) => {
      if (!patch) return;
      if ('t' in patch) timeChanged(s);
      // the strip is painted in the map colours and the theme's ground: repaint it when either changes mid-briefing
      if ('colors' in patch || 'theme' in patch) { const b = s.player.beat(); if (b && b.strip) drawStrip(s, b, true); }
    }); s.offs.push(un1);
    s.offs.push(player.on('beat', ({ index, beat }) => showBeat(s, index, beat)));
    s.offs.push(player.on('tick', ({ t, progress }) => { card.setProgress(progress); zoneCaption(s, t); }));
    s.offs.push(player.on('state', ({ state }) => { card.setState(state); if (state === 'ended') { card.setProgress(1); card.setDate(''); remember(s); paintPill(); } }));
    s.offs.push(player.on('exit', ({ stay }) => teardown(s, stay)));
    paintPill();
    player.start(); // expanded now: the card, the timeline and the legend sit where they will stay, so they can be measured
    // one height for every beat: the card never jumps, and the chart's fitted frame never moves between beats
    fixHeight(s);
    layoutVars(s);
  }

  /** A briefing that played to its end on live data keeps its digest (a run already kept is not kept twice). */
  function remember(s) {
    if (!s.inp?.live || s.inp.friendPlace || !s.sc.run) return;
    try { memoryOf()?.save(s.sc.run, digestOf(s.inp), s.sc.dataLabel); } catch { /* storage may be blocked */ }
  }

  /** Lay every beat out once, hidden, and give the card the tallest one's height. */
  function fixHeight(s) {
    const el = document.getElementById('brief-card'); if (!el) return;
    const keep = { b: s.player.beat(), i: s.player.index() };
    const live = el.querySelector('.brief-live'), liveAttr = live?.getAttribute('aria-live');
    live?.removeAttribute('aria-live'); // laying every beat out must not read every beat aloud
    el.style.visibility = 'hidden'; el.style.minHeight = '';
    let max = 0;
    s.sc.beats.forEach((b, i) => {
      s.card.show(b, s.sc, i); drawStrip(s, b, true); s.card.setDate(b.chapter === 'title' || b.chapter === 'end' ? '' : 'Thu 19 Nov, 12:00 pm');
      max = Math.max(max, el.getBoundingClientRect().height);
    });
    el.style.minHeight = `${Math.ceil(max)}px`;
    el.style.visibility = '';
    if (keep.b) { s.card.show(keep.b, s.sc, keep.i); drawStrip(s, keep.b, true); timeChanged(s); s.card.setState(s.player.state()); }
    if (live && liveAttr) live.setAttribute('aria-live', liveAttr);
  }

  /** The room the card and the timeline take: the stage's bottom dock, the legend's lift, the renderer's bottom padding. */
  function layoutVars(s) {
    const el = document.getElementById('brief-card'); if (!el) return;
    const tl = document.getElementById('timeline')?.getBoundingClientRect().height || 0;
    const h = el.getBoundingClientRect().height;
    const phone = isPhone();
    appEl.style.setProperty('--brief-dock', `${Math.round(tl + 12)}px`);
    appEl.style.setProperty('--brief-dock-wide', `${Math.round(tl + 16)}px`); // 700 px and up: the card stands on the timeline
    appEl.style.setProperty('--brief-tl', `${Math.round(tl)}px`);
    appEl.style.setProperty('--brief-card-h', `${Math.round(h)}px`);
    mine = { top: phone ? 56 : 12, bottom: Math.round(h + tl) };
    renderer.setPadding?.(mine);
  }
  // The layout calls setPadding again a few frames after the briefing opens (it measures the hidden sheet): while the briefing is open
  // the chart keeps the room the card and the timeline leave, whoever asks.
  let mine = null, origPad = null;
  function guardPadding() {
    if (origPad || typeof renderer.setPadding !== 'function') return;
    origPad = renderer.setPadding;
    renderer.setPadding = function setPadding(p) { return origPad.call(renderer, mine || p); };
  }
  function releasePadding() { if (origPad) { renderer.setPadding = origPad; origPad = null; } mine = null; }

  // After Close the layout asks for its padding again a few frames later, and a zoomed chart re-centres on the focus each time.
  // The recorded pan and zoom go back in answer to each such call (and only then), until the layout has been quiet for 45 frames or the
  // person acts: any key, press or wheel on the page, a change of view, lens or focus, or a move of the chart that is not the hold's own
  // (Reset view, a centre on a place). What the person chooses after Close is never overwritten by what came before the briefing.
  let hold = null;
  function holdTransform(xf) {
    if (hold) hold.stop();
    if (typeof renderer.setPadding !== 'function' || typeof renderer.setTransform !== 'function') return;
    const closing = typeof window.event === 'object' ? window.event : null; // the key or press that closed the briefing is no new act
    const wrapped = [];
    let quiet = 0, raf = 0, done = false, putting = false;
    const put = () => { putting = true; try { renderer.setTransform(xf, 0); } catch { /* the chart is gone */ } finally { putting = false; } };
    const wrap = (name, make) => {
      const orig = renderer[name]; if (typeof orig !== 'function') return;
      const fn = make(orig); wrapped.push({ name, orig, fn }); renderer[name] = fn;
    };
    wrap('setPadding', (orig) => function setPadding(p) { quiet = 0; const r = orig.call(renderer, p); if (!done) put(); return r; });
    for (const name of ['setTransform', 'resetView', 'centreOn']) wrap(name, (orig) => function moved(...a) { if (!putting) stop(); return orig.apply(renderer, a); });
    const act = (e) => { if (e !== closing) stop(); };
    const kinds = ['pointerdown', 'keydown', 'wheel'];
    for (const k of kinds) window.addEventListener(k, act, true);
    const unStore = store.subscribe((_s, patch) => { if (patch && ('view' in patch || 'lens' in patch || 'focus' in patch)) stop(); });
    function stop() {
      if (done) return; done = true; cancelAnimationFrame(raf);
      for (const w of wrapped) if (renderer[w.name] === w.fn) renderer[w.name] = w.orig;
      for (const k of kinds) window.removeEventListener(k, act, true);
      try { unStore(); } catch { /* the store is gone */ }
      if (hold && hold.stop === stop) hold = null;
    }
    hold = { stop };
    put();
    const tick = () => { if (done) return; if (++quiet >= 45) { stop(); return; } raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  }

  function restorePadding() {
    const tl = document.getElementById('timeline')?.getBoundingClientRect().height || 0;
    if (store.get().expanded) renderer.setPadding?.({ top: isPhone() ? 56 : 0, bottom: Math.round(tl) });
    else app.layout?.setSnap?.(store.get().sheet || 'peek');
  }

  // ---------- what the card shows ----------
  function drawStrip(s, b, force) {
    if (!b || !b.strip) { s.card.setStrip(''); s.drawnDay = undefined; return; }
    const days = s.inp?.days?.[b.place?.key];
    if (!days || !days.length) { s.card.setStrip(''); return; }
    const t = store.get().t;
    const today = localDay(app, t);
    const active = days.findIndex((d) => d.date === today);
    if (!force && active === s.drawnDay) return;
    s.drawnDay = active;
    const el = document.getElementById('brief-card');
    const cs = el ? getComputedStyle(el) : null;
    const width = Math.max(200, Math.floor((el?.clientWidth || 340) - (cs ? parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) : 28)));
    const first7 = days.slice(0, 7);
    let svg;
    try { svg = app.story.stripSVG(first7, days.series, { compact: true, range: 7, phone: isPhone(), width, activeDay: active >= 0 && active < 7 ? active : undefined, ground: store.get().theme === 'light' ? 'paper' : 'night', colors: store.get().colors, hasMean: !!s.inp?.hasMean }); } catch { svg = null; }
    if (!svg) { s.card.setStrip(''); return; }
    // on the card the strip is a picture, not controls: one image whose text alternative names the days it shows, and no
    // tap targets (a rect with no role may not carry an aria-label: axe aria-prohibited-attr)
    const names = [];
    for (const r of svg.querySelectorAll('.strip-day, .strip-end')) {
      if (r.classList.contains('strip-day') && r.getAttribute('aria-label')) names.push(r.getAttribute('aria-label'));
      for (const a of ['tabindex', 'role', 'aria-label']) r.removeAttribute(a);
      r.style.pointerEvents = 'none'; r.style.cursor = 'default';
    }
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', names.length ? `Forecast strip: ${names.join(', ')}` : 'Forecast strip for the coming days');
    s.card.setStrip(svg.outerHTML);
  }
  function timeChanged(s) {
    if (!st || st !== s) return;
    const b = s.player.beat(); if (!b) return;
    const t = store.get().t;
    s.card.setDate(b.chapter === 'title' || b.chapter === 'end' || s.player.state() === 'ended' ? '' : dateText(app, t));
    if (b.strip) drawStrip(s, b, false);
  }
  function zoneCaption(s, t) {
    const b = s.player.beat();
    if (!b || !b.zoneCaptions) return;
    let cap = b.zoneCaptions[0]?.caption ?? null;
    for (const z of b.zoneCaptions) if (z.from <= t + 1e-6) cap = z.caption;
    if (cap !== s.zone) { s.zone = cap; s.card.setZoneCaption(cap); }
  }
  function showBeat(s, index, beat) {
    s.zone = null;
    s.card.show(beat, s.sc, index);
    s.drawnDay = undefined; drawStrip(s, beat, true);
    timeChanged(s);
    if (beat.zoneCaptions) zoneCaption(s, beat.t0);
  }

  // ---------- owning the chart ----------
  function wireTaps(s) {
    const taps = s.taps;
    const down = new Map();
    let multi = false;
    const onDown = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (down.size) multi = true;
      down.set(e.pointerId, { x: e.clientX, y: e.clientY, at: e.timeStamp });
    };
    const onUp = (e) => {
      const d = down.get(e.pointerId); down.delete(e.pointerId);
      if (!d) return;
      const wasMulti = multi; if (!down.size) multi = false;
      if (wasMulti || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP || e.timeStamp - d.at > TAP_MAX_MS) return;
      const r = taps.getBoundingClientRect(), f = (e.clientX - r.left) / (r.width || 1);
      if (f >= 2 / 3) s.player.next();
      else if (f < 1 / 3) s.player.prev();
      else if (s.player.state() === 'paused') s.player.resume(); else s.player.pause();
    };
    const onCancel = (e) => { down.delete(e.pointerId); if (!down.size) multi = false; };
    const block = (e) => { e.preventDefault(); e.stopPropagation(); };
    taps.addEventListener('pointerdown', onDown); taps.addEventListener('pointerup', onUp); taps.addEventListener('pointercancel', onCancel);
    taps.addEventListener('wheel', block, { passive: false });
    taps.addEventListener('dblclick', block); taps.addEventListener('contextmenu', block);
  }

  function handleKey(e, s) {
    if (st !== s || e.metaKey || e.ctrlKey || e.altKey || !SWALLOW.has(e.key) || typing(e.target)) return;
    // Space on one of the card's own buttons is that button's press: the browser's own activation does the work
    if (e.key === ' ' && e.target?.closest?.('#brief-card') && e.target.tagName === 'BUTTON') return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.key === ' ') { if (s.player.state() === 'paused') s.player.resume(); else s.player.pause(); }
    else if (e.key === 'ArrowRight') s.player.next();
    else if (e.key === 'ArrowLeft') s.player.prev();
    else if (e.key === 'Escape') close();
  }

  // ---------- closing ----------
  function close(opts = {}) {
    const s = st; if (!s || s.closed) return;
    s.player.exit({ stay: !!opts.stay }); // emits 'exit', which tears everything down
    if (st === s) teardown(s, !!opts.stay); // a player that was already idle
  }
  function teardown(s, stay) {
    if (s.closed) return; s.closed = true;
    for (const off of s.offs.splice(0)) { try { off(); } catch { /* already gone */ } }
    st = null;
    const pe = pillEl(); if (pe) pe.hidden = readoutPinned(); // the card hands focus back to a visible pill
    s.card.destroy();
    s.taps.remove();
    appEl.removeAttribute('data-brief');
    for (const v of ['--brief-dock', '--brief-dock-wide', '--brief-tl', '--brief-card-h']) appEl.style.removeProperty(v);
    releasePadding();
    restorePadding();
    if (!stay && s.xf0) holdTransform(s.xf0);
    if (!stay) setTimeout(() => { if (location.hash !== s.hash0) { try { history.replaceState(null, '', location.pathname + location.search + s.hash0); } catch { /* sandboxed frame */ } } }, RESTORE_HASH_MS);
    paintPill();
    rebuildSoon();
  }

  Object.assign(api, {
    open, close, isOpen: () => !!st, script: () => (st ? st.sc : script), player: () => (st ? st.player : null),
    refresh: rebuild,
    destroy() { destroyed = true; if (st) close(); hold?.stop(); mo.disconnect(); rmo.disconnect(); ro?.disconnect(); unPlace?.(); removeEventListener('resize', placeSoon); clearTimeout(rebuildTimer); pill.destroy(); },
  });
  return rebuild().then(() => api);
}
