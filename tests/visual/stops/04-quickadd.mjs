// Tour stop 04: add a person: the inline box with text typed and its place choices, then the Add sheet opened from it with the
// place still a choice, then one place chosen (Josh points 2, 10; saving is proved in S-ADDFLOW). Owner W3-07; the sheet scopes the layout assertions.
import { dragSheet, openQuickAddAndType, mustBeVisible } from '../lib/steps.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shown = (page, sel, what) => page.waitFor(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`, { timeout: 8000 }).catch(() => { throw new Error(`expected ${what} to be on screen`); });

export default {
  id: '04-quickadd',
  owner: 'W3-07',
  gate: true,
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run(page, inp, { snap }) {
    await dragSheet(page, inp, 'full', -500);
    // the empty People row opens the Add sheet (W3-06 addFlow on openAddSheet), so the inline box is reached by its own field
    await openQuickAddAndType(page, inp, '#quickadd-host textarea', 'Maya in Portland');
    await mustBeVisible(page, '.pn-suggest [role=option]', 'the place choices under the box');
    await inp.activate('.pn-more'); // "Add with details" opens the Add sheet with the text and the place choice pending
    await shown(page, '.wse-sheet [data-f=city]', 'the Add sheet with its City field');
    await page.waitFor(`document.querySelectorAll('.wse-sheet [role=option]').length >= 2`, { timeout: 8000 });
    await sleep(400);
    await snap('choice-pending');
    await inp.activate('.wse-sheet [role=option]');
    await sleep(400);
    await snap('chosen'); // the stop ends with the sheet open: the frame without a sheet belongs to the shell's own layout assertions
  },
};
