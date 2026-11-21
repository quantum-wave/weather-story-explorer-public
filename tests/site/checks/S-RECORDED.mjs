// S-RECORDED (W3-09): the product's own sample is one recorded run (sample: true, no cases). The map must draw it (the old
// "sample means cases" test rejected every field, so nothing drew), the home card must show a full week, and the card and the
// map must name the same run.
import { mount, shoot, pixel } from '../wp2/shot.mjs';

export const id = 'S-RECORDED';
export const tier = 'deploy';
export const freshProfile = true;
export const data = ['recorded'];
export const timeoutMs = 120000;

export async function run({ page, baseUrl, assert }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 45000 });
  const m = await page.eval('window.__wse.data.getManifest()');
  assert.equal(m.sample, true); assert.equal(m.cases, undefined, 'the recorded fixture has no cases');

  // the home card: at least 7 day columns, naming the run
  const card = await page.eval(`(() => { const c = document.querySelector('#sec-week .card'); return { days: c.querySelectorAll('.strip-day').length, text: c.textContent }; })()`);
  assert.ok(card.days >= 7, `the home card shows at least 7 day columns (saw ${card.days})`);

  if (process.env.WSE_SHOT_DIR) (await import('node:fs')).writeFileSync(`${process.env.WSE_SHOT_DIR}/recorded-home.png`, await page.screenshot()); // to look at the page

  // the map: a node with a strong anomaly at step 24 must be a band colour, not the ground. Probe found from the data itself.
  await mount(page, { width: 1000, height: 600 });
  const probe = await page.eval(`(async () => {
    const d = window.__wp2.data, dom = d.getManifest().domains.g1;
    await d.ensureAll('z500a', 'g1');
    const f = d.fieldAt('z500a', 'g1', 24); if (!f) return null;
    let best = null;
    for (let j = 40; j < 100; j += 2) for (let i = 0; i < dom.nx; i += 2) {
      const v = f[j * dom.nx + i];
      const lon = dom.lon0 + i * dom.dlon, lat = dom.lat0 + j * dom.dlat;
      if (lon < -170 || lon > -100 || lat < 25 || lat > 65) continue;
      if (v === v && (!best || Math.abs(v) > Math.abs(best.v))) best = { v, lon, lat };
    }
    return best;
  })()`);
  assert.ok(probe && Math.abs(probe.v) >= 60, 'the recorded run has a strong anomaly over the north Pacific at 24 h: ' + JSON.stringify(probe));
  const img = await shoot(page, { view: 'np', lens: 'z', theme: 'dark', t: 24 }, 'recorded-map');
  const xy = await page.eval(`window.__wp2.renderer.project([${probe.lon}, ${probe.lat}])`);
  assert.ok(xy && xy[0] > 0 && xy[0] < 1000 && xy[1] > 0 && xy[1] < 600, 'the probe is on screen: ' + xy);
  const ground = pixel(img, 2, 2), at = pixel(img, Math.round(xy[0]), Math.round(xy[1]));
  const diff = Math.abs(at[0] - ground[0]) + Math.abs(at[1] - ground[1]) + Math.abs(at[2] - ground[2]);
  assert.ok(diff > 60, `the pixel at the probe (${probe.v} gpm) is a band colour ${at}, not the ground ${ground}`);

  // the card and the map name the same run: read what each surface says (not any 19 Nov in a valid time) and compare.
  // Card: the sample tag on the home card. Map: the legend's sample line and the header badge over it.
  const names = await page.eval(`(async () => {
    const k = await import('/js/data/kind.js'), m = window.__wse.data.getManifest();
    const txt = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim());
    // the header (W3-04): the data chip's "About this data" sentence, opened by a click, is the one recorded label
    const chip = document.getElementById('data-chip'); chip.click(); const badge = txt('#data-popover .full'); chip.click();
    return { long: k.sampleLabel(m), card: txt('#sec-week .card .sample-tag, .sample-tag'), legend: txt('.lg-sample'), badge };
  })()`);
  assert.match(names.long, /ECMWF run 19 Nov 2026 00 UTC/, 'the label names the run');
  assert.ok(names.card.length > 0, 'the card carries a run name');
  assert.ok(names.legend.length > 0, 'the map legend carries a run name');
  assert.equal(names.badge.length, 1, 'the header badge carries a run name');
  for (const [where, list] of [['card', names.card], ['map legend', names.legend], ['header badge', names.badge]]) {
    for (const t of list) assert.equal(t, names.long, `the ${where} names the run exactly as the one sample label does (saw ${JSON.stringify(t)})`);
  }
  assert.deepEqual(page.errors(), [], JSON.stringify(page.errors()));
}
