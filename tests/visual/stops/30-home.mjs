// Tour stop 30: the home panel, "Your week" (Josh points 1, 4, 5): the range control, the strip, a day tapped, range 10 (and on the
// phone the compressed end cell, then the full strip). Phone first at half, where a day tap must keep the sheet at half.
import { dragSheet, mustBeVisible } from '../lib/steps.mjs';

export default {
  id: '30-home',
  owner: 'W3-06',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: 'the home panel itself is clean at both sizes; what still fails is the shell W3-04 owns: the 40 px view-switch buttons (phone) and, with the sheet at full, the view switch and Layers button over the scrubber and sheet handle. Set gate: true when W3-04 lands.',
  viewports: ['phone', 'desktop'],
  data: 'synthetic-15d',
  // the strip's tappable columns lie under their own labels by design (a tap on a word is a tap on its day); the map canvas lies under every map control
  allowOverlap: [['rect.strip-day', 'svg.strip text'], ['rect.strip-end', 'svg.strip text'], ['#map', '*']],
  scrollers: ['.strip-wrap.expanded'], // the full 15-day strip scrolls sideways inside its wrapper by design
  async run(page, inp, { snap }) {
    await dragSheet(page, inp, 'half', -220);
    await page.eval(`document.getElementById('home-body').scrollTo(0, 0)`);
    await mustBeVisible(page, '#sec-week .strip-day', 'the week strip');
    await snap('week');
    await inp.activate('#sec-week .strip-day[data-day="2"]');
    await inp.wait(900);
    await snap('day-tapped');
    await inp.activate('#range-control .range-btn[data-range="15"]');
    await inp.wait(900);
    await snap('range-15');
    if (inp.phone) {
      await inp.activate('#sec-week .strip-end');
      await inp.wait(700);
      await snap('full-strip');
    }
  },
};
