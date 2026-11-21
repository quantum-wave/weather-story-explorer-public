// S-LAYERS (W4-01, Josh points 15, 13 and 5; design spec 6.1, 11.4): the Layers panel lists the finished lenses as radio rows and the six overlays
// as switches. Real clicks only (input.mjs). Choosing each listed lens must change the legend's title, unit and tick count to the palette's
// own, and redraw the chart (a probe of the canvas changes) within 500 ms (before this package a lens change left a stale frame); the Uncertain
// areas switch is locked on beyond day 7 with its reason; a lens whose field is not in the run is disabled with a data reason and no other
// words ("Coming soon" never appears); on the phone the panel is the one sheet and on the desktop a popover that never meets the timeline
// (4 px of slack); the canvas legend a share draws says what the DOM legend says (title, unit, every tick, the sentence).
import * as inp from '../lib/input.mjs';

export const id = 'S-LAYERS';
export const freshProfile = true;
export const timeoutMs = 180000;
export const data = ['synthetic-15d', 'synthetic'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MS_BUDGET = 500;

async function boot(page, baseUrl, w, h) {
  await page.setViewport(w, h, 1);
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true && !!document.querySelector("#map-legend .mlg-title")', { timeout: 30000 });
  await sleep(500);
}
const rect = (page, sel) => page.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; })()`);
/** A 24 x 14 grid of canvas pixels as one string: any visible redraw changes it. */
const PROBE = `(() => { const c = document.getElementById('map'), x = c.getContext('2d'); let s = ''; for (let j = 1; j < 14; j++) for (let i = 1; i < 24; i++) { const d = x.getImageData(Math.floor(c.width * i / 24), Math.floor(c.height * j / 14), 1, 1).data; s += d[0] + ',' + d[1] + ',' + d[2] + ',' + d[3] + ';'; } return s; })()`;
const openPanel = async (page) => {
  if (await page.eval(`document.getElementById('layers-panel').hidden`)) { await inp.click(page, '#btn-layers'); await page.waitFor(`!document.getElementById('layers-panel').hidden`, { timeout: 3000 }); await sleep(350); }
};

export async function run({ page, baseUrl, assert, fixture }) {
  for (const [vp, w, h] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
    const at = `${fixture} ${vp}`;
    await boot(page, baseUrl, w, h);
    const m = await page.eval('__wse.data.getManifest()');
    const listed = await page.eval(`import('/js/lenses/index.js').then((L) => L.listed().map((l) => ({ code: l.code, name: l.name, blurb: l.blurb, avail: l.available(__wse.data.getManifest()) })))`);
    assert.ok(listed.length >= 6, `${at}: all six lenses are finished and listed (${listed.map((l) => l.code)})`);

    // ---------- the panel: radio rows for the listed lenses, six switches, nothing unfinished ----------
    await openPanel(page);
    const rows = await page.eval(`[...document.querySelectorAll('#layers-panel [role=radio]')].map((b) => ({ code: b.dataset.lens, on: b.getAttribute('aria-checked'), disabled: b.disabled, name: b.querySelector('.lyr-name').textContent.replace('Showing', ''), sub: b.querySelector('.lyr-sub').textContent, swatch: b.querySelectorAll('.lyr-swatch i').length }))`);
    assert.deepEqual(rows.map((r) => r.code), listed.map((l) => l.code), `${at}: one radio row per listed lens, in the registry's order`);
    assert.equal(rows.filter((r) => r.on === 'true').length, 1, `${at}: exactly one lens is on`);
    const sw = await page.eval(`[...document.querySelectorAll('#layers-panel [role=switch]')].map((b) => b.dataset.overlay)`);
    assert.deepEqual(sw, ['contours', 'marks', 'doubt', 'jetline', 'pins', 'places'], `${at}: six overlay switches`);
    assert.ok(!/coming soon/i.test(await page.eval('document.body.innerText')), `${at}: "Coming soon" appears nowhere`);
    for (const r of rows) {
      const want = listed.find((l) => l.code === r.code);
      if (want.avail.ok) assert.ok(!r.disabled && r.sub === want.blurb && r.swatch > 1, `${at}: ${r.code} is chosen with its blurb and a swatch strip: ${JSON.stringify(r)}`);
      else assert.ok(r.disabled && r.sub === want.avail.reason && /^(Not in this run|Arrives with the 00Z run)$/.test(r.sub) && r.swatch === 0, `${at}: ${r.code} is disabled with a data reason only: ${JSON.stringify(r)}`);
    }

    // ---------- placement: the sheet on the phone, a popover on the desktop, never meeting the timeline ----------
    const inSheet = await page.eval(`!!document.querySelector('.wse-sheet #layers-panel')`);
    assert.equal(inSheet, vp === 'phone', `${at}: the panel is in the sheet on the phone and a popover on the desktop`);
    const pr = await rect(page, inSheet ? '.wse-sheet' : '#layers-panel'), tl = await rect(page, '#timeline');
    if (vp === 'desktop') {
      const st = await rect(page, '#stage');
      assert.ok(pr.b <= tl.y - 4 && pr.x >= st.x - 0.5 && pr.r <= st.r + 0.5 && pr.y >= st.y - 0.5, `${at}: the popover is inside the stage and 4 px clear of the timeline (panel ${JSON.stringify(pr)}, timeline ${JSON.stringify(tl)})`);
    } else {
      // a sheet is above the page, so it is not "clear of" the timeline: what must hold is that nothing covers or clips it
      const top = await page.eval(`(() => { const r = document.querySelector('.wse-sheet').getBoundingClientRect(); return [[r.left + 8, r.top + 8], [r.right - 8, r.top + 8], [r.left + r.width / 2, r.top + r.height / 2], [r.left + 8, r.bottom - 8], [r.right - 8, r.bottom - 8]].map(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.wse-sheet')); })()`);
      assert.deepEqual(top, [true, true, true, true, true], `${at}: the sheet is fully on top: nothing, the timeline included, covers or clips it`);
      assert.ok(pr.y >= -0.5 && pr.b <= 844 + 0.5, `${at}: the sheet is inside the viewport (${JSON.stringify(pr)})`);
    }

    // ---------- each lens: legend title, unit and tick count are the palette's own, and the chart redraws within 500 ms ----------
    let before = await page.eval(PROBE);
    for (const l of listed.filter((x) => x.avail.ok)) {
      if (l.code === (await page.eval(`__wse.store.get().lens ?? 'z'`))) continue;
      await openPanel(page);
      await inp.click(page, `#layers-panel [data-lens="${l.code}"]`);
      const want = await page.eval(`(async () => { const P = await import('/js/render/palette.js'), M = await import('/js/ui/maplegend.js'); const s = __wse.store.get();
        const fill = P.LENS_FIELDS[s.lens].fill, spec = P.legendSpec(fill, M.groundOf(s), null, null, s.units); return { lens: s.lens, fill, title: spec.title, unit: spec.unit, ticks: spec.ticks.length }; })()`);
      assert.equal(want.lens, l.code, `${at}: the click chose ${l.code}`);
      const t0 = Date.now();
      await page.waitFor(`document.querySelector('#map-legend .mlg-title')?.textContent === ${JSON.stringify(want.title)}`, { timeout: MS_BUDGET }).catch(() => { throw new Error(`${at}: ${l.code}: the legend title did not become "${want.title}" within ${MS_BUDGET} ms `); });
      const got = await page.eval(`({ title: document.querySelector('#map-legend .mlg-title').textContent, unit: document.querySelector('#map-legend .mlg-unit-name').textContent, ticks: document.querySelectorAll('#map-legend .mlg-tick').length, checked: document.querySelector('#layers-panel [data-lens="${l.code}"]').getAttribute('aria-checked') })`);
      assert.deepEqual([got.title, got.unit, got.ticks], [want.title, want.unit, want.ticks], `${at}: ${l.code}: legend title, unit and tick count are the palette's`);
      assert.equal(got.checked, 'true', `${at}: ${l.code}: its row reports it on`);
      await page.waitFor(`(${PROBE}) !== ${JSON.stringify(before)}`, { timeout: Math.max(50, MS_BUDGET - (Date.now() - t0)) }).catch(() => { throw new Error(`${at}: ${l.code}: the chart did not redraw within ${MS_BUDGET} ms of the click (stale frame)`); });
      await sleep(400);
      before = await page.eval(PROBE);
    }
    assert.equal(await page.eval(`document.querySelector('#layers-panel [role=radio][aria-checked=true]').dataset.lens`), listed.filter((x) => x.avail.ok).slice(-1)[0].code, `${at}: the last choice is the one row on`);

    // ---------- the overlays: a switch flips its store flag; Uncertain areas is locked on beyond day 7, with its reason ----------
    await page.eval(`__wse.store.set({ lens: 'z', t: 0 })`); await sleep(300);
    await openPanel(page);
    for (const key of ['contours', 'jetline']) {
      const was = await page.eval(`__wse.store.get().overlays.${key}`);
      await inp.click(page, `#layers-panel [data-overlay="${key}"]`); await sleep(200);
      assert.equal(await page.eval(`__wse.store.get().overlays.${key}`), !was, `${at}: the ${key} switch flips the flag`);
      assert.equal(await page.eval(`document.querySelector('#layers-panel [data-overlay="${key}"]').getAttribute('aria-checked')`), String(!was), `${at}: and reports it`);
      await inp.click(page, `#layers-panel [data-overlay="${key}"]`); await sleep(150);
    }
    const doubt = () => page.eval(`(() => { const b = document.querySelector('#layers-panel [data-overlay="doubt"]'); return { on: b.getAttribute('aria-checked'), locked: b.getAttribute('aria-disabled'), sub: b.querySelector('.lyr-sub').textContent, flag: __wse.store.get().overlays.doubt }; })()`);
    await inp.click(page, '#layers-panel [data-overlay="doubt"]'); await sleep(200);
    assert.equal((await doubt()).flag, false, `${at}: within day 7 the Uncertain areas switch turns off`);
    await inp.click(page, '#layers-panel [data-overlay="doubt"]'); await sleep(200);
    const last = Math.max(...m.fields.z500a.steps);
    if (last > 168) {
      await page.eval(`__wse.store.set({ t: 200 })`); await inp.click(page, '#layers-panel [data-overlay="doubt"]'); await sleep(150);
      await page.eval(`__wse.store.set({ overlays: { doubt: false } })`); await sleep(250);
      const d = await doubt();
      assert.deepEqual([d.on, d.locked], ['true', 'true'], `${at}: beyond 168 h Uncertain areas reads on and locked: ${JSON.stringify(d)}`);
      assert.ok(/day 7/.test(d.sub), `${at}: and says why: "${d.sub}"`);
      await inp.click(page, '#layers-panel [data-overlay="doubt"]'); await sleep(150);
      assert.equal((await doubt()).on, 'true', `${at}: a click on the locked switch changes nothing`);
      await page.eval(`__wse.store.set({ t: 0, overlays: { doubt: true } })`); await sleep(200);
    }

    // ---------- the canvas legend of a share says what the DOM legend says ----------
    const canv = await page.eval(`(async () => { const { drawLegend } = await import('/js/render/legend.js'); const M = await import('/js/ui/maplegend.js');
      const out = {};
      for (const lens of ['z', 'j', 's', 'a', 'r', 'c']) {
        __wse.store.set({ lens }); await new Promise((r) => setTimeout(r, 60));
        const texts = []; const c = document.createElement('canvas'); c.width = 1080; c.height = 600; const x = c.getContext('2d'); const ft = x.fillText.bind(x); x.fillText = (s, ...a) => { texts.push(String(s)); return ft(s, ...a); };
        const hgt = drawLegend(x, { x: 48, y: 10, width: 984, lens, ground: M.groundOf(__wse.store.get()), state: __wse.store.get(), manifest: __wse.data.getManifest() });
        out[lens] = { texts, hgt, title: document.querySelector('#map-legend .mlg-title').textContent, unit: document.querySelector('#map-legend .mlg-unit-name').textContent,
          ticks: [...document.querySelectorAll('#map-legend .mlg-tick')].map((t) => t.textContent), sub: document.querySelector('#map-legend .mlg-sub').textContent,
          stops: [...document.querySelectorAll('#map-legend .mlg-stop')].filter((s) => !s.classList.contains('gap')).length };
      }
      __wse.store.set({ lens: 'z' }); return out; })()`);
    for (const [lens, c] of Object.entries(canv)) {
      if (!listed.find((l) => l.code === lens)?.avail.ok) continue;
      assert.ok(c.texts.includes(c.title) && c.texts.includes(c.unit), `${at}: ${lens}: the canvas legend carries the DOM title "${c.title}" and unit "${c.unit}"`);
      for (const t of c.ticks) assert.ok(c.texts.includes(t), `${at}: ${lens}: the canvas legend has the tick "${t}"`);
      assert.equal(c.texts.filter((t) => c.ticks.includes(t)).length >= c.ticks.length, true, `${at}: ${lens}: every tick is drawn`);
      assert.ok(c.texts.some((t) => c.sub.startsWith(t.split(' ').slice(0, 3).join(' '))), `${at}: ${lens}: the plain-words sentence is drawn`);
      assert.ok(c.hgt > 90 && c.hgt < 420, `${at}: ${lens}: height ${c.hgt}`);
    }

    // ---------- a lens that is not finished is not listed: no row, no name, no wording about it ----------
    await page.eval(`import('/js/lenses/index.js').then((L) => { window.__unbuilt = L.lens('c'); window.__unbuilt.implemented = false; __wse.store.set({ units: __wse.store.get().units === 'us' ? 'metric' : 'us' }); __wse.store.set({ units: 'metric' }); })`);
    await sleep(250);
    const unlisted = await page.eval(`({ row: !!document.querySelector('#layers-panel [data-lens="c"]'), rows: document.querySelectorAll('#layers-panel [role=radio]').length, text: document.getElementById('layers-panel').textContent })`);
    assert.equal(unlisted.row, false, `${at}: a lens with implemented:false has no row`);
    assert.equal(unlisted.rows, listed.length - 1, `${at}: the other lenses are still listed`);
    assert.ok(!/confidence|coming soon|soon/i.test(unlisted.text), `${at}: the panel does not mention the unfinished lens: ${unlisted.text.slice(0, 120)}`);
    await page.eval(`window.__unbuilt.implemented = true; __wse.store.set({ units: 'us' }); __wse.store.set({ units: 'metric' })`);
    await sleep(250);

    // ---------- closing: Escape (or the sheet's close) leaves the Layers button focused and the panel hidden ----------
    await inp.key(page, null, 'Escape'); await sleep(450);
    assert.equal(await page.eval(`document.getElementById('layers-panel').hidden`), true, `${at}: Escape closes the panel`);
    assert.equal(await page.eval(`document.getElementById('btn-layers').getAttribute('aria-expanded')`), 'false', `${at}: the button says so`);
    assert.equal(await page.eval(`!!document.querySelector('.wse-sheet-root')`), false, `${at}: no sheet is left behind`);
    assert.equal(await page.eval(`document.getElementById('layers-panel').parentElement.id`), 'stage', `${at}: the panel is back in the stage`);

    // ---------- a lens whose field is not in the run: disabled, with the data reason, and a click does nothing ----------
    const disabled = rows.filter((r) => r.disabled);
    if (disabled.length) {
      await openPanel(page);
      const lensBefore = await page.eval(`__wse.store.get().lens ?? 'z'`);
      await inp.click(page, `#layers-panel [data-lens="${disabled[0].code}"]`).catch(() => {});
      await sleep(250);
      assert.equal(await page.eval(`__wse.store.get().lens ?? 'z'`), lensBefore, `${at}: a disabled lens (${disabled[0].code}) cannot be chosen`);
      await inp.key(page, null, 'Escape'); await sleep(450);
    }

    // ---------- worst-case placement and scroll: measured on a fresh boot of the tallest panel (Uncertain areas locked, t beyond 168 h) ----------
    const lastH = Math.max(...m.fields.z500a.steps);
    const tall = lastH > 168 ? 240 : 0;
    if (vp === 'desktop') {
      for (const [sw, sh] of [[1440, 900], [1024, 600]]) {
        await boot(page, baseUrl, sw, sh);
        await page.eval(`__wse.store.set({ t: ${tall} })`); await sleep(300);
        await openPanel(page);
        const pp = await rect(page, '#layers-panel'), tt = await rect(page, '#timeline'), ss = await rect(page, '#stage');
        const lk = await page.eval(`document.querySelector('#layers-panel [data-overlay="doubt"]').getAttribute('data-locked')`);
        if (tall) assert.equal(lk, '1', `${at}: ${sw}x${sh}: the tall state has Uncertain areas locked`);
        assert.ok(pp.b <= tt.y - 4, `${at}: ${sw}x${sh}, t=${tall}: the popover ends 4 px or more above the timeline (popover bottom ${pp.b}, timeline top ${tt.y})`);
        assert.ok(pp.y >= ss.y - 0.5 && pp.x >= ss.x - 0.5 && pp.r <= ss.r + 0.5, `${at}: ${sw}x${sh}: the popover stays inside the stage (${JSON.stringify(pp)})`);
        const reach = await page.eval(`(() => { const e = document.getElementById('layers-panel'); return e.scrollHeight - e.clientHeight; })()`);
        if (reach > 0) { // it scrolls inside its own box: the last row must be reachable
          await page.eval(`document.getElementById('layers-panel').scrollTop = 1e6`); await sleep(100);
          const lastRow = await rect(page, '#layers-panel .lyr-link'), box = await rect(page, '#layers-panel');
          assert.ok(lastRow.b <= box.b + 0.5, `${at}: ${sw}x${sh}: the popover scrolls to its last control`);
        }
      }
    } else {
      for (const [sw, sh] of [[360, 640], [390, 844]]) {
        await boot(page, baseUrl, sw, sh);
        await page.eval(`__wse.store.set({ t: ${tall} })`); await sleep(300);
        await openPanel(page);
        await sleep(300);
        const tallLens = await page.eval(`__wse.store.get().lens ?? 'z'`);
        const room = await page.eval(`(() => { const b = document.querySelector('.wse-sheet-body'); return b.scrollHeight - b.clientHeight; })()`);
        if (sh >= 800 && room <= 8) { assert.ok(true, 'a tall phone fits the whole panel'); continue; } // nothing to scroll: the 640 px phone is the one that must
        assert.ok(room > 8, `${at}: ${sw}x${sh}: the sheet scrolls (${room} px of room), so the check below is real`);
        const lensTarget = listed.filter((x) => x.avail.ok && x.code !== (tallLens ?? 'z')).slice(-1)[0].code;
        // scrolled to the bottom: tap an overlay and a lens; neither may send the sheet back to the top, and the tapped row stays in view
        for (const target of ['#layers-panel [data-overlay="jetline"]', `#layers-panel [data-lens="${lensTarget}"]`, '#layers-panel [data-overlay="contours"]']) {
          await page.eval(`document.querySelector('.wse-sheet-body').scrollTop = 1e6`); await sleep(120);
          const pt = await inp.point(page, target); // brings the row into view the way a finger would; scrollTop is read after that
          await sleep(120);
          const was = await page.eval(`document.querySelector('.wse-sheet-body').scrollTop`);
          const state = await page.eval(`document.querySelector(${JSON.stringify(target)}).getAttribute('aria-checked')`);
          await inp.click(page, pt); await sleep(350);
          const now = await page.eval(`document.querySelector('.wse-sheet-body').scrollTop`);
          const flipped = await page.eval(`document.querySelector(${JSON.stringify(target)}).getAttribute('aria-checked')`);
          const tr = await rect(page, target), br = await rect(page, '.wse-sheet-body');
          assert.ok(was > 8, `${at}: ${sw}x${sh}: ${target}: the sheet was scrolled before the tap (scrollTop ${was})`);
          assert.ok(Math.abs(now - was) <= 4, `${at}: ${sw}x${sh}: ${target}: tapping keeps the scroll position (${was} before, ${now} after)`);
          assert.ok(tr.y >= br.y - 0.5 && tr.b <= br.b + 0.5, `${at}: ${sw}x${sh}: ${target}: the tapped row stays inside the sheet's visible box (row ${tr.y}..${tr.b}, box ${br.y}..${br.b})`);
          if (target.includes('data-overlay')) assert.notEqual(flipped, state, `${at}: ${sw}x${sh}: ${target}: the tap flipped the switch`);
        }
        const lk = await rect(page, '#layers-panel .lyr-link');
        assert.ok(lk.w >= 44 && lk.h >= 44, `${at}: ${sw}x${sh}: Copy link is at least 44 x 44 (${lk.w} x ${lk.h})`);
      }
    }
    assert.deepEqual(page.errors(), [], `${at}: ${JSON.stringify(page.errors())}`);
  }
}
