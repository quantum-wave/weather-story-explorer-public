// The plan-first home (DESIGN-SPEC 3.1-3.5): Your week, Trips, People, Places, each with a summary sentence and the strip.
// Every honest state of "Your week" renders here (live, short of range, stale, very stale, recorded, short dataset,
// loading, load failure); the words come from story/phrases.js, the dataset kinds from data/kind.js.
// Tapping a card or a strip day focuses that place: the clock tweens to the day and the map re-centres. On the phone the
// sheet never drops to peek for it: from half it stays at half, from full it goes to half (UX-4).
import { h, clear } from './dom.js';
import { prefs } from './prefs.js';
import { parseDay, tripDates, weekdayDate, staleHead, rangeReason } from './format.js';
import { cityLabel, joinKicker, reasonTag } from './focus.js';
import { isPhone } from './layout.js';
import { pickCity } from './citypicker.js';
import * as pinsMount from '../pins/mount.js';
import { mountPins, openEditSheet, showToast } from '../pins/mount.js';
import { EMPTY } from '../story/phrases.js';
import { isLive, isMultiCase, isRecorded, staleness, sampleLabel } from '../data/kind.js';

const MAX_ROWS = 12;
const DAY_MS = 86400e3;
const RANGES = [7, 10, 15];
const SNAPS = ['peek', 'half', 'full'];
const GENERIC_ERROR = 'Couldn’t load the forecast for this place';

let cssLink = null;
/** home.css, a <link> to our own file so it works wherever the site's files are served (the pins/dom.js pattern). */
function ensureStyles() {
  if (cssLink || typeof document === 'undefined') return;
  cssLink = document.createElement('link');
  cssLink.rel = 'stylesheet';
  cssLink.href = new URL('../../css/home.css', import.meta.url).href;
  document.head.append(cssLink);
}

