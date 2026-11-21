// S-LENS-A (W4-03, DESIGN-SPEC 6.1, 14.3): the Jet stream and Confidence lenses, measured on RENDERED PIXELS of the real compose().
//
//   Jet (synthetic-15d, recorded):
//     - a pixel at 35 m/s is exactly #ffff00 and one at 25 m/s is the ground (no fade-in), at 0 h and again at 300 h;
//     - one band up the hex is the ECMWF one (#a7e700 at 45 m/s, #5dd000 at 55 m/s);
//     - an isotach line sits on every crossing of 36, 46 and 57 m/s (and 67 where the run reaches it: the recording does) and on none
//       of 43 m/s; the labels read 70, 90, 110 or 130 kt;
//     - the grey height lines are there with the Height contours overlay on and gone with it off, the isotachs stay.
//   Confidence (synthetic-15d, recorded):
//     - spread pixels are exactly the band hex (2-4, 4-6, 6-8, 8-12 and 12+ dam), under 2 dam draws nothing;
//     - the 6 dam spread line is ink on every sampled crossing of 6 dam, not on 7 dam; its label is drawn.
//     - the phrase is drawn wherever a 6 dam line is in view, on a phone (390 px wide) too: Hemisphere at 120 h, Global at 144 h and
//       Regional at 96 h (desktop) on the recording, where the line is many small loops with no straight run (W4-03 review round 2), and
//       no line ink shows between its words.
//   Map controls (synthetic-15d, recorded; a 390 x 844 phone): labels keep clear of every floating map control. Zoomed to 2x, the
//     Reset view button is in avoidRects, the slot reserved before it first shows covers it, and no isotach label box overlaps it.
//   synthetic-partial: the Confidence lens is NOT available ("Not in this run") and the Layers panel disables it with those words
//   (the MVP toggle that drew nothing is the failing "before", UX-8); the jet is.
// The lens is chosen by the state's `lens` code handed to compose(), as S-COLOR does: the lens list in the Layers panel arrives with
// W4-01, and this check uses its [data-lens] buttons for the availability words when they exist, the legacy [data-layer] ones until then.
// Known-positive mutant: M-lens-a-1 (the jet fills from 20 m/s) must fail here.
import { sleep } from '../wp2/shot.mjs';

export const id = 'S-LENS-A';
export const freshProfile = false;
export const timeoutMs = 180000;
export const data = ['synthetic-15d', 'recorded', 'synthetic-partial'];

