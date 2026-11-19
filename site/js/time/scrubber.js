// Scrubber: mounts into #timeline. Transport (play, step, speed, time readout), a draggable track with local-day
// bands, trip spans, loaded ranges, greyed hours outside the active case, and the confidence ribbon.
// Placement hooks for the shell: set data-dock="sheet" on the mount element to dock it to the phone sheet; the
// scrubber mirrors store.sheet into data-sheet, and CSS collapses it to a 44 px bar at data-sheet="full".
import { store, bus } from '../state.js';
import * as data from '../data/index.js';
import { pins } from '../pins/index.js';
import { VIEWS, CHUNK_HOURS } from '../contract.js';
import * as clock from './clock.js';
import { dayBands, tripSpans, ribbon, thinLabels, formatReadout, clamp, spanOf } from './model.js';

const PAD = 14; // px of inset on both sides of the track area (matches timeline.css)
const NS = 'http://www.w3.org/2000/svg';

function el(tag, cls, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}
function icon(path) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '20'); s.setAttribute('height', '20'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path'); p.setAttribute('d', path); p.setAttribute('fill', 'currentColor'); s.appendChild(p);
  return s;
}
const PLAY = 'M8 5.5v13l11-6.5z';
const PAUSE = 'M7 5h3.6v14H7zM13.4 5H17v14h-3.4z';
const PREV = 'M15.5 5.5 8 12l7.5 6.5z';
const NEXT = 'M8.5 5.5 16 12l-7.5 6.5z';

const mounted = new WeakMap(); // root -> unmount

