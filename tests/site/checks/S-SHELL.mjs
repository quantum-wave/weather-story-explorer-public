// S-SHELL (W3-04, Josh points 4, 5, 14): the shell as a person meets it. Design spec 3.1, 10 and 11.1; ground rules 14.1 and 14.3.
//   hooks     the section 15 shell hooks exist, #btn-theme is gone, #run-label and #sample-badge are replaced by #data-chip
//   header    one 44 px row at 390, 900 and 1440 px; the phone shows a button labelled "More"
//   chip      one line, nowrap, scrollWidth <= clientWidth, no Z time suffix, in all five data states, at 390 and 320 px; the tail (age,
//             stale, 'not a forecast', 'not live') stays whole and every visible piece is a whole word (nothing cut with an ellipsis)
//   legend    on a static first load at peek, and after a peek re-measure, the DOM legend (#map-legend) is inside the visible chart
//             and nothing covers it (point 13): checked with elementFromPoint at its centre and corners
//   share     at 390 x 844 the chart not covered by header, sheet, timeline, tools, legend or toast is >= 55% at peek and
//             >= 35% at half; peek is at most 180 px and holds a three-line sentence whole; half puts the sheet top at
//             HALF_TOP_DEFAULT (spec 54%; the conflict and its measured trade-off are printed every run); bounding boxes are printed
//   drag      the sheet moves from its handle and from a body scrolled to the top, never from a scrolled body, never from a horizontal
//             swipe, even mid-gesture (real touch). Peek and half are reached by real taps on the handle, not by store.set
//   text      every control in the header, map tools and Display menu has visible text (exceptions listed below)
//   display   Theme / Chart / Units / Time as text items; Auto follows the system; choices persist across a reload
//   mono      no monospace outside #debug (header, map tools, panel, menu, timeline)
//   stage     light theme: hairline and shadow on the chart stage; dark: rounded inset (desktop)
// Failures are collected so one run prints every number; the check fails if any section failed.
import * as inp from '../lib/input.mjs';
import { MEASURE, toolsRowProblems, PHONE_WIDTHS, DESKTOP_WIDTHS } from '../lib/toolsrow.mjs';

export const id = 'S-SHELL';
export const freshProfile = true;
export const timeoutMs = 150000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOOKS = ['app', 'topbar', 'stage', 'map', 'map-tools', 'view-switch', 'btn-layers', 'layers-panel', 'legend', 'map-status', 'timeline', 'home', 'sheet-handle', 'focus-card', 'home-body', 'toasts', 'live', 'data-chip', 'btn-more', 'btn-display', 'btn-reset', 'btn-expand', 'divider'];
// The listed exceptions to "no icon-only control" (design spec 3.1): the sheet's close and the timeline's play and step glyphs.
// The sheet handle is a drag grabber, not an icon control; it is listed here so the exception is visible and counted.
const ICON_EXCEPTIONS = ['.wse-sheet-close', '.tl-btn', '#sheet-handle'];

async function open(page, baseUrl, { w, h, mobile, scheme = 'dark' }) {
  await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: !!mobile, maxTouchPoints: 5 });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 30000 });
  await page.eval(`(async () => { (await import(new URL('js/time/clock.js', document.baseURI).href)).pause(); })()`);
  await sleep(500);
}

/** Area of `canvas` not covered by any of `rects` (all {x,y,w,h}), as a fraction of `viewArea`. Pixel grid, 1 CSS px. */
export function unobstructed(canvas, rects, viewArea) {
  const x0 = Math.max(0, Math.round(canvas.x)), y0 = Math.max(0, Math.round(canvas.y));
  const x1 = Math.round(canvas.x + canvas.w), y1 = Math.round(canvas.y + canvas.h);
  const W = x1 - x0, H = y1 - y0;
  if (W <= 0 || H <= 0) return 0;
  const grid = new Uint8Array(W * H);
  for (const r of rects) {
    const a = Math.max(x0, Math.round(r.x)), b = Math.min(x1, Math.round(r.x + r.w));
    const c = Math.max(y0, Math.round(r.y)), d = Math.min(y1, Math.round(r.y + r.h));
    for (let y = c; y < d; y++) grid.fill(1, (y - y0) * W + (a - x0), (y - y0) * W + (b - x0));
  }
  let free = 0;
  for (let i = 0; i < grid.length; i++) if (!grid[i]) free++;
  return free / viewArea;
}

const GEOMETRY = `(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const vis = (el) => { if (!el || el.hidden) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0; };
  const out = {}; const names = {};
  const put = (name, el) => { if (vis(el)) { out[name] = box(el); } };
  put('header', document.getElementById('topbar')); put('sheet', document.getElementById('home')); put('timeline', document.getElementById('timeline'));
  const extra = [];
  for (const el of document.querySelectorAll('#map-tools > *, #map-tools .tools-end > *, #layers-panel, #toasts > *, #map-status')) if (vis(el) && !(el.id === 'map-status' && !el.textContent.trim())) extra.push({ sel: el.id ? '#' + el.id : el.className || el.tagName, ...box(el) });
    return { vw: innerWidth, vh: innerHeight, canvas: box(document.getElementById('map')), blocks: out, extra, sheetVar: getComputedStyle(document.getElementById('app')).getPropertyValue('--sheet-h') };
})()`;

