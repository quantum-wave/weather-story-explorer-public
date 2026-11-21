// Tour stop 01: the four map views (Regional, Hemisphere, Globe, World), chosen with the view switch (Josh points 11, 12).
// Owner W3-03 (MAP-INTERACT): #map is a focusable canvas (tabindex 0, arrow keys pan and rotate), so it is an interactive box under
// the controls laid over it; those overlaps are intended and declared below. mvpFails: assertion numbers of spec 14.3
// (1 overlap, 2 hscroll, 3 textsize, 4 clipped, 5 target).
import { mustBeVisible } from '../lib/steps.mjs';
import { MEASURE, toolsRowProblems, PHONE_WIDTHS, DESKTOP_WIDTHS, SLACK } from '../../site/lib/toolsrow.mjs';

/**
 * W4-10: the four view buttons, Layers, Expand and Reset share one row at every width of the viewport's class, none overlapping or
 * truncated, with at least SLACK px to spare on every fit (see tests/site/lib/toolsrow.mjs). Resets the window size afterwards.
 */
async function checkToolsRow(page, viewport) {
  const phone = viewport === 'phone';
  const [w0, h0, dpr] = await page.eval('[innerWidth, innerHeight, devicePixelRatio]');
  const bad = [];
  try {
    for (const w of phone ? PHONE_WIDTHS : DESKTOP_WIDTHS) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h0, deviceScaleFactor: dpr, mobile: phone });
      await new Promise((r) => setTimeout(r, 300));
      for (const reset of [false, true]) {
        await page.eval(`document.getElementById('btn-reset').hidden = ${!reset}`);
        await new Promise((r) => setTimeout(r, 100));
        bad.push(...toolsRowProblems(await page.eval(MEASURE), `${w}px${reset ? ' with Reset' : ''}`));
      }
    }
  } finally {
    await page.eval(`document.getElementById('btn-reset').hidden = true`);
    await page.send('Emulation.setDeviceMetricsOverride', { width: w0, height: h0, deviceScaleFactor: dpr, mobile: phone });
    await new Promise((r) => setTimeout(r, 300));
  }
  if (bad.length) throw new Error(`map tools row (${SLACK} px slack): ` + bad.slice(0, 6).join('; ') + (bad.length > 6 ? `; and ${bad.length - 6} more` : ''));
}

export default {
  id: '01-views',
  owner: 'W3-03',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: "other packages' boxes, measured on this stop: the strip's day cells overlap their initials; the view-switch buttons are 40 px tall (phone)",
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  allowOverlap: [['#map', '*']], // the full-bleed focusable map canvas lies under every map control by design
  async run(page, inp, { snap, viewport }) {
    for (const [view, name] of [['nh', 'hemisphere'], ['gl', 'globe'], ['wm', 'world']]) {
      await inp.activate(`#view-switch [data-view="${view}"]`);
      await page.waitFor(`__wse.store.get().view === ${JSON.stringify(view)}`, { timeout: 5000 });
      await mustBeVisible(page, '#map', 'the map');
      await snap(name);
      if (view === 'wm') await checkToolsRow(page, viewport);
    }
    await inp.activate('#view-switch [data-view="np"]'); // back to Regional; the runner takes the final frame
    await page.waitFor(`__wse.store.get().view === 'np'`, { timeout: 5000 });
  },
};
