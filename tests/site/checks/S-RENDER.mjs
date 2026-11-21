// S-RENDER: the lenses, themes and renderTo draw real, plausible pixels (screenshots and canvas read-back); and the
// W3-01 field renderer does what DESIGN-SPEC 4.2 and 4.3 say, measured on pixels a real compose() drew:
//   synthetic-15d:        the doubt hatch (locked on beyond 168 h, pixels between its lines equal the band hex), the hairlines on
//                         every fifth edge on both grounds, no straight field edge in Regional (the g1 underlay and the 3 degree
//                         feather), labelled upright haloed contours kept out from under the legend and the map tools, contours
//                         recomputed at most 10 times a second while playing, the 1.5 MP raster cap, 12 ms slices, cancellation,
//                         and scene.stats.bytes under 48 MB after 20 pans at 390 x 844 @2;
//   synthetic-hires-48h:  the band-edge staircase on a circular anomaly at 8x never more than 1 raster px from the circle
//                         (an injected unrounded analytic field; the whole-metre fixture is held to 2 px).
import { mount, shoot, stats, meanChroma } from '../wp2/shot.mjs';

export const id = 'S-RENDER';
export const tier = 'deploy'; // fast, offline, about data honesty: the data and Pages workflows run it
export const freshProfile = false;
export const timeoutMs = 240000;
export const data = ['synthetic', 'synthetic-15d', 'synthetic-hires-48h'];
const DARK = [12, 16, 20], LIGHT = [249, 246, 242];

async function runBase({ page, baseUrl, assert }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 45000 });
  const m = await page.eval('window.__wse.data.getManifest()');
  const stepOf = (f) => m.fields[f].steps[Math.min(1, m.fields[f].steps.length - 1)];
  const W = 1000, H = 600, top = [0, 0, W, 360];
  await mount(page, { width: W, height: H });

  // light theme: same field, pale palette on the light ground
  let img = await shoot(page, { view: 'np', lens: 'z', theme: 'light', t: stepOf('z500a') }, 'render-light');
  let s = stats(img, top, LIGHT);
  assert.ok(s.tinted > 0.04 && s.std > 6, `light theme: tint ${(s.tinted * 100).toFixed(1)}%, spread ${s.std.toFixed(1)}`);
  // Paper: where no band is drawn the ground is light (the field now also runs under the whole frame, so the corner may be a band)
  const lightShare = (() => { let n = 0, l = 0; for (let y = 0; y < 360; y++) for (let x = 0; x < W; x++) { const i = (y * img.w + x) * img.ch; n++; if (img.px[i] > 225 && img.px[i + 1] > 200) l++; } return l / n; })();
  assert.ok(lightShare > 0.2, `light theme draws on the light Paper ground: ${(lightShare * 100).toFixed(0)}% of pixels are light`);

  // jet lens (its field is in case B of the sample, case A of the synthetic fixture: choosing the lens shows that case)
  img = await shoot(page, { view: 'np', lens: 'j', theme: 'dark', t: stepOf('ws250') }, 'render-jet');
  const green = (() => { let n = 0, g = 0; for (let y = 0; y < 360; y++) for (let x = 0; x < W; x++) { const i = (y * img.w + x) * img.ch; n++; if (img.px[i + 1] > 150 && img.px[i + 2] < 90) g++; } return g / n; })();
  assert.ok(green > 0.003, `jet draws ECMWF's yellow-green bands: ${(green * 100).toFixed(2)}% of pixels`);

  // no confidence fade: a band's colour does not depend on the spread, so late-lead colours are as saturated as early ones
  const sp = await page.eval('window.__wp2.data.sampleDomainSpread() && Array.from(window.__wp2.data.sampleDomainSpread().values)');
  if (sp && Math.max(...sp) / 10 > 4 && sp[0] / 10 < 3) {
    const steps = m.fields.z500a.steps, early = steps[0], late = steps[steps.length - 1];
    await page.eval('window.__wp2.data.ensureAll("z500sd", "np05")');
    const a = await shoot(page, { view: 'np', lens: 'z', theme: 'dark', t: early });
    const b = await shoot(page, { view: 'np', lens: 'z', theme: 'dark', t: late });
    const ca = meanChroma(a, top), cb = meanChroma(b, top);
    assert.ok(cb > ca * 0.9, `colour does not fade with spread: chroma ${ca.toFixed(1)} -> ${cb.toFixed(1)}`);
  }

  // renderTo: an export-sized frame into a plain canvas, with a fillText spy and an overlay
  const out = await page.eval(`(async () => {
    const w = window.__wp2; await w.renderer.ensureFor({ t: ${stepOf('z500a')}, lens: 'z' });
    const cv = document.createElement('canvas'); cv.width = 540; cv.height = 675;
    const c = cv.getContext('2d'), texts = [];
    const ft = c.fillText.bind(c); c.fillText = (t, ...r) => { texts.push(String(t)); return ft(t, ...r); };
    let overlayCalls = 0;
    const r = w.renderer.renderTo(c, { width: 540, height: 675, t: ${stepOf('z500a')}, view: 'np', lens: 'z', theme: 'dark',
      centre: { lat: 37.77, lon: -122.42, zoom: 2 }, overlays: [(ctx, project, st) => { overlayCalls++; const q = project([-122.42, 37.77]); ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(q[0], q[1], 12, 0, 7); ctx.stroke(); }] });
    const d = c.getImageData(0, 0, 540, 675).data; let tinted = 0, drawn = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 0) drawn++; const r1 = d[i], b1 = d[i + 2]; if (Math.abs(r1 - b1) > 22) tinted++; }
    // The synthetic grid is coarse (about 4.6 degrees), so the tight portrait framing (22-60N, W3-03) leaves too few segments per
    // cell to place a label: the label check renders the landscape Regional frame instead.
    const cv2 = document.createElement('canvas'); cv2.width = 1000; cv2.height = 600;
    const c2 = cv2.getContext('2d'), texts2 = []; const ft2 = c2.fillText.bind(c2); c2.fillText = (t, ...r) => { texts2.push(String(t)); return ft2(t, ...r); };
    w.renderer.renderTo(c2, { width: 1000, height: 600, t: ${stepOf('z500a')}, view: 'np', lens: 'z', theme: 'dark' });
    return { texts: texts.concat(texts2), overlayCalls, sf: r.project([-122.42, 37.77]), back: r.invert([270, 337]), tinted: tinted / (540 * 675), drawn: drawn / (540 * 675) };
  })()`);
  assert.equal(out.overlayCalls, 1);
  assert.ok(out.drawn > 0.99, 'renderTo paints every pixel');
  assert.ok(out.tinted > 0.05, `renderTo shows the anomaly field: ${(out.tinted * 100).toFixed(1)}%`);
  assert.ok(Math.abs(out.sf[0] - 270) < 1 && Math.abs(out.sf[1] - 337.5) < 1, `centre puts SF mid-frame: ${out.sf}`);
  assert.ok(out.texts.some((t) => /^\d{3}$/.test(t)), `contour labels are drawn text: ${out.texts.slice(0, 5)}`);
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
}

