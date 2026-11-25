// The Briefing's card (C1-03): renders any beat in any player state. It holds no data, no store and no player: the wiring tells it what
// to show (show, setState, setProgress, setStrip, setDate, setZoneCaption) and hears about presses through the callbacks.
// DOM (CONCEPTS-REVIEW M9): section#brief-card[role=region][aria-label=Briefing][data-chapter][data-beat][data-state]
//   .brief-segs[role=progressbar] > .brief-seg > i; .brief-kicker, .brief-date, .brief-title, .brief-line (0 to 2),
//   .brief-stamp[data-level][data-source][data-texture], .brief-strip, .brief-controls > button[data-act], .brief-live[aria-live=polite].
// The stamp is words plus a texture that matches the timeline's zones: solid (one high-resolution forecast), a dashed edge (the blend),
// hatch (pattern only). Never a colour from a field palette.

const TEXTURE = { hres: 'solid', blend: 'dashed', mean: 'hatch', 'hres-late': 'hatch' };
const HIDDEN_CHAPTERS = new Set(['title', 'end']);

function ensureCss() {
  if (document.getElementById('wse-brief-css')) return;
  const link = document.createElement('link');
  link.id = 'wse-brief-css'; link.rel = 'stylesheet'; link.href = new URL('../../css/brief.css', import.meta.url).href;
  document.head.append(link);
}

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const clamp01 = (x) => (x > 1 ? 1 : x > 0 ? x : 0);
const leadOf = (days) => (!days ? '' : days[0] === days[1] ? `Day ${days[0]}` : `Days ${days[0]}-${days[1]}`);

