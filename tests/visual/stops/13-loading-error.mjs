// Tour stop 13: a layer that failed to load (status line with Retry) and a toast with an action (design spec 8.5; Josh point 5).
// A chunk failure cannot be reached by input, so the stop raises the app's own failure event, data:error, and a toast through the
// module the app uses; the pixels are the app's real status and toast, and Retry is the real handler.
import { mustBeVisible } from '../lib/steps.mjs';

export default {
  id: '13-loading-error',
  owner: 'W3-05',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: "the remaining offenders are not this package's: the strip's day cells overlap their initials (home.js, W3-06, desktop and the phone sheet) and the view-switch buttons are 40 px and the Layers button 39 px wide (shell.css, W3-04); nothing W3-05 owns offends. Set gate: true once those land",
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run(page, inp, { snap }) {
    await page.eval(`(async () => {
      const st = await import(new URL('js/state.js', document.baseURI).href);
      st.bus.emit('data:error', { field: 'z500a', domain: 'np05', chunk: 'a', message: 'z500a.np05.a.bin corrupt' });
    })()`);
    await page.waitFor(`!!document.querySelector('#map-status .wse-status-retry')`, { timeout: 3000 });
    await mustBeVisible(page, '#map-status .wse-status-retry', 'the Retry button');
    await snap('layer-failed');
    await page.eval(`(async () => {
      const m = await import(new URL('js/ui/status.js', document.baseURI).href);
      m.showToast({ text: 'Could not copy the link', action: { label: 'Select and copy', run() {} }, ms: 60000 });
    })()`);
    await inp.wait(400);
    await mustBeVisible(page, '.wse-toast', 'the toast');
  },
};
