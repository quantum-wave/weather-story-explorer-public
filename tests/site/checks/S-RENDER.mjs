// S-RENDER: the layers, themes, cases and renderTo draw real, plausible pixels (screenshots and canvas read-back).
import { mount, shoot, stats, meanChroma, purpleShare } from '../wp2/shot.mjs';

export const id = 'S-RENDER';
export const freshProfile = false;
export const timeoutMs = 120000;
const DARK = [12, 16, 20], LIGHT = [249, 246, 242];
const OFF = { z: true, j: false, c: false, t: false };

export async function run({ page, baseUrl, assert }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 45000 });
  const m = await page.eval('window.__wse.data.getManifest()');
  const stepOf = (f) => m.fields[f].steps[Math.min(1, m.fields[f].steps.length - 1)];
  const W = 1000, H = 600, top = [0, 0, W, 360];
  await mount(page, { width: W, height: H });

  // light theme: same field, pale palette on the light ground
  let img = await shoot(page, { view: 'np', layers: OFF, case: 'A', theme: 'light', t: stepOf('z500a') }, 'render-light');
  let s = stats(img, top, LIGHT);
  assert.ok(s.tinted > 0.04 && s.std > 6, `light theme: tint ${(s.tinted * 100).toFixed(1)}%, spread ${s.std.toFixed(1)}`);
  const corner = [img.px[0], img.px[1], img.px[2]];
  assert.ok(corner[0] > 225 && corner[1] > 225, `light theme ground is light: ${corner}`);

  // one case at a time: case B (or C) has no 500 hPa field, so the anomaly layer draws nothing there
  const other = Object.keys(m.cases || {}).find((c) => c !== 'A' && !m.cases[c].fields.includes('z500a'));
  if (m.sample && other) {
    img = await shoot(page, { view: 'np', layers: OFF, case: other, theme: 'dark', t: 6 });
    s = stats(img, top, DARK);
    assert.ok(s.tinted < 0.005, `case ${other} with only the anomaly layer on shows no anomaly shading: ${(s.tinted * 100).toFixed(2)}%`);
  }

  // jet layer (case B in the sample, case A in the synthetic fixture)
  const jetCase = m.fields.ws250.case || 'A';
  img = await shoot(page, { view: 'np', layers: { z: jetCase === 'A', j: true, c: false, t: false }, case: jetCase, theme: 'dark', t: stepOf('ws250') }, 'render-jet');
  const purple = purpleShare(img, top);
  assert.ok(purple > 0.003, `jet draws a purple ramp: ${(purple * 100).toFixed(2)}% of pixels`);

  // surface temperature motion demo
  if (m.fields.t2a) {
    const c = m.fields.t2a.case || 'C';
    img = await shoot(page, { view: 'np', layers: { z: false, j: false, c: false, t: true }, case: c, theme: 'dark', t: 24 }, 'render-t2a');
    s = stats(img, top, DARK);
    assert.ok(s.tinted > 0.03, `t2a anomaly tint ${(s.tinted * 100).toFixed(1)}%`);
  }

  // confidence fade: where spread is large (synthetic fixture), late-lead colours are less saturated than early ones
  const sp = await page.eval('window.__wp2.data.sampleDomainSpread() && Array.from(window.__wp2.data.sampleDomainSpread().values)');
  if (sp && Math.max(...sp) / 10 > 4 && sp[0] / 10 < 3) {
    const steps = m.fields.z500a.steps, early = steps[0], late = steps[steps.length - 1];
    await page.eval('window.__wp2.data.ensureAll("z500sd", "np05")');
    const a = await shoot(page, { view: 'np', layers: OFF, case: 'A', theme: 'dark', t: early });
    const b = await shoot(page, { view: 'np', layers: OFF, case: 'A', theme: 'dark', t: late });
    const ca = meanChroma(a, top), cb = meanChroma(b, top);
    assert.ok(cb < ca * 0.92, `colour fades with spread: chroma ${ca.toFixed(1)} -> ${cb.toFixed(1)}`);
  }

  // renderTo: an export-sized frame into a plain canvas, with a fillText spy and an overlay
  const out = await page.eval(`(async () => {
    const w = window.__wp2; await w.renderer.ensureFor({ t: ${stepOf('z500a')}, layers: { z: true }, case: 'A' });
    const cv = document.createElement('canvas'); cv.width = 540; cv.height = 675;
    const c = cv.getContext('2d'), texts = [];
    const ft = c.fillText.bind(c); c.fillText = (t, ...r) => { texts.push(String(t)); return ft(t, ...r); };
    let overlayCalls = 0;
    const r = w.renderer.renderTo(c, { width: 540, height: 675, t: ${stepOf('z500a')}, view: 'np', layers: { z: true, j: false }, case: 'A', theme: 'dark',
      centre: { lat: 37.77, lon: -122.42, zoom: 2 }, overlays: [(ctx, project, st) => { overlayCalls++; const q = project([-122.42, 37.77]); ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(q[0], q[1], 12, 0, 7); ctx.stroke(); }] });
    const d = c.getImageData(0, 0, 540, 675).data; let tinted = 0, drawn = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 0) drawn++; const r1 = d[i], b1 = d[i + 2]; if (Math.abs(r1 - b1) > 22) tinted++; }
    return { texts, overlayCalls, sf: r.project([-122.42, 37.77]), back: r.invert([270, 337]), tinted: tinted / (540 * 675), drawn: drawn / (540 * 675) };
  })()`);
  assert.equal(out.overlayCalls, 1);
  assert.ok(out.drawn > 0.99, 'renderTo paints every pixel');
  assert.ok(out.tinted > 0.05, `renderTo shows the anomaly field: ${(out.tinted * 100).toFixed(1)}%`);
  assert.ok(Math.abs(out.sf[0] - 270) < 1 && Math.abs(out.sf[1] - 337.5) < 1, `centre puts SF mid-frame: ${out.sf}`);
  assert.ok(out.texts.some((t) => /^\d{3}$/.test(t)), `contour labels are drawn text: ${out.texts.slice(0, 5)}`);
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
}
