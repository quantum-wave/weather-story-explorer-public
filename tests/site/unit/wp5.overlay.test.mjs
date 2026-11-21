// WP5 / W3-07: the pin overlay (design spec 4.4). Ink dots with a ring, names on the viewer's own screen in priority order with
// collision, no name at all with labels:'export', one dot per city with a count above 40 pins, and the dot or ring against the
// deepest blue and red bands of both grounds at 3:1 or better.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pinOverlay, GROUP_COUNT_THRESHOLD, INK } from '../../../site/js/pins/overlay.js';
import { bandRGBA } from '../../../site/js/render/palette.js';

function fakeCtx(w = 1000, h = 800) {
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a]); };
  const ctx = { canvas: { clientWidth: w, clientHeight: h, width: w, height: h }, calls, measureText: (t) => ({ width: t.length * 6 }) };
  for (const n of ['save', 'restore', 'beginPath', 'arc', 'fill', 'stroke', 'fillText', 'strokeText']) ctx[n] = rec(n);
  return ctx;
}
const group = [{ id: 'friends', name: 'Friends', hue: 200 }];
function source(pinList, trips = [], home = { id: 1, name: 'Home town', lat: 0, lon: 0 }) {
  return { groups: () => group, all: () => pinList, trips: () => trips, home: () => home };
}
const mk = (i, city, name = 'Person ' + i) => ({ id: 'p' + i, name, group: 'friends', city });
const seattle = { id: 5809844, name: 'Seattle', lat: 47.6, lon: -122.33 };
const project = ([lon, lat]) => [(lon + 180) * 2, (90 - lat) * 4];
const texts = (ctx) => ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);

test('at or under the threshold: one dot per pin, each named, hit targets per pin', () => {
  const pins = Array.from({ length: 5 }, (_, i) => mk(i, { id: i, name: 'City' + i, lat: 10 * i + 10, lon: i * 40 - 80 }));
  const ov = pinOverlay({ project }, { pins: source(pins) });
  const ctx = fakeCtx(); ov(ctx, project, { theme: 'dark' });
  const t = texts(ctx);
  for (let i = 0; i < 5; i++) assert.ok(t.includes('Person ' + i), 'the name is drawn on the owner\'s screen: ' + t);
  assert.ok(t.includes('Home town'), 'home is named');
  assert.equal(ov.hits.filter((h) => h.ids[0] !== 'home').length, 5);
});

test('ink, not hue: Paper is an ink dot with a white ring, Night a light dot with a dark ring; no group colour is used', () => {
  const pins = [mk(1, seattle)];
  for (const [ground, theme] of [['paper', 'light'], ['night', 'dark']]) {
    const ov = pinOverlay({ project }, { pins: source(pins) });
    const styles = [];
    const ctx = fakeCtx();
    Object.defineProperty(ctx, 'fillStyle', { set(v) { styles.push(['fill', v]); }, get() { return ''; } });
    Object.defineProperty(ctx, 'strokeStyle', { set(v) { styles.push(['stroke', v]); }, get() { return ''; } });
    ov(ctx, project, { theme, ground });
    assert.ok(styles.some(([k, v]) => k === 'fill' && v === INK[ground].dot), ground + ' dot');
    assert.ok(styles.some(([k, v]) => k === 'stroke' && v === INK[ground].ring), ground + ' ring');
    assert.ok(styles.every(([, v]) => !/hsl|oklch/i.test(String(v))), 'no hue-coded pin colour');
  }
});

test('the dot or its ring is at least 3:1 against the deepest blue and the deepest red band on both grounds', () => {
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const ground of ['paper', 'night']) {
    for (const [what, v] of [['deepest blue', -60], ['deepest red', 60]]) {
      const band = bandRGBA('z500a', v, ground).slice(0, 3);
      const best = Math.max(cr(hex(INK[ground].dot), band), cr(hex(INK[ground].ring), band));
      assert.ok(best >= 3, `${ground} ${what}: best of dot and ring is ${best.toFixed(2)}:1`);
    }
  }
});

