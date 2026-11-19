// Tour stop 01: the three map views (Regional, Hemisphere, Global), chosen with the view switch (Josh points 11, 12).
// MVP shell: gate:false; the owner package rewrites this stop and sets gate:true. mvpFails: assertion numbers of spec 14.3
// (1 overlap, 2 hscroll, 3 textsize, 4 clipped, 5 target).
import { mustBeVisible } from '../lib/steps.mjs';

export default {
  id: '01-views',
  owner: 'W3-03',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: "measured on the MVP shell: the strip's day cells overlap their initials (desktop); the view-switch buttons are 40 px tall (phone)",
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run(page, inp, { snap }) {
    for (const [view, name] of [['nh', 'hemisphere'], ['gl', 'global']]) {
      await inp.activate(`#view-switch [data-view="${view}"]`);
      await page.waitFor(`__wse.store.get().view === ${JSON.stringify(view)}`, { timeout: 5000 });
      await mustBeVisible(page, '#map', 'the map');
      await snap(name);
    }
    await inp.activate('#view-switch [data-view="np"]'); // back to Regional; the runner takes the final frame
    await page.waitFor(`__wse.store.get().view === 'np'`, { timeout: 5000 });
  },
};
