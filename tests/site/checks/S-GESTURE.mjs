// S-GESTURE (TEST-5, W3-03): real CDP touch and mouse on the map. Globe drag follows the finger within 1.5 degrees, the
// flick coasts 40-200 px and rests within 600 ms, a drag past a Regional limit overshoots at most 24 px and springs back
// within 300 ms, Hemisphere spins at any zoom, pinch / wheel / double-tap zoom 1x-8x about the pointer, the far side of the
// globe has no pixel, rotation allocates nothing per frame and rests 150 ms after the last input, arrow keys on the focused map
// move the view and never step time, and a visible Reset view appears whenever the view is not the default.
import { mount, shoot, decodePNG, sleep } from '../wp2/shot.mjs';
import { drag, flick, pinch, wheel, click, tap, key } from '../lib/input.mjs';

export const id = 'S-GESTURE';
export const freshProfile = true;
export const timeoutMs = 120000;

const dist = (a, b) => { const r = Math.PI / 180, c = Math.sin(a[1] * r) * Math.sin(b[1] * r) + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.cos((a[0] - b[0]) * r); return (Math.acos(Math.max(-1, Math.min(1, c))) / r); };

export async function run({ page, baseUrl, assert }) {
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 45000 });
  const t = await page.eval('window.__wse.data.getManifest().fields.z500a.steps[1]');
  const W2 = (expr) => page.eval(expr.startsWith('(') ? `(({ renderer, store, data }) => ${expr})(window.__wp2)` : `window.__wp2.${expr}`);
  const open = async (view, w, h, dpr = 1) => {
    await mount(page, { width: w, height: h, dpr });
    await shoot(page, { view, lens: 'z', theme: 'dark', t, lens: 'z' });
    await W2('renderer.resetView(0)');
  };
  // A drag that stays down at its end, so the pointer is still on the map when the map is read.
  const raw = {
    down: (x, y, finger) => finger ? page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0 }] }) : page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }),
    move: (x, y, finger) => finger ? page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 0 }] }) : page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 }),
    up: (x, y, finger) => finger ? page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) : page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }),
  };
  async function hold(a, b, { finger = false, steps = 10, then } = {}) {
    await raw.down(a[0], a[1], finger);
    for (let i = 1; i <= steps; i++) { await raw.move(a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps, finger); await sleep(18); }
    await sleep(120); // the finger rests, so there is no flick on release
    const mid = then ? await then() : null;
    await raw.up(b[0], b[1], finger);
    return mid;
  }

  // ---- 1. Globe: the point under the pointer follows it within 1.5 degrees, mouse and touch, from several starts, zoomed or not ----
  await open('gl', 800, 800);
  assert.equal(await W2('store.get().view'), 'gl');
  for (const finger of [false, true]) {
    for (const [a, b, zoom] of [[[400, 400], [520, 460], 1], [[350, 450], [380, 220], 1], [[450, 380], [300, 520], 1], [[420, 400], [560, 330], 2.5]]) {
      await W2('renderer.resetView(0)');
      if (zoom > 1) await W2(`renderer.centreOn(37.77, -122.42, 0, ${zoom})`);
      await sleep(200);
      const g0 = await W2(`renderer.invert(${JSON.stringify(a)})`);
      assert.ok(g0, `${a} is on the globe`);
      const g1 = await hold(a, b, { finger, then: () => W2(`renderer.invert(${JSON.stringify(b)})`) });
      assert.ok(g1, `${b} is on the globe while dragging`);
      assert.ok(dist(g0, g1) < 1.5, `${finger ? 'touch' : 'mouse'} drag ${a} -> ${b} at ${zoom}x: the grabbed point ${g0.map((v) => v.toFixed(1))} is ${dist(g0, g1).toFixed(2)} deg from the pointer`);
      await sleep(250);
    }
  }
  const rot = await W2('renderer.getTransform().rot');
  assert.ok(rot[0] !== 0 || rot[1] !== 0, 'dragging the globe rotates it (rot stays [0,0,0] before W3-03)');

  // ---- 2. Flick: 1,000 px/s coasts 40-200 px and rests within 600 ms ----
  // The CDP round trip makes a fixed-step flick arrive at 350-620 px/s, so the finger is placed by the wall clock: each move is at
  // x0 + 1000 px/s * elapsed, however long the previous call took. Even so, the page gets moves on frame boundaries (about 16 ms), which
  // moves the speed it sees by up to about 20 %. So a page-side listener records what the page actually received, the release
  // velocity is computed from it the way the page does (the last 110 ms), and a flick is judged only when that speed is 850-1150 px/s;
  // the other attempts are discarded (up to 8), and if none reaches the speed the check fails and says so.
  await page.eval(`(() => { window.__fl = []; const c = window.__wp2.canvas; const rec = (e, up) => window.__fl.push([performance.now(), e.clientX, up]);
    c.addEventListener('pointermove', (e) => rec(e, 0)); c.addEventListener('pointerup', (e) => rec(e, 1));
    // when the globe last moved, on the page's own clock every frame, so the rest time has no CDP latency in it
    let prev = window.__wp2.renderer.getTransform().rot; window.__lastChange = 0;
    const tick = () => { const r = window.__wp2.renderer.getTransform().rot; if (Math.hypot(r[0] - prev[0], r[1] - prev[1]) > 0.002) window.__lastChange = performance.now(); prev = r; requestAnimationFrame(tick); };
    requestAnimationFrame(tick); })()`);
  const V = 1000, DUR = 150, f0 = [300, 400];
  let g0, fx, seen = 0, up, rec, seenLog = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    await W2('renderer.resetView(0)'); await sleep(250);
    g0 = await W2(`renderer.invert(${JSON.stringify(f0)})`);
    await page.eval('window.__fl = []');
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: f0[0], y: f0[1], id: 0 }] });
    const tf = Date.now(); fx = f0[0];
    while (Date.now() - tf < DUR) { fx = f0[0] + (V * (Date.now() - tf)) / 1000; await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fx, y: f0[1], id: 0 }] }); await sleep(4); }
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const fl = await page.eval('window.__fl'); up = fl.find((m) => m[2]);
    assert.ok(up, 'the page saw the finger lift');
    rec = fl.filter((m) => !m[2] && up[0] - m[0] <= 110);
    seen = rec.length >= 3 ? (rec[rec.length - 1][1] - rec[0][1]) / ((rec[rec.length - 1][0] - rec[0][0]) / 1000) : 0;
    seenLog.push(seen.toFixed(0));
    if (seen >= 850 && seen <= 1150 && up[0] - rec[rec.length - 1][0] <= 60) break;
    seen = 0;
  }
  assert.ok(seen >= 850 && seen <= 1150, `no attempt reached the page at 850-1150 px/s (saw ${seenLog.join(', ')}): the test input, not the map, is wrong`);
  await sleep(1100);
  const lastMove = Math.round(await page.eval('window.__lastChange') - up[0]);
  const at = await W2(`renderer.project(${JSON.stringify(g0)})`);
  const arc = at[0] - fx;
  assert.ok(Math.abs(at[1] - f0[1]) < 40, 'a horizontal flick stays roughly horizontal');
  assert.ok(arc >= 40 && arc <= 200, `the flick coasted ${arc.toFixed(0)} px after release, want 40-200`);
  assert.ok(lastMove <= 600, `the globe was still moving ${lastMove} ms after release, want at rest within 600`);

  // ---- 3. Hemisphere spins at any zoom ----
  await open('nh', 800, 800);
  for (const k of [1, 2.6]) {
    await W2('renderer.resetView(0)'); await sleep(150);
    if (k > 1) { await wheel(page, { x: 400, y: 400 }, { dy: -600 }); await sleep(350); }
    const k0 = await W2('renderer.getTransform()');
    assert.ok(k === 1 ? k0.k === 1 : k0.k > 2, `zoom ${k0.k}`);
    const r1 = await hold([300, 380], [420, 380], { then: () => W2('renderer.getTransform().rot') });
    assert.ok(Math.abs(r1[0] - k0.rot[0]) > 1, `Hemisphere at ${k0.k.toFixed(1)}x: a 120 px horizontal drag spun it ${(r1[0] - k0.rot[0]).toFixed(2)} deg`);
    await sleep(250);
  }

  // ---- 4. Regional: pan to the data edge, overshoot at most 24 px, spring back within 300 ms ----
  await open('np', 1000, 600);
  const tx0 = await W2('renderer.getTransform().tx');
  const held = await hold([500, 300], [900, 300], { then: () => W2('renderer.getTransform()') });
  const tRel = Date.now();
  let back = -1, txs = [];
  while (Date.now() - tRel < 700) {
    const x = await W2('renderer.getTransform().tx'); txs.push([Date.now() - tRel, x]);
    await sleep(15);
  }
  const rest = txs[txs.length - 1][1];
  assert.ok(rest > tx0 + 4, `Regional pans at zoom 1 up to the data edge: tx ${tx0} -> ${rest.toFixed(1)}`);
  assert.ok(held.tx - rest > 0.5, `a drag past the limit moves the map (${(held.tx - rest).toFixed(1)} px beyond the limit), never nothing`);
  assert.ok(held.tx - rest <= 24, `overshoot ${(held.tx - rest).toFixed(1)} px, want at most 24`);
  back = txs.find(([, x]) => Math.abs(x - rest) < 0.5);
  assert.ok(back && back[0] <= 300, `back within 300 ms of release, took ${back ? back[0] : 'never'} ms`);
  const edge = await W2(`(() => { let m = 1e9; for (let lat = 10; lat <= 75; lat += 1) { const q = renderer.project([${150}, lat]); if (q) m = Math.min(m, q[0]); } return m; })()`);
  assert.ok(Math.abs(edge) < 2, `at the limit the data's west edge is on the frame edge: x = ${edge.toFixed(1)}`);
  // and a small drag inside the slack follows the finger exactly
  await W2('renderer.resetView(0)'); await sleep(150);
  const small = await hold([500, 300], [506, 300], { then: () => W2('renderer.getTransform().tx') }); // 6 px: starts a drag, not a tap
  assert.ok(Math.abs(small - 6) < 1.5 || small > 0, `a small drag moves the map: ${small}`);

  // ---- 5. Zoom 1x-8x about the pointer: wheel, pinch, double-tap ----
  await open('np', 1000, 600);
  const under0 = await W2('renderer.invert([700, 200])');
  await wheel(page, { x: 700, y: 200 }, { dy: -500 });
  await sleep(350);
  const k1 = await W2('renderer.getTransform().k');
  assert.ok(k1 > 1.8 && k1 < 2.6, `one wheel notch zooms in: k ${k1}`);
  assert.ok(dist(under0, await W2('renderer.invert([700, 200])')) < 0.3, 'the wheel zooms about the pointer');
  for (let i = 0; i < 6; i++) { await wheel(page, { x: 700, y: 200 }, { dy: -1500 }); await sleep(60); }
  await sleep(350);
  assert.equal(await W2('renderer.getTransform().k'), 8, 'wheel zoom stops at 8x');
  for (let i = 0; i < 6; i++) { await wheel(page, { x: 700, y: 200 }, { dy: 3000 }); await sleep(60); }
  await sleep(350);
  assert.equal(await W2('renderer.getTransform().k'), 1, 'wheel zoom stops at 1x');
  await pinch(page, { x: 500, y: 300 }, { from: 80, to: 240 });
  await sleep(350);
  const kp = await W2('renderer.getTransform().k');
  assert.ok(kp > 2.5 && kp < 3.5, `a pinch from 80 to 240 px apart zooms about 3x: ${kp}`);
  await W2('renderer.resetView(0)'); await sleep(150);
  await pinch(page, { x: 500, y: 300 }, { from: 40, to: 760, steps: 14 });
  await sleep(350);
  assert.equal(await W2('renderer.getTransform().k'), 8, 'pinch zoom stops at 8x');
  await W2('renderer.resetView(0)'); await sleep(150);
  const dt0 = await W2('renderer.invert([300, 200])');
  await tap(page, { x: 300, y: 200 }); await tap(page, { x: 300, y: 200 });
  await sleep(500);
  const kd = await W2('renderer.getTransform().k');
  assert.ok(Math.abs(kd - 2) < 0.1, `a double tap zooms 2x: ${kd}`);
  assert.ok(dist(dt0, await W2('renderer.invert([300, 200])')) < 0.5, 'double-tap zooms about the tap');

  // ---- 6. The far side has no pixel: a pin behind the globe draws nothing ----
  await open('gl', 800, 800);
  const probe = await W2(`(() => { const r = renderer, c = r.invert([400, 400]); window.__far = [c[0] + 180, -c[1]]; window.__near = c;
    r.addOverlay((ctx, proj) => { const f = proj(window.__far), n = proj(window.__near);
      if (f) { ctx.fillStyle = '#ff00ff'; ctx.fillRect(Math.round(f[0]) - 4, Math.round(f[1]) - 4, 9, 9); }
      if (n) { ctx.fillStyle = '#00ff00'; ctx.fillRect(Math.round(n[0]) - 4, Math.round(n[1]) - 4, 9, 9); } });
    r.draw(); return { far: r.project(window.__far), near: r.project(window.__near), invCorner: r.invert([3, 3]), invEdge: r.invert([799, 400]) }; })()`);
  assert.equal(probe.far, null, 'project of the antipode of the view centre is null');
  assert.equal(probe.invCorner, null, 'invert off the disc is null');
  assert.equal(probe.invEdge, null, 'invert off the disc is null at the edge');
  assert.ok(probe.near, 'the view centre projects');
  const img = decodePNG(await page.screenshot());
  let magenta = 0, green = 0;
  for (let i = 0; i < img.w * img.h; i++) { const o = i * img.ch, r = img.px[o], g = img.px[o + 1], b = img.px[o + 2]; if (r === 255 && g === 0 && b === 255) magenta++; else if (r === 0 && g === 255 && b === 0) green++; }
  assert.equal(magenta, 0, 'a pin behind the globe yields no pin pixel');
  assert.ok(green >= 81, `the pin at the view centre is drawn (${green} px)`);

  // ---- 7. Rotation redraws every frame at rotate quality, allocates no typed arrays, and rests 150 ms after the last input ----
  await W2('renderer.resetView(0)'); await sleep(250);
  await hold([300, 400], [330, 410], { steps: 4 }); // the first rotate frame fills the scratch pool: warm it, then count
  await sleep(700); await W2('renderer.resetView(0)'); await sleep(300);
  await page.eval(`(() => { window.__made = 0; window.__where = []; for (const n of ['Float32Array', 'Int32Array', 'Uint8Array', 'Uint32Array', 'Uint8ClampedArray', 'Int16Array']) {
    const real = globalThis[n]; globalThis[n] = new Proxy(real, { construct(t, a, nt) { window.__made++; if (window.__where.length < 4) window.__where.push(n + ' ' + new Error().stack.split('\\n').slice(2, 5).join(' < ')); return Reflect.construct(t, a, nt); } }); } })()`);
  const c0 = await W2('renderer.stats()');
  await raw.down(300, 400, false);
  for (let i = 1; i <= 24; i++) { await raw.move(300 + i * 6, 400 + i * 2, false); await sleep(17); }
  const mid = await W2('renderer.stats()');
  const midMade = await page.eval('window.__made');
  assert.equal(mid.quality, 'rotate', 'while rotating, frames are composed at rotate quality');
  assert.ok(mid.composes - c0.composes >= 12, `the globe redraws as it rotates: ${mid.composes - c0.composes} composes over 24 moves`);
  await sleep(120);
  await page.eval(`(() => { window.__upAt = -1; window.addEventListener('pointerup', () => { window.__upAt = performance.now(); }, { capture: true, once: true }); })()`);
  await raw.up(444, 448, false);
  const tUp = Date.now();
  while (Date.now() - tUp < 1500 && (await W2('renderer.stats()')).quality !== 'rest') await sleep(10);
  const fin = await W2('renderer.stats()');
  const upAt = await page.eval('window.__upAt');
  assert.equal(fin.quality, 'rest', 'rest quality returned after the drag was released');
  assert.ok(upAt > 0, 'the page saw the pointer release');
  // The rest commit STARTS 150 ms after the last input (the timer), whatever the compose then costs (26 ms warm, 150 ms cold).
  const startedAfter = fin.restStartedAt - upAt;
  assert.ok(startedAfter >= 148 && startedAfter <= 185, `rest commit started ${startedAfter.toFixed(1)} ms after the pointer release, want about 150`);
  assert.ok(Math.abs(fin.lastInputAt - upAt) <= 15, `the renderer's last input is the release (${(fin.lastInputAt - upAt).toFixed(1)} ms apart)`);
  const made = await page.eval('window.__made');
  assert.equal(midMade, 0, `${midMade} typed arrays were constructed while rotating: ${await page.eval('window.__where.join(" || ")')}`);
  assert.ok(Number.isFinite(mid.frameMs) && mid.frameMs > 0, `stats().frameMs ${mid.frameMs}`);
  void made;

  // ---- 8. Contract: lens/ground/overlays/range redraw within one frame, sampleAt, map:tap, map:viewchange, renderTo with xf ----
  await W2('renderer.resetView(0)'); await sleep(250);
  for (const patch of [{ lens: 's' }, { ground: 'night' }, { overlays: { jetline: true } }, { range: 10 }, { lens: 'z', ground: 'paper', range: 7 }]) {
    const r = await page.eval(`(async () => { const w = window.__wp2, n0 = w.renderer.stats().composes; w.store.set(${JSON.stringify(patch)});
      await new Promise((r) => requestAnimationFrame(r)); return w.renderer.stats().composes - n0; })()`);
    assert.ok(r >= 1, `setting ${JSON.stringify(patch)} redraws within one frame (composes +${r})`);
  }
  const ev = await page.eval(`(async () => { const { bus } = await import('/js/state.js'); window.__ev = { tap: [], view: [] };
    bus.on('map:tap', (d) => window.__ev.tap.push(d)); bus.on('map:viewchange', (d) => window.__ev.view.push(d)); return true; })()`);
  await click(page, { x: 400, y: 400 });
  await sleep(300);
  const tapEv = await page.eval('window.__ev.tap');
  assert.equal(tapEv.length, 1, 'a click emits one map:tap');
  const there = await W2('renderer.invert([400, 400])');
  assert.ok(Math.abs(tapEv[0].x - 400) < 1.5 && dist([tapEv[0].lon, tapEv[0].lat], there) < 0.2, `map:tap {x, y, lon, lat}: ${JSON.stringify(tapEv[0])}`);
  assert.equal((await W2('renderer.getTransform().k')), 1, 'a tap does not move the map');
  await drag(page, { x: 300, y: 400 }, { by: { dx: 80, dy: 0 }, steps: 8, ms: 240 });
  await sleep(900);
  const vc = await page.eval('window.__ev.view');
  assert.ok(vc.length >= 2 && vc.some((v) => !v.isDefault) && vc[vc.length - 1].rot.length === 3, `map:viewchange fired ${vc.length} times with {view, k, rot, isDefault}`);
  const s = await W2('renderer.sampleAt(-122.42, 37.77)');
  assert.ok(typeof s.t === 'number' && s.values && typeof s.values === 'object' && (s.signal === 'clear' || s.signal === 'none'), 'sampleAt shape ' + JSON.stringify(s));
  assert.ok(Number.isFinite(s.values.z500a), 'sampleAt(SF) has the pattern anomaly: ' + JSON.stringify(s.values));
  assert.deepEqual((await W2('renderer.sampleAt(-122.42, 37.77).t')), await W2('store.get().t'));
  const sx = await W2(`(() => { const r = renderer, c2 = document.createElement('canvas'); c2.width = 400; c2.height = 400; const x = c2.getContext('2d');
    const plain = r.renderTo(x, { width: 400, height: 400, view: 'gl', xf: { k: 1, tx: 0, ty: 0, rot: [0, 0, 0] } });
    const turned = r.renderTo(x, { width: 400, height: 400, view: 'gl', xf: { k: 1, tx: 0, ty: 0, rot: [50, 10, 0] } });
    return { a: plain.project([-122.42, 37.77]), b: turned.project([-122.42, 37.77]) }; })()`);
  assert.ok(sx.a && sx.b && Math.hypot(sx.a[0] - sx.b[0], sx.a[1] - sx.b[1]) > 20, 'renderTo with xf keeps the rotation: ' + JSON.stringify(sx));

  // ---- 9. Resize: the backing size follows the client size x min(DPR, 2) ----
  await open('np', 600, 400, 3);
  await page.eval(`(() => { const c = window.__wp2.canvas; c.style.width = '500px'; c.style.height = '300px'; })()`);
  await sleep(300);
  assert.deepEqual(await page.eval('(() => { const c = window.__wp2.canvas; return [c.width, c.height, c.clientWidth, c.clientHeight]; })()'), [1000, 600, 500, 300], 'backing = client x min(DPR 3, 2) after a resize');
  await page.eval(`(() => { const c = window.__wp2.canvas; c.style.width = '320px'; c.style.height = '480px'; })()`);
  await sleep(300);
  assert.deepEqual(await page.eval('(() => { const c = window.__wp2.canvas; return [c.width, c.height]; })()'), [640, 960], 'and again');

  // ---- 10. The real app: arrows on the focused map move the view and never step time; Reset view appears and works ----
  await page.setViewport(1000, 700, 1);
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 45000 });
  await page.eval(`(async () => { (await import(new URL('js/time/clock.js', document.baseURI).href)).pause(); __wse.store.set({ view: 'gl', playing: false }); })()`);
  await sleep(400);
  assert.equal(await page.eval(`(() => { const b = document.getElementById('btn-reset'); return !b || b.hidden || !b.offsetWidth; })()`), true, 'no Reset view at the default view');
  await click(page, '#map');
  await sleep(200);
  assert.equal(await page.eval('document.activeElement && document.activeElement.id'), 'map', 'the map takes focus');
  const t0 = await page.eval('__wse.store.get().t'), r0 = await page.eval('__wse.renderer.getTransform().rot');
  await key(page, null, 'ArrowRight');
  await sleep(500);
  assert.equal(await page.eval('__wse.store.get().t'), t0, 'ArrowRight on the focused map leaves t unchanged');
  const r1 = await page.eval('__wse.renderer.getTransform().rot');
  assert.ok(Math.abs(r1[0] - r0[0]) > 4 && Math.abs(r1[0] - r0[0]) < 6, `ArrowRight rotates the globe 5 degrees: ${r0[0]} -> ${r1[0]}`);
  await key(page, null, 'ArrowUp'); await sleep(400);
  assert.ok(Math.abs((await page.eval('__wse.renderer.getTransform().rot[1]')) - r1[1]) > 4, 'ArrowUp tilts the globe');
  const reset = await page.eval(`(() => { const b = document.getElementById('btn-reset'); if (!b) return null; const r = b.getBoundingClientRect(); return { hidden: b.hidden, w: r.width, h: r.height, text: b.textContent.trim() }; })()`);
  assert.ok(reset && !reset.hidden && reset.w >= 44 && reset.h >= 44 && /reset view/i.test(reset.text), 'a visible Reset view button when the view is not the default: ' + JSON.stringify(reset));
  await click(page, '#btn-reset');
  await sleep(900);
  const done = await page.eval('__wse.renderer.getTransform()');
  assert.ok(done.k === 1 && Math.abs(done.rot[0]) < 0.1 && Math.abs(done.rot[1]) < 0.1, 'Reset view returns the default view: ' + JSON.stringify(done));
  assert.equal(await page.eval(`(() => { const b = document.getElementById('btn-reset'); return !b || b.hidden; })()`), true, 'and hides itself');
  await click(page, '#map'); await sleep(150);
  await key(page, null, '0'); await key(page, null, '=');
  await sleep(500);
  assert.ok((await page.eval('__wse.renderer.getTransform().k')) > 1.2, '+ zooms in');
  await key(page, null, '0'); await sleep(600);
  assert.equal(await page.eval('__wse.renderer.getTransform().k'), 1, '0 resets');
  assert.equal(await page.eval('__wse.store.get().t'), t0, 'no key on the map stepped time');

  // ---- 11. setTransform (C1-02): after setTransform(getTransform()) the transform is unchanged, instantly and over a glide ----
  // The Briefing puts the person's map back with this on exit, so a drift in animateTo or clampX would move their view. Run in the
  // real app on desktop and phone, from a zoomed, panned, turned transform on each view, with ms 0 and ms 300 (awaited on the page).
  for (const [w, h] of [[1000, 700], [390, 844]]) {
    await page.setViewport(w, h, 1);
    await sleep(300);
    for (const view of ['np', 'nh', 'gl']) {
      const res = await page.eval(`(async () => { const r = __wse.renderer; __wse.store.set({ view: '${view}' });
        await new Promise((f) => requestAnimationFrame(f)); await r.resetView(0); await r.centreOn(40.7, -100, 0, 2.5);
        const x0 = r.getTransform(); await r.setTransform(x0, 0); const x1 = r.getTransform();
        await r.setTransform(x1, 300); const x2 = r.getTransform(); return { x0, x1, x2 }; })()`);
      assert.ok(res.x0.k > 2 && (res.x0.tx !== 0 || res.x0.ty !== 0 || res.x0.rot.some((v) => v !== 0)), `${view} ${w}x${h}: a non-default start ${JSON.stringify(res.x0)}`);
      assert.deepEqual(res.x1, res.x0, `${view} ${w}x${h}: setTransform(getTransform(), 0) leaves the transform unchanged`);
      assert.deepEqual(res.x2, res.x0, `${view} ${w}x${h}: setTransform(getTransform(), 300) lands on the same transform`);
    }
  }
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
}
