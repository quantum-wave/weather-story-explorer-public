// S-LENS-B: the Air mass and Atmospheric rivers lenses on RENDERED PIXELS (a canvas the real compose() drew), DESIGN-SPEC 6.1, MET-8,
// W4-04. Probe points are taken from the field the map draws (data.fieldAt through the view), not from a table of coordinates:
//   - IVT: a pixel of about 800 kg/m/s is the 750 band (#e31a1c, Paper), one of about 200 is unfilled (the ground), on both grounds.
//   - Air mass: a +2 C pixel is #fea998, a pixel inside +-1 C is the ground, the hottest band is #580b00 (REF-26 hex for hex).
//   - Terrain: where the pipeline stored no t850a (a block over the Rockies in the fixture) a pixel is ground or hatch ink on ground,
//     never a temperature band; the hatch covers some of the block but not all of it (a hatch, not a fill).
//   - Contours: the Rivers lens labels its 250-step lines, the Air mass lens draws the height in grey.
// Known-positive mutant: M-lens-b-1 (the raster paints masked cells with a temperature band) must fail here.

export const id = 'S-LENS-B';
export const freshProfile = false;
export const timeoutMs = 120000;
export const data = 'synthetic-15d';

const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
const toHex = (c) => '#' + c.slice(0, 3).map(hex2).join('');
const same = (a, b, tol = 0) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol);

const SETUP = `(() => {
  if (window.__fb) return true;
  const fb = window.__fb = { scene: null, last: null };
  fb.render = async ({ ground, t, view = 'np', W = 1000, H = 600, lens, overlays = { contours: false }, theme = 'light' }) => {
    const { makeScene } = await import('/js/render/compose.js');
    fb.scene ||= makeScene();
    const bm = await import('/js/render/basemap.js');
    for (let i = 0; i < 100 && !bm.basemapData(); i++) await new Promise((r) => setTimeout(r, 50));
    fb.geo ||= bm.basemapData();
    const d = window.__wse.data;
    await Promise.all(['t850a', 'ivt', 'z500'].flatMap((f) => ['np05', 'g1'].map((dm) => d.ensure(f, dm, t).catch(() => null))));
    bm.setBasemap(null);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const mv = fb.scene.viewFor(view, W, H);
    fb.scene.compose(ctx, mv, { s: { t, view, lens, ground, theme, overlays }, dpr: 1, quality: 'rest', alpha: 1, force: true });
    fb.last = { ctx, mv, W, H, t };
    bm.setBasemap(fb.geo);
    return { labels: fb.scene.stats.labelCount };
  };
  fb.keepBase = () => { const { ctx, W, H } = fb.last; fb.base = ctx.getImageData(0, 0, W, H); return true; };
  fb.basePx = (x, y) => { const i = (y * fb.base.width + x) * 4; return Array.from(fb.base.data.slice(i, i + 4)); };
  fb.px = (x, y) => Array.from(fb.last.ctx.getImageData(x, y, 1, 1).data);
  fb.win = (x, y, r) => Array.from(fb.last.ctx.getImageData(x - r, y - r, 2 * r + 1, 2 * r + 1).data);
  // the first screen point (scanning the frame) whose (2r+1)-square of drawn field values all satisfy pred
  fb.find = async (field, dom, pred, r, step = 3) => {
    const d = window.__wse.data, g = await import('/js/data/grid.js'), { mv, W, H, t } = fb.last, m = d.getManifest(), D = m.domains[dom], arr = d.fieldAt(field, dom, t);
    const at = (x, y) => { const ll = mv.invert([x + 0.5, y + 0.5]), q = ll && g.toGrid(D, ll[0], ll[1]); return q ? g.bilinear(arr, D, q[0], q[1], NaN) : null; };
    for (let y = 10 + r; y < H - 10 - r; y += step) for (let x = 10 + r; x < W - 10 - r; x += step) {
      let ok = true;
      for (let dy = -r; dy <= r && ok; dy++) for (let dx = -r; dx <= r && ok; dx++) ok = pred(at(x + dx, y + dy));
      if (ok) return { x, y, v: at(x, y) };
    }
    return null;
  };
  return true;
})()`;

