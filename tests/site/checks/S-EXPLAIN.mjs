// S-EXPLAIN (W4-02, Josh points 13 and 8): the chart explains itself at one tap and at a tap on the map. Real clicks and taps only.
//   - "What is this?" opens a guide whose first paragraph begins "Yes, this is the pressure pattern"; the diagram is there; "For you"
//     is string-equal to the focus card's day line, at two times; "How sure is this?" opens the panel with the spread chart and the
//     "one contour's worth of doubt" line; the GRIB sentence appears only for a manifest whose checks.grib_compare passed.
//   - The readout: tap the ridge probe (synthetic-15d, +11 dam at 56N 80W) and it says "ridge" with a signed value; tap the no-signal
//     probe (300 h, 30N 56W) and it says "No clear signal yet"; Enter at the map's centre reads it from the keyboard; "Add a place
//     here" opens the Add sheet; Escape closes and returns focus to the map; the card stays inside the stage and clear of the legend.
//   - Annotations: at most three ridges and three troughs (two on a phone), 120 px apart, none where the signal is none (a state with a
//     12 dam no-signal candidate that would otherwise be drawn), settled on the picked places, never touching #map-legend or #map-tools across a time sweep.
//   - The coach: one hint at a time, in order, never over the legend, the timeline or the map tools, dismissed by the first
//     interaction with its control, not shown again after a reload.
//   - how.html: a complete document that renders every listed lens's guide from the descriptors, relative paths only.
// Known positives: M-explain-1 (For you from another function) and M-explain-2 (labels at extrema in no-signal areas) must fail here.
import * as inp from '../lib/input.mjs';

export const id = 'S-EXPLAIN';
export const freshProfile = true;
export const timeoutMs = 240000;
export const data = ['synthetic-15d', 'recorded'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// DESIGN-SPEC 5.2 item 3, verbatim: the Pattern guide's "Read it" text put to the meteorology copy review (14.5). A change here is a
// change to reviewed copy and goes back to the reviewer.
const READ_IT = 'Orange and red: a ridge. It is usually drier under a ridge; in winter, valleys can stay cold and foggy under one. Blue: a trough. Weather tends to be wettest just ahead of a trough as it approaches; behind it, colder and clearing. The black lines are the height itself, in tens of metres. The wind aloft, and the jet stream, flows along them, fastest where they crowd together, and storms travel with that flow.';
const SLACK = 4; // px: layout checks leave at least this much room for wider Linux font metrics

async function boot(page, baseUrl, w, h, { keepPrefs = true } = {}) {
  await page.setViewport(w, h, 1);
  await page.goto(baseUrl);
  if (!keepPrefs) { await page.eval(`localStorage.clear()`); await page.goto(baseUrl); }
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true && !!document.querySelector("#map-legend .mlg-what")', { timeout: 30000 });
  await sleep(400);
}
const box = (page, sel) => page.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; })()`);
const touches = (a, b, m = SLACK) => a && b && a.x < b.x + b.w + m && a.x + a.w > b.x - m && a.y < b.y + b.h + m && a.y + a.h > b.y - m;
const text = (page, sel) => page.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
/** Screen point of a place on the map (page px), or null when it is off the canvas or on the far side. */
const screenOf = (page, lon, lat) => page.eval(`(() => { const r = document.getElementById('map').getBoundingClientRect(), p = __wse.renderer.project([${lon}, ${lat}]); if (!p) return null; const x = r.left + p[0], y = r.top + p[1]; return x > r.left + 30 && x < r.right - 30 && y > r.top + 90 && y < r.bottom - 30 ? { x, y } : null; })()`);
/** Make a place visible by choosing the first view (Regional, Hemisphere, Global) that shows it, with real taps on the view switch. */
async function showPlace(page, lon, lat) {
  for (const v of ['np', 'nh', 'gl']) {
    await inp.click(page, `#view-switch [data-view="${v}"]`); await sleep(500);
    const p = await screenOf(page, lon, lat);
    if (p) return p;
  }
  throw new Error(`no view shows ${lon}, ${lat}`);
}
const openGuide = async (page) => { await inp.click(page, '#map-legend .mlg-what'); await page.waitFor('!!document.querySelector(".wse-sheet-root .gd")', { timeout: 8000 }); await sleep(400); };
/** page.waitFor with the step named in the failure, so a timeout says which wait it was. */
async function waitStep(page, tag, step, cond, timeout = 5000) {
  try { await page.waitFor(cond, { timeout }); } catch (e) { throw new Error(tag(`${step}: ${e.message}`)); }
}
const closeSheet = async (page, tag = (m) => m, step = 'the sheet closes on Escape') => { await inp.key(page, null, 'Escape'); await waitStep(page, tag, step, '!document.querySelector(".wse-sheet-root")'); await sleep(250); };
const setT = (page, t) => page.eval(`__wse.store.set({ t: ${t}, playing: false })`); // set-up only: the behaviour under test is what a tap then reads

