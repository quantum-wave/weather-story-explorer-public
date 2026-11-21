// S-LENS-C (W4-05, Josh point 15): the Storms and rain lens on RENDERED PIXELS and the real legend.
//   - Rain is filled in the ECMWF bands (REF-28, hex written out below, not read from the module): a pixel whose drawn value is
//     in the 2 to 5 mm band is #77f472; 0.05 mm is unfilled (the same pixel as with no lens drawn).
//   - The 0.1 mm edge can fall between grid nodes: the rain the map draws is stored to 0.01 mm, and most nodes just outside the
//     edge hold a value between 0 and 0.1 mm (at a 0.1 mm step they are all 0 and the edge draws as a staircase of grid cells).
//   - Isobar labels drawn are two digits (08, 96), never "1008"; there are several.
//   - H and L: the closed low of the fixture is marked L within 2 degrees of its centre; every mark sits inside the canvas; the L's ink
//     is on the canvas at its place; no mark lies where the sea-level field has no closed isobar (checked independently here).
//   - The legend names the rain, has the mm / in switch: a real click on "in" relabels the ticks in inches, the same twelve colours.
//   - The H and L are on top (W4-05 review 3): in the real app on the Hemisphere view, desktop 1440 and phone 390 at 2x, every
//     mark's letter and pressure value is replayed from the canvas calls the page made (a spy on fillText and strokeText) onto a
//     blank canvas, and every pixel the replay covers fully must be the same pixel on the map as shown, overlays included. An
//     isobar, coast or border through a letter or a digit ("004" for 1004), or the place label running into a value, fails it.
//   - The H and L on real weather (fixture 'recorded': the ECMWF run of 19 Nov 2026 00 UTC the product ships as its default sample; the
//     synthetic run has three to six tidy centres and shows none of this). Hemisphere at 24 h and 96 h and Regional at 24 h and 96 h,
//     desktop 1440 and phone 390: a bounded count (a handful of systems, not one per dimple of the grid), every mark with its value,
//     no two mark boxes within 4 px of each other, none within 4 px of the focus ring or its label (the place is also moved onto
//     each mark in turn), and the glyph replay above with no covered pixel.
// Known-positive mutants: M-lens-c-1 (mark every local minimum) must fail here and in wp15.lenses-c.test.mjs; M-lens-c-6 (the H
// and L drawn under the linework again) must fail here.
import * as inp from '../lib/input.mjs';

