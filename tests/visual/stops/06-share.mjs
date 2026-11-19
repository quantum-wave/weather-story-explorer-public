// Tour stop 06: the share sheet, opened from the header (Josh points 5, 11; the one-dataset-per-screen finding).
// MVP shell: gate:false; the owner package rewrites this stop and sets gate:true. mvpFails: assertion numbers of spec 14.3
// (1 overlap, 2 hscroll, 3 textsize, 4 clipped, 5 target).
import { mustBeVisible } from '../lib/steps.mjs';

export default {
  id: '06-share',
  owner: 'W4-07',
  gate: false,
  mvpFails: [],
  mvpReason: 'measured on the MVP shell: the share sheet is a modal, so only its content is judged and it has no offenders; the owner still sets gate:true when it rewrites the stop',
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run(page, inp) {
    await inp.activate('#btn-share');
    await page.waitFor(`!!document.querySelector('.share-sheet, [role=dialog], .sh-sheet')`, { timeout: 8000 });
    await mustBeVisible(page, '.share-sheet, [role=dialog], .sh-sheet', 'the share sheet');
  },
};
