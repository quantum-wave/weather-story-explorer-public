// Timeline (DESIGN-SPEC 7.1, 7.2): mounts into #timeline. A two-line readout (local date and time with the zone's name;
// "Day n of N" and the run), a ruler of local days from today, a Now pill, a named speed menu, step buttons, and a
// 10 px track coloured step by step with the band of the pattern at the focused place (home when none). The zones and
// their captions come only from zones() (story/confidence.js). Placement hooks for the shell: set data-dock="sheet"
// on the mount element to dock it to the phone sheet (56 px at peek and full, 72 px at half); the scrubber mirrors
// store.sheet into data-sheet.
import { store, bus } from '../state.js';
import * as data from '../data/index.js';
import * as story from '../story/index.js';
import { pins } from '../pins/index.js';
import { runLabel } from '../data/kind.js';
import * as clock from './clock.js';
import {
  dayBands, tripSpans, clamp, trackTimes, trackCells, blendSeries, meanAnomalySeries, isOnStep, readoutLines, rulerLabel, zoneSpans,
} from './model.js';

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
const RANGES = [7, 10, 15];

const mounted = new WeakMap(); // root -> unmount

/** The place the track is drawn for: the focus, else the home; null before either is known. */
function trackPlace() {
  const f = store.get().focus;
  if (f && Number.isFinite(f.lat) && Number.isFinite(f.lon)) return { lat: f.lat, lon: f.lon, name: String(f.label || '') };
  try { const h = pins.home(); if (h && Number.isFinite(h.lat)) return { lat: h.lat, lon: h.lon, name: String(h.name || '') }; } catch { /* pins not ready */ }
  return null;
}

/**
 * The pattern and spread series at a place, loaded. The story code (story.seriesFor, the series buildDays uses) already
 * applies the ensemble blend when the data client provides data.patternSeries; until it does, the same linear blend is
 * applied here from z500em (as an anomaly), so the track never shows the single run in the days the zones call an average.
 */
async function patternAt(place) {
  await story.ensureStoryData(place.lat, place.lon);
  const s = story.seriesFor(place.lat, place.lon);
  let z500a = s.z500a;
  if (s.hasMean && typeof data.patternSeries !== 'function') {
    try {
      for (const f of ['z500em', 'z500']) await Promise.resolve(data.ensureAll?.(f, story.domainFor(f, place.lat, place.lon))).catch(() => {});
      // z500em is an absolute height: blend the run's anomaly toward the anomaly of the mean, z500em - (z500 - z500a)
      const meanA = meanAnomalySeries(s.z500a, data.sampleSeries('z500', place.lat, place.lon), data.sampleSeries('z500em', place.lat, place.lon));
      z500a = meanA ? blendSeries(s.z500a, meanA) : s.z500a;
    } catch { /* the run stays the run */ }
  }
  return { z500a, z500sd: s.z500sd, hasMean: !!s.hasMean };
}

