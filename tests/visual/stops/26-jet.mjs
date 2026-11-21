// Tour stop 26: the Jet stream lens on the recorded forecast in Regional, at zoom 1 and zoom 2 (Josh points 11 and 15; DESIGN-SPEC 6.1).
// Judge line: no grid-cell blockiness at either zoom (the recording is a 1 degree global field: smooth bands and smooth isotachs, no
// stair-stepped band edges), with ec_medium_mslp_wind200.png (REF-22) beside it for the yellow-to-green ramp. The pixel measurements
// are S-LENS-A; this stop puts the picture on the contact sheet. Owner W4-03.
// gate:false only because of the shell's own layout failures (see mvpReason); W5-03 fails on any ungated stop.
import { mustBeVisible } from '../lib/steps.mjs';
import { startServer } from '../../site/lib/server.mjs';
import { fileURLToPath } from 'node:url';

// The tour's browser may only open the default (synthetic) server, and this stop is about the recorded forecast: the stop serves the
// recording itself and points its page at it.
const RECORDED = fileURLToPath(new URL('../../site/fixtures/recorded', import.meta.url));

export default {
  id: '26-jet',
  owner: 'W4-03',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: "measured on the MVP shell, not on the lens: the strip's day cells overlap their initials (desktop) and the view-switch buttons are 40 px tall (phone). W3-04/W3-05 own those.",
  viewports: ['phone', 'desktop'],
  data: 'synthetic', // the stop opens the recorded fixture itself (see RECORDED)
  ground: 'paper',
  theme: 'light',
  reference: 'ec_medium_mslp_wind200.png',
  allowOverlap: [['#map', '*']],
  async run(page, inp, { snap }) {
    const srv = await startServer({ dataDir: RECORDED });
    try {
    page.baseUrl = srv.baseUrl;
    await page.goto(srv.baseUrl);
    await page.waitFor(`window.__wse && window.__wse.ready === true && window.__wse.data.getManifest() !== null`, { timeout: 45000 });
    await page.waitFor(`(async () => { const b = await import('/js/render/basemap.js'); return b.basemapTier && b.basemapTier() === 2; })()`, { timeout: 15000 });
    await mustBeVisible(page, '#map', 'the map');
    await page.eval(`__wse.store.set({ theme: 'light', lens: 'j', ground: 'paper', view: 'np', t: 24 })`);
    await inp.wait(1500);
    await snap('zoom1');
    await inp.wheel('#map', { dy: -300 });
    await inp.wait(1500);
    await snap('zoom2');
    } finally { await srv.close().catch(() => {}); }
  },
};