export const id = 'S-LENS-C';
export const freshProfile = false;
export const timeoutMs = 180000;
export const data = ['synthetic-15d', 'recorded'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SETUP = `(() => {
  if (window.__ft) return true;
  const ft = window.__ft = { scene: null, last: null, texts: [] };
  ft.render = async ({ lens = 's', ground = 'paper', t = 0, view = 'np', W = 1000, H = 600, overlays = { contours: false }, spy = false }) => {
    const { makeScene } = await import('/js/render/compose.js');
    ft.scene ||= makeScene();
    const bm = await import('/js/render/basemap.js');
    for (let i = 0; i < 100 && !bm.basemapData(); i++) await new Promise((r) => setTimeout(r, 50));
    await bm.basemapFull(); // the 50 m swap must not land while the basemap is set aside below, nor be undone by restoring an older one
    ft.geo = bm.basemapData();
    const d = window.__wse.data;
    await Promise.all(['tp6', 'msl'].flatMap((f) => ['np05', 'g1'].map((dm) => d.ensure(f, dm, t).catch(() => null))));
    bm.setBasemap(null);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ft.texts = [];
    if (spy) { const ft0 = ctx.fillText.bind(ctx); ctx.fillText = (txt, ...a) => { ft.texts.push(String(txt)); return ft0(txt, ...a); }; }
    const mv = ft.scene.viewFor(view, W, H);
    ft.scene.compose(ctx, mv, { s: { t, view, lens, ground, theme: 'light', overlays }, dpr: 1, quality: 'rest', alpha: 1, force: true });
    ft.last = { ctx, mv, W, H };
    bm.setBasemap(ft.geo);
    return true;
  };
  ft.px = (x, y) => Array.from(ft.last.ctx.getImageData(x, y, 1, 1).data);
  return true;
})()`;

// Records the text the page draws on any canvas (the frame is composed on an offscreen canvas, then shown) with the state that
// draws it, and checks each H and L the last frame placed against the canvas on screen (CSS px x dpr = device px).
const SPY = `(() => {
  if (window.__mk) return true;
  const mk = window.__mk = { on: false, recs: [] };
  const keep = /^(H|L|\\d{3,4})$/;
  for (const P of [window.CanvasRenderingContext2D, window.OffscreenCanvasRenderingContext2D].filter(Boolean).map((C) => C.prototype)) {
    for (const op of ['fillText', 'strokeText']) {
      const orig = P[op];
      P[op] = function (text, x, y, ...rest) {
        if (mk.on && keep.test(String(text))) {
          const t = this.getTransform();
          mk.recs.push({ op, text: String(text), x, y, font: this.font, fill: this.fillStyle, stroke: this.strokeStyle, lw: this.lineWidth,
            align: this.textAlign, base: this.textBaseline, lj: this.lineJoin, ml: this.miterLimit, ls: this.letterSpacing, fvn: this.fontVariantNumeric,
            alpha: this.globalAlpha, tr: [t.a, t.b, t.c, t.d, t.e, t.f] });
        }
        return orig.call(this, text, x, y, ...rest);
      };
    }
  }
  const replay = (recs, W, H) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    for (const r of recs) {
      g.setTransform(...r.tr); g.font = r.font; g.textAlign = r.align; g.textBaseline = r.base; g.lineJoin = r.lj; g.miterLimit = r.ml; g.globalAlpha = r.alpha;
      if ('letterSpacing' in g && r.ls) g.letterSpacing = r.ls;
      if ('fontVariantNumeric' in g && r.fvn) { try { g.fontVariantNumeric = r.fvn; } catch {} }
      if (r.op === 'strokeText') { g.lineWidth = r.lw; g.strokeStyle = r.stroke; g.strokeText(r.text, r.x, r.y); } else { g.fillStyle = r.fill; g.fillText(r.text, r.x, r.y); }
    }
    return g.getImageData(0, 0, W, H).data;
  };
  mk.check = async () => {
    const s = await import('/js/lenses/surface.js'), cv = document.getElementById('map'), W = cv.width, H = cv.height;
    const shown = cv.getContext('2d').getImageData(0, 0, W, H).data;
    // the last stroke and the last fill of a text near a point: the frame on screen is the last one composed
    const last = (text, near, r) => {
      const out = [];
      for (const op of ['strokeText', 'fillText']) {
        for (let i = mk.recs.length - 1; i >= 0; i--) { const q = mk.recs[i]; if (q.op === op && q.text === text && Math.hypot(q.x - near[0], q.y - near[1]) <= r) { out.push([i, q]); break; } }
      }
      return out.sort((a, b) => a[0] - b[0]).map(([, q]) => q);
    };
    const compare = (recs) => {
      if (!recs.length) return { covered: 0, wrong: 0, sample: [] };
      const rp = replay(recs, W, H);
      let covered = 0, wrong = 0; const sample = [];
      for (let k = 0; k < rp.length; k += 4) {
        if (rp[k + 3] !== 255) continue;
        covered++;
        if (Math.abs(rp[k] - shown[k]) > 10 || Math.abs(rp[k + 1] - shown[k + 1]) > 10 || Math.abs(rp[k + 2] - shown[k + 2]) > 10) {
          wrong++; if (sample.length < 4) { const p = k / 4; sample.push({ at: [p % W, Math.floor(p / W)], want: [rp[k], rp[k + 1], rp[k + 2]], got: [shown[k], shown[k + 1], shown[k + 2]] }); }
        }
      }
      return { covered, wrong, sample };
    };
    const f = window.__wse.store.get().focus;
    const marks = s.lastDrawn().map((m) => {
      const hpa = String(Math.round(m.value / 100));
      const L = last(m.kind, [m.x, m.y], 0.5), V = last(hpa, [m.x, m.y], 40);
      return { kind: m.kind, hpa, x: Math.round(m.x), y: Math.round(m.y), letter: compare(L), value: { found: V.length > 0, ...compare(V) } };
    });
    return { marks, focus: f ? f.label : null };
  };
  return true;
})()`;

const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
const toHex = (c) => '#' + c.slice(0, 3).map(hex2).join('');
// REF-28 written out (mm lower edge -> hex), independent of palette.js
const REF28 = [[0.1, '#efdbb7'], [1, '#b5f9aa'], [2, '#77f472'], [5, '#b5eff9'], [10, '#77baf9'], [15, '#3d96f4'], [20, '#1e6ded'], [30, '#ffe877'], [40, '#ffa000'], [50, '#ff0000'], [100, '#a32121'], [300, '#ff00ff']];
const bandOf = (mm) => { let h = null; for (const [lo, c] of REF28) if (mm >= lo) h = c; return h; };

export async function run(ctx) { return ctx.fixture === 'recorded' ? runRecorded(ctx) : runSynthetic(ctx); }

async function runSynthetic({ page, baseUrl, assert }) {
  await page.setViewport(1440, 900, 1);
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 45000 });
  await page.waitFor('window.__wse.data.getManifest() !== null', { timeout: 15000 });
  await page.eval(SETUP);

  // ---- the lens is listed and drawable on this run ----
  const reg = await page.eval(`import('/js/lenses/index.js').then((m) => ({ listed: m.listed().map((l) => l.id), ok: m.lens('s').available(window.__wse.data.getManifest()) }))`);
  assert.ok(reg.listed.includes('surface'), `surface is listed: ${reg.listed}`); assert.deepEqual(reg.ok, { ok: true });

  // ---- rain pixels: the REF-28 hex where the drawn value is in a band, nothing at 0.05 mm ----
  // read the drawn value at a pixel from the same field the map draws (tp6 on g1, bilinear), at a step that has rain
  const STEP = await page.eval(`(async () => { const d = window.__wse.data; let best = null;
    for (const t of d.fieldSteps('tp6').filter((x) => x <= 120)) { await d.ensure('tp6', 'g1', t); const a = d.fieldAt('tp6', 'g1', t); let mx = 0; for (let i = 0; i < a.length; i++) if (a[i] > mx) mx = a[i]; if (!best || mx > best.mx) best = { t, mx }; }
    return best; })()`);
  assert.ok(STEP && STEP.mx > 2, `the fixture has rain to read (max ${STEP && STEP.mx} mm)`);
  const edge = await page.eval(`(() => { const d = window.__wse.data, m = d.getManifest(), dom = m.domains.g1, a = d.fieldAt('tp6', 'g1', ${STEP.t});
    let outside = 0, resolved = 0;
    for (let j = 1; j < dom.ny - 1; j++) for (let i = 1; i < dom.nx - 1; i++) { const v = a[j * dom.nx + i]; if (!(v < 0.1)) continue;
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => a[(j + dj) * dom.nx + i + di] >= 0.1)) continue; outside++; if (v > 0) resolved++; }
    return { scale: m.fields.tp6.scale, outside, resolved }; })()`);
  assert.ok(edge.scale <= 0.01, `the rain is stored to 0.01 mm or finer (scale ${edge.scale})`);
  assert.ok(edge.outside >= 20 && edge.resolved / edge.outside >= 0.5, `the 0.1 mm edge falls between nodes: ${edge.resolved} of ${edge.outside} nodes just outside it hold 0-0.1 mm`);
  console.log(`  0.1 mm edge at ${STEP.t} h: ${edge.resolved} of ${edge.outside} nodes just outside it hold a value between 0 and 0.1 mm (scale ${edge.scale})`);
  await page.eval(`window.__ft.render({ lens: null, t: ${STEP.t} })`);
  const ground = await page.eval(`(() => { const o = []; for (let y = 10; y < 590; y += 10) for (let x = 10; x < 990; x += 10) o.push(window.__ft.px(x, y)); return o; })()`);
  await page.eval(`window.__ft.render({ lens: 's', t: ${STEP.t} })`);
  const probe = await page.eval(`(async () => {
    const d = window.__wse.data, g = await import('/js/data/grid.js'), mv = window.__ft.last.mv, dom = d.getManifest().domains.g1, a = d.fieldAt('tp6', 'g1', ${STEP.t});
    const val = (x, y) => { const ll = mv.invert([x + 0.5, y + 0.5]), q = ll && g.toGrid(dom, ll[0], ll[1]); return q ? g.bilinear(a, dom, q[0], q[1], NaN) : NaN; };
    const win = (x, y, r, f) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!f(val(x + dx, y + dy))) return false; return true; };
    const out = { band: null, dry: null, values: [] };
    for (let y = 12; y < 588; y += 3) for (let x = 12; x < 988; x += 3) {
      const v = val(x, y);
      if (!out.band && v >= 2.4 && v <= 4.6 && win(x, y, 3, (q) => q >= 2.2 && q < 4.9)) out.band = { x, y, v, px: window.__ft.px(x, y) };
      if (!out.dry && v >= 0.04 && v <= 0.06 && win(x, y, 1, (q) => q > 0.03 && q < 0.09)) out.dry = { x, y, v, px: window.__ft.px(x, y) };
    }
    return out;
  })()`);
  assert.ok(probe.band, 'a pixel drawn at 2 to 5 mm exists');
  assert.equal(toHex(probe.band.px), bandOf(2.5), `${probe.band.v.toFixed(2)} mm drawn as ${toHex(probe.band.px)}; REF-28 says ${bandOf(2.5)}`);
  console.log(`  rain at step ${STEP.t} h (max ${STEP.mx.toFixed(1)} mm): ${probe.band.v.toFixed(2)} mm at (${probe.band.x}, ${probe.band.y}) is ${toHex(probe.band.px)}`);
  assert.ok(probe.dry, 'a pixel drawn at about 0.05 mm exists (the edge of the rain)');
  const nearGround = (px) => ground.some((g) => g.slice(0, 3).every((v, i) => Math.abs(v - px[i]) <= 1));
  assert.ok(nearGround(probe.dry.px), `0.05 mm (${probe.dry.v.toFixed(3)}) is unfilled: pixel ${toHex(probe.dry.px)} is a ground colour`);
  assert.ok(!REF28.some(([, c]) => c === toHex(probe.dry.px)), `0.05 mm is not any rain colour (${toHex(probe.dry.px)})`);
  console.log(`  0.05 mm at (${probe.dry.x}, ${probe.dry.y}): ${probe.dry.v.toFixed(3)} mm drawn, pixel ${toHex(probe.dry.px)} (ground)`);

  // ---- isobar labels (two digits) and the H and L ----
  await page.eval(`window.__ft.render({ lens: 's', t: 0, view: 'np', overlays: { contours: true }, spy: true })`);
  const out = await page.eval(`(async () => { const s = await import('/js/lenses/surface.js'); return { texts: window.__ft.texts, marks: s.lastDrawn(), labelCount: window.__ft.scene.stats.labelCount }; })()`);
  const markP = new Set(out.marks.map((m) => String(Math.round(m.value / 100))));
  const labels = out.texts.filter((t) => /^\d+$/.test(t) && !markP.has(t));
  assert.ok(labels.length >= 3, `several isobar labels are drawn (${labels.length}): ${labels}`);
  assert.ok(labels.every((t) => /^\d\d$/.test(t)), `every isobar label is two digits: ${labels}`);
  console.log(`  isobar labels at 0 h: ${labels.join(' ')}; marks: ${out.marks.map((m) => `${m.kind} ${Math.round(m.value / 100)} hPa at ${m.lat}, ${m.lon}`).join('; ')}`);
  const low = out.marks.filter((m) => m.kind === 'L' && Math.abs(m.lat - 50) <= 2 && Math.abs(m.lon + 140) <= 2);
  assert.equal(low.length, 1, `the fixture's closed low (50N 140W) is marked L within 2 degrees: ${JSON.stringify(out.marks)}`);
  const m0 = low[0];
  assert.ok(m0.x > 0 && m0.y > 0 && m0.x < 1000 && m0.y < 600, 'the L is on the canvas');
  const inked = await page.eval(`(() => { let n = 0; for (let dy = -10; dy <= 10; dy++) for (let dx = -8; dx <= 8; dx++) { const p = window.__ft.px(${Math.round(m0.x)} + dx, ${Math.round(m0.y)} + dy); if (Math.abs(p[0] - 0xB3) <= 4 && Math.abs(p[1] - 0x26) <= 4 && Math.abs(p[2] - 0x1E) <= 4) n++; } return n; })()`);
  assert.ok(inked >= 12, `the L letter's ink (#b3261e) is on the canvas at its place: ${inked} px`);
  // every mark is at a closed isobar: the fixture has one low and (at most) the highs of its wave; at 72 h the same
  assert.ok(out.marks.length <= 6, `a handful of marks, not one per local minimum: ${out.marks.length}`);
  await page.eval(`window.__ft.render({ lens: 'z', t: 0, view: 'np', overlays: { contours: true } })`);
  const stray = await page.eval(`(() => { let n = 0; for (let dy = -10; dy <= 10; dy++) for (let dx = -8; dx <= 8; dx++) { const p = window.__ft.px(${Math.round(m0.x)} + dx, ${Math.round(m0.y)} + dy); if (Math.abs(p[0] - 0xB3) <= 4 && Math.abs(p[1] - 0x26) <= 4 && Math.abs(p[2] - 0x1E) <= 4) n++; } return n; })()`);
  assert.equal(stray, 0, 'no L ink where the L stood on another lens');

  // ---- the legend and the mm / in switch, by real clicks ----
  await page.eval(`window.__wse.store.set({ lens: 's', ground: 'paper' })`);
  await page.waitFor(`document.querySelector('#map-legend .mlg-title')?.textContent === 'Rain in 6 hours'`, { timeout: 5000 });
  if (await page.eval(`document.querySelector('#map-legend').dataset.collapsed === 'true'`)) { await inp.click(page, '#map-legend .mlg-toggle'); await sleep(250); }
  const mmTicks = await page.eval(`[...document.querySelectorAll('#map-legend .mlg-tick')].map((e) => e.textContent)`);
  assert.deepEqual(mmTicks, ['0.1', '1', '2', '5', '10', '15', '20', '30', '40', '50', '100', '300']);
  const stops = await page.eval(`[...document.querySelectorAll('#map-legend .mlg-stop')].map((e) => e.dataset.hex)`);
  assert.deepEqual(stops, REF28.map(([, c]) => c), 'the legend bar is the twelve REF-28 colours');
  assert.equal(await page.eval(`document.querySelector('#map-legend .mlg-unit-name').textContent`), 'mm');
  await inp.click(page, '#map-legend .mlg-unit-btn[data-units="us"]');
  await page.waitFor(`document.querySelector('#map-legend .mlg-unit-name')?.textContent === 'in'`, { timeout: 5000 });
  const inTicks = await page.eval(`[...document.querySelectorAll('#map-legend .mlg-tick')].map((e) => e.textContent)`);
  assert.deepEqual(inTicks, ['0.004', '0.039', '0.079', '0.2', '0.39', '0.59', '0.79', '1.2', '1.6', '2', '3.9', '12']);
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('#map-legend .mlg-stop')].map((e) => e.dataset.hex)`), stops, 'same colours in inches');
  assert.equal(await page.eval(`document.querySelector('#map-legend .mlg-unit-btn[data-units="us"]').getAttribute('aria-pressed')`), 'true');
  // no two tick labels touch, every pair, in mm and in inches (the labels alternate rows, so neighbours never share a row: the
  // real risk is the label two places along on the same row). Desktop here, the 390 px phone below.
  const noTouch = async (where) => {
    for (const u of ['metric', 'us']) {
      await page.eval(`window.__wse.store.set({ units: '${u}' })`);
      await page.waitFor(`document.querySelector('#map-legend .mlg-unit-name')?.textContent === '${u === 'us' ? 'in' : 'mm'}'`, { timeout: 5000 });
      const bx = await page.eval(`(() => { const lg = document.querySelector('#map-legend').getBoundingClientRect();
        return { lg: [lg.left, lg.right], t: [...document.querySelectorAll('#map-legend .mlg-tick')].map((e) => { const r = e.getBoundingClientRect(); return { text: e.textContent, l: r.left, r: r.right, t: r.top, b: r.bottom }; }) }; })()`);
      assert.equal(bx.t.length, 12, `${where} ${u}: twelve tick labels`);
      let worst = Infinity;
      for (let i = 0; i < bx.t.length; i++) {
        const a = bx.t[i];
        assert.ok(a.l >= bx.lg[0] && a.r <= bx.lg[1], `${where} ${u}: label ${a.text} lies inside the legend card ${JSON.stringify([a, bx.lg])}`);
        for (let j = i + 1; j < bx.t.length; j++) {
          const b = bx.t[j], overlap = a.r > b.l && b.r > a.l && a.b > b.t && b.b > a.t;
          assert.ok(!overlap, `${where} ${u}: tick labels ${a.text} and ${b.text} overlap: ${JSON.stringify([a, b])}`);
          if (a.t === b.t) worst = Math.min(worst, Math.max(b.l - a.r, a.l - b.r)); // the gap between two labels on one row
        }
      }
      assert.ok(worst >= 4, `${where} ${u}: labels on one row keep a gap of at least 4 px (narrowest ${worst.toFixed(1)} px)`);
      console.log(`  ${where} ${u}: all 66 label pairs clear; narrowest same-row gap ${worst.toFixed(1)} px`);
    }
  };
  await noTouch('desktop');
  // the unit buttons are touch targets on a touch layout: 44 x 44 at phone width
  await page.setViewport(390, 844, 2);
  await sleep(500);
  await page.eval(`window.__wse.store.set({ units: 'metric' })`);
  if (await page.eval(`document.querySelector('#map-legend').dataset.collapsed === 'true'`)) { await inp.click(page, '#map-legend .mlg-toggle'); await sleep(300); }
  await noTouch('phone 390');
  const btn = await page.eval(`[...document.querySelectorAll('#map-legend .mlg-unit-btn')].map((e) => { const r = e.getBoundingClientRect(); return [e.textContent, r.width, r.height]; })`);
  for (const [t, w, h] of btn) assert.ok(w >= 44 && h >= 44, `phone: the "${t}" button is at least 44 x 44 (${w} x ${h})`);
  await page.setViewport(1440, 900, 1);
  await sleep(500);
  await page.eval(`window.__wse.store.set({ units: 'metric' })`);
  await page.eval(`window.__wse.store.set({ units: 'us' })`);
  const rd = await page.eval(`import('/js/lenses/index.js').then((m) => m.lens('s').describe(0.8, { units: window.__wse.store.get().units }))`);
  assert.match(rd, /^0\.03 in in 6 h/, `the readout follows the switch: ${rd}`);
  await inp.click(page, '#map-legend .mlg-unit-btn[data-units="metric"]');
  await page.waitFor(`document.querySelector('#map-legend .mlg-unit-name')?.textContent === 'mm'`, { timeout: 5000 });

  // ---- the H and L sit over every line: replay each mark's glyphs and compare with the map as shown ----
  await page.eval(SPY);
  // the legend folded, as a first visit shows it (the inches section above left it open over the bottom of the map)
  if (await page.eval(`document.querySelector('#map-legend')?.dataset.collapsed !== 'true'`)) { await inp.click(page, '#map-legend .mlg-toggle'); await sleep(300); }
  for (const [where, w, h, dpr] of [['desktop 1440', 1440, 900, 1], ['phone 390', 390, 844, 2]]) {
    await page.eval(`(() => { window.__mk.recs.length = 0; window.__mk.on = true; return true; })()`); // record from before the resize redraws
    await page.setViewport(w, h, dpr);
    await sleep(400);
    await page.eval(`(() => { window.__wse.store.set({ lens: 's', ground: 'paper', theme: 'light', t: 30, view: 'nh', units: 'metric', playing: false }); return true; })()`);
    await page.waitFor(`__wse.store.get().view === 'nh'`, { timeout: 5000 });
    await page.waitFor(`(async () => { const b = await import('/js/render/basemap.js'); return b.basemapTier && b.basemapTier() === 2; })()`, { timeout: 15000 }); // the 50 m coast and borders
    await sleep(2500); // the view tween, the sliced rest raster and its last compose
    const res = await page.eval(`window.__mk.check()`);
    await page.eval(`(() => { window.__mk.on = false; return true; })()`);
    assert.ok(res.marks.length >= 5, `${where}: the Hemisphere at 30 h has its highs and lows marked (${res.marks.length})`);
    assert.ok(res.marks.some((mk) => mk.kind === 'L' && mk.hpa === '985'), `${where}: the deep 985 hPa low inside its own tight rings is marked`);
    for (const mk of res.marks) {
      const name = `${where}: ${mk.kind} ${mk.hpa} hPa at (${mk.x}, ${mk.y})`;
      assert.ok(mk.letter.covered >= 40, `${name}: its letter is drawn (${mk.letter.covered} solid px)`);
      assert.ok(mk.value.found, `${name}: its value ${mk.hpa} is drawn`);
      assert.ok(mk.value.covered >= 40, `${name}: its value is drawn (${mk.value.covered} solid px)`);
      assert.equal(mk.letter.wrong, 0, `${name}: ${mk.letter.wrong} of the letter's ${mk.letter.covered} solid px are covered by other ink (${JSON.stringify(mk.letter.sample)})`);
      assert.equal(mk.value.wrong, 0, `${name}: ${mk.value.wrong} of the value's ${mk.value.covered} solid px are covered by other ink (${JSON.stringify(mk.value.sample)})`);
    }
    console.log(`  ${where} Hemisphere, focus ${res.focus}: ${res.marks.map((mk) => `${mk.kind} ${mk.hpa} (${mk.letter.covered}+${mk.value.covered} px, ${mk.letter.wrong + mk.value.wrong} covered)`).join('; ')}`);
  }
  await page.setViewport(1440, 900, 1);
  await sleep(300);
  assert.deepEqual(page.errors(), [], JSON.stringify(page.errors()));
}