export const SETUP = `(() => {
  if (window.__fl) return true;
  const fl = window.__fl = { scene: null, last: null, base: null, texts: [] };
  const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  fl.hexRGB = hexRGB;
  const grab = (ctx, W, H) => ctx.getImageData(0, 0, W, H).data;
  fl.render = async ({ ground = 'paper', t, lens, view = 'np', W = 1000, H = 600, overlays = { contours: false }, fields = [], xf }) => {
    const { makeScene } = await import('/js/render/compose.js');
    fl.scene ||= makeScene();
    const bm = await import('/js/render/basemap.js');
    for (let i = 0; i < 100 && !bm.basemapData(); i++) await new Promise((r) => setTimeout(r, 50));
    fl.geo ||= bm.basemapData();
    const d = window.__wse.data, m = d.getManifest();
    await Promise.all(fields.filter((f) => m.fields[f]).flatMap((f) => m.fields[f].domains.map((dm) => d.ensure(f, dm, t))));
    bm.setBasemap(null); // probes are read where the field alone is drawn (S-LINEART measures coast ink)
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const texts = []; const calls = []; const ft = ctx.fillText.bind(ctx); const di = ctx.drawImage.bind(ctx);
    ctx.fillText = (s, ...a) => { texts.push(String(s)); const tf = ctx.getTransform(); calls.push({ k: 'text', text: String(s), tf: [tf.a, tf.b, tf.c, tf.d, tf.e, tf.f], font: ctx.font, y: Number(a[1]) || 0 }); return ft(s, ...a); };
    ctx.drawImage = (...a) => { calls.push({ k: 'image' }); return di(...a); };
    const mv = xf ? fl.scene.viewFor(view, W, H, xf) : fl.scene.viewFor(view, W, H);
    fl.scene.compose(ctx, mv, { s: { t, view, lens, ground, theme: ground === 'night' ? 'dark' : 'light', overlays }, dpr: 1, quality: 'rest', alpha: 1, force: true });
    bm.setBasemap(fl.geo);
    fl.last = { ctx, mv, W, H, t, view, data: grab(ctx, W, H), texts, calls };
    return texts;
  };
  fl.px = (x, y) => { const { data, W } = fl.last, i = 4 * (y * W + x); return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
  fl.val = (field, x, y) => {
    const { mv, t, view } = fl.last, d = window.__wse.data, m = d.getManifest(), meta = m.fields[field];
    const want = { np: 'np05', nh: 'g1', gl: 'g1' }[view], domId = meta.domains.includes(want) ? want : meta.domains[0], dom = m.domains[domId];
    const arr = d.fieldAt(field, domId, t), ll = mv.invert([x + 0.5, y + 0.5]);
    if (!arr || !ll) return NaN;
    const q = fl.grid.toGrid(dom, ll[0], ll[1]);
    return q && q[0] > 2 && q[1] > 2 && q[0] < dom.nx - 3 && q[1] < dom.ny - 3 ? fl.grid.bilinear(arr, dom, q[0], q[1], NaN) : NaN;
  };
  // windows (2 half + 1 px square) in which every pixel's value (x factor) is inside [lo, hi]; greedy, at least 14 px apart
  fl.windows = (field, factor, lo, hi, half = 5, max = 40) => {
    const { W, H } = fl.last, out = [];
    for (let y = 16; y < H - 16; y += 7) for (let x = 16; x < W - 16; x += 7) {
      if (out.length >= max) return out;
      if (out.some((o) => Math.abs(o.x - x) < 14 && Math.abs(o.y - y) < 14)) continue;
      let ok = true;
      for (let dy = -half; dy <= half && ok; dy += 2) for (let dx = -half; dx <= half && ok; dx += 2) { const v = fl.val(field, x + dx, y + dy) * factor; ok = v >= lo && v <= hi; }
      if (ok) out.push({ x, y });
    }
    return out;
  };
  fl.windowEq = (w, half, rgb) => { for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) { const p = fl.px(w.x + dx, w.y + dy); if (p[0] !== rgb[0] || p[1] !== rgb[1] || p[2] !== rgb[2]) return false; } return true; };
  fl.windowSameAsBase = (w, half) => { for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) { const a = fl.px(w.x + dx, w.y + dy), i = 4 * ((w.y + dy) * fl.last.W + w.x + dx), b = fl.base; if (a[0] !== b[i] || a[1] !== b[i + 1] || a[2] !== b[i + 2]) return false; } return true; };
  // horizontal crossings of level L (value x factor), at least 12 px apart, away from the edge
  fl.crossings = (field, factor, L, max = 40) => {
    const { W, H } = fl.last, out = [];
    for (let y = 24; y < H - 24; y += 5) for (let x = 24; x < W - 24; x++) {
      if (out.length >= max) return out;
      const a = fl.val(field, x, y) * factor, b = fl.val(field, x + 1, y) * factor;
      if (!(a === a && b === b) || Math.abs(a - b) > 1.2) continue; // a gentle slope: a neighbouring level is 2 px or more away
      if ((a < L && b >= L) || (a >= L && b < L)) { if (!out.some((o) => Math.abs(o.x - x) < 12 && Math.abs(o.y - y) < 12)) out.push({ x, y }); }
    }
    return out;
  };
  // the pixel in the space between the two words of a label ("70" | "kt"), found from the text's own transform and its row's y: [x, y] of the gap centre and
  // the same 2 px above and below (the label is rotated along its line, so the offsets are in its frame)
  fl.gapPixels = (call) => {
    const c = document.createElement('canvas').getContext('2d'); c.font = call.font;
    const [first] = call.text.split(' '), w = c.measureText(call.text).width;
    const gx = -w / 2 + c.measureText(first).width + c.measureText(' ').width / 2, [a, b, c2, d, e, f] = call.tf;
    return [-2, 0, 2].map((d0) => { const dy = d0 + (call.y || 0), x = Math.round(a * gx + c2 * dy + e), y = Math.round(b * gx + d * dy + f); return { x, y, px: fl.px(x, y) }; });
  };
  fl.dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  // the nearest-to-ink pixel in x-2..x+3 as a share of the distance of the plain side colours to the ink (0 = ink, 1 = the band)
  fl.lineShare = (c, ink) => {
    const side = [fl.px(c.x - 5, c.y), fl.px(c.x + 6, c.y)], ref = Math.min(fl.dist(side[0], ink), fl.dist(side[1], ink));
    let best = Infinity; for (let dx = -2; dx <= 3; dx++) best = Math.min(best, fl.dist(fl.px(c.x + dx, c.y), ink));
    return ref > 0 ? best / ref : 1;
  };
  fl.flat = (c) => { const p = fl.px(c.x, c.y); for (let dx = -4; dx <= 4; dx++) { const q = fl.px(c.x + dx, c.y); if (q[0] !== p[0] || q[1] !== p[1] || q[2] !== p[2]) return false; } return true; };
  fl.changed = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };
  return import('/js/data/grid.js').then((g) => { fl.grid = g; return true; });
})()`;