async function guideChecks(page, assert, fixture, tag) {
  await openGuide(page);
  const first = await page.eval(`document.querySelector('.wse-sheet-root .gd .gd-p')?.textContent || ''`);
  assert.ok(first.startsWith('Yes, this is the pressure pattern'), tag(`the first paragraph answers the question: "${first.slice(0, 80)}"`));
  const parts = await page.eval(`({ svg: !!document.querySelector('.wse-sheet-root .gd-svg'), svgText: [...document.querySelectorAll('.wse-sheet-root .gd-svg text')].map((t) => t.textContent), cap: document.querySelector('.wse-sheet-root figcaption')?.textContent || '', heads: [...document.querySelectorAll('.wse-sheet-root .gd-h')].map((h) => h.textContent), title: document.querySelector('.wse-sheet-title')?.textContent })`);
  assert.ok(parts.svg && parts.svgText.includes('RIDGE') && parts.svgText.includes('TROUGH') && parts.svgText.includes('jet stream'), tag('the diagram names ridge, trough and the jet stream: ' + parts.svgText));
  assert.equal(parts.cap, 'Warm air below lifts the surface; cold air lowers it.', tag('the diagram caption'));
  for (const h of ['Read it', 'How sure is this?', 'Worth knowing', 'About this data']) assert.ok(parts.heads.some((x) => x === h), tag(`section "${h}" present: ${parts.heads}`));
  assert.equal(parts.title, 'What am I looking at?', tag('sheet title'));
  // About this data's Style and Constructions rows follow Map colors (N24 LOOK): Soft never claims ECMWF colours. The family is
  // switched by store.set (set-up only) and the guide reopened by a real click, then put back as it was.
  const aboutRow = (k) => page.eval(`(() => { const d = [...document.querySelectorAll('.wse-sheet-root .gd-dl dt')].find((e) => e.textContent === ${JSON.stringify(k)}); return d?.nextElementSibling?.textContent || ''; })()`);
  const fam0 = await page.eval(`__wse.store.get().colors`);
  for (const fam of [fam0, fam0 === 'reference' ? 'soft' : 'reference']) {
    if (fam !== fam0) { await closeSheet(page, tag, 'the guide closes before the family switch'); await page.eval(`__wse.store.set({ colors: ${JSON.stringify(fam)} })`); await openGuide(page); }
    const style = await aboutRow('Style'), cons = await aboutRow('Constructions');
    if (fam === 'reference') {
      assert.ok(style.startsWith('ECMWF colours') && /past ±40 dam/.test(cons), tag(`Reference: About this data says ECMWF colours: "${style}" / "${cons}"`));
    } else {
      assert.ok(style.startsWith('Soft colours, softened from ECMWF') && !/^ECMWF colours/.test(style) && /Every map colour, on Paper and on Night, is our own construction/.test(cons), tag(`Soft: About this data says the colours are our softened construction: "${style}" / "${cons}"`));
    }
  }
  if ((await page.eval(`__wse.store.get().colors`)) !== fam0) { await closeSheet(page, tag, 'the guide closes before the family is put back'); await page.eval(`__wse.store.set({ colors: ${JSON.stringify(fam0)} })`); await openGuide(page); }
  // the read-it text is the descriptor's, verbatim
  const read = await page.eval(`import('/js/lenses/index.js').then((m) => m.lens('z').guide.read)`);
  const readShown = await page.eval(`[...document.querySelectorAll('.wse-sheet-root .gd-sec')].find((s) => s.querySelector('.gd-h')?.textContent === 'Read it')?.querySelector('p')?.textContent`);
  assert.equal(readShown, read, tag('"Read it" is the lens descriptor text, unchanged'));
  assert.equal(readShown, READ_IT, tag('"Read it" is the DESIGN-SPEC 5.2 item 3 text for the copy review, with the winter-valley caveat (MET-13) and the jet stream'));
  // For you: string-equal to the card's own day line
  const card = await text(page, '#focus-card .dayline');
  const foryou = await text(page, '.wse-sheet-root .gd-foryou');
  assert.ok(card.length > 10, tag('the focus card has a day line: "' + card + '"'));
  assert.equal(foryou, card, tag(`"For you" equals the card's day line`));
  const fyHead = await page.eval(`[...document.querySelectorAll('.wse-sheet-root .gd-h')].map((h) => h.textContent)`);
  assert.ok(fyHead.includes('For you'), tag('the heading is plain "For you" (the day line names the place): ' + fyHead));
  const goText = await text(page, '.wse-sheet-root [data-guide-go="sure"]');
  assert.ok(goText && !fyHead.includes(goText.replace(/\s*▸$/, '')), tag(`the link to the panel does not repeat the section heading: "${goText}" under ${fyHead}`));
  const surePhrase = await text(page, '.wse-sheet-root .gd-sure');
  assert.ok(/^Day \d+: /.test(surePhrase) && /Timing: |Pattern only/.test(surePhrase), tag('the confidence phrase for the lead time: ' + surePhrase));
  return { card, surePhrase };
}

/** In the page: the box of the spread chart's reference label and its distance to the plotted curve (screen px, the path sampled every half unit). */
const REF_GAP = `(svg) => {
  const path = svg.querySelector('.gd-line'), txt = [...svg.querySelectorAll('text')].find((e) => e.textContent === 'one contour’s worth of doubt');
  if (!txt || !path) return null;
  const r = txt.getBoundingClientRect(), m = path.getScreenCTM(), len = path.getTotalLength(), pts = [];
  for (let l = 0; l <= len; l += 0.5) { const q = path.getPointAtLength(l); pts.push([q.x * m.a + q.y * m.c + m.e, q.x * m.b + q.y * m.d + m.f]); }
  const box = { x: r.left, y: r.top, w: r.width, h: r.height };
  const gap = pts.reduce((g, q) => Math.min(g, Math.hypot(Math.max(box.x - q[0], 0, q[0] - (box.x + box.w)), Math.max(box.y - q[1], 0, q[1] - (box.y + box.h)))), Infinity);
  return { box, gap, n: pts.length };
}`;