test('names follow the collision priority: a lower item that would overlap a higher one is not drawn', () => {
  // six pins in the same spot: the focused one is always named, no two drawn names overlap, and some are left out
  const here = { id: 1, name: 'Same', lat: 40, lon: -100 };
  const pins = [...Array.from({ length: 5 }, (_, i) => mk(i, here, 'Ordinary' + i)), mk(9, { id: 2, name: 'Near', lat: 40, lon: -99.9 }, 'Chosen')];
  const ov = pinOverlay({ project }, { pins: source(pins) });
  const ctx = fakeCtx(); ov(ctx, project, { theme: 'dark', focus: { lat: 40, lon: -99.9, kind: 'person' } });
  const t = texts(ctx).filter((x) => x !== 'Home town');
  assert.ok(t.includes('Chosen'), 'the focused name is drawn: ' + t);
  assert.ok(t.length < 6, 'some lower names are left out where they would overlap: ' + t);
  const drawn = ctx.calls.filter((c) => c[0] === 'fillText');
  for (let i = 0; i < drawn.length; i++) for (let j = i + 1; j < drawn.length; j++) {
    const [a, b] = [drawn[i], drawn[j]]; const wa = a[1].length * 6, wb = b[1].length * 6;
    assert.ok(!(a[2] < b[2] + wb && a[2] + wa > b[2] && Math.abs(a[3] - b[3]) < 14), `${a[1]} and ${b[1]} overlap`);
  }
  // home label is first: a pin label that would sit on it is skipped
  const near = [mk(3, { id: 3, name: 'Next', lat: 0, lon: 0.2 }, 'Neighbour')];
  const ctx2 = fakeCtx(); pinOverlay({ project }, { pins: source(near) })(ctx2, project, { theme: 'dark' });
  assert.ok(texts(ctx2).includes('Home town'));
  const boxes = ctx2.calls.filter((c) => c[0] === 'fillText');
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [a, b] = [boxes[i], boxes[j]]; const wa = a[1].length * 6, wb = b[1].length * 6;
    assert.ok(!(a[2] < b[2] + wb && a[2] + wa > b[2] && Math.abs(a[3] - b[3]) < 14), `${a[1]} and ${b[1]} overlap`);
  }
});

test("labels: 'export' draws no name of any pin, trip or home; labels:false draws no text", () => {
  const pins = Array.from({ length: 3 }, (_, i) => mk(i, { id: i, name: 'C' + i, lat: 10 * i, lon: 30 * i - 60 }, 'Maya Fictional' + i));
  const trips = [{ id: 't1', label: 'Secret Trip', city: seattle, start: '2026-12-01', end: '2026-12-03' }];
  for (const labels of ['export', false]) {
    const ov = pinOverlay({ project }, { pins: source(pins, trips), labels, today: () => '2026-11-17' });
    const ctx = fakeCtx(); ov(ctx, project, { theme: 'light' });
    assert.ok(!JSON.stringify(ctx.calls).includes('Maya Fictional'), String(labels));
    assert.ok(!JSON.stringify(ctx.calls).includes('Secret Trip'), String(labels));
    assert.equal(texts(ctx).length, 0, `labels ${labels}: no text at all`);
  }
});

test('above the threshold: one dot per city with a "City · n" count, and no person names (also in export mode)', () => {
  const pins = Array.from({ length: 45 }, (_, i) => mk(i, i < 30 ? seattle : { id: 100 + i, name: 'Town' + i, lat: 30 + (i % 10), lon: -100 + i }, 'Secret Name ' + i));
  for (const labels of [true, 'export']) {
    const ov = pinOverlay({ project }, { pins: source(pins), labels });
    const ctx = fakeCtx(); ov(ctx, project, { theme: 'dark' });
    const t = texts(ctx);
    assert.ok(t.includes('Seattle · 30'), JSON.stringify(t));
    assert.ok(t.every((x) => !/Secret Name|Person/.test(x)));
    const sea = ov.hits.find((h) => h.cityId === 5809844);
    assert.equal(sea.ids.length, 30);
    assert.equal(ov.hits.filter((h) => h.ids.length === 1 && h.ids[0] !== 'home').length, 15);
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

const FOCUS = { lat: 47.6, lon: -122.33, kind: 'person', label: 'Seattle, WA' };
const overlapsFocusLabel = (ctx) => {
  const fx = project([-122.33, 47.6]), fw = FOCUS.label.length * 6, box = { x: fx[0] + 15, y: fx[1] - 9, w: fw + 4, h: 18 };
  return ctx.calls.filter((k) => k[0] === 'fillText').filter((c) => { const b = { x: c[2] - 2, y: c[3] - 7, w: c[1].length * 6 + 4, h: 14 };
    return b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y; }).map((c) => c[1]);
};

test('the focus label (13 px, 17 px right of the focus point) is an obstacle: no pin name lands on it', () => {
  const pins = [mk(1, seattle, 'Maya'), mk(2, { id: 77, name: 'Edge', lat: 47.6, lon: -122.33 + 20 / 2 }, 'Lakeside')];
  const ov = pinOverlay({ project }, { pins: source(pins) });
  const ctx = fakeCtx(); ov(ctx, project, { theme: 'dark', focus: FOCUS });
  const t = texts(ctx);
  assert.ok(t.includes('Maya'), 'the focused person is still named: ' + t);
  assert.deepEqual(overlapsFocusLabel(ctx), [], 'no overlay name overlaps the focus label');
});

test('a home or pin named the same place as the focus label is not drawn twice ("Seattle" beside "Seattle, WA")', () => {
  const ov = pinOverlay({ project }, { pins: source([], [], { id: 1, name: 'Seattle', lat: 47.6, lon: -122.33 }) });
  const ctx = fakeCtx(); ov(ctx, project, { theme: 'dark', focus: { ...FOCUS, kind: 'place' } });
  assert.deepEqual(texts(ctx), [], 'the overlay adds no second "Seattle": ' + texts(ctx));
});
