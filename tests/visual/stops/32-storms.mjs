// Tour stop 32: the Storms and rain lens on the Paper ground: 6-hour rain in the ECMWF bands, isobars every 4 hPa with two-digit
// labels, H and L at closed centres; Regional, Hemisphere, and the legend with the mm / in switch on inches (Josh point 15; DESIGN-SPEC
// 6.1). Judged beside ECMWF's own rain chart (reference ec_medium-rain-acc.png, REF-28, found in $WSE_REFERENCES). The pixel
// measurements are S-LENS-C and wp15.lenses-c.test.mjs; this stop puts the picture on the contact sheet for a human.
// The pictures judged beside the reference are the RECORDED ECMWF run (19 Nov 2026 00 UTC), the product's default sample: on the
// synthetic run the heaviest rain sits under the highs, which contradicts the lens' own guide text ("Rain gathers around lows"), and
// its three to six tidy centres hid the clutter real weather draws. The synthetic frames follow as `synthetic-*`.
// Owner W4-05. gate:false while the shell's own layout failures stand (W5-03 fails on any ungated stop).
import { mustBeVisible } from '../lib/steps.mjs';
import { startServer } from '../../site/lib/server.mjs';
import { fileURLToPath } from 'node:url';

const RECORDED = fileURLToPath(new URL('../../site/fixtures/recorded', import.meta.url));
const T_SYNTHETIC = 30; // a forecast hour with rain in the synthetic fixture
const T_RECORDED = 30;  // a forecast hour with rain bands curling round the lows of the recorded run

export async function walk(page, inp, { snap }, { T = T_SYNTHETIC, prefix = '' } = {}) {
  await page.waitFor(`(async () => { const b = await import('/js/render/basemap.js'); return b.basemapTier && b.basemapTier() === 2; })()`, { timeout: 15000 });
  await page.eval(`__wse.store.set({ lens: 's', ground: 'paper', t: ${T}, view: 'np' })`);
  await mustBeVisible(page, '#map', 'the map');
  await inp.wait(1200);
  await snap(prefix + 'regional');
  await inp.activate('#view-switch [data-view="nh"]');
  await page.waitFor(`__wse.store.get().view === 'nh'`, { timeout: 5000 });
  await inp.wait(1200);
  await snap(prefix + 'hemisphere');
  await inp.activate('#view-switch [data-view="np"]');
  await page.waitFor(`__wse.store.get().view === 'np'`, { timeout: 5000 });
  await inp.wait(800);
  if (await page.eval(`document.querySelector('#map-legend')?.dataset.collapsed === 'true'`)) await inp.activate('#map-legend .mlg-toggle');
  await inp.wait(300);
  await inp.activate('#map-legend .mlg-unit-btn[data-units="us"]');
  await page.waitFor(`document.querySelector('#map-legend .mlg-unit-name')?.textContent === 'in'`, { timeout: 5000 });
  await inp.wait(500);
  await snap(prefix + 'legend-inches');
}

export default {
  id: '32-storms',
  owner: 'W4-05',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: "measured on the MVP shell, not on the lens: the strip's day cells overlap their initials (desktop) and the view-switch buttons are 40 px tall (phone). W3-04/W3-05 own those.",
  viewports: ['phone', 'desktop'],
  data: 'synthetic-15d', // the fixture with sea-level pressure and rain (the default 'synthetic' has neither); the recorded run is served by the stop itself
  ground: 'paper',
  theme: 'light',
  reference: 'ec_medium-rain-acc.png',
  allowOverlap: [['#map', '*']],
  async run(page, inp, { snap }) {
    // the recorded run first: the frames the reference is judged beside
    const srv = await startServer({ dataDir: RECORDED });
    const home = page.baseUrl;
    try {
      page.baseUrl = srv.baseUrl;
      await page.goto(srv.baseUrl);
      await page.waitFor(`window.__wse && window.__wse.ready === true && window.__wse.data.getManifest() !== null`, { timeout: 45000 });
      await walk(page, inp, { snap }, { T: T_RECORDED });
    } finally { await srv.close().catch(() => {}); page.baseUrl = home; }
    // then the synthetic run the other checks use
    await page.goto(home);
    await page.waitFor(`window.__wse && window.__wse.ready === true && window.__wse.data.getManifest() !== null`, { timeout: 45000 });
    await walk(page, inp, { snap }, { T: T_SYNTHETIC, prefix: 'synthetic-' });
  },
};
