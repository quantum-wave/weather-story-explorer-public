// The plan-first home: your week, your trips, your people, each with a summary sentence and a story strip.
// Tapping a card or a strip day focuses that place: the clock tweens to the day, the map re-centres, and on
// the phone the sheet drops to peek, which shows the focused place's summary and day line.
import { h, clear } from './dom.js';
import { prefs } from './prefs.js';
import { isoDay, parseDay, tripDates, weekdayDate, shortDate, monthYearUTC } from './format.js';
import { cityLabel, joinKicker, reasonTag } from './focus.js';
import { isPhone } from './layout.js';
import { pickCity } from './citypicker.js';
import { mountPins, openEditSheet } from '../pins/mount.js';
import { EMPTY } from '../story/phrases.js';

const MAX_ROWS = 12;

export function mountHome(app) {
  const { store, bus, data, pins, clock, renderer, story, layout, friend, canvas } = app;
  const body = document.getElementById('home-body');
  const focusEl = document.getElementById('focus-card');

  const notes = h('div', { class: 'stack', id: 'sec-notes' });
  const secWeek = h('section', { id: 'sec-week' });
  const secTrips = h('section', { id: 'sec-trips' });
  const secPeople = h('section', { id: 'sec-people' });
  const secAdd = h('section', { id: 'sec-add' });
  const secPins = h('section', { id: 'sec-pins' });
  const secMore = h('section', { id: 'sec-more' });
  body.append(notes, secWeek, secTrips, secPeople, secAdd, secPins, secMore);

  const stories = new Map(); // key -> {place, days, summary, status, activeDay}
  let focusKey = null;
  let groupFilter = 'all';
  let showAll = false;
  let order = []; // people ids, sorted once when data is ready, again on pins:changed
  let reasons = new Map();
  let ready = false;
  let stripWidth = 0;
  let epoch = 0;

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
  const vt = (h) => data.validTime(h, store.get().sample ? 'A' : undefined); // the story's own case
  const anchorMs = () => story.anchorMs(app.now ? app.now() : Date.now());
  function rangeFor(place) {
    const a = anchorMs();
    if (place.kind === 'trip') {
      const t = place.trip;
      const s = Math.max(parseDay(t.start).getTime() - 12 * 3600e3, new Date(new Date(a).getFullYear(), new Date(a).getMonth(), new Date(a).getDate()).getTime());
      return { from: s, to: parseDay(t.end).getTime(), anchor: a };
    }
    return { from: a, to: a + 6 * 86400e3, anchor: a };
  }
  const tzFor = (pl) => (pl.kind === 'home' || pl.kind === 'trip' ? 'viewer' : story.tzForLon(pl.lon));

  // ---------- stories ----------
  async function loadStory(place, { force = false } = {}) {
    let st = stories.get(place.key);
    if (st && st.status !== 'loading' && !force && st.place.lat === place.lat && st.place.lon === place.lon && st.trip?.start === place.trip?.start && st.trip?.end === place.trip?.end) { st.place = place; return st; }
    if (st?.status === 'loading' && !force) return st;
    st = { place, days: [], summary: '', status: 'loading', activeDay: 0, trip: place.trip && { ...place.trip } };
    stories.set(place.key, st);
    try {
      const r = rangeFor(place);
      const days = await story.buildDays(place.lat, place.lon, r.from, r.to, { tz: tzFor(place), anchor: r.anchor });
      st.days = days;
      const have = days.filter(story.hasData).length;
      st.status = have ? 'ready' : 'none';
      st.summary = have ? story.summarize(days, { sample: store.get().sample }) : '';
    } catch (e) {
      st.status = 'none';
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
    const sample = store.get().sample;
    // sample data are real past days: name the full date, never just a weekday that reads as this week
    const name = sample ? weekdayDate(parseDay(c.date), { year: true }) : story.weekdayShort(c.date);
    return story.dayLine(st.place.label, name, c, { sample });
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
      if (isPhone() && !keepSheet) layout.setSnap('peek');
    }
    const isPin = (k) => k && k.startsWith('pin:');
    if ((isPin(prevKey) || isPin(place.key)) && prevKey !== place.key) renderPeople();
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

  // ---------- cards ----------
  function stripFor(st, width) {
    const svg = story.stripSVG(st.days, st.days.series, store.get().theme, {
      width, activeDay: st.activeDay,
      label: (c) => dayLineFor(st, c.dayIndex) || story.weekdayShort(c.date),
    });
    return svg;
  }
  /** In sample mode every story says which real case it reads. */
  const sampleTag = () => `Sample: ${app.manifest?.cases?.A?.label || 'sample case'}, not a forecast`;
  const measure = () => Math.max(240, Math.floor((body.clientWidth || 380) - 32 - 34));

  function card(place, { kicker, when, tooFar, compact } = {}) {
    const st = stories.get(place.key);
    const el = h('article', { class: 'card', 'data-key': place.key });
    const head = h('button', { type: 'button', class: 'card-head', onclick: () => focusPlace(place) },
      h('div', { class: 'kicker' }, h('span', { class: 'kicker-text', text: kicker ?? place.label }), when ? h('span', { class: 'when', text: when }) : null));
    el.append(head);
    if (tooFar) { head.append(h('p', { class: 'summary muted', text: tooFar })); return el; }
    if (!st || st.status === 'loading') {
      head.append(h('div', { class: 'skeleton line' }), h('div', { class: 'skeleton line', style: { width: '70%' } }));
      el.append(h('div', { class: 'strip-wrap' }, h('div', { class: 'skeleton' })));
      return el;
    }
    if (st.status === 'none') { head.append(h('p', { class: 'summary muted', text: EMPTY.noStory })); return el; }
    head.append(h('p', { class: 'summary', text: st.summary }));
    if (store.get().sample) head.append(h('p', { class: 'sample-tag', text: sampleTag() }));
    const wrap = h('div', { class: 'strip-wrap' });
    wrap.append(stripFor(st, measure()));
    wrap.addEventListener('click', (e) => {
      const d = e.target.closest?.('.strip-day');
      if (d) focusPlace(place, { t: parseFloat(d.dataset.t), day: +d.dataset.day });
    });
    wrap.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('strip-day')) { e.preventDefault(); focusPlace(place, { t: parseFloat(e.target.dataset.t), day: +e.target.dataset.day }); }
    });
    el.append(wrap);
    if (st.days[st.activeDay] && focusKey === place.key) el.append(h('p', { class: 'dayline', text: dayLineFor(st, st.activeDay) }));
    return el;
  }

  // ---------- sections ----------
  const addLink = (label, prefill) => h('button', { type: 'button', class: 'link-btn', text: 'Add', 'aria-label': label, onclick: () => quick.focus(prefill) });
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
    const a = anchorMs();
    const change = h('button', { type: 'button', class: 'link-btn', text: 'Change', 'aria-label': 'Change your home city', onclick: chooseHome });
    secWeek.append(head('Your week', change), card(pl, { kicker: pl.label, when: weekdayDate(new Date(a), { year: store.get().sample }) }));
  }
  async function chooseHome() {
    const c = await pickCity({ title: 'Where are you?' });
    if (!c) return;
    pins.setHome(c);
    stories.delete('home');
    renderWeek();
    const st = await loadStory(homePlace(), { force: true });
    renderWeek(); if (st) focusPlace(homePlace(), { day: 0 });
  }

  function upcomingTrips() {
    const today = isoDay(new Date(anchorMs()));
    return pins.trips().filter((t) => t.end >= today).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  }
  function horizonEnd() {
    try { const st = data.fieldSteps('z500a'); return vt(st[st.length - 1]).getTime(); } catch { return 0; }
  }
  function renderTrips() {
    clear(secTrips);
    const trips = upcomingTrips();
    secTrips.append(head('Your trips', addLink('Add a trip', 'Trip: ')));
    if (!trips.length) {
      secTrips.append(h('button', { type: 'button', class: 'empty', id: 'empty-trips', text: EMPTY.noTrips, onclick: () => quick.focus('Trip: ') }));
      return;
    }
    const box = h('div', { class: 'stack' });
    const end = horizonEnd();
    for (const t of trips) {
      const pl = tripPlace(t);
      const far = parseDay(t.start).getTime() > end;
      let tooFar = null;
      if (far) {
        if (store.get().sample) tooFar = 'Not covered by the sample data';
        else tooFar = EMPTY.tooFar(shortDate(new Date(parseDay(t.start).getTime() - Math.floor((end - vt(0).getTime()) / 86400e3) * 86400e3)));
      }
      const c = card(pl, { kicker: joinKicker(t.label, pl.label), when: tripDates(t.start, t.end), tooFar });
      c.querySelector('.card-head').after(h('button', { type: 'button', class: 'link-btn more-btn', text: 'Edit', 'aria-label': `Edit trip ${t.label}`, onclick: () => openEditSheet(t.id, { pins }) }));
      box.append(c);
    }
    secTrips.append(box);
  }

  function peopleList() {
    const all = pins.all();
    const f = groupFilter === 'all' ? all : all.filter((p) => p.group === groupFilter);
    const rank = new Map(order.map((id, i) => [id, i]));
    return f.slice().sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9) || a.name.localeCompare(b.name));
  }
  function renderPeople() {
    const had = document.activeElement?.closest?.('.person')?.dataset.pin;
    clear(secPeople);
    secPeople.append(head('Your people', addLink('Add a person', '')));
    const all = pins.all();
    if (!all.length) {
      secPeople.append(h('button', { type: 'button', class: 'empty', id: 'empty-people', text: EMPTY.noPeople, onclick: () => quick.focus('Maya in Portland') }));
      return;
    }
    const groups = pins.groups();
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by group' });
    const mk = (id, label, hue) => h('button', { type: 'button', class: 'chip', 'aria-pressed': groupFilter === id ? 'true' : 'false', 'data-group': id, onclick: () => { groupFilter = id; showAll = false; renderPeople(); } },
      hue != null ? h('span', { class: 'dot', style: { '--hue': hue } }) : null, label);
    chips.append(mk('all', `All ${all.length}`));
    for (const g of groups) { const n = all.filter((p) => p.group === g.id).length; if (n) chips.append(mk(g.id, `${g.name} ${n}`, g.hue)); }
    secPeople.append(chips);
    const list = peopleList();
    const shown = showAll ? list : list.slice(0, MAX_ROWS);
    const box = h('div', { class: 'people' });
    for (const p of shown) {
      const g = groups.find((x) => x.id === p.group);
      const pl = pinPlace(p);
      const expanded = focusKey === pl.key;
      const row = h('div', { class: 'person', 'data-pin': p.id });
      const main = h('button', { type: 'button', class: 'person-main', 'aria-expanded': expanded ? 'true' : 'false', onclick: () => focusPlace(pl) },
        h('span', { class: g ? 'dot' : 'dot none', style: g ? { '--hue': g.hue } : {} }),
        h('span', { class: 'person-name', text: p.name }),
        h('span', { class: 'person-sub', text: cityLabel(p.city) }));
      const why = reasons.get(p.id);
      row.append(h('div', { class: 'person-row' }, main,
        why ? h('span', { class: 'person-why', text: why.text, title: why.title }) : null,
        h('button', { type: 'button', class: 'icon-btn more-btn', 'aria-label': `Edit ${p.name}`, onclick: () => openEditSheet(p.id, { pins }) }, '⋯')));
      if (expanded) row.append(card(pl, { kicker: cityLabel(p.city) }));
      box.append(row);
    }
    secPeople.append(box);
    if (list.length > shown.length) secPeople.append(h('button', { type: 'button', class: 'link-btn show-all', text: `Show all ${list.length}`, onclick: () => { showAll = true; renderPeople(); } }));
    if (had) secPeople.querySelector(`.person[data-pin="${CSS.escape(had)}"] .person-main`)?.focus({ preventScroll: true });
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
  function demoText() {
    const m = app.manifest;
    const when = m?.cases?.A?.label || 'an earlier date';
    return `Demo: these are real past days (${when}), shown with their real dates, not a forecast. Live forecasts start when the data pipeline is connected.`;
  }
  function renderNotes() {
    clear(notes);
    const s = store.get();
    if (s.sample && !prefs.get('demoDismissed')) {
      notes.append(h('div', { class: 'note-card', id: 'demo-card' },
        h('p', { class: 'title', text: 'Sample data' }), h('p', { text: demoText() }),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost', text: 'Got it', onclick: () => { prefs.set('demoDismissed', true); renderNotes(); } }))));
    }
    if (!prefs.get('welcomed') && !friend.active() && (!s.sample || prefs.get('demoDismissed'))) {
      notes.append(h('div', { class: 'note-card plain', id: 'welcome-card' },
        h('p', { class: 'title', text: 'Your week, your trips, your people' }),
        h('p', { text: 'Each card says in one sentence what the weather pattern aloft does to that place, then shows why. Tap a card to watch the pattern move over it.' }),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost', text: 'Got it', onclick: () => { prefs.set('welcomed', true); renderNotes(); } }))));
    }
  }

  function renderMore() {
    clear(secMore);
    secMore.append(h('details', { class: 'help' }, h('summary', { text: 'How to read this' }),
        h('p', { text: 'Every place is read in three rows. What you feel: dry or wet, warmer or cooler air. Why: the pattern about 5.5 km up, in plain words with the term in brackets. How sure: pattern confidence from the spread between forecasts, and how far out the day is.' }),
        h('p', { text: 'Thresholds are fixed in height, so a ridge is rarer in Honolulu and common in Anchorage. They are first guesses and will be tuned against real runs.' }),
        h('p', { text: 'This is model output, not an official forecast.' })));
  }

  // ---------- focus card (phone peek) ----------
  function paintFocus() {
    clear(focusEl);
    document.getElementById('home').dataset.focus = focusKey === 'link' ? 'link' : '';
    const f = store.get().focus;
    const st = focusKey && stories.get(focusKey);
    if (!f) return;
    const kick = st && ['person', 'place', 'trip'].includes(st.place.kind) ? joinKicker(st.place.title, f.label) : f.label;
    focusEl.append(h('div', { class: 'kicker' }, h('span', { text: kick })));
    if (!st || st.status === 'loading') { focusEl.append(h('div', { class: 'skeleton line' }), h('div', { class: 'skeleton line', style: { width: '60%' } })); return; }
    if (st.status === 'none') { focusEl.append(h('p', { class: 'summary muted', text: EMPTY.noStory })); return; }
    focusEl.append(h('p', { class: 'summary', text: st.summary }));
    if (store.get().sample) focusEl.append(h('p', { class: 'sample-tag', text: sampleTag() }));
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
    if (wrap) { clear(wrap); wrap.append(stripFor(st, measure())); }
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
  });

  function refreshStrips() {
    for (const el of body.querySelectorAll('.card')) {
      const st = stories.get(el.dataset.key);
      const wrap = el.querySelector('.strip-wrap');
      if (st?.status === 'ready' && wrap) { clear(wrap); wrap.append(stripFor(st, measure())); }
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
  function renderAll() { renderNotes(); renderWeek(); renderTrips(); renderPeople(); renderMore(); }

  async function refresh() {
    const my = ++epoch;
    renderAll();
    const tasks = [loadStory(homePlace()), ...upcomingTrips().filter((t) => parseDay(t.start).getTime() <= horizonEnd()).map((t) => loadStory(tripPlace(t)))];
    if (focusKey?.startsWith('pin:')) { const p = pins.all().find((x) => `pin:${x.id}` === focusKey); if (p) tasks.push(loadStory(pinPlace(p))); }
    await Promise.all(tasks);
    await sortPeople();
    if (my !== epoch) return;
    renderAll(); paintFocus(); paintActive();
  }

  bus.on('pins:changed', () => { for (const k of [...stories.keys()]) if (k !== 'home') { const [kind, id] = k.split(':'); const live = kind === 'trip' ? pins.trips().some((t) => String(t.id) === id) : pins.all().some((p) => String(p.id) === id); if (!live) stories.delete(k); } refresh(); });
  bus.on('pin:focus', ({ pinId }) => {
    const p = pins.all().find((x) => x.id === pinId);
    if (!p) return;
    groupFilter = 'all'; showAll = true;
    focusPlace(pinPlace(p)).then(() => { renderPeople(); body.querySelector(`.person[data-pin="${CSS.escape(String(p.id))}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
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
    homePlace,
    anchorMs,
  };
}
