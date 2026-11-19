// Tour stop 23: the globe, chosen with the view switch and rotated by a real drag that starts on a visible part of the globe
// (not on the always-on legend or another control). Fails if the drag leaves the globe where it was. Owner W3-03.
import { mustBeVisible } from '../lib/steps.mjs';

// Reading the renderer to pick a start point is fine (14.1 rule 3); the rotation itself is made by real input.
const FIND_START = `(() => {
  const map = document.querySelector('#map'), r = map.getBoundingClientRect(), R = window.__wse.renderer;
  let best = null;
  for (let y = r.top + 24; y < r.bottom - 24; y += 12) for (let x = r.left + 24; x < r.right - 24; x += 12) {
    if (document.elementFromPoint(x, y) !== map) continue;
    const ll = R.invert([x - r.left, y - r.top]);
    if (!ll || !isFinite(ll[0]) || !isFinite(ll[1])) continue;
    const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
    if (!best || d < best.d) best = { x, y, d };
  }
  return best;
})()`;

export default {
  id: '23-globe',
  owner: 'W3-03',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: "other packages' boxes, the same ones 01-views reports on pure t/redesign: the strip's day cells overlap their initials (desktop); the view-switch buttons are 40 px tall (phone)",
  allowOverlap: [['#map', '*']], // the full-bleed focusable map canvas lies under every map control by design
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run(page, inp) {
    await inp.activate('#view-switch [data-view="gl"]');
    await page.waitFor(`__wse.store.get().view === 'gl'`, { timeout: 5000 });
    await mustBeVisible(page, '#map', 'the map');
    await inp.wait(600);
    const rot0 = await page.eval(`JSON.stringify(__wse.renderer.getTransform().rot)`);
    const start = await page.eval(FIND_START);
    if (!start) throw new Error('no part of the globe is free of controls to start a drag on');
    await inp.drag({ x: start.x, y: start.y }, { by: { dx: -90, dy: 40 }, steps: 8, ms: 500 });
    await inp.wait(900);
    const rot1 = await page.eval(`JSON.stringify(__wse.renderer.getTransform().rot)`);
    if (rot0 === rot1) throw new Error(`dragging from (${Math.round(start.x)}, ${Math.round(start.y)}) left the globe unrotated (${rot0})`);
  },
};