export async function run({ page, baseUrl, assert }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 45000 });
  await page.waitFor('window.__wse.data.getManifest() !== null', { timeout: 15000 });
  await page.eval(SETUP);
  const find = (field, dom, pred, r) => page.eval(`window.__fb.find(${JSON.stringify(field)}, ${JSON.stringify(dom)}, ${pred}, ${r})`);
  const window_ = (p, r) => page.eval(`window.__fb.win(${p.x}, ${p.y}, ${r})`);
  const px = (p) => page.eval(`window.__fb.px(${p.x}, ${p.y})`);
  const basePx = (p) => page.eval(`window.__fb.basePx(${p.x}, ${p.y})`);
  const frame = async (o) => { const base = { ...o, lens: null }; await page.eval(`window.__fb.render(${JSON.stringify(base)}).then(() => window.__fb.keepBase())`); return page.eval(`window.__fb.render(${JSON.stringify(o)})`); };
  const chunks = (a) => { const out = []; for (let i = 0; i < a.length; i += 4) out.push(a.slice(i, i + 4)); return out; };
  const tables = await page.eval(`import('/js/render/palette.js').then((m) => ({ ivt: m.PALETTES.ivt, t850a: m.PALETTES.t850a }))`);

  // ---- Rivers (Paper): 800 is the 750 band, 200 is unfilled ----
  await frame({ ground: 'paper', t: 0, lens: 'r' });
  const p800 = await find('ivt', 'np05', '(v) => v !== null && v >= 770 && v < 990', 2);
  assert.ok(p800, 'the fixture has an IVT area of 770 to 990 in the regional view');
  const p800b = await find('ivt', 'np05', '(v) => v !== null && v >= 770 && v <= 860', 2) || p800;
  const want750 = '#e31a1c';
  for (const p of [p800, p800b]) {
    const c = await px(p);
    assert.equal(toHex(c), want750, `IVT ${Math.round(p.v)} at (${p.x}, ${p.y}) is the 750 band: rendered ${toHex(c)}`);
    for (const a of chunks(await window_(p, 2))) assert.equal(toHex(a), want750, `the 5 x 5 window at (${p.x}, ${p.y}, v ${Math.round(p.v)}) is the 750 band: ${[...new Set(chunks(await window_(p, 2)).map(toHex))]}`);
  }
  console.log(`  IVT ${Math.round(p800b.v)} at (${p800b.x}, ${p800b.y}) is ${want750}`);
  const p200 = await find('ivt', 'np05', '(v) => v !== null && v >= 120 && v < 240', 2);
  assert.ok(p200, 'the fixture has an IVT area under 240 in the regional view');
  const c200 = await px(p200);
  assert.deepEqual(c200, await basePx(p200), `IVT ${Math.round(p200.v)} is unfilled (the ground): ${toHex(c200)}`);
  for (const a of chunks(await window_(p200, 2))) assert.deepEqual(a.slice(0, 3), (await basePx(p200)).slice(0, 3), 'the 5 x 5 window below 250 is unfilled');
  const bands = new Set(tables.ivt.paper.map((h) => h.toLowerCase()));
  assert.ok(!bands.has(toHex(c200)));

  // ---- Rivers (Night): the Night table, still nothing under 250 ----
  await frame({ ground: 'night', t: 0, lens: 'r', theme: 'dark' });
  const n800 = toHex(await px(p800b)), nightWant = tables.ivt.night[4];
  assert.equal(n800, nightWant, `Night IVT ${Math.round(p800b.v)}: ${n800}, table ${nightWant}`);
  assert.deepEqual(await px(p200), await basePx(p200), 'Night: under 250 is unfilled');

  // ---- Rivers: the 250-step contours are labelled when switched on ----
  const on = await frame({ ground: 'paper', t: 0, lens: 'r', overlays: { contours: true } });
  assert.ok(on.labels > 0, `the Rivers contours carry labels (${on.labels})`);
  const labelsOff = await frame({ ground: 'paper', t: 0, lens: 'r', overlays: { contours: false } });
  assert.equal(labelsOff.labels, 0, 'the contours overlay switches the lines and their labels off');

  // ---- Air mass (Paper): REF-26 bins, no fill inside +-1 C ----
  await frame({ ground: 'paper', t: 0, lens: 'a' });
  const warm = await find('t850a', 'g1', '(v) => v !== null && v >= 1.3 && v < 2.7', 2);
  const calm = await find('t850a', 'g1', '(v) => v !== null && Math.abs(v) < 0.8', 2);
  assert.ok(warm, 'a +1.3 to +2.7 C area at 0 h'); assert.ok(calm, 'a near-normal area at 0 h');
  assert.equal(toHex(await px(warm)), '#fea998', `+${warm.v.toFixed(1)} C is the 1 to 3 band`);
  assert.deepEqual(await px(calm), await basePx(calm), `${calm.v.toFixed(1)} C (inside +-1 C) is unfilled`);
  await frame({ ground: 'paper', t: 72, lens: 'a' });
  const hot = await find('t850a', 'g1', '(v) => v !== null && v > 10.5', 2);
  assert.ok(hot, 'a +10.5 C or more area at 72 h');
  assert.equal(toHex(await px(hot)), '#580b00', `+${hot.v.toFixed(1)} C is the top band`);

  // ---- Terrain: the masked block is hatch or ground, never a temperature band ----
  for (const [ground, theme, ink] of [['paper', 'light', '#1A1D21'], ['night', 'dark', '#E6E9ED']]) {
    for (const t of [0, 72]) {
      await frame({ ground, theme, t, lens: 'a' });
      const block = await page.eval(`(async () => {
        const d = window.__wse.data, g = await import('/js/data/grid.js'), { mv, W, H, t } = window.__fb.last, m = d.getManifest(), D = m.domains.g1, arr = d.fieldAt('t850a', 'g1', t);
        const nan = (x, y) => { const ll = mv.invert([x + 0.5, y + 0.5]), q = ll && g.toGrid(D, ll[0], ll[1]); return !!q && Number.isNaN(g.bilinear(arr, D, q[0], q[1], NaN)); };
        let best = null;
        for (let y = 12; y < H - 12; y += 4) for (let x = 12; x < W - 12; x += 4) {
          let ok = true;
          for (let dy = -10; dy <= 10 && ok; dy += 2) for (let dx = -10; dx <= 10 && ok; dx += 2) ok = nan(x + dx, y + dy);
          if (ok) { best = { x, y }; break; }
        }
        return best;
      })()`);
      assert.ok(block, `${ground} ${t} h: the fixture's no-data block is in the regional view (a 21 px square inside it)`);
      const cs = chunks(await page.eval(`window.__fb.win(${block.x}, ${block.y}, 10)`));
      const inkRGB = rgbOf(ink), A = ground === 'night' ? 0.2 : 0.18;
      const gr = (await basePx(block)).slice(0, 3);
      // a hatch pixel lies on the ramp from the ground (0) to the ink at its alpha A (a line's anti-aliased edge is part-way)
      const frac = (c) => { const f = [0, 1, 2].filter((i) => Math.abs(inkRGB[i] - gr[i]) > 20).map((i) => (c[i] - gr[i]) / (inkRGB[i] - gr[i])); return f.length && Math.max(...f) - Math.min(...f) < 0.06 ? f.reduce((a, b) => a + b) / f.length : NaN; };
      const fr = cs.map(frac);
      const bare = cs.filter((c, i) => same(c, gr) || (fr[i] > -0.02 && fr[i] < 0.2 * A));
      const hatched = cs.filter((c, i) => fr[i] >= 0.2 * A && fr[i] <= A + 0.02);
      const bandHexes = [...tables.t850a.paper, ...tables.t850a.night].map((h) => h.toLowerCase());
      for (const c of cs) assert.ok(!bandHexes.includes(toHex(c)), `${ground} ${t} h: a masked pixel is the temperature band ${toHex(c)}`);
      assert.equal(hatched.length + bare.length, cs.length, `${ground} ${t} h: every masked pixel is the ground or the hatch ink over it`);
      const share = hatched.length / cs.length;
      assert.ok(share > 0.08 && share < 0.45, `${ground} ${t} h: the hatch covers ${(share * 100).toFixed(0)}% of the block (a hatch, not a fill)`);
      console.log(`  ${ground} ${t} h: masked block at (${block.x}, ${block.y}): ${hatched.length} hatch, ${bare.length} ground of ${cs.length}`);
    }
  }

  // ---- Terrain at a phone-shaped frame: the hatch covers the whole masked area, including where the block meets the right edge ----
  // (W = 390 is not a multiple of the 4 px cell step: a run reaching the right edge was once dropped, leaving the block bare)
  for (const [ground, theme] of [['paper', 'light'], ['night', 'dark']]) {
    await frame({ ground, theme, t: 0, lens: 'a', W: 390, H: 796 });
    const r = await page.eval(`(async () => {
      const d = window.__wse.data, g = await import('/js/data/grid.js'), { ctx, mv, W, H, t } = window.__fb.last, m = d.getManifest(), D = m.domains.g1, arr = d.fieldAt('t850a', 'g1', t);
      const img = ctx.getImageData(0, 0, W, H).data, base = window.__fb.base.data;
      const BAND = 40, bands = [];
      let edgeMasked = 0, edgeHatched = 0;
      for (let y0 = 0; y0 < H; y0 += BAND) {
        let masked = 0, hatched = 0;
        for (let y = y0; y < Math.min(H, y0 + BAND); y++) for (let x = 0; x < W; x++) {
          const ll = mv.invert([x + 0.5, y + 0.5]), q = ll && g.toGrid(D, ll[0], ll[1]);
          if (!q || !Number.isNaN(g.bilinear(arr, D, q[0], q[1], NaN))) continue;
          masked++;
          const i = (y * W + x) * 4, ch = img[i] !== base[i] || img[i + 1] !== base[i + 1] || img[i + 2] !== base[i + 2];
          if (ch) hatched++;
          if (x >= W - 12) { edgeMasked++; if (ch) edgeHatched++; }
        }
        bands.push({ y0, masked, hatched });
      }
      return { bands, edgeMasked, edgeHatched };
    })()`);
    const big = r.bands.filter((b) => b.masked >= 400);
    assert.ok(big.length >= 2, `${ground} 390x796: the masked block spans at least two 40 px bands (${JSON.stringify(r.bands.map((b) => b.masked))})`);
    for (const b of big) {
      const share = b.hatched / b.masked;
      assert.ok(share > 0.08 && share < 0.45, `${ground} 390x796: rows ${b.y0}-${b.y0 + 39}: the hatch covers ${(share * 100).toFixed(0)}% of ${b.masked} masked px (a hatch across the whole block)`);
    }
    if (r.edgeMasked >= 100) assert.ok(r.edgeHatched / r.edgeMasked > 0.08, `${ground} 390x796: the masked strip at the right edge is hatched (${r.edgeHatched} of ${r.edgeMasked})`);
    console.log(`  ${ground} 390x796: ${big.length} bands of masked ground, hatch share ${big.map((b) => Math.round(100 * b.hatched / b.masked)).join('/')}%, right edge ${r.edgeHatched}/${r.edgeMasked}`);
  }

  // ---- the Air mass context lines are grey, thin and unlabelled-bold: drawn with the lens' own tone ----
  const ctxOn = await frame({ ground: 'paper', t: 0, lens: 'a', overlays: { contours: true } });
  assert.ok(ctxOn.labels > 0, 'the Air mass height lines are labelled');
  // on rendered pixels: where the fill leaves the ground bare, a line pixel is the ground plus contextContour at its alpha
  // (tokens ink and alpha), not the Pattern lens' full contour ink (and, on Night, not its dark casing)
  const ctk = await page.eval(`import('/js/render/chart-tokens.js').then((m) => m.CHART)`);
  for (const [ground, theme] of [['paper', 'light'], ['night', 'dark']]) {
    const tk = ctk[ground];
    assert.ok(tk && tk.contextContour, `chart tokens carry contextContour for ${ground}`);
    const cx = tk.contextContour, inkC = rgbOf(cx.color);
    await frame({ ground, theme, t: 0, lens: 'a', overlays: { contours: false } });
    await page.eval(`window.__fb.keepBase()`);
    await page.eval(`window.__fb.render(${JSON.stringify({ ground, theme, t: 0, lens: 'a', overlays: { contours: true } })})`);
    const st = await page.eval(`(() => {
      const { ctx, W, H } = window.__fb.last, img = ctx.getImageData(0, 0, W, H).data, b = window.__fb.base.data, out = [];
      for (let i = 0; i < img.length; i += 4) if (img[i] !== b[i] || img[i + 1] !== b[i + 1] || img[i + 2] !== b[i + 2]) out.push([b[i], b[i + 1], b[i + 2], img[i], img[i + 1], img[i + 2]]);
      return out;
    })()`);
    // a pixel's share of the ramp from what was under it to the context ink
    const fr = st.map((q) => { const f = [0, 1, 2].filter((i) => Math.abs(inkC[i] - q[i]) > 25).map((i) => (q[3 + i] - q[i]) / (inkC[i] - q[i])); return f.length && Math.max(...f) - Math.min(...f) < 0.08 ? f.reduce((a, c) => a + c) / f.length : NaN; });
    assert.ok(st.length > 200, `${ground}: the Air mass contours changed ${st.length} pixels`);
    const onRamp = fr.filter((f) => f > 0.02 && f <= cx.alpha + 0.03).length;
    const full = fr.filter((f) => f > cx.alpha + 0.12).length;
    const solid = fr.filter((f) => f >= cx.alpha * 0.8 && f <= cx.alpha + 0.03).length;
    assert.ok(solid > 40, `${ground}: line pixels sit at the contextContour alpha ${cx.alpha} of ${cx.color} (${solid} of ${st.length})`);
    assert.ok(full < 0.1 * st.length, `${ground}: no heavy ink: ${full} of ${st.length} changed pixels are past alpha ${cx.alpha} toward ${cx.color} (the Pattern contour ink and casing are not used)`);
    console.log(`  ${ground} context lines: ${solid} pixels at alpha ${cx.alpha}, ${onRamp} on the ramp, ${full} heavier, of ${st.length}`);
  }
}
