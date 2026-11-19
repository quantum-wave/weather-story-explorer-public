// Small helpers the stops share. Every one reaches its state the way a person does (input.mjs); none sets state directly.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The sheet's snap point as the app reports it. Reading state to check a stop did what it says is fine (14.1 rule 3). */
export const snapOf = (page) => page.eval(`document.getElementById('app')?.dataset.snap || ''`);

/** Phone: drag the sheet handle up (negative dy) or down until the sheet reports `want`. Desktop: a no-op (the panel is docked). */
export async function dragSheet(page, inp, want, dy) {
  if (!inp.phone) return;
  await inp.drag('#sheet-handle', { by: { dx: 0, dy } });
  await sleep(700);
  const got = await snapOf(page);
  if (got !== want) throw new Error(`dragging the sheet handle by ${dy}px left the sheet at "${got}", expected "${want}"`);
}

/** Throw unless `selector` has a visible box: a stop that did not reach its state must fail rather than screenshot the wrong thing. */
export async function mustBeVisible(page, selector, what) {
  const ok = await page.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`);
  if (!ok) throw new Error(`expected ${what || selector} to be on screen`);
}

/** Open quick add from the empty "people" row and type `text`, the way a person does (the field takes focus when opened). */
export async function openQuickAddAndType(page, inp, selector, text) {
  await inp.activate(selector);
  await sleep(400);
  await inp.type(null, text, { delay: 12 });
  await sleep(500);
}

/**
 * Type digits (MMDDYYYY) into a native date field with real key events. Measured finding (W1-01): with Emulation touch emulation
 * on, the same key events leave a date input empty; with it off they set it. So typing happens with touch emulation off for the
 * duration of the typing, and is switched back on after. The field is clicked at its left edge, the month segment.
 */
export async function typeDate(page, inp, selector, digits) {
  const touchOn = inp.phone;
  if (touchOn) await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  try {
    const r = await page.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' }); return true; })()`);
    await sleep(250);
    const p = await page.eval(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: b.left + 14, y: b.top + b.height / 2 }; })()`);
    await inp.click(p);
    await inp.type(null, digits, { delay: 25 });
  } finally { if (touchOn) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); }
  return page.eval(`document.querySelector(${JSON.stringify(selector)}).value`);
}
