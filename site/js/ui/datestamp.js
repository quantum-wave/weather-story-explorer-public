// The date stamp: the time the map shows, in large translucent letters over the top-left of the chart ("Thu 27 Nov" over "4 pm PST"),
// so a playing animation can be followed without looking down at the timeline. The words are the timeline readout's own
// (time/model.js formatReadout: the viewer's time zone, named the same way; the year on sample data), split into a day line and an
// hour line. While playing, the hour is the valid time rounded to the nearest local hour and the text is rewritten only when that
// changes; paused, it is the minute the timeline shows ("4:17 pm", seconds dropped the same way). It is decoration: aria-hidden (the timeline's slider already
// announces the time), pointer-events none, under every control. It yields (fades out) whenever a control, panel, card or tip
// overlaps it, so it never sits under or over anything a person reads or presses. CSS: css/datestamp.css.
import { formatReadout } from '../time/model.js';
import { groundOf } from './maplegend.js';

const CSS_ID = 'wse-datestamp-css';
/** What the stamp gives way to: anything floating over the chart that it could touch. */
export const YIELD_TO = [
  '#map-tools', '#btn-reset', '#layers-panel', '#map-status', '#toasts', '#map-legend', '.brief-pill', '#brief-card', '.coach',
  '.rdo', '.wse-sample-chip', '#display-menu', '#data-popover', '#home', '#timeline', '.tl-menu',
];

/**
 * The local hour nearest a Date: whole hours on the viewer's wall clock (a :30 zone still gets whole local hours), rounded on
 * absolute time with the zone offset at that instant, so the repeated hour of a fall-back night keeps its own UTC hour.
 */
export function nearestHour(date) {
  const H = 3600e3, off = -date.getTimezoneOffset() * 60e3, t = date.getTime();
  return new Date(Math.floor((t + off + H / 2) / H) * H - off);
}

/**
 * The stamp's two lines for a valid time: {day: 'Thu 27 Nov', hour: '4 pm PST'} (day gains the year when `year`). `exact` keeps the
 * minutes as the timeline readout does; otherwise the time is the nearest whole local hour.
 */
export function stampLines(date, tz, { year = false, exact = false } = {}) {
  const d = exact ? date : nearestHour(date);
  const main = formatReadout(d, tz, { year }).main; // 'Thu 27 Nov, 4 pm PST'
  const i = main.indexOf(', ');
  return { day: main.slice(0, i), hour: main.slice(i + 2) };
}

const tzOf = (d) => { try { return new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value || ''; } catch { return ''; } };
const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
function shown(el) {
  if (!el.isConnected || el.hidden || el.closest('[hidden]')) return false;
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility !== 'visible') return false;
  // fading or rising in (opacity still 0 in its first frame): it is arriving, so it counts
  return +cs.opacity > 0 || !!el.getAnimations?.().some((a) => a.playState === 'running');
}

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const link = document.createElement('link');
  link.id = CSS_ID; link.rel = 'stylesheet'; link.href = new URL('../../css/datestamp.css', import.meta.url).href;
  document.head.append(link);
}

/** Mounts the stamp into #stage. app: {store, data, clock}. Returns {el, update, unmount}. */
export function mountDateStamp(app) {
  const { store, data, clock } = app;
  const stage = document.getElementById('stage');
  if (!stage) return { el: null, update() {}, unmount() {} };
  ensureCss();
  const el = document.createElement('div');
  el.className = 'map-stamp';
  el.setAttribute('aria-hidden', 'true');
  el.hidden = true; // until there is a valid time
  const day = document.createElement('span'); day.className = 'map-stamp-day';
  const hour = document.createElement('span'); hour.className = 'map-stamp-hour';
  el.append(day, hour);
  stage.append(el);

  let lastKey = '', lastGround = '';
  /** Per store change (every frame while playing): one Date and a string key; the DOM is touched only when the words change. */
  function update(s = store.get()) {
    const g = groundOf(s);
    if (g !== lastGround) { lastGround = g; el.dataset.ground = g; }
    let d;
    let t = s.t;
    try { const [lo, hi] = clock?.range?.() || []; if (hi > lo) t = Math.min(hi, Math.max(lo, t)); } catch { /* no range yet */ } // the hour the timeline shows
    try { d = data.validTime(t); } catch { d = null; }
    if (!d || !Number.isFinite(d.getTime())) { if (!el.hidden) { el.hidden = true; lastKey = ''; } return; }
    const exact = !s.playing;
    // paused: the minute the timeline readout shows, which truncates the seconds (formatReadout reads getMinutes), never rounds them
    const shownAt = exact ? Math.floor(d.getTime() / 60e3) : nearestHour(d).getTime() / 60e3;
    const key = `${shownAt}|${exact ? 1 : 0}|${s.sample ? 1 : 0}`;
    if (key === lastKey) return;
    lastKey = key;
    const at = exact ? new Date(shownAt * 60e3) : nearestHour(d);
    const L = stampLines(at, tzOf(at), { year: !!s.sample, exact: true });
    if (day.textContent !== L.day) day.textContent = L.day;
    if (hour.textContent !== L.hour) hour.textContent = L.hour;
    el.dataset.t = String(t);
    if (el.hidden) { el.hidden = false; scheduleYield(); }
  }

  // ---- yielding: re-checked when something outside the timeline appears, moves or changes size (one check per frame at most)
  let raf = 0;
  function checkYield() {
    raf = 0;
    if (el.hidden) return;
    const me = el.getBoundingClientRect();
    if (!me.width || !me.height) return;
    let by = '';
    for (const sel of YIELD_TO) {
      for (const o of document.querySelectorAll(sel)) {
        if (o === el || !shown(o)) continue;
        const r = o.getBoundingClientRect();
        if (r.width && r.height && hit(me, r)) { by = sel; break; }
      }
      if (by) break;
    }
    if ((el.dataset.yield || '') !== by) { if (by) el.dataset.yield = by; else delete el.dataset.yield; }
  }
  function scheduleYield() { if (!raf) raf = requestAnimationFrame(checkYield); }
  const timeline = document.getElementById('timeline'), canvas = document.getElementById('map');
  const mo = typeof MutationObserver === 'function' ? new MutationObserver((recs) => {
    for (const r of recs) {
      const t = r.target;
      if (t === el || el.contains(t) || t === canvas || (timeline && timeline.contains(t) && t !== timeline)) continue; // the scrubber's thumb moves every frame
      scheduleYield(); return;
    }
  }) : null;
  const appEl = document.getElementById('app') || document.body;
  mo?.observe(appEl, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'open', 'data-snap', 'data-expanded', 'data-brief', 'data-collapsed'] });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleYield) : null;
  ro?.observe(stage); ro?.observe(el);
  addEventListener('resize', scheduleYield);
  // a tip or card that fades or rises in is still transparent when it is inserted: look again when its animation or transition ends
  for (const ev of ['animationend', 'transitionend']) appEl.addEventListener(ev, scheduleYield, true);

  const off = store.subscribe((s) => update(s));
  update();
  scheduleYield();
  return {
    el, update, checkYield,
    unmount() { off?.(); mo?.disconnect(); ro?.disconnect(); removeEventListener('resize', scheduleYield); for (const ev of ['animationend', 'transitionend']) appEl.removeEventListener(ev, scheduleYield, true); if (raf) cancelAnimationFrame(raf); el.remove(); },
  };
}
