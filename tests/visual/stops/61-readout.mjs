// Tour stop 61: the readout (Josh point 13; DESIGN-SPEC 5.4) and the ridge and trough labels (4.5), on the synthetic 15-day run:
// the plates on the chart, a tap on the +11 dam ridge probe ("+11 dam · a ridge", the height, the time), and a tap on the no-signal
// probe at day 13 ("No clear signal yet" with the average and the spread under it). Owner W4-02.
import { mustBeVisible } from '../lib/steps.mjs';

const at = (page, lon, lat) => page.eval(`(() => { const r = document.getElementById('map').getBoundingClientRect(), p = __wse.renderer.project([${lon}, ${lat}]); if (!p) return null; const x = r.left + p[0], y = r.top + p[1]; return x > r.left + 30 && x < r.right - 30 && y > r.top + 90 && y < r.bottom - 30 ? { x, y } : null; })()`);

export default {
  id: '61-readout',
  owner: 'W4-02',
  gate: true,
  viewports: ['phone', 'desktop'],
  data: 'synthetic-15d',
  ground: 'paper',
  theme: 'light',
  allowOverlap: [['#map', '*'], ['.rdo-dot', '*'], ['rect.strip-day', 'svg.strip text'], ['rect.strip-end', 'svg.strip text']], // the strip's label-over-cell overlap is W3-06's (30-home allows it)
  allowTarget: ['#map-legend .mlg-toggle', '#map-legend .mlg-what'], // the 36 px legend row is W3-11's (10-shell allows it too)
  async run(page, inp, { snap }) {
    await page.eval(`localStorage.setItem('wse.v1.prefs', JSON.stringify({ coachSeen: ['drag', 'play', 'tap'] }))`);
    await mustBeVisible(page, '#map', 'the map');
    await page.eval(`__wse.store.set({ t: 0, playing: false })`);
    await inp.wait(1200);
    await snap('labels');
    let p = null;
    for (const v of ['np', 'nh', 'gl']) {
      await inp.activate(`#view-switch [data-view="${v}"]`); await inp.wait(600);
      p = await at(page, -80, 56);
      if (p) break;
    }
    if (!p) throw new Error('the ridge probe is not on screen in any view');
    await inp.activate(p);
    await page.waitFor(`!!document.querySelector('#readout:not([hidden]) .rdo-first')`, { timeout: 6000 });
    await inp.wait(500);
    await snap('ridge');
    await page.eval(`__wse.store.set({ t: 300, playing: false })`);
    await inp.wait(1200);
    p = null;
    for (const v of ['np', 'nh', 'gl']) {
      await inp.activate(`#view-switch [data-view="${v}"]`); await inp.wait(600);
      p = await at(page, -56, 30);
      if (p) break;
    }
    if (!p) throw new Error('the no-signal probe is not on screen in any view');
    await inp.activate(p);
    await page.waitFor(`document.querySelector('#readout .rdo-first')?.textContent === 'No clear signal yet'`, { timeout: 6000 });
    await inp.wait(500);
    await snap('no-signal');
  },
};
