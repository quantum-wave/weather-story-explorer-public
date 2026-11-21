// W3-05: the store keys of design spec section 15 and their merge rules (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { store, choice, CHOICE_DEFAULTS } from '../../../site/js/state.js';

test('the new keys have their defaults', () => {
  store._reset();
  const s = store.get();
  // range, lens and ground are choices made with a control: absent until made, with the section 15 defaults through choice()
  for (const k of ['range', 'lens', 'ground']) assert.equal(k in s, false, `${k} starts absent (not chosen yet)`);
  assert.deepEqual(CHOICE_DEFAULTS, { range: 7, lens: 'z', ground: 'paper' });
  assert.equal(choice(s, 'range'), 7);
  assert.equal(choice(s, 'lens'), 'z');
  assert.equal(choice(s, 'ground'), 'paper');
  assert.deepEqual(s.overlays, { contours: true, marks: true, doubt: true, jetline: false, pins: true, places: true });
  assert.equal(s.units, 'metric');
  assert.equal(s.themePref, 'auto');
  assert.equal(s.expanded, false);
});

test('a partial overlays patch keeps the other five flags (deep merge)', () => {
  store._reset();
  store.set({ overlays: { jetline: true } });
  assert.deepEqual(store.get().overlays, { contours: true, marks: true, doubt: true, jetline: true, pins: true, places: true });
  store.set({ overlays: { contours: false } });
  assert.deepEqual(store.get().overlays, { contours: false, marks: true, doubt: true, jetline: true, pins: true, places: true });
});

test('other keys replace, and the retired layers key is no longer merged', () => {
  store._reset();
  store.set({ layers: { j: true } });
  assert.deepEqual(store.get().layers, { j: true }, 'an unknown key is just replaced: nothing deep-merges it');
  store.set({ lens: 'j', expanded: true });
  assert.equal(store.get().lens, 'j');
  assert.equal(store.get().expanded, true);
  store.set({ range: 15 });
  store.set({ ground: 'night' });
  assert.equal(store.get().range, 15, 'untouched keys stay');
  assert.equal(choice(store.get(), 'range'), 15, 'a choice once made wins over the default');
});

test('subscribers see the patch as given and the merged state', () => {
  store._reset();
  let seen = null;
  const off = store.subscribe((s, p) => { seen = { s, p }; });
  store.set({ overlays: { places: false } });
  off();
  assert.deepEqual(seen.p, { overlays: { places: false } });
  assert.equal(seen.s.overlays.pins, true);
  assert.equal(seen.s.overlays.places, false);
});

test('a patch does not alias the stored overlays object', () => {
  store._reset();
  const patch = { jetline: true };
  store.set({ overlays: patch });
  patch.jetline = false;
  assert.equal(store.get().overlays.jetline, true);
});

// The map status lines of design spec 8.5 (ui/status.js has no static imports, so it loads in node).
import { partialText, missingText } from '../../../site/js/ui/status.js';

test('the partial-data line and the missing-field line read as the spec words them', () => {
  assert.equal(partialText(7), 'Showing days 1-7; later days are loading');
  assert.equal(missingText([]), '');
  assert.equal(missingText(null), '');
  assert.equal(missingText([{ field: 'z500sd', reason: 'late' }]), "Ensemble spread isn't in this run");
  assert.equal(missingText([{ field: 'z500sd' }, { field: 'tp6' }]), "Ensemble spread and rain aren't in this run");
  assert.equal(missingText([{ field: 'tp6' }, { field: 'pr1' }, { field: 'pr10' }]), "Rain isn't in this run", 'three rain fields are one phrase');
  assert.equal(missingText([{ field: 'xyz9' }]), "Xyz9 isn't in this run", 'an unknown field falls back to its id');
});
