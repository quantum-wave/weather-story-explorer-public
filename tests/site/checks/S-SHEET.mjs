// S-SHEET (W2-08, TEST-4, Josh points 10 and 5): the one sheet component, on the real shell. No UI path opens a sheet yet (W3-07 wires
// add/edit and owns S-ADDFLOW), so this check mounts one from a test-only harness evaluated in the page: it imports js/ui/sheet.js
// from the served site and builds its own content. It records every animation frame across open, resize, a text change, setContent
// and close, then asserts: height equals content up to 92% of the visual viewport; each structural change moves the height straight
// to its target in about 180 ms and a text change moves it by 0 px; drag over 24 px from the handle, scrim tap, Escape and the close
// button dismiss; a dirty draft asks inline; focus moves in, is trapped and returns; the action row stays inside a viewport reduced
// by 300 px; desktop is a 420 px dialog; reduced motion is instant. Dismissal uses real CDP touch/mouse/key input.
import * as inp from '../lib/input.mjs';

export const id = 'S-SHEET';
export const freshProfile = true;
export const timeoutMs = 120000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the test-only harness, evaluated in the page ----
const HARNESS = `(() => {
  window.__rec = (ms) => new Promise((res) => {
    const frames = [], t0 = performance.now();
    const tick = () => {
      const p = document.querySelector('.wse-sheet');
      if (p) { const r = p.getBoundingClientRect(); frames.push({ t: performance.now() - t0, op: +getComputedStyle(p).opacity, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right }); }
      if (performance.now() - t0 < ms) requestAnimationFrame(tick); else res(frames);
    };
    requestAnimationFrame(tick);
  });
  window.__mk = (text, extra) => {
    const c = document.createElement('div');
    const p = document.createElement('p'); p.id = 'sh-p'; p.textContent = text || 'Fri 27 Nov to Mon 30 Nov';
    const a = document.createElement('input'); a.id = 'sh-a'; a.setAttribute('aria-label', 'Label'); a.value = 'Tahoe';
    c.append(p, a);
    if (extra) { const d = document.createElement('div'); d.id = 'sh-extra'; d.style.height = extra + 'px'; d.textContent = 'extra block'; c.append(d); }
    return c;
  };
  window.__open = async (o = {}) => {
    const m = await import(new URL('js/ui/sheet.js', document.baseURI).href);
    window.__log = []; window.__dirty = !!o.dirty;
    const opener = document.getElementById('btn-theme'); opener.focus();
    window.__s = m.openSheet({
      title: 'Edit trip', content: window.__mk(o.text, o.extra),
      actions: [{ id: 'remove', label: 'Remove', kind: 'danger', onClick() {} }, { id: 'cancel', label: 'Cancel', onClick: (s) => s.close('cancel') }, { id: 'save', label: 'Save', kind: 'primary', onClick: (s) => s.close('save') }],
      onClose: (r) => window.__log.push(r), isDirty: () => window.__dirty,
    });
    await window.__s.ready;
    return true;
  };
  window.__geo = () => {
    const p = document.querySelector('.wse-sheet'); if (!p) return null;
    const top = p.querySelector('.wse-sheet-top'), body = p.querySelector('.wse-sheet-body'), foot = p.querySelector('.wse-sheet-actions');
    const r = p.getBoundingClientRect(), f = foot.getBoundingClientRect(), vv = window.visualViewport;
    const vvTop = vv.offsetTop, innerH = window.innerHeight;
    const cs = getComputedStyle(p);
    return { h: r.height, top: r.top, bottom: r.bottom, w: r.width, vvH: vv.height, vvTop, innerH, footBottom: f.bottom, footVisible: foot.getClientRects().length > 0,
      content: top.offsetHeight + body.scrollHeight + foot.offsetHeight + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0),
      bodyScrolls: body.scrollHeight > body.clientHeight + 1, handleShown: getComputedStyle(p.querySelector('.wse-sheet-handle')).display !== 'none' };
  };
})()`;

