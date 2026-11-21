// Tour stop 03: the bottom sheet at its three snap points, reached by dragging its handle (Josh points 5, 10).
// On the desktop the panel is docked, so the frames repeat. Gated since W3-04: the layout assertions of spec 14.3 must pass at peek, half and full.
import { dragSheet } from '../lib/steps.mjs';

export default {
  id: '03-sheet-snaps',
  owner: 'W3-04',
  gate: true,
  // each strip column's tap target (rect.strip-day) is transparent and spans its whole column, so every label drawn in that column (day, "normal") lies inside it; text against text is still judged (W2-06's strip); everything else must not overlap
  allowOverlap: [['#map', '*'], ['svg.strip rect.strip-day', 'svg.strip text']],
  // W3-11's collapsed phone legend: its toggle row is 36 px and "What is this?" 28 px high by design (DESIGN-SPEC 5.1, 11.1: one
  // 36 px row; tour stop 24 records the same). Listed so the gate judges this package's controls; the tour prints them every run.
  allowTarget: ['#map-legend .mlg-toggle', '#map-legend .mlg-what'],
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run(page, inp, { snap }) {
    await snap('peek');
    await dragSheet(page, inp, 'half', -220);
    await snap('half');
    await dragSheet(page, inp, 'full', -400);
  },
};
