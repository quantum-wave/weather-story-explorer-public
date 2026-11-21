// S-PINS (SPEC section 13): `Maya in Portland, OR` adds a person in Portland, OR; a settled trip line adds a trip (a bare `Portland` or
// `Tahoe` never adds: S-ADDFLOW);
// reload keeps both; copy all -> clear -> paste restores them. Driven through the real quick-add field, toast, edit sheet,
// panel and press-and-hold, mounted into a test container so it does not depend on the shell's layout.
import fs from 'node:fs';
import { artifactPath } from '../lib/artifacts.mjs';
export const id = 'S-PINS';
export const tier = 'full';
export const freshProfile = true;
export const timeoutMs = 90000;

export async function run({ page, baseUrl, assert }) {
  const boot = async () => {
    await page.goto(baseUrl);
    await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 15000 });
  };
  const mount = () => page.eval(`(async () => {
    const m = await import('/js/pins/mount.js');
    document.getElementById('pn-test')?.remove();
    const box = document.createElement('div'); box.id = 'pn-test'; box.style.cssText = 'position:fixed;left:0;top:0;width:100%;padding:12px;z-index:50;background:#12171c';
    document.body.append(box);
    const qa = document.createElement('div'); const panel = document.createElement('div'); box.append(qa, panel);
    window.__pnui = m.mountPins({ canvas: document.getElementById('map'), renderer: window.__wse.renderer, quickAddEl: qa, panelEl: panel });
    window.__pnm = m;
    return true; })()`);
  const type = (text, enter = true) => page.eval(`(() => {
    const ta = document.querySelector('#pn-test textarea'); ta.focus(); ta.value = ${JSON.stringify(text)};
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ${enter ? "ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));" : ''}
    return true; })()`);
  const toastText = () => page.eval(`document.querySelector('.pn-toast')?.textContent || ''`);

  await page.setViewport(375, 812, 2);
  await boot();
  await page.eval(`localStorage.clear()`);
  await boot();
  await mount();
  assert.equal(await page.eval(`window.__wse.pins.all().length + window.__wse.pins.trips().length`), 0, 'a fresh profile starts with no pins');

  // 1. Person.
  await type('Maya in Portland, OR');
  await page.waitFor(`document.querySelector('.pn-toast')`, { timeout: 5000 });
  assert.match(await toastText(), /Added Maya · Portland, OR/);
  let p = await page.eval(`window.__wse.pins.all()`);
  assert.equal(p.length, 1);
  assert.deepEqual([p[0].kind, p[0].name, p[0].city.name, p[0].city.admin], ['person', 'Maya', 'Portland', 'OR']);
  assert.equal(await page.eval(`document.querySelector('#pn-test textarea').value`), '', 'the field clears after an add');

  // 2. Group chip in the toast; 44 px targets; toast inside the phone viewport, measured at rest (after its 200 ms pn-rise,
  // whose translateY(8px) start would otherwise put a bottom-placed toast up to 8 px past the edge for one sample)
  await page.waitFor(`(() => { const t = document.querySelector('.pn-toast'); return !!t && t.getAnimations().every((a) => a.playState !== 'running'); })()`, { timeout: 3000 });
  const geo = await page.eval(`(() => {
    const t = document.querySelector('.pn-toast').getBoundingClientRect();
    const small = [...document.querySelectorAll('.pn-toast button, .pn-toast .pn-chip, #pn-test button')].filter((b) => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 43.5).map((b) => b.textContent);
    return { inside: t.left >= 0 && t.right <= innerWidth && t.bottom <= innerHeight && t.top >= 0, small, chips: [...document.querySelectorAll('.pn-toast .pn-chip')].map((c) => c.textContent) };
  })()`);
  assert.ok(geo.inside, 'toast fits a 375 px viewport');
  assert.deepEqual(geo.small, [], 'every button is at least 44 px tall: ' + geo.small);
  assert.deepEqual(geo.chips, [], 'the group is chosen in the sheet, not in the toast');
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('.pn-toast button')].map((b) => b.textContent)`), ['Edit', 'Undo']);
  await page.eval(`window.__wse.pins.update(window.__wse.pins.all()[0].id, { group: 'friends' })`);

  // 3. A settled trip line adds a trip; dates roll to a future year when needed.
  await type('Trip: Tahoe in South Lake Tahoe, CA Nov 27-30');
  await page.waitFor(`window.__wse.pins.trips().length === 1`, { timeout: 5000 });
  const t = (await page.eval(`window.__wse.pins.trips()`))[0];
  assert.equal(t.city.name, 'South Lake Tahoe');
  assert.equal(t.label, 'Tahoe');
  const now = new Date(); const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const year = iso > `${now.getFullYear()}-11-30` ? now.getFullYear() + 1 : now.getFullYear();
  assert.deepEqual([t.start, t.end], [`${year}-11-27`, `${year}-11-30`]);

  // 4. No match keeps the text and says what to do.
  await type('Zork in Nowhereville');
  await page.waitFor(`document.querySelector('#pn-test .pn-msg')?.textContent.includes('No place called')`, { timeout: 5000 });
  assert.match(await page.eval(`document.querySelector('#pn-test .pn-msg').textContent`), /No place called Nowhereville\. Try a nearby town or press and hold the map\./);
  assert.equal(await page.eval(`document.querySelector('#pn-test textarea').value`), 'Zork in Nowhereville', 'the field stays open');
  await type('');

  // 5. Reload keeps both.
  await boot();
  assert.deepEqual(await page.eval(`[window.__wse.pins.all().length, window.__wse.pins.trips().length, window.__wse.pins.all()[0].group]`), [1, 1, 'friends']);
  await mount();

  // 6. Copy all -> clear -> paste (a real paste event with several lines) restores them.
  const text = await page.eval(`window.__wse.pins.copyAllText()`);
  assert.equal(text.split('\n').length, 2);
  await page.eval(`window.__wse.pins.clearAll()`);
  assert.equal(await page.eval(`window.__wse.pins.all().length + window.__wse.pins.trips().length`), 0);
  await page.eval(`(() => {
    const ta = document.querySelector('#pn-test textarea'); ta.focus();
    const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(text)});
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  })()`);
  await page.waitFor(`window.__wse.pins.all().length === 1 && window.__wse.pins.trips().length === 1`, { timeout: 5000 });
  assert.equal(await page.eval(`window.__wse.pins.copyAllText()`), text, 'the restored pins serialise identically');
  assert.match(await page.eval(`document.querySelector('#pn-test .pn-msg').textContent`), /Added 2/);

  // 7. Panel: Copy all works or falls back to a box with the text.
  await page.eval(`document.querySelector('#pn-test [data-card="transfer"] [data-act="copy"]').click()`);
  await page.waitFor(`document.querySelector('#pn-test .pn-panel .pn-msg')?.textContent.length > 0`, { timeout: 5000 });
  const panelMsg = await page.eval(`document.querySelector('#pn-test .pn-panel .pn-msg').textContent`);
  assert.match(panelMsg, /Copied 2 lines|blocked copying/);

  // 8. Edit sheet (the one sheet): rename and change group, nothing stored until Save; Remove confirms inline, then Undo.
  const pid = await page.eval(`window.__wse.pins.all()[0].id`);
  await page.eval(`window.__pnm.openEditSheet(${JSON.stringify(pid)})`);
  await page.waitFor(`document.querySelector('.wse-sheet-root')?.dataset.state === 'open'`, { timeout: 5000 });
  await page.eval(`(() => { const i = document.querySelector('.wse-sheet [data-f=name]'); i.value = 'Maya R'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  assert.equal(await page.eval(`window.__wse.pins.all()[0].name`), 'Maya', 'typing does not commit');
  await page.eval(`document.querySelector('.wse-sheet .pn-chip[data-group="work"]').click()`);
  await page.eval(`document.querySelector('.wse-sheet [data-action="save"]').click()`);
  await page.waitFor(`!document.querySelector('.wse-sheet-root')`, { timeout: 4000 });
  assert.deepEqual(await page.eval(`[window.__wse.pins.all()[0].name, window.__wse.pins.all()[0].group]`), ['Maya R', 'work'], 'Save stores the edit');
  await page.eval(`window.__pnm.openEditSheet(${JSON.stringify(pid)})`);
  await page.waitFor(`document.querySelector('.wse-sheet-root')?.dataset.state === 'open'`, { timeout: 5000 });
  await page.eval(`document.querySelector('.wse-sheet [data-action="remove"]').click()`);
  await page.eval(`document.querySelector('.wse-sheet [data-action="remove-confirm"]').click()`);
  await page.waitFor(`!document.querySelector('.wse-sheet-root')`, { timeout: 4000 });
  assert.equal(await page.eval(`window.__wse.pins.all().length`), 0);
  assert.match(await toastText(), /Removed Maya R/);
  await page.eval(`document.querySelector('.pn-toast [data-undo]').click()`);
  assert.equal(await page.eval(`window.__wse.pins.all().length`), 1, 'Undo restores the pin');

  // 9. Press and hold on the map adds a place at the nearest gazetteer city (and a quick move does not).
  const before = await page.eval(`window.__wse.pins.all().length`);
  const fire = (type, x, y) => page.eval(`document.getElementById('map').dispatchEvent(new PointerEvent('${type}', { pointerId: 7, pointerType: 'touch', clientX: ${x}, clientY: ${y}, bubbles: true, isPrimary: true }))`);
  const r = await page.eval(`(() => { const r = document.getElementById('map').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height * 0.7]; })()`);
  await fire('pointerdown', r[0], r[1]);
  await fire('pointermove', r[0] + 7, r[1]);
  await new Promise((res) => setTimeout(res, 800));
  assert.equal(await page.eval(`window.__wse.pins.all().length`), before, 'moving more than 6 px cancels the hold');
  await fire('pointerup', r[0] + 7, r[1]);
  await fire('pointerdown', r[0], r[1]);
  await fire('pointermove', r[0] + 5, r[1]); // within 6 px: still a hold
  await new Promise((res) => setTimeout(res, 800));
  await fire('pointerup', r[0] + 5, r[1]);
  await page.waitFor(`window.__wse.pins.all().length === ${before + 1}`, { timeout: 5000 });
  const placed = (await page.eval(`window.__wse.pins.all()`)).find((x) => x.kind === 'place');
  assert.ok(placed && placed.city.name, 'a place at a gazetteer city');
  assert.match(await toastText(), /Added /);

  const shot = artifactPath('S-PINS', 'phone.png');
  await page.screenshot(shot);
  assert.ok(fs.existsSync(shot), 'the screenshot is written under $WSE_ARTIFACTS');
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
  assert.deepEqual(page.externalRequests, []);
}