async function sureChecks(page, assert, tag, { fixture }) {
  await inp.click(page, '.wse-sheet-root [data-guide-go="sure"]');
  await page.waitFor('!!document.querySelector(".wse-sheet-root .gd-sure-panel .gd-chart")', { timeout: 8000 });
  await sleep(1200); // the spread curve fills in as the ensemble chunks arrive
  const t = await page.eval(`document.querySelector('.wse-sheet-root .gd-sure-panel').textContent`);
  assert.equal(await text(page, '.wse-sheet-title'), 'How sure is this?', tag('panel title'));
  assert.ok(t.includes('one contour’s worth of doubt'), tag('the 6 dam reference line is labelled'));
  assert.ok(t.includes('agrees within about 1 m'), tag('what has been checked: the NOAA normal'));
  assert.ok(!t.includes('compared with the raw ECMWF file'), tag('no GRIB sentence without a passing check in the manifest'));
  assert.ok(t.includes('Rain thresholds') && t.includes('not a phone'), tag('what has not been checked'));
  const path = await page.eval(`document.querySelector('.wse-sheet-root .gd-chart .gd-line')?.getAttribute('d') || ''`);
  assert.ok(path.length > 40 && (path.match(/L/g) || []).length >= 10, tag(`the chart draws this run's spread curve from the loaded data (${(path.match(/L/g) || []).length} segments)`));
  // the reference label keeps its distance from the plotted curve: its box, measured on the page, is SLACK px or more from every point of the path
  const lab = await page.eval(`(${REF_GAP})(document.querySelector('.wse-sheet-root .gd-chart'))`);
  assert.ok(lab && lab.box.w > 40, tag('the reference label is on the chart: ' + JSON.stringify(lab)));
  assert.ok(lab.gap >= SLACK, tag(`the curve keeps at least ${SLACK} px from the reference label's box (gap ${lab.gap.toFixed(1)} px over ${lab.n} path points, box ${JSON.stringify(lab.box)})`));
  // ...for curves that rise through the old fixed spot too (the fixture's own curve need not): drawn on the page by the chart builder itself
  const shapes = await page.eval(`import('/js/ui/guide.js').then((g) => {
    const steps = Array.from({ length: 31 }, (_, i) => i * 12), shapes = {
      'rises early': (d) => Math.min(9, d * 1.4), 'rises through the middle': (d) => Math.max(0, (d - 4) * 1.2), 'rises late': (d) => Math.max(0, (d - 9) * 1.5),
      'rises steadily': (d) => d * 0.7, 'stays low': () => 1.5, 'stays high': (d) => 6 + d * 0.2, 'falls': (d) => Math.max(0, 9 - d * 0.8) };
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:340px;z-index:99999;background:#fff'; document.body.append(host);
    const out = Object.entries(shapes).map(([name, f]) => { host.replaceChildren(g.spreadChart({ steps, values: steps.map((st) => f(st / 24)) })); const r = (${REF_GAP})(host.firstChild); return { name, gap: r && r.gap, w: r && r.box.w, inside: !!r && r.box.x >= host.getBoundingClientRect().left && r.box.x + r.box.w <= host.getBoundingClientRect().right }; });
    host.remove(); return out;
  })`);
  for (const q of shapes) assert.ok(q.gap >= SLACK && q.inside, tag(`a spread curve that ${q.name}: the reference label stays ${SLACK} px clear of it (gap ${q.gap?.toFixed?.(1)} px) and inside the chart`));
  assert.ok(/forecasts agree closely|within one contour|disagree by more than one contour/.test(t), tag('the lead-time ladder is in words'));
  if (fixture === 'synthetic-15d') assert.ok(t.includes('average of 51 forecasts'), tag('the zones table words'));
  // the GRIB sentence: only for a pass
  const g = await page.eval(`import('/js/ui/guide.js').then((g) => { const txt = (m) => g.buildSure(m, {}).textContent; return { pass: txt({ checks: { grib_compare: { status: 'pass', max_abs_gpm: 12.34 } } }), fail: txt({ checks: { grib_compare: { status: 'fail', max_abs_gpm: 99 } } }), none: txt({}) }; })`);
  assert.ok(g.pass.includes('compared with the raw ECMWF file: largest difference 12.3 m'), tag('GRIB sentence on a pass'));
  assert.ok(!g.fail.includes('raw ECMWF file') && !g.none.includes('raw ECMWF file'), tag('no GRIB sentence on a fail or without the check'));
  await inp.click(page, '.wse-sheet-root [data-guide-go="guide"]'); await sleep(400);
  assert.equal(await text(page, '.wse-sheet-title'), 'What am I looking at?', tag('Back returns to the guide'));
}

