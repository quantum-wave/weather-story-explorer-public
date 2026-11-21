// S-DATES (design spec 8.3 and 14.3, Josh point 3): the trip date fields work like normal date fields. Real key events are typed
// into the real <input type="date"> inside the edit sheet, one key at a time, and the pin store is read after every key.
// Asserts: nothing is written until Save (the store never changes mid-typing); an end before the start shows "Ends before it
// starts", marks To invalid, disables Save and moves neither date; a valid typed range shows its summary and Save stores exactly
// that range; Cancel (Escape then Discard) stores nothing. Runs at phone and desktop width. Touch emulation is off while typing
// (the W1-01 finding in tests/visual/lib/steps.mjs typeDate: with it on, key events leave a date input empty).
import * as inp from '../lib/input.mjs';
export const id = 'S-DATES';
export const freshProfile = true;
export const timeoutMs = 120000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CITY = { id: 5397664, name: 'South Lake Tahoe', admin: 'CA', cc: 'US', lat: 38.93, lon: -119.98 };

export async function run({ page, baseUrl, assert }) {
  const trip = () => page.eval(`(() => { const t = window.__wse.pins.trips()[0]; return t ? [t.label, t.start, t.end] : null; })()`);
  const val = (sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).value`);
  const SHEET = '.wse-sheet';
  for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
    const tag = mobile ? 'phone' : 'desktop';
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await page.goto(baseUrl);
    await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 30000 });
    await page.eval(`(() => { const p = window.__wse.pins; p.clearAll(); p.addTrip({ label: 'Tahoe', city: ${JSON.stringify(CITY)}, start: '2026-12-20', end: '2026-12-22' }); })()`);
    const orig = ['Tahoe', '2026-12-20', '2026-12-22'];
    assert.deepEqual(await trip(), orig, tag + ': the trip is stored');
    const open = async () => {
      await page.eval(`(async () => { const m = await import('/js/pins/mount.js'); m.openEditSheet(window.__wse.pins.trips()[0].id); })()`);
      await page.waitFor(`document.querySelector('${SHEET} input[type=date]')`, { timeout: 8000 });
      await sleep(300);
    };
    const to = `${SHEET} input[name=to]`, from = `${SHEET} input[name=from]`;
    const typeInto = async (sel, digits, watch) => {
      await page.eval(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`);
      const p = await page.eval(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.left + 14, y: b.top + b.height / 2 }; })()`);
      await inp.click(page, p);
      for (const d of digits) {
        await inp.key(page, null, d);
        await sleep(25);
        if (watch) assert.deepEqual(await trip(), orig, `${tag}: after typing "${d}" the store is still untouched`);
      }
    };

    // 1. end before start: message, invalid, Save disabled, nothing moved, nothing stored (checked after every key)
    await open();
    await typeInto(to, '12192026', true);
    assert.equal(await val(to), '2026-12-19', tag + ': the typed end is left exactly as typed');
    assert.equal(await val(from), '2026-12-20', tag + ': the start did not move');
    const bad = await page.eval(`(() => { const t = document.querySelector(${JSON.stringify(to)}); const s = document.querySelector('${SHEET} .dr-summary');
      return { msg: s.textContent, invalid: t.getAttribute('aria-invalid'), described: t.getAttribute('aria-describedby') === s.id, save: document.querySelector('${SHEET} [data-action="save"]').disabled }; })()`);
    assert.equal(bad.msg, 'Ends before it starts', tag + ': the message');
    assert.equal(bad.invalid, 'true'); assert.ok(bad.described, 'the message is the field description'); assert.equal(bad.save, true, tag + ': Save is disabled');
    assert.deepEqual(await trip(), orig, tag + ': nothing stored for an inverted range');

    // 2. a valid typed range: the summary reads it, Save is enabled, the store is still untouched until Save, then it holds the range
    await typeInto(to, '12242026', true);
    assert.equal(await val(to), '2026-12-24');
    const good = await page.eval(`({ msg: document.querySelector('${SHEET} .dr-summary').textContent, save: document.querySelector('${SHEET} [data-action="save"]').disabled, invalid: document.querySelector(${JSON.stringify(to)}).getAttribute('aria-invalid') })`);
    assert.equal(good.msg, 'Sun 20 Dec → Thu 24 Dec · 5 days'); assert.equal(good.save, false); assert.equal(good.invalid, null);
    await inp.click(page, `${SHEET} [data-action="save"]`);
    await page.waitFor(`!document.querySelector('.wse-sheet-root')`, { timeout: 4000 });
    assert.deepEqual(await trip(), ['Tahoe', '2026-12-20', '2026-12-24'], tag + ': Save stores the typed range');

    // 3. cancel stores nothing: type a new end, Escape asks once, Discard leaves the stored range
    await open();
    await typeInto(to, '12282026', true === false);
    await inp.key(page, null, 'Escape');
    await page.waitFor(`document.querySelector('${SHEET} [data-action="discard"]')`, { timeout: 3000 });
    await inp.click(page, `${SHEET} [data-action="discard"]`);
    await page.waitFor(`!document.querySelector('.wse-sheet-root')`, { timeout: 4000 });
    assert.deepEqual(await trip(), ['Tahoe', '2026-12-20', '2026-12-24'], tag + ': cancelling stores nothing');
  }
  assert.deepEqual(page.errors(), [], JSON.stringify(page.errors()));
}
