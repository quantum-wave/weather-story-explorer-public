// Tour stop 05: add a trip with dates typed into the real date fields of the Add sheet, then open its edit sheet (Josh points 3, 10:
// date fields, the modal that expands and contracts). Owner W3-07.
import { dragSheet, openQuickAddAndType, mustBeVisible, typeDate } from '../lib/steps.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shown = (page, sel, what) => page.waitFor(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`, { timeout: 8000 }).catch(() => { throw new Error(`expected ${what} to be on screen`); });

export default {
  id: '05-edit-trip',
  owner: 'W3-07',
  gate: true,
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run(page, inp, { snap }) {
    await dragSheet(page, inp, 'full', -500);
    // the empty Trips row opens the Add sheet (W3-06 addFlow on openAddSheet), so the trip is typed into the inline box's own field
    await openQuickAddAndType(page, inp, '#quickadd-host textarea', 'Trip: Tahoe in South Lake Tahoe, CA');
    await inp.key(null, 'Enter'); // no dates yet: the Add sheet opens on Trip with the place settled
    await shown(page, '.wse-sheet input[name=from]', 'the trip date fields in the sheet');
    await sleep(400);
    const from = await typeDate(page, inp, '.wse-sheet input[name=from]', '12202026');
    const to = await typeDate(page, inp, '.wse-sheet input[name=to]', '12222026');
    if (from !== '2026-12-20' || to !== '2026-12-22') throw new Error(`typing into the date fields gave "${from}" and "${to}", not 2026-12-20 and 2026-12-22`);
    await snap('trip-dates');
    await inp.activate('.wse-sheet [data-action="save"]');
    await page.waitFor(`!!document.querySelector('[aria-label^="Edit trip"]')`, { timeout: 8000 });
    await sleep(500);
    await inp.activate('[aria-label^="Edit trip"]');
    await shown(page, '.wse-sheet input[name=to]', 'the edit trip sheet');
    await sleep(400);
    await snap('edit-trip');
  },
};
