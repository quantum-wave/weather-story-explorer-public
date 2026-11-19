// Tour stop 05: add a trip, then open its edit sheet (Josh points 3, 10: date fields, the modal that expands and contracts).
// MVP shell: gate:false; the owner package rewrites this stop and sets gate:true. mvpFails: assertion numbers of spec 14.3
// (1 overlap, 2 hscroll, 3 textsize, 4 clipped, 5 target).
import { dragSheet, openQuickAddAndType, mustBeVisible, typeDate } from '../lib/steps.mjs';

export default {
  id: '05-edit-trip',
  owner: 'W3-07',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: 'measured on the MVP shell: the trip-dates frame has the view switch and Layers button over the scrubber and 40 px view-switch buttons (phone); the edit sheet itself is clean',
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run(page, inp, { snap }) {
    await dragSheet(page, inp, 'full', -500);
    await openQuickAddAndType(page, inp, '#empty-trips', 'Portland, OR'); // the field opens with "Trip: " already in it
    await inp.activate('.pn-btn.primary'); // no dates yet: the app asks for them
    await mustBeVisible(page, '.pn-dates', 'the trip date fields');
    // Type the digits into the real date fields (see typeDate: month segment first, MMDDYYYY).
    const from = await typeDate(page, inp, 'input[aria-label="Trip start"]', '12202026');
    const to = await typeDate(page, inp, 'input[aria-label="Trip end"]', '12222026');
    if (from !== '2026-12-20' || to !== '2026-12-22') throw new Error(`typing into the date fields gave "${from}" and "${to}", not 2026-12-20 and 2026-12-22`);
    await snap('trip-dates');
    await inp.activate('.pn-dates .pn-btn.primary');
    await page.waitFor(`!!document.querySelector('[aria-label^="Edit trip"]')`, { timeout: 8000 });
    await inp.activate('[aria-label^="Edit trip"]');
    await mustBeVisible(page, '.pn-sheet', 'the edit trip sheet');
  },
};