export function mountHome(app) {
  ensureStyles();
  const { store, bus, data, pins, clock, renderer, story, layout, friend, canvas } = app;
  const body = document.getElementById('home-body');
  const focusEl = document.getElementById('focus-card');

  const notes = h('div', { class: 'stack', id: 'sec-notes' });
  const secWeek = h('section', { id: 'sec-week' });
  const secTrips = h('section', { id: 'sec-trips' });
  const secPeople = h('section', { id: 'sec-people' });
  const secPlaces = h('section', { id: 'sec-places' });
  const secAdd = h('section', { id: 'sec-add' });
  const secPins = h('section', { id: 'sec-pins' });
  const secMore = h('section', { id: 'sec-more' });
  body.append(notes, secWeek, secTrips, secPeople, secPlaces, secAdd, secPins, secMore);

  const stories = new Map(); // key -> {place, days, summary, status, activeDay, range, avail, expanded}
  let focusKey = null;
  let groupFilter = 'all';
  let showAll = { person: false, place: false };
  let order = []; // pin ids, sorted once when data is ready, again on pins:changed
  let reasons = new Map();
  let ready = false;
  let stripWidth = 0;
  let epoch = 0;
  let forecastCov = null; // the home place's 15-day coverage: what the loaded forecast spans (trip states read it)

  // ---------- the dataset ----------
  const mf = () => app.manifest || data.getManifest?.() || null;
  const nowMs = () => (app.now ? app.now() : Date.now());
  const activeCaseId = () => data.activeCase?.() ?? undefined;
  let shownCase = activeCaseId();
  const vt = (hr) => data.validTime(hr, activeCaseId()); // the story's own dataset
  const anchorMs = () => story.anchorMs(nowMs());
  const kindOf = () => (isLive(mf()) ? 'live' : isRecorded(mf()) ? 'recorded' : 'multi');
  const chosenRange = () => (RANGES.includes(store.get().range) ? store.get().range : 7);
  /** The card's source label, from the dataset the map shows (never a fixed case): '' for live data. */
  function sourceLabel() {
    const m = mf();
    if (!m || isLive(m)) return '';
    if (isRecorded(m)) return sampleLabel(m);
    const c = m.cases?.[activeCaseId()];
    return c?.label ? `Sample: ${c.label}, not a forecast` : sampleLabel(m);
  }
  /** A range is allowed when the data can fill it; a live run with at least a week may be asked for more (the end cell says why it is short). */
  const allowed = (r, avail) => r === 7 || (isLive(mf()) ? avail >= 7 : avail >= r);
  const effRange = (avail) => [...RANGES].reverse().find((r) => r <= chosenRange() && allowed(r, avail)) || 7;

  // ---------- places ----------
  const homePlace = () => placeOf('home', 'home', pins.home(), { label: pins.home().name });
  function placeOf(kind, id, city, extra = {}) {
    return { key: extra.key || (kind === 'home' ? 'home' : kind === 'trip' ? `trip:${id}` : `pin:${id}`), kind, id, city, lat: city.lat, lon: city.lon, label: cityLabel(city), ...extra };
  }
  const tripPlace = (t) => placeOf('trip', t.id, t.city, { trip: t, title: t.label });
  const pinPlace = (p) => placeOf(p.kind === 'place' ? 'place' : 'person', p.id, p.city, { pin: p, title: p.name });
  /** Focus for the store: a city name as label, never a person's; placeRef null for people. From pins/. */
  const focusOf = (pl) => {
    if (pl.key !== 'link') { const f = pins.focusOf(pl.kind === 'home' ? 'home' : pl.id); if (f) return f; }
    return { lat: pl.lat, lon: pl.lon, label: pl.city.name, kind: 'place', placeRef: pl.city.id != null ? 'c' + pl.city.id : null };
  };
  const startOfDay = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  function rangeFor(place, range = 7) {
    const a = anchorMs();
    if (place.kind === 'trip') {
      const t = place.trip;
      return { from: Math.max(parseDay(t.start).getTime() - 12 * 3600e3, startOfDay(a)), to: parseDay(t.end).getTime(), anchor: a };
    }
    return { from: a, to: a + (range - 1) * DAY_MS, anchor: a };
  }
  const tzFor = (pl) => (pl.kind === 'home' || pl.kind === 'trip' ? 'viewer' : story.tzForLon(pl.lon));

  // ---------- stories ----------
  async function loadStory(place, { force = false } = {}) {
    let st = stories.get(place.key);
    const same = st && st.place.lat === place.lat && st.place.lon === place.lon && st.trip?.start === place.trip?.start && st.trip?.end === place.trip?.end && (place.kind !== 'home' || st.chosen === chosenRange());
    if (st && st.status !== 'loading' && st.status !== 'error' && !force && same) { st.place = place; return st; }
    if (st?.status === 'loading' && !force && same) return st;
    st = { place, days: [], summary: '', status: 'loading', activeDay: 0, trip: place.trip && { ...place.trip }, range: 7, avail: 0, expanded: false, chosen: chosenRange() };
    stories.set(place.key, st);
    try {
      const opts = { tz: tzFor(place), anchor: anchorMs(), now: nowMs(), placeName: place.label };
      let days;
      if (place.kind === 'home') {
        // one 15-day build says what the dataset can fill; the chosen range is a build of its own when it is shorter
        const full = await story.buildDays(place.lat, place.lon, anchorMs(), anchorMs() + 14 * DAY_MS, opts);
        st.avail = full.coverage?.withData ?? full.length;
        forecastCov = full.coverage || null;
        st.range = effRange(st.avail);
        const to = anchorMs() + (st.range - 1) * DAY_MS;
        days = st.range === 15 ? full : await story.buildDays(place.lat, place.lon, anchorMs(), to, opts);
      } else {
        const r = rangeFor(place);
        days = await story.buildDays(place.lat, place.lon, r.from, r.to, opts);
      }
      st.days = days;
      const have = days.filter(story.hasData).length;
      // The data client swallows a failed chunk, so a forecast that lists the story fields but yields no day failed to load;
      // "no forecast data" is only for a dataset that holds none of them.
      let listed = false;
      try {
        // fields are listed once for every case, so a case lists a story field only when it names it (case B has the jet alone)
        const own = isMultiCase(mf()) ? new Set(mf().cases?.[activeCaseId()]?.fields || []) : null;
        listed = ['z500a', 'tp6'].some((f) => (!own || own.has(f)) && data.fieldSteps(f).length > 0);
      } catch { listed = false; }
      st.status = have ? 'ready' : listed ? 'error' : 'none';
      st.summary = have ? (place.kind === 'trip' && forecastCov ? story.tripLine(place.trip, days, forecastCov, { now: nowMs() }) : story.summarize(days, { sample: !isLive(mf()), placeName: place.label })) : '';
      st.confidence = have && place.kind !== 'trip' ? story.summaryConfidence(days, { sample: !isLive(mf()) }) : '';
    } catch (e) {
      st.status = 'error';
    }
    return st;
  }

  const dayIndexAt = (st, t) => {
    const w = st.days?.series?.windows;
    if (!w?.length) return 0;
    const i = w.findIndex((x) => t >= x.startH && t < x.endH);
    return i >= 0 ? i : t < w[0].startH ? 0 : w.length - 1;
  };
  const dayLineFor = (st, idx) => {
    const c = st.days[idx];
    if (!c) return '';
    const multi = isMultiCase(mf());
    // old sample days are real past days: name the full date with its year, never a weekday that reads as this week
    const dayName = multi ? weekdayDate(parseDay(c.date), { year: true }) : undefined;
    return story.dayLine(st.place.label, dayName, c, { sample: !isLive(mf()), placeName: st.place.label });
  };

  // ---------- focus ----------
  async function focusPlace(place, { t = null, day = null, keepSheet = false, quiet = false, noTween = false } = {}) {
    const prevKey = focusKey;
    focusKey = place.key;
    const st = stories.get(place.key) || (await loadStory(place));
    let target = t;
    if (target == null) {
      const idx = day ?? bestDay(st);
      target = dayTime(st, idx);
    }
    store.set({ focus: focusOf(place) });
    st.activeDay = dayIndexAt(st, quiet ? store.get().t : target ?? store.get().t);
    if (!quiet) {
      renderer.centreOn(place.lat, place.lon, 500);
      if (target != null && !noTween) {
        clock.tweenTo(target, 500);
        bus.emit('story:scrub', { t: target, lat: place.lat, lon: place.lon });
      }
      // Tapping a day never takes away the panel in use: from full the sheet goes to half, from half it stays, never to peek.
      if (isPhone() && !keepSheet && layout.snap() === 'full') layout.setSnap('half');
    }
    const isPin = (k) => k && k.startsWith('pin:');
    if ((isPin(prevKey) || isPin(place.key)) && prevKey !== place.key) { renderPeople(); renderPlaces(); }
    paintFocus(); paintActive();
    return st;
  }
  function bestDay(st) {
    if (!st.days?.length) return 0;
    let best = 0, bs = -1;
    st.days.forEach((c, i) => {
      if (!story.hasData(c)) return;
      const s = (c.wet === 'heavy' ? 4 : c.wet === 'moderate' ? 3 : 0) + (c.pattern === 'trough' ? 2 : c.pattern === 'ridge' ? 2 : c.pattern.endsWith('ing') || c.pattern.includes('arriving') ? 1 : 0);
      if (s > bs) { bs = s; best = i; }
    });
    return st.place.kind === 'trip' ? 0 : best;
  }
  function dayTime(st, idx) {
    const w = st.days?.series?.windows?.[idx];
    if (!w) return null;
    const steps = data.fieldSteps('z500a');
    const lo = Math.max(w.startH, steps[0]), hi = Math.min(w.endH, steps[steps.length - 1]);
    return hi > lo ? (lo + hi) / 2 : Math.min(Math.max(w.startH, steps[0]), steps[steps.length - 1]);
  }

  // ---------- strips ----------
  // Phone: the strip keeps the 16 px gutter, so at 390 px it is 358 px wide. At ranges 10 and 15 days 1-7 are 44 px columns
  // (7 x 44 = 308) and the compressed end cell gives up width to fit (strip.js: 46 px and a 4 px gap). The end cell swaps
  // in the full strip, which scrolls sideways inside its wrapper. Its columns are a whole fraction of the wrapper (six at
  // 358 px, 59.7 px each, never under 52 px so every "Wed 28" fits, the active one in semibold) and the scroll snaps to
  // them, so at rest no column, label or rain bar is cut at either edge. What must always be read stays out of the
  // scrolling part: the key sits under the wrapper and the "normal" label is pinned to its right edge on the line.
  const EXPANDED_COL = 52; // the narrowest column at which every "Wed 28" date label fits, the active one in semibold
  const measure = () => {
    const w = body.clientWidth || 380;
    return Math.max(240, Math.floor(isPhone() ? w - 32 : w - 32 - 34));
  };
  const isWide = (st) => !!st.expanded && isPhone() && st.days.length > 7;
  /** The expanded strip's column: the wrapper divided into as many whole columns as fit at EXPANDED_COL or wider. */
  const expandedCol = (width) => width / Math.max(1, Math.floor(width / EXPANDED_COL));
  function stripFor(st, width) {
    const phone = isPhone();
    const n = st.days.length;
    return story.stripSVG(st.days, st.days.series, {
      width: isWide(st) ? Math.max(width, n * expandedCol(width)) : width, activeDay: st.activeDay, phone, range: st.range, expanded: st.expanded,
      ground: store.get().theme === 'light' ? 'paper' : 'night',
      label: (c) => dayLineFor(st, c.dayIndex) || story.weekdayShort(c.date),
      // a weekday alone stands in for a date only on the phone, and never on a very stale run: its columns show dates (3.2)
      weekdayLabels: phone && staleness(mf(), nowMs()) !== 'very-stale',
    });
  }
  function paintStrip(wrap, st, { reveal = false } = {}) {
    const keep = wrap.scrollLeft;
    clear(wrap);
    const frame = wrap.parentElement?.classList.contains('strip-frame') ? wrap.parentElement : null;
    frame?.querySelectorAll(':scope > .strip-pin, :scope > .strip-key-out').forEach((e) => e.remove());
    const wide = isWide(st);
    wrap.classList.toggle('expanded', wide);
    const width = measure();
    const svg = stripFor(st, width);
    wrap.append(svg);
    if (!wide) return;
    // the key leaves the scrolling SVG for a block under it (real text that wraps), and the SVG ends at its columns
    const keyLines = [...svg.querySelectorAll('text.strip-key')].map((t) => { const s = t.textContent; t.remove(); return s; });
    const colH = +svg.querySelector('rect.strip-day')?.getAttribute('height');
    if (keyLines.length && colH > 0) {
      const vb = (svg.getAttribute('viewBox') || '').split(' ');
      svg.setAttribute('height', colH);
      if (vb.length === 4) { vb[3] = String(colH); svg.setAttribute('viewBox', vb.join(' ')); }
    }
    // the "normal" label is pinned to the wrapper's right edge on the line, on a chip of the card's ground
    svg.querySelector('text.strip-normal')?.remove();
    const mid = +svg.querySelector('line.normal-line')?.getAttribute('y1');
    if (frame && Number.isFinite(mid)) frame.append(h('span', { class: 'strip-normal strip-pin', 'aria-hidden': 'true', text: 'normal', style: { marginTop: `${Math.round(mid - 8)}px` } }));
    if (frame && keyLines.length) frame.append(h('p', { class: 'strip-key-out' }, ...keyLines.map((l) => h('span', { class: 'strip-key', text: l }))));
    // snap points: one per column, so the scroll comes to rest on whole columns
    const n = st.days.length, col = expandedCol(width);
    for (let i = 0; i < n; i++) wrap.append(h('span', { class: 'strip-snap', 'aria-hidden': 'true', style: { left: `${i * col}px`, width: `${col}px` } }));
    for (const t of svg.querySelectorAll('text.strip-zone-note')) t.dataset.x0 = t.getAttribute('x');
    const place = () => {
      const vis = Math.max(1, Math.round(wrap.clientWidth / col) || Math.floor(width / col));
      if (reveal) {
        const first = Math.max(0, Math.min(st.activeDay - Math.floor((vis - 1) / 2), n - vis));
        wrap.scrollLeft = first * col;
      } else wrap.scrollLeft = keep;
      fitStripText(wrap);
    };
    if (wrap.isConnected) place(); else requestAnimationFrame(place);
  }
  /**
   * Text in the scrolling strip is never shown cut by the wrapper's edge. A zone note ("broad pattern", "pattern only")
   * slides to stay in view while its zone is on screen; any text still crossing an edge (mid-scroll, before the snap
   * settles) is hidden until it is whole again.
   */
  function fitStripText(wrap) {
    const svg = wrap.querySelector('svg.strip');
    if (!svg || !wrap.classList.contains('expanded')) return;
    const L = wrap.scrollLeft, R = L + wrap.clientWidth, W = +svg.getAttribute('width') || R;
    const dashed = svg.querySelector('line.zone-dashed');
    const notes = [...svg.querySelectorAll('text.strip-zone-note')].map((t) => {
      const x0 = +t.dataset.x0, w = t.getComputedTextLength?.() || 0;
      const broad = dashed && Math.abs(x0 - (+dashed.getAttribute('x1') + 3)) < 1;
      return { t, x0, w, b: broad ? +dashed.getAttribute('x2') : W };
    });
    let limit = Infinity;
    for (const N of notes.slice().reverse()) {
      const x = Math.max(N.x0, Math.min(L + 4, N.b - N.w - 2, limit - 6 - N.w));
      N.t.setAttribute('x', Math.round(x * 100) / 100);
      limit = Math.min(limit, x);
    }
    for (const t of svg.querySelectorAll('text')) {
      let b; try { b = t.getBBox(); } catch { continue; }
      const cut = b.x < L - 0.5 || b.x + b.width > R + 0.5;
      const seen = b.x + b.width > L && b.x < R;
      t.style.visibility = seen && cut ? 'hidden' : '';
    }
  }
  /**
   * A vertical finger drag that starts on a strip behaves like a drag on the panel body (spec 4.6): it scrolls the panel
   * when the panel can scroll that way, and moves the sheet one step only at the scroll edge (finger down with the body at
   * the top) or when the sheet is not yet full (finger up). Off the phone layout it is never intercepted. The decision is
   * made on the first touchmove that shows the axis, while the browser has not yet started scrolling and the event can
   * still be cancelled; otherwise the touch is left to the browser (vertical scrolling, and sideways on an expanded strip).
   */
  function armStripDrag(wrap) {
    let g = null;
    wrap.addEventListener('touchstart', (e) => { g = isPhone() && e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, mode: '', dy: 0 } : null; }, { passive: true });
    wrap.addEventListener('touchmove', (e) => {
      if (!g || e.touches.length !== 1) { g = null; return; }
      const dx = e.touches[0].clientX - g.x, dy = e.touches[0].clientY - g.y;
      if (!g.mode && Math.max(Math.abs(dx), Math.abs(dy)) >= 4) {
        if (Math.abs(dy) <= Math.abs(dx)) g.mode = 'native';
        else {
          const up = dy < 0;
          const sheetMoves = up ? layout.snap() !== 'full' : body.scrollTop <= 0 && layout.snap() !== 'peek';
          g.mode = sheetMoves ? 'sheet' : 'native';
        }
      }
      g.dy = dy;
      if (g.mode === 'sheet' && e.cancelable) e.preventDefault();
    }, { passive: false });
    wrap.addEventListener('touchend', () => {
      if (g?.mode === 'sheet' && Math.abs(g.dy) >= 24) {
        const i = SNAPS.indexOf(layout.snap());
        layout.setSnap(SNAPS[Math.min(2, Math.max(0, i + (g.dy < 0 ? 1 : -1)))]);
      }
      g = null;
    });
    wrap.addEventListener('touchcancel', () => { g = null; });
  }

  // ---------- cards ----------
  function card(place, { kicker, when, note, tooFar, strip = true, week = false } = {}) {
    const st = stories.get(place.key);
    const el = h('article', { class: 'card', 'data-key': place.key });
    const head = h('button', { type: 'button', class: 'card-head', onclick: () => focusPlace(place) },
      h('div', { class: 'kicker' }, h('span', { class: 'kicker-text', text: kicker ?? place.label }), when ? h('span', { class: 'when', text: when }) : null));
    el.append(head);
    if (tooFar) { head.append(h('p', { class: 'summary muted', text: tooFar })); return el; }
    if (!st || st.status === 'loading') {
      el.classList.add('is-loading');
      head.append(h('div', { class: 'skeleton line' }), h('div', { class: 'skeleton line', style: { width: '70%' } }));
      el.append(h('div', { class: 'strip-wrap' }, h('div', { class: 'skeleton' })));
      return el;
    }
    if (st.status === 'error') {
      head.append(h('p', { class: 'summary muted', text: GENERIC_ERROR }));
      el.append(h('button', { type: 'button', class: 'btn retry-btn', text: 'Retry', onclick: async () => { await loadStory(place, { force: true }); refreshAll(); } }));
      return el;
    }
    if (st.status === 'none') {
      head.append(h('p', { class: 'summary muted', text: EMPTY.noStory }));
      const none = sourceLabel(); // the card still names the dataset it looked in, so it never reads as another case's
      if (none) head.append(h('p', { class: 'sample-tag', text: none }));
      return el;
    }
    head.append(h('p', { class: 'summary', text: st.summary }));
    if (st.confidence) head.append(h('p', { class: 'confidence', text: st.confidence }));
    const src = sourceLabel();
    if (src) head.append(h('p', { class: 'sample-tag', text: src }));
    if (note) head.append(h('p', { class: 'card-note', text: note }));
    if (!strip) return el;
    const wrap = h('div', { class: 'strip-wrap' });
    const frame = h('div', { class: 'strip-frame' }, wrap);
    paintStrip(wrap, st);
    let fitting = 0;
    wrap.addEventListener('scroll', () => { if (!fitting) fitting = requestAnimationFrame(() => { fitting = 0; fitStripText(wrap); }); }, { passive: true });
    wrap.addEventListener('click', (e) => {
      const d = e.target.closest?.('.strip-day');
      if (d) { focusPlace(place, { t: parseFloat(d.dataset.t), day: +d.dataset.day }); return; }
      if (e.target.closest?.('.strip-end')) { st.expanded = true; paintStrip(wrap, st, { reveal: true }); paintCollapse(el, st, wrap); }
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target;
      if (t.classList?.contains('strip-day')) { e.preventDefault(); focusPlace(place, { t: parseFloat(t.dataset.t), day: +t.dataset.day }); }
      else if (t.classList?.contains('strip-end')) { e.preventDefault(); t.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    });
    armStripDrag(wrap);
    el.append(frame);
    paintCollapse(el, st, wrap);
    if (week) {
      const cov = st.days.coverage || {};
      if (cov.withData < 3) el.append(h('p', { class: 'card-note coverage-note', text: story.coverageNote(cov) }));
      else if (cov.kind === 'live' && cov.withData < cov.requested) el.append(h('p', { class: 'card-note end-cell', text: sentence(story.laterDaysNote(cov)) }));
    }
    if (st.days[st.activeDay] && focusKey === place.key) el.append(h('p', { class: 'dayline', text: dayLineFor(st, st.activeDay) }));
    return el;
  }
  const sentence = (t) => t.charAt(0).toUpperCase() + t.slice(1) + '.';
  function paintCollapse(el, st, wrap) {
    el.querySelector('.strip-collapse')?.remove();
    if (!(isPhone() && st.expanded && st.days.length > 7)) return;
    (wrap.closest('.strip-frame') || wrap).after(h('button', { type: 'button', class: 'link-btn strip-collapse', text: 'Show the first 7 days', onclick: () => { st.expanded = false; paintStrip(wrap, st); paintCollapse(el, st, wrap); } }));
  }

  // ---------- sections ----------
  const addLink = (label, prefill) => h('button', { type: 'button', class: 'link-btn add-btn', text: 'Add', 'aria-label': label, onclick: () => addFlow(prefill, label) });
  /** W3-07's Add sheet when it exists, else the quick-add field. */
  function addFlow(prefill, label) {
    if (typeof pinsMount.openAddSheet === 'function') { pinsMount.openAddSheet({ kind: /trip/i.test(label) ? 'trip' : /place/i.test(label) ? 'place' : 'person' }); return; }
    quick.focus(prefill);
  }
  function head(title, extra) { return h('div', { class: 'sec-head' }, h('h2', { class: 'sec-title', text: title }), extra || null); }

  function renderWeek() {
    clear(secWeek);
    if (friend.active()) {
      secWeek.append(head('Where are you?'), h('div', { class: 'note-card plain' },
        h('p', { class: 'title', text: 'Add your city to see your own week.' }),
        h('p', { text: 'This link shows a forecast for someone else’s place.' }),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', id: 'friend-add-city', text: 'Add your city', onclick: chooseHome }))));
      return;
    }
    const pl = homePlace();
    const st = stories.get('home');
    const a = anchorMs();
    const change = h('button', { type: 'button', class: 'link-btn change-btn', text: 'Change', 'aria-label': 'Change your home city', onclick: chooseHome });
    const ready = st && st.status === 'ready';
    const title = ready ? story.weekTitle(st.days.coverage, { range: st.range }) : 'Your week';
    secWeek.append(head(title, change));
    if (ready) {
      const state = staleness(mf(), nowMs());
      const stale = isLive(mf()) ? staleHead(mf(), nowMs(), state) : '';
      if (stale) secWeek.append(h('p', { class: `sec-note stale-head ${state}`, text: stale }));
      secWeek.append(rangeControl(st));
    }
    secWeek.append(card(pl, { kicker: pl.label, when: weekdayDate(new Date(a), { year: isMultiCase(mf()) }), week: true }));
  }
  /** 7 days · 10 · 15, bound to store.range. A range the data cannot fill is disabled with its reason in words. */
  function rangeControl(st) {
    const wrap = h('div', { class: 'range', id: 'range-control' });
    const grp = h('div', { class: 'range-group', role: 'group', 'aria-label': 'How many days to show' });
    let reason = '';
    for (const r of RANGES) {
      const ok = allowed(r, st.avail);
      if (!ok && !reason) reason = rangeReason({ kind: kindOf() }, st.avail);
      grp.append(h('button', { type: 'button', class: 'range-btn', 'data-range': r, 'aria-pressed': st.range === r ? 'true' : 'false', disabled: ok ? null : '', text: r === 7 ? '7 days' : String(r), onclick: () => store.set({ range: r }) }));
    }
    wrap.append(grp);
    if (reason) wrap.append(h('p', { class: 'range-note', id: 'range-note', text: reason }));
    return wrap;
  }
  /** store.range changed (the control here, or the timeline's copy): rebuild the card for the new range. */
  async function onRange() {
    await loadStory(homePlace(), { force: true });
    renderWeek();
    if (focusKey === 'home') { const st = stories.get('home'); if (st) st.activeDay = dayIndexAt(st, store.get().t); paintFocus(); paintActive(); }
  }
  async function chooseHome() {
    const c = await pickCity({ title: 'Where are you?' });
    if (!c) return;
    pins.setHome(c);
    stories.delete('home');
    renderWeek();
    const st = await loadStory(homePlace(), { force: true });
    renderWeek(); renderTrips(); if (st) focusPlace(homePlace(), { day: 0 });
  }

  // ---------- trips (3.5) ----------
  const tripToday = () => ({ ...forecastCov, todayDate: forecastCov?.todayDate || forecastCov?.firstDate });
  function sortedTrips() { return pins.trips().slice().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.label.localeCompare(b.label))); }
  function renderTrips() {
    clear(secTrips);
    const trips = sortedTrips();
    secTrips.append(head('Trips', addLink('Add a trip', 'Trip: ')));
    if (!trips.length) {
      secTrips.append(h('button', { type: 'button', class: 'empty', id: 'empty-trips', onclick: () => addFlow('Trip: ', 'Add a trip') }, h('span', { class: 'empty-text', text: EMPTY.noTrips }), h('span', { class: 'empty-add', text: 'Add a trip' })));
      return;
    }
    const box = h('div', { class: 'stack' });
    const rows = trips.map((t) => ({ t, state: forecastCov ? story.tripState(t, tripToday(), nowMs()) : null }));
    // upcoming first, ended trips last as single muted rows
    for (const { t, state } of [...rows.filter((x) => x.state !== 'over'), ...rows.filter((x) => x.state === 'over')]) {
      const pl = tripPlace(t);
      if (state === 'over') {
        box.append(h('div', { class: 'trip-over', 'data-trip': t.id, 'data-state': 'over' },
          h('span', { class: 'trip-over-text', text: story.tripLine(t, [], tripToday(), { state: 'over' }) }),
          h('button', { type: 'button', class: 'link-btn row-btn', text: 'Remove', 'aria-label': `Remove trip ${t.label}`, onclick: () => { const undo = pins.remove(t.id); showToast({ lead: 'Removed ', message: t.label, undo, ms: 5000 }); } })));
        continue;
      }
      const kicker = joinKicker(t.label, pl.label), when = tripDates(t.start, t.end);
      let c;
      if (state === 'too-far') c = card(pl, { kicker, when, tooFar: story.tripLine(t, [], tripToday(), { state }) });
      else c = card(pl, { kicker, when, strip: state === 'detail' || (stories.get(pl.key)?.days?.length > 0) });
      c.dataset.state = state || 'loading';
      c.append(h('button', { type: 'button', class: 'link-btn row-btn trip-edit', text: 'Edit', 'aria-label': `Edit trip ${t.label}`, onclick: () => openEditSheet(t.id, { pins }) }));
      box.append(c);
    }
    secTrips.append(box);
  }

  // ---------- people and places ----------
  function pinList(kind) {
    let f = pins.all().filter((p) => (p.kind === 'place' ? 'place' : 'person') === kind);
    if (kind === 'person' && groupFilter !== 'all') f = f.filter((p) => p.group === groupFilter);
    const rank = new Map(order.map((id, i) => [id, i]));
    return f.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9) || a.name.localeCompare(b.name));
  }
  function pinRows(sec, kind) {
    const groups = pins.groups();
    const list = pinList(kind);
    const shown = showAll[kind] ? list : list.slice(0, MAX_ROWS);
    const box = h('div', { class: 'people', 'data-kind': kind });
    for (const p of shown) {
      const g = kind === 'person' ? groups.find((x) => x.id === p.group) : null;
      const pl = pinPlace(p);
      const expanded = focusKey === pl.key;
      const row = h('div', { class: 'person', 'data-pin': p.id });
      const main = h('button', { type: 'button', class: 'person-main', 'aria-expanded': expanded ? 'true' : 'false', onclick: () => focusPlace(pl) },
        kind === 'person' ? h('span', { class: g ? 'dot' : 'dot none', style: g ? { '--hue': g.hue } : {} }) : null,
        h('span', { class: 'person-name', text: p.name }),
        h('span', { class: 'person-sub', text: cityLabel(p.city) }));
      const why = reasons.get(p.id);
      row.append(h('div', { class: 'person-row' }, main,
        h('button', { type: 'button', class: 'link-btn row-btn more-btn', text: 'Edit', 'aria-label': `Edit ${p.name}`, onclick: () => openEditSheet(p.id, { pins }) })));
      if (why?.text) row.append(h('p', { class: 'person-why', text: why.text }));
      if (expanded) row.append(card(pl, { kicker: cityLabel(p.city) }));
      box.append(row);
    }
    sec.append(box);
    if (list.length > shown.length) sec.append(h('button', { type: 'button', class: 'link-btn show-all', text: `Show all ${list.length}`, onclick: () => { showAll[kind] = true; renderPeople(); renderPlaces(); } }));
  }
  function renderPeople() {
    const had = document.activeElement?.closest?.('.person')?.dataset.pin;
    clear(secPeople);
    secPeople.append(head('People', addLink('Add a person', '')));
    if (pins.storageKind && pins.storageKind() !== 'local') {
      secPeople.append(h('div', { class: 'not-saved', id: 'not-saved', role: 'status' },
        h('p', { text: 'This browser isn’t saving your list. Use Copy all to keep it.' }),
        h('button', { type: 'button', class: 'link-btn copy-all', text: 'Copy all', onclick: () => pinsUi.panel?.copy?.() })));
    }
    const people = pins.all().filter((p) => p.kind !== 'place');
    if (!people.length) {
      secPeople.append(h('button', { type: 'button', class: 'empty', id: 'empty-people', onclick: () => addFlow('Maya in Portland', 'Add a person') },
        h('span', { class: 'empty-text', text: 'No one here yet. Add someone to see what the pattern does to their week.' }), h('span', { class: 'empty-add', text: 'Add someone' })));
      return;
    }
    const groups = pins.groups();
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by group' });
    const mk = (id, label, hue) => h('button', { type: 'button', class: 'chip', 'aria-pressed': groupFilter === id ? 'true' : 'false', 'data-group': id, onclick: () => { groupFilter = id; showAll.person = false; renderPeople(); } },
      hue != null ? h('span', { class: 'dot', style: { '--hue': hue } }) : null, label);
    chips.append(mk('all', `All ${people.length}`));
    for (const g of groups) { const n = people.filter((p) => p.group === g.id).length; if (n) chips.append(mk(g.id, `${g.name} ${n}`, g.hue)); }
    if (chips.children.length > 2) secPeople.append(chips); // a filter needs at least two groups to filter between
    pinRows(secPeople, 'person');
    if (had) secPeople.querySelector(`.person[data-pin="${CSS.escape(had)}"] .person-main`)?.focus({ preventScroll: true });
  }
  function renderPlaces() {
    const had = document.activeElement?.closest?.('#sec-places .person')?.dataset.pin;
    clear(secPlaces);
    secPlaces.append(head('Places', addLink('Add a place', '')));
    if (!pins.all().some((p) => p.kind === 'place')) {
      secPlaces.append(h('button', { type: 'button', class: 'empty', id: 'empty-places', onclick: () => addFlow('Tahoe', 'Add a place') },
        h('span', { class: 'empty-text', text: 'No places yet. Add a place you watch, like a cabin or a trailhead.' }), h('span', { class: 'empty-add', text: 'Add a place' })));
      return;
    }
    pinRows(secPlaces, 'place');
    if (had) secPlaces.querySelector(`.person[data-pin="${CSS.escape(had)}"] .person-main`)?.focus({ preventScroll: true });
  }

  // notability sorting, once when data is ready (and when the pins change)
  async function sortPeople() {
    const list = pins.all();
    if (!list.length) { order = []; reasons = new Map(); return; }
    const need = new Map();
    for (const p of list) for (const f of ['z500a', 'tp6']) { const d = story.domainFor(f, p.city.lat, p.city.lon); need.set(`${f}|${d}`, [f, d]); }
    await Promise.all([...need.values()].map(([f, d]) => Promise.resolve(data.ensureAll ? data.ensureAll(f, d) : data.ensure(f, d, 0)).catch(() => {})));
    const scored = list.map((p) => ({ p, n: story.notability(p.city.lat, p.city.lon) }));
    scored.sort((a, b) => b.n.score - a.n.score || a.p.name.localeCompare(b.p.name));
    order = scored.map((s) => s.p.id);
    reasons = new Map(scored.filter((s) => s.n.reason).map((s) => [s.p.id, reasonTag(s.n.reason)]));
  }

  // ---------- notes: demo, first run, backup, storage ----------
  function demoNote() {
    const m = mf(), label = sourceLabel();
    if (isRecorded(m)) return { title: 'Recorded forecast', text: `${label}. A real forecast run saved so the app works without a live feed. Its dates are real; it is not today’s forecast.` };
    return { title: 'Sample data', text: `Demo: these are real past days (${m?.cases?.[activeCaseId()]?.label || 'an earlier date'}), shown with their real dates, not a forecast. Live forecasts start when the data pipeline is connected.` };
  }
  function renderNotes() {
    clear(notes);
    const s = store.get();
    const sample = !isLive(mf());
    if (sample && !prefs.get('demoDismissed')) {
      const d = demoNote();
      notes.append(h('div', { class: 'note-card', id: 'demo-card' },
        h('p', { class: 'title', text: d.title }), h('p', { text: d.text }),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost', text: 'Got it', onclick: () => { prefs.set('demoDismissed', true); renderNotes(); } }))));
    }
    if (!prefs.get('welcomed') && !friend.active() && (!sample || prefs.get('demoDismissed'))) {
      notes.append(h('div', { class: 'note-card plain', id: 'welcome-card' },
        h('p', { class: 'title', text: 'Your week, your trips, your people' }),
        h('p', { text: 'Each card says in one sentence what the weather pattern aloft does to that place, then shows why. Tap a card to watch the pattern move over it.' }),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost', text: 'Got it', onclick: () => { prefs.set('welcomed', true); renderNotes(); } }))));
    }
    void s;
  }

  function renderMore() {
    clear(secMore);
    secMore.append(h('details', { class: 'help' }, h('summary', { text: 'How this works' }),
        h('p', { text: 'Every place is read in three rows. What you feel: dry or wet, warmer or cooler air. Why: the pattern about 5.5 km up, in plain words with the term in brackets. How sure: pattern confidence from the spread between forecasts, and how far out the day is.' }),
        h('p', { text: 'Thresholds are fixed in height, so a ridge is rarer in Honolulu and common in Anchorage. They are first guesses and will be tuned against real runs.' }),
        h('p', { text: 'This is model output, not an official forecast.' })));
  }

  // ---------- focus card (phone peek) ----------
  function paintFocus() {
    clear(focusEl);
    const homeEl = document.getElementById('home');
    homeEl.dataset.focus = focusKey === 'link' ? 'link' : '';
    // the focus block is hidden at half and full when the same place's card is the first card below it (UX-19)
    homeEl.dataset.dup = focusKey === 'home' ? '1' : '';
    const f = store.get().focus;
    const st = focusKey && stories.get(focusKey);
    if (!f) return;
    const kick = st && ['person', 'place', 'trip'].includes(st.place.kind) ? joinKicker(st.place.title, f.label) : f.label;
    focusEl.append(h('div', { class: 'kicker' }, h('span', { text: kick })));
    if (!st || st.status === 'loading') { focusEl.append(h('div', { class: 'skeleton line' }), h('div', { class: 'skeleton line', style: { width: '60%' } })); return; }
    if (st.status === 'error') { focusEl.append(h('p', { class: 'summary muted', text: GENERIC_ERROR })); return; }
    if (st.status === 'none') {
      focusEl.append(h('p', { class: 'summary muted', text: EMPTY.noStory }));
      const none = sourceLabel();
      if (none) focusEl.append(h('p', { class: 'sample-tag', text: none }));
      return;
    }
    focusEl.append(h('p', { class: 'summary', text: st.summary }));
    const src = sourceLabel();
    if (src) focusEl.append(h('p', { class: 'sample-tag', text: src }));
    const dl = dayLineFor(st, st.activeDay);
    if (dl) focusEl.append(h('p', { class: 'dayline', text: dl }));
  }
  function paintActive() {
    for (const el of body.querySelectorAll('.card')) el.classList.toggle('active', el.dataset.key === focusKey);
    // keep the day line and strip highlight of the active card current
    const st = focusKey && stories.get(focusKey);
    const el = focusKey && body.querySelector(`.card[data-key="${CSS.escape(focusKey)}"]`);
    if (!st || !el || st.status !== 'ready') return;
    const wrap = el.querySelector('.strip-wrap');
    if (wrap) paintStrip(wrap, st, { reveal: true });
    let dl = el.querySelector('.dayline');
    if (!dl) { dl = h('p', { class: 'dayline' }); el.append(dl); }
    dl.textContent = dayLineFor(st, st.activeDay);
  }

  // the day line follows the clock while the focused place is on screen
  store.subscribe((s, p) => {
    if ('t' in p && focusKey) {
      const st = stories.get(focusKey);
      if (st?.status === 'ready') {
        const i = dayIndexAt(st, s.t);
        if (i !== st.activeDay) { st.activeDay = i; paintFocus(); paintActive(); }
      }
    }
    if ('theme' in p && ready) refreshStrips();
    // a new case is a new dataset: the cards' stories, their source tag and the focus block are rebuilt from it (never the old case's)
    if ('lens' in p && ready && activeCaseId() !== shownCase) { shownCase = activeCaseId(); stories.clear(); refresh().catch(() => {}); }
    if ('range' in p && ready && chosenRange() !== stories.get('home')?.chosen) onRange().catch(() => {});
  });

  function refreshStrips() {
    for (const el of body.querySelectorAll('.card')) {
      const st = stories.get(el.dataset.key);
      const wrap = el.querySelector('.strip-wrap');
      if (st?.status === 'ready' && wrap) paintStrip(wrap, st);
    }
  }
  new ResizeObserver(() => { const w = measure(); if (ready && Math.abs(w - stripWidth) > 6) { stripWidth = w; refreshStrips(); } }).observe(body);

  // ---------- quick add field ----------
  // WP5 owns the field, the toast, the edit sheet and the backup/copy/CSV cards; this shell only hosts them.
  secAdd.append(head('Add a person, place or trip'));
  const quickHost = h('div', { id: 'quickadd-host' });
  const pinsHost = h('div', { id: 'pins-panel' });
  secAdd.append(quickHost);
  secPins.append(head('Your pins'), pinsHost);
  const pinsUi = mountPins({ canvas, renderer, quickAddEl: quickHost, panelEl: pinsHost, pins });
  const quick = {
    focus(prefill) {
      const ta = pinsUi.quickAdd?.textarea;
      if (ta && prefill) { ta.value = prefill; ta.dispatchEvent(new Event('input')); }
      pinsUi.quickAdd?.focus();
      ta?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (ta && prefill && !prefill.endsWith(': ')) ta.select();
    },
  };

  // ---------- lifecycle ----------
  function renderAll() { renderNotes(); renderWeek(); renderTrips(); renderPeople(); renderPlaces(); renderMore(); }
  const refreshAll = () => { renderAll(); paintFocus(); paintActive(); };

  async function refresh() {
    const my = ++epoch;
    renderAll();
    await loadStory(homePlace()); // first: the forecast's own coverage decides every trip's state
    if (my !== epoch) return;
    renderWeek(); renderTrips();
    const tasks = [];
    for (const t of pins.trips()) if (forecastCov && ['detail', 'broad'].includes(story.tripState(t, tripToday(), nowMs()))) tasks.push(loadStory(tripPlace(t)));
    if (focusKey?.startsWith('pin:')) { const p = pins.all().find((x) => `pin:${x.id}` === focusKey); if (p) tasks.push(loadStory(pinPlace(p))); }
    await Promise.all(tasks);
    await sortPeople();
    if (my !== epoch) return;
    refreshAll();
  }

  bus.on('pins:changed', () => { for (const k of [...stories.keys()]) if (k !== 'home') { const [kind, id] = k.split(':'); const live = kind === 'trip' ? pins.trips().some((t) => String(t.id) === id) : pins.all().some((p) => String(p.id) === id); if (!live) stories.delete(k); } refresh(); });
  bus.on('pin:focus', ({ pinId }) => {
    const p = pins.all().find((x) => x.id === pinId);
    if (!p) return;
    groupFilter = 'all'; showAll = { person: true, place: true };
    focusPlace(pinPlace(p)).then(() => { renderPeople(); renderPlaces(); body.querySelector(`.person[data-pin="${CSS.escape(String(p.id))}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
  });

  return {
    async start() {
      stripWidth = measure();
      renderAll();
      await refresh();
      ready = true;
      if (!store.get().focus) await focusPlace(homePlace(), { quiet: true }).catch(() => {});
      return true;
    },
    focusPlace, refresh, renderAll, loadStory,
    /** A place from a link (a friend's view): focus without a card of its own. */
    focusCity(city, opts = {}) { return focusPlace(placeOf('place', 'link', city, { key: 'link', title: cityLabel(city) }), opts); },
    stories, quick, pinsUi,
    focusKey: () => focusKey,
    /** The day line of the focused place at the clock's day: the card's own string (the guide's "For you" reads it here). */
    dayLine() { const st = focusKey && stories.get(focusKey); return st?.status === 'ready' ? dayLineFor(st, st.activeDay) : ''; },
    homePlace,
    anchorMs,
  };
}
