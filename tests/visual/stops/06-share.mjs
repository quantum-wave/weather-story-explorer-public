// Tour stop 06: the share sheet, opened from the header (Josh points 5, 11; the one-dataset-per-screen finding). The one sheet
// (ui/sheet.js): the image tab with the picture the share makes, the loop tab, then the link tab. Gated.
import { mustBeVisible, openShare } from '../lib/steps.mjs';

export default {
  id: '06-share',
  owner: 'W4-07',
  gate: true,
  mvpFails: [],
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run(page, inp, { snap }) {
    await openShare(page, inp); // the phone reaches Share through More
    await page.waitFor(`!!document.querySelector('.wse-sheet') && !!document.querySelector('.share-preview img')`, { timeout: 15000 });
    await mustBeVisible(page, '.wse-sheet', 'the share sheet');
    await mustBeVisible(page, '.share-preview img', 'the picture the share made');
    await snap('image');
    await inp.activate('.share-tab[data-kind="loop"]');
    await page.waitFor(`document.querySelector('.wse-sheet-title')?.textContent === 'Share a loop'`, { timeout: 5000 });
    await snap('loop');
    await inp.activate('.share-tab[data-kind="link"]');
    await page.waitFor(`document.querySelector('.wse-sheet-title')?.textContent === 'Share a link' && !!document.querySelector('.share-link')?.value`, { timeout: 8000 });
    await mustBeVisible(page, '.share-link', 'the link field');
    await mustBeVisible(page, '.share-people', 'the note that links never include people');
    await snap('link');
  },
};
