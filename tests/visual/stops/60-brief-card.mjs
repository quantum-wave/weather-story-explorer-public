// Tour stop 60: The Briefing's card and pill on the component's own test page (fixture beats, no app): the title, the hold beat, home
// with its strip, a pattern-only trip beat, the sure beat and the end beat. The page is a static file on the site's origin (hash), and
// the test page is written over it so /css and /js resolve. Reduced motion is emulated by the tour, so every frame is still.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = fs.readFileSync(path.join(here, '..', '..', 'site', 'pages', 'brief-card.html'), 'utf8');

export default {
  id: '60-brief-card',
  owner: 'C1-03',
  gate: false,
  hash: 'css/tokens.css',
  mvpFails: [],
  mvpReason: 'component page: the card is the only content, and it lies over a bare stage by design',
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  allowOverlap: [['#stage', '*'], ['#fake-timeline', '*']], // the stage stands in for the map and the bar for the timeline
  async run(page, inp, { snap }) {
    await page.eval(`(() => { document.open(); document.write(${JSON.stringify(PAGE)}); document.close(); })()`);
    await page.waitFor('window.__briefReady === true', { timeout: 15000 });
    await inp.wait(200);
    const show = (name, o = {}) => page.eval(`__brief.show(${JSON.stringify(name)}, ${JSON.stringify({ which: 'full', ...o })})`);
    await show('title', { progress: 0 }); await snap('title');
    await show('hold', { progress: 0.45 }); await snap('hold');
    await show('home', { progress: 0.6 }); await snap('home-strip');
    await show('trip', { progress: 0.5 }); await snap('trip-pattern-only');
    await show('sure', { progress: 0.7, state: 'paused' }); await snap('sure');
    await show('end', { which: 'noPeople' }); await snap('end');
  },
};