// ---- chart share, measured (design spec 11.1). Every rectangle is a real bounding box; nothing is substituted. ----
// Spec heights of the phone timeline (7.1, 11.1): 56 px at peek, 72 px at half. The timeline's measured height must equal them.
const TL_SPEC = { peek: 56, half: 72 };
// The two half-snap numbers of spec 11.1 conflict: with the sheet top at 54%, the 44 px tools row and the always-visible legend
// (Josh point 13), the chart is at most about 32% (35.6% with no legend at all), so 35% cannot hold at 54%. The chart share is the
// guarantee (11.1: "the chart keeps a guaranteed share"; default 39: "the map is the product"), so it stays at 35% and the sheet
// top moves instead: HALF_TOP_DEFAULT is a reversible default taken overnight (W3-04 rescue, 2026-11-19) for Josh to overturn.
// Every run measures and prints the share at the spec's 54% too, so the trade-off is visible. If Josh keeps 54% instead, set
// HALF_DECISION to { share, ref } (the share he accepts and his decision's reference) and HALF_TOP_DEFAULT.top back to 0.54.
const HALF_TOP_DEFAULT = { top: 0.58, spec: 0.54, ref: 'W3-04 rescue default 2026-11-19 (spec 11.1 conflict), for Josh to overturn' };
const HALF_DECISION = null;
const TARGET = { peek: 0.55, half: HALF_DECISION?.share ?? 0.35 };
// Spec 11.1 peek contents: handle, place name, a sentence of at most three lines, a 40 px strip; at most 180 px.
const PEEK_LINES = 3, PEEK_MAX = 180, STRIP_H = 40;
// A story sentence of the longest kind (W2-06 caps summaries at 110 characters): three lines at 390 px in the peek's own type, which
// home.css sets (W3-06's peek rule, 17/22, unclamped); the probe reads the computed size and line height and prints them.
const LONG_SENTENCE = 'Dry through Saturday under a ridge; rain likely from Sunday as a trough approaches. Fairly sure of the timing.';
const LEGEND_ROW = 36; // the spec's collapsed phone legend (5.1, 11.1): one 36 px row over the chart (reported for comparison)
// The legend is the DOM card #map-legend (ui/maplegend.js, W3-11). Point 13: it is always visible. It is read as a person sees it:
// its box lies inside the visible chart (below the map tools, above the timeline and the sheet), and the element on top at its
// centre and at four points just inside its corners is the legend itself (nothing covers it). Its box is subtracted from the share.
const LEGEND_SEEN = `(() => {
  const L = document.getElementById('map-legend'); if (!L) return { found: false };
  const r = L.getBoundingClientRect(), cs = getComputedStyle(L);
  const vis = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return b.width > 1 && b.height > 1 && getComputedStyle(el).visibility !== 'hidden' ? b : null; };
  const m = document.getElementById('map').getBoundingClientRect();
  const tools = [...document.querySelectorAll('#map-tools > *, #map-tools .tools-end > *')].map(vis).filter(Boolean);
  const tl = vis(document.getElementById('timeline')), sh = vis(document.getElementById('home'));
  const floor = Math.min(tl ? tl.top : innerHeight, sh && innerWidth < 900 ? sh.top : innerHeight, m.bottom);
  const ceil = Math.max(m.top, ...tools.map((b) => b.bottom));
  const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 8, r.top + 8], [r.right - 8, r.top + 8], [r.left + 8, r.bottom - 8], [r.right - 8, r.bottom - 8]];
  const onTop = pts.filter(([x, y]) => { const e = document.elementFromPoint(x, y); return !!e && L.contains(e); }).length;
  return { found: true, shown: r.width > 40 && r.height > 10 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0,
    box: { x: r.left, y: r.top, w: r.width, h: r.height }, onTop, probes: pts.length, floor, ceil };
})()`;
/** Verdict on a LEGEND_SEEN reading: seen, and why not when it is not. */
function legendVerdict(d) {
  if (!d || !d.found) return { drawn: false, why: 'there is no #map-legend' };
  if (!d.shown) return { drawn: false, why: `the legend is not shown (${JSON.stringify(d.box)})` };
  if (d.box.y < d.ceil - 0.5 || d.box.y + d.box.h > d.floor + 0.5) return { drawn: false, why: `the legend's place ${d.box.y.toFixed(0)}..${(d.box.y + d.box.h).toFixed(0)} is outside the visible chart ${d.ceil.toFixed(0)}..${d.floor.toFixed(0)}` };
  if (d.onTop < d.probes) return { drawn: false, why: `something covers the legend: ${d.onTop} of ${d.probes} probe points are on it` };
  return { drawn: true, why: '' };
}
async function chartShare(page, snap) {
  const g = await page.eval(GEOMETRY);
  const reading = await page.eval(LEGEND_SEEN), drawn = legendVerdict(reading);
  const legend = drawn.drawn ? reading.box : null; // a legend that is not on screen is not subtracted (no phantom box)
  const rects = [...Object.values(g.blocks), ...g.extra, ...(legend ? [legend] : [])];
  const tl = g.blocks.timeline, sh = g.blocks.sheet;
  const area = g.vw * g.vh;
  const share = unobstructed(g.canvas, rects, area);
  const without = unobstructed(g.canvas, rects.filter((r) => r !== legend), area);
  // the same screen with the legend as the spec's wireframe draws it: one 36 px row across the chart, above the timeline (for comparison)
  const floor = Math.min(tl ? tl.y : g.vh, sh ? sh.y : g.vh);
  const specRow = { x: 16, y: floor - LEGEND_ROW - 8, w: g.vw - 32, h: LEGEND_ROW };
  const withSpecLegend = unobstructed(g.canvas, [...rects.filter((r) => r !== legend), specRow], area);
  return { share, without, withSpecLegend, g, legend, legendKind: 'DOM', legendDrawn: drawn.drawn, legendWhy: drawn.why, reading, tlH: tl?.h ?? 0 };
}
// One reported line and one verdict per snap: 'pass' | 'fail'. The legend has landed (W3-11), so the real number alone decides.
function judge(snap, c) {
  const want = TARGET[snap];
  if (!c.legendDrawn) return { v: 'fail', why: `the legend is not on screen (Josh point 13): ${c.legendWhy}` };
  if (c.share >= want) return { v: 'pass', why: '' };
  if (Math.abs(c.tlH - TL_SPEC[snap]) > 1) return { v: 'fail', why: `timeline is ${c.tlH.toFixed(1)} px, spec ${TL_SPEC[snap]} px` };
  return { v: 'fail', why: `below target ${Math.round(want * 100)}%` };
}

async function sweepTools(page, widths, mobile, h, check, note) {
  for (const w of widths) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile }); await sleep(400);
    for (const withReset of [false, true]) {
      await page.eval(`document.getElementById('btn-reset').hidden = ${!withReset}`); await sleep(150);
      const label = `map tools @${w}${withReset ? ' with Reset' : ''}`;
      const problems = toolsRowProblems(await page.eval(MEASURE), label);
      note(`${label}: ${problems.length ? problems.join('; ') : 'one row, 4 px to spare on every fit'}`);
      for (const bad of problems) check(false, bad);
    }
  }
  await page.eval(`document.getElementById('btn-reset').hidden = true`);
}

