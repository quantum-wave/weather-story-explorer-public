// Tour stop 02: the Layers panel open, and one layer switched (Josh points 7, 13, 15).
// MVP shell: gate:false; the owner package rewrites this stop and sets gate:true. mvpFails: assertion numbers of spec 14.3
// (1 overlap, 2 hscroll, 3 textsize, 4 clipped, 5 target).
import { mustBeVisible } from '../lib/steps.mjs';

export default {
  id: '02-layers',
  owner: 'W4-01',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: 'measured on the MVP shell: strip cells overlap their initials (desktop); view-switch buttons are 40 px and Reset view 36 px tall (phone)',
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run(page, inp, { snap }) {
    await inp.activate('#btn-layers');
    await page.waitFor(`document.getElementById('btn-layers').getAttribute('aria-expanded') === 'true'`, { timeout: 5000 });
    await mustBeVisible(page, '#layers-panel', 'the layers panel');
    await snap('panel-open');
    // switch the Jet stream layer on, the way a person does: press its row, then check the row reports it on. Throws otherwise.
    const row = '#layers-panel [data-layer="j"]';
    const before = await page.eval(`(() => { const b = document.querySelector(${JSON.stringify(row)}); return b ? { on: b.getAttribute('aria-checked'), disabled: b.disabled } : null; })()`);
    if (!before) throw new Error('the layers panel has no Jet stream row');
    if (before.disabled) throw new Error('the Jet stream row is disabled, so no layer can be switched');
    if (before.on === 'true') throw new Error('the Jet stream layer was already on before the stop pressed it');
    await inp.activate(row);
    await page.waitFor(`document.querySelector(${JSON.stringify(row)})?.getAttribute('aria-checked') === 'true'`, { timeout: 5000 }).catch(() => {
      throw new Error('pressing the Jet stream row did not switch the layer on (aria-checked stayed false)');
    });
  },
};