const open = (page, o = {}) => page.eval(`__open(${JSON.stringify(o)})`);
const gone = (page) => page.waitFor(`!document.querySelector('.wse-sheet-root')`, { timeout: 3000 });
const isOpen = (page) => page.eval(`!!document.querySelector('.wse-sheet-root')`);
const geo = (page) => page.eval('__geo()');
const log = (page) => page.eval('window.__log');
async function closeNow(page) { await page.eval(`window.__s && window.__s.close('test-cleanup')`); await sleep(300); }
/** Record frames for `ms` while `action` runs (started after the recorder's first frame). */
async function record(page, ms, action) {
  await page.eval('window.__p = __rec(' + ms + '), 1');
  await sleep(40);
  await action();
  return page.eval('window.__p');
}
/** Every frame is no farther from `target` than the one before it (0.5 px slack for subpixel rounding). */
function towards(assert, frames, target, what) {
  for (let i = 1; i < frames.length; i++) assert.ok(Math.abs(frames[i].h - target) <= Math.abs(frames[i - 1].h - target) + 0.5, `${what}: frame ${i} moved away from ${target}: ${frames[i - 1].h} -> ${frames[i].h}`);
}
/** The animated stretch: first frame whose height differs from the start to the first frame at the target. */
function span(frames, from, to) {
  const a = frames.find((f) => Math.abs(f.h - from) > 0.5), b = frames.find((f) => a && f.t >= a.t && Math.abs(f.h - to) <= 0.5);
  return a && b ? { ms: b.t - a.t, between: frames.filter((f) => f.t >= a.t && f.t <= b.t && Math.abs(f.h - from) > 0.5 && Math.abs(f.h - to) > 0.5).length } : null;
}

/** Close animation: a moving start, at least 3 intermediate frames, and the stretch lasts about 180 ms (the last frame is the removal). */
function closeAnimates(assert, frames, restTop, what, key = 'top', rest = restTop) {
  const a = frames.find((f) => Math.abs(f[key] - rest) > 0.5);
  assert.ok(a, what + ': the panel moved at all');
  const last = frames[frames.length - 1];
  const mid = frames.filter((f) => f.t >= a.t && Math.abs(f[key] - rest) > 0.5);
  assert.ok(mid.length >= 3, `${what}: at least 3 intermediate frames, got ${mid.length}`);
  const ms = last.t - a.t;
  assert.ok(ms >= 100 && ms <= 330, `${what}: takes about 180 ms, took ${Math.round(ms)}`);
}