// ---------------------------------------------------------------------------------------------------------------------
// W3-01: the field renderer, measured on pixels the real compose() drew into a canvas (no basemap, so the field stands alone).
const SETUP = `(() => {
  if (window.__fr) return true;
  const fr = window.__fr = { scene: null, last: null, geo: null };
  fr.px = (x, y) => Array.from(fr.last.ctx.getImageData(x, y, 1, 1).data);
  fr.render = async (o = {}) => {
    const { ground = 'paper', t = 0, view = 'np', W = 1000, H = 600, dpr = 1, lens = 'z', overlays = { contours: false, marks: false }, xf, quality = 'rest', sliceMs, playing = false, scene, hideGeo = true, avoid, force = true, fields = ['z500a', 'z500sd', 'z500'] } = o;
    const { makeScene } = await import('/js/render/compose.js');
    const sc = scene || (fr.scene ||= makeScene());
    const bm = await import('/js/render/basemap.js');
    for (let i = 0; i < 100 && !bm.basemapData(); i++) await new Promise((r) => setTimeout(r, 50));
    fr.geo ||= bm.basemapData();
    const d = window.__wse.data;
    await Promise.all(fields.flatMap((f) => ['np05', 'g1'].map((dm) => d.ensure(f, dm, t))));
    if (hideGeo) bm.setBasemap(null);
    const cv = document.createElement('canvas'); cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.scale(dpr, dpr);
    const mv = sc.viewFor(view, W, H, xf);
    const res = sc.compose(ctx, mv, { s: { t, view, lens, ground, theme: ground === 'night' ? 'dark' : 'light', overlays, playing }, dpr, quality, alpha: 1, force, sliceMs, avoid });
    if (hideGeo) bm.setBasemap(fr.geo);
    fr.last = { ctx, mv, W, H, dpr, scene: sc, cv };
    return { pending: !!res.pending, drew: !!res.drewField };
  };
  return true;
})()`;
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
const POS = (k) => `#fe${hex2(164 - 8 * (k - 1))}00`;

export async function run(ctx) {
  const { page, baseUrl, assert, fixture } = ctx;
  if (fixture === 'synthetic-15d') return run15d(ctx);
  if (fixture === 'synthetic-hires-48h') return runHires(ctx);
  return runBase(ctx);
}

async function boot(page, baseUrl) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 45000 });
  await page.waitFor('window.__wse.data.getManifest() !== null', { timeout: 15000 });
  await page.eval(SETUP);
}

