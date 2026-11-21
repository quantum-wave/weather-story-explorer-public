// Tour stop 25: the Layers panel on the 15-day synthetic run, where every lens has its field: all six lenses listed, and at day 10 the
// Uncertain areas switch locked on with its reason, on the Night ground (Josh points 5 and 15; DESIGN-SPEC 6.1). Owner W4-01.
// gate:false only while the shell's own layout failures stand (see mvpReason); W5-03 fails on any ungated stop.
import { mustBeVisible } from '../lib/steps.mjs';

export default {
  id: '25-layers',
  owner: 'W4-01',
  gate: false,
  mvpFails: [1],
  mvpReason: "measured on the page behind the panel, not on the panel: the strip's day cells overlap their initials and labels (desktop). W3-04 and W3-07 own those.",
  viewports: ['phone', 'desktop'],
  data: 'synthetic-15d',
  ground: 'night',
  theme: 'dark',
  allowOverlap: [['#map', '*'], ['.wse-sheet-root', '*']],
  async run(page, inp, { snap }) {
    await page.eval(`__wse.store.set({ ground: 'night', theme: 'dark', t: 240 })`);
    await inp.wait(900);
    await inp.activate('#btn-layers');
    await page.waitFor(`document.getElementById('btn-layers').getAttribute('aria-expanded') === 'true'`, { timeout: 5000 });
    await page.waitFor(`document.getElementById('layers-panel').getBoundingClientRect().width > 0`, { timeout: 5000 });
    await mustBeVisible(page, '#layers-panel', 'the layers panel');
    await inp.wait(450);
    const rows = await page.eval(`document.querySelectorAll('#layers-panel [role=radio]:not([disabled])').length`);
    if (rows !== 6) throw new Error(`expected six lenses to be offered on the 15-day run, found ${rows}`);
    const locked = await page.eval(`document.querySelector('#layers-panel [data-overlay="doubt"]')?.getAttribute('aria-disabled')`);
    if (locked !== 'true') throw new Error('Uncertain areas is not locked at day 10');
    await snap('doubt-locked');
    // the panel scrolls when the screen is short: bring the overlays into view and show them
    await page.eval(`document.querySelector('#layers-panel [data-overlay="places"]').scrollIntoView({ block: 'end' })`);
    await inp.wait(300);
    await snap('overlays');
  },
};