// ---- the recorded ECMWF run: the H and L of real weather ----
// Bounds measured on this run at the four views below (the least and the most across 24 h and 96 h): Hemisphere 7 to 11 marks, Regional
// 1 to 4 (HEMI_MAX and REGIONAL_MAX). With no significance filter the same frames draw 44 and 18 (the 2026-11-19 review).
const HEMI_MAX = 13, REGIONAL_MAX = 8;
const SLACK = 4; // px: Josh's 2026-11-19 ruling, room for the wider glyph metrics of a Linux browser

const hitS = (a, b, k = 0) => a.x - k < b.x + b.w && b.x - k < a.x + a.w && a.y - k < b.y + b.h && b.y - k < a.y + a.h;

const MARKS = `(async () => {
  const s = await import('/js/lenses/surface.js'), st = window.__wse.store.get(), f = st.focus;
  const marks = s.lastDrawn().map((m) => ({ kind: m.kind, lon: m.lon, lat: m.lat, hpa: String(Math.round(m.value / 100)), text: m.text, x: m.x, y: m.y, boxes: m.boxes }));
  let focus = null;
  if (f && Number.isFinite(f.lon)) {
    const p = window.__wse.renderer.project([f.lon, f.lat]);
    if (p) {
      const c = document.createElement('canvas').getContext('2d'); c.font = '600 13px -apple-system, "SF Pro Text", system-ui, sans-serif';
      const w = f.label ? c.measureText(f.label).width : 0;
      // the ring (11 px round the place) and the label (starts 17 px right, 13 px type with a 2 px halo each side): measured here, not read from surface.js
      focus = { label: f.label || '', boxes: [{ x: p[0] - 11, y: p[1] - 11, w: 22, h: 22 }, ...(f.label ? [{ x: p[0] + 15, y: p[1] - 9, w: w + 4, h: 18 }] : [])] };
    }
  }
  return { marks, focus, view: st.view, t: st.t };
})()`;

