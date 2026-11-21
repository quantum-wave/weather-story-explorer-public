// S-ANIM: 2 s of play gives >= 20 distinct clock values (and, where the renderer is wired to the clock, canvas pixels
// that differ); pause stops the loop; tweens, steps, keys, drag, trips, ribbon, debug readout. Frame times are reported.
import fs from 'node:fs';
import path from 'node:path';

export const id = 'S-ANIM';
export const freshProfile = false;
export const timeoutMs = 90000;

export async function run({ page, baseUrl, assert, dataDir }) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'manifest.json'), 'utf8'));
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 15000 });
  await page.eval(`(async () => {
    const base = new URL('js/time/', document.baseURI).href;
    window.__T = { clock: await import(base + 'clock.js'), scrub: await import(base + 'scrubber.js'),
      keys: await import(base + 'keys.js'), debug: await import(base + 'debug.js'), state: await import(new URL('js/state.js', document.baseURI).href) };
    window.__T.clock.refresh();
    window.__T.offKeys = window.__T.keys.installKeys(document);
    window.__T.dbg = window.__T.debug.installDebug();
    window.__T.unmount = window.__T.scrub.mountScrubber(document.getElementById('timeline'));
    return true; })()`);

  // range = the active lens's own steps (Pattern: z500a and z500), straight from the manifest; a sample case is whatever holds them
  const own = ['z500a', 'z500'].flatMap((id) => manifest.fields[id]?.steps || []);
  const want = [Math.min(...own), Math.max(...own)];
  assert.deepEqual(await page.eval('__T.clock.range()'), want, 'range is the active lens steps');
  const span = want[1] - want[0];
  if (span <= 60) assert.equal(await page.eval('__wse.store.get().speed'), 3, 'a short case plays at 3 h/s');

  // 2 s of play
  await page.eval('__T.clock.seek(' + want[0] + ')');
  const play = await page.eval(`new Promise((resolve) => {
    const c = __T.clock, s = __wse.store, vals = new Set(), canvas = document.getElementById('map');
    let draws = 0; const r = __wse.renderer, od = r.draw; r.draw = function () { draws++; return od.apply(this, arguments); };
    const hashes = new Set(); const px = () => { const x = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let h = 0; for (let i = 0; i < x.length; i += 97) h = (h * 31 + x[i]) | 0; return h; };
    __wse.frameTimes.length = 0;
    c.play(); const t0 = performance.now(); let n = 0;
    const loop = () => { vals.add(s.get().t); if (++n % 15 === 0) hashes.add(px());
      if (performance.now() - t0 < 2000) requestAnimationFrame(loop);
      else { c.pause(); r.draw = od; const ft = __wse.frameTimes.slice(); resolve({ distinct: vals.size, draws, hashes: hashes.size, ft, running: c.isRunning(), min: Math.min(...vals), max: Math.max(...vals) }); } };
    requestAnimationFrame(loop); })`);
  assert.ok(play.distinct >= 20, `clock values in 2 s: ${play.distinct}`);
  assert.ok(play.max - play.min >= 2, `2 s of play advances t by at least 2 h (the clock must not stall): ${(play.max - play.min).toFixed(3)} h`);
  assert.ok(play.min >= want[0] - 1e-9 && play.max <= want[1] + 1e-9, 'clock stays inside the range');
  assert.ok(play.ft.length >= 20, 'frame times recorded: ' + play.ft.length);
  const sorted = [...play.ft].sort((a, b) => a - b);
  console.log(`  S-ANIM frames=${play.ft.length} p50=${sorted[Math.floor(sorted.length / 2)].toFixed(1)} ms p95=${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)} ms distinct=${play.distinct} draws=${play.draws} pixelVariants=${play.hashes}`);
  // the renderer subscribes to the store itself (render/index.js), so draw is not called through the public property;
  // what matters is that the canvas pixels really change while the clock runs
  assert.ok(play.hashes >= 2, 'canvas pixels differ across the loop (renderer is wired to the clock): ' + play.hashes);

  // pause stops everything
  assert.equal(await page.eval('__wse.store.get().playing'), false);
  const t1 = await page.eval('__wse.store.get().t'); await new Promise((r) => setTimeout(r, 300));
  assert.equal(await page.eval('__wse.store.get().t'), t1, 't is frozen while paused');
  assert.equal(await page.eval('__T.clock.isRunning()'), false, 'no animation frame is queued while paused');

  // tween over 500 ms, monotone, lands exactly
  const target = want[0] + span / 2;
  await page.eval('__T.clock.seek(' + want[0] + ')');
  const tw = await page.eval(`(async () => { const s = __wse.store, c = __T.clock, seen = []; const off = s.subscribe((st) => seen.push(st.t));
    const a = performance.now(); const ok = await c.tweenTo(${target}, 500); const ms = performance.now() - a; off();
    return { ok, ms, seen, end: s.get().t }; })()`);
  assert.equal(tw.ok, true); assert.equal(tw.end, target);
  assert.ok(tw.ms >= 450 && tw.ms <= 900, 'tween took ' + tw.ms);
  assert.ok(tw.seen.length >= 10, 'tween frames: ' + tw.seen.length);
  assert.ok(tw.seen.every((v, i) => i === 0 || v >= tw.seen[i - 1]), 'tween is monotone');

  // step by one data step
  const steps = [...new Set(own)].sort((a, b) => a - b);
  await page.eval('__T.clock.seek(' + steps[1] + ')');
  await page.eval('__T.clock.step(1)'); assert.equal(await page.eval('__wse.store.get().t'), steps[2], 'step(+1)');
  await page.eval('__T.clock.step(-1)'); assert.equal(await page.eval('__wse.store.get().t'), steps[1], 'step(-1)');

  // keyboard
  const key = (k, target = 'document.body') => page.eval(`${target}.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, code: ${JSON.stringify(k === ' ' ? 'Space' : k)}, bubbles: true, cancelable: true }))`);
  await key(' '); assert.equal(await page.eval('__wse.store.get().playing'), true, 'Space plays');
  await key(' '); assert.equal(await page.eval('__wse.store.get().playing'), false, 'Space pauses');
  await page.eval('__T.clock.seek(' + steps[1] + ')');
  await key('ArrowRight'); await page.waitFor(`__wse.store.get().t === ${steps[2]}`, { timeout: 2000 });
  await key('ArrowLeft'); await page.waitFor(`__wse.store.get().t === ${steps[1]}`, { timeout: 2000 });
  await key('2'); assert.equal(await page.eval('__wse.store.get().view'), 'nh');
  await key('3'); assert.equal(await page.eval('__wse.store.get().view'), 'gl');
  await key('1'); assert.equal(await page.eval('__wse.store.get().view'), 'np');
  await page.eval(`(() => { const i = document.createElement('input'); i.id = 'tmp-in'; document.body.appendChild(i); })()`);
  await key(' ', "document.getElementById('tmp-in')");
  assert.equal(await page.eval('__wse.store.get().playing'), false, 'Space in a text field does not play');
  await page.eval(`document.getElementById('tmp-in').remove()`);

  // scrubber structure (W3-08): a two-line readout, a ruler, a data-coloured track with zone captions, a named speed menu.
  await page.waitFor(`document.querySelectorAll('#timeline .tl-zonecap').length >= 1 && document.querySelectorAll('#timeline .tl-cell').length >= 4`, { timeout: 5000 });
  const dom = await page.eval(`(() => { const q = (s) => document.querySelectorAll('#timeline ' + s).length; const r = (s) => { const b = document.querySelector('#timeline ' + s).getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
    return { track: q('.tl-track'), ticks: q('.tl-tick'), days: q('.tl-day'), caps: q('.tl-zonecap'), cells: q('.tl-cell'), play: r('.tl-play'), trackBox: r('.tl-track'), step: r('.tl-step'),
      role: document.querySelector('#timeline .tl-track').getAttribute('role'), line1: document.querySelector('#timeline .tl-line1').textContent, line2: document.querySelector('#timeline .tl-line2').textContent,
      speed: document.querySelector('#timeline .tl-speed').textContent, ribbon: q('.tl-ribbon') }; })()`);
  assert.equal(dom.track, 1); assert.ok(dom.ticks >= 1, 'day ticks: ' + dom.ticks); assert.ok(dom.days >= 1, 'ruler labels: ' + dom.days);
  assert.ok(dom.caps >= 1, 'zone captions'); assert.ok(dom.cells >= 4, 'track cells'); assert.equal(dom.ribbon, 0, 'the old confidence ribbon is gone');
  assert.ok(dom.play[0] >= 44 && dom.play[1] >= 44, 'play target ' + dom.play);
  assert.ok(dom.step[0] >= 44 && dom.step[1] >= 44, 'step target ' + dom.step);
  assert.ok(dom.trackBox[1] >= 44, 'track is at least 44 px tall: ' + dom.trackBox);
  assert.equal(dom.role, 'slider'); assert.match(dom.line1, /^\w{3} \d{1,2} \w{3}( \d{4})? · \d{1,2}(:\d\d)? (am|pm)/); assert.match(dom.line2, /^Day \d+ of \d+/); assert.match(dom.speed, /^Speed: (Slow|Normal|Fast)$|h\/s$/);
  // the speed menu is named: Slow, Normal, Fast
  await page.eval(`document.querySelector('#timeline .tl-speed').click()`);
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('#timeline .tl-menu-item')].map((b) => b.textContent)`), ['Slow', 'Normal', 'Fast']);
  await page.eval(`document.querySelectorAll('#timeline .tl-menu-item')[2].click()`);
  assert.equal(await page.eval(`document.querySelector('#timeline .tl-menu').hidden`), true, 'the menu closes on a choice');
  assert.equal(await page.eval('__wse.store.get().speed'), (await page.eval('__T.clock.speeds()'))[2], 'Fast sets the fast speed');
  await page.eval('__T.clock.setSpeed(' + (await page.eval('__wse.store.get().speed')) + ')');

  // drag: pointerdown pauses, pointermove follows, pointerup ends
  await page.eval('__T.clock.play()');
  const drag = await page.eval(`(async () => { const tr = document.querySelector('#timeline .tl-track'), ar = document.querySelector('#timeline .tl-area').getBoundingClientRect();
    const ev = (type, x) => tr.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, clientX: x, clientY: ar.top + 10, button: 0, pointerType: 'touch' }));
    const [lo, hi] = __T.clock.range(); const s = __wse.store;
    ev('pointerdown', ar.left + ar.width * 0.25); const a = s.get().t, pausedOnTouch = !s.get().playing;
    ev('pointermove', ar.left + ar.width * 0.75); await new Promise((r) => setTimeout(r, 80)); const b = s.get().t;
    ev('pointerup', ar.left + ar.width * 0.75); const c = s.get().t;
    const thumb = document.querySelector('#timeline .tl-thumb').style.transform;
    return { lo, hi, a, b, c, pausedOnTouch, thumb, w: ar.width }; })()`);
  assert.ok(drag.pausedOnTouch, 'a touch pauses the loop');
  assert.ok(Math.abs(drag.a - (drag.lo + 0.25 * (drag.hi - drag.lo))) < 0.5, 'pointerdown seeks: ' + drag.a);
  assert.ok(Math.abs(drag.b - (drag.lo + 0.75 * (drag.hi - drag.lo))) < 0.5, 'pointermove follows: ' + drag.b);
  assert.ok(Math.abs(drag.c - drag.b) < 0.5);
  const tx = parseFloat(/translate3d\(([-\d.]+)px/.exec(drag.thumb)?.[1]);
  assert.ok(Math.abs(tx - 0.75 * drag.w) < 2, 'thumb follows t: ' + drag.thumb);

  // trip span from pins.trips()
  const trip = await page.eval(`(async () => { const p = __wse.pins, orig = p.trips, d = __wse.data.validTime(6);
    const pad = (n) => String(n).padStart(2, '0'); const ymd = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    p.trips = () => [{ id: 't1', label: 'Tahoe', start: ymd, end: ymd, city: { name: 'South Lake Tahoe', lat: 38.94, lon: -119.98, admin1: 'California', country: 'US' } }];
    window.__wse.bus ? 0 : 0; const { bus } = await import(new URL('js/state.js', document.baseURI).href); bus.emit('pins:changed');
    await new Promise((r) => setTimeout(r, 120));
    const bars = [...document.querySelectorAll('#timeline .tl-trip')].map((b) => ({ title: b.title, w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height }));
    p.trips = orig; bus.emit('pins:changed'); await new Promise((r) => setTimeout(r, 120));
    return { bars, after: document.querySelectorAll('#timeline .tl-trip').length }; })()`);
  assert.equal(trip.bars.length, 1, 'one trip span drawn'); assert.equal(trip.bars[0].title, 'Tahoe'); assert.ok(trip.bars[0].w > 4 && trip.bars[0].h === 16, 'trip span box: ' + JSON.stringify(trip.bars[0]));
  assert.equal(trip.after, 0, 'span removed when the trip goes');

  // sheet hook, debug readout
  await page.eval(`__wse.store.set({ sheet: 'full' })`);
  assert.equal(await page.eval(`document.getElementById('timeline').dataset.sheet`), 'full');
  await page.eval(`__wse.store.set({ sheet: 'peek' })`);
  assert.equal(await page.eval(`document.getElementById('debug').hidden`), true, '#debug hidden by default');
  await page.eval(`location.hash = '#debug'`);
  await page.waitFor(`document.getElementById('debug').hidden === false`, { timeout: 2000 });
  assert.match(await page.eval(`document.getElementById('debug').textContent`), /frame p95 .*ms · .*heap/);
  await page.eval(`location.hash = ''`);
  await page.waitFor(`document.getElementById('debug').hidden === true`, { timeout: 2000 });
  await page.eval(`(() => { const l = document.getElementById('data-chip'); for (let i = 0; i < 5; i++) l.click(); })()`);
  assert.equal(await page.eval(`document.getElementById('debug').hidden`), false, 'five taps on the data chip show #debug');

  // reduced motion: tweens jump, the opening loop stays paused
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await page.eval('__T.clock.seek(' + want[0] + ')');
  const rm = await page.eval(`(async () => { const a = performance.now(); await __T.clock.tweenTo(${target}, 500); return { ms: performance.now() - a, t: __wse.store.get().t, opening: __T.clock.openingPlay(), playing: __wse.store.get().playing }; })()`);
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  assert.ok(rm.ms < 100 && rm.t === target, 'reduced motion: tween is immediate'); assert.equal(rm.opening, false); assert.equal(rm.playing, false);

  await page.eval(`(() => { __T.dbg.uninstall(); __T.offKeys(); __T.unmount(); })()`);
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
}