/** Idempotent per root: mounting again tears the earlier mount down first. */
export function mountScrubber(root) {
  if (!root) return () => {};
  mounted.get(root)?.();
  root.classList.add('tl-root');
  if (!root.dataset.dock) root.dataset.dock = 'rail';

  // ---- structure
  const play = el('button', 'tl-btn tl-play', { type: 'button', 'aria-label': 'Play' });
  const time = el('button', 'tl-time', { type: 'button', 'aria-label': 'Play or pause (tap the time)' });
  const timeMain = el('span', 'tl-time-main'), timeSub = el('span', 'tl-time-sub');
  time.append(timeMain, timeSub);
  const prev = el('button', 'tl-btn tl-step', { type: 'button', 'aria-label': 'Previous step' });
  const next = el('button', 'tl-btn tl-step', { type: 'button', 'aria-label': 'Next step' });
  const speed = el('button', 'tl-btn tl-speed', { type: 'button', 'aria-label': 'Playback speed' });
  play.appendChild(icon(PLAY)); prev.appendChild(icon(PREV)); next.appendChild(icon(NEXT));
  const head = el('div', 'tl-head');
  head.append(play, time, el('span', 'tl-spacer'), prev, next, speed);

  const days = el('div', 'tl-days', { 'aria-hidden': 'true' });
  const track = el('div', 'tl-track', { role: 'slider', tabindex: '0', 'aria-label': 'Forecast time' });
  const area = el('div', 'tl-area');
  const greyL = el('div', 'tl-grey tl-grey-l'), greyR = el('div', 'tl-grey tl-grey-r');
  const rail = el('div', 'tl-rail');
  const loaded = el('div', 'tl-loaded');
  const ticks = el('div', 'tl-ticks');
  const trips = el('div', 'tl-trips');
  const thumb = el('div', 'tl-thumb');
  thumb.appendChild(el('div', 'tl-thumb-dot'));
  area.append(greyL, greyR, rail, loaded, ticks, trips, thumb);
  track.appendChild(area);
  const ribbonWrap = el('div', 'tl-ribbon-wrap');
  const ribbonEl = el('div', 'tl-ribbon', { role: 'img' });
  ribbonWrap.appendChild(ribbonEl);
  const words = el('div', 'tl-words', { 'aria-hidden': 'true' });
  const body = el('div', 'tl-body');
  body.append(days, track, ribbonWrap, words);
  root.replaceChildren(head, body);

  // ---- geometry and state
  let width = 0; // area width in px
  let lo = 0, hi = 1; // extent shown
  let activeLo = 0, activeHi = 1;
  const loadedChunks = new Set();
  const pct = (t) => `${(((t - lo) / (hi - lo)) * 100).toFixed(3)}%`;
  const tzOf = (d) => { try { return new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value || ''; } catch { return ''; } };

  function extent() {
    const [alo, ahi] = clock.range();
    let elo = alo, ehi = ahi;
    // A live run: the extent is the longest field in the run, so hours past the case's own range show greyed.
    if (!store.get().sample) {
      const all = ['z500a', 'z500', 'z500sd', 'ws250', 'tp6', 't850a'].map((f) => { try { return data.fieldSteps(f) || []; } catch { return []; } });
      const sp = spanOf(all);
      if (sp) { elo = Math.min(elo, sp[0]); ehi = Math.max(ehi, sp[1]); }
    }
    if (!(ehi > elo)) ehi = elo + 1;
    return { elo, ehi, alo, ahi };
  }

  function measureLoaded() {
    loadedChunks.clear();
    const dom = VIEWS[store.get().view] || 'np05';
    let steps = [];
    try { steps = data.fieldSteps('z500a') || []; } catch { /* none */ }
    for (const [id, [a, b]] of Object.entries(CHUNK_HOURS)) {
      const first = steps.find((s) => s >= a && s <= b);
      if (first == null) continue;
      let ok = false;
      try { ok = data.fieldAt('z500a', dom, first) != null; } catch { /* not loaded */ }
      if (ok) loadedChunks.add(id);
    }
  }

  function renderStatic() {
    const e = extent();
    lo = e.elo; hi = e.ehi; activeLo = e.alo; activeHi = e.ahi;
    let vt; try { vt = (h) => data.validTime(h); vt(0); } catch { vt = (h) => new Date(Date.UTC(2026, 0, 1) + h * 3600e3); }

    // greyed hours outside the active case
    greyL.style.width = pct(activeLo); greyL.hidden = !(activeLo > lo);
    greyR.style.left = pct(activeHi); greyR.hidden = !(activeHi < hi);

    // day bands
    days.replaceChildren(); ticks.replaceChildren();
    const bands = dayBands(vt, lo, hi);
    const pxPerH = width / (hi - lo);
    const roomy = pxPerH * 24 >= 40;
    for (const b of bands) {
      if (b.tick != null) { const tk = el('div', 'tl-tick'); tk.style.left = pct(b.tick); ticks.appendChild(tk); }
      const w = (b.t1 - b.t0) * pxPerH;
      if (w < 14) continue;
      const lab = el('span', 'tl-day');
      lab.textContent = roomy ? b.weekday : b.initial;
      lab.style.left = pct((b.t0 + b.t1) / 2);
      days.appendChild(lab);
    }

    // trips
    trips.replaceChildren();
    let list = []; try { list = pins.trips() || []; } catch { /* pins not ready */ }
    for (const s of tripSpans(list, vt, lo, hi)) {
      const bar = el('div', 'tl-trip');
      bar.style.left = pct(s.t0); bar.style.width = `${(((s.t1 - s.t0) / (hi - lo)) * 100).toFixed(3)}%`;
      bar.title = s.label;
      trips.appendChild(bar);
    }

    // loaded ranges: only claim what the data module confirms
    measureLoaded();
    loaded.replaceChildren();
    for (const [id, [a, b]] of Object.entries(CHUNK_HOURS)) {
      if (!loadedChunks.has(id)) continue;
      const seg = el('div', 'tl-loaded-seg');
      const s = clamp(a, activeLo, activeHi), t = clamp(b, activeLo, activeHi);
      if (t <= s) continue;
      seg.style.left = pct(s); seg.style.width = `${(((t - s) / (hi - lo)) * 100).toFixed(3)}%`;
      loaded.appendChild(seg);
    }

    // ribbon
    // Sample spreads are not forecast spreads (SPEC section 11): the ribbon makes no confidence claim there.
    const isSample = !!store.get().sample;
    ribbonEl.hidden = isSample;
    let spread = null; try { if (!isSample) spread = data.sampleDomainSpread(); } catch { /* none */ }
    const rb = ribbon(spread, activeLo, activeHi);
    const stops = rb.pts.map((p) => `rgba(var(--tl-ribbon-rgb), ${p.alpha.toFixed(3)}) ${(((p.t - lo) / (hi - lo)) * 100).toFixed(2)}%`);
    ribbonEl.style.background = `linear-gradient(to right, ${stops.join(', ')})`;
    ribbonEl.style.left = pct(activeLo); ribbonEl.style.right = `${100 - parseFloat(pct(activeHi))}%`;
    ribbonEl.setAttribute('aria-label', 'Forecast confidence' + (rb.bySpread ? ' from ensemble spread' : ' by lead time') + ': ' + rb.runs.map((r) => r.word.toLowerCase()).join(', then '));
    words.replaceChildren();
    for (const r of (isSample ? [] : thinLabels(rb.runs, lo, hi, width, 78))) {
      const w = el('span', 'tl-word'); w.dataset.band = r.band; w.textContent = r.word; w.style.left = pct(r.t);
      words.appendChild(w);
    }
    ribbonEl.dataset.source = rb.bySpread ? 'spread' : 'lead';
    root.dataset.ribbon = rb.runs.map((r) => r.band).join(',');

    track.setAttribute('aria-valuemin', String(Math.round(lo)));
    track.setAttribute('aria-valuemax', String(Math.round(hi)));
    update();
  }

  let lastReadout = '', lastPlaying = null, lastSpeed = null;
  function update() {
    const s = store.get();
    const t = clamp(s.t, lo, hi);
    thumb.style.transform = `translate3d(${(((t - lo) / (hi - lo)) * width).toFixed(2)}px,0,0)`;
    const h = Math.round(t);
    let d; try { d = data.validTime(h); } catch { d = new Date(Date.UTC(2026, 0, 1) + h * 3600e3); }
    const sample = !!s.sample;
    let caseLabel = ''; if (sample) { try { caseLabel = data.getManifest?.()?.cases?.[s.case]?.label || ''; } catch { /* none */ } }
    const f = formatReadout(d, tzOf(d), { year: sample });
    const key = f.main + h + caseLabel;
    if (key !== lastReadout) {
      lastReadout = key;
      timeMain.textContent = f.short;
      timeSub.textContent = sample ? `${f.utc} · sample: ${caseLabel}` : `${f.tz ? f.tz + ' · ' : ''}${f.utc} · +${h} h`;
      time.title = sample ? `Sample data, not a forecast: ${caseLabel}` : '';
      track.setAttribute('aria-valuenow', String(h));
      track.setAttribute('aria-valuetext', `${f.main}, ${h} hours into the forecast`);
    }
    if (s.playing !== lastPlaying) {
      lastPlaying = s.playing;
      play.replaceChildren(icon(s.playing ? PAUSE : PLAY));
      play.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
      root.dataset.playing = s.playing ? '1' : '0';
    }
    if (s.speed !== lastSpeed) { lastSpeed = s.speed; speed.textContent = `${s.speed} h/s`; }
    root.dataset.sheet = s.sheet || 'peek';
    root.dataset.theme = s.theme || 'dark';
  }

  // ---- interaction
  play.addEventListener('click', () => clock.toggle());
  time.addEventListener('click', () => clock.toggle());
  prev.addEventListener('click', () => clock.step(-1));
  next.addEventListener('click', () => clock.step(1));
  speed.addEventListener('click', () => {
    const opts = clock.speeds(); const i = opts.indexOf(store.get().speed);
    clock.setSpeed(opts[(i + 1) % opts.length]);
  });

  let dragging = false, pendingX = null, raf = 0;
  const tAt = (clientX) => {
    const r = area.getBoundingClientRect();
    return lo + clamp((clientX - r.left) / (r.width || 1), 0, 1) * (hi - lo);
  };
  const applyDrag = () => {
    raf = 0;
    if (pendingX == null) return;
    const t = tAt(pendingX); pendingX = null;
    clock.seek(clamp(t, activeLo, activeHi));
    const f = store.get().focus;
    bus.emit('story:scrub', { t: store.get().t, lat: f ? f.lat : null, lon: f ? f.lon : null });
  };
  track.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    dragging = true;
    try { track.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
    clock.pause(); // a touch pauses the loop
    pendingX = e.clientX; applyDrag();
    root.classList.add('tl-dragging');
    e.preventDefault();
  });
  track.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    pendingX = e.clientX;
    if (!raf) raf = requestAnimationFrame(applyDrag);
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (e && e.type === 'pointerup') { pendingX = e.clientX; applyDrag(); }
    pendingX = null;
    root.classList.remove('tl-dragging');
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
  track.addEventListener('lostpointercapture', end);

  // ---- subscriptions
  let pending = 0;
  const schedule = () => { if (!pending) pending = setTimeout(() => { pending = 0; renderStatic(); }, 16); };
  const offStore = store.subscribe((s, patch) => {
    update();
    if ('case' in patch || 'view' in patch || 'sample' in patch) schedule();
  });
  const offs = [
    offStore,
    bus.on('data:manifest', () => { clock.refresh(); schedule(); }),
    bus.on('data:chunk', schedule),
    bus.on('pins:changed', schedule),
  ];
  let ro = null;
  const measure = () => { const w = Math.max(0, root.clientWidth ? area.clientWidth : 0); if (Math.abs(w - width) > 0.5) { width = w; schedule(); } };
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(measure); ro.observe(root); }
  window.addEventListener('resize', measure);

  clock.refresh();
  width = area.clientWidth;
  renderStatic();

  const unmount = function unmount() {
    mounted.delete(root);
    for (const f of offs) f();
    if (ro) ro.disconnect();
    window.removeEventListener('resize', measure);
    clearTimeout(pending); if (raf) cancelAnimationFrame(raf);
    root.replaceChildren(); root.classList.remove('tl-root');
  };
  mounted.set(root, unmount);
  return unmount;
}
