// Tour stop 14: the desktop divider (W4-06, Josh points 9, 5; design spec 4.7). Dragged with the real mouse to a wider panel, then
// folded to the 44 px rail with a double-click, then restored. Desktop only: on the phone the sheet's handle is the resize control.
import { mustBeVisible } from '../lib/steps.mjs';

export default {
  id: '14-divider',
  owner: 'W4-06',
  gate: false,
  mvpFails: [1, 3],
  mvpReason: "the remaining offenders are the story panel's own, not the divider's: the strip's day cells overlap their initials (home.js, W3-06), and the strip's SVG labels draw at 11.65 px when the panel is at its 300 px minimum (the strip scales to the panel width). Set gate: true once home.js keeps its labels at 12 px",
  allowOverlap: [['#map', '*']], // the canvas is focusable (W3-01), so the layout check counts the tools over it
  viewports: ['desktop'],
  data: 'synthetic',
  async run(page, inp, { snap }) {
    await mustBeVisible(page, '#divider', 'the divider');
    await snap('default');
    await inp.drag('#divider', { by: { dx: 140, dy: 0 } });
    await inp.wait(400);
    await snap('wider');
    await inp.drag('#divider', { by: { dx: -300, dy: 0 } });
    await inp.wait(400);
    await snap('narrowest');
    await inp.click('#divider', { count: 2 });
    await inp.wait(500);
    await snap('folded');
    await inp.click('#btn-fold');
    await inp.wait(500);
    await mustBeVisible(page, '#home', 'the story panel');
  },
};
