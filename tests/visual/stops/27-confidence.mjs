// Tour stop 27: the Confidence lens on the recorded forecast in Regional: the spread bands, the grey height lines, the emphasised
// 6 dam line and its label "one contour's worth of doubt", at day 1 (pale: forecasts agree) and day 10 (dark: they do not), then on
// the Night ground (Josh points 8 and 15; DESIGN-SPEC 6.1, 5.5). Pixel measurements are S-LENS-A. Owner W4-03.
// gate:false only because of the shell's own layout failures (see mvpReason); W5-03 fails on any ungated stop.
import { mustBeVisible } from '../lib/steps.mjs';
import { startServer } from '../../site/lib/server.mjs';
import { fileURLToPath } from 'node:url';

// The tour's browser may only open the default (synthetic) server, and this stop is about the recorded forecast: the stop serves the
// recording itself and points its page at it.
const RECORDED = fileURLToPath(new URL('../../site/fixtures/recorded', import.meta.url));

export default {
  id: '27-confidence',
  owner: 'W4-03',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: "measured on the MVP shell, not on the lens: the strip's day cells overlap their initials (desktop) and the view-switch buttons are 40 px tall (phone). W3-04/W3-05 own those.",
  viewports: ['phone', 'desktop'],
  data: 'synthetic', // the stop opens the recorded fixture itself (see RECORDED)
  ground: 'paper',
  theme: 'light',
  allowOverlap: [['#map', '*']],
  async run(page, inp, { snap }) {
    const srv = await startServer({ dataDir: RECORDED });
    try {
    page.baseUrl = srv.baseUrl;
    await page.goto(srv.baseUrl);
    await page.waitFor(`window.__wse && window.__wse.ready === true && window.__wse.data.getManifest() !== null`, { timeout: 45000 });
    await page.waitFor(`(async () => { const b = await import('/js/render/basemap.js'); return b.basemapTier && b.basemapTier() === 2; })()`, { timeout: 15000 });
    await mustBeVisible(page, '#map', 'the map');
    await page.eval(`__wse.store.set({ theme: 'light', lens: 'c', ground: 'paper', view: 'np', t: 24 })`);
    await inp.wait(1500);
    await snap('day1');
    await page.eval(`__wse.store.set({ t: 240 })`);
    await inp.wait(1500);
    await snap('day10');
    await page.eval(`__wse.store.set({ ground: 'night' })`);
    await inp.wait(1500);
    await snap('day10-night');
    } finally { await srv.close().catch(() => {}); }
  },
};