export async function run({ page, baseUrl, assert }) {
  const metrics = (w, h, mobile) => page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile });
  const boot = async () => {
    await page.goto(baseUrl);
    await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 30000 });
    await page.eval(HARNESS);
  };

  // ================= phone =================
  await metrics(390, 844, true);
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await boot();

  // 1. open: the sheet rises into the viewport; at rest its height is its content's height; semantics; focus; inert background
  let frames = await record(page, 600, () => open(page));
  let g = await geo(page);
  assert.ok(Math.abs(g.h - g.content) <= 2, `height equals content height: ${g.h} vs ${g.content}`);
  assert.ok(g.h <= 0.92 * g.vvH + 0.5, 'height is at most 92% of the visual viewport');
  assert.ok(g.top >= 0 && g.bottom <= g.vvH + 0.5, `the sheet is inside the viewport at rest: ${g.top}..${g.bottom} of ${g.vvH}`);
  assert.ok(g.handleShown, 'the phone sheet shows its handle');
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].top <= frames[i - 1].top + 0.5, `open: the sheet only rises (frame ${i}: ${frames[i - 1].top} -> ${frames[i].top})`);
  assert.ok(frames.some((f) => f.top > g.top + 20), 'open animates: some frame has the sheet still below its resting place');
  assert.ok(frames.every((f) => f.left >= -0.5 && f.right <= 390.5), 'open: never wider than the viewport');
  const sem = await page.eval(`(() => { const p = document.querySelector('.wse-sheet'), t = document.getElementById(p.getAttribute('aria-labelledby'));
    return { role: p.getAttribute('role'), modal: p.getAttribute('aria-modal'), title: t && t.textContent, font: t && getComputedStyle(t).fontFamily, size: t && getComputedStyle(t).fontSize, weight: t && getComputedStyle(t).fontWeight,
      inside: p.contains(document.activeElement), inert: document.getElementById('app').inert }; })()`);
  assert.equal(sem.role, 'dialog'); assert.equal(sem.modal, 'true'); assert.equal(sem.title, 'Edit trip');
  assert.ok(/system-ui/.test(sem.font) && !/serif/i.test(sem.font.replace(/sans-serif/gi, '')), 'the title is in the UI font, never a serif: ' + sem.font);
  assert.equal(sem.size, '17px'); assert.equal(sem.weight, '600');
  assert.ok(sem.inside, 'focus moved into the sheet'); assert.ok(sem.inert, 'the page behind is inert');
  const startH = g.h;

  // 2. a text change without resize() changes the height by 0 px (a long string that wraps to several lines)
  frames = await record(page, 600, () => page.eval(`document.getElementById('sh-p').textContent = 'A long note that surely wraps onto several lines of the narrow phone sheet, and then some more words to push it well past three lines of text in total.'`));
  assert.ok(frames.length > 10, 'frames were recorded');
  assert.ok(frames.every((f) => Math.abs(f.h - startH) < 0.01), `a text change without resize() changes the height by 0 px: ${[...new Set(frames.map((f) => f.h))]}`);
  await page.eval(`document.getElementById('sh-p').textContent = 'Fri 27 Nov to Mon 30 Nov'`);

  // 3. an added block + resize(): one animation straight to the new height, about 180 ms
  frames = await record(page, 700, () => page.eval(`(async () => { const d = document.createElement('div'); d.style.height = '140px'; d.id = 'sh-grow'; d.textContent = 'a block'; document.querySelector('.wse-sheet-body').append(d); await __s.resize(); })()`));
  let g2 = await geo(page);
  assert.ok(Math.abs(g2.h - (startH + 140)) <= 2, `resize() grows by the added block: ${startH} -> ${g2.h}`);
  assert.ok(Math.abs(g2.h - g2.content) <= 2, 'after resize() the height equals the content again');
  towards(assert, frames, g2.h, 'resize grow');
  let s = span(frames, startH, g2.h);
  assert.ok(s && s.between >= 2, 'the growth is animated (at least two intermediate frames): ' + JSON.stringify(s));
  assert.ok(s.ms >= 100 && s.ms <= 330, `the growth takes about 180 ms: ${Math.round(s.ms)} ms`);
  assert.ok(frames.every((f) => f.bottom <= g.vvH + 0.5), 'the sheet stays on the bottom edge while it grows');
  // removing it shrinks the same way
  frames = await record(page, 700, () => page.eval(`(async () => { document.getElementById('sh-grow').remove(); await __s.resize(); })()`));
  g = await geo(page);
  towards(assert, frames, g.h, 'resize shrink');
  assert.ok(Math.abs(g.h - startH) <= 1, 'removing the block returns to the first height');

  // 4. setContent animates to the new content's height; content taller than 92% is capped and its body scrolls, the action row stays on screen
  frames = await record(page, 700, () => page.eval(`__s.setContent(__mk('Replaced', 90))`));
  g = await geo(page);
  towards(assert, frames, g.h, 'setContent');
  assert.ok(Math.abs(g.h - g.content) <= 2, 'setContent: height equals the new content height');
  frames = await record(page, 700, () => page.eval(`__s.setContent(__mk('Tall', 1500))`));
  g = await geo(page);
  towards(assert, frames, g.h, 'setContent tall');
  assert.ok(Math.abs(g.h - Math.floor(0.92 * g.vvH)) <= 1.5, `tall content is capped at 92%: ${g.h} of ${g.vvH}`);
  assert.ok(g.bodyScrolls, 'the body scrolls inside a capped sheet'); assert.ok(g.footBottom <= g.vvH + 0.5 && g.footVisible, 'the action row stays on screen');

  // 5. the on-screen keyboard: ONLY the visual viewport shrinks (page scale 844/544 leaves innerHeight at 844 and the visual viewport at
  // 544, like a keyboard that overlays the layout viewport), and the action row's bottom is still inside the visual viewport
  await page.eval(`__s.setContent(__mk('Short'))`); await sleep(400);
  await page.send('Emulation.setPageScaleFactor', { pageScaleFactor: 844 / 544 }); await sleep(500);
  g = await geo(page);
  assert.ok(g.vvH <= 545 && g.vvH >= 543, 'the visual viewport shrank: ' + g.vvH);
  assert.ok(g.innerH >= 843, 'the layout viewport did not shrink (only the visual viewport did): ' + g.innerH);
  assert.ok(g.footBottom <= g.vvTop + g.vvH + 0.5, `the action row bottom is inside the visual viewport: ${g.footBottom} of ${g.vvTop}+${g.vvH}`);
  assert.ok(g.top >= g.vvTop - 0.5 && g.h <= 0.92 * g.vvH + 1, 'the sheet fits the reduced viewport');
  await page.eval(`__s.setContent(__mk('Tall', 1500))`); await sleep(400);
  g = await geo(page);
  assert.ok(g.footBottom <= g.vvTop + g.vvH + 0.5 && g.footVisible && g.top >= g.vvTop - 0.5, `tall content under the keyboard keeps the action row visible: ${g.footBottom} of ${g.vvTop}+${g.vvH}`);
  await page.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }); await sleep(500);
  await closeNow(page);

  // 6. focus is trapped (real Tab keys) and returns to the opener; the inert page is released
  await open(page); await sleep(300);
  const ends = await page.eval(`(() => { const p = document.querySelector('.wse-sheet'); const l = [...p.querySelectorAll('button:not([disabled]), input')].filter((e) => e.getClientRects().length); return { first: l[0].className + '|' + l[0].id, last: l[l.length - 1].dataset.action }; })()`);
  await page.eval(`document.querySelector('[data-action="save"]').focus()`);
  await inp.key(page, null, 'Tab'); await sleep(50);
  assert.equal(await page.eval(`document.activeElement.className`), 'wse-sheet-close', 'Tab from the last control returns to the first');
  await inp.key(page, null, 'Tab', { modifiers: ['Shift'] }); await sleep(50);
  assert.equal(await page.eval(`document.activeElement.dataset.action`), 'save', 'Shift+Tab from the first control goes to the last');
  for (let i = 0; i < 8; i++) { await inp.key(page, null, 'Tab'); assert.ok(await page.eval(`document.querySelector('.wse-sheet').contains(document.activeElement)`), 'focus never leaves the sheet (Tab ' + (i + 1) + ')'); }
  await page.eval(`__s.close('save')`); await gone(page);
  assert.equal(await page.eval(`document.activeElement && document.activeElement.id`), 'btn-theme', 'focus returns to the opener');
  assert.equal(await page.eval(`document.getElementById('app').inert`), false, 'the page is no longer inert');
  assert.deepEqual(await log(page), ['save']);

  // 6b. close animates: the panel only moves down, through intermediate frames, in about 180 ms, then is removed
  await open(page); await sleep(300);
  g = await geo(page);
  frames = await record(page, 700, () => page.eval(`__s.close('save')`));
  await gone(page);
  closeAnimates(assert, frames, g.top, 'phone close');
  assert.ok(frames.every((f) => f.top >= g.top - 0.5), 'phone close: the panel only moves down');
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].top >= frames[i - 1].top - 0.5, `phone close: only downward (frame ${i}: ${frames[i - 1].top} -> ${frames[i].top})`);
  assert.ok(Math.max(...frames.map((f) => f.top)) > g.top + 100, 'phone close: the panel travels well down before it is removed');

  // 7. dismissal: drag, scrim, Escape, the close button. A clean sheet closes at once.
  await open(page); await sleep(300);
  await inp.drag(page, '.wse-sheet-handle', { by: { dx: 0, dy: 15 }, touch: true }); await sleep(450);
  assert.ok(await isOpen(page), 'a 15 px drag from the handle snaps back and does not dismiss');
  g = await geo(page); assert.ok(g.bottom <= g.vvH + 0.5 && g.bottom >= g.vvH - 1, 'after the snap back the sheet is on the bottom edge: ' + g.bottom);
  await inp.drag(page, '.wse-sheet-handle', { by: { dx: 0, dy: 40 }, touch: true }); await gone(page);
  assert.deepEqual(await log(page), ['drag'], 'a drag of 40 px dismisses (reason drag)');

  await open(page); await sleep(300);
  await inp.tap(page, { x: 195, y: 30 }); await gone(page);
  assert.deepEqual(await log(page), ['scrim'], 'a tap on the scrim dismisses');

  await open(page); await sleep(300);
  await inp.key(page, null, 'Escape'); await gone(page);
  assert.deepEqual(await log(page), ['escape'], 'Escape dismisses');
  assert.equal(await page.eval(`document.activeElement && document.activeElement.id`), 'btn-theme', 'focus returns after Escape');

  await open(page); await sleep(300);
  await inp.tap(page, '.wse-sheet-close'); await gone(page);
  assert.deepEqual(await log(page), ['close'], 'the close button dismisses');

  // 8. a dirty draft asks once, inline: Keep editing stays, Discard leaves
  await open(page, { dirty: true }); await sleep(300);
  const before = (await geo(page)).h;
  await inp.key(page, null, 'Escape'); await sleep(350);
  assert.ok(await isOpen(page), 'a dirty sheet does not close on Escape');
  assert.equal(await page.eval(`document.querySelector('.wse-sheet-confirm').hidden`), false, 'the inline confirm appears');
  assert.equal(await page.eval(`document.querySelector('.wse-sheet-confirm p').textContent`), 'Discard changes?');
  assert.equal(await page.eval(`document.activeElement.dataset.action`), 'keep', 'focus is on Keep editing');
  g = await geo(page); assert.ok(g.footBottom <= g.vvH + 0.5 && g.bottom <= g.vvH + 0.5, 'the confirm stays inside the viewport'); assert.ok(g.h >= before - 0.5, 'the confirm does not shrink the sheet');
  await inp.tap(page, '[data-action="keep"]'); await sleep(350);
  assert.ok(await isOpen(page), 'Keep editing keeps the sheet');
  assert.equal(await page.eval(`document.querySelector('.wse-sheet-confirm').hidden`), true, 'the confirm is gone after Keep editing');
  await inp.tap(page, { x: 195, y: 30 }); await sleep(350);
  assert.equal(await page.eval(`document.querySelector('.wse-sheet-confirm').hidden`), false, 'a scrim tap on a dirty sheet asks too');
  await inp.drag(page, '.wse-sheet-handle', { by: { dx: 0, dy: 60 }, touch: true }).catch(() => {}); await sleep(450);
  assert.ok(await isOpen(page), 'a dirty sheet does not close on a drag either');
  await inp.tap(page, '[data-action="discard"]'); await gone(page);
  assert.deepEqual(await log(page), ['discard'], 'Discard closes');
  // isDirty false or absent: closes at once (no confirm), shown by the Escape test above; close() from code never asks
  await open(page, { dirty: true }); await sleep(300);
  await page.eval(`__s.close('save')`); await gone(page);
  assert.deepEqual(await log(page), ['save'], 'close() from code does not ask');

  // 9. reduced motion: no animation, structural changes are instant
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await open(page); await sleep(200);
  const h0 = (await geo(page)).h;
  frames = await record(page, 400, () => page.eval(`(async () => { const d = document.createElement('div'); d.style.height = '140px'; d.textContent = 'a block'; document.querySelector('.wse-sheet-body').append(d); await __s.resize(); })()`));
  g = await geo(page);
  assert.ok(g.h > h0 + 100, 'resize still resizes under reduced motion');
  assert.ok(frames.every((f) => Math.abs(f.h - h0) < 0.5 || Math.abs(f.h - g.h) < 0.5), 'reduced motion: no intermediate frame');
  await closeNow(page); await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  assert.deepEqual(page.errors(), [], JSON.stringify(page.errors()));

  // ================= desktop =================
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await metrics(1440, 900, false);
  await boot();
  frames = await record(page, 600, () => open(page));
  g = await geo(page);
  assert.ok(Math.abs(g.w - 420) <= 1, 'desktop: a 420 px dialog, got ' + g.w);
  assert.ok(!g.handleShown, 'desktop: no handle');
  assert.ok(g.top >= 0 && g.bottom <= 900, 'desktop: inside the viewport');
  assert.ok(Math.abs(g.h - g.content) <= 2, `desktop: height equals content: ${g.h} vs ${g.content}`);
  frames = await record(page, 700, () => page.eval(`(async () => { const d = document.createElement('div'); d.style.height = '140px'; d.textContent = 'a block'; document.querySelector('.wse-sheet-body').append(d); await __s.resize(); })()`));
  g2 = await geo(page);
  towards(assert, frames, g2.h, 'desktop resize');
  s = span(frames, g.h, g2.h); assert.ok(s && s.between >= 2 && s.ms >= 100 && s.ms <= 330, 'desktop resize animates in about 180 ms: ' + JSON.stringify(s));
  // desktop close fades: opacity only goes down, through intermediate frames, in about 180 ms
  await closeNow(page); await open(page); await sleep(300);
  frames = await record(page, 700, () => page.eval(`__s.close('save')`));
  await gone(page);
  { const a = frames.find((f) => f.op < 0.99); assert.ok(a, 'desktop close: the panel fades');
    for (let i = 1; i < frames.length; i++) assert.ok(frames[i].op <= frames[i - 1].op + 0.01, `desktop close: opacity only falls (frame ${i}: ${frames[i - 1].op} -> ${frames[i].op})`);
    assert.ok(frames.filter((f) => f.op > 0.02 && f.op < 0.98).length >= 3, 'desktop close: at least 3 intermediate frames');
    const ms = frames[frames.length - 1].t - a.t; assert.ok(ms >= 100 && ms <= 330, 'desktop close takes about 180 ms: ' + Math.round(ms)); }
  await open(page); await sleep(300);
  await inp.click(page, { x: 60, y: 60 }); await gone(page);
  assert.deepEqual(await log(page), ['scrim'], 'desktop: a click on the scrim dismisses');
  await open(page); await sleep(300);
  await inp.key(page, null, 'Escape'); await gone(page);
  assert.deepEqual(await log(page), ['escape'], 'desktop: Escape dismisses');
  assert.deepEqual(page.errors(), [], JSON.stringify(page.errors()));
}
