// Tour stop 70: the link tab, opened fresh and reached from the image tab, with the clipboard blocked (the artifact sandbox) and then
// allowed with a person in focus. The sheet must be tall enough to show what it says: the link field, the "links never include people"
// note, and the status after a copy each sit inside the visible rect of the sheet body (a clipped line passes a textContent check and
// fails a person). With the clipboard blocked the link is selected, the sheet says "Select and copy", nothing says "Copied". Gated.
import { mustBeVisible, openShare } from '../lib/steps.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Throw unless `selector` lies wholly inside the visible rect of the sheet body. */
async function mustFit(page, selector, what) {
  const r = await page.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}), b = document.querySelector('.wse-sheet-body');
    if (!e || !b) return 'missing'; const a = e.getBoundingClientRect(), v = b.getBoundingClientRect();
    return a.height > 0 && a.top >= v.top - 0.5 && a.bottom <= v.bottom + 0.5 ? 'ok' : 'box ' + Math.round(a.top) + '-' + Math.round(a.bottom) + ' outside body ' + Math.round(v.top) + '-' + Math.round(v.bottom); })()`);
  if (r !== 'ok') throw new Error(`${what} is not inside the visible sheet body: ${r}`);
}

export default {
  id: '70-share',
  owner: 'W4-07',
  gate: true,
  mvpFails: [],
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run(page, inp, { snap }) {
    const blocked = `Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) }, configurable: true })`;
    const allowed = `Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true })`;
    const copy = async () => { await inp.activate('.wse-sheet-btn[data-action="copy-link"]'); await sleep(700); };

    // 1. the Link tab opened directly (the documented bus event, as a link in the page would do), clipboard blocked
    await page.eval(blocked);
    await page.eval(`import('./js/state.js').then(({ bus }) => bus.emit('share:open', { kind: 'link' }))`);
    await page.waitFor(`!!document.querySelector('.share-link')?.value`, { timeout: 8000 });
    await sleep(700);
    await mustFit(page, '.share-link', 'the link field (fresh open)');
    await mustFit(page, '.share-people', 'the people note (fresh open)');
    await snap('link');
    await copy();
    await mustBeVisible(page, '.share-select', 'the select-and-copy hint');
    await mustFit(page, '.share-select', 'the select-and-copy hint (fresh open)');
    const said = await page.eval(`document.querySelector('.share-status').textContent`);
    if (/copied/i.test(said)) throw new Error('the sheet said "' + said + '" with the clipboard blocked');
    await mustFit(page, '.share-status', 'the status after a blocked copy');
    await snap('blocked');
    await inp.activate('.wse-sheet-close');
    await sleep(500);

    // 2. Image -> Link, with a person in focus and a working clipboard: the people note and the copy status stay in view
    await page.eval(allowed);
    await page.eval(`__wse.store.set({ focus: { lat: 40.7, lon: -74, label: 'New York', kind: 'person' } })`);
    await openShare(page, inp); // the phone reaches Share through More
    await page.waitFor(`!!document.querySelector('.wse-sheet') && !!document.querySelector('.share-preview img')`, { timeout: 15000 });
    await inp.activate('.share-tab[data-kind="link"]');
    await page.waitFor(`!!document.querySelector('.share-link')?.value`, { timeout: 8000 });
    await sleep(700);
    await mustFit(page, '.share-link', 'the link field (after Image -> Link)');
    await mustFit(page, '.share-people', 'the people note (after Image -> Link)');
    await copy();
    const ok = await page.eval(`document.querySelector('.share-status').textContent`);
    if (!/^Copied/.test(ok) || !/never include people/.test(ok)) throw new Error('a person-focused copy said "' + ok + '"');
    await mustFit(page, '.share-status', 'the person-focused copy status');
    await snap('person');
  },
};
