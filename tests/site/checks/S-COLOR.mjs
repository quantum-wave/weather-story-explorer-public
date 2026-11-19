// S-COLOR: the anomaly ramp is monotone in lightness on both arms (rising on dark, falling on light), the arms match
// within 0.02, the table colours are exact, and a legend bar drawn in the browser shows those colours in a screenshot.
import { mount, sleep } from '../wp2/shot.mjs';
import { decodePNG, pixel } from '../wp2/shot.mjs';

export const id = 'S-COLOR';
export const freshProfile = false;
export const timeoutMs = 60000;
const LAND = { dark: [20, 25, 30], light: [238, 235, 229] };
const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// SPEC section 8, anomaly colormap: dam, dark below, dark above, light below, light above (written out here, not read from the module)
const SPEC_TABLE = [
  [6, '#2B4260', '#58391D', '#B2CFF3', '#E9C4A5'], [9, '#355781', '#754A22', '#92B7E7', '#DAA97F'],
  [12, '#406CA3', '#935C25', '#72A0DA', '#C98E59'], [15, '#4C82C6', '#B26E27', '#5188CD', '#B9742E'],
  [18, '#5799EB', '#D38029', '#2F70BF', '#A25D04'], [24, '#73B1FF', '#F09638', '#0859AC', '#854A00'],
];

export async function run({ page, baseUrl, assert }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 45000 });
  const t = await page.eval(`(async () => {
    const cm = await import('/js/render/colormap.js');
    const L = (rgb) => cm.toOKLab(rgb)[0], out = { stops: cm.STOPS, rows: {} };
    for (const theme of ['dark', 'light']) {
      const rows = [];
      for (let d = 4.5; d <= 30; d += 0.75) {
        const lo = cm.anomalyRGBA(-d, theme), hi = cm.anomalyRGBA(d, theme);
        rows.push({ d, lo, hi, Llo: L(lo), Lhi: L(hi) });
      }
      out.rows[theme] = rows;
      out.exact ||= {}; out.exact[theme] = Object.fromEntries([6, 9, 12, 15, 18, 24].map((d) => [d, { lo: cm.anomalyRGBA(-d, theme), hi: cm.anomalyRGBA(d, theme) }]));
    }
    out.small = [-3, -2.9, 0, 3, NaN].map((d) => cm.anomalyRGBA(d, 'dark')[3]);
    out.fade = [0, 0.5, 1].map((s) => cm.anomalyRGBA(12, 'dark', s));
    out.jet = [20, 30, 45, 60, 80, 120].map((v) => cm.jetRGBA(v));
    return out;
  })()`);
  for (const theme of ['dark', 'light']) {
    const rows = t.rows[theme], sign = theme === 'dark' ? 1 : -1;
    for (let i = 1; i < rows.length; i++) {
      for (const arm of ['Llo', 'Lhi']) {
        assert.ok(sign * (rows[i][arm] - rows[i - 1][arm]) >= -1e-9, `${theme} ${arm} lightness not monotone at ${rows[i].d} dam`);
      }
    }
    for (const r of rows) assert.ok(Math.abs(r.Llo - r.Lhi) <= 0.02, `${theme} arms differ by ${Math.abs(r.Llo - r.Lhi).toFixed(3)} at ${r.d} dam`);
    const col = theme === 'dark' ? [1, 2] : [3, 4];
    for (const row of SPEC_TABLE) {
      const dam = row[0], got = t.exact[theme][dam]; // the module's colour at exactly that magnitude
      assert.deepEqual(got.lo.slice(0, 3).map((v, k) => Math.abs(v - hexRGB(row[col[0]])[k]) <= 2), [true, true, true], `${theme} cool ${dam} dam = ${row[col[0]]}, got ${got.lo}`);
      assert.deepEqual(got.hi.slice(0, 3).map((v, k) => Math.abs(v - hexRGB(row[col[1]])[k]) <= 2), [true, true, true], `${theme} warm ${dam} dam = ${row[col[1]]}, got ${got.hi}`);
    }
  }
  assert.deepEqual(t.small, [0, 0, 0, 0, 0], 'nothing shaded at or below 3 dam, or for no data');
  const chroma = (c) => Math.max(...c.slice(0, 3)) - Math.min(...c.slice(0, 3));
  assert.ok(chroma(t.fade[0]) < chroma(t.fade[1]) && chroma(t.fade[1]) < chroma(t.fade[2]), 'saturation scales the chroma');
  assert.equal(t.jet[0][3], 0); assert.equal(t.jet[1][3], 0);
  assert.ok(t.jet[2][3] > 90 && t.jet[2][3] < 130 && t.jet[3][3] === 217 && t.jet[4][3] === 217, `jet alpha 0 -> 0.85 at 60 m/s: ${t.jet.map((j) => j[3])}`);

  // A legend bar drawn in the browser, read back from a screenshot.
  await mount(page, { width: 700, height: 200 });
  for (const theme of ['dark', 'light']) {
    await page.eval(`(() => {
      const c = window.__wp2.canvas; c.style.display = 'none';
      const cv = document.createElement('canvas'); cv.id = 'wp2lg'; cv.width = 700; cv.height = 200;
      cv.style.cssText = 'position:fixed;left:0;top:0;z-index:100000;width:700px;height:200px';
      document.getElementById('wp2lg')?.remove(); document.body.appendChild(cv);
      const ctx = cv.getContext('2d'); ctx.fillStyle = ${JSON.stringify(theme === 'dark' ? '#0C1014' : '#F9F6F2')}; ctx.fillRect(0, 0, 700, 200);
      import('/js/render/legend.js').then((m) => { window.__lh = m.drawLegend(ctx, { x: 20, y: 20, width: 600, layer: 'z', theme: ${JSON.stringify(theme)}, words: false }); });
    })()`);
    await page.waitFor('window.__lh > 0');
    await sleep(150);
    const img = decodePNG(await page.screenshot());
    const by = 20 + 4; // inside the 8 px compact bar
    for (const d of [-23, -18, -12, -6, 6, 12, 18, 23]) {
      const x = Math.round(20 + ((d + 24) / 48) * 599), [r, g, b] = pixel(img, Math.min(x, 618), by);
      const sg = await page.eval(`import('/js/render/colormap.js').then((m) => m.anomalyRGBA(${d}, ${JSON.stringify(theme)}))`);
      const a = sg[3] / 255, want = [0, 1, 2].map((k) => sg[k] * a + LAND[theme][k] * (1 - a));
      assert.ok([r, g, b].every((v, k) => Math.abs(v - want[k]) <= 9), `${theme} legend bar at ${d} dam is ${[r, g, b]}, want about ${want.map(Math.round)}`);
    }
    await page.eval(`window.__lh = 0`);
    await page.eval(`document.getElementById('wp2lg').remove()`);
  }
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
}
