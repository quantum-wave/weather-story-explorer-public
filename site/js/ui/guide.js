// "What am I looking at?" (DESIGN-SPEC 5.2) and "How sure is this?" (5.5): the explanation at one tap.
// The guide opens in the shared sheet (a bottom sheet on the phone, the 420 px dialog from 900 px). Its text is the active lens's own
// (descriptor.guide: answer, what, read, worth), so a lens cannot ship without one; the same builder renders how.html from the
// descriptors, so the page cannot drift. "For you" is the focus card's day line, taken from the same function (home.dayLine).
// "How sure" reads the confidence module's zones table and this run's own spread curve (data.sampleDomainSpread); the GRIB sentence
// appears only when the manifest carries a passing checks.grib_compare.
import { h } from './dom.js';
import { openSheet } from './sheet.js';
import { lens as lensOf } from '../lenses/index.js';
import { zones, zoneAt, confidenceAt, CONFIDENCE_WORDS } from '../story/confidence.js';
import { runMs, ageHours, isLive, isMultiCase } from '../data/kind.js';

const NS = 'http://www.w3.org/2000/svg';
const upper = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const svg = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v));
  for (const k of kids) if (k) e.append(k);
  return e;
};

export const DIAGRAM_CAPTION = 'Warm air below lifts the surface; cold air lowers it.';

/** The side view of the atmosphere (5.2 item 2): ground, the 500 hPa surface, a ridge bulging over warm air, a trough sagging over
 *  cold air, and the jet stream along the slope between them. Inline SVG, theme-aware through CSS variables (guide.css). */
