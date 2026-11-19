// WP3 keys: Space, arrows, 1 2 3; ignored while typing or with modifiers; Space on a button is the button's own.
import test from 'node:test';
import assert from 'node:assert/strict';

const { store } = await import(new URL('../../../site/js/state.js', import.meta.url).href);
const clock = await import(new URL('../../../site/js/time/clock.js', import.meta.url).href);
const { handleKey, installKeys } = await import(new URL('../../../site/js/time/keys.js', import.meta.url).href);
clock.configure({
  now: () => 0, raf: () => 1, caf: () => {}, reduced: () => true,
  src: { fieldSteps: () => [0, 6, 12, 18], caseOf: () => null, ensure: async () => {} },
});
clock.refresh();
const ev = (key, target = { tagName: 'BODY' }, extra = {}) => ({ key, code: key === ' ' ? 'Space' : key, target, prevented: false, preventDefault() { this.prevented = true; }, ...extra });

test('Space toggles play and is prevented (no page scroll)', () => {
  store._reset();
  const e = ev(' '); assert.equal(handleKey(e), true); assert.equal(store.get().playing, true); assert.equal(e.prevented, true);
  handleKey(ev(' ')); assert.equal(store.get().playing, false);
});
test('arrows step one data step', async () => {
  store._reset(); clock.refresh();
  handleKey(ev('ArrowRight')); await Promise.resolve(); await Promise.resolve();
  assert.equal(store.get().t, 6);
  handleKey(ev('ArrowLeft')); await Promise.resolve(); await Promise.resolve();
  assert.equal(store.get().t, 0);
});
test('1 2 3 switch the view', () => {
  store._reset();
  handleKey(ev('2')); assert.equal(store.get().view, 'nh');
  handleKey(ev('3')); assert.equal(store.get().view, 'gl');
  handleKey(ev('1')); assert.equal(store.get().view, 'np');
});
test('nothing fires while typing, with modifiers, or for other keys', () => {
  store._reset();
  assert.equal(handleKey(ev(' ', { tagName: 'INPUT' })), false);
  assert.equal(handleKey(ev('2', { tagName: 'TEXTAREA' })), false);
  assert.equal(handleKey(ev('2', { tagName: 'DIV', isContentEditable: true })), false);
  assert.equal(handleKey(ev('2', undefined, { metaKey: true })), false);
  assert.equal(handleKey(ev('x')), false);
  assert.equal(handleKey(ev('Enter')), false);
  assert.equal(store.get().view, 'np'); assert.equal(store.get().playing, false);
});
test('Space on a focused button is left to the button', () => {
  store._reset();
  assert.equal(handleKey(ev(' ', { tagName: 'BUTTON', getAttribute: () => null })), false);
  assert.equal(store.get().playing, false);
});
test('installKeys adds one listener and returns an uninstall', () => {
  const calls = []; const target = { addEventListener: (n, f) => calls.push(['add', n, f]), removeEventListener: (n, f) => calls.push(['rm', n, f]) };
  const off = installKeys(target); off();
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['add', 'keydown'], ['rm', 'keydown']]);
  assert.equal(calls[0][2], calls[1][2]);
});
