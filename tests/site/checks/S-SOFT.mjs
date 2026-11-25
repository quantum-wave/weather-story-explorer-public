// S-SOFT (N24 LOOK): the map's colours default to the Soft family and the Display menu's "Map colors" switches every consumer to
// the Reference (ECMWF) family and back, kept for the next visit. Measured on RENDERED PIXELS of the real compose() and on the DOM.
//
//   - a fresh profile: store.colors is 'soft', the menu's Map colors group has Soft checked;
//   - Pattern (z500a) and Jet (ws250) frames composed from the store's own state, on Paper and Night: the probes +6.9 and -13 dam
//     are exactly the Soft table's band, and no pixel anywhere is a Reference-only band hex (the frame draws one family only);
//   - the legend card's every stop is the Soft band of the active ground; the timeline track cells are Soft bands;
//   - a real click on Reference (ECMWF): the same probes are the ECMWF hex (#fe9400, #00a7fe), the legend stops, the track and a
//     share's legend model follow, the choice is saved, and it survives a reload; a click on Soft brings Soft back.
//   - the LIVE #map canvas, read right after that click with no other store change: the +6.9 dam probe and the whole canvas turn
//     from Soft to Reference (the renderer redraws on `colors` alone, so the map never disagrees with the legend);
// Known-positive mutants: drop `colors` from compose's raster spec (the map stays Soft under Reference), drop it from
// legendModel (the legend stays Soft), or drop it from render/index.js REDRAW_KEYS (the live map stays Soft) — each fails here.
import * as inp from '../lib/input.mjs';

export const id = 'S-SOFT';
export const freshProfile = true;
export const timeoutMs = 150000;
export const data = 'synthetic-15d';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
const toHex = (c) => '#' + c.slice(0, 3).map(hex2).join('');

// In the page: compose a frame from the store's state (its colours, lens and ground) into a canvas; read pixels and colour counts.
const SETUP = `(() => {
  if (window.__fs) return true;
  const fs = window.__fs = { scene: null, last: null };
  fs.render = async ({ lens, ground, t = 0, W = 1000, H = 600 }) => {
    const { makeScene } = await import('/js/render/compose.js');
    fs.scene ||= makeScene();
    const bm = await import('/js/render/basemap.js');
    for (let i = 0; i < 100 && !bm.basemapData(); i++) await new Promise((r) => setTimeout(r, 50));
    fs.geo ||= bm.basemapData();
    const d = window.__wse.data;
    await Promise.all(['z500a', 'z500sd', 'z500', 'ws250'].flatMap((f) => ['np05', 'g1'].map((dm) => d.ensure(f, dm, t).catch(() => null))));
    bm.setBasemap(null); // the field alone: the probes are not read through coast ink
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const mv = fs.scene.viewFor('np', W, H);
    const s = { ...window.__wse.store.get(), t, view: 'np', lens, ground, overlays: { contours: false, marks: false, doubt: false } };
    fs.scene.compose(ctx, mv, { s, dpr: 1, quality: 'rest', alpha: 1, force: true });
    fs.last = { ctx, mv, W, H };
    bm.setBasemap(fs.geo);
    return true;
  };
  fs.px = (lon, lat) => { const p = fs.last.mv.project([lon, lat]); return p && Array.from(fs.last.ctx.getImageData(Math.floor(p[0]), Math.floor(p[1]), 1, 1).data); };
  // the live #map canvas: hex counts at a probe's neighbourhood (renderer.project is CSS px) and over the whole canvas
  fs.live = (lon, lat, hexes, r = 6) => { const cv = document.getElementById('map'), c = cv.getContext('2d'), sc = cv.width / cv.clientWidth;
    const p = window.__wse.renderer.project([lon, lat]), want = new Set(hexes), hx = (d, i) => '#' + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    let near = 0, all = 0; const nd = c.getImageData(Math.round(p[0] * sc) - r, Math.round(p[1] * sc) - r, 2 * r + 1, 2 * r + 1).data;
    for (let i = 0; i < nd.length; i += 4) if (want.has(hx(nd, i))) near++;
    const d = c.getImageData(0, 0, cv.width, cv.height).data; for (let i = 0; i < d.length; i += 4) if (want.has(hx(d, i))) all++;
    return { near, all };
  };
  fs.count = (hexes) => { const d = fs.last.ctx.getImageData(0, 0, fs.last.W, fs.last.H).data, want = new Set(hexes); let n = 0;
    for (let i = 0; i < d.length; i += 4) { const h = '#' + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join(''); if (want.has(h)) n++; } return n; };
  return true;
})()`;

