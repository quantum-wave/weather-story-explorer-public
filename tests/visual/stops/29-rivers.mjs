// Tour stop 29: the Atmospheric rivers lens (IVT) on the Paper ground: eight bands from 250 kg/m/s with nothing shaded below it
// and thin contours every 250, in Regional and Hemisphere (Josh point 15; DESIGN-SPEC 6.1, MET-10). The pixel measurements are
// S-LENS-B (on synthetic-15d); this stop puts the picture on the contact sheet.
// Owner W4-04. gate:false only because of the shell's own layout failures (see mvpReason); W5-03 fails on any ungated stop.
//
// The tour runner's browser reaches one fixture server (the default `synthetic`, tour.mjs), and ivt exists only in `synthetic-15d`.
// So this stop runs on `synthetic` and, when the manifest has no ivt, takes the honest picture of that state (the lens chosen, no
// field, the map still readable) under the name `no-ivt`, and asserts rivers.available() says "Arrives with the 00Z run". When the
// runner serves synthetic-15d per stop the regional and hemisphere frames are the bands.
import { mustBeVisible } from '../lib/steps.mjs';

export default {
  id: '29-rivers',
  owner: 'W4-04',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: "measured on the MVP shell, not on the field: the strip's day cells overlap their initials (desktop) and the view-switch buttons are 40 px tall (phone). W3-04/W3-05 own those.",
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  ground: 'paper',
  theme: 'light',
  allowOverlap: [['#map', '*']],
  async run(page, inp, { snap }) {
    await page.waitFor(`(async () => { const b = await import('/js/render/basemap.js'); return b.basemapTier && b.basemapTier() === 2; })()`, { timeout: 15000 });
    const has = await page.eval(`!!__wse.data.getManifest().fields.ivt`);
    const avail = await page.eval(`import('/js/lenses/index.js').then((m) => m.lens('r').available(__wse.data.getManifest()))`);
    if (has !== avail.ok) throw new Error(`rivers.available() says ${JSON.stringify(avail)} but the manifest ${has ? 'has' : 'lacks'} ivt`);
    if (!has && avail.reason !== 'Arrives with the 00Z run') throw new Error(`rivers.available() reason is ${avail.reason}`);
    await page.eval(`__wse.store.set({ lens: 'r', t: 0 })`);
    if (has) await page.eval(`(async () => { await Promise.all(['g1', 'np05'].map((d) => __wse.data.ensure('ivt', d, 0).catch(() => null))); })()`);
    await mustBeVisible(page, '#map', 'the map');
    await inp.wait(900);
    await snap(has ? 'regional' : 'no-ivt');
    if (!has) return;
    await inp.activate('#view-switch [data-view="nh"]');
    await page.waitFor(`__wse.store.get().view === 'nh'`, { timeout: 5000 });
    await inp.wait(900);
    await snap('hemisphere');
    await inp.activate('#view-switch [data-view="np"]');
    await page.waitFor(`__wse.store.get().view === 'np'`, { timeout: 5000 });
  },
};
