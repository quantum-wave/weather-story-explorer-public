// S-PROJ: each view draws a canvas with non-trivial pixel variance and no edge frame, from a real screenshot.
import { mount, shoot, stats, edgeRingDiff } from '../wp2/shot.mjs';

export const id = 'S-PROJ';
export const freshProfile = false;
export const timeoutMs = 90000;
const OCEAN = [12, 16, 20];

export async function run({ page, baseUrl, assert }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 45000 });
  const t = await page.eval('window.__wse.data.getManifest().fields.z500a.steps[1]');
  for (const [view, w, h, dpr] of [['np', 1000, 600, 1], ['nh', 800, 800, 1], ['gl', 1100, 620, 1], ['wm', 1100, 620, 1], ['np', 390, 844, 2], ['np', 1000, 1300, 1]]) {
    await mount(page, { width: w, height: h, dpr });
    const img = await shoot(page, { view, lens: 'z', theme: 'dark', t }, `proj-${view}-${w}x${h}`);
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
      for (const [k, ll] of Object.entries({ sf: [-122.42, 37.77], ny: [-74, 40.7], hon: [-157.86, 21.3], anc: [-149.9, 61.2] })) { const p = r.project(ll); out[k] = p && { p, back: r.invert(p) }; }
      return out; })()`);
    for (const [k, v] of Object.entries(probe)) {
      if (!v) { assert.ok(k !== 'sf', `${label}: San Francisco is not projectable`); continue; }
      assert.ok(v.back && Math.abs(v.back[0] - { sf: -122.42, ny: -74, hon: -157.86, anc: -149.9 }[k]) < 0.05, `${label}: invert(project(${k})) = ${v.back}`);
    }
    const sf = probe.sf.p;
    assert.ok(sf[0] > 0 && sf[0] < w && sf[1] > 0 && sf[1] < h, `${label}: San Francisco on screen at ${sf}`);
    if (view === 'np' && w < h) {
      // Regional framing (spec 4.6): SF between 0.5 W and 0.75 W; Anchorage off-canvas or in the top 15 %; Honolulu off-canvas or in the bottom 15 %
      assert.ok(sf[0] >= 0.5 * w && sf[0] <= 0.75 * w, `${label}: SF ${(sf[0] / w).toFixed(2)} across, want 0.50-0.75`);
      const an = probe.anc.p, ho = probe.hon.p;
      assert.ok(an[1] < 0.15 * h || an[0] < 0 || an[0] > w, `${label}: Anchorage at y ${(an[1] / h).toFixed(2)} H, x ${(an[0] / w).toFixed(2)} W`);
      assert.ok(ho[1] > 0.85 * h || ho[0] < 0 || ho[0] > w, `${label}: Honolulu at y ${(ho[1] / h).toFixed(2)} H, x ${(ho[0] / w).toFixed(2)} W`);
    }
    if (view === 'gl') { // the globe: the far side of the Earth has no pixel and no longitude
      const far = await page.eval(`(() => { const r = window.__wp2.renderer, c = r.invert([${w / 2}, ${h / 2}]); return { c, anti: r.project([c[0] + 180, -c[1]]), corner: r.invert([1, 1]) }; })()`);
      assert.equal(far.anti, null, `${label}: the antipode of the view centre ${far.c} has no pixel`);
      assert.equal(far.corner, null, `${label}: a corner is off the disc`);
    }
    if (view === 'wm') { // World: the flat Equal Earth map shows the whole world at once, so no point is on a far side
      const all = await page.eval(`(() => { const r = window.__wp2.renderer, c = r.invert([${w / 2}, ${h / 2}]); return { c, anti: r.project([c[0] + 180, -c[1]]), dl: r.project([180, 0]), east: r.project([-179.9, 60]), west: r.project([179.9, 60]), s: r.project([0, -80]) }; })()`);
      assert.ok(all.anti, `${label}: the antipode of the view centre ${all.c} projects on a flat map`);
      for (const k of ['dl', 'east', 'west', 's']) assert.ok(all[k] && all[k][0] > 0 && all[k][0] < w && all[k][1] > 0 && all[k][1] < h, `${label}: ${k} on screen: ${all[k]}`);
      assert.ok(Math.abs(sf[0] - w / 2) < w / 2 && all.dl[0] < sf[0] + w, `${label}: SF and the date line both on screen`);
    }
    if (view === 'nh') assert.ok(sf[1] > h / 2 && Math.abs(sf[0] - w / 2) < 2, `nh: SF's meridian points down, SF at ${sf}`);
  }
  // pan and zoom: wheel zooms about the pointer, reset returns, nh drag spins
  await mount(page, { width: 1000, height: 600 });
  await shoot(page, { view: 'np', lens: 'z', t });
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
  const t0 = await page.eval('window.__wp2.renderer.getTransform()'), g0 = await page.eval('window.__wp2.renderer.invert([500, 300])');
  await page.eval(`${ptr('pointerdown', 1, 500, 300)}; ${ptr('pointermove', 1, 440, 270)}; ${ptr('pointermove', 1, 400, 250)}; ${ptr('pointerup', 1, 400, 250)}`);
  const t1 = await page.eval('window.__wp2.renderer.getTransform()'), at1 = await page.eval(`window.__wp2.renderer.project(${JSON.stringify(g0)})`);
  // Regional: the horizontal part turns the central meridian, the vertical part pans; the grabbed point stays under the finger
  assert.ok(at1 && Math.abs(at1[0] - 400) < 1.5 && Math.abs(at1[1] - 250) < 1.5, `drag moves the grabbed point with the finger: ${g0} at ${at1}`);
  assert.ok(t1.rot[0] < t0.rot[0] - 0.5 && t1.tx === t0.tx && t1.ty < t0.ty - 30, `a left drag turns the meridian (no sideways pan) and an upward drag pans up: ${JSON.stringify(t0)} -> ${JSON.stringify(t1)}`);
  await page.eval('window.__wp2.renderer.resetView(0)');
  await page.eval(`${ptr('pointerdown', 1, 450, 300)}; ${ptr('pointerdown', 2, 550, 300)}; ${ptr('pointermove', 1, 350, 300)}; ${ptr('pointermove', 2, 650, 300)}; ${ptr('pointerup', 1, 350, 300)}; ${ptr('pointerup', 2, 650, 300)}`);
  const k2 = await page.eval('window.__wp2.renderer.getTransform().k');
  assert.ok(Math.abs(k2 - 3) < 0.05, `pinch from 100 to 300 px apart zooms 3x: ${k2}`);
  await page.eval('window.__wp2.renderer.resetView(0)');
  await mount(page, { width: 800, height: 800 });
  await shoot(page, { view: 'nh', lens: 'z', t });
  const under = await page.eval('window.__wp2.renderer.invert([600, 400])');
  await page.eval(`${ptr('pointerdown', 1, 600, 400)}; ${ptr('pointermove', 1, 565, 565)}; ${ptr('pointermove', 1, 400, 600)}; ${ptr('pointerup', 1, 400, 600)}`);
  const back = await page.eval('window.__wp2.renderer.invert([400, 600])');
  assert.ok(back && Math.abs(((back[0] - under[0] + 540) % 360) - 180) < 1.5 && Math.abs(back[1] - under[1]) < 1.5, `the point under the finger follows it: ${under} -> ${back}`);
  assert.ok(Math.abs((await page.eval('window.__wp2.renderer.getTransform().rot[0]')) + 90) < 1, 'a quarter turn about the pole');
  // World (W4-10): the wheel zooms about the pointer, a vertical drag pans and stops at the map's outline (no blank band), a horizontal
  // drag turns the central meridian (it never tilts)
  const blank = (w, h) => page.eval(`(() => { const r = window.__wp2.renderer; let n = 0, off = 0; const m = ${Math.round(Math.min(w, h) * 0.01) + 1};
    for (let y = m; y <= ${h} - m; y += 12) for (let x = m; x <= ${w} - m; x += 12) { n++; if (!r.invert([x, y])) off++; } return off / n; })()`);
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    await mount(page, { width: w, height: h });
    await shoot(page, { view: 'wm', lens: 'z', t });
    const cx = Math.round(w * 0.4), cy = Math.round(h / 2);
    const wUnder = await page.eval(`window.__wp2.renderer.invert([${cx}, ${cy}])`);
    await page.eval(`(() => { window.__wp2.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -700, clientX: ${cx}, clientY: ${cy}, bubbles: true, cancelable: true })); })()`);
    await new Promise((r) => setTimeout(r, 400));
    const wz = await page.eval('window.__wp2.renderer.getTransform()');
    assert.ok(wz.k > 2 && wz.k <= 8, `World ${w}x${h} zooms: k=${wz.k}`);
    const wBack = await page.eval(`window.__wp2.renderer.invert([${cx}, ${cy}])`);
    assert.ok(wUnder && wBack && Math.abs(wBack[0] - wUnder[0]) < 0.8 && Math.abs(wBack[1] - wUnder[1]) < 0.8, `zoom is about the pointer: ${wUnder} -> ${wBack}`);
    // a drag far past the edge in each direction: the free chart stays on the map (the outline is held against the frame)
    const mx = Math.round(w / 2), my = Math.round(h / 2);
    for (const [dx, dy, name] of [[0, 9000, 'down'], [0, -9000, 'up'], [9000, 0, 'right'], [-9000, 0, 'left'], [9000, 9000, 'down-right']]) {
      const tb = await page.eval('window.__wp2.renderer.getTransform()');
      await page.eval(`${ptr('pointerdown', 1, mx, my)}; ${ptr('pointermove', 1, mx + Math.sign(dx) * 30, my + Math.sign(dy) * 30)}; ${ptr('pointermove', 1, mx + dx, my + dy)}; ${ptr('pointerup', 1, mx + dx, my + dy)}`);
      await new Promise((r) => setTimeout(r, 600));
      const f = await blank(w, h), tf = await page.eval('window.__wp2.renderer.getTransform()');
      // the outline's own extent on screen (equator edges, poles) about the central meridian now shown, against the free frame (the canvas less its 1 % margin)
      const c0 = -150 - tf.rot[0];
      const o = await page.eval(`(() => { const r = window.__wp2.renderer, a = r.project([${c0} - 179.99, 0]), b = r.project([${c0} + 179.99, 0]), n = r.project([${c0}, 90]), s = r.project([${c0}, -90]); return { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y0: n[1], y1: s[1] }; })()`);
      const m = Math.round(Math.min(w, h) * 0.01), fw = w - 2 * m, fh = h - 2 * m;
      const covW = Math.min(1, (o.x1 - o.x0) / fw), covH = Math.min(1, (o.y1 - o.y0) / fh);
      const edge = (lo, hi, f0, f1, ax) => (hi - lo >= f1 - f0 - 0.5
        ? assert.ok(lo <= f0 + 1 && hi >= f1 - 1, `World ${w}x${h} dragged ${name}: the map's ${ax} edges ${lo.toFixed(1)}..${hi.toFixed(1)} leave a blank band inside the frame ${f0}..${f1}`)
        : assert.ok(Math.abs((lo + hi) / 2 - (f0 + f1) / 2) <= 1.5, `World ${w}x${h} dragged ${name}: the map is smaller than the frame on ${ax} and should sit centred: ${lo.toFixed(1)}..${hi.toFixed(1)} in ${f0}..${f1}`));
      edge(o.x0, o.x1, m, w - m, 'x'); edge(o.y0, o.y1, m, h - m, 'y');
      assert.ok(f <= 1 - 0.6 * covW * covH, `World ${w}x${h} dragged ${name} at k=${tf.k.toFixed(2)}: ${(f * 100).toFixed(1)}% of the free chart is off the map, more than the zoom forces (${((1 - 0.6 * covW * covH) * 100).toFixed(0)}%)`);
      assert.equal(tf.rot[1], 0, 'World never tilts');
      if (dx) assert.ok(Math.abs(((tf.rot[0] - tb.rot[0] + 540) % 360) - 180) > 1, `World ${w}x${h} dragged ${name}: a horizontal drag turns the central meridian (${tb.rot[0]} -> ${tf.rot[0]})`);
      else assert.equal(tf.rot[0], tb.rot[0], `World ${w}x${h} dragged ${name}: a vertical drag does not turn the map`);
    }
  }
  await page.eval(`window.__wp2.store.set({ view: 'np' })`);
  assert.equal(await page.eval('window.__wp2.renderer.getTransform().k + window.__wp2.renderer.getTransform().rot[0]'), 1, 'changing view resets pan, zoom and spin');
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
}
