// S-COLOR: a colour always means the same number. Measured on RENDERED PIXELS (a canvas the real compose() drew), on both
// chart grounds (DESIGN-SPEC 4.2, 14.3 "Band colour"; Josh point 7: use the standard colours).
//
//   - Paper: the ECMWF 500 hPa anomaly legend hex for hex, written out below from REF-20's closed form (not read from the
//     module): positive band k is rgb(254, 164 - 8(k-1), 0), negative band k is rgb(0, 227 - 12(k-1), 254), 2 dam wide each.
//     +6.9 dam is exactly #fe9400, -13 dam exactly #00a7fe, +1 dam the ground (nothing is drawn inside +-2 dam).
//   - The +11 dam probe has the same hex at 0 h and at 300 h: the fill never fades with the ensemble spread (the doubt is a
//     hatch). At 300 h the hatch is on; the probe is read between its lines.
//   - Night: the orange arm keeps its Paper hex, the blue arm is the Night table (each band at least 3:1 on both Night grounds).
//   - A pixel on a +-10 dam edge differs from both neighbours (the countable hairline); an ordinary 2 dam edge has none.
//   - The old colormap.js entry points now return the same bands.
// Known-positive mutants: M-field-1 (every band shifted by one) and M-field-2 (the field faded by spread) must both fail here.
import { mount, sleep, decodePNG, pixel } from '../wp2/shot.mjs';

export const id = 'S-COLOR';
export const freshProfile = false;
export const timeoutMs = 120000;
export const data = 'synthetic-15d';

const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
const POS = (k) => `#fe${hex2(164 - 8 * (k - 1))}00`;
const NEG = (k) => `#00${hex2(227 - 12 * (k - 1))}fe`;
const bandHex = (dam) => (Math.abs(dam) < 2 ? null : dam > 0 ? POS(Math.floor(dam / 2)) : NEG(Math.floor(-dam / 2)));
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const NIGHT_GROUNDS = ['#12161B', '#1C2127'].map(rgbOf);

/** In the page: render the field with the real compose() into a canvas and return a pixel reader plus the projection. */
const SETUP = `(() => {
  if (window.__ft) return true;
  const ft = window.__ft = { scene: null, last: null };
  ft.render = async ({ ground, t, view = 'np', W = 1000, H = 600, lens = 'z', overlays = { contours: false, marks: false }, theme = 'light' }) => {
    const { makeScene } = await import('/js/render/compose.js');
    ft.scene ||= makeScene();
    // Probes are read where the field alone is drawn: coast and border ink over a band is by design (S-LINEART measures it).
    const bm = await import('/js/render/basemap.js');
    for (let i = 0; i < 100 && !bm.basemapData(); i++) await new Promise((r) => setTimeout(r, 50));
    ft.geo ||= bm.basemapData();
    const d = window.__wse.data;
    await Promise.all(['z500a', 'z500sd', 'z500'].flatMap((f) => ['np05', 'g1'].map((dm) => d.ensure(f, dm, t))));
    bm.setBasemap(null);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const mv = ft.scene.viewFor(view, W, H);
    ft.scene.compose(ctx, mv, { s: { t, view, lens, ground, theme, overlays }, dpr: 1, quality: 'rest', alpha: 1, force: true });
    ft.last = { ctx, mv, W, H };
    bm.setBasemap(ft.geo);
    return true;
  };
  ft.px = (x, y) => Array.from(ft.last.ctx.getImageData(x, y, 1, 1).data);
  ft.at = (lon, lat) => { const p = ft.last.mv.project([lon, lat]); return p && [Math.floor(p[0]), Math.floor(p[1])]; };
  ft.rows = (y) => Array.from(ft.last.ctx.getImageData(0, y, ft.last.W, 1).data);
  return true;
})()`;