export async function run({ page, baseUrl, assert, fixture }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 45000 });
  await page.waitFor('window.__wse.data.getManifest() !== null', { timeout: 15000 });
  await page.eval(SETUP);
  const manifest = await page.eval('window.__wse.data.getManifest()');
  const avail = (code) => page.eval(`import('/js/lenses/index.js').then((m) => m.lens('${code}').available(window.__wse.data.getManifest()))`);

  // ---- availability, in the registry and in the panel a person reads ----
  const haveSd = !!manifest.fields.z500sd;
  assert.deepEqual(await avail('j'), { ok: true }, 'the jet lens is available: every fixture here has a 250 hPa wind');
  assert.deepEqual(await avail('c'), haveSd ? { ok: true } : { ok: false, reason: 'Not in this run' }, `Confidence availability follows z500sd (${haveSd ? 'present' : 'missing'})`);
  // (the legacy Layers panel throws on a recorded manifest: it reads manifest.cases. The lens list of W4-01 replaces it, so the panel is only opened where it works)
  if (fixture !== 'recorded') await page.eval(`document.getElementById('btn-layers')?.click()`);
  await sleep(150);
  const ui = await page.eval(`(() => {
    const b = document.querySelector('[data-lens="c"]') || document.querySelector('[data-layer="c"]');
    return b ? { lensList: b.hasAttribute('data-lens'), disabled: b.disabled || b.getAttribute('aria-disabled') === 'true', text: b.textContent } : null;
  })()`);
  if (fixture === 'synthetic-partial') {
    assert.ok(ui, 'the panel lists Confidence');
    assert.equal(ui.disabled, true, 'Confidence is disabled on the partial build (the MVP toggle drew nothing)');
    // the lens list (W4-01) says exactly "Not in this run"; the legacy Layers panel, for a sample manifest, says "Not in this sample case"
    assert.match(ui.text, ui.lensList ? /Not in this run/ : /Not in this (run|sample case)/, `the reason is a data reason only: ${ui.text}`);
    assert.doesNotMatch(ui.text, /coming soon/i);
    assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
    return;
  }
  // (the legacy panel disables every layer of a recorded run: it asks for sample cases; the lens list replaces it)
  if (ui && (ui.lensList || fixture === 'synthetic-15d')) assert.equal(ui.disabled, false, 'Confidence is enabled where the run carries the spread');

  const FIELDS = ['ws250', 'z500', 'z500sd', 'z500a'];
  const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
  const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const toHex = (c) => '#' + c.slice(0, 3).map(hex2).join('');
    const SPREAD = ['#e6e3ee', '#cbc6dc', '#a9a2c6', '#8780ad', '#5e5788'];
  const render = (o) => page.eval(`window.__fl.render(${JSON.stringify({ fields: FIELDS, ...o })})`);
  const windows = (field, factor, lo, hi, half = 5) => page.eval(`window.__fl.windows('${field}', ${factor}, ${lo}, ${hi}, ${half})`);
  const exact = (ws, half, hex) => page.eval(`${JSON.stringify(ws)}.filter((w) => window.__fl.windowEq(w, ${half}, ${JSON.stringify(rgbOf(hex))})).length`);
  const crossings = (field, factor, L) => page.eval(`window.__fl.crossings('${field}', ${factor}, ${L})`);
  const share = (cs, ink) => page.eval(`${JSON.stringify(cs)}.map((c) => window.__fl.lineShare(c, ${JSON.stringify(ink)}))`);
  const log = (s) => console.log(`  [${fixture}] ${s}`);

  // ---- Jet: the fill ----
  const times = fixture === 'recorded' ? [0, 120] : [0, 300];
  for (const t of times) {
    await render({ t, lens: null });
    await page.eval(`window.__fl.base = window.__fl.last.data`);
    await render({ t, lens: 'j' });
    const y35 = await windows('ws250', 1, 30.8, 34.2, 1), y25 = await windows('ws250', 1, 18, 29.2, 1), g45 = await windows('ws250', 1, 41, 44.2, 1), g55 = await windows('ws250', 1, 51, 54.8, 1);
    assert.ok(y35.length >= 4, `t=${t}: windows at 35 m/s exist (${y35.length})`);
    const n35 = await exact(y35, 1, '#ffff00');
    assert.ok(n35 >= y35.length * 0.8, `t=${t}: 35 m/s is exactly #ffff00 in ${n35} of ${y35.length} windows`);
    assert.ok(y25.length >= 4, `t=${t}: windows at 25 m/s exist (${y25.length})`);
    const n25 = await page.eval(`${JSON.stringify(y25)}.filter((w) => window.__fl.windowSameAsBase(w, 1)).length`);
    assert.ok(n25 >= y25.length * 0.9, `t=${t}: 25 m/s is unfilled (the ground, as with no lens) in ${n25} of ${y25.length} windows`);
    if (g45.length >= 3) assert.ok(await exact(g45, 1, '#a7e700') >= g45.length * 0.8, `t=${t}: 43 m/s is #a7e700`);
    if (g55.length >= 3) assert.ok(await exact(g55, 1, '#5dd000') >= g55.length * 0.8, `t=${t}: 53 m/s is #5dd000`);
    log(`t=${t}: 35 m/s #ffff00 ${n35}/${y35.length}, 25 m/s unfilled ${n25}/${y25.length}, 43 m/s ${g45.length} windows, 53 m/s ${g55.length} windows`);
  }

  // ---- Jet: isotachs at 36, 46, 57 (and 67), none at 43; labels in knots ----
  const ink = rgbOf('#00724b');
  const tIso = 0;
  const texts = await render({ t: tIso, lens: 'j' });
  const wantLevels = fixture === 'recorded' ? [36, 46, 57, 67] : [36, 46, 57];
  for (const L of wantLevels) {
    const cs = await crossings('ws250', 1, L);
    assert.ok(cs.length >= 6, `${L} m/s is crossed at least 6 times in the view (${cs.length})`);
    const sh = await share(cs, ink), ok = sh.filter((v) => v < 0.62).length;
    assert.ok(ok >= cs.length * 0.8, `an isotach line sits on ${ok} of ${cs.length} crossings of ${L} m/s (shares ${sh.slice(0, 8).map((v) => Number(v).toFixed(2))})`);
    log(`isotach ${L} m/s: line on ${ok} of ${cs.length} crossings`);
  }
  const off0 = await crossings('ws250', 1, 43);
  // (a crossing under an isotach label is not a probe of the line: the glyphs are the line colour; drop those within 32 px of a label centre)
  const labelAt = await page.eval(`window.__fl.last.calls.filter((c) => c.k === 'text' && /kt$/.test(c.text)).map((c) => [c.tf[4], c.tf[5]])`);
  const off = off0.filter((c) => !labelAt.some(([x, y]) => Math.hypot(c.x - x, c.y - y) < 32));
  assert.ok(off.length >= 6, `43 m/s is crossed away from the labels (${off.length} of ${off0.length})`);
  const shOff = await share(off, ink), noLine = shOff.filter((v) => v >= 0.62).length;
  assert.ok(noLine >= off.length * 0.8, `43 m/s carries no line: ${noLine} of ${off.length} crossings have no isotach-coloured pixel (shares ${shOff.slice(0, 8).map((v) => Number(v).toFixed(2))})`);
  const kt = texts.filter((s) => /^(70|90|110|130) kt$/.test(s));
  assert.ok(kt.length >= 1, `an isotach label in knots is drawn: ${JSON.stringify(texts)}`);
  // every level the recording reaches is labelled at least once (the 70 kt line must not take every spot): 70, 90 and 110 kt here
  if (fixture === 'recorded') for (const need of ['70 kt', '90 kt', '110 kt']) assert.ok(kt.includes(need), `a ${need} label is drawn (got ${JSON.stringify(kt)})`);
  // the line is cleared under each label: the pixel between "70" and "kt" is not isotach ink
  const labelCalls = await page.eval(`window.__fl.last.calls.filter((c) => c.k === 'text' && /^(70|90|110|130) kt$/.test(c.text))`);
  for (const call of labelCalls) {
    const gp = await page.eval(`window.__fl.gapPixels(${JSON.stringify(call)})`);
    for (const g of gp) assert.ok(await page.eval(`window.__fl.dist(${JSON.stringify(g.px.slice(0, 3))}, ${JSON.stringify(ink)}) > 60`), `"${call.text}": the gap between the words at (${g.x}, ${g.y}) shows isotach ink ${JSON.stringify(g.px)}`);
  }
  // draw order (DESIGN-SPEC 15): the labels come after the coast and border linework, the last image drawn
  const order = await page.eval(`(() => { const c = window.__fl.last.calls; const li = c.map((x) => x.k).lastIndexOf('image'); return c.map((x, i) => x.k === 'text' && /kt$/.test(x.text) ? i > li : null).filter((v) => v !== null); })()`);
  assert.ok(order.length && order.every(Boolean), `isotach labels are drawn after the last linework image: ${JSON.stringify(order)}`);
  log(`jet labels: ${JSON.stringify([...new Set(kt)])}; ${labelCalls.length} gap probes clean`);

  // ---- Jet: the grey height lines follow the Height contours overlay; the isotachs do not ----
  const onOff = await page.eval(`(async () => {
    await window.__fl.render({ t: ${tIso}, lens: 'j', overlays: { contours: false }, fields: ${JSON.stringify(FIELDS)} });
    const off = window.__fl.last.data;
    await window.__fl.render({ t: ${tIso}, lens: 'j', overlays: {}, fields: ${JSON.stringify(FIELDS)} });
    return window.__fl.changed(off, window.__fl.last.data);
  })()`);
  assert.ok(onOff > 400, `the grey height lines add pixels with the overlay on (${onOff} differ from the overlay-off frame)`);
  log(`height lines add ${onOff} pixels`);

  // ---- Confidence: the bands ----
  const tC = 360;
  await render({ t: tC, lens: 'c' });
  const bandSpec = [[SPREAD[1], 4.4, 5.6], [SPREAD[2], 6.4, 7.6], [SPREAD[3], 8.4, 11.6], [SPREAD[4], 12.6, 99]];
  let bandsSeen = 0;
  for (const [hex, lo, hi] of bandSpec) {
    const ws = await windows('z500sd', 0.1, lo, hi, 2);
    if (ws.length < 3) { log(`spread ${lo}-${hi} dam: ${ws.length} windows here`); continue; }
    bandsSeen++;
    const n = await exact(ws, 2, hex);
    assert.ok(n >= ws.length * 0.8, `spread ${lo}-${hi} dam is exactly ${hex} in ${n} of ${ws.length} windows`);
    log(`spread ${lo}-${hi} dam: ${hex} in ${n} of ${ws.length} windows`);
  }
  assert.ok(bandsSeen >= 2, `at least two spread bands are in view at ${tC} h (${bandsSeen})`);
  await render({ t: 0, lens: 'c' });
  const calm = await windows('z500sd', 0.1, 0, 1.6, 2);
  await page.eval(`window.__fl.render(${JSON.stringify({ t: 0, lens: null, fields: FIELDS })}).then(() => { window.__fl.base = window.__fl.last.data; })`);
  await render({ t: 0, lens: 'c' });
  const nCalm = await page.eval(`${JSON.stringify(calm)}.filter((w) => window.__fl.windowSameAsBase(w, 2)).length`);
  assert.ok(calm.length >= 4 && nCalm >= calm.length * 0.9, `under 2 dam of spread draws nothing: ${nCalm} of ${calm.length} windows are the ground`);

  // ---- Confidence: the 6 dam line is emphasised (ink, over the band edge) and labelled ----
  const texts6 = await render({ t: tC, lens: 'c' });
  const inkC = rgbOf('#111417');
  const c6 = await crossings('z500sd', 0.1, 6);
  assert.ok(c6.length >= 6, `6 dam of spread is crossed at least 6 times at ${tC} h (${c6.length})`);
  const sh6 = await share(c6, inkC), ok6 = sh6.filter((v) => v < 0.5).length;
  assert.ok(ok6 >= c6.length * 0.8, `the 6 dam line is ink on ${ok6} of ${c6.length} crossings (shares ${sh6.slice(0, 8).map((v) => Number(v).toFixed(2))})`);
  const c7 = await crossings('z500sd', 0.1, 7);
  const sh7 = c7.length ? await share(c7, inkC) : [], no7 = sh7.filter((v) => v >= 0.5).length;
  assert.ok(c7.length >= 4 && no7 >= c7.length * 0.9, `7 dam carries no line: ${no7} of ${c7.length} crossings have no ink pixel`);
  assert.ok(texts6.includes("one contour's worth of doubt"), `the 6 dam line carries its label: ${JSON.stringify(texts6)}`);
  const ordC = await page.eval(`(() => { const c = window.__fl.last.calls; const li = c.map((x) => x.k).lastIndexOf('image'); const i = c.findIndex((x) => x.k === 'text' && x.text.startsWith('one contour')); return { i, li }; })()`);
  assert.ok(ordC.i > ordC.li, `the spread label is drawn after the coast and border linework (text call ${ordC.i}, last image ${ordC.li})`);
  const lab6 = await page.eval(`window.__fl.last.calls.find((c) => c.k === 'text' && c.text.startsWith('one contour'))`);
  // the gap between two words of the phrase is clear of the 6 dam line ink too
  const gap6 = await page.eval(`window.__fl.gapPixels(${JSON.stringify(lab6)})`);
  for (const g of gap6) assert.ok(await page.eval(`window.__fl.dist(${JSON.stringify(g.px.slice(0, 3))}, ${JSON.stringify(inkC)}) > 60`), `the 6 dam line shows through the phrase at (${g.x}, ${g.y}): ${JSON.stringify(g.px)}`);
  log(`6 dam line ink on ${ok6} of ${c6.length} crossings; label drawn`);

  // ---- Confidence: the phrase is on the map wherever a 6 dam line is, at mid leads and on a phone too ----
  // (at 96 to 192 h the line is many small loops with no straight run long enough for the phrase: review round 2 found it missing)
  const phrase = (tx) => { const j = tx.join('|'); return tx.includes("one contour's worth of doubt") || /one contour's\|worth of doubt|one contour's worth\|of doubt/.test(j); };
  // [view, t, W, H, the recording has a 6 dam line in view there] (Regional on a phone frames the Pacific approach, clear of it at 96 h)
  const midCases = [['nh', 120, 390, 520, 1], ['gl', 144, 390, 520, 1], ['np', 120, 390, 520, 0], ['nh', 120, 1000, 600, 1], ['np', 96, 1000, 600, 1]];
  for (const [view, t, W, H, need] of midCases) {
    const tx = await render({ t, lens: 'c', view, W, H });
    const g = await page.eval(`(async () => {
      const { polylines } = await import('/js/lenses/jet.js');
      const { mv, W, H, calls } = window.__fl.last;
      const sp = polylines('conf-spread', 'z500sd', { t: ${t}, view: '${view}', lens: 'c' }, mv, { levels: [60], step: 1 });
      const segs = [];
      for (const L of sp?.iso || []) for (const { pts } of L.lines) for (let k = 0; k + 3 < pts.length; k += 2) segs.push([pts[k], pts[k + 1], pts[k + 2], pts[k + 3]]);
      const inView = segs.filter(([x, y]) => x >= 0 && y >= 0 && x <= W && y <= H).length;
      const lab = calls.filter((k) => k.k === 'text' && /one contour|of doubt$/.test(k.text));
      return { inView, lab };
    })()`);
    if (fixture === 'recorded' && need) assert.ok(g.inView > 0, `${view} ${t} h ${W}x${H}: the recording has a 6 dam line in view (${g.inView} segments)`);
    if (g.inView > 0) {
      assert.ok(phrase(tx), `${view} ${t} h ${W}x${H}: a 6 dam line is in view (${g.inView} segments) and the phrase is drawn: ${JSON.stringify(tx.filter((x) => /contour|doubt/.test(x)))}`);
      // legible: the gap between the first two words of each row shows no 6 dam line ink
      for (const call of g.lab) {
        const gp = await page.eval(`window.__fl.gapPixels(${JSON.stringify(call)})`);
        for (const q of gp) assert.ok(await page.eval(`window.__fl.dist(${JSON.stringify(q.px.slice(0, 3))}, ${JSON.stringify(inkC)}) > 60`), `${view} ${t} h ${W}x${H}: "${call.text}" shows line ink between its words at (${q.x}, ${q.y})`);
      }
    }
    log(`${view} ${t} h ${W}x${H}: 6 dam segments in view ${g.inView}, phrase ${phrase(tx) ? 'drawn' : 'absent'} (${g.lab.map((k) => k.text).join(' / ')})`);
  }

  // ---- Map controls: labels keep clear of Reset view and every other floating control (a phone, zoomed in) ----
  await page.setViewport(390, 844, 1);
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.data.getManifest() !== null', { timeout: 45000 });
  await page.eval(`(async () => { (await import(new URL('js/time/clock.js', document.baseURI).href)).pause(); __wse.store.set({ view: 'np', lens: 'j', playing: false }); })()`);
  await sleep(500);
  await page.eval(SETUP);
  const ctlProbe = `(async () => {
    const { avoidRects, MAP_CONTROLS } = await import('/js/lenses/jet.js');
    const cv = document.getElementById('map'), cr = cv.getBoundingClientRect(), xf = { k: 2, tx: 0, ty: 0, rot: [0, 0, 0] };
    const mv = { W: cr.width, H: cr.height, xf: __wse.renderer.getTransform(), project: (ll) => __wse.renderer.project(ll) };
    const b = document.getElementById('btn-reset'), br = b && !b.hidden ? b.getBoundingClientRect() : null;
    return { ids: MAP_CONTROLS, W: cr.width, H: cr.height, rects: avoidRects(mv), moved: avoidRects({ ...mv, xf }),
      btn: br && br.width ? { x: br.left - cr.left, y: br.top - cr.top, w: br.width, h: br.height } : null };
  })()`;
  const covers = (r, b) => r.x <= b.x + 1 && r.y <= b.y + 1 && r.x + r.w >= b.x + b.w - 1 && r.y + r.h >= b.y + b.h - 1;
  const before = await page.eval(ctlProbe);
  assert.ok(before.ids.includes('btn-reset'), `Reset view is a named map control: ${JSON.stringify(before.ids)}`);
  assert.equal(before.btn, null, 'no Reset view at the default view');
  // the rest frame of the first move is drawn before Reset view shows (render/index.js commit(): draw, then emitView): its slot is held.
  // Any rect in the top band may hold it: the reserved slot when render/index.js makes the button (right 12, top 64), or the
  // #map-tools row when the shell's one-row map tools carry Reset view (W3-04: it takes its place in that row, left of Layers).
  const held = before.moved.filter((r) => r.y < 160);
  const ll = await page.eval(`__wse.renderer.invert([${Math.round(before.W / 2)}, ${Math.round(before.H / 2)}])`);
  await page.eval(`__wse.renderer.centreOn(${ll[1]}, ${ll[0]}, 0, 2)`);
  await sleep(900);
  const after = await page.eval(ctlProbe);
  assert.ok(after.btn && after.btn.w >= 44, `Reset view shows at 2x: ${JSON.stringify(after.btn)}`);
  assert.ok(held.some((r) => covers(r, after.btn)), `the slot held before Reset view first shows covers it: held ${JSON.stringify(held)}, button ${JSON.stringify(after.btn)}`);
  assert.ok(after.rects.some((r) => covers(r, after.btn)), `avoidRects keeps the shown Reset view clear: ${JSON.stringify(after.rects)} vs ${JSON.stringify(after.btn)}`);
  // and no isotach label is set under it, at 2x on this phone (the review's tour frame 26-jet--zoom2--phone had "kt" peeking out)
  const xfNow = await page.eval('__wse.renderer.getTransform()');
  let under = 0, nLab = 0;
  for (const t of [0, 24, 48, 72, 96, 120]) {
    await render({ t, lens: 'j', view: 'np', W: after.W, H: after.H, xf: xfNow });
    const boxes = await page.eval(`(() => { const c = document.createElement('canvas').getContext('2d'); return window.__fl.last.calls.filter((k) => k.k === 'text' && /kt$/.test(k.text)).map((k) => { c.font = k.font; const hw = c.measureText(k.text).width / 2 + 3, [a, b, , , e, f] = k.tf, ex = Math.abs(a) * hw + Math.abs(b) * 8, ey = Math.abs(b) * hw + Math.abs(a) * 8; return { x: e - ex, y: f - ey, w: 2 * ex, h: 2 * ey }; }); })()`);
    nLab += boxes.length;
    const bt = after.btn;
    under += boxes.filter((q) => q.x < bt.x + bt.w && q.x + q.w > bt.x && q.y < bt.y + bt.h && q.y + q.h > bt.y).length;
  }
  assert.ok(nLab > 0, `isotach labels are drawn at 2x (${nLab})`);
  assert.equal(under, 0, `no isotach label box overlaps Reset view (${under} of ${nLab})`);
  log(`map controls: Reset view ${JSON.stringify(after.btn)} held and avoided; ${nLab} isotach labels at 2x, ${under} under it`);
  await page.setViewport(1000, 700, 1);
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.data.getManifest() !== null', { timeout: 45000 });
  await page.eval(SETUP);

  // ---- Night: both lenses still draw (a probe: the jet fill is a Night colour, the label is there) ----
  const nightTexts = await render({ t: tC, lens: 'c', ground: 'night' });
  assert.ok(nightTexts.includes("one contour's worth of doubt"), 'the label is drawn on Night too');
  await render({ t: 0, lens: 'j', ground: 'night' });
  const nj = await windows('ws250', 1, 30.8, 34.2, 1);
  assert.ok(nj.length >= 3, 'Night has a 35 m/s area');
  const nightHex = await page.eval(`import('/js/render/palette.js').then((m) => m.bandRGBA('ws250', 35, 'night'))`);
  const nightExact = await exact(nj, 1, toHex(nightHex));
  assert.ok(nightExact >= nj.length * 0.8, `Night draws the Night table's first jet band ${toHex(nightHex)} (${nightExact} of ${nj.length})`);
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
}
