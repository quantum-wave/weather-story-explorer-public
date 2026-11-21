// Tour stop 28: the Air mass lens (850 hPa temperature anomaly) on the Paper ground: the REF-26 bins with nothing shaded within
// +-1 C, grey height lines, and the high ground hatched (the fixture's no-data block over the Rockies) in Regional and Hemisphere
// (Josh point 15; DESIGN-SPEC 6.1, MET-8). The pixel measurements are S-LENS-B; this stop puts the picture on the contact sheet.
// Owner W4-04. gate:false only because of the shell's own layout failures (see mvpReason); W5-03 fails on any ungated stop.
import { mustBeVisible } from '../lib/steps.mjs';

export default {
  id: '28-airmass',
  owner: 'W4-04',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: "measured on the MVP shell, not on the field: the strip's day cells overlap their initials (desktop) and the view-switch buttons are 40 px tall (phone). W3-04/W3-05 own those.",
  viewports: ['phone', 'desktop'],
  data: 'synthetic', // the tour runner's browser allows one fixture server (the default one); it has t850a and the block of high ground
  ground: 'paper',
  theme: 'light',
  allowOverlap: [['#map', '*']],
  async run(page, inp, { snap }) {
    await page.waitFor(`(async () => { const b = await import('/js/render/basemap.js'); return b.basemapTier && b.basemapTier() === 2; })()`, { timeout: 15000 });
    await page.eval(`__wse.store.set({ lens: 'a', t: 0 })`);
    await page.eval(`(async () => { await Promise.all(['t850a', 'z500'].flatMap((f) => ['g1', 'np05'].map((d) => __wse.data.ensure(f, d, 0).catch(() => null)))); })()`);
    await mustBeVisible(page, '#map', 'the map');
    await inp.wait(900);
    await snap('regional');
    await inp.activate('#view-switch [data-view="nh"]');
    await page.waitFor(`__wse.store.get().view === 'nh'`, { timeout: 5000 });
    await inp.wait(900);
    await snap('hemisphere');
    await inp.activate('#view-switch [data-view="np"]');
    await page.waitFor(`__wse.store.get().view === 'np'`, { timeout: 5000 });
  },
};
