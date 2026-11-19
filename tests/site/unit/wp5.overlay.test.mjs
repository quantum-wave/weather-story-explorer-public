// WP5: the map overlay draws dots and counts, never a person's name, and groups cities above 40 pins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pinOverlay, GROUP_COUNT_THRESHOLD } from '../../../site/js/pins/overlay.js';

function fakeCtx(w = 1000, h = 800) {
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a]); };
  const ctx = { canvas: { clientWidth: w, clientHeight: h, width: w, height: h }, calls, measureText: (t) => ({ width: t.length * 6 }) };
  for (const n of ['save', 'restore', 'beginPath', 'arc', 'fill', 'stroke', 'fillText', 'strokeText']) ctx[n] = rec(n);
  return ctx;
}
const group = [{ id: 'friends', name: 'Friends', hue: 200 }];
function source(pinList, trips = []) {
  return { groups: () => group, all: () => pinList, trips: () => trips, home: () => ({ id: 1, name: 'Home', lat: 0, lon: 0 }) };
}
const mk = (i, city, name = 'Person ' + i) => ({ id: 'p' + i, name, group: 'friends', city });
const seattle = { id: 5809844, name: 'Seattle', lat: 47.6, lon: -122.33 };
const project = ([lon, lat]) => [(lon + 180) * 2, (90 - lat) * 4];

test('at or under the threshold: one dot per pin, no text, hit targets per pin', () => {
  const pins = Array.from({ length: GROUP_COUNT_THRESHOLD }, (_, i) => mk(i, { id: i, name: 'City' + i, lat: (i % 20) - 10, lon: i * 3 - 60 }));
  const ov = pinOverlay({ project }, { pins: source(pins) });
  const ctx = fakeCtx(); ov(ctx, project, { theme: 'dark' });
  assert.equal(ctx.calls.filter((c) => c[0] === 'fillText').length, 0);
  assert.equal(ov.hits.filter((h) => h.ids[0] !== 'home').length, GROUP_COUNT_THRESHOLD);
});

test('above the threshold: one dot per city with a "City · n" count, and no person names', () => {
  const pins = Array.from({ length: 45 }, (_, i) => mk(i, i < 30 ? seattle : { id: 100 + i, name: 'Town' + i, lat: 30 + (i % 10), lon: -100 + i }, 'Secret Name ' + i));
  const ov = pinOverlay({ project }, { pins: source(pins) });
  const ctx = fakeCtx(); ov(ctx, project, { theme: 'dark' });
  const texts = ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  assert.ok(texts.includes('Seattle · 30'), JSON.stringify(texts));
  assert.ok(texts.every((t) => !/Secret Name|Person/.test(t)));
  const sea = ov.hits.find((h) => h.cityId === 5809844);
  assert.equal(sea.ids.length, 30);
  assert.equal(ov.hits.filter((h) => h.ids.length === 1 && h.ids[0] !== 'home').length, 15);
});

test('names never reach the canvas at any count, even with labels on', () => {
  for (const n of [3, 60]) {
    const pins = Array.from({ length: n }, (_, i) => mk(i, seattle, 'Maya Fictional' + i));
    const ov = pinOverlay({ project }, { pins: source(pins) });
    const ctx = fakeCtx(); ov(ctx, project, { theme: 'light' });
    assert.ok(!JSON.stringify(ctx.calls).includes('Maya Fictional'));
  }
});

test('off-screen pins do not count toward the threshold; labels:false drops counts; trips in the past are skipped', () => {
  const far = (i) => mk(i, { id: i, name: 'Far', lat: 0, lon: 0 });
  const pins = Array.from({ length: 80 }, (_, i) => far(i));
  const ov = pinOverlay({ project }, { pins: source(pins), today: () => '2026-11-17' });
  const ctx = fakeCtx(10, 10); ov(ctx, project, {});
  assert.equal(ov.hits.filter((h) => h.ids[0] !== 'home').length, 0);
  const ov2 = pinOverlay({ project }, { pins: source(Array.from({ length: 45 }, (_, i) => mk(i, seattle))), labels: false });
  const c2 = fakeCtx(); ov2(c2, project, {});
  assert.equal(c2.calls.filter((c) => c[0] === 'fillText').length, 0);
  const trips = [{ id: 't1', label: 'Old', city: seattle, start: '2026-01-01', end: '2026-01-03' }, { id: 't2', label: 'New', city: seattle, start: '2026-12-01', end: '2026-12-03' }];
  const ov3 = pinOverlay({ project }, { pins: source([], trips), today: () => '2026-11-17' });
  ov3(fakeCtx(), project, {});
  assert.deepEqual(ov3.hits.map((h) => h.ids[0]).sort(), ['home', 't2']);
});
