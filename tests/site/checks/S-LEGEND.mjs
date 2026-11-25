// S-LEGEND (W3-11, Josh points 13 and 7): the always-visible DOM legend answers "is this the pressure pattern?" in words.
// Real clicks and taps only (input.mjs): title, "564 = 5,640 m", "dam (tens of metres)", a stepped bar whose every stop equals the
// palette hex of the active ground, ticks only at +-2 and the major edges (countable) at 12 px or more, the doubt hatch sample, the
// run line naming the ACTIVE case in the chip's own words (sample-min, case A then B), in the UI face at 12 px or more; the title
// reads whole on one line in the 320 px card, open and collapsed; a 36 px collapsed row that expands on tap (phone) and a 320 px card with a collapse control (desktop);
// text contrast >= 4.5:1 measured on screenshot pixels over the lightest and the darkest band on both grounds; works without store.lens.
import * as inp from '../lib/input.mjs';
import { decodePNG, pixel } from '../wp2/shot.mjs';

export const id = 'S-LEGEND';
export const freshProfile = true;
export const timeoutMs = 120000;
export const data = ['synthetic', 'sample-min'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// The header chip's sentence (W3-04 replaced #sample-badge with #data-chip): what "About this data" says, opened by a real click.
const chipSentence = async (page) => {
  await inp.click(page, '#data-chip'); await sleep(150);
  const t = await page.eval(`document.querySelector('#data-popover .full')?.textContent.trim() || ''`);
  await inp.click(page, '#data-chip'); await sleep(150);
  return t;
};
// The chart's ground is chosen in the Display menu (W3-04: Chart, Paper or Night), by real clicks; #btn-theme is gone.
const chooseGround = async (page, ground) => {
  await inp.click(page, '#btn-display'); await sleep(200);
  await inp.click(page, `#display-menu [data-group="chart"] button[data-value="${ground}"]`); await sleep(250);
  await inp.key(page, null, 'Escape'); await sleep(150);
};

async function boot(page, baseUrl, w, h) {
  await page.setViewport(w, h, 1);
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true && !!document.querySelector("#map-legend .mlg-title")', { timeout: 30000 });
  await sleep(300);
}
const geo = (page, sel) => page.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, text: e.textContent.trim() }; })()`);

async function caseRun(page, baseUrl, assert) {
  await boot(page, baseUrl, 1440, 900);
  const m = await page.eval('__wse.data.getManifest()');
  for (const c of ['A', 'B']) {
    if (c === 'B') { await page.eval(`document.getElementById('btn-layers').click()`); await page.eval(`document.querySelector('#layers-panel [data-lens="j"]').click()`); await sleep(400); }
    assert.equal(await page.eval('__wse.data.activeCase()'), c, 'case ' + c + ' is active');
    const [runTxt, tl] = await page.eval(`[document.querySelector('#map-legend .mlg-run').textContent, document.body.innerText]`);
    const chip = await chipSentence(page);
    const label = m.cases[c].label;
    assert.ok(runTxt.includes(label), `case ${c}: the legend run line names "${label}": "${runTxt}"`);
    assert.equal(runTxt, chip, `case ${c}: the legend run line is the header chip's sentence`);
    assert.ok(!runTxt.includes('fixtures'), `case ${c}: not the manifest-wide sample label: "${runTxt}"`);
    assert.equal((runTxt.match(/Sample data/g) || []).length, 1, `case ${c}: the dataset is named once: "${runTxt}"`);
    assert.ok(tl.includes(label), `case ${c}: the timeline names the same case`);
  }
  assert.deepEqual(page.errors(), [], JSON.stringify(page.errors()));
}

