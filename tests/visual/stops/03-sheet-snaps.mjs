// Tour stop 03: the bottom sheet at its three snap points, reached by dragging its handle (Josh points 5, 10).
// On the desktop the panel is docked, so the frames repeat. MVP shell: gate:false; the owner package rewrites this stop.
// mvpFails: assertion numbers of spec 14.3 (1 overlap, 2 hscroll, 3 textsize, 4 clipped, 5 target).
import { dragSheet } from '../lib/steps.mjs';

export default {
  id: '03-sheet-snaps',
  owner: 'W3-04',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: 'measured on the MVP shell: with the sheet at full the view switch and Layers button sit over the scrubber track and sheet handle; Change, Add and Got it are 24-68 x 28-36 px (phone)',
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run(page, inp, { snap }) {
    await snap('peek');
    await dragSheet(page, inp, 'half', -220);
    await snap('half');
    await dragSheet(page, inp, 'full', -400);
  },
};
