// Tour stop 30: the home panel, "Your week" (Josh points 1, 4, 5): the range control, the day table, a day tapped, range 15 (and on
// the phone the table scrolled to its last days). Phone first at half, where a day tap must keep the sheet at half.
import { dragSheet, mustBeVisible } from '../lib/steps.mjs';

export default {
  id: '30-home',
  owner: 'W3-06',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: 'the home panel itself is clean at both sizes; what still fails is the shell W3-04 owns: the 40 px view-switch buttons (phone) and, with the sheet at full, the view switch and Layers button over the scrubber and sheet handle. Set gate: true when W3-04 lands.',
  viewports: ['phone', 'desktop'],
  data: 'synthetic-15d',
  // the map canvas lies under every map control
  allowOverlap: [['#map', '*']],
  scrollers: ['.strip-wrap.dt-scroll'], // the day table scrolls sideways inside its wrapper when the days do not fit, by design
  async run(page, inp, { snap }) {
    await dragSheet(page, inp, 'half', -220);
    await page.eval(`document.getElementById('home-body').scrollTo(0, 0)`);
    await mustBeVisible(page, '#sec-week .strip-day', 'the week day table');
    await snap('week');
    await inp.activate('#sec-week .strip-day[data-day="2"]');
    await inp.wait(900);
    await snap('day-tapped');
    await inp.activate('#range-control .range-btn[data-range="15"]');
    await inp.wait(900);
    await snap('range-15');
    if (inp.phone) {
      await page.eval(`(() => { const w = document.querySelector('#sec-week .strip-wrap'); w.scrollLeft = w.scrollWidth; })()`);
      await inp.wait(700);
      await snap('table-end');
    }
  },
};