export async function run({ page, baseUrl, assert }) {
  await page.setViewport(1280, 800, 1);
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.data.getManifest() !== null', { timeout: 45000 });
  await sleep(400);
  await page.eval(SETUP);
  const probes = await page.eval(`window.__wse.data.getManifest().probes.filter((p) => p.field === 'z500a' && p.domain === 'np05' && p.step === 0).map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, dam: p.value / 10 }))`);
  const probe = (n) => { const p = probes.find((q) => q.name === n); assert.ok(p, 'fixture probe ' + n); return p; };
  const P69 = probe('band+6.9dam'), N13 = probe('band-13dam');
  const tables = await page.eval(`import('/js/render/palette.js').then((m) => Object.fromEntries(['z500a', 'ws250'].map((id) => [id, m.PALETTES[id].tables])))`);
  const pal = (id, fam, g) => tables[id][fam][g];
  const bandHex = (fam, g, dam) => page.eval(`import('/js/render/palette.js').then((m) => { const c = m.bandRGBA('z500a', ${dam}, '${g}', '${fam}'); return '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join(''); })`);
  // the Jet lens' isotach and jet-outline ink is drawn in two ECMWF jet greens (lenses/jet.js, compose.js): line ink, not a fill
  const LINE_INK = ['#00724b', '#a7e700'];
  const onlyIn = (a, b) => a.filter((h) => !b.includes(h) && !LINE_INK.includes(h));
  const chooseGround = async (g) => { await page.eval(`window.__wse.store.set({ ground: '${g}' }); true`); await sleep(250); };

  // ---- the default: Soft ----
  assert.equal(await page.eval(`window.__wse.store.get().colors`), 'soft', 'a fresh profile draws Soft');
  await inp.click(page, '#btn-display'); await sleep(250);
  const menu = await page.eval(`(() => { const g = document.querySelector('#display-menu [data-group="colors"]'); return g && { label: g.querySelector('.menu-label').textContent.trim(), opts: [...g.querySelectorAll('.menu-opt')].map((b) => [b.dataset.value, b.textContent.trim(), b.getAttribute('aria-checked')]) }; })()`);
  assert.ok(menu, 'the Display menu has a Map colors group');
  assert.equal(menu.label, 'Map colors');
  assert.deepEqual(menu.opts, [['soft', 'Soft', 'true'], ['reference', 'Reference (ECMWF)', 'false']]);
  await inp.key(page, null, 'Escape'); await sleep(200);

  /** One family, both grounds: the probes, the whole frame's colours, the legend stops and the track cells. */
  async function expectFamily(fam) {
    const other = fam === 'soft' ? 'reference' : 'soft';
    for (const g of ['paper', 'night']) {
      await chooseGround(g);
      await page.eval(`window.__fs.render({ lens: 'z', ground: '${g}' })`);
      for (const p of [P69, N13]) {
        const want = await bandHex(fam, g, p.dam), got = toHex(await page.eval(`window.__fs.px(${p.lon}, ${p.lat})`));
        assert.equal(got, want, `${fam} ${g} Pattern ${p.name}: rendered ${got}, want the ${fam} band ${want}`);
      }
      const zOwn = await page.eval(`window.__fs.count(${JSON.stringify(pal('z500a', fam, g))})`), zOther = await page.eval(`window.__fs.count(${JSON.stringify(onlyIn(pal('z500a', other, g), pal('z500a', fam, g)))})`);
      assert.ok(zOwn > 20000 && zOther === 0, `${fam} ${g} Pattern frame: ${zOwn} px in ${fam} bands, ${zOther} px in ${other}-only bands`);
      await page.eval(`window.__fs.render({ lens: 'j', ground: '${g}' })`);
      const jOwn = await page.eval(`window.__fs.count(${JSON.stringify(pal('ws250', fam, g))})`), jOther = await page.eval(`window.__fs.count(${JSON.stringify(onlyIn(pal('ws250', other, g), pal('ws250', fam, g)))})`);
      assert.ok(jOwn > 2000 && jOther === 0, `${fam} ${g} Jet frame: ${jOwn} px in ${fam} bands, ${jOther} px in ${other}-only bands`);
      console.log(`  ${fam} ${g}: Pattern ${zOwn} px own / ${zOther} other; Jet ${jOwn} px own / ${jOther} other`);
      // the legend card (Pattern, then Jet) and the timeline track
      for (const [lens, id] of [['z', 'z500a'], ['j', 'ws250']]) {
        await page.eval(`window.__wse.store.set({ lens: '${lens}' }); true`); await sleep(300);
        const stops = await page.eval(`[...document.querySelectorAll('#map-legend .mlg-stop:not(.gap)')].map((s) => s.dataset.hex)`);
        assert.ok(stops.length >= 5, `${fam} ${g} ${id}: legend has stops`);
        assert.equal(await page.eval(`document.getElementById('map-legend').dataset.colors`), fam);
        assert.ok(stops.every((h) => pal(id, fam, g).includes(h)), `${fam} ${g} ${id}: every legend stop is a ${fam} band (${stops.filter((h) => !pal(id, fam, g).includes(h)).join(' ')})`);
      }
      await page.eval(`window.__wse.store.set({ lens: 'z' }); true`); await sleep(300);
      const cells = await page.eval(`[...document.querySelectorAll('#timeline .tl-cell')].map((e) => e.dataset.rgb).filter(Boolean)`);
      const asHex = (s) => '#' + s.split(',').map((v) => (+v).toString(16).padStart(2, '0')).join('');
      assert.ok(cells.length > 0, 'the track has band cells');
      assert.ok(cells.every((c) => pal('z500a', fam, g).includes(asHex(c))), `${fam} ${g}: every track cell is a ${fam} band`);
      const share = await page.eval(`import('/js/share/meta.js').then((m) => { const l = m.shareMeta(window.__wse.store.get()).legend; return { colors: l.colors, first: l.bar.find((b) => !b.gap).color }; })`);
      assert.equal(share.colors, fam, `${fam} ${g}: a share's legend is ${fam}`);
      assert.ok(pal('z500a', fam, g).includes(share.first), `${fam} ${g}: a share's legend draws ${fam} bands`);
    }
  }
  await expectFamily('soft');

  // ---- Reference (ECMWF) by a real click; the live map follows at once; the ECMWF hex at the probes on Paper ----
  await page.eval(`window.__wse.store.set({ t: 0, playing: false, lens: 'z', ground: 'paper' }); true`); await sleep(1200); // the live map at rest, Soft Paper Pattern, the probes' step
  const softOnly = onlyIn(pal('z500a', 'soft', 'paper'), pal('z500a', 'reference', 'paper')), refOnly = onlyIn(pal('z500a', 'reference', 'paper'), pal('z500a', 'soft', 'paper'));
  const softP69 = await bandHex('soft', 'paper', P69.dam);
  const liveBefore = { soft: await page.eval(`window.__fs.live(${P69.lon}, ${P69.lat}, ${JSON.stringify([softP69])})`), ref: await page.eval(`window.__fs.live(${P69.lon}, ${P69.lat}, ${JSON.stringify(refOnly)})`), softAll: await page.eval(`window.__fs.live(${P69.lon}, ${P69.lat}, ${JSON.stringify(softOnly)})`) };
  assert.ok(liveBefore.soft.near > 20 && liveBefore.softAll.all > 20000 && liveBefore.ref.all === 0, `live map before the click is Soft: ${JSON.stringify(liveBefore)}`);
  await inp.click(page, '#btn-display'); await sleep(250);
  await inp.click(page, '#display-menu [data-group="colors"] button[data-value="reference"]'); await sleep(300);
  assert.equal(await page.eval(`document.querySelector('#display-menu [data-group="colors"] button[data-value="reference"]').getAttribute('aria-checked')`), 'true');
  await inp.key(page, null, 'Escape'); await sleep(400);
  const liveAfter = { ref: await page.eval(`window.__fs.live(${P69.lon}, ${P69.lat}, ['#fe9400'])`), refAll: await page.eval(`window.__fs.live(${P69.lon}, ${P69.lat}, ${JSON.stringify(refOnly)})`), soft: await page.eval(`window.__fs.live(${P69.lon}, ${P69.lat}, ${JSON.stringify(softOnly)})`) };
  console.log(`  live #map: before ${JSON.stringify(liveBefore)}; after ${JSON.stringify(liveAfter)}`);
  assert.ok(liveAfter.ref.near > 20, `the live map at +6.9 dam turns ECMWF #fe9400 right after the click (${liveAfter.ref.near} px of 169)`);
  assert.ok(liveAfter.refAll.all > 20000 && liveAfter.soft.all === 0, `the live map redraws in Reference alone: ${liveAfter.refAll.all} px Reference-only, ${liveAfter.soft.all} px Soft-only`);
  assert.equal(await page.eval(`window.__wse.store.get().colors`), 'reference');
  assert.equal(await page.eval(`JSON.parse(localStorage.getItem('wse.v1.prefs')).colors`), 'reference', 'the choice is saved');
  await chooseGround('paper');
  await page.eval(`window.__fs.render({ lens: 'z', ground: 'paper' })`);
  assert.equal(toHex(await page.eval(`window.__fs.px(${P69.lon}, ${P69.lat})`)), '#fe9400', 'Reference Paper +6.9 dam is ECMWF #fe9400');
  assert.equal(toHex(await page.eval(`window.__fs.px(${N13.lon}, ${N13.lat})`)), '#00a7fe', 'Reference Paper -13 dam is ECMWF #00a7fe');
  await expectFamily('reference');

  // ---- kept for the next visit ----
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 45000 });
  assert.equal(await page.eval(`window.__wse.store.get().colors`), 'reference', 'Reference survives a reload');
  await inp.click(page, '#btn-display'); await sleep(250);
  await inp.click(page, '#display-menu [data-group="colors"] button[data-value="soft"]'); await sleep(300);
  await inp.key(page, null, 'Escape'); await sleep(200);
  assert.equal(await page.eval(`window.__wse.store.get().colors`), 'soft', 'and Soft comes back on a click');
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
}
