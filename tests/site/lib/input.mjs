// Real input on CDP Input.* (design spec section 15; ground rule 14.1-3: a check reaches a state the way a person does).
// Each helper is (page, target, opts); target is a CSS selector (its box centre, scrolled into view) or {x, y} in CSS px.
// Touch helpers dispatch touchStart/Move/End; mouse helpers dispatch mouse events; type/key dispatch key events.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Resolve a target to a point in CSS px. A selector: the visible centre of the first match, scrolled into view. */
export async function point(page, target) {
  if (target && typeof target === 'object' && 'x' in target) return { x: target.x, y: target.y };
  const r = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(target)}); if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' }); const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; })()`);
  if (!r) throw new Error(`input: no element matches ${target}`);
  if (!r.w || !r.h) throw new Error(`input: ${target} has no size (hidden?)`);
  return { x: r.x, y: r.y };
}

const mouse = (page, type, x, y, o = {}) => page.send('Input.dispatchMouseEvent', { type, x, y, button: o.button ?? 'none', buttons: o.buttons ?? 0, clickCount: o.clickCount ?? 0, deltaX: o.deltaX, deltaY: o.deltaY, modifiers: o.modifiers ?? 0 });
const touch = (page, type, pts, modifiers = 0) => page.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })), modifiers });

/** Mouse click (opts.button 'left'|'right', opts.count 1|2, opts.down ms between press and release). */
export async function click(page, target, { button = 'left', count = 1, down = 20 } = {}) {
  const { x, y } = await point(page, target);
  await mouse(page, 'mouseMoved', x, y);
  for (let c = 1; c <= count; c++) {
    await mouse(page, 'mousePressed', x, y, { button, buttons: button === 'left' ? 1 : 2, clickCount: c });
    await sleep(down);
    await mouse(page, 'mouseReleased', x, y, { button, clickCount: c });
  }
}

/** Finger tap. opts.hold ms (default 30). */
export async function tap(page, target, { hold = 30 } = {}) {
  const p = await point(page, target);
  await touch(page, 'touchStart', [p]);
  await sleep(hold);
  await touch(page, 'touchEnd', []);
}

/** Mouse drag from target to opts.to ({x,y}) or by opts.by ({dx,dy}) in `steps` moves over `ms`. touch:true drags with a finger. */
export async function drag(page, target, { to, by, steps = 12, ms = 240, touch: finger = false } = {}) {
  const a = await point(page, target);
  const b = to || { x: a.x + (by?.dx ?? 0), y: a.y + (by?.dy ?? 0) };
  const dt = ms / steps;
  if (finger) await touch(page, 'touchStart', [a]); else { await mouse(page, 'mouseMoved', a.x, a.y); await mouse(page, 'mousePressed', a.x, a.y, { button: 'left', buttons: 1, clickCount: 1 }); }
  for (let i = 1; i <= steps; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps };
    if (finger) await touch(page, 'touchMove', [p]); else await mouse(page, 'mouseMoved', p.x, p.y, { button: 'left', buttons: 1 });
    await sleep(dt);
  }
  if (finger) await touch(page, 'touchEnd', []); else await mouse(page, 'mouseReleased', b.x, b.y, { button: 'left', clickCount: 1 });
  return { from: a, to: b };
}

/** A fast drag that releases at speed (fling). dir {dx,dy} total px, over ms (default 90). Finger by default. */
export function flick(page, target, { dx = 0, dy = 0, ms = 90, touch: finger = true } = {}) {
  return drag(page, target, { by: { dx, dy }, steps: 6, ms, touch: finger });
}

/** Two-finger pinch about the target centre: from `from` px apart to `to` px apart, horizontally. */
export async function pinch(page, target, { from = 80, to = 200, steps = 10, ms = 300 } = {}) {
  const c = await point(page, target);
  const at = (d) => [{ x: c.x - d / 2, y: c.y }, { x: c.x + d / 2, y: c.y }];
  await touch(page, 'touchStart', at(from));
  for (let i = 1; i <= steps; i++) { await touch(page, 'touchMove', at(from + ((to - from) * i) / steps)); await sleep(ms / steps); }
  await touch(page, 'touchEnd', []);
}

/** Wheel at the target. opts {dx, dy, ctrl}: dy > 0 scrolls down / zooms out. */
export async function wheel(page, target, { dx = 0, dy = 0, ctrl = false } = {}) {
  const { x, y } = await point(page, target);
  await mouse(page, 'mouseMoved', x, y);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy, modifiers: ctrl ? 2 : 0 });
}

const KEYS = {
  Enter: { code: 'Enter', vk: 13, text: '\r' }, Tab: { code: 'Tab', vk: 9 }, Escape: { code: 'Escape', vk: 27 }, Backspace: { code: 'Backspace', vk: 8 },
  Delete: { code: 'Delete', vk: 46 }, ArrowLeft: { code: 'ArrowLeft', vk: 37 }, ArrowUp: { code: 'ArrowUp', vk: 38 }, ArrowRight: { code: 'ArrowRight', vk: 39 },
  ArrowDown: { code: 'ArrowDown', vk: 40 }, Home: { code: 'Home', vk: 36 }, End: { code: 'End', vk: 35 }, ' ': { code: 'Space', vk: 32, text: ' ' },
};
const keyInfo = (k) => {
  if (KEYS[k]) return { key: k, ...KEYS[k] };
  if (/^[0-9]$/.test(k)) return { key: k, code: 'Digit' + k, vk: 48 + +k, text: k };
  if (/^[a-z]$/i.test(k)) return { key: k, code: 'Key' + k.toUpperCase(), vk: k.toUpperCase().charCodeAt(0), text: k };
  return { key: k, code: '', vk: 0, text: k.length === 1 ? k : undefined };
};
const MOD = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

/** One key press (keyDown + keyUp). key is 'Enter', 'Tab', 'ArrowLeft', '5', 'a'...; opts.modifiers ['Shift', ...]. A target focuses it first. */
export async function key(page, target, k, { modifiers = [] } = {}) {
  if (typeof k !== 'string') throw new Error('input.key(page, target|null, key, opts)');
  if (target) await focus(page, target);
  const m = modifiers.reduce((a, n) => a | (MOD[n] || 0), 0);
  const i = keyInfo(k);
  const base = { key: i.key, code: i.code, windowsVirtualKeyCode: i.vk, nativeVirtualKeyCode: i.vk, modifiers: m };
  await page.send('Input.dispatchKeyEvent', { type: i.text && !m ? 'keyDown' : 'rawKeyDown', ...base, text: m ? undefined : i.text, unmodifiedText: m ? undefined : i.text });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

/** Focus by a real click at the element (so it behaves as for a person); {x,y} targets are clicked too. */
export async function focus(page, target) { await click(page, target); }

/** Type text one key at a time (digits and letters as key events, other characters via insertText). A target is clicked first. */
export async function type(page, target, text, { delay = 15 } = {}) {
  if (target) await focus(page, target);
  for (const ch of String(text)) {
    if (/^[0-9a-z]$/i.test(ch) || ch === ' ') await key(page, null, ch);
    else await page.send('Input.insertText', { text: ch });
    if (delay) await sleep(delay);
  }
}

export default { point, click, tap, drag, flick, pinch, wheel, type, key, focus };
