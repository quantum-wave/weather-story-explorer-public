// S-PROJ: each view draws a canvas with non-trivial pixel variance and no edge frame, from a real screenshot.
import { mount, shoot, stats, edgeRingDiff } from '../wp2/shot.mjs';

export const id = 'S-PROJ';
export const freshProfile = false;
export const timeoutMs = 90000;
const OCEAN = [12, 16, 20];
const LAYERS = { z: true, j: false, c: false, t: false };

export async function run({ page, baseUrl, assert }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 45000 });
  const t = await page.eval('window.__wse.data.getManifest().fields.z500a.steps[1]');
  for (const [view, w, h, dpr] of [['np', 1000, 600, 1], ['nh', 800, 800, 1], ['gl', 1100, 620, 1], ['np', 390, 844, 2]]) {
    await mount(page, { width: w, height: h, dpr });
    const img = await shoot(page, { view, layers: LAYERS, case: 'A', theme: 'dark', t }, `proj-${view}-${w}x${h}`);
    assert.equal(img.w, w * dpr, `${view} ${w}x${h}@${dpr} screenshot width`);
    const legendTop = Math.round(h * dpr * 0.62);
    const field = stats(img, [0, 0, img.w, legendTop], OCEAN);
    const label = `${view} ${w}x${h}@${dpr}`;
    assert.ok(field.std > 6, `${label}: luminance spread ${field.std.toFixed(1)} too flat`);
    assert.ok(field.offBg > 0.15, `${label}: only ${(field.offBg * 100).toFixed(1)}% of pixels differ from the ocean`);
    assert.ok(field.tinted > 0.04, `${label}: anomaly tint covers ${(field.tinted * 100).toFixed(1)}% (blue ${(field.blue * 100).toFixed(1)}, amber ${(field.amber * 100).toFixed(1)})`);
    assert.ok(edgeRingDiff(img) < 8, `${label}: the canvas edge is framed (${edgeRingDiff(img).toFixed(1)})`);
    // projection round trip and view-specific geometry, in CSS px
    const probe = await page.eval(`(() => { const r = window.__wp2.renderer, out = {};
      for (const [k, ll] of Object.entries({ sf: [-122.42, 37.77], ny: [-74, 40.7], hon: [-157.86, 21.3] })) { const p = r.project(ll); out[k] = p && { p, back: r.invert(p) }; }
      return out; })()`);
    for (const [k, v] of Object.entries(probe)) {
      if (!v) { assert.ok(k !== 'sf', `${label}: San Francisco is not projectable`); continue; }
      assert.ok(v.back && Math.abs(v.back[0] - { sf: -122.42, ny: -74, hon: -157.86 }[k]) < 0.05, `${label}: invert(project(${k})) = ${v.back}`);
    }
    const sf = probe.sf.p;
    assert.ok(sf[0] > 0 && sf[0] < w && sf[1] > 0 && sf[1] < h, `${label}: San Francisco on screen at ${sf}`);
    if (view === 'np' && w < h) assert.ok(Math.abs(sf[0] / w - 0.7) < 0.03, `portrait np: SF ${(sf[0] / w).toFixed(2)} across, want 0.70`);
    if (view === 'nh') assert.ok(sf[1] > h / 2 && Math.abs(sf[0] - w / 2) < 2, `nh: SF's meridian points down, SF at ${sf}`);
  }
  // pan and zoom: wheel zooms about the pointer, reset returns, nh drag spins
  await mount(page, { width: 1000, height: 600 });
  await shoot(page, { view: 'np', layers: LAYERS, case: 'A', t });
  const before = await page.eval('window.__wp2.renderer.project([-122.42, 37.77])');
  await page.eval(`(() => { const c = window.__wp2.canvas; c.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, clientX: 500, clientY: 300, bubbles: true, cancelable: true })); })()`);
  const k1 = await page.eval('window.__wp2.renderer.getTransform().k');
  assert.ok(k1 > 1.5 && k1 <= 6, `wheel zoom k=${k1}`);
  await new Promise((r) => setTimeout(r, 400));
  const zoomed = await page.eval('window.__wp2.renderer.project([-122.42, 37.77])');
  assert.ok(Math.hypot(zoomed[0] - before[0], zoomed[1] - before[1]) > 20, 'zoom moved SF on screen');
  await page.eval('window.__wp2.renderer.resetView(0)');
  assert.equal(await page.eval('window.__wp2.renderer.getTransform().k'), 1);
  await page.eval('window.__wp2.renderer.centreOn(37.77, -122.42, 0, 2)');
  const c = await page.eval('window.__wp2.renderer.project([-122.42, 37.77])');
  assert.ok(Math.abs(c[0] - 500) < 2 && Math.abs(c[1] - 300) < 2, `centreOn puts SF at the centre: ${c}`);
  // pointer gestures: drag pans a zoomed map; two pointers pinch; one pointer spins the north-polar view
  const ptr = (type, id, x, y) => `window.__wp2.canvas.dispatchEvent(new PointerEvent('${type}', { pointerId: ${id}, pointerType: 'touch', clientX: ${x}, clientY: ${y}, button: 0, bubbles: true }))`;
  await page.eval('window.__wp2.renderer.resetView(0)');
  await page.eval('window.__wp2.renderer.centreOn(45, -150, 0, 2)');
  const t0 = await page.eval('window.__wp2.renderer.getTransform()');
  await page.eval(`${ptr('pointerdown', 1, 500, 300)}; ${ptr('pointermove', 1, 440, 270)}; ${ptr('pointermove', 1, 400, 250)}; ${ptr('pointerup', 1, 400, 250)}`);
  const t1 = await page.eval('window.__wp2.renderer.getTransform()');
  assert.ok(Math.abs(t1.tx - (t0.tx - 100)) < 1.5 && Math.abs(t1.ty - (t0.ty - 50)) < 1.5, `drag pans by the finger: ${t0.tx},${t0.ty} -> ${t1.tx},${t1.ty}`);
  await page.eval('window.__wp2.renderer.resetView(0)');
  await page.eval(`${ptr('pointerdown', 1, 450, 300)}; ${ptr('pointerdown', 2, 550, 300)}; ${ptr('pointermove', 1, 350, 300)}; ${ptr('pointermove', 2, 650, 300)}; ${ptr('pointerup', 1, 350, 300)}; ${ptr('pointerup', 2, 650, 300)}`);
  const k2 = await page.eval('window.__wp2.renderer.getTransform().k');
  assert.ok(Math.abs(k2 - 3) < 0.05, `pinch from 100 to 300 px apart zooms 3x: ${k2}`);
  await page.eval('window.__wp2.renderer.resetView(0)');
  await mount(page, { width: 800, height: 800 });
  await shoot(page, { view: 'nh', layers: LAYERS, case: 'A', t });
  const under = await page.eval('window.__wp2.renderer.invert([600, 400])');
  await page.eval(`${ptr('pointerdown', 1, 600, 400)}; ${ptr('pointermove', 1, 565, 565)}; ${ptr('pointermove', 1, 400, 600)}; ${ptr('pointerup', 1, 400, 600)}`);
  const back = await page.eval('window.__wp2.renderer.invert([400, 600])');
  assert.ok(back && Math.abs(((back[0] - under[0] + 540) % 360) - 180) < 1.5 && Math.abs(back[1] - under[1]) < 1.5, `the point under the finger follows it: ${under} -> ${back}`);
  assert.ok(Math.abs((await page.eval('window.__wp2.renderer.getTransform().rot[0]')) + 90) < 1, 'a quarter turn about the pole');
  await page.eval(`window.__wp2.store.set({ view: 'np' })`);
  assert.equal(await page.eval('window.__wp2.renderer.getTransform().k + window.__wp2.renderer.getTransform().rot[0]'), 1, 'changing view resets pan, zoom and spin');
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
}
