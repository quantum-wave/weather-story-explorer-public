// Tour stop 50: the timeline (Josh points 5, 8, 14; DESIGN-SPEC 7.1, 7.2). Frames: at rest early, late in the run, and paused
// between model steps, then the phone's half snap. Phone also at the half and full snaps (56 / 72 / 56 px tall).
import { mustBeVisible } from '../lib/steps.mjs';

export default {
  id: '50-timeline',
  owner: 'W3-08',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: 'measured on the MVP shell: every offender is the full-bleed #map canvas overlapping the controls above it (view switch, Layers, the docked timeline, the sheet) or the home strip\'s own labels, plus the 40 px view-switch buttons; none is between two timeline elements (checked against report.json). W3-04 owns the shell and sets gate:true when #map stops being the control it overlaps',
  viewports: ['phone', 'desktop'],
  data: 'synthetic', // the tour browser only reaches the default fixture's origin; the 15-day zones are asserted by S-TIMELINE
  async run(page, inp, { snap }) {
    await page.waitFor(`document.querySelectorAll('#timeline .tl-cell:not([data-state="nodata"])').length >= 5`, { timeout: 15000 });
    await page.eval(`(async () => { const c = await import('./js/time/clock.js'); c.pause(); c.seek(12); return true; })()`);
    await mustBeVisible(page, '#timeline .tl-track', 'the timeline track');
    await snap('early');
    await page.eval(`(async () => { const c = await import('./js/time/clock.js'); c.seek(42); return true; })()`);
    await snap('late');
    await page.eval(`(async () => { const c = await import('./js/time/clock.js'); c.seek(25.5); return true; })()`);
    await snap('between-steps');
    await page.eval(`__wse.store.set({ sheet: 'half' })`);
    await new Promise((r) => setTimeout(r, 450));
    await snap('half');
  },
};
