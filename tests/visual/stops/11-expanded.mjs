// Tour stop 11: the map expanded to the whole viewport, then restored (Josh point 9; design spec 4.7 and 11.3).
// Reached with the real control: a tap on the phone, a click on the desktop.
import { mustBeVisible } from '../lib/steps.mjs';

export default {
  id: '11-expanded',
  owner: 'W3-05',
  // W4-06: where the browser allows it, Expand is also native fullscreen; the frame is the same either way (S-FRAME compares the rects)
  gate: false,
  mvpFails: [1, 5],
  mvpReason: "the remaining offenders are not this package's (rescue 2, after the legend was lifted over the scrubber: no legend or chip " +
    "offender left): the map canvas is focusable since W3-01 (render/index.js tabindex 0), so the layout check counts it as a control under " +
    "every map tool; the strip's day cells overlap their initials (home.js, W3-06); the view-switch buttons are 40 px and the Layers button 39 px " +
    "wide (shell.css, W3-04); the legend's toggle (36 px) and What is this? (28 px) are short targets (legend.css, W3-11). Set gate: true once those land",
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run(page, inp, { snap }) {
    await inp.activate('#btn-expand');
    await page.waitFor(`document.getElementById('app').hasAttribute('data-expanded')`, { timeout: 3000 });
    await inp.wait(500);
    await mustBeVisible(page, '#map-tools', 'the map tools');
    await mustBeVisible(page, '#timeline', 'the timeline');
    // the header (and its sample label) is hidden; in the phone layouts (narrow, or a landscape touch phone of any width, where the legend
    // is a one-row bar) the map carries the label instead (the wide legend draws its own). Same media list as frame.css and ui/layout.js.
    const phoneLayout = "matchMedia('(max-width: 899px), (orientation: landscape) and (max-height: 500px) and (pointer: coarse)').matches";
    if (await page.eval(`${phoneLayout} && !!window.__wse.data.getManifest()?.sample`)) await mustBeVisible(page, '#expanded-sample', 'the sample label');
    await snap('expanded');
    // native fullscreen, where the document allows it, is on while expanded and off after Exit
    if (await page.eval('document.fullscreenEnabled === true')) {
      if (!(await page.eval('!!document.fullscreenElement'))) throw new Error('expanded, but native fullscreen is not on although the document allows it');
    }
    await inp.key(null, 'Escape');
    await page.waitFor(`!document.getElementById('app').hasAttribute('data-expanded')`, { timeout: 3000 });
    await inp.wait(500);
    await mustBeVisible(page, '#home', 'the story panel');
    if (await page.eval('!!document.fullscreenElement')) throw new Error('Exit left native fullscreen on');
    // the last frame the runner takes is the restored page
  },
};
