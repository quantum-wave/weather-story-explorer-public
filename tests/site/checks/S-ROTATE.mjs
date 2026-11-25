// S-ROTATE (N24): every view turns so any area can be centred. World: a horizontal drag turns the central meridian at any zoom (the
// grabbed place stays under the pointer), a flick coasts and rests, vertical drags pan when zoomed. Hemisphere: a drag spins and
// tilts the centre off the pole (place under the pointer), never past 30N. Regional: a horizontal drag turns the conic within its
// data. Center here (the pinned reading's action) puts the place mid-map in each view; Reset view and 0 bring the default back.
// Overlays drawn through the shared projection follow a turn; a turn redraws at rotate quality without allocating typed arrays.
import { mount, shoot, decodePNG, sleep } from '../wp2/shot.mjs';
import { wheel, click, key } from '../lib/input.mjs';

export const id = 'S-ROTATE';
export const freshProfile = true;
export const timeoutMs = 120000;

const dist = (a, b) => { const r = Math.PI / 180, c = Math.sin(a[1] * r) * Math.sin(b[1] * r) + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.cos((a[0] - b[0]) * r); return Math.acos(Math.max(-1, Math.min(1, c))) / r; };
const lonDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

export async function run({ page, baseUrl, assert }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 45000 });
  const t = await page.eval('window.__wse.data.getManifest().fields.z500a.steps[1]');
  const W2 = (expr) => page.eval(`window.__wp2.${expr}`);
  const open = async (view, w, h) => { await mount(page, { width: w, height: h }); await shoot(page, { view, lens: 'z', theme: 'dark', t }); await W2('renderer.resetView(0)'); };
  const raw = {
    down: (x, y) => page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }),
    move: (x, y) => page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 }),
    up: (x, y) => page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }),
  };
  // a drag that rests before release (no flick), reading the map while the button is still down
  async function hold(a, b, { steps = 10, then } = {}) {
    await raw.down(a[0], a[1]);
    for (let i = 1; i <= steps; i++) { await raw.move(a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps); await sleep(18); }
    await sleep(120);
    const mid = then ? await then() : null;
    await raw.up(b[0], b[1]);
    await sleep(250);
    return mid;
  }

  // ---- 1. World: horizontal drags turn the meridian at 1x and zoomed; the grabbed place follows; vertical pans when zoomed ----
  await open('wm', 1100, 620);
  for (const [a, b] of [[[400, 300], [650, 300]], [[700, 250], [380, 250]], [[300, 400], [520, 380]]]) {
    const g = await W2(`renderer.invert(${JSON.stringify(a)})`), r0 = (await W2('renderer.getTransform()')).rot[0];
    assert.ok(g, `${a} is on the World map`);
    const at = await hold(a, b, { then: () => W2(`renderer.project(${JSON.stringify(g)})`) });
    const x1 = await W2('renderer.getTransform()');
    assert.ok(at && Math.abs(at[0] - b[0]) < 1.5, `World 1x drag ${a} -> ${b}: the grabbed place ${g.map((v) => v.toFixed(1))} is at x ${at && at[0].toFixed(1)}`);
    assert.ok(lonDiff(x1.rot[0], r0) > 5 && x1.rot[1] === 0 && x1.k === 1, `World 1x: the drag turned the central meridian ${r0} -> ${x1.rot[0]}, no tilt`);
  }
  // all the way round: drags to the right keep turning the middle westward, past the date line and the seam, more than a full turn
  let prevMid = await W2('renderer.invert([550, 310])'), turned = 0;
  for (let i = 0; i < 9; i++) {
    await hold([300, 310], [600, 310], { steps: 8 });
    const c = await W2('renderer.invert([550, 310])');
    const step = ((prevMid[0] - c[0]) % 360 + 360) % 360;
    assert.ok(step > 60 && step < 140, `World drag ${i + 1}: the middle moved ${step.toFixed(1)} degrees west (${prevMid[0].toFixed(1)} -> ${c[0].toFixed(1)})`);
    turned += step; prevMid = c;
  }
  assert.ok(turned > 720, `nine drags turned the World ${turned.toFixed(0)} degrees: any longitude can be centred`);
  await W2('renderer.resetView(0)'); await sleep(150);
  await wheel(page, { x: 550, y: 310 }, { dy: -700 }); await sleep(400);
  const z0 = await W2('renderer.getTransform()');
  assert.ok(z0.k > 2, `World zooms: ${z0.k}`);
  const gz = await W2('renderer.invert([500, 300])');
  const atz = await hold([500, 300], [640, 240], { then: () => W2(`renderer.project(${JSON.stringify(gz)})`) });
  const z1 = await W2('renderer.getTransform()');
  assert.ok(lonDiff(z1.rot[0], z0.rot[0]) > 1 && z1.tx === z0.tx, `World ${z0.k.toFixed(1)}x: a horizontal drag turns the meridian, never pans sideways (${JSON.stringify(z0)} -> ${JSON.stringify(z1)})`);
  assert.ok(z1.ty !== z0.ty && atz && Math.abs(atz[0] - 640) < 1.5 && Math.abs(atz[1] - 240) < 1.5, `World zoomed: the vertical part pans and the place follows the pointer: ${atz}`);
  // a flick coasts (the meridian keeps turning after the release) and comes to rest
  await W2('renderer.resetView(0)'); await sleep(200);
  await page.eval(`(() => { let prev = window.__wp2.renderer.getTransform().rot[0]; window.__lastTurn = 0; window.__relAt = 0;
    window.__wp2.canvas.addEventListener('pointerup', () => { window.__relAt = performance.now(); window.__relRot = window.__wp2.renderer.getTransform().rot[0]; }, { once: true });
    const tick = () => { const r = window.__wp2.renderer.getTransform().rot[0]; if (Math.abs(r - prev) > 0.002) window.__lastTurn = performance.now(); prev = r; requestAnimationFrame(tick); }; requestAnimationFrame(tick); })()`);
  await raw.down(300, 300);
  const tf = Date.now();
  while (Date.now() - tf < 140) { await raw.move(300 + Math.round((Date.now() - tf) * 1.2), 300); await sleep(4); }
  const upX = 300 + Math.round((Date.now() - tf) * 1.2);
  await raw.move(upX, 300); await raw.up(upX, 300);
  await sleep(1200);
  const fl = await page.eval(`({ rel: window.__relRot, end: window.__wp2.renderer.getTransform().rot[0], last: window.__lastTurn - window.__relAt })`);
  assert.ok(Math.abs(fl.end - fl.rel) > 0.5, `a flick coasts on after the release: ${fl.rel} -> ${fl.end}`);
  assert.ok(fl.last <= 800, `and rests within 800 ms (last turn ${fl.last.toFixed(0)} ms after release)`);

  // ---- 2. Turning redraws at rotate quality and allocates no typed arrays (World and Regional) ----
  for (const [view, w, h] of [['wm', 1100, 620], ['np', 390, 844]]) {
    await open(view, w, h);
    await hold([150, 400], [190, 400], { steps: 4 }); await sleep(500); await W2('renderer.resetView(0)'); await sleep(300); // warm the scratch pool
    await page.eval(`(() => { window.__made = 0; window.__where = []; for (const n of ['Float32Array', 'Int32Array', 'Uint8Array', 'Uint32Array', 'Uint8ClampedArray', 'Int16Array']) {
      const real = globalThis['__real' + n] || (globalThis['__real' + n] = globalThis[n]); globalThis[n] = new Proxy(real, { construct(tg, a, nt) { window.__made++; if (window.__where.length < 3) window.__where.push(n + ' ' + new Error().stack.split('\\n').slice(2, 5).join(' < ')); return Reflect.construct(tg, a, nt); } }); } })()`);
    const c0 = await W2('renderer.stats()');
    await raw.down(150, 400);
    for (let i = 1; i <= 20; i++) { await raw.move(150 + i * 5, 400); await sleep(17); }
    const mid = await W2('renderer.stats()'), made = await page.eval('window.__made');
    await raw.up(250, 400);
    await page.waitFor(`window.__wp2.renderer.stats().quality === "rest"`, { timeout: 2000 }).catch(() => {});
    await page.eval(`(() => { for (const n of ['Float32Array', 'Int32Array', 'Uint8Array', 'Uint32Array', 'Uint8ClampedArray', 'Int16Array']) globalThis[n] = globalThis['__real' + n]; })()`);
    assert.equal(mid.quality, 'rotate', `${view}: a turn is drawn at rotate quality`);
    assert.ok(mid.composes - c0.composes >= 8, `${view}: the map redraws as it turns (${mid.composes - c0.composes} composes over 20 moves)`);
    assert.equal(made, 0, `${view}: ${made} typed arrays were constructed while turning: ${await page.eval('window.__where.join(" || ")')}`);
    assert.equal((await W2('renderer.stats()')).quality, 'rest', `${view}: rest quality returns after the turn`);
  }

  // ---- 3. Hemisphere: the grabbed place follows the pointer (spin and tilt), and the centre never tilts past 30N ----
  await open('nh', 800, 800);
  for (const [a, b] of [[[400, 520], [400, 400]], [[300, 300], [420, 360]], [[500, 450], [360, 520]]]) {
    await W2('renderer.resetView(0)'); await sleep(150);
    const g = await W2(`renderer.invert(${JSON.stringify(a)})`);
    const under = await hold(a, b, { then: () => W2(`renderer.invert(${JSON.stringify(b)})`) });
    assert.ok(g && under && dist(g, under) < 1.5, `Hemisphere drag ${a} -> ${b}: the grabbed place ${g} is ${under ? dist(g, under).toFixed(2) : '?'} deg from the pointer`);
  }
  await W2('renderer.resetView(0)'); await sleep(150);
  await hold([400, 700], [400, 80], { steps: 14 });
  const tilt = await W2('renderer.getTransform()'), mid = await W2('renderer.invert([400, 400])');
  assert.ok(tilt.rot[1] > 30 && tilt.rot[1] <= 60 && mid[1] >= 30 - 0.05, `a long drag tilts the centre down to 30N and no further: rot ${tilt.rot}, centre ${mid}`);
  // the pole spin still works: a drag round the pole at the default turns it about the pole without tilting
  await W2('renderer.resetView(0)'); await sleep(150);
  await hold([600, 400], [400, 600], { steps: 12 });
  const spun = await W2('renderer.getTransform()');
  assert.ok(Math.abs(spun.rot[0] + 90) < 1.5 && Math.abs(spun.rot[1]) < 1.5, `a quarter turn round the pole stays a spin: ${spun.rot}`);

  // ---- 4. Regional (phone): a horizontal drag turns the conic within its data; the grabbed place follows ----
  await open('np', 390, 844);
  const gr = await W2('renderer.invert([200, 420])');
  const atr = await hold([200, 420], [330, 420], { then: () => W2(`renderer.project(${JSON.stringify(gr)})`) });
  const xr = await W2('renderer.getTransform()');
  assert.ok(xr.rot[0] > 5, `a right drag on the phone's Regional map turns it to look west (rot[0] up): ${xr.rot[0]}`);
  assert.ok(atr && Math.abs(atr[0] - 330) < 1.5 && Math.abs(atr[1] - 420) < 1.5, `the grabbed place follows the finger: ${atr}`);

  // ---- 5. Overlays (pins, labels) project through the turned view: a marker drawn at a place lands where project() says ----
  await open('wm', 900, 600);
  await W2('renderer.setTransform({ k: 1, tx: 0, ty: 0, rot: [-140, 0, 0] }, 0)');
  const probe = await page.eval(`(() => { const r = window.__wp2.renderer; r.addOverlay((ctx, proj) => { const p = proj([10, 50]); if (p) { ctx.fillStyle = '#ff00ff'; ctx.fillRect(Math.round(p[0]) - 4, Math.round(p[1]) - 4, 9, 9); } });
    r.draw(); return r.project([10, 50]); })()`);
  const img = decodePNG(await page.screenshot());
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) { const o = (y * img.w + x) * img.ch; if (img.px[o] === 255 && img.px[o + 1] === 0 && img.px[o + 2] === 255) { sx += x; sy += y; n++; } }
  assert.ok(n >= 60 && Math.abs(sx / n - probe[0]) < 1.5 && Math.abs(sy / n - probe[1]) < 1.5, `the marker at 10E 50N is drawn where the turned view puts it (${n} px at ${(sx / n).toFixed(1)},${(sy / n).toFixed(1)}; project ${probe})`);
  assert.ok(Math.abs(probe[0] - 450) < 60, `turned to 10W, 10E is near the middle: ${probe}`);

  // ---- 6. The real app: Center here on the pinned reading; Reset view and 0 restore each view's default. Regional at 1x turns and pans
  // only as far as its data covers the frame, so there the place comes nearer the middle rather than onto it ----
  await page.setViewport(1000, 700, 1);
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 45000 });
  await page.eval(`(async () => { (await import(new URL('js/time/clock.js', document.baseURI).href)).pause(); __wse.store.set({ playing: false }); })()`);
  const cv = await page.eval(`(() => { const r = document.getElementById('map').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  for (const [view, place] of [['wm', [-30, 40]], ['nh', [-75, 45]], ['gl', [-95, 20]], ['np', [-100, 45]]]) {
    await page.eval(`__wse.store.set({ view: '${view}' })`); await sleep(500);
    await page.eval('__wse.renderer.resetView(0)'); await sleep(200);
    const p = await page.eval(`__wse.renderer.project(${JSON.stringify(place)})`);
    assert.ok(p, `${view}: ${place} is on the map`);
    const mid0 = await page.eval(`__wse.renderer.invert([${cv.w / 2}, ${cv.h / 2}])`);
    await click(page, { x: cv.x + p[0], y: cv.y + p[1] });
    await page.waitFor('!!document.querySelector("#readout:not([hidden]) .rdo-centre")', { timeout: 6000 });
    const btn = await page.eval(`(() => { const b = document.querySelector('#readout .rdo-centre'), r = b.getBoundingClientRect(); return { text: b.textContent, w: r.width, h: r.height }; })()`);
    assert.ok(btn.text === 'Center here' && btn.h >= 44, `${view}: the pinned reading offers "Center here" at 44 px: ${JSON.stringify(btn)}`);
    const ll = await page.eval('__wse.ui.readout.model()');
    await click(page, '#readout .rdo-centre');
    await sleep(900);
    assert.ok(await page.eval(`document.getElementById('readout').hidden`), `${view}: the card steps aside`);
    const q = await page.eval(`__wse.renderer.project([${ll.lon}, ${ll.lat}])`);
    const before = dist([ll.lon, ll.lat], mid0), now = await page.eval(`__wse.renderer.invert([${cv.w / 2}, ${cv.h / 2}])`);
    const after = now ? dist([ll.lon, ll.lat], now) : 999;
    assert.ok(q && after < (view === 'np' ? before - 3 : before / 2), `${view}: Center here brings ${ll.lon.toFixed(1)},${ll.lat.toFixed(1)} toward the middle (${before.toFixed(1)} -> ${after.toFixed(1)} degrees off)`);
    if (view === 'wm' || view === 'gl') assert.ok(Math.abs(q[0] - cv.w / 2) < 3, `${view}: the place is on the middle column: ${q}`);
    const reset = await page.eval(`(() => { const b = document.getElementById('btn-reset'); return !!b && !b.hidden && b.offsetWidth > 0; })()`);
    assert.ok(reset, `${view}: Reset view shows once the view is turned`);
    await click(page, '#btn-reset'); await sleep(900);
    const d = await page.eval('__wse.renderer.getTransform()');
    assert.ok(d.k === 1 && Math.abs(d.tx) < 0.5 && Math.abs(d.ty) < 0.5 && d.rot.every((v) => Math.abs(v) < 0.05), `${view}: Reset view restores the default: ${JSON.stringify(d)}`);
  }
  // the keyboard: on the focused World map an arrow turns it, 0 turns it back
  await page.eval(`__wse.store.set({ view: 'wm' })`); await sleep(400);
  await click(page, { x: cv.x + cv.w / 2, y: cv.y + cv.h / 2 }); await sleep(200);
  await key(page, null, 'Escape'); await sleep(150);
  await page.eval(`document.getElementById('map').focus()`);
  await key(page, null, 'ArrowRight'); await sleep(400);
  const kr = await page.eval('__wse.renderer.getTransform().rot[0]');
  assert.ok(Math.abs(kr + 5) < 0.01, `ArrowRight turns the World 5 degrees: ${kr}`);
  await key(page, null, '0'); await sleep(600);
  assert.equal(await page.eval('__wse.renderer.getTransform().rot[0]'), 0, '0 turns it back');
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
}