export function diagram() {
  const wave = 'M8 62 C 58 62 68 30 112 30 C 156 30 172 88 222 88 C 262 88 282 62 312 62';
  const s = svg('svg', { viewBox: '0 0 320 160', class: 'gd-svg', role: 'img', 'aria-label': `Side view of the atmosphere. ${DIAGRAM_CAPTION} The jet stream runs along the slope between the ridge and the trough.` });
  s.append(
    svg('defs', {},
      svg('clipPath', { id: 'gd-up' }, svg('rect', { x: 0, y: 0, width: 320, height: 62 })),
      svg('clipPath', { id: 'gd-dn' }, svg('rect', { x: 0, y: 62, width: 320, height: 98 })),
      svg('marker', { id: 'gd-arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svg('path', { d: 'M1 1 L9 5 L1 9 Z', class: 'gd-jet-head' }))),
    svg('path', { d: `${wave} L312 62 L8 62 Z`, class: 'gd-ridge', 'clip-path': 'url(#gd-up)' }),
    svg('path', { d: `${wave} L312 62 L8 62 Z`, class: 'gd-trough', 'clip-path': 'url(#gd-dn)' }),
    svg('line', { x1: 8, y1: 62, x2: 312, y2: 62, class: 'gd-normal' }),
    svg('path', { d: wave, class: 'gd-surface' }),
    svg('path', { d: 'M134 36 C 150 37 168 46 188 58', class: 'gd-jet', 'marker-end': 'url(#gd-arrow)' }),
    svg('rect', { x: 8, y: 144, width: 304, height: 8, class: 'gd-ground' }),
  );
  const t = (x, y, txt, cls, anchor = 'middle') => { const e = svg('text', { x, y, class: `gd-t ${cls || ''}`, 'text-anchor': anchor }); e.textContent = txt; return e; };
  s.append(
    t(112, 22, 'RIDGE', 'gd-k gd-k-ridge'), t(222, 112, 'TROUGH', 'gd-k gd-k-trough'),
    t(112, 108, 'warm air', 'gd-air'), t(222, 134, 'cold air', 'gd-air'),
    t(198, 44, 'jet stream', 'gd-jet-t', 'start'), t(8, 78, 'usual height', 'gd-note', 'start'),
    t(8, 140, 'ground', 'gd-note', 'start'), t(312, 12, 'about 5.5 km up', 'gd-note', 'end'),
  );
  return s;
}

/** The confidence line for a forecast hour: the zone's caption, and how sure the timing is (never a claim from nothing). */
export function sureLine(t, { hasMean = true, maxStep = 360, spreadDam = NaN } = {}) {
  const lead = Math.max(1, Math.ceil((t || 0) / 24));
  const z = zoneAt(Math.max(0, t || 0), maxStep, { hasMean });
  const c = confidenceAt(t, { spreadDam, hasSpread: Number.isFinite(spreadDam) });
  const words = CONFIDENCE_WORDS[c.level];
  const pattern = !words ? '' : c.level === 'pattern-only' ? upper(words) + '.' : `Timing: ${words}.`;
  return [`Day ${lead}: ${z ? upper(z.caption) : 'beyond this run'}.`, pattern].filter(Boolean).join(' ');
}

/** The lead-time ladder in words from a spread curve ({steps (hours), values (dam)}): the first day at which the forecasts stop
 *  agreeing closely (3 dam) and the first at which they disagree by more than a contour interval (6 dam). Null without a curve. */
export function ladderWords(curve) {
  if (!curve || !curve.steps?.length) return null;
  const pts = curve.steps.map((st, i) => ({ day: st / 24, v: curve.values[i] })).filter((p) => Number.isFinite(p.v) && p.day > 0);
  if (pts.length < 3) return null;
  const first = (lim) => pts.find((p) => p.v >= lim);
  const a = first(3), b = first(6), last = pts[pts.length - 1].day;
  const day = (p) => `day ${Math.max(1, Math.ceil(p.day))}`;
  if (!a) return `In this run the forecasts agree closely (under 3 dam of spread) all the way to day ${Math.floor(last)}.`;
  const p1 = `In this run the forecasts agree closely (under 3 dam of spread) until about ${day(a)}`;
  return b ? `${p1}, and disagree by more than one contour (6 dam) from about ${day(b)}.` : `${p1}, and stay within one contour (6 dam) of each other to day ${Math.floor(last)}.`;
}

const REF_LABEL = 'one contour’s worth of doubt';
const REF_LINES = [[REF_LABEL], ['one contour’s ', 'worth of doubt']]; // on one line, else on two
const LINE_H = 17;
export const REF_CLEAR = 8; // chart units kept between the label's box and the plotted curve (the chart draws at about 1:1; the test asks 4 px)

/** Where the reference line's label goes: on one line or two, above or below the dashed line, at the left, the right or between,
 *  wherever the curve keeps at least REF_CLEAR clear of the label's box (its widest likely size). Prefers one line below-left; with
 *  no clear spot, the one with the most clearance. `pts` is the plotted curve in chart units. Returns {x, y, anchor, lines}, y the first baseline. */
export function refLabelSpot(pts, { L, R, T, W, H, B, yRef }) {
  const line = [];
  for (let i = 0; i < pts.length - 1; i++) { const [a, b] = [pts[i], pts[i + 1]], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2)); for (let k = 0; k <= n; k++) line.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
  if (pts.length === 1) line.push(pts[0]);
  let best = null;
  for (const lines of REF_LINES) {
    const w = Math.max(...lines.map((l) => l.trim().length)) * 6.4 + 4, top = 10, bot = 4 + LINE_H * (lines.length - 1);
    const gap = (bx, by) => line.reduce((m, q) => Math.min(m, Math.hypot(Math.max(bx - q[0], 0, q[0] - (bx + w)), Math.max(by - top - q[1], 0, q[1] - (by + bot)))), Infinity);
    const xs = []; for (let bx = L + 8; bx + w <= W - R - 4 + 0.01; bx += 6) xs.push(bx);
    for (const by of [yRef + 16, yRef - 3 - bot]) {
      if (by - top < T || by + bot > H - B) continue;
      for (const bx of xs) {
        const g = gap(bx, by);
        if (g >= REF_CLEAR) return { x: bx, y: by, anchor: 'start', lines };
        if (!best || g > best.g) best = { x: bx, y: by, anchor: 'start', lines, g };
      }
    }
  }
  return best || { x: L + 8, y: yRef + 16, anchor: 'start', lines: REF_LINES[0] };
}

/** The spread chart: this run's 30-60N mean spread against lead time, with the 6 dam contour interval as a reference line. */
export function spreadChart(curve) {
  const W = 320, H = 166, L = 34, R = 10, T = 14, B = 42;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'gd-svg gd-chart', role: 'img' });
  const pts = curve ? curve.steps.map((st, i) => [st / 24, curve.values[i]]).filter((p) => Number.isFinite(p[1])) : [];
  const maxDay = Math.max(15, ...pts.map((p) => p[0])), maxV = Math.max(10, Math.ceil(Math.max(0, ...pts.map((p) => p[1])) / 2) * 2);
  const x = (d) => L + (d / maxDay) * (W - L - R), y = (v) => T + (1 - v / maxV) * (H - T - B);
  const t = (px, py, txt, cls, anchor = 'middle') => { const e = svg('text', { x: px, y: py, class: `gd-t ${cls || ''}`, 'text-anchor': anchor }); e.textContent = txt; return e; };
  s.append(svg('line', { x1: L, y1: H - B, x2: W - R, y2: H - B, class: 'gd-axis' }), svg('line', { x1: L, y1: T, x2: L, y2: H - B, class: 'gd-axis' }));
  for (const d of [0, 3, 7, 10, 15]) if (d <= maxDay) s.append(t(x(d), H - B + 14, String(d), 'gd-tick'));
  s.append(t((L + W - R) / 2, H - 2, 'days ahead', 'gd-note'));
  for (const v of [0, 3, 6, 9, 12].filter((q) => q <= maxV)) s.append(t(L - 5, y(v) + 4, String(v), 'gd-tick', 'end'));
  s.append(t(L, T - 3, 'dam', 'gd-note', 'start'));
  s.append(svg('line', { x1: L, y1: y(6), x2: W - R, y2: y(6), class: 'gd-ref' }));
  const ref = refLabelSpot(pts.map((p) => [x(p[0]), y(p[1])]), { L, R, T, W, H, B, yRef: y(6) });
  const rt = t(ref.x, ref.y, '', 'gd-note', ref.anchor);
  ref.lines.forEach((l, i) => { const ts = svg('tspan', { x: ref.x, dy: i ? LINE_H : 0 }); ts.textContent = l; rt.append(ts); });
  s.append(rt);
  if (pts.length > 1) {
    s.append(svg('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' '), class: 'gd-line' }));
    s.setAttribute('aria-label', `Spread of the forecasts against lead time in this run, from ${pts[0][1].toFixed(1)} dam now to ${pts[pts.length - 1][1].toFixed(1)} dam at day ${Math.round(pts[pts.length - 1][0])}; 6 dam is one contour.`);
  } else {
    s.append(t((L + W - R) / 2, (T + H - B) / 2, 'Spread is not in this run', 'gd-note'));
    s.setAttribute('aria-label', 'Spread of the forecasts is not in this run.');
  }
  return s;
}

const sec = (title, ...kids) => h('section', { class: 'gd-sec' }, title ? h('h3', { class: 'gd-h', text: title }) : null, ...kids);
const para = (text, cls = '') => h('p', { class: `gd-p ${cls}`.trim(), text });

/** One lens's guide as DOM (also how.html's section). `ctx`: {forYou, sure (a line), onSure, zoneCaption}. */
export function buildLensGuide(L, ctx = {}) {
  const g = L.guide || {};
  const root = h('div', { class: 'gd', 'data-lens': L.id });
  root.append(para(g.answer || g.what || '', 'gd-answer'));
  if (L.code === 'z') root.append(h('figure', { class: 'gd-fig' }, diagram(), h('figcaption', { text: DIAGRAM_CAPTION })));
  if (g.what && g.answer) root.append(sec('What it shows', para(g.what)));
  if (g.read) root.append(sec('Read it', para(g.read)));
  if (ctx.forYou) root.append(sec('For you', h('p', { class: 'gd-p gd-foryou', text: ctx.forYou })));
  if (ctx.sure) {
    root.append(sec('How sure is this?', para(ctx.sure, 'gd-sure'), ctx.onSure ? h('button', { type: 'button', class: 'gd-link', 'data-guide-go': 'sure', onclick: ctx.onSure, text: 'See how sure ▸' }) : null));
  }
  const worth = [...(g.worth || []), ctx.zoneCaption ? `Right now the map shows ${ctx.zoneCaption}.` : ''].filter(Boolean);
  if (worth.length) root.append(sec('Worth knowing', ...worth.map((w) => para(w))));
  return root;
}

const fmtLocal = (ms) => { try { return new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(ms)); } catch { return ''; } };
const fmtUTC = (ms) => { const d = new Date(ms), p = (n) => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`; };

/** "About this data" (5.2 item 7) as DOM. */
export function aboutData(m, { now = Date.now() } = {}) {
  if (!m) return null;
  const rows = [];
  const r = runMs(m);
  if (m.model) rows.push(['Model', m.model]);
  if (r === r) rows.push(['Run', `${fmtLocal(r)} (${fmtUTC(r)})${isLive(m) ? `, ${Math.max(0, Math.floor(ageHours(m, now)))} h old` : ''}`]);
  if (m.climatology?.label) rows.push(['Normal', `${m.climatology.label}${m.climatology.source ? ` (${m.climatology.source})` : ''}`]);
  rows.push(['Style', 'ECMWF colours, 6 dam height lines (US convention)']);
  rows.push(['Constructions', 'Colours past ±40 dam and every colour on the Night ground are our own construction, not ECMWF’s.']);
  if (m.attribution) rows.push(['Licence', m.attribution]);
  if (!isLive(m)) rows.push(['Status', isMultiCase(m) ? 'Past weather standing in for a forecast: not live.' : 'Recorded forecast, not live.']);
  rows.push(['Privacy', 'Your people and places stay in this browser; nothing about them is sent anywhere.']);
  return sec('About this data', h('dl', { class: 'gd-dl' }, rows.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]).flat()));
}

/** The "How sure is this?" panel (5.5) as DOM. `curve` is data.sampleDomainSpread() (steps in hours, values in gpm) or null. */
export function buildSure(m, { curve = null, hasMean = true, onBack = null, sureNow = '' } = {}) {
  const dam = curve ? { steps: curve.steps, values: Array.from(curve.values, (v) => v / 10) } : null;
  const root = h('div', { class: 'gd gd-sure-panel' });
  if (onBack) root.append(h('button', { type: 'button', class: 'gd-link gd-back', 'data-guide-go': 'guide', onclick: onBack, text: '◂ What am I looking at?' }));
  if (sureNow) root.append(para(sureNow, 'gd-answer'));
  const ladder = dam && ladderWords(dam);
  root.append(sec('How the doubt grows', ...zones(360, { hasMean }).map((q) => para(`Days ${q.days[0]}-${q.days[1]}: ${q.caption}.`)), ladder ? para(ladder, 'gd-ladder') : null));
  root.append(sec('This run’s spread', h('figure', { class: 'gd-fig' }, spreadChart(dam), h('figcaption', { text: 'How far the 51 forecasts spread apart over the north Pacific and North America (30-60°N), in dam. Above the dashed line, the doubt is bigger than one contour interval.' }))));
  root.append(sec('What the map does about it', para(hasMean
    ? 'It shows one high-resolution forecast to day 7, moves to the 51-forecast average by day 10, hatches the places where forecasts disagree, and says “No clear signal yet” where the average is smaller than the disagreement.'
    : 'This run has no ensemble average, so it shows one forecast throughout; days 8-15 give the pattern only, hatched where the forecasts disagree.')));
  const checked = ['The “normal” was compared with an independent NOAA normal and agrees within about 1 m.'];
  const gc = m?.checks?.grib_compare;
  if (gc && gc.status === 'pass' && Number.isFinite(+gc.max_abs_gpm)) checked.push(`This run’s values were compared with the raw ECMWF file: largest difference ${+(+gc.max_abs_gpm).toFixed(1)} m.`);
  root.append(sec('What has been checked', ...checked.map((c) => para(c))));
  root.append(sec('What has not', para('Rain thresholds for “likely” and “heavy” are first settings and will be tuned. Frame times were measured on a throttled desktop browser, not a phone.')));
  return root;
}

// ---------------------------------------------------------------------------------------------------------------------------------
let ctxApp = null;
let current = null; // {sheet, view}
let offChunk = null;

const homeOf = () => ctxApp?.home || window.__wse?.ui?.home || null;

/** The card's day line for the focused place and time, from the one function the card uses (home.dayLine). */
export function forYouNow() {
  const hm = homeOf();
  const text = typeof hm?.dayLine === 'function' ? hm.dayLine() : '';
  return { text: text || '', place: ctxApp?.store?.get?.().focus?.label || '' };
}

function spreadAtFocus() {
  try {
    const f = ctxApp.store.get().focus;
    let ll = f && Number.isFinite(f.lat) ? [f.lon, f.lat] : null;
    if (!ll) { const c = document.getElementById('map'); ll = c ? ctxApp.renderer.invert([c.clientWidth / 2, c.clientHeight / 2]) : null; }
    const v = ll ? ctxApp.sampleAt(ll[0], ll[1])?.values?.z500sd : NaN;
    return Number.isFinite(v) ? v / 10 : NaN;
  } catch { return NaN; }
}

function runState() {
  const m = ctxApp.data.getManifest();
  const hasMean = typeof ctxApp.data.hasMean === 'function' ? ctxApp.data.hasMean() : true;
  const steps = ctxApp.data.fieldSteps?.('z500a') || [];
  const maxStep = steps.length ? steps[steps.length - 1] : 360;
  const t = ctxApp.store.get().t;
  return { m, hasMean, sure: sureLine(t, { hasMean, maxStep, spreadDam: spreadAtFocus() }), zone: zoneAt(Math.max(0, t), maxStep, { hasMean }) };
}

function guideView() {
  const L = lensOf(ctxApp.store.get().lens ?? 'z') || lensOf('z');
  const rs = runState(), fy = forYouNow();
  const el = buildLensGuide(L, { forYou: fy.text, sure: rs.sure, zoneCaption: rs.zone?.caption || '', onSure: () => show('sure') });
  const about = aboutData(rs.m);
  if (about) el.append(about);
  el.append(h('button', { type: 'button', class: 'gd-link gd-tips', onclick: () => { try { ctxApp.coach?.reset?.(); } catch { /* no coach */ } current?.sheet.close('close'); }, text: 'Show the tips again' }));
  return el;
}

function sureView() {
  const rs = runState();
  let curve = null;
  try { curve = ctxApp.data.sampleDomainSpread?.() || null; } catch { curve = null; }
  return buildSure(rs.m, { curve, hasMean: rs.hasMean, sureNow: rs.sure, onBack: () => show('guide') });
}

function show(section) {
  if (!current) return;
  const sheet = current.sheet, sure = section === 'sure';
  current.view = sure ? 'sure' : 'guide';
  sheet.setTitle(sure ? 'How sure is this?' : 'What am I looking at?');
  sheet.setContent(sure ? sureView() : guideView());
  sheet.el.querySelector('.wse-sheet-body')?.scrollTo?.(0, 0);
  offChunk?.(); offChunk = null;
  if (sure) {
    // the spread curve fills in as the ensemble chunks arrive: redraw once they settle
    let timer = 0;
    offChunk = ctxApp.bus.on('data:chunk', () => { clearTimeout(timer); timer = setTimeout(() => { if (current?.view === 'sure') current.sheet.setContent(sureView()); }, 250); });
  }
}

/** Open the guide for the active lens; `openGuide('sure')` opens "How sure is this?" directly. Returns the sheet handle. */
export function openGuide(section) {
  if (!ctxApp) return null;
  current = null;
  const sheet = openSheet({
    title: 'What am I looking at?', content: h('div'),
    actions: [{ label: 'Done', kind: 'primary', onClick: (s) => s.close('close') }],
    onClose: () => { offChunk?.(); offChunk = null; current = null; },
  });
  current = { sheet, view: 'guide' };
  show(section);
  return sheet;
}

function ensureCss() {
  if (document.querySelector('link[data-guide-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('../../css/guide.css', import.meta.url).href; l.setAttribute('data-guide-css', '');
  document.head.append(l);
}

/** Wire the guide: the legend's "What is this?" looks up ui.openGuide; the app carries openGuide too. */
export function mountGuide(app) {
  ctxApp = app;
  ensureCss();
  app.openGuide = openGuide;
  if (window.__wse?.ui) window.__wse.ui.openGuide = openGuide;
  return { open: openGuide, close: () => { current?.sheet.close('close'); } };
}