async function readoutChecks(page, assert, tag, { phone }) {
  const probes = await page.eval(`__wse.data.getManifest().probes.filter((p) => p.domain === 'np05' && ['band+11dam', 'no-signal', 'no-signal.spread'].includes(p.name)).map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, step: p.step, v: p.value }))`);
  const ridge = probes.find((p) => p.name === 'band+11dam' && p.step === 0), none = probes.find((p) => p.name === 'no-signal'), sd = probes.find((p) => p.name === 'no-signal.spread');
  // --- a ridge, with a signed value ---
  await setT(page, 0); await sleep(300);
  let p = await showPlace(page, ridge.lon, ridge.lat);
  await (phone ? inp.tap : inp.click)(page, p); await page.waitFor('!!document.querySelector("#readout:not([hidden]) .rdo-first")', { timeout: 6000 });
  await sleep(300);
  const first = await text(page, '#readout .rdo-first');
  assert.ok(/ridge/.test(first) && /^[+−]\d+ dam/.test(first), tag(`the ridge probe reads a ridge with a signed value: "${first}"`));
  assert.equal(first, `+${Math.round(ridge.v / 10)} dam · a ridge`, tag('the value is the field value at the probe'));
  const lines = await page.eval(`[...document.querySelectorAll('#readout p')].map((e) => e.textContent)`);
  assert.ok(lines.some((l) => /^height \d+ dam \([\d,]+ m\)$/.test(l)), tag('the height line: ' + lines));
  assert.ok(lines.some((l) => /day \d+$/.test(l) && /(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(l)), tag('the valid time and day: ' + lines));
  const rb = await box(page, '#readout'), stage = await box(page, '#stage');
  assert.ok(rb.x >= stage.x && rb.y >= stage.y && rb.x + rb.w <= stage.x + stage.w && rb.y + rb.h <= stage.y + stage.h, tag('the card stays inside the map'));
  for (const sel of ['#map-legend', '#map-tools .seg', '#map-tools .tools-end']) assert.ok(!touches(rb, await box(page, sel)), tag('the card keeps clear of ' + sel));
  // the card never half-covers a ridge or trough plate: at the ridge probe, and pinned on the middle of each plate drawn
  const plateHit = async (label) => {
    const sc = await page.eval(SCENE), cb = await box(page, '#readout'), cv = await box(page, '#map');
    for (const q of sc.shown) assert.ok(!touches({ x: cv.x + q.x - q.w / 2, y: cv.y + q.y - q.h / 2, w: q.w, h: q.h }, cb), tag(`${label}: the card ${JSON.stringify(cb)} half-covers the ${q.kind} plate at ${Math.round(q.x)},${Math.round(q.y)} (${q.dam} dam)`));
    return sc.shown.length;
  };
  const here = await plateHit('at the ridge probe');
  const plates0 = await page.eval(SCENE);
  let pinnedOnPlate = 0;
  for (const q of plates0.shown.slice(0, 3)) {
    const cv = await box(page, '#map');
    await (phone ? inp.tap : inp.click)(page, { x: cv.x + q.x, y: cv.y + q.y });
    await page.waitFor('!!document.querySelector("#readout:not([hidden]) .rdo-first")', { timeout: 6000 }); await sleep(350);
    await plateHit(`pinned on the ${q.kind} plate`); pinnedOnPlate++;
  }
  assert.ok(pinnedOnPlate >= 1 || here === 0, tag(`the card was pinned on ${pinnedOnPlate} plates (${here} plates at the probe)`));
  await (phone ? inp.tap : inp.click)(page, p); await page.waitFor('!!document.querySelector("#readout:not([hidden]) .rdo-first")', { timeout: 6000 }); await sleep(350);
  // --- Add a place here ---
  assert.equal(await text(page, '#readout .rdo-add'), 'Add a place here', tag('the action'));
  await inp.click(page, '#readout .rdo-add');
  await page.waitFor('!!document.querySelector(".wse-sheet-root")', { timeout: 6000 });
  assert.equal(await page.eval(`document.getElementById('readout').hidden`), true, tag('the card steps aside when the Add sheet opens'));
  assert.ok(await page.eval(`!!document.querySelector('.wse-sheet-root .as')`), tag('it is the Add sheet'));
  await inp.key(page, null, 'Escape');
  // the pre-filled town is a draft: Escape asks once, inline. Wait for whichever comes (the question or the sheet leaving), never a fixed sleep
  const discardShown = `(() => { const b = document.querySelector('.wse-sheet-root [data-action="discard"]'); return !!b && !b.closest('[hidden]') && b.getBoundingClientRect().height > 0; })()`;
  await waitStep(page, tag, 'Escape on the Add sheet: it closes or asks to discard', `!document.querySelector('.wse-sheet-root') || ${discardShown}`);
  if (await page.eval(discardShown)) { await sleep(300); await inp.click(page, '.wse-sheet-root [data-action="discard"]'); } // the question settles in, then a real click
  await waitStep(page, tag, 'the Add sheet closes', '!document.querySelector(".wse-sheet-root")'); await sleep(250);
  // --- no clear signal ---
  await setT(page, 300); await sleep(400);
  p = await showPlace(page, none.lon, none.lat);
  await (phone ? inp.tap : inp.click)(page, p); await page.waitFor('!!document.querySelector("#readout:not([hidden]) .rdo-first")', { timeout: 6000 });
  await sleep(300);
  const nf = await text(page, '#readout .rdo-first'), ns = await text(page, '#readout .rdo-second');
  assert.equal(nf, 'No clear signal yet', tag('the no-signal probe: "' + nf + '"'));
  assert.ok(/^average of forecasts [+−]?\d+ dam, spread \d+ dam$/.test(ns), tag('the average and the spread in smaller type: "' + ns + '"'));
  assert.ok(!/ridge|trough|near normal/.test(nf + ns), tag('no ridge, trough or "near normal" words where nothing is clear'));
  const sz = await page.eval(`[parseFloat(getComputedStyle(document.querySelector('#readout .rdo-first')).fontSize), parseFloat(getComputedStyle(document.querySelector('#readout .rdo-second')).fontSize)]`);
  assert.ok(sz[1] < sz[0] && sz[1] >= 12, tag('the second line is smaller and still 12 px or more: ' + sz));
  // --- the keyboard: Enter on the focused map reads its centre; Escape puts it away and gives focus back ---
  await page.eval(`document.getElementById('map').focus()`);
  await inp.key(page, null, 'Enter'); await sleep(400);
  assert.equal(await page.eval(`document.activeElement && document.activeElement.id`), 'readout', tag('Enter at the map reads the centre and moves focus to the card'));
  assert.ok(await page.eval(`!document.getElementById('readout').hidden && document.querySelector('#readout .rdo-first').textContent.length > 3`), tag('the keyboard reading has words'));
  await inp.key(page, null, 'Escape'); await sleep(250);
  // Space belongs to play and pause even with the map focused: the readout does not take it
  await page.eval(`__wse.store.set({ playing: false })`); await sleep(200);
  await page.eval(`document.getElementById('map').focus()`);
  await inp.key(page, null, ' '); await sleep(300);
  assert.equal(await page.eval(`__wse.store.get().playing`), true, tag('Space on the focused map plays'));
  assert.ok(await page.eval(`document.getElementById('readout').hidden`), tag('Space does not open the readout'));
  await inp.key(page, null, ' '); await sleep(300);
  assert.equal(await page.eval(`__wse.store.get().playing`), false, tag('Space on the focused map pauses'));
  await inp.key(page, null, 'Enter'); await sleep(400);
  await inp.key(page, null, 'Tab'); await sleep(100);
  assert.ok(await page.eval(`document.activeElement.classList.contains('rdo-add')`), tag('Tab reaches "Add a place here"'));
  await inp.key(page, null, 'Escape'); await sleep(250);
  assert.ok(await page.eval(`document.getElementById('readout').hidden && document.activeElement.id === 'map'`), tag('Escape closes the card and returns focus to the map'));
}

async function annotationChecks(page, assert, tag, { phone }) {
  await inp.click(page, '#view-switch [data-view="np"]'); await sleep(400);
  await page.eval(`__wse.store.set({ t: 0, playing: false, overlays: { marks: true } })`); await sleep(800);
  const read = () => page.eval(`import('/js/render/annotate.js').then((a) => a.shown.map((s) => ({ id: s.id, kind: s.kind, dam: s.dam, lon: s.lon, lat: s.lat, x: s.x, y: s.y })))`);
  let shown = await read();
  const cap = phone ? 2 : 3;
  assert.ok(shown.length >= 1, tag('the Pattern lens labels its main features: ' + JSON.stringify(shown)));
  for (const k of ['ridge', 'trough']) assert.ok(shown.filter((s) => s.kind === k).length <= cap, tag(`at most ${cap} ${k}s`));
  for (let i = 0; i < shown.length; i++) {
    assert.ok(Math.abs(shown[i].dam) >= 12, tag(`labelled extremum is at least 12 dam: ${shown[i].dam}`));
    for (let j = i + 1; j < shown.length; j++) assert.ok(Math.hypot(shown[i].x - shown[j].x, shown[i].y - shown[j].y) >= 120, tag('labels at least 120 px apart'));
  }
  // identity over ten frames: step the model ten times with the Next control; a feature that stays within 800 km keeps its id
  const ids0 = shown.map((s) => s.id);
  const seen = new Set(ids0);
  for (let i = 0; i < 10; i++) { await inp.click(page, '.tl-next'); await sleep(250); shown = await read(); shown.forEach((s) => seen.add(s.id)); }
  assert.ok(seen.size <= ids0.length + 4, tag(`ten frames keep identities steady: ${seen.size} ids for ${ids0.length} labels at the start`));
  // none where the signal is none: at 300 h every plate sits on a clear-signal point
  await page.eval(`__wse.store.set({ t: 300, playing: false })`); await sleep(900);
  shown = await read();
  const sig = await page.eval(`import('/js/render/annotate.js').then((a) => a.shown.map((s) => __wse.renderer.sampleAt(s.lon, s.lat).signal))`);
  assert.ok(sig.every((s) => s === 'clear'), tag('no plate where the signal is none: ' + JSON.stringify(sig) + ' of ' + shown.length));
  // ...and the check has teeth. Make a state the fixture has no natural example of: the ensemble spread at 300 dam everywhere, so every
  // extremum of 12 dam or more has signal none and would be drawn were the rule absent. (The data module hands out the spread frame
  // it keeps for this time; filling that frame in place is how this page, and no other, sees a different spread.) Switch the view
  // away and back so the picker reads it again.
  await setT(page, 0); await sleep(600);
  const prep = await page.eval(`(async () => {
    const { VIEWS } = await import('/js/contract.js');
    const dom = VIEWS.np, d = __wse.data;
    const sd = d.fieldAt('z500sd', dom, 0);
    if (!sd) return { err: 'no spread frame on ' + dom };
    sd.fill(3000);
    return { dom, n: sd.length };
  })()`);
  assert.ok(!prep.err, tag('the spread frame is there: ' + JSON.stringify(prep)));
  await inp.click(page, '#view-switch [data-view="nh"]'); await sleep(500);
  await inp.click(page, '#view-switch [data-view="np"]'); await sleep(900);
  const bite = await page.eval(`import('/js/render/annotate.js').then((a) => {
    const d = a.lastDraw, none = d.cands.filter((c) => c.signal === 'none' && Math.abs(c.dam) >= 12);
    const would = a.selectLabels(d.cands.map((c) => ({ ...c, signal: 'clear' })), (ll) => __wse.renderer.project(ll), d);
    return { nCands: d.cands.length, none: none.map((c) => [c.lon, c.lat, c.dam]), would: would.map((c) => [c.lon, c.lat]), shown: a.shown.map((p) => [p.lon, p.lat]) };
  })`);
  assert.ok(bite.none.length >= 1, tag('a candidate of at least 12 dam has signal none: ' + JSON.stringify(bite)));
  assert.ok(bite.would.length >= 1, tag('and without the rule it would be drawn: ' + JSON.stringify(bite)));
  assert.deepEqual(bite.shown, [], tag(`the no-signal candidates are in the candidates (${bite.none.length}) but none is drawn: ${JSON.stringify(bite.shown)}`));
  await setT(page, 60); await sleep(500); await setT(page, 0); await sleep(700); // the data module refills its frame
  const back = await read();
  assert.ok(back.length >= 1, tag('with the real spread the plates return: ' + JSON.stringify(back)));
  // the Layers switch "Ridge and trough labels", with real clicks: off hides every plate, on brings them back
  const nShown = () => page.eval(`import('/js/render/annotate.js').then((a) => a.shown.length)`);
  const sw = '#layers-panel [data-overlay="marks"]';
  const flip = async (want) => {
    if (await page.eval(`document.getElementById('layers-panel').hidden`)) { await inp.click(page, '#btn-layers'); await page.waitFor(`!document.getElementById('layers-panel').hidden`, { timeout: 3000 }); await sleep(350); }
    await inp.click(page, sw); await sleep(250);
    const st = await page.eval(`({ aria: document.querySelector(${JSON.stringify(sw)}).getAttribute('aria-checked'), flag: __wse.store.get().overlays.marks })`);
    assert.deepEqual(st, { aria: String(want), flag: want }, tag(`the switch reads ${want ? 'on' : 'off'} and so does the store`));
    await inp.key(page, null, 'Escape'); await waitStep(page, tag, 'Escape closes Layers', `document.getElementById('layers-panel').hidden && !document.querySelector('.wse-sheet-root')`); await sleep(700);
  };
  await flip(false);
  const off = await nShown();
  assert.equal(off, 0, tag(`with Ridge and trough labels switched off in Layers nothing is drawn (${back.length} before)`));
  await flip(true);
  const on = await nShown();
  assert.ok(on >= 1, tag(`switched back on in Layers, the plates return: ${on}`));
}

/** In the page: the drawn plates, the contour label boxes the compositor drew (renderer.stats().labelSpots, rotated text boxes), and, with a
 *  focused place, its ring and name box (ui/focus.js: the name 17 px right of the point in 13 px 600). All in canvas px. */
const SCENE = `import('/js/render/annotate.js').then((a) => {
  const c = document.createElement('canvas').getContext('2d'), st = __wse.store.get();
  const spots = (__wse.renderer.stats().labelSpots || []).map((sp) => { c.font = '600 11px -apple-system, "SF Pro Text", system-ui, sans-serif'; const w = c.measureText(sp.text).width, h = 12, co = Math.abs(Math.cos(sp.angle || 0)), si = Math.abs(Math.sin(sp.angle || 0)), hx = co * w / 2 + si * h / 2, hy = si * w / 2 + co * h / 2; return { x: sp.x - hx, y: sp.y - hy, w: 2 * hx, h: 2 * hy, text: sp.text }; });
  let focus = null;
  if (st.focus && Number.isFinite(st.focus.lat)) { const p = __wse.renderer.project([st.focus.lon, st.focus.lat]); if (p) { c.font = '600 13px -apple-system, "SF Pro Text", system-ui, sans-serif'; const nw = st.focus.label ? c.measureText(String(st.focus.label)).width : 0; focus = { x: p[0] - 12, y: p[1] - 12, w: 24 + (nw ? 5 + nw : 0), h: 24, name: st.focus.label }; } }
  return { shown: a.shown.map((p) => ({ id: p.id, kind: p.kind, dam: p.dam, x: p.x, y: p.y, w: p.w, h: p.h })), spots, focus };
})`;
const plateBox = (p) => ({ x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h });

/** Across a time sweep at rest: every plate stands on a candidate the picker chose (no plate left partway along an ease), and none touches the legend card or the map tools. */
async function plateSweep(page, assert, tag, { phone }) {
  await inp.click(page, '#view-switch [data-view="np"]'); await sleep(400);
  await page.eval(`__wse.store.set({ t: 0, playing: false, overlays: { marks: true } })`); await sleep(500);
  const step = phone ? 12 : 6;
  let frames = 0, plates = 0, labelPairs = 0, focusFrames = 0;
  for (let t = 0; t <= 360; t += step) {
    await setT(page, t === 0 ? 48 : t); await sleep(120); await setT(page, t); await sleep(phone ? 400 : 550); // a jump first: the plates have to settle on the new place
    const r = await page.eval(`import('/js/render/annotate.js').then((a) => {
      const cv = document.getElementById('map').getBoundingClientRect(), rect = (sel) => { const e = document.querySelector(sel); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { x: r.left - cv.left, y: r.top - cv.top, w: r.width, h: r.height } : null; };
      return { shown: a.shown.map((p) => ({ id: p.id, kind: p.kind, lon: p.lon, lat: p.lat, x: p.x, y: p.y, w: p.w, h: p.h, onCand: a.lastDraw.cands.some((c) => c.lon === p.lon && c.lat === p.lat && c.kind === p.kind) })), legend: rect('#map-legend'), tools: rect('#map-tools') };
    })`);
    frames++;
    for (const p of r.shown) {
      plates++;
      const pb = { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h };
      assert.ok(p.onCand, tag(`t=${t}: plate ${p.id} stands on the picker's choice, not partway along an ease (${p.lon}, ${p.lat})`));
      assert.ok(!touches(pb, r.legend), tag(`t=${t}: a ${p.kind} plate at ${Math.round(p.x)},${Math.round(p.y)} touches #map-legend ${JSON.stringify(r.legend)}`));
      assert.ok(!touches(pb, r.tools), tag(`t=${t}: a ${p.kind} plate touches #map-tools`));
    }
    const sh = r.shown;
    for (let i = 0; i < sh.length; i++) for (let j = i + 1; j < sh.length; j++) assert.ok(Math.hypot(sh[i].x - sh[j].x, sh[i].y - sh[j].y) >= 120, tag(`t=${t}: drawn plates at least 120 px apart`));
    // a plate is never over a contour label (the labels win), with or without a focused place whose pin and name win too
    const sc = await page.eval(SCENE);
    for (const q of sc.shown) for (const sp of sc.spots) { labelPairs++; assert.ok(!touches(plateBox(q), sp), tag(`t=${t}: a ${q.kind} plate at ${Math.round(q.x)},${Math.round(q.y)} sits on the contour label "${sp.text}" ${JSON.stringify(sp)}`)); }
    const top = await page.eval(`import('/js/render/annotate.js').then((a) => { const c = a.lastDraw.cands.filter((q) => q.signal === 'clear' && Math.abs(q.dam) >= 12).map((q) => ({ lon: q.lon, lat: q.lat, dam: q.dam, p: __wse.renderer.project([q.lon, q.lat]) })).filter((q) => q.p && q.p[0] > 40 && q.p[0] < a.lastDraw.W - 40 && q.p[1] > 60 && q.p[1] < a.lastDraw.H - 60).sort((x, y) => Math.abs(y.dam) - Math.abs(x.dam)); return c[0] || null; })`);
    if (top) {
      await page.eval(`__wse.store.set({ focus: { lon: ${top.lon}, lat: ${top.lat}, label: 'Test Town, XX', kind: 'place' } })`); await sleep(phone ? 450 : 600);
      const fs = await page.eval(SCENE);
      assert.ok(fs.focus, tag(`t=${t}: the focused place is on screen`));
      focusFrames++;
      for (const q of fs.shown) {
        assert.ok(!touches(plateBox(q), fs.focus), tag(`t=${t}: a ${q.kind} plate at ${Math.round(q.x)},${Math.round(q.y)} sits on the focused place's pin or name ${JSON.stringify(fs.focus)} (a ${top.dam} dam extremum is on the pin)`));
        for (const sp of fs.spots) assert.ok(!touches(plateBox(q), sp), tag(`t=${t}: with a focus, a ${q.kind} plate sits on the contour label "${sp.text}"`));
      }
      await page.eval(`__wse.store.set({ focus: null })`); await sleep(120);
    }
  }
  assert.ok(plates >= (phone ? 3 : frames), tag(`the sweep saw plates (${plates} over ${frames} frames)`));
  assert.ok(labelPairs > 0 && focusFrames >= 5, tag(`the sweep compared plates with contour labels (${labelPairs} pairs) and with a focused place (${focusFrames} of ${frames} frames)`));
}

async function coachChecks(page, assert, baseUrl, tag, { phone }) {
  await boot(page, baseUrl, phone ? 390 : 1440, phone ? 844 : 900, { keepPrefs: false });
  const hint = () => page.eval(`(() => { const all = [...document.querySelectorAll('.coach')]; const e = all[0]; return { n: all.length, id: e?.dataset.hint || null, text: e?.querySelector('.coach-text')?.textContent || '' }; })()`);
  const clear = async (label) => {
    const b = await box(page, '.coach');
    for (const sel of ['#map-legend', '#timeline', '#map-tools .seg', '#map-tools .tools-end']) assert.ok(!touches(b, await box(page, sel)), tag(`${label}: the hint keeps ${SLACK} px clear of ${sel} ${JSON.stringify([b, await box(page, sel)])}`));
  };
  await page.waitFor('document.querySelectorAll(".coach").length === 1', { timeout: 15000 });
  let h = await hint();
  assert.equal(h.id, 'drag', tag('the first hint is about dragging: ' + h.text));
  await clear('drag hint');
  await inp.drag(page, '#map', { by: { dx: -60, dy: 20 }, touch: phone });
  await page.waitFor('document.querySelectorAll(".coach").length === 0 || document.querySelector(".coach").dataset.hint !== "drag"', { timeout: 5000 });
  await page.waitFor('document.querySelectorAll(".coach").length === 1 && document.querySelector(".coach").dataset.hint === "play"', { timeout: 8000 });
  h = await hint();
  assert.equal(h.n, 1, tag('one hint at a time'));
  await clear('play hint');
  await inp.click(page, '.tl-play'); await sleep(300);
  await inp.click(page, '.tl-play'); // pause again
  await page.waitFor('document.querySelectorAll(".coach").length === 1 && document.querySelector(".coach").dataset.hint === "tap"', { timeout: 8000 });
  await clear('tap hint');
  const p = await page.eval(`(() => { const r = document.getElementById('map').getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.45 }; })()`);
  await (phone ? inp.tap : inp.click)(page, p);
  await page.waitFor('document.querySelectorAll(".coach").length === 0', { timeout: 5000 });
  await sleep(1500);
  assert.equal((await hint()).n, 0, tag('after the third hint no more come'));
  assert.equal(await page.eval(`JSON.stringify(JSON.parse(localStorage.getItem('wse.v1.prefs')).coachSeen)`), JSON.stringify(['drag', 'play', 'tap']), tag('once per browser: all three recorded'));
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 30000 });
  await sleep(3500);
  assert.equal((await hint()).n, 0, tag('not shown again after a reload'));
  // reopenable from the guide
  await openGuide(page);
  await inp.click(page, '.wse-sheet-root .gd-tips');
  await waitStep(page, tag, '"Show the tips again" closes the guide', '!document.querySelector(".wse-sheet-root")');
  await page.waitFor('document.querySelectorAll(".coach").length === 1', { timeout: 8000 });
  assert.equal((await hint()).id, 'drag', tag('"Show the tips again" starts over'));
  // a window too short for a clear spot: the hint stands aside rather than sitting over a control, and comes back when there is room
  const CTRL = ['#map-legend', '#timeline', '#view-switch', '#btn-layers', '#btn-expand', '#map-tools .tools-end'];
  const W = phone ? 390 : 1440;
  await page.setViewport(W, 360, 1);
  let seenOver = null, samples = 0, present = 0;
  for (let i = 0; i < 16; i++) {
    await sleep(200);
    const r = await page.eval(`(() => { const c = document.querySelector('.coach'); if (!c) return null; const b = c.getBoundingClientRect(); return { b: { x: b.left, y: b.top, w: b.width, h: b.height }, ctl: ${JSON.stringify(CTRL)}.map((q) => { const e = document.querySelector(q); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { q, x: r.left, y: r.top, w: r.width, h: r.height } : null; }).filter(Boolean) }; })()`);
    samples++;
    if (!r) continue;
    present++;
    const over = r.ctl.find((c) => touches(r.b, c));
    if (over && !seenOver) seenOver = { hint: r.b, over };
  }
  assert.equal(seenOver, null, tag(`at ${W}x360 the hint never covers a control (${present} of ${samples} samples had a hint): ${JSON.stringify(seenOver)}`));
  await page.setViewport(W, phone ? 844 : 900, 1);
  await page.waitFor('document.querySelectorAll(".coach").length === 1', { timeout: 8000 });
  await clear('the hint back at full height');
}

