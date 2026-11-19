// W2-07 (Josh point 3, UX-3): the date range edits a draft. No browser: a tiny fake DOM stands in for the two inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as gz from '../../../site/js/pins/gazetteer.js';
import { createPins } from '../../../site/js/pins/index.js';
import { STORE_KEY } from '../../../site/js/contract.js';
import { createDraft, mountDateRange } from '../../../site/js/pins/daterange.js';

gz.setData(JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../../site/geo/cities.json', import.meta.url)), 'utf8')));
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };

// ---- fake DOM: elements with attributes, children, listeners; `value` assignments are logged ----
function fakeDoc() {
  const doc = { activeElement: null, writes: [] };
  doc.createElement = (tag) => {
    const el = { tag, ownerDocument: doc, children: [], attrs: {}, listeners: {}, className: '', textContent: '', _v: '',
      classList: { toggle(c, on) { const s = new Set(el.className.split(' ').filter(Boolean)); on ? s.add(c) : s.delete(c); el.className = [...s].join(' '); } },
      append(...k) { el.children.push(...k); }, remove() {},
      setAttribute(k, v) { (el.sets ||= []).push(k); el.attrs[k] = String(v); }, getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; }, removeAttribute(k) { delete el.attrs[k]; },
      addEventListener(ev, fn) { (el.listeners[ev] ||= []).push(fn); },
      fire(ev) { (el.listeners[ev] || []).forEach((fn) => fn({ target: el })); },
    };
    Object.defineProperty(el, 'value', { get: () => el._v, set: (v) => { doc.writes.push([el.attrs.name, v, doc.activeElement === el]); el._v = v; } });
    return el;
  };
  return doc;
}
const mount = (draft) => { const doc = fakeDoc(); const root = doc.createElement('div'); return { doc, ...mountDateRange(root, draft) }; };
// The person types into To: the platform reports a value on each event ('' while the date is partial).
const typeTo = (m, v) => { m.to._v = v; m.to.fire('input'); m.to.fire('change'); };

test('reducer replay of the audit sequence leaves the store untouched and the draft at 27 Nov to 2 Dec', async () => {
  const storage = mem();
  const pins = createPins({ storage, today: () => '2026-11-17' });
  const r = await pins.quickAdd('Trip: Tahoe Nov 27-30');
  const stored = storage.getItem(STORE_KEY);
  const draft = createDraft({ start: pins.get(r.id).start, end: pins.get(r.id).end });
  const m = mount(draft);
  m.doc.activeElement = m.to;
  for (const v of ['2026-01-30', '', '2026-01-30', '', '2026-12-22', '', '2026-12-02']) typeTo(m, v);
  assert.deepEqual(draft.value(), { start: '2026-11-27', end: '2026-12-02' });
  assert.equal(draft.valid().ok, true);
  assert.equal(storage.getItem(STORE_KEY), stored, 'the component never writes the store');
  assert.deepEqual([pins.get(r.id).start, pins.get(r.id).end], ['2026-11-27', '2026-11-30']);
  assert.equal(m.summary.textContent, 'Fri 27 Nov → Wed 2 Dec · 6 days');
});

test('end before start: valid() false, aria-invalid on To, message shown, neither value changed', () => {
  const draft = createDraft({ start: '2026-11-27', end: '2026-11-30' });
  const m = mount(draft);
  typeTo(m, '2026-01-30');
  assert.deepEqual(draft.valid(), { ok: false, message: 'Ends before it starts' });
  assert.equal(m.to.attrs['aria-invalid'], 'true');
  assert.equal(m.to.attrs['aria-describedby'], m.summary.id);
  assert.equal(m.summary.textContent, 'Ends before it starts');
  assert.deepEqual(draft.value(), { start: '2026-11-27', end: '2026-01-30' }, 'the end stays as typed; the start is not moved');
  assert.equal(m.from.value, '2026-11-27');
  typeTo(m, '2026-12-02');
  assert.equal(m.to.attrs['aria-invalid'], undefined);
});

test('summary line and To.min follow a complete From', () => {
  const draft = createDraft({ start: '2026-11-27', end: '2026-11-30' });
  const m = mount(draft);
  assert.equal(m.summary.textContent, 'Fri 27 Nov → Mon 30 Nov · 4 days');
  assert.equal(m.to.attrs.min, '2026-11-27');
  assert.equal(createDraft({ start: '2026-11-27', end: '2026-11-27' }).summary(), 'Fri 27 Nov → Fri 27 Nov · 1 day');
  assert.equal(draft.dirty(), false);
  draft.set('end', '2026-12-01'); assert.equal(draft.dirty(), true);
});

test('no code path assigns .value on the focused input', () => {
  const draft = createDraft({ start: '2026-11-27', end: '2026-11-30' });
  const m = mount(draft);
  m.doc.writes.length = 0;
  m.doc.activeElement = m.to;
  draft.set('end', '2026-12-09'); draft.set('start', '2026-11-01');
  m.refresh();
  typeTo(m, '2026-01-30');
  m.refresh();
  assert.ok(m.doc.writes.every(([, , focused]) => !focused), 'a write hit the focused input: ' + JSON.stringify(m.doc.writes));
  assert.equal(m.to.value, '2026-01-30', 'the focused input kept what the person typed');
  assert.equal(m.from.value, '2026-11-01', 'the unfocused one follows the draft');
});

test('typing does not re-set min or aria attributes that are unchanged (Chrome resets a date input\'s segments when they are)', () => {
  const m = mount(createDraft({ start: '2026-11-27', end: '2026-11-30' }));
  const n = () => (m.to.sets || []).filter((k) => k === 'min' || k.startsWith('aria-')).length;
  const base = n();
  for (const v of ['2026-12-30', '', '2026-12-02', '2026-12-03']) typeTo(m, v);
  assert.equal(n(), base);
});