async function run15d({ page, baseUrl, assert }) {
  await boot(page, baseUrl);

  // ---- hairlines: every fifth edge carries ink, the others none, on both grounds ----
  for (const ground of ['paper', 'night']) {
    await page.eval(`window.__fr.render({ ground: ${JSON.stringify(ground)}, t: 0 })`);
    const r = await page.eval(`(async () => {
      const pal = await import('/js/render/palette.js'), { cv } = window.__fr.last, d = window.__fr.last.ctx.getImageData(0, 0, cv.width, cv.height).data;
      const hl = pal.edgeHairline('z500a', ${JSON.stringify(ground)}, 10), ink = [parseInt(hl.color.slice(1, 3), 16), parseInt(hl.color.slice(3, 5), 16), parseInt(hl.color.slice(5, 7), 16)];
      const band = (v) => pal.bandRGBA('z500a', v, ${JSON.stringify(ground)}).slice(0, 3);
      const count = (dam) => { const b = band(dam), w = b.map((c, i) => c * (1 - hl.alpha) + ink[i] * hl.alpha); let n = 0;
        for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - w[0]) <= 1 && Math.abs(d[i + 1] - w[1]) <= 1 && Math.abs(d[i + 2] - w[2]) <= 1) n++; return n; };
      return { ink: hl, major: count(9) + count(11), minor: count(5) + count(7) + count(13) + count(15) + count(3) };
    })()`);
    assert.ok(r.major >= 100, `${ground}: the +10 dam edge carries a hairline (${r.major} pixels of ${JSON.stringify(r.ink)} over the bands either side)`);
    assert.equal(r.minor, 0, `${ground}: ordinary 2 dam edges carry no line (${r.minor} pixels)`);
  }

  // ---- the doubt hatch: on where the spread is 6 dam or more, locked on beyond 168 h, the pixels between its lines are the band ----
  for (const ground of ['paper', 'night']) {
    for (const overlays of [{ contours: false, marks: false }, { contours: false, marks: false, doubt: false }]) {
      await page.eval(`window.__fr.render({ ground: ${JSON.stringify(ground)}, t: 300, overlays: ${JSON.stringify(overlays)} })`);
      const h = await page.eval(`(async () => {
        const pal = await import('/js/render/palette.js'), tk = await import('/js/render/chart-tokens.js'), d = window.__wse.data, m = d.getManifest(), dom = m.domains.g1;
        const sd = d.fieldAt('z500sd', 'g1', 300), za = d.fieldAt('z500a', 'g1', 300), mv = window.__fr.last.mv, W = window.__fr.last.W, H = window.__fr.last.H;
        const bandOf = (v) => Math.sign(v) * Math.floor(Math.abs(v) / 20);
        const find = (want) => { for (let j = 2; j < dom.ny - 2; j++) for (let i = 2; i < dom.nx - 2; i++) {
          let ok = true, b0 = bandOf(za[j * dom.nx + i]);
          for (let dj = -1; dj <= 1 && ok; dj++) for (let di = -1; di <= 1; di++) { const k = (j + dj) * dom.nx + i + di; if (!want(sd[k]) || bandOf(za[k]) !== b0 || Math.abs(za[k]) < 20) { ok = false; break; } }
          if (!ok) continue;
          const lon = dom.lon0 + i * dom.dlon, lat = dom.lat0 + j * dom.dlat, p = mv.project([lon, lat]);
          if (p && p[0] > 30 && p[0] < W - 30 && p[1] > 30 && p[1] < H - 30 && lon > -170 && lon < -60) return { p, v: za[j * dom.nx + i] / 10 };
        } return null; };
        const win = (spot) => { const out = []; for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) out.push(window.__fr.px(Math.floor(spot.p[0]) + dx, Math.floor(spot.p[1]) + dy)); return out; };
        const hot = find((s) => s >= 62), cool = find((s) => s <= 55);
        const ink = tk.chartTokens(${JSON.stringify(ground)}).hatch;
        return { hot: hot && { v: hot.v, win: win(hot), band: pal.bandRGBA('z500a', hot.v, ${JSON.stringify(ground)}) }, cool: cool && { v: cool.v, win: win(cool), band: pal.bandRGBA('z500a', cool.v, ${JSON.stringify(ground)}) }, ink };
      })()`);
      const tag = `${ground}, overlays ${JSON.stringify(overlays)}`;
      assert.ok(h.hot && h.cool, `${tag}: the fixture has a spot of spread of 6 dam or more and a spot below (hot ${!!h.hot}, cool ${!!h.cool})`);
      const ink = rgbOf(h.ink.color), blend = (band) => band.slice(0, 3).map((v, i) => v * (1 - h.ink.alpha) + ink[i] * h.ink.alpha);
      const kind = (c, band) => (c.slice(0, 3).every((v, i) => v === band[i]) ? 'band' : c.slice(0, 3).every((v, i) => Math.abs(v - blend(band)[i]) <= 2) ? 'ink' : 'other');
      const hot = h.hot.win.map((c) => kind(c, h.hot.band)), cool = h.cool.win.map((c) => kind(c, h.cool.band));
      const n = hot.length, inked = hot.filter((k) => k === 'ink').length, other = hot.filter((k) => k === 'other').length;
      assert.equal(other, 0, `${tag}: between its lines the field is exactly the band hex, on them the ink over it (${other} other pixels)`);
      assert.ok(inked / n >= 0.05 && inked / n <= 0.35, `${tag}: the hatch draws at t = 300 h, locked on beyond 168 h: ${inked} of ${n} pixels inked`);
      assert.ok(hot.filter((k) => k === 'band').length / n >= 0.6, `${tag}: most pixels are untouched`);
      assert.ok(cool.every((k) => k === 'band'), `${tag}: no hatch where the forecasts agree (${cool.filter((k) => k !== 'band').length} marked pixels)`);
    }
  }
  const rule = await page.eval(`import('/js/render/compose.js').then((m) => [m.doubtWanted({ t: 100, overlays: { doubt: false } }), m.doubtWanted({ t: 100, overlays: {} }), m.doubtWanted({ t: 100 }), m.doubtWanted({ t: 169, overlays: { doubt: false } }), m.doubtWanted({ t: 168, overlays: { doubt: false } })])`);
  assert.deepEqual(rule, [false, true, true, true, false], 'Uncertain areas: on by default, can be switched off up to 168 h and not beyond');

  // ---- Regional has no straight field edge: g1 under np05, a 3 degree feather over its edge ----
  const edge = await page.eval(`(async () => {
    const W = 1000, H = 600, k = 0.45, xf = { k, tx: (1 - k) * W / 2, ty: (1 - k) * H / 2, rot: [0, 0, 0] };
    await window.__fr.render({ ground: 'paper', t: 0, view: 'np', W, H, xf });
    const grid = await import('/js/data/grid.js'), dm = window.__wse.data, g1 = dm.getManifest().domains.g1, za = dm.fieldAt('z500a', 'g1', 0);
    const val = (lon, lat) => { const g = grid.toGrid(g1, lon, lat); return g && grid.bilinear(za, g1, g[0], g[1], NaN); };
    const mv = window.__fr.last.mv, lum = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const out = [];
    for (let lon = -170; lon <= -70; lon += 7) {
      const a = mv.project([lon, 74]), b = mv.project([lon, 76]);
      if (!a || !b || a[1] < 0 || b[1] < 0 || a[1] > H || b[1] > H) continue;
      if (!(Math.abs(val(lon, 74)) >= 30 && Math.abs(val(lon, 76)) >= 30)) continue; // the data itself has a band on both sides (not the unshaded gap)
      const la = lum(window.__fr.px(Math.floor(a[0]), Math.floor(a[1]))), lb = lum(window.__fr.px(Math.floor(b[0]), Math.floor(b[1])));
      out.push({ lon, a: la, b: lb, ratio: (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05), py: [a[1], b[1]] });
    }
    return out;
  })()`);
  assert.ok(edge.length >= 5, `the 75 N edge of the regional grid is in frame, with a band on both sides, at ${edge.length} longitudes`);
  const worst = Math.max(...edge.map((e) => e.ratio));
  assert.ok(worst < 1.2, `luminance across the 75 N edge of np05 stays under 1.2:1 (worst ${worst.toFixed(3)}; ${edge.map((e) => e.ratio.toFixed(2)).join(' ')})`);
  const nodata = await page.eval(`(async () => { // no underlay at all: the edge feathers to the ground, never a hard step
    const m = window.__wse.data.getManifest(); return { hasG1: m.fields.z500a.domains.includes('g1'), has05: m.fields.z500a.domains.includes('np05') };
  })()`);
  assert.ok(nodata.hasG1 && nodata.has05, 'the fixture has both domains');

  // ---- contours: labelled, upright, haloed, never under #legend or #map-tools ----
  await page.setViewport(1440, 900, 1);
  await page.eval(`new Promise((r) => setTimeout(r, 600))`);
  for (const [vw, vh] of [[1440, 900], [390, 844]]) {
    await page.setViewport(vw, vh, 1);
    await page.eval(`new Promise((r) => setTimeout(r, 500))`);
    const L = await page.eval(`(async () => {
      const fr = window.__fr, mapEl = document.getElementById('map').getBoundingClientRect(), W = Math.round(mapEl.width), H = Math.round(mapEl.height);
      const rect = (id) => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left - mapEl.left, y: r.top - mapEl.top, w: r.width, h: r.height }; };
      const spy = { pos: [], ang: [], fill: [], stroke: 0, font: new Set() };
      const { makeScene } = await import('/js/render/compose.js');
      const d = window.__wse.data; await Promise.all(['z500a', 'z500', 'z500sd'].flatMap((f) => ['np05', 'g1'].map((dm) => d.ensure(f, dm, 6))));
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
      const tr = c.translate.bind(c), ro = c.rotate.bind(c), ft = c.fillText.bind(c), st = c.strokeText.bind(c);
      c.translate = (x, y) => { spy.pos.push([x, y]); return tr(x, y); }; c.rotate = (a) => { spy.ang.push(a); return ro(a); };
      c.fillText = (t, x, y) => { spy.fill.push(t); spy.font.add(c.font); return ft(t, x, y); }; c.strokeText = (t, x, y) => { spy.stroke++; return st(t, x, y); };
      const sc = makeScene(), mv = sc.viewFor('np', W, H);
      sc.compose(c, mv, { s: { t: 6, view: 'np', lens: 'z', ground: 'paper', theme: 'light', overlays: { marks: false } }, dpr: 1, quality: 'rest', alpha: 1, force: true });
      const rects = ['legend', 'map-tools'].map(rect).filter(Boolean);
      const under = spy.pos.filter(([x, y]) => rects.some((r) => x > r.x - 20 && x < r.x + r.w + 20 && y > r.y - 8 && y < r.y + r.h + 8));
      // the same frame with the top half kept clear: every label moves to the bottom half
      const spy2 = []; const cv2 = document.createElement('canvas'); cv2.width = W; cv2.height = H; const c2 = cv2.getContext('2d'), tr2 = c2.translate.bind(c2);
      c2.translate = (x, y) => { spy2.push([x, y]); return tr2(x, y); };
      const sc2 = makeScene(); sc2.compose(c2, sc2.viewFor('np', W, H), { s: { t: 6, view: 'np', lens: 'z', ground: 'paper', theme: 'light', overlays: { marks: false } }, dpr: 1, quality: 'rest', alpha: 1, force: true, avoid: [{ x: 0, y: 0, w: W, h: H / 2 }] });
      return { W, H, n: spy.pos.length, texts: spy.fill, angles: spy.ang, halos: spy.stroke, fonts: [...spy.font], rects, under, topHalf: spy2.filter(([, y]) => y < H / 2).length, all2: spy2.length };
    })()`);
    const tag = `${vw}x${vh}`;
    assert.ok(L.n >= 1, `${tag}: the contours carry labels (${L.n})`);
    assert.ok(L.texts.every((t) => /^\d{3}$/.test(t) && Number(t) % 12 === 0), `${tag}: labels are the height in dam, every 12: ${L.texts}`);
    assert.ok(L.angles.every((a) => Math.abs(a) <= Math.PI / 2 + 1e-9), `${tag}: every label is upright (never upside down): ${L.angles.map((a) => a.toFixed(2))}`);
    assert.equal(L.halos, L.texts.length, `${tag}: every label has its halo`);
    assert.ok(L.fonts.every((f) => /\b11px\b/.test(f) && /600/.test(f)), `${tag}: chart numerals 11 px, weight 600: ${L.fonts}`);
    assert.ok(L.rects.length >= 1, `${tag}: the shell's #legend or #map-tools has a box to keep clear of (${JSON.stringify(L.rects)})`);
    assert.equal(L.under.length, 0, `${tag}: no label under #legend or #map-tools (${JSON.stringify(L.under)})`);
    assert.equal(L.topHalf, 0, `${tag}: labels honour an explicit keep-out rect (${L.topHalf} of ${L.all2} in the cleared half)`);
  }

  // ---- contours while playing: recomputed at most 10 times a second ----
  await page.setViewport(1000, 600, 1);
  const play = await page.eval(`(async () => {
    const { makeScene } = await import('/js/render/compose.js'), d = window.__wse.data;
    await Promise.all(['z500a', 'z500', 'z500sd'].flatMap((f) => ['np05', 'g1'].map((dm) => d.ensureAll(f, dm))));
    const sc = makeScene(), cv = document.createElement('canvas'); cv.width = 1000; cv.height = 600; const c = cv.getContext('2d'), mv = sc.viewFor('np', 1000, 600);
    const t0 = performance.now(); let frames = 0, f0 = sc.stats.contourComputes;
    while (performance.now() - t0 < 1500) {
      sc.compose(c, mv, { s: { t: 12 + (frames * 0.7) % 90, view: 'np', lens: 'z', ground: 'paper', theme: 'light', overlays: {}, playing: true }, dpr: 1, quality: 'motion', alpha: 1 });
      frames++; await new Promise((r) => setTimeout(r, 16));
    }
    const secs = (performance.now() - t0) / 1000;
    return { frames, computes: sc.stats.contourComputes - f0, secs, perSec: (sc.stats.contourComputes - f0) / secs };
  })()`);
  assert.ok(play.frames >= 8 && play.computes >= 2, `playing: ${play.frames} frames, ${play.computes} contour computations`);
  assert.ok(play.perSec <= 10.5, `playing: contours recomputed ${play.perSec.toFixed(1)} times a second (at most 10): ${play.computes} in ${play.secs.toFixed(2)} s over ${play.frames} frames`);

  // ---- the REAL renderer while playing (spec 4.2, 4.3; acceptance 7): the half-size bilinear raster, contours at most 10 a second, labels ----
  // Drives the app itself (store {playing: true}) and samples renderer.stats() on every animation frame. It once passed while the real
  // renderer was composing a quarter-size 'rotate' raster with no contours at all, because the check above calls compose() directly.
  await page.setViewport(1440, 900, 2); // desktop retina: the size where a half-scale motion raster is 375k px
  const real = await page.eval(`(async () => {
    const w = window.__wse, st = w.store, d = w.data, R = w.renderer;
    await Promise.all(['z500a', 'z500', 'z500sd'].flatMap((f) => ['np05', 'g1'].map((dm) => d.ensureAll(f, dm))));
    st.set({ playing: false, view: 'np', lens: 'z', overlays: { ...(st.get().overlays || {}), contours: true }, t: 12, speed: 12 });
    await new Promise((r) => setTimeout(r, 1500)); // settle at rest quality, the sliced raster done
    const rest = R.stats(), samples = [], c0 = rest.contourComputes, t0 = performance.now();
    st.set({ playing: true });
    await new Promise((res) => { const tick = () => { const x = R.stats(); samples.push({ q: x.rasterQuality, px: x.rasterPx, c: x.contourComputes, labels: x.labelCount, t: st.get().t, at: performance.now(), ms: x.rasterMs, fit: x.motionFit, frames: x.frames }); if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
    const secs = (performance.now() - t0) / 1000, played = st.get().t - 12;
    st.set({ playing: false });
    await new Promise((r) => setTimeout(r, 1500));
    const after = R.stats();
    return { restPx: rest.restRasterPx, restQuality: rest.rasterQuality, samples, secs, played, computes: samples[samples.length - 1].c - c0, afterQuality: after.rasterQuality, afterPx: after.rasterPx };
  })()`);
  const sm = real.samples.slice(3); // the first frames after pressing play may still show the rest frame
  assert.equal(real.restQuality, 'rest', `before playing the renderer is at rest quality (${real.restQuality})`);
  assert.ok(real.played > 10 && sm.length >= 20, `playback advanced ${real.played.toFixed(1)} h over ${real.samples.length} animation frames`);
  const notMotion = sm.filter((x) => x.q !== 'motion');
  assert.equal(notMotion.length, 0, `while playing every frame's raster is 'motion' quality: ${notMotion.length} of ${sm.length} were ${[...new Set(notMotion.map((x) => x.q))]}`);
  // The motion raster is at most half the rest raster per side (a quarter of its pixels) and at least a quarter per side (the
  // 'rotate' floor): within that, its size follows the measured cost so that it takes about MOTION_RASTER_MS (6 ms) a frame.
  // Every playing frame's raster is rest * (0.5 * fit)^2 pixels, fit in [0.5, 1] (5% for rounding): never more than a quarter
  // of the rest pixels, never less than a sixteenth.
  const off = sm.filter((x) => !(x.fit >= 0.5 && x.fit <= 1) || Math.abs(x.px / (real.restPx * 0.25 * x.fit * x.fit) - 1) > 0.05);
  assert.equal(off.length, 0, `playing raster is half the rest raster per side times its fit (0.5 to 1): ${off.length} of ${sm.length} frames off, e.g. ${JSON.stringify(off[0])} against ${real.restPx} rest px`);
  const ratio = Math.max(...sm.map((x) => x.px)) / real.restPx;
  assert.ok(ratio <= 0.26, `playing raster is at most a quarter of the rest raster's pixels: ${ratio.toFixed(3)}`);
  // its time: once the cost is learnt (after the first 10 frames), the p95 of the motion raster's ms is within the budget plus 50%
  const msSorted = sm.slice(10).map((x) => x.ms).sort((a, b) => a - b), p95 = msSorted[Math.min(msSorted.length - 1, Math.floor(msSorted.length * 0.95))];
  assert.ok(msSorted.length >= 10 && p95 <= 9, `while playing the motion raster takes at most about 6 ms: p95 ${p95?.toFixed(1)} ms over ${msSorted.length} frames (limit 9 ms)`);
  const perSec = real.computes / real.secs;
  assert.ok(perSec >= 2 && perSec <= 10.5, `real renderer while playing: contours recomputed ${perSec.toFixed(1)} times a second (between 2 and 10): ${real.computes} in ${real.secs.toFixed(2)} s`);
  assert.ok(sm.every((x) => x.labels > 0), `labels are drawn on every frame while playing: fewest ${Math.min(...sm.map((x) => x.labels))}`);
  assert.equal(real.afterQuality, 'rest', `after pausing the renderer returns to rest quality: ${real.afterQuality}`);
  assert.equal(real.afterPx, real.restPx, `after pausing the rest raster is back: ${real.afterPx} of ${real.restPx} px`);

  // ---- raster cap, slices, cancellation, memory ----
  const sl = await page.eval(`(async () => {
    const { makeScene } = await import('/js/render/compose.js'), d = window.__wse.data;
    await Promise.all(['z500a', 'z500sd', 'z500'].flatMap((f) => ['np05', 'g1'].map((dm) => d.ensureAll(f, dm))));
    const W = 1440, H = 900, dpr = 2, mk = () => { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; return cv.getContext('2d', { willReadFrequently: true }); };
    const S = (t) => ({ t, view: 'np', lens: 'z', ground: 'paper', theme: 'light', overlays: { contours: false, marks: false } });
    const hash = (c) => { const x = c.getImageData(0, 0, W, H).data; let h = 0; for (let i = 0; i < x.length; i += 28) h = (h * 31 + x[i] + 3 * x[i + 1] + 7 * x[i + 2]) >>> 0; return h; };
    const sc = makeScene(), mv = sc.viewFor('np', W, H), c = mk();
    // a sliced rest raster: the first compose returns at once with a coarse field, then slices of at most 12 ms
    let t0 = performance.now();
    const r0 = sc.compose(c, mv, { s: S(6), dpr, quality: 'rest', alpha: 1, sliceMs: 12 });
    // the scrubber (and anyone else) may read another time into data.fieldAt's reused buffers between two slices: the job owns its copy
    for (const f of ['z500a', 'z500sd', 'z500']) for (const dm of ['np05', 'g1']) d.fieldAt(f, dm, 54);
    const first = performance.now() - t0, px = sc.stats.rasterPx, restPx = sc.stats.restRasterPx;
    const slices = []; let guard = 0;
    while (sc.hasPending() && guard++ < 400) { const a = performance.now(); sc.stepPending(12); slices.push(performance.now() - a); }
    sc.compose(c, mv, { s: S(6), dpr, quality: 'rest', alpha: 1, sliceMs: 12 });
    const sliced = hash(c);
    const ref = makeScene(), cr = mk(); ref.compose(cr, ref.viewFor('np', W, H), { s: S(6), dpr, quality: 'rest', alpha: 1 });
    // cancellation: a job for t = 12 is running, new input arrives (t = 18): the next compose abandons it and the result is the t = 18 frame
    const sc2 = makeScene(), mv2 = sc2.viewFor('np', W, H), c2 = mk();
    sc2.compose(c2, mv2, { s: S(12), dpr, quality: 'rest', alpha: 1, sliceMs: 12 });
    const wasPending = sc2.hasPending(); sc2.stepPending(12);
    const a = performance.now(); sc2.compose(c2, mv2, { s: S(18), dpr, quality: 'rest', alpha: 1, sliceMs: 12 }); const cancelMs = performance.now() - a;
    // the same cancelling compose five more times (a job for t = 24 + 6i running, then input for t = 27 + 6i): its worst case
    const cancelRuns = [];
    for (let i = 0; i < 5; i++) {
      const sc3 = makeScene(), mv3 = sc3.viewFor('np', W, H), cv3 = document.createElement('canvas'); cv3.width = W * dpr; cv3.height = H * dpr; const c3 = cv3.getContext('2d'); c3.scale(dpr, dpr); // a canvas like the renderer's (not willReadFrequently)
      sc3.compose(c3, mv3, { s: S(24 + 6 * i), dpr, quality: 'rest', alpha: 1, sliceMs: 12 }); sc3.stepPending(12);
      c3.getImageData(0, 0, 1, 1); // canvas work is deferred: flush the frame before so its cost is not counted here
      const b = performance.now(); sc3.compose(c3, mv3, { s: S(27 + 6 * i), dpr, quality: 'rest', alpha: 1, sliceMs: 12 }); const ms = performance.now() - b;
      c3.getImageData(0, 0, 1, 1); // the compositing the frame then costs (the same for every frame, abandoned job or not): reported, not bounded here
      cancelRuns.push({ ms, flush: performance.now() - b - ms, raster: sc3.stats.rasterMs, left: sc3.hasPending() && sc3.stats.restRasterPx });
      sc3.cancelPending();
    }
    let g2 = 0; while (sc2.hasPending() && g2++ < 400) sc2.stepPending(12);
    sc2.compose(c2, mv2, { s: S(18), dpr, quality: 'rest', alpha: 1, sliceMs: 12 });
    const ref2 = makeScene(), cr2 = mk(); ref2.compose(cr2, ref2.viewFor('np', W, H), { s: S(18), dpr, quality: 'rest', alpha: 1 });
    sc2.compose(c2, mv2, { s: S(18), dpr, quality: 'rest', alpha: 1 });
    sc2.cancelPending();
    return { px, restPx, pending0: r0.pending, first, slices, sliced, refHash: hash(cr), cancelled: hash(c2), ref2: hash(cr2), wasPending, cancelMs, cancelRuns, stillPending: sc2.hasPending(), stepAfter: sc2.stepPending(12) };
  })()`);
  assert.ok(sl.restPx <= 1.5e6 && sl.restPx > 1.2e6, `rest raster is capped at 1.5 MP: ${sl.restPx} px for 1440 x 900 at DPR 2`);
  assert.ok(sl.slices.length >= 2, `the rest raster renders in several slices (${sl.slices.length})`);
  assert.ok(sl.pending0, 'the first compose returns pending with a coarse raster');
  const maxSlice = Math.max(...sl.slices);
  assert.ok(maxSlice <= 14, `no rest slice over 12 ms (worst ${maxSlice.toFixed(1)} ms over ${sl.slices.length} slices)`);
  assert.equal(sl.sliced, sl.refHash, 'a sliced raster is pixel-identical to the one-pass raster, even when other readers use the field buffers between slices');
  // Acceptance 4 ("cancelled within one frame by new input"), measured as the spec's frame budget measures (14.3): the script time
  // of the compose that abandons the job and draws the new frame, on a canvas like the renderer's, after the previous frame is
  // flushed. The worst of five runs is at most one 16.7 ms frame. The compositing that follows is the same for every frame and
  // is printed, not bounded here.
  const worstCancel = Math.max(...sl.cancelRuns.map((r) => r.ms));
  console.log(`  cancelling compose (script): ${sl.cancelRuns.map((r) => `${r.ms.toFixed(1)} ms (raster ${r.raster.toFixed(1)}, then ${r.flush.toFixed(1)} ms compositing)`).join(', ')}`);
  assert.ok(sl.wasPending, 'a rest job was running when the new input arrived');
  assert.ok(worstCancel <= 16.7, `new input cancels a running job within one frame: the cancelling compose took at most ${worstCancel.toFixed(1)} ms of script (limit 16.7 ms) over ${sl.cancelRuns.length} runs`);
  assert.equal(sl.cancelled, sl.ref2, 'after a cancel the frame is the new one: no rows of the abandoned job');
  assert.equal(sl.stillPending, false, 'cancelPending leaves no job'); assert.deepEqual(sl.stepAfter, { pending: false, done: false });
  const mem = await page.eval(`(async () => {
    const { makeScene } = await import('/js/render/compose.js'), d = window.__wse.data;
    const W = 390, H = 844, dpr = 2, cv = document.createElement('canvas'); cv.width = W * dpr; cv.height = H * dpr; const c = cv.getContext('2d'); c.scale(dpr, dpr);
    const sc = makeScene(); let peak = 0;
    for (let i = 0; i < 20; i++) {
      const xf = sc.clampXf({ k: 2.2, tx: -40 - i * 13, ty: -60 - i * 17, rot: [0, 0, 0] }, W, H), mv = sc.viewFor('np', W, H, xf);
      sc.compose(c, mv, { s: { t: 6, view: 'np', lens: 'z', ground: i % 2 ? 'paper' : 'night', theme: 'light', overlays: { marks: false } }, dpr, quality: i % 3 ? 'rest' : 'motion', alpha: 1 });
      peak = Math.max(peak, sc.stats.bytes);
    }
    return { bytes: sc.stats.bytes, peak, rasterPx: sc.stats.rasterPx };
  })()`);
  assert.ok(mem.bytes > 0 && mem.peak < 48e6, `scene.stats.bytes after 20 pans at 390 x 844 @2: ${(mem.bytes / 1e6).toFixed(1)} MB (peak ${(mem.peak / 1e6).toFixed(1)} MB), under 48 MB`);

  // ---- the basemap layers follow the 50 m swap in every renderer (S-LINEART's live-like flake) ----
  // loadBasemap runs only its first caller's onUpgrade, so a second renderer that drew before the 50 m files arrived kept its
  // 110 m layers under a cache key without the tier. Hold the 50 m files back, draw a second renderer at the 110 m tier, release
  // them, and its next frame must equal a brand-new renderer's frame of the same view (field off, so no fade or raster differs).
  let holding = true;
  const held = [], origEvent = page._event;
  page._event = function (m, p) { if (holding && m === 'Fetch.requestPaused' && /-50m\.json|states-10m\.json/.test(p.request.url)) { held.push(p.requestId); return; } return origEvent.call(this, m, p); };
  try {
    await boot(page, baseUrl);
    const tier1 = await page.eval(`(async () => {
      const b = await import('/js/render/basemap.js'), { createRenderer } = await import('/js/render/index.js'), { store } = await import('/js/state.js');
      store.set({ playing: false, view: 'np', lens: 'none', ground: 'paper', theme: 'light' });
      const cv = document.createElement('canvas'); cv.id = 'tiercv'; cv.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:400px;z-index:99999';
      document.body.appendChild(cv);
      window.__tierR = createRenderer(cv);
      await new Promise((r) => setTimeout(r, 300));
      window.__tierR.draw();
      return b.basemapTier();
    })()`);
    assert.equal(tier1, 1, `the second renderer drew while only the 110 m files were in (tier ${tier1}; ${held.length} 50 m requests held)`);
    holding = false;
    for (const id of held) await page.send('Fetch.continueRequest', { requestId: id }).catch(() => {});
    const tier = await page.eval(`(async () => {
      const b = await import('/js/render/basemap.js'), { createRenderer } = await import('/js/render/index.js');
      await b.basemapFull();
      const pix = (cv) => { const t = document.createElement('canvas'); t.width = cv.width; t.height = cv.height; const c = t.getContext('2d', { willReadFrequently: true }); c.drawImage(cv, 0, 0); const d = c.getImageData(0, 0, t.width, t.height).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + 3 * d[i + 1] + 7 * d[i + 2]) >>> 0; return h; };
      window.__tierR.draw();
      const old = pix(document.getElementById('tiercv'));
      const cv2 = document.createElement('canvas'); cv2.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:400px;z-index:99998';
      document.body.appendChild(cv2);
      const R2 = createRenderer(cv2); await new Promise((r) => setTimeout(r, 300)); R2.draw();
      const fresh = pix(cv2);
      window.__tierR.destroy(); R2.destroy(); document.getElementById('tiercv').remove(); cv2.remove();
      return { tier: b.basemapTier(), same: old === fresh, w: cv2.width };
    })()`);
    assert.equal(tier.tier, 2, 'the 50 m files swapped in');
    assert.ok(tier.same, `after the 50 m swap a renderer that drew at the 110 m tier draws the same frame as a fresh one (${tier.w} px wide)`);
  } finally { holding = false; for (const id of held) await page.send('Fetch.continueRequest', { requestId: id }).catch(() => {}); page._event = origEvent; }
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
}