export function mountCard(root, handlers = {}) {
  ensureCss();
  const h = handlers;
  const card = el('section'); card.id = 'brief-card'; card.className = 'brief-card';
  card.setAttribute('role', 'region'); card.setAttribute('aria-label', 'Briefing');
  card.dataset.state = 'playing';

  const segs = el('div', 'brief-segs'); segs.setAttribute('role', 'progressbar'); segs.setAttribute('aria-label', 'Briefing progress');
  segs.setAttribute('aria-valuemin', '0'); segs.setAttribute('aria-valuemax', '100'); segs.setAttribute('aria-valuenow', '0');
  const head = el('div', 'brief-head'); const kicker = el('p', 'brief-kicker'); const date = el('p', 'brief-date'); head.append(kicker, date);
  const title = el('h2', 'brief-title');
  const body = el('div', 'brief-body');
  const stamp = el('p', 'brief-stamp'); stamp.hidden = true;
  const strip = el('div', 'brief-strip'); strip.hidden = true;
  const controls = el('div', 'brief-controls');
  const live = el('div', 'brief-live'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');

  const mk = (act, label, cb, primary) => {
    const b = el('button', 'brief-btn', label); b.type = 'button'; b.dataset.act = act; if (primary) b.dataset.primary = 'true';
    b.addEventListener('click', () => { if (cb) cb(); });
    return b;
  };
  const bPause = mk('pause', 'Pause', () => { (state === 'paused' ? h.onResume : h.onPause)?.(); });
  const bPrev = mk('prev', 'Back', () => h.onPrev?.());
  const bNext = mk('next', 'Next', () => h.onNext?.(), true);
  const bClose = mk('close', 'Close', () => h.onClose?.());
  const bReplay = mk('replay', 'Replay', () => h.onReplay?.(), true);
  const bStay = mk('stay', 'Explore from here', () => h.onStay?.());
  const bAdd = mk('add', 'Add', () => h.onAdd?.());
  controls.append(bPrev, bPause, bNext, bReplay, bStay, bAdd, bClose); // the reading order is the tab order
  card.append(segs, head, title, body, stamp, strip, controls, live);
  root.append(card);
  bPause.focus({ preventScroll: true });

  let state = 'playing', beat = null, script = null, segIndex = -1, progress = 0, announced = null, zoneCaption = null, alive = true;

  function paint() {
    // the current segment fills with progress; a rewind beat empties instead
    const fills = [...segs.children];
    fills.forEach((s, i) => {
      const done = segIndex < 0 ? (beat && beat.chapter === 'end') : i < segIndex;
      const cur = i === segIndex;
      const f = cur ? (beat.hook === 'rewind' ? 1 - progress : progress) : done ? 1 : 0;
      s.firstElementChild.style.transform = `scaleX(${f})`;
      s.dataset.state = cur ? 'current' : done ? 'done' : 'todo';
    });
    const n = fills.length || 1;
    const cur = segIndex < 0 ? (beat && beat.chapter === 'end' ? n : 0) : segIndex + progress;
    segs.setAttribute('aria-valuenow', String(Math.round((cur / n) * 100)));
  }

  function paintStamp() {
    const s = beat && beat.sure;
    if (!s || HIDDEN_CHAPTERS.has(beat.chapter)) { stamp.hidden = true; delete stamp.dataset.level; delete stamp.dataset.source; return; }
    stamp.hidden = false;
    stamp.dataset.level = s.level; stamp.dataset.source = s.source; stamp.dataset.texture = TEXTURE[s.zone] || 'solid';
    const mark = el('span', 'brief-stamp-mark'); mark.setAttribute('aria-hidden', 'true');
    const words = el('span', 'brief-stamp-words');
    words.append(el('span', 'brief-stamp-lead', leadOf(s.days)));
    if (s.phrase) words.append(el('span', 'brief-stamp-phrase', s.phrase));
    const cap = zoneCaption != null ? zoneCaption : s.caption;
    if (cap) words.append(el('span', 'brief-stamp-cap', cap));
    stamp.replaceChildren(mark, words);
  }

  function paintControls() {
    const ended = !!beat && beat.chapter === 'end';
    const hasPlace = !!script && script.beats.some((b) => b.chapter === 'people' || b.chapter === 'trip');
    const wasFocused = card.contains(document.activeElement) ? document.activeElement : null;
    bPause.hidden = bPrev.hidden = bNext.hidden = ended;
    bReplay.hidden = bStay.hidden = !ended;
    bAdd.hidden = !(ended && !hasPlace);
    bPause.textContent = state === 'paused' ? 'Play' : 'Pause';
    if (wasFocused && wasFocused.hidden) (ended ? bReplay : bPause).focus({ preventScroll: true });
  }

  const api = {
    /** Show `b` (a Beat of `scr`, at position `index`). Announces the beat once when it changes. */
    show(b, scr, index) {
      if (!alive) return;
      beat = b; script = scr;
      card.dataset.chapter = b.chapter; card.dataset.beat = b.id;
      const inner = (scr.beats || []).filter((x) => !HIDDEN_CHAPTERS.has(x.chapter));
      if (segs.children.length !== inner.length) segs.replaceChildren(...inner.map(() => { const s = el('span', 'brief-seg'); s.append(el('i')); return s; }));
      segIndex = HIDDEN_CHAPTERS.has(b.chapter) ? -1 : inner.indexOf(b);
      progress = 0; zoneCaption = null;
      kicker.textContent = b.kicker || '';
      title.textContent = b.title || '';
      body.replaceChildren(...(b.lines || []).slice(0, 2).map((t) => el('p', 'brief-line', t)));
      body.hidden = !(b.lines && b.lines.length);
      paintStamp(); paintControls(); paint();
      if (announced !== b.id) {
        announced = b.id;
        live.textContent = [b.kicker, b.title, ...(b.lines || [])].filter(Boolean).join('. ');
      }
    },
    setState(s) {
      state = s; card.dataset.state = s;
      paintControls();
    },
    setProgress(p) { progress = clamp01(+p || 0); paint(); },
    setStrip(svg) {
      if (svg) { strip.innerHTML = svg; strip.hidden = false; } else { strip.replaceChildren(); strip.hidden = true; }
    },
    setDate(t) { date.textContent = t || ''; date.hidden = !t; },
    setZoneCaption(t) { zoneCaption = t; if (beat) paintStamp(); },
    height() { return card.getBoundingClientRect().height; },
    destroy() {
      if (!alive) return; alive = false;
      const had = card.contains(document.activeElement) || document.activeElement === document.body || !document.activeElement;
      card.remove();
      const pill = document.getElementById('brief-pill');
      if (had && pill && !pill.disabled) pill.focus({ preventScroll: true });
    },
  };
  return api;
}