export async function run({ page, baseUrl, assert, newPage }) {
  const fails = [];
  const check = (cond, msg) => { if (!cond) fails.push(msg); return !!cond; };
  const note = (s) => console.log('  ' + s);
  const snapNow = () => page.eval(`document.getElementById('app').dataset.snap`);
  // Reach a snap point the way a person does: tap the sheet handle (peek -> half -> full -> peek) until it is there.
  const reach = async (want) => {
    for (let i = 0; i < 4 && (await snapNow()) !== want; i++) { await inp.tap(page, '#sheet-handle'); await sleep(550); }
    await sleep(300);
    check((await snapNow()) === want, `could not reach ${want} by tapping the handle, at ${await snapNow()}`);
  };

  // ================= the legend on a static first load, at peek (Josh point 13, spec 5.1) =================
  // No tap, no clock pause, no store change after boot: what a person sees when the page has loaded and they have not touched it.
  // The sheet settles to its content-driven peek a frame or more after the first draws, so a legend placed before that sits under
  // the timeline unless the layout redraws once it has settled. Three loads (the race was intermittent before the fix).
  for (const scheme of ['light', 'dark', 'light']) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.goto(baseUrl);
    await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 30000 });
    await sleep(1500);
    const d = await page.eval(LEGEND_SEEN), v = legendVerdict(d);
    note(`static first load (${scheme}) at ${await snapNow()}: legend ${d.box ? `${d.box.w.toFixed(0)}x${d.box.h.toFixed(0)}` : 'n/a'}, ${d.onTop}/${d.probes} probe points on it, at ${d.box ? `${d.box.y.toFixed(0)}..${(d.box.y + d.box.h).toFixed(0)}` : 'n/a'}, visible chart ${d.ceil.toFixed(0)}..${d.floor.toFixed(0)} -> ${v.drawn ? 'DRAWN' : 'NOT DRAWN: ' + v.why}`);
    check(v.drawn, `static first load (${scheme}): the legend is not drawn inside the visible chart at peek: ${v.why}`);
  }
  // The same race on demand: the focus card empties (the sheet drops to its handle) and refills (it rises to its peek). Each
  // change re-measures the peek and moves the timeline; once it has settled, the legend must be on screen.
  {
    await page.eval(`(() => { const c = document.getElementById('focus-card'); window.__card = [...c.childNodes]; c.replaceChildren(); })()`); await sleep(700);
    await page.eval(`(() => { document.getElementById('focus-card').replaceChildren(...window.__card); delete window.__card; })()`); await sleep(1200);
    const d = await page.eval(LEGEND_SEEN), v = legendVerdict(d);
    note(`peek re-measured (card emptied, then refilled): legend ${d.onTop}/${d.probes} probe points on it, at ${d.box ? `${d.box.y.toFixed(0)}..${(d.box.y + d.box.h).toFixed(0)}` : 'n/a'}, visible chart ${d.ceil.toFixed(0)}..${d.floor.toFixed(0)} -> ${v.drawn ? 'DRAWN' : 'NOT DRAWN: ' + v.why}`);
    check(v.drawn, `after a peek re-measure the legend is not drawn inside the visible chart: ${v.why}`);
  }

  // ================= phone, 390 x 844 =================
  await open(page, baseUrl, { w: 390, h: 844, mobile: true });

  // hooks
  const hooks = await page.eval(`${JSON.stringify(HOOKS)}.map((i) => [i, !!document.getElementById(i)])`);
  check(hooks.every(([, ok]) => ok), 'shell hooks missing: ' + hooks.filter(([, ok]) => !ok).map(([i]) => '#' + i).join(', '));
  check(await page.eval(`!document.getElementById('btn-theme') && !document.getElementById('run-label') && !document.getElementById('sample-badge')`), '#btn-theme, #run-label and #sample-badge must be gone');
  check(await page.eval(`!!document.querySelector('#map-tools .tools-end #btn-expand') && !!document.querySelector('#map-tools .tools-end #btn-reset')`), '#map-tools .tools-end must hold #btn-reset and #btn-expand');
  check(await page.eval(`document.getElementById('divider')?.getAttribute('role') === 'separator' && document.getElementById('divider').hidden`), '#divider must be a hidden role=separator');

  // header: one 44 px row, "More" on the phone
  const hdr = await page.eval(`(() => { const t = document.getElementById('topbar'); const r = t.getBoundingClientRect();
    const kids = [...t.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; });
    const tops = kids.map((e) => e.getBoundingClientRect()); const more = document.getElementById('btn-more'); const mb = more && more.getBoundingClientRect();
    return { h: r.height, top: r.top, minTop: Math.min(...tops.map((b) => b.top)), maxBottom: Math.max(...tops.map((b) => b.bottom)), more: more ? { text: more.textContent.trim(), w: mb.width, h: mb.height } : null,
      display: !!(document.getElementById('btn-display') && document.getElementById('btn-display').getBoundingClientRect().width > 0), share: !!(document.getElementById('btn-share') && document.getElementById('btn-share').getBoundingClientRect().width > 0) }; })()`);
  note(`phone header: height ${hdr.h}, content ${hdr.minTop}..${hdr.maxBottom}, More ${JSON.stringify(hdr.more)}, Display visible ${hdr.display}, Share visible ${hdr.share}`);
  check(Math.abs(hdr.h - 44) < 0.5, `phone header height ${hdr.h}, want 44`);
  check(hdr.minTop >= hdr.top - 0.5 && hdr.maxBottom <= hdr.top + 44.5, `header content leaves the 44 px row: ${hdr.minTop}..${hdr.maxBottom}`);
  check(hdr.more && hdr.more.text === 'More' && hdr.more.w >= 44 && hdr.more.h >= 44, 'the phone header must show a button labelled More, at least 44 x 44: ' + JSON.stringify(hdr.more));
  check(!hdr.display && !hdr.share, 'on the phone Share and Display live inside More');

  // chart share at peek and half, with bounding boxes
  await reach('peek'); await sleep(400);
  const pk = await chartShare(page, 'peek');
  const peekH = pk.g.blocks.sheet?.h ?? 0;
  const report = (label, c, snap = label) => { const j = judge(snap, c); note(`${label}: chart share ${(c.share * 100).toFixed(1)}% (target ${Math.round(TARGET[snap] * 100)}%)  without the legend ${(c.without * 100).toFixed(1)}%  with the spec 36 px legend row ${(c.withSpecLegend * 100).toFixed(1)}%  legend ${c.legendKind} ${c.legend ? c.legend.w.toFixed(0) + 'x' + c.legend.h.toFixed(0) : 'n/a'}${c.reading ? ` seen ${c.legendDrawn} (${c.reading.onTop}/${c.reading.probes} probe points)` : ''}  timeline ${c.tlH.toFixed(1)} px (spec ${TL_SPEC[snap]})  header ${c.g.blocks.header?.h}  -> ${j.v.toUpperCase()}${j.why ? ': ' + j.why : ''}`); return j; };
  // The same snap after a real pan: Reset appears after any pan or zoom, so the share is measured with it on screen too (one
  // finger drags the map, then Reset is tapped, as a person would). The tools must stay one 44 px row with Reset in it.
  const shareWithReset = async (snap, base) => {
    // the finger lands on open chart: below the tools row, a third of the way down to the timeline (the canvas centre is under the timeline at half)
    const tl = base.g.blocks.timeline, sh = base.g.blocks.sheet, floor = Math.min(tl ? tl.y : base.g.vh, sh ? sh.y : base.g.vh);
    const from = { x: base.g.vw / 2 - 35, y: 100 + (floor - 100) / 3 };
    await inp.drag(page, from, { by: { dx: 70, dy: 0 }, touch: true }); await sleep(500);
    const shown = await page.eval(`(() => { const b = document.getElementById('btn-reset'); return !!b && !b.hidden && b.getBoundingClientRect().width > 0; })()`);
    check(shown, `${snap}: a one-finger pan of the map did not show Reset`);
    const c = await chartShare(page, snap);
    const row = await page.eval(`[...document.querySelectorAll('#map-tools button')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => { const r = b.getBoundingClientRect(); return { id: b.id || b.dataset.view, t: r.top, b: r.bottom }; })`);
    const span = Math.max(...row.map((r) => r.b)) - Math.min(...row.map((r) => r.t));
    report(snap + ' with Reset', c, snap);
    note(`   ${snap} with Reset: tools ${row.map((r) => `${r.id} ${r.t.toFixed(0)}-${r.b.toFixed(0)}`).join(', ')}; the row spans ${span.toFixed(1)} px; share ${(c.share * 100).toFixed(1)}% vs ${(base.share * 100).toFixed(1)}% without Reset`);
    check(row.some((r) => r.id === 'btn-reset'), `${snap} with Reset: Reset is not among the map tools`);
    // Reset sits just under the row on a phone narrower than 420 px, so the row is the same with and without it
    for (const bad of toolsRowProblems(await page.eval(MEASURE), `${snap} with Reset`)) check(false, bad);
    check(judge(snap, c).v !== 'fail', `chart share at ${snap} with Reset shown ${(c.share * 100).toFixed(1)}% < ${Math.round(TARGET[snap] * 100)}%`);
    // With four views the short names are always on (no room for the long ones), so Reset adds its own 44 px box to the row (about 0.7% of the screen) and nothing else.
    check(c.share >= base.share - 0.0085, `${snap}: showing Reset covers more chart (${(c.share * 100).toFixed(2)}% vs ${(base.share * 100).toFixed(2)}%)`);
    if (shown) { await inp.tap(page, '#btn-reset'); await sleep(500); }
    check(await page.eval(`document.getElementById('btn-reset').hidden`), `${snap}: Reset did not hide after it was tapped`);
    check((await snapNow()) === snap, `${snap}: panning the map and tapping Reset moved the sheet to ${await snapNow()}`);
  };
  report('peek', pk);
  for (const [k, b] of Object.entries(pk.g.blocks)) note(`   ${k}: x ${b.x.toFixed(0)} y ${b.y.toFixed(0)} w ${b.w.toFixed(0)} h ${b.h.toFixed(0)}`);
  for (const b of pk.g.extra) note(`   ${b.sel}: x ${b.x.toFixed(0)} y ${b.y.toFixed(0)} w ${b.w.toFixed(0)} h ${b.h.toFixed(0)}`);
  check(Math.abs(pk.tlH - TL_SPEC.peek) <= 1, `peek: measured timeline ${pk.tlH.toFixed(1)} px, spec ${TL_SPEC.peek} px`);
  check(judge('peek', pk).v !== 'fail', `chart share at peek ${(pk.share * 100).toFixed(1)}% < 55% (measured boxes, no substitution)`);
  check(peekH <= 180.5, `peek sheet height ${peekH} > 180`);
  // Peek holds its content: the summary sentence is on screen (at least one line) and every visible part of the focus card lies
  // inside the sheet, none cut by its bottom edge. (Measured, not a fixed floor: a live card with a one-line sentence is shorter.)
  const pc = await page.eval(`(() => { const sh = document.getElementById('home').getBoundingClientRect(); const s = document.querySelector('#focus-card .summary');
    const kids = [...document.querySelectorAll('#focus-card > *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })
      .map((e) => { const r = e.getBoundingClientRect(); return { sel: e.className || e.tagName, t: r.top, b: r.bottom }; });
    const sr = s && s.getBoundingClientRect(); return { top: sh.top, bottom: sh.bottom, kids, summary: sr ? { t: sr.top, b: sr.bottom, h: sr.height, lh: parseFloat(getComputedStyle(s).lineHeight) } : null }; })()`);
  note(`peek content: sheet ${pc.top.toFixed(0)}..${pc.bottom.toFixed(0)}; ${pc.kids.map((k) => `${k.sel} ${k.t.toFixed(0)}..${k.b.toFixed(0)}`).join(', ')}`);
  check(pc.summary && pc.summary.h >= pc.summary.lh - 0.5, `peek sheet height ${peekH}: the summary sentence is not on screen at peek (${JSON.stringify(pc.summary)})`);
  for (const k of pc.kids) check(k.t >= pc.top - 0.5 && k.b <= pc.bottom + 0.5, `peek sheet height ${peekH} cuts the focus card's ${k.sel} (${k.t.toFixed(0)}..${k.b.toFixed(0)} in a sheet ${pc.top.toFixed(0)}..${pc.bottom.toFixed(0)})`);
  const content = await page.eval(`(() => { const hd = document.getElementById('sheet-handle'), c = document.getElementById('focus-card'); return hd.getBoundingClientRect().height + c.scrollHeight; })()`);
  check(peekH <= content + 40, `peek ${peekH} px is far taller than its content (${content} px): peek must be content-driven`);
  await shareWithReset('peek', pk);

  // Peek holds a sentence of up to three lines whole (spec 11.1): the focus card's sentence is replaced by a 110-character one that
  // wraps to three lines; all three are on screen, nothing is cut, the sheet is still at most 180 px and the chart still >= 55%.
  {
    const orig = await page.eval(`document.querySelector('#focus-card .summary')?.textContent ?? null`);
    check(orig !== null, 'peek: the focus card has no summary sentence');
    if (orig !== null) {
      await page.eval(`document.querySelector('#focus-card .summary').textContent = ${JSON.stringify(LONG_SENTENCE)}`); await sleep(700);
      const r = await page.eval(`(() => { const s = document.querySelector('#focus-card .summary'), cs = getComputedStyle(s), lh = parseFloat(cs.lineHeight);
        const probe = s.cloneNode(true); probe.style.cssText = 'display:block;-webkit-line-clamp:none;overflow:visible;position:absolute;visibility:hidden;width:' + s.clientWidth + 'px'; s.parentNode.append(probe);
        const natural = Math.round(probe.getBoundingClientRect().height / lh); probe.remove();
        const b = s.getBoundingClientRect(), sh = document.getElementById('home').getBoundingClientRect();
        return { fs: parseFloat(cs.fontSize), lh, natural, shown: Math.round(b.height / lh), clipped: s.scrollHeight > s.clientHeight + 1, bottom: b.bottom, sheetBottom: sh.bottom, sheetH: sh.height }; })()`);
      const c3 = await chartShare(page, 'peek');
      note(`peek with a three-line sentence (set at ${r.fs}/${r.lh} px): ${r.natural} lines wrapped, ${r.shown} shown, clipped ${r.clipped}, sheet ${r.sheetH.toFixed(0)} px, chart share ${(c3.share * 100).toFixed(1)}%`);
      check(r.natural === PEEK_LINES, `peek probe: the 110-character sentence should wrap to ${PEEK_LINES} lines at 390 px, wrapped to ${r.natural}`);
      check(r.shown === Math.min(PEEK_LINES, r.natural) && !r.clipped, `peek cuts a ${r.natural}-line sentence to ${r.shown} line(s) (clipped ${r.clipped}); spec 11.1 allows ${PEEK_LINES}`);
      check(r.bottom <= r.sheetBottom + 0.5, `peek: the three-line sentence runs past the sheet (${r.bottom.toFixed(0)} > ${r.sheetBottom.toFixed(0)})`);
      check(r.sheetH <= PEEK_MAX + 0.5, `peek with a three-line sentence is ${r.sheetH.toFixed(0)} px, over ${PEEK_MAX}`);
      check(judge('peek', c3).v === 'pass', `chart share at peek with a three-line sentence ${(c3.share * 100).toFixed(1)}% < 55%`);
      // The spec's fourth peek item, the 40 px strip, belongs to the focus card (ui/home.js, W3-06), which draws none yet. Reported,
      // never counted as conformant: the sheet this would need and whether it fits the 180 px cap are printed every run.
      const strip = await page.eval(`!!document.querySelector('#focus-card svg, #focus-card .strip-wrap')`);
      const withStrip = r.sheetH + STRIP_H + 4;
      if (!strip) note(`DEVIATION (spec 11.1 peek contents, Josh-visible): the focus card has no 40 px strip (ui/home.js, W3-06). With it and a three-line sentence at ${r.fs}/${r.lh} px the peek would be ${withStrip.toFixed(0)} px${withStrip > PEEK_MAX ? `, over the ${PEEK_MAX} px cap: the cap or the sentence's three lines must give` : ''}`);
      else check(r.sheetH <= PEEK_MAX + 0.5, `peek with the strip and a three-line sentence is ${r.sheetH.toFixed(0)} px, over ${PEEK_MAX}`);
      await page.eval(`document.querySelector('#focus-card .summary').textContent = ${JSON.stringify(orig)}`); await sleep(700);
    }
  }

  await reach('half'); await sleep(400);
  const hf = await chartShare(page, 'half');
  const half = hf.g.blocks.sheet;
  report('half', hf); note(`half sheet top ${half?.y.toFixed(1)} (${(HALF_TOP_DEFAULT.top * 100).toFixed(0)}% = ${(HALF_TOP_DEFAULT.top * 844).toFixed(1)})`);
  check(Math.abs(hf.tlH - TL_SPEC.half) <= 1, `half: measured timeline ${hf.tlH.toFixed(1)} px, spec ${TL_SPEC.half} px`);
  check(judge('half', hf).v !== 'fail', `chart share at half ${(hf.share * 100).toFixed(1)}% < 35% (measured boxes, no substitution)`);
  check(half && Math.abs(half.y - HALF_TOP_DEFAULT.top * 844) <= 1.5, `half sheet top ${half && half.y.toFixed(1)}, want ${(HALF_TOP_DEFAULT.top * 100).toFixed(0)}% = ${(HALF_TOP_DEFAULT.top * 844).toFixed(1)}`);
  // the trade-off, measured: the same half with the sheet top where spec 11.1 puts it (54%)
  if (HALF_TOP_DEFAULT.top !== HALF_TOP_DEFAULT.spec) {
    const was = await page.eval(`document.getElementById('app').style.getPropertyValue('--sheet-h')`);
    await page.eval(`document.getElementById('app').style.setProperty('--sheet-h', '${Math.round(844 * (1 - HALF_TOP_DEFAULT.spec))}px')`); await sleep(700);
    const at = await chartShare(page, 'half');
    await page.eval(`document.getElementById('app').style.setProperty('--sheet-h', ${JSON.stringify(was)})`); await sleep(700);
    note(`DEVIATION (spec 11.1, Josh-visible): half sheet top ${(HALF_TOP_DEFAULT.top * 100).toFixed(0)}% (spec ${(HALF_TOP_DEFAULT.spec * 100).toFixed(0)}%), sheet ${half ? half.h.toFixed(0) : '?'} px; at ${(HALF_TOP_DEFAULT.spec * 100).toFixed(0)}% the sheet would be ${Math.round(844 * (1 - HALF_TOP_DEFAULT.spec))} px and the chart ${(at.share * 100).toFixed(1)}% (${(at.without * 100).toFixed(1)}% with no legend at all), under 35%. ${HALF_TOP_DEFAULT.ref}`);
  }
  await shareWithReset('half', hf);

  // dragging: the handle, a body at the top, never a scrolled body (real touch)
  await reach('half');
  await page.eval(`document.getElementById('home-body').scrollTop = 0`);
  const snap = snapNow;
  await inp.drag(page, '#home-body', { by: { dx: 0, dy: 160 }, touch: true, steps: 10, ms: 260 }); await sleep(700);
  check((await snap()) === 'peek', `dragging down from a body scrolled to the top should collapse the sheet to peek, got ${await snap()}`);
  await reach('half');
  await page.eval(`(() => { const b = document.getElementById('home-body'); b.scrollTop = 120; })()`); await sleep(100);
  const st0 = await page.eval(`document.getElementById('home-body').scrollTop`);
  await inp.drag(page, '#home-body', { by: { dx: 0, dy: 160 }, touch: true, steps: 10, ms: 260 }); await sleep(700);
  check((await snap()) === 'half', `dragging a body that is scrolled down (scrollTop ${st0}) must not move the sheet, got ${await snap()}`);
  await inp.drag(page, '#sheet-handle', { by: { dx: 0, dy: 200 }, touch: true, steps: 10, ms: 260 }); await sleep(700);
  check((await snap()) === 'peek', `dragging the handle down from half should reach peek, got ${await snap()}`);

  // a horizontal swipe on the body at the top never moves the sheet, not even mid-gesture (spec 14.3, axis lock): a real touch
  // swipe of dx -160, dy +10, sampling the sheet's top edge after every move
  await reach('half');
  await page.eval(`document.getElementById('home-body').scrollTop = 0`);
  const sheetTop = () => page.eval(`document.getElementById('home').getBoundingClientRect().top`);
  const top0 = await sheetTop();
  const sp = await page.eval(`(() => { const b = document.getElementById('home-body').getBoundingClientRect(); return { x: b.left + b.width * 0.7, y: b.top + 60 }; })()`);
  const tp = (x, y) => [{ x, y, id: 0, radiusX: 1, radiusY: 1, force: 1 }];
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(sp.x, sp.y) });
  let maxMove = 0;
  for (let i = 1; i <= 10; i++) {
    await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(sp.x - 16 * i, sp.y + i) });
    await sleep(25);
    maxMove = Math.max(maxMove, Math.abs((await sheetTop()) - top0));
  }
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(600);
  note(`horizontal swipe (dx -160, dy +10) at half: sheet top ${top0.toFixed(1)}, largest move mid-gesture ${maxMove.toFixed(1)} px, after ${(await sheetTop()).toFixed(1)}, snap ${await snap()}`);
  check(maxMove <= 1, `a horizontal swipe moved the sheet by ${maxMove.toFixed(1)} px mid-gesture (axis lock: it must not move at all)`);
  check((await snap()) === 'half' && Math.abs((await sheetTop()) - top0) <= 1, `a horizontal swipe changed the sheet: snap ${await snap()}, top ${await sheetTop()} (was ${top0})`);
  await reach('peek');

  // the data chip in every state, at 390 px and at 320 px
  const states = {
    'live fresh': (m, now) => ({ ...m, sample: false, cases: undefined, run: iso(now - 9 * 3600e3) }),
    'live stale': (m, now) => ({ ...m, sample: false, cases: undefined, run: iso(now - 30 * 3600e3) }),
    'live very stale': (m, now) => ({ ...m, sample: false, cases: undefined, run: iso(now - 60 * 3600e3) }),
    'recorded': (m, now) => ({ ...m, sample: true, cases: undefined, sample_label: 'Recorded run shape, a deliberately long label that must truncate from the middle', run: iso(now - 40 * 3600e3) }),
    'multi-case': (m) => m,
  };
  await page.eval(`window.__iso = (ms) => { const d = new Date(ms); return d.toISOString().slice(0, 16) + 'Z'; }`);
  const baseM = await page.eval(`JSON.parse(JSON.stringify(__wse.data.getManifest()))`);
  const NOW = Date.UTC(2026, 10, 18, 22, 0);
  function iso(ms) { return new Date(ms).toISOString().slice(0, 16) + 'Z'; }
  for (const CW of [390, 320]) {
  await page.send('Emulation.setDeviceMetricsOverride', { width: CW, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(400);
  for (const [name0, mk] of Object.entries(states)) {
    const name = `${name0} @${CW}`;
    const m = mk(baseM, NOW);
    // the multi-case state is also run without a start date: the chip and popover must not invent one
    if (name0 === 'multi-case' && CW === 390) { const nm = JSON.parse(JSON.stringify(m)); for (const k of Object.keys(nm.cases || {})) nm.cases[k].fields = []; await page.eval(`(() => { const hd = __wse.ui.header; hd.setManifest(${JSON.stringify(nm)}); })()`); await sleep(250); const t = await page.eval(`(() => { document.getElementById('data-chip').click(); const r = { chip: document.querySelector('#data-chip .chip-text').textContent, pop: document.getElementById('data-popover').innerText }; document.getElementById('data-chip').click(); return r; })()`); note(`no start date: chip "${t.chip}", popover "${t.pop.replace(/\n/g, ' | ')}"`); check(!/past data/i.test(t.chip + t.pop) && !/starts\s*\./i.test(t.pop) && !/It starts/.test(t.pop), `chip or popover invents a start date: "${t.chip}" / "${t.pop}"`); await sleep(100); }
    await page.eval(`(() => { const hd = __wse.ui.header; if (hd.setNow) hd.setNow(() => ${NOW}); hd.setManifest(${JSON.stringify(m)}); })()`); await sleep(250);
    const c = await page.eval(`(() => { const chip = document.getElementById('data-chip'); if (!chip) return null; const t = chip.querySelector('.chip-text') || chip; const cs = getComputedStyle(t);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2; const r = t.getBoundingClientRect(); const cr = chip.getBoundingClientRect();
      return { text: t.textContent, full: chip.dataset.full || '', tail: chip.dataset.tail || '', ws: cs.whiteSpace, h: r.height, lh, sw: t.scrollWidth, cw: t.clientWidth, chipW: cr.width, chipH: cr.height, right: cr.right, vw: innerWidth }; })()`);
    if (!c) { check(false, `chip [${name}]: there is no #data-chip`); continue; }
    note(`chip [${name}]: "${c.text}" (full "${c.full}") ws=${c.ws} h=${c.h.toFixed(1)}/${c.lh} scroll ${c.sw}/${c.cw} chip ${c.chipW.toFixed(0)}x${c.chipH.toFixed(0)}`);
    check(c.ws === 'nowrap', `chip [${name}] white-space ${c.ws}, want nowrap`);
    check(c.h <= c.lh + 1, `chip [${name}] is ${c.h.toFixed(1)} px tall: more than one line (line box ${c.lh})`);
    check(c.sw <= c.cw + 1, `chip [${name}] text overflows: scrollWidth ${c.sw} > clientWidth ${c.cw}`);
    check(c.text.length > 3 && c.chipH <= 44.5, `chip [${name}] empty or taller than the header: "${c.text}" ${c.chipH}`);
    check(!/(\d|\b)\s?Z\b/.test(c.text) && !/(\d|\b)\s?Z\b/.test(c.full), `chip [${name}] shows a Z time suffix: "${c.text}" / "${c.full}"`);
    check(c.right <= c.vw + 0.5, `chip [${name}] leaves the screen`);
    // the tail stays whole and every visible piece is a whole word: nothing is cut mid-word, no ellipsis, no dropped age or warning
    check(!/…|\.\.\./.test(c.text), `chip [${name}] is cut with an ellipsis: "${c.text}"`);
    check(c.tail.length > 0 && c.text.endsWith(c.tail), `chip [${name}] lost its tail "${c.tail}": "${c.text}"`);
    const fw = new Set(c.full.split(/[\s·]+/).filter(Boolean));
    const frag = c.text.split(/[\s·]+/).filter(Boolean).filter((w) => !fw.has(w));
    check(frag.length === 0, `chip [${name}] shows fragments that are not whole words of "${c.full}": ${frag.join(', ')} in "${c.text}"`);
    if (name0 === 'live stale') check(/stale$/.test(c.text), `chip [${name}] must end with the stale warning: "${c.text}"`);
    if (name0 === 'live very stale') check(/very stale$/.test(c.text), `chip [${name}] must end with "very stale": "${c.text}"`);
  }
  // map tools and brand at this width: every #map-tools control sits inside the stage, and a brand stays visible in the header
  for (const withReset of [false, true]) {
    await page.eval(`document.getElementById('btn-reset').hidden = ${!withReset}`); await sleep(100);
    const g = await page.eval(`(() => { const st = document.getElementById('stage').getBoundingClientRect();
      const ctl = [...document.querySelectorAll('#map-tools button')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => { const r = b.getBoundingClientRect(); return { id: b.id || b.dataset.view, l: r.left, r: r.right, t: r.top, b: r.bottom, name: b.getAttribute('aria-label') || b.textContent.trim() }; });
      const vis = (el) => { if (!el) return false; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width >= 8 && r.height >= 8; };
      return { sl: st.left, sr: st.right, ctl, mark: vis(document.querySelector('#topbar .brand-mark')), name: vis(document.querySelector('#topbar .brand-name')) }; })()`);
    note(`map tools @${CW}${withReset ? ' with Reset shown' : ''}: ${g.ctl.map((c) => `${c.id} ${c.l.toFixed(0)}-${c.r.toFixed(0)}`).join(', ')} stage ${g.sl}-${g.sr}; brand mark ${g.mark} name ${g.name}`);
    check(g.ctl.length >= 4, `map tools @${CW}: only ${g.ctl.length} controls found`);
    for (const c of g.ctl) check(c.l >= g.sl - 0.5 && c.r <= g.sr + 0.5, `map tool ${c.id} @${CW} is outside the stage: ${c.l.toFixed(1)}-${c.r.toFixed(1)} on ${g.sl}-${g.sr}`);
    // under 420 px Reset has its own line right under the row (shell.css): it is checked to sit below, inside the stage
    const under = withReset && CW < 420 ? g.ctl.find((c) => c.id === 'btn-reset') : null;
    if (under) {
      const rowBottom = Math.max(...g.ctl.filter((c) => c !== under).map((c) => c.b));
      check(under.t >= rowBottom - 0.5 && under.t - rowBottom <= 8.5, `Reset @${CW} should sit just under the tools row: top ${under.t.toFixed(1)}, row bottom ${rowBottom.toFixed(1)}`);
      g.ctl = g.ctl.filter((c) => c !== under);
    }
    const span = Math.max(...g.ctl.map((c) => c.b)) - Math.min(...g.ctl.map((c) => c.t));
    for (const c of g.ctl) check(c.r - c.l >= 43.5 && c.b - c.t >= 43.5, `map tool ${c.id} @${CW}${withReset ? ' with Reset shown' : ''} is ${(c.r - c.l).toFixed(1)} x ${(c.b - c.t).toFixed(1)} px, under the 44 x 44 touch target`);
    check(span <= 44.5, `map tools @${CW}${withReset ? ' with Reset shown' : ''} wrap: the row spans ${span.toFixed(1)} px, want one 44 px row`);
    for (let i = 1; i < g.ctl.length; i++) check(g.ctl[i].l >= g.ctl[i - 1].r - 0.5, `map tools @${CW}: ${g.ctl[i - 1].id} and ${g.ctl[i].id} overlap`);
    const names = Object.fromEntries(g.ctl.map((c) => [c.id, c.name]));
    check(names.np === 'Regional' && names.nh === 'Hemisphere' && names.gl === 'Globe' && names.wm === 'World', `map tools @${CW}: the view buttons lost their full names: ${JSON.stringify(names)}`);
    check(g.mark || g.name, `header @${CW} shows no brand: mark visible ${g.mark}, name visible ${g.name}`);
  }
  await page.eval(`document.getElementById('btn-reset').hidden = true`);
  }
  // the map tools at every phone width that matters, Reset shown and hidden, with 4 px to spare on every fit (W4-10)
  await sweepTools(page, PHONE_WIDTHS, true, 844, check, note);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(300);
  await page.eval(`(() => { const hd = __wse.ui.header; if (hd.setNow) hd.setNow(null); hd.setManifest(${JSON.stringify(baseM)}); })()`);

  // every control in the header and map tools has visible text (More menu opened by a real tap)
  await inp.tap(page, '#btn-more'); await sleep(500);
  const menuOpen = await page.eval(`(() => { const m = document.getElementById('display-menu'); return !!m && !m.hidden && m.getBoundingClientRect().width > 0; })()`);
  check(menuOpen, 'tapping More must open the menu (#display-menu)');
  const textless = await page.eval(`(() => { const scope = '#topbar, #map-tools, #display-menu'; const bad = [];
    for (const el of document.querySelectorAll('#topbar button, #map-tools button, #display-menu button, #display-menu [role=menuitemradio], #display-menu [role=menuitem]')) {
      const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === 'hidden') continue;
      if (${JSON.stringify(ICON_EXCEPTIONS)}.some((s) => el.matches(s))) continue;
      if (!el.innerText.trim()) bad.push((el.id || el.className || el.tagName) + ' aria-label=' + el.getAttribute('aria-label')); }
    return bad; })()`);
  check(textless.length === 0, 'controls without visible text: ' + textless.join('; '));
  const items = await page.eval(`[...document.querySelectorAll('#display-menu [data-group]')].map((g) => g.dataset.group + ':' + g.querySelector('.menu-label').textContent.trim())`);
  note('menu groups on the phone: ' + items.join(', '));
  check(['theme', 'chart', 'units', 'time'].every((g) => items.some((i) => i.startsWith(g + ':'))), 'the menu needs Theme, Chart, Units and Time groups: ' + items.join(', '));
  check(await page.eval(`!!document.querySelector('#display-menu [data-share]') && /Share/.test(document.querySelector('#display-menu [data-share]').textContent)`), 'the phone menu must carry a text Share item');
  const labels = await page.eval(`['theme','chart','units','time'].map((g) => document.querySelector('#display-menu [data-group="' + g + '"] .menu-label')?.textContent.trim())`);
  check(JSON.stringify(labels) === JSON.stringify(['Theme', 'Chart', 'Units', 'Time']), 'menu labels ' + JSON.stringify(labels));
  // every menu item is at least 44 px tall on the phone
  const small = await page.eval(`[...document.querySelectorAll('#display-menu button')].filter((b) => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim() + ' ' + b.getBoundingClientRect().height)`);
  check(small.length === 0, 'menu buttons under 44 px: ' + small.join('; '));
  await inp.key(page, null, 'Escape'); await sleep(300);
  check(await page.eval(`document.getElementById('display-menu').hidden`), 'Escape closes the menu');

  // no monospace outside #debug
  const mono = await page.eval(`[...document.querySelectorAll('#topbar *, #map-tools *, #home *, #display-menu *, #timeline *')].filter((e) => !e.closest('#debug') && e.getClientRects().length && /mono|menlo|consolas|courier/i.test(getComputedStyle(e).fontFamily) && e.textContent.trim()).map((e) => (e.id || e.className || e.tagName) + ': ' + getComputedStyle(e).fontFamily.slice(0, 40)).slice(0, 8)`);
  check(mono.length === 0, 'monospace outside #debug: ' + mono.join(' | '));

  // ================= Display menu: Auto follows the system, choices persist (desktop) =================
  // the desktop widths where the stage is narrow (900 to 1100 px) and the usual 1440: the same row, Reset shown and hidden
  await sweepTools(page, DESKTOP_WIDTHS, false, 800, check, note);
  await open(page, baseUrl, { w: 1440, h: 900, mobile: false, scheme: 'light' });
  const themeNow = () => page.eval(`document.documentElement.dataset.theme`);
  check((await themeNow()) === 'light', `Auto with a light system must be light, got ${await themeNow()}`);
  const hd2 = await page.eval(`(() => { const t = document.getElementById('topbar').getBoundingClientRect(); const b = (id) => { const e = document.getElementById(id); const r = e && e.getBoundingClientRect(); return r && r.width > 0 ? { text: e.textContent.trim(), h: r.height } : null; };
    return { h: t.height, display: b('btn-display'), share: b('btn-share'), more: b('btn-more'), chip: b('data-chip') }; })()`);
  note('desktop header: ' + JSON.stringify(hd2));
  check(Math.abs(hd2.h - 44) < 0.5, `desktop header height ${hd2.h}`);
  check(hd2.display && /^Display/.test(hd2.display.text) && hd2.share && hd2.share.text === 'Share' && !hd2.more, 'desktop header: Display and Share buttons with text, no More: ' + JSON.stringify(hd2));
  await inp.click(page, '#btn-display'); await sleep(400);
  check(await page.eval(`document.getElementById('btn-display').getAttribute('aria-expanded') === 'true'`), 'Display sets aria-expanded');
  const menuText = (await page.eval(`document.getElementById('display-menu').innerText`)).toLowerCase();
  for (const w of ['Theme', 'Chart', 'Units', 'Time', 'Auto', 'Light', 'Dark', 'Paper', 'Night', 'Metric']) check(menuText.includes(w.toLowerCase()), `Display menu lacks "${w}": ${menuText.replace(/\n/g, ' | ')}`);
  check(!(await page.eval(`!!document.querySelector('#display-menu [data-share]') && document.querySelector('#display-menu [data-share]').getClientRects().length > 0`)), 'the desktop menu does not repeat Share');
  await inp.click(page, '#display-menu [data-group="theme"] button[data-value="dark"]'); await sleep(300);
  check((await themeNow()) === 'dark', `Theme Dark must win over a light system, got ${await themeNow()}`);
  await inp.click(page, '#display-menu [data-group="chart"] button[data-value="night"]'); await sleep(200);
  await inp.click(page, '#display-menu [data-group="units"] button[data-value="us"]'); await sleep(200);
  const st = await page.eval(`(() => { const s = __wse.store.get(); return { themePref: s.themePref, ground: s.ground, units: s.units, theme: s.theme }; })()`);
  check(st.themePref === 'dark' && st.ground === 'night' && st.units === 'us', 'store keys themePref/ground/units not set: ' + JSON.stringify(st));
  check(await page.eval(`document.querySelector('#display-menu [data-group="theme"] button[data-value="dark"]').getAttribute('aria-checked') === 'true'`), 'the chosen theme item is aria-checked');
  // a reload keeps the choices
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 30000 }); await sleep(400);
  const st2 = await page.eval(`(() => { const s = __wse.store.get(); return { themePref: s.themePref, ground: s.ground, units: s.units, attr: document.documentElement.dataset.theme }; })()`);
  check(st2.themePref === 'dark' && st2.ground === 'night' && st2.units === 'us' && st2.attr === 'dark', 'Display choices did not survive a reload: ' + JSON.stringify(st2));
  // Auto again follows the system live
  await inp.click(page, '#btn-display'); await sleep(300);
  await inp.click(page, '#display-menu [data-group="theme"] button[data-value="auto"]'); await sleep(300);
  check((await themeNow()) === 'light', `Auto must follow the light system, got ${await themeNow()}`);
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }); await sleep(400);
  check((await themeNow()) === 'dark', `Auto must follow a system change to dark, got ${await themeNow()}`);
  await inp.key(page, null, 'Escape'); await sleep(200);

  // a theme saved by the MVP (legacy key 'theme') is honoured on boot: light beats a dark system until the Display menu is used
  await page.eval(`localStorage.setItem('wse.v1.prefs', JSON.stringify({ theme: 'light' }))`);
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 30000 }); await sleep(400);
  const lg = await page.eval(`({ attr: document.documentElement.dataset.theme, pref: __wse.store.get().themePref, sys: matchMedia('(prefers-color-scheme: light)').matches })`);
  note('legacy {theme:light} with a dark system: ' + JSON.stringify(lg));
  check(!lg.sys && lg.attr === 'light' && lg.pref === 'light', 'a saved legacy theme must survive: ' + JSON.stringify(lg));

  // stage: light hairline and shadow, dark rounded inset
  const stage = (th) => page.eval(`(() => { document.documentElement.dataset.theme = ${JSON.stringify(th)}; const e = document.getElementById('stage'); const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
    return { border: cs.borderTopWidth + ' ' + cs.borderTopStyle, borderColor: cs.borderTopColor, shadow: cs.boxShadow, radius: cs.borderTopLeftRadius, left: r.left, top: r.top, right: innerWidth - r.right }; })()`);
  const sl = await stage('light'), sd = await stage('dark');
  note('stage light: ' + JSON.stringify(sl)); note('stage dark: ' + JSON.stringify(sd));
  check(sl.border === '1px solid' && sl.shadow !== 'none' && parseFloat(sl.radius) >= 14, 'light stage needs a 1 px hairline, a shadow and a 14 px radius: ' + JSON.stringify(sl));
  check(parseFloat(sd.radius) >= 14 && sd.left > 0 && sd.right > 0, 'dark stage needs the rounded inset: ' + JSON.stringify(sd));

  for (const f of fails) console.log('  FAIL: ' + f);
  assert.ok(fails.length === 0, `${fails.length} S-SHELL failure(s):\n - ` + fails.join('\n - '));
  assert.deepEqual(page.errors(), [], JSON.stringify(page.errors()));
}