export async function run({ page, baseUrl, assert }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 45000 });
  await page.waitFor('window.__wse.data.getManifest() !== null', { timeout: 15000 });
  await page.eval(SETUP);
  const probes = await page.eval(`window.__wse.data.getManifest().probes.filter((p) => p.field === 'z500a' && p.domain === 'np05').map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, step: p.step, dam: p.value / 10 }))`);
  const probe = (name, step = 0) => { const p = probes.find((q) => q.name === name && q.step === step); assert.ok(p, `fixture probe ${name} at ${step} h`); return p; };
  const pxAt = async (p) => page.eval(`(() => { const a = window.__ft.at(${p.lon}, ${p.lat}); return a && { at: a, px: window.__ft.px(a[0], a[1]), around: [[3, 0], [-3, 0], [0, 3], [0, -3]].map(([dx, dy]) => window.__ft.px(a[0] + dx, a[1] + dy)) }; })()`);
  const toHex = (c) => '#' + c.slice(0, 3).map(hex2).join('');
  const sameRGB = (a, b) => a.slice(0, 3).every((v, i) => v === b[i]);

  // ---- the colormap entry points kept for old callers are the same bands (no table of their own any more) ----
  const cm = await page.eval(`import('/js/render/colormap.js').then((m) => ({ a69: m.anomalyRGBA(6.9, 'light'), n13: m.anomalyRGBA(-13, 'light'), g1: m.anomalyRGBA(1, 'light'), nan: m.anomalyRGBA(NaN, 'light'), jet: m.jetRGBA(35, 'light'), deep: m.jetRGBA(20), stops: m.STOPS.length }))`);
  assert.equal(toHex(cm.a69), '#fe9400'); assert.equal(cm.a69[3], 255, 'opaque');
  assert.equal(toHex(cm.n13), '#00a7fe');
  assert.equal(cm.g1[3], 0, '+1 dam draws nothing'); assert.equal(cm.nan[3], 0);
  assert.equal(toHex(cm.jet), '#ffff00', '35 m/s is the first jet band'); assert.equal(cm.deep[3], 0, 'no jet shading below 30 m/s');

  // ---- Paper: the published hex, through rendered pixels ----
  await page.eval(`window.__ft.render({ ground: 'paper', t: 0, lens: null })`);
  const groundPx = {};
  for (const n of ['band+6.9dam', 'band-13dam', 'band+1dam', 'band+11dam']) groundPx[n] = await pxAt(probe(n));
  await page.eval(`window.__ft.render({ ground: 'paper', t: 0 })`);
  const paper = {};
  for (const n of ['band+6.9dam', 'band-13dam', 'band+1dam', 'band+11dam']) paper[n] = await pxAt(probe(n));
  for (const [n, want] of [['band+6.9dam', '#fe9400'], ['band-13dam', '#00a7fe'], ['band+11dam', POS(5)]]) {
    assert.equal(bandHex(probe(n).dam), want, `the test's own table: ${n}`);
    assert.equal(toHex(paper[n].px), want, `Paper ${n}: rendered ${toHex(paper[n].px)}, want ${want}`);
    for (const a of paper[n].around) assert.equal(toHex(a), want, `Paper ${n}: the probe sits 3 px inside its band (${toHex(a)})`);
  }
  assert.ok(sameRGB(paper['band+1dam'].px, groundPx['band+1dam'].px), `Paper +1 dam is the ground: ${toHex(paper['band+1dam'].px)} vs ${toHex(groundPx['band+1dam'].px)}`);

  // ---- no fade: the +11 dam probe is the same hex at 0 h and at 300 h (the hatch is on at 300 h; read between its lines) ----
  await page.eval(`window.__ft.render({ ground: 'paper', t: 300 })`);
  // From 168 h the map's pattern moves to the ensemble mean (W3-09, DESIGN-SPEC 7.2), so the fixture's raw-run probe point is not
  // +11 dam on the map at 300 h. The point is taken from the field the map draws (data.fieldAt): the one nearest the fixture probe
  // whose whole 17 x 17 px window is in the +11 band (10 to 12 dam), preferring one where the spread is 6 dam or more (the hatch
  // is on). The fixture's mean has no +11 dam area with that much spread, so the window may be unhatched; S-RENDER tests the hatch.
  const p11f = probe('band+11dam', 300);
  const p11 = await page.eval(`(async () => {
    const d = window.__wse.data, m = d.getManifest(), g = await import('/js/data/grid.js'), mv = window.__ft.last.mv, dom = m.domains.np05;
    const za = d.fieldAt('z500a', 'np05', 300), sd = d.fieldAt('z500sd', 'np05', 300);
    const at = (arr, x, y) => { const ll = mv.invert([x + 0.5, y + 0.5]), q = ll && g.toGrid(dom, ll[0], ll[1]); return q && q[0] > 8 && q[1] > 8 && q[0] < dom.nx - 9 && q[1] < dom.ny - 9 ? g.bilinear(arr, dom, q[0], q[1], NaN) : NaN; };
    const inBand = (v) => v >= 100.5 && v < 119.5; // half a gpm inside the edges, for the raster's bilinear
    const a0 = window.__ft.at(${p11f.lon}, ${p11f.lat}), cands = [];
    for (let y = 12; y < mv.H - 12; y += 4) for (let x = 12; x < mv.W - 12; x += 4) { const v = at(za, x, y); if (inBand(v)) cands.push([(at(sd, x, y) >= 60 ? 0 : 1e6) + Math.hypot(x - a0[0], y - a0[1]), x, y]); }
    cands.sort((p, q) => p[0] - q[0]);
    for (const [, x, y] of cands) {
      let ok = true;
      for (let dy = -8; dy <= 8 && ok; dy++) for (let dx = -8; dx <= 8 && ok; dx++) ok = inBand(at(za, x + dx, y + dy));
      if (ok) { const ll = mv.invert([x + 0.5, y + 0.5]); return { lon: ll[0], lat: ll[1], x, y, dam: at(za, x, y) / 10, sdDam: at(sd, x, y) / 10, from: Math.round(Math.hypot(x - a0[0], y - a0[1])) }; }
    }
    return null;
  })()`);
  assert.ok(p11, 'at 300 h the drawn field has a +11 dam window');
  console.log(`  +11 dam at 300 h read at (${p11.x}, ${p11.y}): ${p11.dam.toFixed(1)} dam drawn, spread ${p11.sdDam.toFixed(1)} dam, ${p11.from} px from the fixture probe`);
  const win = await page.eval(`(() => { const a = [${p11.x}, ${p11.y}], out = []; for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) out.push(window.__ft.px(a[0] + dx, a[1] + dy)); return out; })()`);
  const want11 = rgbOf(POS(5)), ink = rgbOf('#1A1D21'), blend = want11.map((v, i) => v * 0.65 + ink[i] * 0.35);
  const exact = win.filter((c) => sameRGB(c, want11)).length, inked = win.filter((c) => c.slice(0, 3).every((v, i) => Math.abs(v - blend[i]) <= 2)).length;
  assert.ok(exact > win.length * 0.6, `+11 dam at 300 h: ${exact} of ${win.length} pixels around the probe are exactly ${POS(5)} (same as 0 h)`);
  assert.ok(win.every((c) => sameRGB(c, want11) || c.slice(0, 3).every((v, i) => Math.abs(v - blend[i]) <= 2)), `+11 dam at 300 h: every pixel is the band hex or the hatch ink over it (${exact} exact, ${inked} inked of ${win.length})`);

  // ---- Night: the orange arm keeps its Paper hex; the blue arm is the Night table and clears 3:1 on both Night grounds ----
  await page.eval(`window.__ft.render({ ground: 'night', t: 0, lens: null })`);
  const nGround = await pxAt(probe('band+1dam'));
  await page.eval(`window.__ft.render({ ground: 'night', t: 0 })`);
  const nightTable = await page.eval(`import('/js/render/palette.js').then((m) => ({ pos: m.bandRGBA('z500a', 6.9, 'night'), neg: m.bandRGBA('z500a', -13, 'night'), eleven: m.bandRGBA('z500a', 11, 'night') }))`);
  const night = {};
  for (const n of ['band+6.9dam', 'band-13dam', 'band+1dam', 'band+11dam']) night[n] = await pxAt(probe(n));
  assert.equal(toHex(night['band+6.9dam'].px), '#fe9400', 'Night keeps the orange arm exactly');
  assert.equal(toHex(night['band+11dam'].px), POS(5));
  assert.ok(sameRGB(night['band-13dam'].px, nightTable.neg), `Night -13 dam equals the Night table ${toHex(nightTable.neg)}, rendered ${toHex(night['band-13dam'].px)}`);
  assert.notEqual(toHex(night['band-13dam'].px), '#00a7fe', 'the Night blue is its own colour, not the Paper one');
  for (const g of NIGHT_GROUNDS) assert.ok(ratio(night['band-13dam'].px, g) >= 3, `Night -13 dam band is at least 3:1 on ${g}: ${ratio(night['band-13dam'].px, g).toFixed(2)}`);
  assert.ok(sameRGB(night['band+1dam'].px, nGround.px), 'Night +1 dam is the Night ground');
  for (const a of night['band-13dam'].around) assert.ok(sameRGB(a, nightTable.neg), 'Night probe 3 px inside its band');

  // ---- countable edges: a pixel on a +-10 dam edge differs from both neighbours; an ordinary 2 dam edge draws no line ----
  await page.eval(`window.__ft.render({ ground: 'paper', t: 0 })`);
  const scan = async (from, to) => page.eval(`(() => {
    const W = window.__ft.last.W, H = window.__ft.last.H, A = ${JSON.stringify(rgbOf(from))}, B = ${JSON.stringify(rgbOf(to))};
    let rows = 0, withThird = 0;
    for (let y = 0; y < H; y += 2) {
      const d = window.__ft.rows(y), at = (x) => [d[4 * x], d[4 * x + 1], d[4 * x + 2]], eq = (c, k) => c[0] === k[0] && c[1] === k[1] && c[2] === k[2];
      for (let x = 0; x < W - 5; x++) {
        if (!eq(at(x), A)) continue;
        for (let w = 1; w <= 3; w++) {
          if (!eq(at(x + w + 1), B)) continue;
          let third = false; for (let q = 1; q <= w; q++) { const c = at(x + q); if (!eq(c, A) && !eq(c, B)) third = true; }
          rows++; if (third) withThird++; x += w + 1; break;
        }
      }
    }
    return { rows, withThird };
  })()`);
  const major = await scan(POS(4), POS(5)), minor = await scan(POS(3), POS(4));
  assert.ok(major.rows >= 8 && major.withThird >= major.rows * 0.8, `the +10 dam edge carries a line: ${major.withThird} of ${major.rows} crossings have a third colour between the bands`);
  assert.ok(minor.rows >= 8 && minor.withThird <= minor.rows * 0.1, `the +8 dam edge carries none: ${minor.withThird} of ${minor.rows} crossings`);

  // ---- the legend bar the canvas drawLegend paints (a share's) uses the same bands as the palette (read back from a screenshot) ----
  await mount(page, { width: 700, height: 300 });
  for (const ground of ['night', 'paper']) {
    await page.eval(`(() => {
      const c = window.__wp2.canvas; c.style.display = 'none';
      const cv = document.createElement('canvas'); cv.id = 'wp2lg'; cv.width = 700; cv.height = 300;
      cv.style.cssText = 'position:fixed;left:0;top:0;z-index:100000;width:700px;height:300px';
      document.getElementById('wp2lg')?.remove(); document.body.appendChild(cv);
      const ctx = cv.getContext('2d'); ctx.fillStyle = ${JSON.stringify(ground === 'night' ? '#0C1014' : '#F9F6F2')}; ctx.fillRect(0, 0, 700, 300);
      import('/js/render/legend.js').then((m) => { window.__lh = m.drawLegend(ctx, { x: 20, y: 20, width: 600, lens: 'z', ground: ${JSON.stringify(ground)} }); });
    })()`);
    await page.waitFor('window.__lh > 0');
    await sleep(150);
    const img = decodePNG(await page.screenshot());
    const bar = await page.eval(`import('/js/ui/maplegend.js').then((m) => m.legendModel({ lens: 'z', ground: ${JSON.stringify(ground)} }, __wse.data.getManifest()).bar)`);
    const by = 20 + 42 + 10; // the title row (30) and its gap (12), then the middle of the 20 px bar
    let n = 0;
    for (const b of bar) {
      if (b.gap || b.width < 0.8) continue;
      const x = Math.round(20 + ((b.left + b.width / 2) / 100) * 600), [r, g, bl] = pixel(img, x, by);
      const want = [1, 3, 5].map((i) => parseInt(b.color.slice(i, i + 2), 16));
      assert.ok([r, g, bl].every((v, k) => Math.abs(v - want[k]) <= 6), `${ground} legend bar at ${b.from}..${b.to} dam is ${[r, g, bl]}, want ${want}`);
      n++;
    }
    assert.ok(n >= 30, `${ground}: checked ${n} bands`);
    await page.eval(`window.__lh = 0`);
    await page.eval(`document.getElementById('wp2lg').remove()`);
  }
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
}