/** What is wrong with a set of marks: pairs within SLACK of each other, and boxes within SLACK of the focus ring or label. */
function offences(res) {
  const bad = [];
  const all = res.marks.flatMap((m, i) => m.boxes.map((b, k) => ({ ...b, i, what: `${m.kind}${m.hpa} ${k ? 'value' : 'letter'}` })));
  for (let p = 0; p < all.length; p++) {
    for (let q = p + 1; q < all.length; q++) {
      if (all[p].i !== all[q].i && hitS(all[p], all[q], SLACK)) bad.push(`${all[p].what} and ${all[q].what} are within ${SLACK} px`);
    }
  }
  for (const b of all) for (const fb of res.focus?.boxes || []) if (hitS(b, fb, SLACK)) bad.push(`${b.what} is within ${SLACK} px of the focus ring or its label "${res.focus.label}"`);
  return bad;
}

async function runRecorded({ page, baseUrl, assert }) {
  await page.setViewport(1440, 900, 1);
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 45000 });
  await page.waitFor('window.__wse.data.getManifest() !== null', { timeout: 15000 });
  assert.equal(await page.eval(`window.__wse.data.getManifest().model`), 'ECMWF IFS HRES', 'the recorded run is the ECMWF forecast the product ships');
  await page.eval(SPY);
  const settle = async (view, t) => {
    await page.eval(`(() => { window.__wse.store.set({ lens: 's', ground: 'paper', theme: 'light', t: ${t}, view: '${view}', units: 'metric', playing: false }); return true; })()`);
    await page.waitFor(`__wse.store.get().view === '${view}' && __wse.store.get().t === ${t}`, { timeout: 5000 });
    await page.waitFor(`(async () => { const b = await import('/js/render/basemap.js'); return b.basemapTier && b.basemapTier() === 2; })()`, { timeout: 15000 });
    await page.waitFor(`(async () => { const d = window.__wse.data; await d.ensure('msl', '${view === 'np' ? 'np05' : 'g1'}', ${t}).catch(() => {}); return true; })()`, { timeout: 15000 });
    await sleep(2500); // the view tween, the sliced rest raster and its last compose
  };
  const seen = [];
  for (const [where, w, h, dpr] of [['desktop 1440', 1440, 900, 1], ['phone 390', 390, 844, 2]]) {
    await page.setViewport(w, h, dpr);
    await sleep(500);
    if (await page.eval(`document.querySelector('#map-legend')?.dataset.collapsed !== 'true'`)) { await inp.click(page, '#map-legend .mlg-toggle'); await sleep(300); }
    for (const [view, t] of [['nh', 24], ['nh', 96], ['np', 24], ['np', 96]]) {
      const name = `${where} ${view === 'nh' ? 'Hemisphere' : 'Regional'} ${t} h`;
      await page.eval(`(() => { window.__mk.recs.length = 0; window.__mk.on = true; return true; })()`);
      await settle(view, t);
      const res = await page.eval(MARKS);
      const glyphs = await page.eval(`window.__mk.check()`);
      await page.eval(`(() => { window.__mk.on = false; return true; })()`);
      assert.equal(res.view, view);
      const max = view === 'nh' ? HEMI_MAX : REGIONAL_MAX;
      assert.ok(res.marks.length >= (view === 'nh' ? 4 : 1), `${name}: the run's pressure systems are marked (${res.marks.length})`);
      assert.ok(res.marks.length <= max, `${name}: a handful of systems, at most ${max}, not one per dimple of the grid (${res.marks.length}: ${res.marks.map((m) => m.kind + m.hpa).join(' ')})`);
      assert.deepEqual(res.marks.filter((m) => !m.text), [], `${name}: every letter is shown with its pressure`);
      const bad = offences(res);
      assert.deepEqual(bad, [], `${name}: marks keep ${SLACK} px clear of each other and of the focus place: ${bad.join('; ')}`);
      for (const mk of glyphs.marks) {
        const nm = `${name}: ${mk.kind} ${mk.hpa} at (${mk.x}, ${mk.y})`;
        assert.ok(mk.letter.covered >= 40 && mk.value.covered >= 40, `${nm}: letter and value are drawn (${mk.letter.covered} + ${mk.value.covered} solid px)`);
        assert.equal(mk.letter.wrong + mk.value.wrong, 0, `${nm}: other ink covers its glyphs (${JSON.stringify([mk.letter.sample, mk.value.sample])})`);
      }
      // the place moved onto each mark in turn: its ring and label never touch any mark, whichever one has to give way
      const order = res.marks.map((m) => [m.lon, m.lat, m.kind + m.hpa]);
      for (const [lon, lat, nmk] of order.slice(0, 4)) {
        await page.eval(`(() => { window.__wse.store.set({ focus: { ...window.__wse.store.get().focus, lon: ${lon}, lat: ${lat}, label: 'Test Place, XX' } }); return true; })()`);
        await sleep(2500);
        const moved = await page.eval(MARKS), badMoved = offences(moved);
        assert.deepEqual(badMoved, [], `${name}, place on ${nmk}: ${badMoved.join('; ')}`);
        assert.ok(moved.marks.length <= max, `${name}, place on ${nmk}: still at most ${max} marks (${moved.marks.length})`);
      }
      await page.eval(`(() => { window.__wse.store.set({ focus: { ...window.__wse.store.get().focus, lon: -122.4194, lat: 37.7749, label: 'San Francisco' } }); return true; })()`);
      seen.push(`${name}: ${res.marks.length} marks (${res.marks.map((m) => m.kind + m.hpa).join(' ')})`);
      console.log('  ' + seen[seen.length - 1]);
    }
  }
  await page.setViewport(1440, 900, 1);
  await sleep(300);
  assert.deepEqual(page.errors(), [], JSON.stringify(page.errors()));
}