async function howChecks(page, assert, baseUrl, tag) {
  await page.setViewport(390, 844, 1);
  await page.goto(baseUrl + 'how.html');
  await page.waitFor('document.documentElement.dataset.howReady !== undefined && +document.documentElement.dataset.howReady > 0', { timeout: 15000 });
  const r = await page.eval(`(async () => {
    const { listed } = await import('/js/lenses/index.js');
    const secs = [...document.querySelectorAll('.how-lens')].map((s) => ({ id: s.id, h2: s.querySelector('h2')?.textContent, answer: s.querySelector('.gd-answer')?.textContent }));
    const urls = [...document.querySelectorAll('[src],[href]')].map((e) => e.getAttribute('src') ?? e.getAttribute('href')).filter((u) => u && !u.startsWith('#'));
    const d = document.doctype;
    return { want: listed().map((l) => ({ id: l.id, name: l.name, answer: l.guide.answer })), secs, urls, doctype: d && d.name, charset: document.characterSet, viewport: !!document.querySelector('meta[name=viewport]'), lang: document.documentElement.lang,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  })()`);
  assert.equal(r.doctype, 'html', tag('how.html has a doctype'));
  assert.ok(r.charset.toLowerCase() === 'utf-8' && r.viewport && r.lang === 'en', tag('charset, viewport and language'));
  assert.deepEqual(r.secs.map((s) => s.id), r.want.map((w) => w.id), tag('one section per listed lens'));
  for (const w of r.want) { const s = r.secs.find((x) => x.id === w.id); assert.equal(s.h2, w.name, tag('heading ' + w.id)); assert.equal(s.answer, w.answer, tag(`the section for ${w.id} is the descriptor's own guide text`)); }
  for (const u of r.urls) assert.ok(!/^(https?:)?\/\//.test(u) && !u.startsWith('/'), tag('relative path only: ' + u));
  assert.ok(r.overflow <= 0, tag('no sideways scroll at 390 px: ' + r.overflow));
  assert.deepEqual(page.errors(), [], tag(JSON.stringify(page.errors())));
}

export async function run(a) {
  try { return await runAll(a); } catch (e) { if (process.env.S_EXPLAIN_TRACE) console.log(e.stack); throw e; }
}
async function runAll({ page, baseUrl, assert, fixture }) {
  const tag = (m) => `[${fixture}] ${m}`;
  // ---------- the coach first: it needs a browser that has seen nothing ----------
  if (fixture === 'synthetic-15d') {
    await coachChecks(page, assert, baseUrl, tag, { phone: false });
    await coachChecks(page, assert, baseUrl, (m) => tag('phone: ' + m), { phone: true });
  }
  // ---------- desktop ----------
  await boot(page, baseUrl, 1440, 900);
  await page.eval(`localStorage.setItem('wse.v1.prefs', JSON.stringify({ ...JSON.parse(localStorage.getItem('wse.v1.prefs') || '{}'), coachSeen: ['drag', 'play', 'tap'] }))`);
  const a = await guideChecks(page, assert, fixture, tag);
  if (fixture === 'synthetic-15d') {
    await sureChecks(page, assert, tag, { fixture });
    await closeSheet(page, tag, 'desktop: the guide closes on Escape after How sure');
    // For you again at another time: the card and the guide move together
    await setT(page, 96); await sleep(700);
    await openGuide(page);
    const card2 = await text(page, '#focus-card .dayline'), fy2 = await text(page, '.wse-sheet-root .gd-foryou');
    assert.equal(fy2, card2, tag('"For you" equals the day line at another time'));
    await closeSheet(page, tag, 'desktop: the guide closes on Escape after For you at 96 h');
    await readoutChecks(page, assert, tag, { phone: false });
    await annotationChecks(page, assert, tag, { phone: false });
    await plateSweep(page, assert, tag, { phone: false });
  } else {
    await closeSheet(page, tag, 'desktop: the guide closes on Escape (recorded)');
    const sampleStatus = await page.eval(`document.querySelector('.wse-sheet-root') ? 1 : 0`);
    assert.equal(sampleStatus, 0, tag('the guide closed'));
  }
  assert.deepEqual(page.errors(), [], tag(JSON.stringify(page.errors())));
  // ---------- phone ----------
  await boot(page, baseUrl, 390, 844);
  await guideChecks(page, assert, fixture, (m) => tag('phone: ' + m));
  const sb = await box(page, '.wse-sheet-root .wse-sheet');
  assert.ok(sb.w <= 390 + 0.5 && sb.x >= -0.5, tag('the guide sheet fits the phone width'));
  const over = await page.eval(`(() => { const b = document.querySelector('.wse-sheet-root .wse-sheet-body'); return b.scrollWidth - b.clientWidth; })()`);
  assert.ok(over <= 0, tag('no sideways scroll in the guide at 390 px: ' + over));
  await closeSheet(page, tag, 'phone: the guide closes on Escape');
  if (fixture === 'synthetic-15d') {
    await readoutChecks(page, assert, (m) => tag('phone: ' + m), { phone: true });
    await annotationChecks(page, assert, (m) => tag('phone: ' + m), { phone: true });
    await plateSweep(page, assert, (m) => tag('phone: ' + m), { phone: true });
    await howChecks(page, assert, baseUrl, tag);
  }
  assert.deepEqual(page.errors(), [], tag(JSON.stringify(page.errors())));
  void a;
}
