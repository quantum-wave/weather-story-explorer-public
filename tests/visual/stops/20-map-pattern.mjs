// Tour stop 20: the Pattern lens on the Paper ground: the ECMWF bands, hairlines every fifth edge, 6 dam height lines with labels,
// in Regional, Hemisphere and zoomed in (Josh points 7, 13, 14; DESIGN-SPEC 4.2, 4.3). The pixel measurements are S-COLOR and
// S-RENDER; this stop puts the picture on the contact sheet for a human and runs the layout assertions.
// Owner W3-01. gate:false only because of the shell's own layout failures (see mvpReason); W5-03 fails on any ungated stop.
import { mustBeVisible } from '../lib/steps.mjs';

export async function walk(page, inp, { snap }, expect) {
  const theme = await page.eval(`document.documentElement.dataset.theme || 'dark'`);
  if (theme !== expect) throw new Error(`the Pattern stop wants the ${expect} theme, the page is ${theme}`);
  await page.waitFor(`(async () => { const b = await import('/js/render/basemap.js'); return b.basemapTier && b.basemapTier() === 2; })()`, { timeout: 15000 });
  await mustBeVisible(page, '#map', 'the map');
  await inp.wait(900);
  await snap('regional');
  await inp.activate('#view-switch [data-view="nh"]');
  await page.waitFor(`__wse.store.get().view === 'nh'`, { timeout: 5000 });
  await inp.wait(900);
  await snap('hemisphere');
  await inp.activate('#view-switch [data-view="np"]');
  await page.waitFor(`__wse.store.get().view === 'np'`, { timeout: 5000 });
  await inp.wheel('#map', { dy: -420 });
  await inp.wait(1100);
  await snap('zoomed');
}

export default {
  id: '20-map-pattern',
  owner: 'W3-01',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: "measured on the MVP shell, not on the field: the strip's day cells overlap their initials (desktop) and the view-switch buttons are 40 px tall (phone). W3-04/W3-05 own those.",
  viewports: ['phone', 'desktop'],
  data: 'synthetic', // the tour runner's browser allows one fixture server (the default one)
  ground: 'paper',
  theme: 'light',
  allowOverlap: [['#map', '*']],
  async run(page, inp, { snap }) { return walk(page, inp, { snap }, 'light'); },
};
