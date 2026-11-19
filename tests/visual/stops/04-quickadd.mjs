// Tour stop 04: add a person with quick add: the field open with text typed, then the pin added (Josh points 2, 10).
// MVP shell: gate:false; the owner package rewrites this stop and sets gate:true. mvpFails: assertion numbers of spec 14.3
// (1 overlap, 2 hscroll, 3 textsize, 4 clipped, 5 target).
import { dragSheet, openQuickAddAndType, mustBeVisible } from '../lib/steps.mjs';

export default {
  id: '04-quickadd',
  owner: 'W3-07',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: 'measured on the MVP shell: the added-pin toast overlaps the panel and scrubber text (both sizes); at full the view switch and Layers button sit over the scrubber; Add links are 24 x 28 px and chips 36 px tall (phone)',
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run(page, inp, { snap }) {
    await dragSheet(page, inp, 'full', -500);
    await openQuickAddAndType(page, inp, '#empty-people', 'Maya in Portland, OR');
    await mustBeVisible(page, '.pn-suggest button, [role=listbox] button', 'the city suggestions');
    await snap('typed');
    await inp.activate('.pn-btn.primary');
    await page.waitFor(`!!document.querySelector('.person-main')`, { timeout: 8000 });
  },
};
