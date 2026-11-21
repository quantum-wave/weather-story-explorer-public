// Tour stop 60: "What am I looking at?" and "How sure is this?" (Josh points 13 and 8; DESIGN-SPEC 5.2, 5.5), on the recorded forecast.
// Phone: the bottom sheet; desktop: the 420 px dialog. The answer first, the diagram, then (scrolled) the readout words, "For you",
// How sure and About this data; then the How sure panel with this run's spread chart. Reached by taps and clicks. Owner W4-02.
import { mustBeVisible } from '../lib/steps.mjs';

const body = (page, y) => page.eval(`(() => { const b = document.querySelector('.wse-sheet-root .wse-sheet-body'); b.scrollTop = ${y === 'end' ? 'b.scrollHeight' : y}; return b.scrollTop; })()`);

export default {
  id: '60-guide',
  owner: 'W4-02',
  gate: true,
  viewports: ['phone', 'desktop'],
  data: 'recorded',
  ground: 'paper',
  theme: 'light',
  allowOverlap: [['#map', '*'], ['rect.strip-day', 'svg.strip text'], ['rect.strip-end', 'svg.strip text']], // the week strip behind the sheet is W3-06's: its label-over-cell overlap is its own stop's allowance (30-home)
  allowTarget: ['#map-legend .mlg-toggle', '#map-legend .mlg-what'], // the 36 px legend row is W3-11's (10-shell allows it too)
  scrollers: ['.wse-sheet-body'],
  async run(page, inp, { snap }) {
    await page.eval(`localStorage.setItem('wse.v1.prefs', JSON.stringify({ coachSeen: ['drag', 'play', 'tap'] }))`);
    await inp.wait(200);
    await mustBeVisible(page, '#map-legend .mlg-what', '"What is this?"');
    await inp.activate('#map-legend .mlg-what');
    await page.waitFor(`!!document.querySelector('.wse-sheet-root .gd')`, { timeout: 8000 });
    await inp.wait(700);
    await snap('answer');
    await body(page, 420);
    await inp.wait(300);
    await snap('read');
    await body(page, 'end');
    await inp.wait(300);
    await snap('about');
    await body(page, 0);
    await inp.wait(200);
    await inp.activate('.wse-sheet-root [data-guide-go="sure"]');
    await page.waitFor(`!!document.querySelector('.wse-sheet-root .gd-chart')`, { timeout: 8000 });
    await inp.wait(1800);
    await body(page, 300);
    await inp.wait(300);
    await snap('sure');
  },
};