export async function run({ page, baseUrl, assert, fixture }) {
  if (fixture === 'sample-min') return caseRun(page, baseUrl, assert);
  // ---------- desktop: the words ----------
  await boot(page, baseUrl, 1440, 900);
  const text = await page.eval(`document.getElementById('map-legend').textContent`);
  for (const w of ['Pressure pattern aloft, vs normal', '500 hPa', 'tens of metres', '564 = 5,640 m', 'forecasts disagree here', '1990-2019 normal', 'faint orange']) {
    assert.ok(text.includes(w), `legend lacks "${w}": ${text}`);
  }
  assert.ok(/pressure/i.test(text), 'the word pressure appears');
  const m = await page.eval('__wse.data.getManifest()');
  const runTxt = await page.eval(`document.querySelector('#map-legend .mlg-run').textContent`);
  const chip = await chipSentence(page);
  const caseLabel = m.cases?.[await page.eval('__wse.data.activeCase()')]?.label;
  if (m.sample) {
    // the legend and the chip describe the same dataset: the run line IS the chip's sentence, which names the active case
    assert.ok(caseLabel && runTxt === chip && runTxt.includes(caseLabel) && /not a forecast/.test(runTxt), `the run line names the chip's case: "${runTxt}" vs chip "${chip}"`);
  } else {
    const run = await page.eval(`import('/js/data/kind.js').then((k) => k.runLabel(__wse.data.getManifest()))`);
    assert.ok(runTxt === run && /run/.test(run), 'live data names its run: ' + run);
  }
  // the type floor: every legend text is 12 px or more, and nothing in it is monospace (the UI face only)
  const faces = await page.eval(`[...document.querySelectorAll('#map-legend *')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => { const c = getComputedStyle(e); return { cls: e.className, px: parseFloat(c.fontSize), mono: /mono/i.test(c.fontFamily) }; })`);
  assert.ok(faces.length >= 8, 'found the legend text elements: ' + faces.length);
  for (const f of faces) assert.ok(f.px >= 12 && !f.mono, `legend text ${f.cls} is ${f.px}px mono=${f.mono}: 12 px or more, UI face`);

  // ---------- the title reads whole on one line in the 320 px card, open and collapsed ----------
  const titleFit = () => page.eval(`(() => { const t = document.querySelector('#map-legend .mlg-title'); const r = document.createRange(); r.selectNodeContents(t); return { sw: t.scrollWidth, cw: t.clientWidth, lines: r.getClientRects().length, h: t.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(t).lineHeight) }; })()`);
  for (const state of ['open', 'collapsed']) {
    const f = await titleFit();
    assert.ok(f.sw <= f.cw && f.lines === 1 && f.h <= f.lh + 1, `desktop ${state}: the title is whole on one line (scrollWidth ${f.sw}, clientWidth ${f.cw}, boxes ${f.lines}, height ${f.h})`);
    if (state === 'open') { await inp.click(page, '#map-legend .mlg-toggle'); await sleep(200); await inp.click(page, '#map-legend .mlg-toggle'); await sleep(200); await inp.click(page, '#map-legend .mlg-toggle'); await sleep(200); }
  }
  await inp.click(page, '#map-legend .mlg-toggle'); await sleep(200); // expand again for the checks below

  // ---------- desktop: size and the collapse control ----------
  const card = await geo(page, '#map-legend');
  assert.ok(Math.abs(card.w - 320) <= 1, 'desktop card is 320 px wide, got ' + card.w);
  const stage = await geo(page, '#stage');
  assert.ok(card.x >= stage.x && card.y + card.h <= stage.y + stage.h + 0.5, 'inside the map');
  assert.equal(await page.eval(`document.querySelector('#map-legend .mlg-toggle').getAttribute('aria-expanded')`), 'true', 'open by default on desktop');
  await inp.click(page, '#map-legend .mlg-toggle');
  await sleep(150);
  assert.equal(await page.eval(`document.querySelector('#map-legend .mlg-body').hidden`), true, 'a click on the collapse control collapses');
  assert.ok((await geo(page, '#map-legend')).h <= 40, 'collapsed desktop card is a single row');
  await inp.click(page, '#map-legend .mlg-toggle');
  await sleep(150);
  assert.equal(await page.eval(`document.querySelector('#map-legend .mlg-body').hidden`), false, 'a second click expands again');

  // ---------- the ticks are countable: +-2 and the major edges only ----------
  const ticks = await page.eval(`[...document.querySelectorAll('#map-legend .mlg-tick')].map((t) => t.dataset.value)`);
  assert.deepEqual(ticks.map(Number).sort((a, b) => a - b), [-40, -30, -20, -10, -2, 2, 10, 20, 30, 40], 'ticks: ' + ticks);
  const labels = await page.eval(`[...document.querySelectorAll('#map-legend .mlg-tick')].map((t) => t.textContent)`);
  assert.ok(labels.includes('+2') && labels.some((l) => /^[−-]2$/.test(l)), 'the +-2 labels: ' + labels);
  // no two tick labels overlap
  const boxes = await page.eval(`[...document.querySelectorAll('#map-legend .mlg-tick')].map((t) => { const r = t.getBoundingClientRect(); return [r.left, r.right]; }).sort((a, b) => a[0] - b[0])`);
  for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i][0] >= boxes[i - 1][1] + 2, `tick labels closer than 2 px or overlapping: ${boxes[i - 1]} / ${boxes[i]}`);

  // ---------- the bar: one gap, every stop is the palette hex of the active ground, on both grounds ----------
  await chooseGround(page, 'night'); // start on Night (W3-04's default Chart is Paper)
  for (const ground of ['night', 'paper']) {
    const want = await page.eval(`(async () => { const p = await import('/js/render/palette.js'); const g = document.getElementById('map-legend').dataset.ground;
      return { g, stops: [...document.querySelectorAll('#map-legend .mlg-stop')].map((s) => { const a = +s.dataset.from, b = +s.dataset.to, mid = (a + b) / 2;
        const rgba = p.bandRGBA('z500a', mid, g); return { a, b, gap: s.classList.contains('gap'), css: getComputedStyle(s).backgroundColor, rgba }; }) }; })()`);
    assert.equal(want.g, ground, `ground is ${ground}`);
    assert.equal(want.stops.filter((s) => s.gap).length, 1, 'exactly one gap in the bar');
    const g = want.stops.find((s) => s.gap); assert.ok(g.a === -2 && g.b === 2, `the gap is -2..2: ${g.a}..${g.b}`);
    assert.ok(want.stops.length >= 38, 'a stepped bar: ' + want.stops.length + ' stops');
    for (const s of want.stops) {
      if (s.gap) { assert.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(s.css), 'the gap is unfilled: ' + s.css); continue; }
      assert.equal(s.css, `rgb(${s.rgba[0]}, ${s.rgba[1]}, ${s.rgba[2]})`, `${ground} stop ${s.a}..${s.b} equals the palette colour`);
    }
    if (ground === 'night') await chooseGround(page, 'paper');
  }

  // ---------- contrast on pixels over the lightest and darkest band, both grounds (now on paper; then back to night) ----------
  for (const ground of ['paper', 'night']) {
    const ext = await page.eval(`(async () => { const p = await import('/js/render/palette.js'); const g = document.getElementById('map-legend').dataset.ground;
      const L = ([r, g2, b]) => { const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g2) + 0.0722 * f(b); };
      const rows = [...p.bandRGBs('z500a', g, 'reference'), ...p.bandRGBs('z500a', g, 'soft')].sort((a, b) => L(a) - L(b)); return { g, dark: rows[0], light: rows[rows.length - 1] }; })()`);
    assert.equal(ext.g, ground);
    for (const [name, col] of [['darkest', ext.dark], ['lightest', ext.light]]) {
      await page.eval(`(() => { document.getElementById('map').style.visibility = 'hidden'; document.getElementById('bd')?.remove();
        const r = document.getElementById('map-legend').getBoundingClientRect(), d = document.createElement('div'); d.id = 'bd';
        d.style.cssText = 'position:fixed;z-index:5;left:' + (r.left - 20) + 'px;top:' + (r.top - 20) + 'px;width:' + (r.width + 40) + 'px;height:' + (r.height + 40) + 'px;background:rgb(${col.join(',')})';
        document.body.append(d); })()`);
      await sleep(200);
      const img = decodePNG(await page.screenshot());
      const els = await page.eval(`['.mlg-title', '.mlg-what', '.mlg-sub', '.mlg-tick[data-value="10"]', '.mlg-unit-name', '.mlg-lines', '.mlg-hatch', '.mlg-foot', '.mlg-run'].map((s) => { const e = document.querySelector('#map-legend ' + s); const r = e.getBoundingClientRect(); return { s, x: r.left, y: r.top, w: r.width, h: r.height }; })`);
      for (const e of els) {
        const x0 = Math.floor(e.x) + 1, x1 = Math.min(img.w - 1, Math.ceil(e.x + Math.min(e.w, 200))), y0 = Math.floor(e.y), y1 = Math.ceil(e.y + e.h);
        const bg = pixel(img, x0, y0); // the glass beside the text: its top-left corner
        let best = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) best = Math.max(best, contrast(pixel(img, x, y), bg));
        assert.ok(best >= 4.5, `${ground} over the ${name} band ${col}: ${e.s} text contrast ${best.toFixed(2)} < 4.5 (bg ${bg})`);
      }
    }
    await page.eval(`document.getElementById('bd')?.remove(); document.getElementById('map').style.visibility = ''`);
    if (ground === 'paper') await chooseGround(page, 'night');
  }

  // ---------- "What is this?" calls openGuide; with no lens in the store the legend is Pattern; a lens changes the words ----------
  await page.eval(`window.__guide = 0; __wse.ui.openGuide = () => { window.__guide++; }`);
  await inp.click(page, '#map-legend .mlg-what');
  assert.equal(await page.eval('window.__guide'), 1, '"What is this?" opens the guide');
  assert.equal(await page.eval(`'lens' in __wse.store.get() ? String(__wse.store.get().lens) : 'absent'`) !== 'j', true);
  await page.eval(`__wse.store.set({ overlays: { doubt: false } })`); await sleep(100);
  assert.equal(await page.eval(`!!document.querySelector('#map-legend .mlg-hatch')`), false, 'no hatch sample when the doubt overlay is off');
  await page.eval(`__wse.store.set({ overlays: { doubt: true } })`); await sleep(100);
  assert.equal(await page.eval(`!!document.querySelector('#map-legend .mlg-hatch')`), true, 'the hatch sample appears when the doubt overlay draws');
  await page.eval(`__wse.store.set({ lens: 'j' })`); await sleep(100);
  const jet = await page.eval(`document.getElementById('map-legend').textContent`);
  assert.ok(/Jet stream wind speed/.test(jet) && !/564/.test(jet), 'a lens changes the legend: ' + jet);
  await page.eval(`__wse.store.set({ lens: 'bogus' })`); await sleep(100);
  assert.ok(/Pressure pattern aloft/.test(await page.eval(`document.getElementById('map-legend').textContent`)), 'an unknown lens falls back to Pattern');

  // ---------- phone: one 36 px row over the chart, a tap expands ----------
  await boot(page, baseUrl, 390, 844);
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const row = await geo(page, '#map-legend');
  assert.ok(Math.abs(row.h - 38) <= 2.5 && (await geo(page, '#map-legend .mlg-head')).h === 36, `phone: collapsed legend is one 36 px row (card ${row.h}, row ${(await geo(page, '#map-legend .mlg-head')).h})`);
  assert.equal(await page.eval(`document.querySelector('#map-legend .mlg-body').hidden`), true, 'phone: collapsed at first');
  const tl = await geo(page, '#timeline');
  assert.ok(row.y + row.h <= tl.y + 0.5, `the row sits above the scrubber (row bottom ${row.y + row.h}, timeline top ${tl.y})`);
  assert.ok(row.x >= 0 && row.x + row.w <= 390, 'inside the screen width');
  const t0 = await geo(page, '#map-legend .mlg-title'), wh = await geo(page, '#map-legend .mlg-what');
  assert.ok(t0.w >= 100 && t0.x + t0.w <= wh.x + 0.5, `the title keeps room beside "What is this?" (${t0.w} px)`);
  await inp.tap(page, '#map-legend .mlg-toggle');
  await sleep(250);
  assert.equal(await page.eval(`document.querySelector('#map-legend .mlg-body').hidden`), false, 'phone: a tap expands');
  const open = await geo(page, '#map-legend');
  assert.ok(open.y >= 48 && open.y + open.h <= tl.y + 0.5, `expanded legend stays between the header and the scrubber (${open.y}..${open.y + open.h}, timeline ${tl.y})`);
  assert.ok((await page.eval(`document.getElementById('map-legend').textContent`)).includes('564 = 5,640 m'), 'phone: expanded legend has the decoder');
  const ov = await page.eval(`(() => { const d = document.documentElement; return d.scrollWidth - d.clientWidth; })()`);
  assert.ok(ov <= 0, 'no horizontal scroll: ' + ov);
  await inp.tap(page, '#map-legend .mlg-toggle');
  await sleep(250);
  assert.equal(await page.eval(`document.querySelector('#map-legend .mlg-body').hidden`), true, 'phone: a tap collapses again');
  assert.deepEqual(page.errors(), [], JSON.stringify(page.errors()));
}
