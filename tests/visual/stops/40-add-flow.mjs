// Tour stop 40: the ambiguous place. A bare "Tahoe" typed in the inline box lists North Lake Tahoe, South Lake Tahoe and Lake
// Tahoe and adds nothing; Enter opens the Add sheet with the choice pending (Josh point 2). Owner W3-07.
import { dragSheet, openQuickAddAndType, mustBeVisible } from '../lib/steps.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shown = (page, sel, what) => page.waitFor(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`, { timeout: 8000 }).catch(() => { throw new Error(`expected ${what} to be on screen`); });

export default {
  id: '40-add-flow',
  owner: 'W3-07',
  gate: true,
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run(page, inp, { snap }) {
    await dragSheet(page, inp, 'full', -500);
    // the empty People row opens the Add sheet (W3-06 addFlow on openAddSheet), so the inline box is reached by its own field
    await openQuickAddAndType(page, inp, '#quickadd-host textarea', 'Tahoe');
    await mustBeVisible(page, '.pn-suggest [role=option]', 'the Tahoe choices under the box');
    const names = await page.eval(`[...document.querySelectorAll('.pn-suggest [role=option]')].map((b) => b.textContent)`);
    for (const want of ['North Lake Tahoe', 'South Lake Tahoe', 'Lake Tahoe']) if (!names.some((n) => n.startsWith(want))) throw new Error(`${want} is not offered: ${names}`);
    if (await page.eval(`window.__wse.pins.all().length`) !== 0) throw new Error('a bare Tahoe added something');
    await inp.key(null, 'Enter');
    await shown(page, '.wse-sheet [data-f=city]', 'the Add sheet');
    await sleep(500);
    await snap('sheet-choice-pending');
  },
};
