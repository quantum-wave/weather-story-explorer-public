// S-ADDFLOW (design spec 8.2, 8.5, 14.2 TEST-4, Josh points 2, 5, 10): the add and edit flow on the real shell, with real input.
// Opens the Add sheet, types into it, picks a suggestion, changes the kind, saves, edits, removes and undoes. Proves: one field then
// one structural expansion (the sheet height changes at most once while 8 characters go into City); "Tahoe" lists North Lake
// Tahoe, South Lake Tahoe and Lake Tahoe in the sheet and in the inline box and adds nothing until one is chosen; the inline
// "Trip: Tahoe Nov 27-30" opens the Add sheet with the place pending; nothing is stored until Save (typing never commits);
// a toast in #toasts overlaps no control; Remove is the danger button, confirmed inline, then Undo. The Add sheet is opened
// through the module's exported openAddSheet (the shell's own entry buttons belong to the layout packages); the edit sheet through
// the shell's own "..." button.
import * as inp from '../lib/input.mjs';
import { artifactPath } from '../lib/artifacts.mjs';
export const id = 'S-ADDFLOW';
export const freshProfile = true;
export const timeoutMs = 150000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = '.wse-sheet';

export async function run({ page, baseUrl, assert }) {
  const pinsNow = () => page.eval(`window.__wse.pins.all().map((p) => [p.kind, p.name, p.group, p.city.name, p.city.admin])`);
  const tripsNow = () => page.eval(`window.__wse.pins.trips().map((t) => [t.label, t.city.name, t.start, t.end])`);
  const openAdd = (o = {}) => page.eval(`(async () => { const m = await import('/js/pins/mount.js'); m.openAddSheet(${JSON.stringify(o)}); return true; })()`);
  const sheetUp = () => page.waitFor(`document.querySelector('${S}') && document.querySelector('.wse-sheet-root').dataset.state === 'open'`, { timeout: 6000 });
  const gone = () => page.waitFor(`!document.querySelector('.wse-sheet-root')`, { timeout: 4000 });
  const optionNames = () => page.eval(`[...document.querySelectorAll('${S} [role=option]')].map((b) => b.textContent)`);
  const height = () => page.eval(`document.querySelector('${S}').getBoundingClientRect().height`);
  // the pinned (target) height of the sheet, sampled every frame: counts the structural changes, not the frames of one animation
  const watchHeights = () => page.eval(`(() => { const p = document.querySelector('${S}'); window.__hs = [p.style.height]; const f = () => { const v = p.style.height; if (v !== window.__hs[window.__hs.length - 1]) window.__hs.push(v); if (!window.__hsStop) requestAnimationFrame(f); }; window.__hsStop = false; requestAnimationFrame(f); return true; })()`);
  const stopHeights = async () => { await page.eval(`window.__hsStop = true`); return page.eval(`window.__hs`); };

  // the sheet's body never scrolls while the sheet is below 92% of the viewport (no half-cut last field)
  const noOverflow = (what) => page.eval(`(() => { const p = document.querySelector('${S}'), b = p.querySelector('.wse-sheet-body'); const vh = window.visualViewport ? window.visualViewport.height : innerHeight; return { sh: b.scrollHeight, ch: b.clientHeight, sheet: p.getBoundingClientRect().height, vh }; })()`).then((m) => {
    if (m.sheet < 0.92 * m.vh - 2) assert.ok(m.sh <= m.ch, `${what}: body scrollHeight ${m.sh} > clientHeight ${m.ch} with the sheet at ${m.sheet} of ${m.vh}`);
  });
  // a toast at rest costs nothing: over 1 s with the page idle and the toast still up, no body child is added or removed and nothing
  // is hit-tested (round 4: placing the toast mutated body, which re-placed it, every frame for as long as it was shown)
  const idleCost = (what) => page.eval(`new Promise((done) => {
    let efp = 0, muts = 0; const o = document.elementFromPoint; document.elementFromPoint = function (x, y) { efp++; return o.call(document, x, y); };
    const mo = new MutationObserver((l) => { for (const r of l) muts += r.addedNodes.length + r.removedNodes.length; }); mo.observe(document.body, { childList: true });
    setTimeout(() => { mo.disconnect(); document.elementFromPoint = o; done({ efp, muts, shown: !!document.querySelector('#toasts .pn-toast') }); }, 1000); })`).then((c) => {
    assert.ok(c.shown, what + ': the toast is still shown through the 1 s window');
    assert.deepEqual([c.muts, c.efp], [0, 0], what + ': an idle toast adds or removes no body child and hit-tests nothing (body child changes, elementFromPoint calls per 1 s): ' + JSON.stringify(c));
  });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 30000 });
  await page.eval(`window.__wse.pins.clearAll()`);

  // 1. open small: the kind switch and one field, no labelled fields yet
  await openAdd(); await sheetUp();
  assert.equal(await page.eval(`document.querySelectorAll('${S} [data-f]').length`), 1, 'collapsed: one field');
  assert.equal(await page.eval(`!!document.querySelector('${S} [data-f=free]')`), true);
  assert.equal(await page.eval(`document.querySelector('${S} [data-action="save"]').disabled`), true, 'Add is disabled until there is something to add');
  const small = await height();
  // the placeholder fits its field on a small phone (it is the first thing a person sees)
  await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 2, mobile: true }); await sleep(250);
  const ph = await page.eval(`(() => { const i = document.querySelector('${S} [data-f=free]'); const cs = getComputedStyle(i); const c = document.createElement('canvas').getContext('2d'); c.font = cs.font; return { w: c.measureText(i.placeholder).width, avail: i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), text: i.placeholder }; })()`);
  assert.ok(ph.w <= ph.avail, `the placeholder "${ph.text}" (${Math.round(ph.w)} px) fits the field (${Math.round(ph.avail)} px) at 320 px wide`);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(250);

  // 2. type "Maya in Port": the sheet expands once into Name and City with the choice pending; nothing is stored
  await watchHeights();
  await inp.type(page, null, 'Maya in Port', { delay: 15 });
  await page.waitFor(`document.querySelector('${S} [data-f=city]')`, { timeout: 3000 });
  await sleep(500);
  assert.equal(await page.eval(`document.querySelector('${S} [data-f=name]').value`), 'Maya');
  assert.equal(await page.eval(`document.querySelector('${S} [data-f=city]').value`), 'Port', 'City is pre-filled from the parse');
  assert.ok((await height()) > small, 'the sheet expanded');
  assert.equal(await page.eval(`document.activeElement.dataset.f`), 'city', 'focus is in City');
  await noOverflow('after Maya in Port');
  const afterExpand = await stopHeights();
  assert.ok(afterExpand.length <= 2, 'one field, one structural expansion: heights ' + JSON.stringify(afterExpand));
  assert.deepEqual(await pinsNow(), [], 'nothing stored while typing');

  // 3. typing 8 characters into City changes the sheet height at most once; the list is a reserved area
  await page.eval(`(() => { const c = document.querySelector('${S} [data-f=city]'); c.value = ''; c.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await watchHeights();
  await inp.type(page, null, 'Portland', { delay: 40 });
  await sleep(400);
  const hs = await stopHeights();
  assert.ok(hs.length - 1 <= 1, 'typing 8 characters into City changed the height at most once: ' + JSON.stringify(hs));
  await noOverflow('Portland choices');
  const opts = await optionNames();
  assert.ok(opts.some((t) => /Portland.*OR/.test(t)) && opts.some((t) => /Portland.*ME/.test(t)), 'Portland, OR and Portland, ME are offered: ' + opts);
  assert.equal(await page.eval(`document.querySelector('${S} [data-action="save"]').disabled`), true, 'no place chosen: Add is disabled');
  assert.deepEqual(await pinsNow(), [], 'nothing stored: the place waits for a choice');
  await page.screenshot(artifactPath('S-ADDFLOW', 'choice-pending.png'));

  // 4. pick the suggestion, choose a group, change kind to Place and back, then Add
  await inp.click(page, `${S} [role=option][data-id]:first-child`);
  const picked = await page.eval(`document.querySelector('${S} [data-f=city]').value`);
  assert.match(picked, /^Portland, /);
  await sleep(350); // the sheet settles after its one contraction
  assert.equal(await page.eval(`document.querySelectorAll('${S} [role=option]').length`), 0, 'the list closes once a place is chosen');
  await inp.click(page, `${S} [data-kind-btn=place]`); await sleep(300);
  const nameLabel = await page.eval(`document.querySelector('${S} [data-f=name]').closest('label').textContent`);
  assert.match(nameLabel, /Place name/, 'the Place fields show');
  assert.equal(await page.eval(`document.querySelector('${S} [data-f=city]').value`), picked, 'changing kind keeps the chosen place');
  await inp.click(page, `${S} [data-kind-btn=person]`); await sleep(300);
  await inp.click(page, `${S} .pn-chip[data-group="friends"]`);
  assert.deepEqual(await pinsNow(), [], 'still nothing stored before Add');
  await inp.click(page, `${S} [data-action="save"]`);
  await gone();
  const p1 = await pinsNow();
  assert.equal(p1.length, 1); assert.deepEqual(p1[0].slice(0, 3), ['person', 'Maya', 'friends']);

  // 5. the toast: inside #toasts, covers no control, the new row is highlighted
  await page.waitFor(`document.querySelector('#toasts .pn-toast')`, { timeout: 3000 });
  const t = await page.eval(`(() => {
    const toast = document.querySelector('#toasts .pn-toast'); const r = toast.getBoundingClientRect();
    const hit = [...document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [role=slider]')].filter((e) => !toast.contains(e) && !e.closest('[inert]')).filter((e) => {
      const b = e.getBoundingClientRect(); if (b.width < 2 || b.height < 2) return false; const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top; }).map((e) => (e.getAttribute('aria-label') || e.textContent || e.id).trim().slice(0, 30));
    return { text: toast.textContent, hit, inRegion: toast.parentElement.id === 'toasts' }; })()`);
  assert.match(t.text, /Added Maya · Portland, /);
  assert.ok(t.inRegion, 'the toast mounts in #toasts');
  assert.deepEqual(t.hit, [], 'the toast overlaps no control: ' + t.hit);
  await page.waitFor(`!!document.querySelector('.person[data-pin].pn-new')`, { timeout: 4000 });
  await page.screenshot(artifactPath('S-ADDFLOW', 'added-phone.png'));
  await sleep(300); await idleCost('after Add, panel at peek');

  // 6. edit: typing does not commit; Save does
  const pid = await page.eval(`window.__wse.pins.all()[0].id`);
  await page.eval(`document.querySelector('button[aria-label="Edit Maya"]').click()`);
  await sheetUp();
  assert.equal(await page.eval(`document.getElementById(document.querySelector('${S}').getAttribute('aria-labelledby')).textContent`), 'Edit person');
  await inp.click(page, `${S} [data-f=name]`);
  await inp.key(page, null, 'End');
  await inp.type(page, null, ' R', { delay: 30 });
  await sleep(150);
  assert.equal((await pinsNow())[0][1], 'Maya', 'typing a new name is not committed until Save');
  await inp.click(page, `${S} [data-action="save"]`); await gone();
  assert.equal((await pinsNow())[0][1], 'Maya R', 'Save stores the edit');

  // 7. remove: the danger word, an inline confirm, then a 5 s Undo
  await page.eval(`document.querySelector('button[aria-label="Edit Maya R"]').click()`);
  await sheetUp();
  const dang = await page.eval(`(() => { const b = document.querySelector('${S} [data-action="remove"]'); return { kind: b.dataset.kind, text: b.textContent, color: getComputedStyle(b).color }; })()`);
  assert.equal(dang.kind, 'danger'); assert.equal(dang.text, 'Remove');
  await inp.click(page, `${S} [data-action="remove"]`); await sleep(300);
  assert.equal(await page.eval(`!document.querySelector('${S} [data-confirm]').hidden`), true, 'the confirm shows inline');
  assert.equal((await pinsNow()).length, 1, 'asking does not remove');
  await inp.click(page, `${S} [data-action="remove-confirm"]`); await gone();
  assert.equal((await pinsNow()).length, 0, 'removed');
  const rt = await page.eval(`(() => { const t = document.querySelector('#toasts .pn-toast'); return { text: t.textContent, ms: t.dataset.ms, undo: !!t.querySelector('[data-undo]') }; })()`);
  assert.match(rt.text, /Removed Maya R/); assert.equal(rt.ms, '5000'); assert.ok(rt.undo);
  await inp.click(page, '#toasts [data-undo]'); await sleep(200);
  assert.equal((await pinsNow()).length, 1, 'Undo restores it');

  // 8. "Tahoe" in the sheet: the three places, nothing added until one is chosen
  await openAdd({ kind: 'place' }); await sheetUp();
  await inp.click(page, `${S} [data-f=city]`);
  await inp.type(page, null, 'Tahoe', { delay: 30 }); await sleep(500);
  const tahoe = await optionNames();
  for (const want of ['North Lake Tahoe', 'South Lake Tahoe', 'Lake Tahoe']) assert.ok(tahoe.some((x) => x.startsWith(want)), `${want} is offered: ${tahoe}`);
  assert.ok(tahoe.some((x) => /region/.test(x)), 'curated entries say "region": ' + tahoe);
  await inp.key(page, null, 'Enter'); await sleep(200);
  assert.equal((await pinsNow()).length, 1, 'Enter with several matches adds nothing');
  assert.equal(await page.eval(`document.querySelector('${S} [data-action="save"]').disabled`), true);
  await page.screenshot(artifactPath('S-ADDFLOW', 'tahoe-choices.png'));
  await inp.key(page, null, 'Escape'); await sleep(200);
  await page.waitFor(`document.querySelector('${S} [data-action="discard"]') || !document.querySelector('.wse-sheet-root')`, { timeout: 3000 });
  if (await page.eval(`!!document.querySelector('${S} [data-action="discard"]')`)) await inp.click(page, `${S} [data-action="discard"]`);
  await gone();

  // 9. "Tahoe" in the inline box: the same choices, nothing added; Enter opens the sheet with the choice pending
  await inp.drag(page, '#sheet-handle', { by: { dx: 0, dy: -500 }, touch: true }); // the panel body is inert at peek: raise it like a person
  await sleep(700);
  const typeInline = async (text) => {
    await page.eval(`(() => { const ta = document.querySelector('#quickadd-host textarea'); ta.value = ''; ta.focus(); return true; })()`);
    await inp.type(page, null, text, { delay: 15 });
  };
  await typeInline('Tahoe'); await sleep(500);
  const inline = await page.eval(`[...document.querySelectorAll('#quickadd-host [role=option]')].map((b) => b.textContent)`);
  for (const want of ['North Lake Tahoe', 'South Lake Tahoe', 'Lake Tahoe']) assert.ok(inline.some((x) => x.startsWith(want)), `inline: ${want} is offered: ${inline}`);
  assert.equal((await pinsNow()).length, 1, 'the inline box adds nothing for a bare Tahoe');
  await inp.key(page, null, 'Enter'); await sheetUp(); await sleep(400);
  assert.equal((await pinsNow()).length, 1, 'Enter on an ambiguous place opens the sheet, adds nothing');
  assert.equal(await page.eval(`document.querySelector('${S} [data-f=city]').value`), 'Tahoe', 'the sheet opens with the place pending');
  assert.ok((await optionNames()).length >= 3, 'with the choices listed');
  await page.eval(`window.__wse && document.querySelector('.wse-sheet-root') && (document.querySelector('${S} .wse-sheet-close').click())`);
  await sleep(300);
  if (await page.eval(`!!document.querySelector('${S} [data-action="discard"]')`)) await inp.click(page, `${S} [data-action="discard"]`);
  await gone();

  // 9b. "North Lake Tahoe" in the inline box (Josh point 2): the box shows the one place it found before anything is added, and
  // Enter adds exactly that place. (Before: the list went blank from "North Lake T" on, so the place looked missing.)
  await typeInline('North Lake Tahoe'); await sleep(500);
  const nlt = await page.eval(`[...document.querySelectorAll('#quickadd-host [role=option]')].map((b) => b.textContent)`);
  assert.equal(nlt.length, 1, 'one settled place is shown for "North Lake Tahoe": ' + nlt);
  assert.ok(nlt[0].startsWith('North Lake Tahoe') && /CA/.test(nlt[0]) && /region/.test(nlt[0]), 'it is North Lake Tahoe, CA, a region: ' + nlt);
  assert.equal((await pinsNow()).length, 1, 'showing it adds nothing');
  await page.screenshot(artifactPath('S-ADDFLOW', 'inline-north-lake-tahoe.png'));
  await inp.key(page, null, 'Enter'); await sleep(500);
  const nltPins = await pinsNow();
  assert.equal(nltPins.length, 2, 'Enter adds it');
  assert.deepEqual(nltPins.find((p) => p[0] === 'place').slice(3), ['North Lake Tahoe', 'CA'], 'the added place is North Lake Tahoe, CA');

  // 10. inline "Trip: Tahoe Nov 27-30": the Add sheet opens on Trip with the dates filled and the place pending; nothing stored
  await typeInline('Trip: Tahoe Nov 27-30'); await sleep(300);
  await inp.key(page, null, 'Enter'); await sheetUp(); await sleep(400);
  assert.equal(await page.eval(`document.querySelector('${S} [data-kind-btn=trip][aria-pressed=true]') !== null`), true, 'the Trip kind is on');
  assert.match(await page.eval(`document.querySelector('${S} input[name=from]').value`), /^\d{4}-11-27$/);
  assert.match(await page.eval(`document.querySelector('${S} input[name=to]').value`), /^\d{4}-11-30$/);
  assert.equal(await page.eval(`document.querySelector('${S} [data-action="save"]').disabled`), true, 'the place is still a choice: Add is disabled');
  assert.deepEqual(await tripsNow(), [], 'no trip stored');
  await inp.click(page, `${S} [role=option]:first-child`); await sleep(300);
  assert.equal(await page.eval(`document.querySelector('${S} [data-action="save"]').disabled`), false);
  await page.screenshot(artifactPath('S-ADDFLOW', 'trip-sheet.png'));
  await inp.click(page, `${S} [data-action="save"]`); await gone();
  const trips = await tripsNow();
  assert.equal(trips.length, 1); assert.equal(trips[0][0], 'Tahoe');
  // the box that opened the sheet is cleared once the sheet adds: no stale text and no stale choice one tap from a duplicate
  await sleep(400);
  const box = await page.eval(`(() => ({ text: document.querySelector('#quickadd-host textarea').value, options: document.querySelectorAll('#quickadd-host [role=option]').length, trips: window.__wse.pins.trips().length }))()`);
  assert.equal(box.text, '', 'the inline box is empty after the sheet it opened adds: ' + JSON.stringify(box.text));
  assert.equal(box.options, 0, 'no inline place choices remain after the sheet adds');
  assert.equal(box.trips, 1, 'one trip, not two');
  // the toast after this save, with the panel still raised over the map tools (the main phone add path): the step-5 hit-test,
  // kept to the controls a person can actually see there (elementFromPoint with the toast hidden), so a control covered by the
  // raised panel does not count and the panel's own handle does
  await page.waitFor(`document.querySelector('#toasts .pn-toast')`, { timeout: 3000 });
  const raised = await page.eval(`(() => {
    const toast = document.querySelector('#toasts .pn-toast'); const r = toast.getBoundingClientRect();
    const hit = [...document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [role=slider], #timeline')].filter((e) => !toast.contains(e) && !e.closest('[inert]')).filter((e) => {
      const b = e.getBoundingClientRect(); if (b.width < 2 || b.height < 2) return false; const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top; });
    const region = document.getElementById('toasts'); region.style.visibility = 'hidden';
    const seen = hit.filter((e) => { const b = e.getBoundingClientRect();
      const x0 = Math.max(b.left, r.left), x1 = Math.min(b.right, r.right), y0 = Math.max(b.top, r.top), y1 = Math.min(b.bottom, r.bottom);
      for (let y = y0 + 1; y < y1; y += 4) for (let x = x0 + 1; x < x1; x += 4) { const u = document.elementFromPoint(x, y); if (u && (u === e || e.contains(u))) return true; }
      return false; }).map((e) => (e.id || e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30) + ' ' + JSON.stringify([b2(e)]));
    function b2(e) { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; }
    region.style.visibility = '';
    return { text: toast.textContent, toast: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], seen,
      handle: document.getElementById('sheet-handle').getBoundingClientRect().top }; })()`);
  assert.match(raised.text, /Added trip Tahoe/);
  assert.ok(raised.handle < 300, 'the panel is still raised: handle top ' + raised.handle);
  assert.deepEqual(raised.seen, [], 'with the panel raised, the toast ' + JSON.stringify(raised.toast) + ' covers no visible control: ' + raised.seen);
  await page.screenshot(artifactPath('S-ADDFLOW', 'toast-panel-raised.png'));
  await sleep(300); await idleCost('after Add, panel raised');

  // 11. desktop (Josh point 2): at 1440x900 the quick-add box rests at the bottom edge of the left panel. A person clicks it at the
  // page's resting scroll and types; every match row it lists must be on screen and hit-test to itself. (Before: the rows were drawn
  // at top 906 and below, past innerHeight 900, so "North Lake Tahoe" looked as if it did not exist.)
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 30000 });
  await page.eval(`window.__wse.pins.clearAll()`); await sleep(500); // a first visit: no pins, so the box sits where the reviewer found it
  const pinsBefore = (await pinsNow()).length;
  // W3-06's home sections can put the Add section below the panel's fold at its resting scroll; then a person scrolls the panel
  // until the box sits at its bottom edge, which is the same hard case (the match rows have no room below the box)
  const rest = await page.eval(`(() => { const body = document.getElementById('home-body'); const start = body.scrollTop;
    const ta = document.querySelector('#quickadd-host textarea'); const edge = Math.min(innerHeight, body.getBoundingClientRect().bottom);
    const below = ta.getBoundingClientRect().bottom - edge; if (below > 0) body.scrollTop += Math.ceil(below) + 4;
    const b = ta.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: innerHeight, start, scroll: body.scrollTop }; })()`);
  assert.equal(rest.start, 0, 'the panel starts at its resting scroll: ' + JSON.stringify(rest));
  assert.ok(rest.bottom <= rest.vh && rest.top > rest.vh - 120, 'the box rests at the bottom edge of the panel: ' + JSON.stringify(rest));
  const rowsSeen = () => page.eval(`[...document.querySelectorAll('#quickadd-host [role=option]')].map((o) => { const b = o.getBoundingClientRect(); const e = document.elementFromPoint(b.left + 10, b.top + b.height / 2); return { text: o.textContent, top: Math.round(b.top), bottom: Math.round(b.bottom), hit: !!(e && o.contains(e)) && b.bottom <= innerHeight }; })`);
  for (const [text, want] of [['North Lake Tahoe', ['North Lake Tahoe']], ['Tahoe', ['North Lake Tahoe', 'South Lake Tahoe', 'Lake Tahoe']]]) {
    await page.eval(`(() => { const ta = document.querySelector('#quickadd-host textarea'); ta.value = ''; ta.dispatchEvent(new Event('input')); ta.blur(); return true; })()`);
    await sleep(200);
    const at = await page.eval(`(() => { const b = document.querySelector('#quickadd-host textarea').getBoundingClientRect(); return { x: b.left + 20, y: Math.min(b.top + 10, innerHeight - 4) }; })()`);
    await inp.click(page, at);
    await inp.type(page, null, text, { delay: 15 }); await sleep(700);
    const rows = await rowsSeen();
    for (const w of want) assert.ok(rows.some((r) => r.text.startsWith(w)), `desktop "${text}": ${w} is listed: ` + JSON.stringify(rows));
    assert.deepEqual(rows.filter((r) => !r.hit), [], `desktop "${text}": every match row is on screen (innerHeight 900) and hit-tests to itself: ` + JSON.stringify(rows));
    assert.ok(await page.eval(`(() => { const b = document.querySelector('#quickadd-host textarea').getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; })()`), `desktop "${text}": the box itself stays on screen`);
    await page.screenshot(artifactPath('S-ADDFLOW', `desktop-inline-${text.replace(/ /g, '-')}.png`));
  }
  assert.equal((await pinsNow()).length, pinsBefore, 'typing on desktop adds nothing');
  await page.eval(`(() => { const ta = document.querySelector('#quickadd-host textarea'); ta.value = ''; ta.dispatchEvent(new Event('input')); ta.blur(); return true; })()`);
  await sleep(200);

  // desktop: the same flow's sheet is a 420 px dialog
  await sleep(300);
  await openAdd({ kind: 'person' }); await sheetUp();
  const w = await page.eval(`document.querySelector('${S}').getBoundingClientRect().width`);
  assert.ok(Math.abs(w - 420) < 2, 'desktop dialog is 420 px wide: ' + w);
  await page.screenshot(artifactPath('S-ADDFLOW', 'add-desktop.png'));
  assert.deepEqual(page.errors(), [], JSON.stringify(page.errors()));
}
