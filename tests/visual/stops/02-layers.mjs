// Tour stop 02: the Layers panel (Josh points 5, 13, 15; DESIGN-SPEC 6.1 and 11.4). On the synthetic run, which carries four of the six
// lenses' fields: the lens list as radio rows with their swatch strips, the lenses this run lacks disabled with a data reason only, the
// overlay switches; then the Jet stream lens chosen by a real press, and the chart and legend following it. Phone: the panel is the
// one sheet; desktop: a popover under the Layers button. Owner W4-01.
// gate:false only while the shell's own layout failures stand (see mvpReason); W5-03 fails on any ungated stop.
import { mustBeVisible } from '../lib/steps.mjs';

export default {
  id: '02-layers',
  owner: 'W4-01',
  gate: false,
  mvpFails: [1],
  mvpReason: "measured on the page behind the panel, not on the panel: the strip's day cells overlap their initials and labels (desktop). W3-04 and W3-07 own those.",
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  allowOverlap: [['#map', '*'], ['.wse-sheet-root', '*']], // the full-bleed canvas lies under the popover; the sheet is above the whole page by design
  async run(page, inp, { snap }) {
    await inp.activate('#btn-layers');
    await page.waitFor(`document.getElementById('btn-layers').getAttribute('aria-expanded') === 'true'`, { timeout: 5000 });
    await page.waitFor(`document.getElementById('layers-panel').getBoundingClientRect().width > 0`, { timeout: 5000 });
    await mustBeVisible(page, '#layers-panel', 'the layers panel');
    await inp.wait(450);
    await snap('panel-open');
    // choose the Jet stream lens the way a person does: press its row, then check the row and the legend report it. Throws otherwise.
    const row = '#layers-panel [data-lens="j"]';
    const before = await page.eval(`(() => { const b = document.querySelector(${JSON.stringify(row)}); return b ? { on: b.getAttribute('aria-checked'), disabled: b.disabled } : null; })()`);
    if (!before) throw new Error('the layers panel has no Jet stream row');
    if (before.disabled) throw new Error('the Jet stream row is disabled, so no lens can be chosen');
    if (before.on === 'true') throw new Error('the Jet stream lens was already on before the stop pressed it');
    await inp.activate(row);
    await page.waitFor(`document.querySelector(${JSON.stringify(row)})?.getAttribute('aria-checked') === 'true'`, { timeout: 5000 }).catch(() => {
      throw new Error('pressing the Jet stream row did not choose the lens (aria-checked stayed false)');
    });
    await page.waitFor(`document.querySelector('#map-legend .mlg-title')?.textContent === 'Jet stream wind speed'`, { timeout: 3000 });
    await inp.wait(900);
    await snap('jet-chosen');
  },
};