/** Idempotent per root: mounting again tears the earlier mount down first. */
export function mountScrubber(root) {
  if (!root) return () => {};
  mounted.get(root)?.();
  root.classList.add('tl-root');
  if (!root.dataset.dock) root.dataset.dock = 'rail';

  // ---- structure
  const play = el('button', 'tl-btn tl-play', { type: 'button', 'aria-label': 'Play' });
  const time = el('button', 'tl-time', { type: 'button', 'aria-label': 'Play or pause (tap the time)' });
  const line1 = el('span', 'tl-line1 tl-time-main'), line2 = el('span', 'tl-line2 tl-time-sub');
  time.append(line1, line2);
  const prev = el('button', 'tl-btn tl-step tl-prev', { type: 'button', 'aria-label': 'Previous model step' });
  const next = el('button', 'tl-btn tl-step tl-next', { type: 'button', 'aria-label': 'Next model step' });
  play.appendChild(icon(PLAY)); prev.appendChild(icon(PREV)); next.appendChild(icon(NEXT));
  const range = el('div', 'tl-range');
  const now = el('button', 'tl-now', { type: 'button', 'aria-label': 'Back to now' });
  now.textContent = 'Now'; now.hidden = true;
  const speedWrap = el('div', 'tl-speedwrap');
  const speed = el('button', 'tl-speed', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Playback speed' });
  const menu = el('div', 'tl-menu', { role: 'menu', 'aria-label': 'Playback speed' });
  menu.hidden = true;
  speedWrap.append(speed, menu);
  const head = el('div', 'tl-head');
  head.append(play, time, el('span', 'tl-spacer'), range, now, prev, next, speedWrap);

  const days = el('div', 'tl-days', { 'aria-hidden': 'true' });
  const track = el('div', 'tl-track', { role: 'slider', tabindex: '0', 'aria-label': 'Forecast time' });
  const phoneRead = el('span', 'tl-phone-read', { 'aria-hidden': 'true' });
  const area = el('div', 'tl-area');
  const cells = el('div', 'tl-cells');
  const zonesEl = el('div', 'tl-zones');
  const ticks = el('div', 'tl-ticks');
  const trips = el('div', 'tl-trips');
  const thumb = el('div', 'tl-thumb');
  thumb.appendChild(el('div', 'tl-thumb-dot'));
  area.append(cells, zonesEl, ticks, thumb);
  track.append(phoneRead, area);
  const words = el('div', 'tl-words');
  const cap = el('div', 'tl-cap');
  const body = el('div', 'tl-body');
  body.append(days, track, words, trips, cap);
  root.replaceChildren(head, body);

  // ---- geometry and state
  let width = 0; // area width in px
  let lo = 0, hi = 1; // extent shown: the clock's loop range
  let place = null, placeKey = '', pattern = null, loadToken = 0;
  const pct = (t) => `${(((t - lo) / (hi - lo)) * 100).toFixed(3)}%`;
  const tzOf = (d) => { try { return new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value || ''; } catch { return ''; } };
  const vtOf = () => { try { data.validTime(0); return (h) => data.validTime(h); } catch { return (h) => new Date(Date.UTC(2026, 0, 1) + h * 3600e3); } };
  const nowHours = () => { const s = store.get(); if (s.sample) return null; try { const h = (Date.now() - data.validTime(0).getTime()) / 3600e3; return h >= lo && h <= hi ? h : null; } catch { return null; } };
  const groundOf = () => { const s = store.get(); return s.ground || (s.theme === 'light' ? 'paper' : 'night'); };
  // The run, from the one formatter; a multi-case sample also names its case (a sample is never mistaken for a forecast).
  const runText = () => {
    try {
      const m = data.getManifest(), s = store.get();
      const label = s.sample ? m?.cases?.[data.activeCase?.()]?.label : '';
      return runLabel(m) + (label ? ` · sample: ${label}` : '');
    } catch { return ''; }
  };

  // The track: one cell per time, each coloured bandRGBA of the pattern at the focused place.
  function renderTrack() {
    const times = trackTimes(clock.steps()).filter((t) => t >= lo - 1e-9 && t <= hi + 1e-9);
    const cs = trackCells(times, { z500a: pattern?.z500a, z500sd: pattern?.z500sd, ground: groundOf(), colors: store.get().colors });
    cells.replaceChildren();
    for (const c of cs) {
      const e = el('i', 'tl-cell');
      e.dataset.t = String(c.t); e.dataset.state = c.state;
      e.style.left = pct(c.from); e.style.width = `${(((c.to - c.from) / (hi - lo)) * 100).toFixed(3)}%`;
      if (c.rgba) { e.style.background = `rgb(${c.rgba[0]}, ${c.rgba[1]}, ${c.rgba[2]})`; e.dataset.rgb = c.rgba.slice(0, 3).join(','); }
      cells.appendChild(e);
    }
    const name = place?.name || '';
    cap.textContent = name ? `Pattern at ${name}` : 'Pattern';
    cap.dataset.place = name;
    track.setAttribute('aria-label', name ? `Forecast time. The track shows the pattern at ${name}` : 'Forecast time');
    root.dataset.hasMean = pattern?.hasMean ? '1' : '0';
  }

  async function loadPattern() {
    const p = trackPlace();
    const key = p ? `${p.lat},${p.lon},${p.name}` : '';
    place = p;
    if (!p) { pattern = null; placeKey = ''; renderTrack(); renderZones(); return; }
    const token = ++loadToken;
    placeKey = key;
    let next;
    try { next = await patternAt(p); } catch { next = null; }
    if (token !== loadToken) return; // a newer focus won
    pattern = next;
    renderTrack(); renderZones();
  }

  // The zones: textures on the track and the captions under it, all from the one zones table.
  function renderZones() {
    zonesEl.replaceChildren(); words.replaceChildren();
    const zs = zoneSpans(hi, { hasMean: !!pattern?.hasMean });
    root.dataset.zones = zs.map((z) => z.kind).join(',');
    for (const z of zs) {
      if (z.from >= hi) continue;
      const a = Math.max(z.from, lo);
      const zo = el('div', 'tl-zone'); zo.dataset.kind = z.kind; zo.dataset.texture = z.texture; zo.dataset.from = String(z.from); zo.dataset.to = String(z.to);
      zo.style.left = pct(a); zo.style.width = `${(((Math.min(z.to, hi) - a) / (hi - lo)) * 100).toFixed(3)}%`;
      zonesEl.appendChild(zo);
      const w = el('span', 'tl-zonecap'); w.dataset.kind = z.kind; w.textContent = z.caption; w.title = z.caption;
      w.style.left = pct(a); w.style.width = `calc(${(((Math.min(z.to, hi) - a) / (hi - lo)) * 100).toFixed(3)}% - 6px)`;
      words.appendChild(w);
    }
  }

  function renderStatic() {
    [lo, hi] = clock.range();
    if (!(hi > lo)) hi = lo + 1;
    const vt = vtOf();

    // ruler: local days from today (Tue 24); labels thin to every second or third day when narrow
    days.replaceChildren(); ticks.replaceChildren();
    const bands = dayBands(vt, lo, hi);
    const pxPerH = width / (hi - lo);
    const pxPerDay = pxPerH * 24;
    const every = Math.max(1, Math.ceil(44 / Math.max(1, pxPerDay)));
    const nowH = nowHours();
    // thin first, then drop: a clipped first or last day is skipped only when it is a stub (narrower than 30 px, or 60%
    // of a day when days are narrower than that); the survivors are thinned to every second or third day, never to none
    const minBand = Math.min(30, 0.6 * pxPerDay);
    let shown = 0;
    bands.forEach((b) => {
      if (b.tick != null) { const tk = el('div', 'tl-tick'); tk.style.left = pct(b.tick); ticks.appendChild(tk); }
      if ((b.t1 - b.t0) * pxPerH < minBand) return;
      const cx = (((b.t0 + b.t1) / 2) - lo) * pxPerH; // a label is about 36 px wide: keep it inside the track
      if (width > 0 && (cx < 18 || cx > width - 18)) return;
      if (shown++ % every) return;
      const lab = el('span', 'tl-day');
      lab.textContent = rulerLabel(b, { today: nowH != null && nowH >= b.t0 && nowH < b.t1 });
      lab.style.left = pct((b.t0 + b.t1) / 2);
      days.appendChild(lab);
    });

    // trips
    trips.replaceChildren();
    let list = []; try { list = pins.trips() || []; } catch { /* pins not ready */ }
    for (const s of tripSpans(list, vt, lo, hi)) {
      const bar = el('div', 'tl-trip');
      bar.style.left = pct(s.t0); bar.style.width = `${(((s.t1 - s.t0) / (hi - lo)) * 100).toFixed(3)}%`;
      bar.title = s.label; bar.dataset.label = s.label;
      if (s.label && ((s.t1 - s.t0) * pxPerH) >= 72) bar.textContent = s.label;
      trips.appendChild(bar);
    }

    renderRange();
    renderTrack(); renderZones();
    track.setAttribute('aria-valuemin', String(Math.round(lo)));
    track.setAttribute('aria-valuemax', String(Math.round(hi)));
    update();
  }

  // The chosen range as text; a control only when the map is expanded and the panel is hidden (store.expanded).
  function renderRange() {
    const s = store.get();
    const n = Number.isFinite(s.range) ? s.range : Math.max(1, Math.round((hi - lo) / 24));
    range.replaceChildren();
    if (s.expanded && Number.isFinite(s.range)) {
      range.dataset.control = '1';
      const avail = Math.floor((hi - lo) / 24 + 1e-9);
      for (const r of RANGES) {
        const b = el('button', 'tl-range-opt', { type: 'button', 'aria-pressed': String(r === s.range) });
        b.textContent = `${r} days`;
        if (r !== s.range && r > Math.max(avail, s.range)) b.disabled = true;
        b.addEventListener('click', () => store.set({ range: r }));
        range.appendChild(b);
      }
    } else {
      delete range.dataset.control;
      range.textContent = `${n} ${n === 1 ? 'day' : 'days'}`;
    }
  }

  function renderSpeedMenu() {
    const cur = store.get().speed;
    menu.replaceChildren();
    for (const c of clock.speedChoices()) {
      const b = el('button', 'tl-menu-item', { type: 'button', role: 'menuitemradio', 'aria-checked': String(c.value === cur) });
      b.textContent = c.name; b.dataset.speed = String(c.value);
      b.addEventListener('click', () => { clock.setSpeed(c.value); closeMenu(); speed.focus(); });
      menu.appendChild(b);
    }
    const hit = clock.speedChoices().find((c) => c.value === cur);
    speed.textContent = `Speed: ${hit ? hit.name : cur + ' h/s'}`;
    speed.title = `${cur} forecast hours per second`;
  }
  function closeMenu() { menu.hidden = true; speed.setAttribute('aria-expanded', 'false'); }
  function openMenu() { renderSpeedMenu(); menu.hidden = false; speed.setAttribute('aria-expanded', 'true'); menu.querySelector('[aria-checked="true"]')?.focus(); }

  let lastKey = '', lastPlaying = null, lastSpeed = null;
  function update() {
    const s = store.get();
    const t = clamp(s.t, lo, hi);
    thumb.style.transform = `translate3d(${(((t - lo) / (hi - lo)) * width).toFixed(2)}px,0,0)`;
    const h = Math.round(t);
    const d = vtOf()(t);
    const between = !s.playing && !isOnStep(clock.steps(), t);
    const key = `${d.getTime()}|${h}|${between}|${s.sample}|${data.activeCase?.()}|${lo}|${hi}`;
    if (key !== lastKey) {
      lastKey = key;
      const sample = !!s.sample;
      const r = readoutLines({ date: d, tz: tzOf(d), t, lo, hi, run: runText(), between, year: !!s.sample });
      line1.textContent = r.line1; line2.textContent = r.line2;
      // the phone line is short on purpose: no year, no zone name when off a step, so "between steps" is never cut
      const pl = readoutLines({ date: d, tz: tzOf(d), t, lo, hi, run: '', between, year: false }).line1;
      phoneRead.textContent = between ? `${pl.replace(/ [A-Z]{2,5}$/, '')} · between steps` : pl;
      // a multi-case sample is not a forecast; the one-run recorded sample (no cases) is real but not live (W3-09)
      let cased = false; if (sample) { try { cased = !!data.getManifest?.()?.cases?.[data.activeCase?.()]?.label; } catch { /* none */ } }
      time.title = sample ? `${cased ? 'Sample data, not a forecast' : 'Recorded data, not live'}. ${r.line2}` : `${r.line2}. UTC ${r.utc}`;
      root.dataset.between = between ? '1' : '0';
      track.setAttribute('aria-valuenow', String(h));
      track.setAttribute('aria-valuetext', `${r.line1}, ${r.line2}`);
      const nh = nowHours(); now.hidden = nh == null;
    }
    if (s.playing !== lastPlaying) {
      lastPlaying = s.playing;
      play.replaceChildren(icon(s.playing ? PAUSE : PLAY));
      play.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
      root.dataset.playing = s.playing ? '1' : '0';
    }
    if (s.speed !== lastSpeed) { lastSpeed = s.speed; renderSpeedMenu(); }
    root.dataset.sheet = s.sheet || 'peek';
    root.dataset.theme = s.theme || 'dark';
  }

  // ---- interaction
  play.addEventListener('click', () => clock.toggle());
  time.addEventListener('click', () => clock.toggle());
  prev.addEventListener('click', () => clock.step(-1));
  next.addEventListener('click', () => clock.step(1));
  now.addEventListener('click', () => { const h = nowHours(); if (h != null) clock.tweenTo(h, 500); });
  speed.addEventListener('click', () => (menu.hidden ? openMenu() : closeMenu()));
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); speed.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      const items = [...menu.querySelectorAll('button')], i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }
  });
  const outside = (e) => { if (!menu.hidden && !speedWrap.contains(e.target)) closeMenu(); };
  document.addEventListener('pointerdown', outside, true);

  let dragging = false, pendingX = null, raf = 0;
  const tAt = (clientX) => {
    const r = area.getBoundingClientRect();
    return lo + clamp((clientX - r.left) / (r.width || 1), 0, 1) * (hi - lo);
  };
  const applyDrag = () => {
    raf = 0;
    if (pendingX == null) return;
    const t = tAt(pendingX); pendingX = null;
    clock.seek(clamp(t, lo, hi));
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
    if (e && e.type === 'pointerup') clock.easeToStep(); // time is continuous while dragging; a release eases to the nearest model step
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
  track.addEventListener('lostpointercapture', end);

  // ---- subscriptions
  let pending = 0, pendingPattern = 0;
  const schedule = () => { if (!pending) pending = setTimeout(() => { pending = 0; renderStatic(); }, 16); };
  const schedulePattern = () => { if (!pendingPattern) pendingPattern = setTimeout(() => { pendingPattern = 0; loadPattern(); }, 30); };
  const offStore = store.subscribe((s, patch) => {
    update();
    if ('view' in patch || 'sample' in patch || 'lens' in patch || 'range' in patch || 'expanded' in patch) schedule();
    if ('focus' in patch || 'sample' in patch || 'lens' in patch) schedulePattern();
    if ('theme' in patch || 'ground' in patch || 'colors' in patch) renderTrack();
    if ('speed' in patch) renderSpeedMenu();
  });
  const offs = [
    offStore,
    bus.on('data:manifest', () => { clock.refresh(); schedule(); schedulePattern(); }),
    bus.on('data:chunk', () => { schedulePattern(); }),
    bus.on('pins:changed', () => { schedule(); schedulePattern(); }),
  ];
  let ro = null;
  const measure = () => { const w = Math.max(0, root.clientWidth ? area.clientWidth : 0); if (Math.abs(w - width) > 0.5) { width = w; schedule(); } };
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(measure); ro.observe(root); }
  window.addEventListener('resize', measure);

  clock.refresh();
  width = area.clientWidth;
  renderStatic();
  schedulePattern();

  const unmount = function unmount() {
    mounted.delete(root);
    for (const f of offs) f();
    if (ro) ro.disconnect();
    window.removeEventListener('resize', measure);
    document.removeEventListener('pointerdown', outside, true);
    clearTimeout(pending); clearTimeout(pendingPattern); loadToken++; if (raf) cancelAnimationFrame(raf);
    root.replaceChildren(); root.classList.remove('tl-root');
  };
  mounted.set(root, unmount);
  return unmount;
}
