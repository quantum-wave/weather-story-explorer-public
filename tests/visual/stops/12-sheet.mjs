// Tour stop 12: the one sheet (W2-08, Josh points 5, 10). No UI path opens a sheet yet (W3-07 wires add and edit), so the stop mounts
// one from a test-only harness evaluated in the page, with an Edit-trip form in it as design spec 11.4 draws it, then asks it to
// discard a dirty draft. Gated from the start: an open modal scopes the layout assertions to the sheet's own content.
import { mustBeVisible } from '../lib/steps.mjs';

const FORM = `(() => {
  const st = document.createElement('style');
  st.textContent = '.t-f{display:flex;flex-direction:column;gap:4px;margin:0 0 12px}.t-f label{font:600 12px/16px -apple-system,system-ui,sans-serif;color:var(--text-2,#A3ACB7)}'
    + '.t-f input{box-sizing:border-box;width:100%;min-height:44px;padding:0 12px;font:16px/20px -apple-system,system-ui,sans-serif;color:inherit;background:transparent;border:1px solid var(--hairline,#2A3038);border-radius:8px}'
    + '.t-sum{margin:0;font:13px/18px -apple-system,system-ui,sans-serif;color:var(--text-2,#A3ACB7)}';
  document.head.append(st);
  const c = document.createElement('div');
  const field = (id, label, value) => { const d = document.createElement('div'); d.className = 't-f'; const l = document.createElement('label'); l.htmlFor = id; l.textContent = label; const i = document.createElement('input'); i.id = id; i.value = value; d.append(l, i); return d; };
  const sum = document.createElement('p'); sum.className = 't-sum'; sum.textContent = 'Fri 27 Nov to Mon 30 Nov, 4 days';
  c.append(field('t-label', 'Label', 'Tahoe'), field('t-where', 'Where', 'North Lake Tahoe, CA'), field('t-from', 'From', 'Fri 27 Nov 2026'), field('t-to', 'To', 'Mon 30 Nov 2026'), sum);
  return c;
})()`;

export default {
  id: '12-sheet',
  owner: 'W2-08',
  gate: true,
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run(page, inp, { snap }) {
    await page.eval(`(async () => {
      const m = await import(new URL('js/ui/sheet.js', document.baseURI).href);
      window.__dirty = false;
      window.__s = m.openSheet({ title: 'Edit trip', content: ${FORM},
        actions: [{ id: 'remove', label: 'Remove', kind: 'danger', onClick() {} }, { id: 'cancel', label: 'Cancel', onClick: (s) => s.close('cancel') }, { id: 'save', label: 'Save', kind: 'primary', onClick: (s) => s.close('save') }],
        isDirty: () => window.__dirty });
      await window.__s.ready;
    })()`);
    await mustBeVisible(page, '.wse-sheet', 'the sheet');
    await snap('edit-trip');
    // a dirty draft: a close request asks once, inline
    await page.eval(`window.__dirty = true`);
    await inp.activate('.wse-sheet-close');
    await page.waitFor(`document.querySelector('.wse-sheet-confirm') && !document.querySelector('.wse-sheet-confirm').hidden`, { timeout: 5000 });
    await mustBeVisible(page, '.wse-sheet-confirm', 'the discard confirm');
    await snap('discard');
  },
};
