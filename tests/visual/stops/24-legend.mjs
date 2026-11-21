// Tour stop 24: the legend that teaches (Josh points 13 and 7). Phone: the 36 px collapsed row over the chart, then expanded by a tap.
// Desktop: the 320 px card open, then collapsed with its control. Reached by real taps and clicks.
import { mustBeVisible } from '../lib/steps.mjs';

export default {
  id: '24-legend',
  owner: 'W3-11',
  gate: false,
  allowOverlap: [['#map', '*']], // the full-bleed focusable map canvas lies under the legend card by design
  mvpFails: [1, 4, 5],
  mvpReason: 'none of the legend text is under 12 px and the legend overlaps only the #map canvas (allowOverlap). Still measured: 5 on the legend (its collapse row is 36 px and "What is this?" 28 px high by design, DESIGN-SPEC 5.1; the stage tap targets are 44 px elsewhere), and, owned by other packages, 1 (the week strip labels over their day rects on desktop), 4 (the phone focus-card day line clipped) and 5 (the three view-switch buttons are 40 px high)',
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run(page, inp, { snap, viewport }) {
    await mustBeVisible(page, '#map-legend', 'the legend');
    await snap(viewport === 'phone' ? 'collapsed' : 'open');
    await inp.activate('#map-legend .mlg-toggle');
    await inp.wait(300);
    await snap(viewport === 'phone' ? 'expanded' : 'collapsed');
  },
};
