// Tour stop 22: coastlines, borders and (Regional) state lines over the field, (Josh point 6; DESIGN-SPEC 4.4). This stop is the Paper walk; 22-linework-night is the Night walk. The runner only emulates
// prefers-color-scheme for `ground` and the app ignores that on load, so Paper needs `theme: 'light'` (it clicks #btn-theme).
// Owner W3-02 (gate:false only because of the shell's own layout failures, see mvpReason). Walks Regional, Hemisphere and Global with the view switch; the pixel measurement itself is S-LINEART, this
// stop puts the picture on the contact sheet for a human and runs the layout assertions.
import { mustBeVisible } from '../lib/steps.mjs';

export async function walk(page, inp, { snap }, expect) {
  const theme = await page.eval(`document.documentElement.dataset.theme || 'dark'`);
  if (theme !== expect) throw new Error(`linework stop wants the ${expect} theme, the page is ${theme}`);
  await runWalk(page, inp, snap);
}

export default {
  id: '22-linework',
  owner: 'W3-02',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: "measured on the MVP shell, not on the linework: the strip's day cells overlap their initials (desktop) and the view-switch buttons are 40 px tall (phone). W3-04/W3-05 own those; the stop is ungated until the shell is rewritten (W5-03 fails on any ungated stop).",
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  ground: 'paper',
  theme: 'light',
  async run(page, inp, { snap }) { return walk(page, inp, { snap }, 'light'); },
};

async function runWalk(page, inp, snap) {
  // the 50 m files swap in when idle: wait for them so the picture is the at-rest one
  await page.waitFor(`(async () => { const b = await import('/js/render/basemap.js'); return b.basemapTier && b.basemapTier() === 2; })()`, { timeout: 15000 });
  await mustBeVisible(page, '#map', 'the map');
  await snap('regional');
  for (const [view, name] of [['nh', 'hemisphere'], ['gl', 'global']]) {
    await inp.activate(`#view-switch [data-view="${view}"]`);
    await page.waitFor(`__wse.store.get().view === ${JSON.stringify(view)}`, { timeout: 5000 });
    await mustBeVisible(page, '#map', 'the map');
    await snap(name);
  }
  await inp.activate('#view-switch [data-view="np"]');
  await page.waitFor(`__wse.store.get().view === 'np'`, { timeout: 5000 });
}