async function runHires({ page, baseUrl, assert }) {
  await boot(page, baseUrl);
  // The anomaly is exactly circular (in longitude and latitude degrees, 12 degrees across at +10 dam). At 8x the edge of the
  // 10 dam band, read from the pixels the renderer drew (its hairline), never departs more than 1 raster px from the circle.
  const measure = (inject) => page.eval(`(async () => {
    const INJECT = ${inject};    const W = 400, H = 300, base = await (async () => { await window.__fr.render({ t: 0, W, H }); return window.__fr.last.mv; })();
    const b = base.project([-148, 46]), k = 8, xf = { k, tx: W / 2 - k * b[0], ty: H / 2 - k * b[1], rot: [0, 0, 0] };
    if (INJECT) {
      // An UNROUNDED analytic circular field: Float32 computed here into the np05 frame fieldAt hands out for t = 0 (the same buffer
      // for the compose below, which therefore bypasses fr.render's ensure(): that refills the buffer from the file). 100 gpm exactly
      // on the circle of 12 degrees (in longitude and latitude degrees) round (-160, 46), falling 9 gpm a degree outward from it,
      // with no whole-metre rounding. A fresh scene: the scene caches a raster per (view, time, data version).
      const gr = await import('/js/data/grid.js'), cmp = await import('/js/render/compose.js'), bm = await import('/js/render/basemap.js');
      const dm0 = window.__wse.data, dom0 = dm0.getManifest().domains.np05, buf = dm0.fieldAt('z500a', 'np05', 0);
      for (let j = 0; j < dom0.ny; j++) for (let i = 0; i < dom0.nx; i++) { const [lo, la] = gr.nodeLonLat(dom0, i, j); buf[j * dom0.nx + i] = 100 + 9 * (12 - Math.hypot(lo + 160, la - 46)); }
      const sc = cmp.makeScene(), cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx = cv.getContext('2d', { willReadFrequently: true }), mvI = sc.viewFor('np', W, H, xf);
      bm.setBasemap(null);
      sc.compose(cx, mvI, { s: { t: 0, view: 'np', lens: 'z', ground: 'paper', theme: 'light', overlays: { contours: false, marks: false }, playing: false }, dpr: 1, quality: 'rest', alpha: 1, force: true });
      bm.setBasemap(window.__fr.geo);
      window.__fr.last = { ctx: cx, mv: mvI, W, H, dpr: 1, scene: sc, cv };
    } else await window.__fr.render({ t: 0, W, H, xf });
    const { mv } = window.__fr.last, pal = await import('/js/render/palette.js');
    // the hairline of the +10 dam edge: ink over the band either side (4..5 and 5..6 dam... the 8-10 and 10-12 dam bands)
    const hl = pal.edgeHairline('z500a', 'paper', 10), ink = [1, 3, 5].map((i) => parseInt(hl.color.slice(i, i + 2), 16));
    const want = [9, 11].map((v) => pal.bandRGBA('z500a', v, 'paper').slice(0, 3).map((c, i) => c * (1 - hl.alpha) + ink[i] * hl.alpha));
    const d = window.__fr.last.ctx.getImageData(0, 0, W, H).data, pts = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = 4 * (y * W + x); if (want.some((w) => Math.abs(d[i] - w[0]) <= 1 && Math.abs(d[i + 1] - w[1]) <= 1 && Math.abs(d[i + 2] - w[2]) <= 1)) pts.push([x + 0.5, y + 0.5]); }
    const circle = []; for (let a = 0; a < 7200; a++) { const th = (a / 7200) * 2 * Math.PI, p = mv.project([-160 + 12 * Math.cos(th), 46 + 12 * Math.sin(th)]); if (p) circle.push(p); }
    let worst = 0, sum = 0;  for (const q of pts) { let m = 1e9; for (const c of circle) { const dd = Math.hypot(q[0] - c[0], q[1] - c[1]); if (dd < m) m = dd; } worst = Math.max(worst, m); sum += m; }
    // The same edge against the field the renderer samples (bicubic at 8x): how far, in px, each edge pixel's centre is from where
    // that field equals 100 gpm (|v - 100| over the local gradient). This is the raster's own staircase, free of the fixture's rounding.
    const grid = await import('/js/data/grid.js'), smp = await import('/js/render/sample.js'), dm = window.__wse.data, dom = dm.getManifest().domains.np05, za = dm.fieldAt('z500a', 'np05', 0);
    const f = (x, y) => { const ll = mv.invert([x, y]), g = ll && grid.toGrid(dom, ll[0], ll[1]); return g ? smp.bicubicAt(za, dom.nx, dom.ny, g[0], g[1]) : NaN; };
    let ideal = 0; for (const [x, y] of pts) { const v = f(x, y), gx = (f(x + 0.5, y) - f(x - 0.5, y)), gy = (f(x, y + 0.5) - f(x, y - 0.5)), gr = Math.hypot(gx, gy); ideal = Math.max(ideal, Math.abs(v - 100) / gr); }
        return { n: pts.length, worst, ideal, mean: pts.length ? sum / pts.length : 0, k: mv.xf.k, circle: circle.length };
  })()`);
  const r = await measure(false);
  assert.equal(r.k, 8);
  assert.ok(r.n >= 150, `the 10 dam edge is drawn at 8x: ${r.n} edge pixels`);
  assert.ok(r.ideal <= 1.0, `band-edge staircase at 8x never more than 1 raster px from the field's own 10 dam line: worst ${r.ideal.toFixed(2)} px over ${r.n} edge pixels`);
  // The fixture is whole metres (about 9 gpm a degree at the edge, so 1 gpm is 9 px at 8x), which moves any renderer's edge by up to
  // about 2 px from the analytic circle: with that rounding, 2 px is the bound.
  assert.ok(r.worst <= 2.0, `the fixture's whole-metre rounding: the edge lies within 2 px of the analytic circle: worst ${r.worst.toFixed(2)} px, mean ${r.mean.toFixed(2)} px over ${r.n} pixels`);
  // DESIGN-SPEC acceptance 3 as written: the unrounded circle, injected, never more than 1 raster px from the analytic circle itself
  // (this proves the rounding explains the 2 px above: the same renderer meets the 1 px bound once the field has no rounding).
  const u = await measure(true);
  assert.equal(u.k, 8);
  assert.ok(u.n >= 150, `unrounded circle: the 10 dam edge is drawn at 8x: ${u.n} edge pixels`);
  // The hairline marks the pixel next to the crossing, so its centre is up to exactly 1 px from the true edge; the 0.01 px of slack is the
  // Catmull-Rom interpolation error of the field between nodes (measured 0.0018 px), not rounding.
  assert.ok(u.worst <= 1.01, `acceptance 3: with an unrounded analytic circular field the band edge at 8x is never more than 1 raster px from the circle: worst ${u.worst.toFixed(4)} px, mean ${u.mean.toFixed(2)} px over ${u.n} edge pixels`);
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
}
