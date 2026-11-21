// S-SHARELABEL (W3-03 round 2): the portrait share render (540x675, zoom 2 on San Francisco, as in S-RENDER) still places contour
// labels as text. The default synthetic fixture is a 4.6 degree grid, which gives a contour fewer than the 8 segments per 260 px
// cell that labelSpots needs once the tight portrait framing (22-60N) is used, so S-RENDER can only check labels on its landscape
// render. This check runs the portrait render on the real 0.5 degree sample fixture, where the labels are placed. Limitation for
// the share package (W4-07): a share-render test on the synthetic grid cannot assert contour labels; use sample-min.
import { mount } from '../wp2/shot.mjs';

export const id = 'S-SHARELABEL';
export const tier = 'deploy';
export const data = 'sample-min'; // the real 0.5 degree sample fixture, whatever --data is
export const freshProfile = false;
export const timeoutMs = 90000;

export async function run({ page, baseUrl, assert }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 45000 });
  await mount(page, { width: 1000, height: 600, dpr: 1 });
  const out = await page.eval(`(async () => {
    const w = window.__wp2, m = window.__wse.data.getManifest(), t = m.fields.z500.steps[Math.min(1, m.fields.z500.steps.length - 1)];
    await w.renderer.ensureFor({ t, lens: 'z' });
    const res = { grid: m.domains.np05.dlon };
    for (const [name, centre] of [['zoom2', { lat: 37.77, lon: -122.42, zoom: 2 }], ['default', undefined]]) {
      const cv = document.createElement('canvas'); cv.width = 540; cv.height = 675;
      const c = cv.getContext('2d'), texts = []; const ft = c.fillText.bind(c); c.fillText = (s, ...r) => { texts.push(String(s)); return ft(s, ...r); };
      w.renderer.renderTo(c, { width: 540, height: 675, t, view: 'np', lens: 'z', theme: 'dark', centre });
      res[name] = texts.filter((s) => /^\\d{3}$/.test(s)).length;
    }
    return res;
  })()`);
  assert.equal(out.grid, 0.5, 'the sample fixture is the 0.5 degree grid');
  assert.ok(out.zoom2 >= 4, `the portrait share render at zoom 2 draws contour labels as text: ${out.zoom2}`);
  assert.ok(out.default >= 4, `the portrait share render at the default framing draws contour labels as text: ${out.default}`);
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
}
