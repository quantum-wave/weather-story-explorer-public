// W4-02 (Josh points 13 and 8): ridge and trough annotations as pure functions (DESIGN-SPEC 4.5): extrema of at least 12 dam on a
// 4 degree decimation, no label where the signal is none, caps per size, the 1,500 km and 120 px rules, identity over ten frames,
// never over a higher-priority rectangle. The field is a made-up grid built here, never site data.
import test from 'node:test';
import assert from 'node:assert/strict';

const A = await import(new URL('../../../site/js/render/annotate.js', import.meta.url).href);

// A 1 degree global-ish grid, 0..359 E and -90..90, with Gaussian bumps in dam (stored in metres: x10).
const dom = { nx: 360, ny: 181, lon0: 0, lat0: -90, dlon: 1, dlat: 1 };
function field(bumps) {
  const v = new Float32Array(dom.nx * dom.ny);
  for (let j = 0; j < dom.ny; j++) for (let i = 0; i < dom.nx; i++) {
    let s = 0;
    for (const b of bumps) { const dx = Math.min(Math.abs(i - b.lon), 360 - Math.abs(i - b.lon)) * Math.cos(b.lat * Math.PI / 180), dy = (j - 90) - b.lat; s += b.dam * Math.exp(-(dx * dx + dy * dy) / (2 * 8 * 8)); }
    v[j * dom.nx + i] = s * 10;
  }
  return v;
}
const flat = (px) => (ll) => [(ll[0] + 180) * px, (90 - ll[1]) * px]; // equirectangular, px per degree

test('findExtrema finds a +18 ridge and a -15 trough, and nothing under 12 dam', () => {
  const e = A.findExtrema(field([{ lon: 200, lat: 50, dam: 18 }, { lon: 120, lat: 45, dam: -15 }, { lon: 30, lat: 40, dam: 9 }]), dom);
  assert.equal(e.length, 2, JSON.stringify(e));
  const r = e.find((x) => x.kind === 'ridge'), t = e.find((x) => x.kind === 'trough');
  assert.ok(Math.abs(r.dam - 18) < 1.2 && Math.abs(r.lat - 50) <= 4, JSON.stringify(r));
  assert.ok(Math.abs(t.dam + 15) < 1.2, JSON.stringify(t));
  assert.equal(A.plateText('ridge', r.dam)[0], 'RIDGE');
  assert.match(A.plateText('ridge', 18.2)[1], /^\+18 dam$/);
  assert.match(A.plateText('trough', -15.4)[1], /^−15 dam$/);
});

test('no label where the signal is none: a big mean with a bigger spread is dropped', () => {
  const v = field([{ lon: 200, lat: 50, dam: 14 }]);
  const clear = A.findExtrema(v, dom, { spread: () => 2 });
  const none = A.findExtrema(v, dom, { spread: () => 20 });
  assert.equal(clear[0].signal, 'clear');
  assert.equal(none[0].signal, 'none');
  const W = 1440, H = 720, proj = flat(4);
  assert.equal(A.selectLabels(clear, proj, { W, H }).length, 1);
  assert.equal(A.selectLabels(none, proj, { W, H }).length, 0, 'an extremum in a no-signal area is not labelled');
});

test('caps: three of each kind, two on a phone at zoom 1', () => {
  const bumps = [];
  for (let k = 0; k < 5; k++) { bumps.push({ lon: 20 + k * 60, lat: 55, dam: 20 + k }); bumps.push({ lon: 50 + k * 60, lat: 20, dam: -(20 + k) }); }
  const e = A.findExtrema(field(bumps), dom);
  const out = A.selectLabels(e, flat(8), { W: 3000, H: 1500, cap: A.capFor(1440) });
  assert.equal(out.filter((x) => x.kind === 'ridge').length, 3);
  assert.equal(out.filter((x) => x.kind === 'trough').length, 3);
  assert.equal(A.capFor(390, 1), 2);
  assert.equal(A.capFor(390, 2), 3);
  const ph = A.selectLabels(e, flat(8), { W: 3000, H: 1500, cap: A.capFor(390, 1) });
  assert.equal(ph.length, 4);
  assert.deepEqual(out.map((x) => x.dam).sort((a, b) => b - a).slice(0, 1), [Math.max(...out.map((x) => x.dam))]);
});

test('distance rules: both 1,500 km and 120 px must hold', () => {
  const c = (lon, lat, dam) => ({ lon, lat, dam, kind: dam > 0 ? 'ridge' : 'trough', signal: 'clear' });
  // 20 degrees of longitude at 50N is about 1,430 km: too close in km even at 10 px a degree
  assert.equal(A.selectLabels([c(-20, 50, 20), c(0, 50, 19)], flat(10), { W: 4000, H: 2000 }).length, 1);
  // 30 degrees at 50N is about 2,140 km, but 3 px a degree is 90 px: too close on screen
  assert.equal(A.selectLabels([c(-20, 50, 20), c(10, 50, 19)], flat(3), { W: 4000, H: 2000 }).length, 1);
  assert.equal(A.selectLabels([c(-20, 50, 20), c(10, 50, 19)], flat(10), { W: 4000, H: 2000 }).length, 2);
  assert.ok(A.distKm([0, 0], [0, 1]) > 110 && A.distKm([0, 0], [0, 1]) < 112);
});

test('never over a higher-priority label: a blocked rectangle drops the plate and the next one takes the slot', () => {
  const c = (lon, lat, dam) => ({ lon, lat, dam, kind: 'ridge', signal: 'clear' });
  const proj = flat(10), p = proj([20, 50]);
  const blocked = [{ x: p[0] - 10, y: p[1] - 10, w: 20, h: 20 }];
  const out = A.selectLabels([c(20, 50, 25), c(80, 50, 15)], proj, { W: 4000, H: 2000, blocked });
  assert.deepEqual(out.map((x) => x.lon), [80]);
  assert.equal(A.selectLabels([c(20, 50, 25)], () => null, { W: 400, H: 400 }).length, 0, 'the far side of a globe is not labelled');
  assert.equal(A.selectLabels([c(-179, 50, 25)], proj, { W: 4000, H: 2000 }).length, 0, 'a plate would leave the frame');
});

test('identity over ten frames: a drifting ridge keeps its id and eases; a new one gets a new id', () => {
  const tr = A.createTracker({ ease: 0.5 });
  const ids = [], lons = [];
  for (let f = 0; f < 10; f++) {
    const out = tr.update([{ lon: -150 + f * 5, lat: 50, dam: 18, kind: 'ridge' }, { lon: 100, lat: 40, dam: -14, kind: 'trough' }]);
    ids.push(out.map((o) => o.id).join(','));
    lons.push(out[0].lon);
  }
  assert.equal(new Set(ids).size, 1, 'same ids on all ten frames: ' + ids.join(' | '));
  for (let f = 1; f < 10; f++) assert.ok(lons[f] > lons[f - 1] && lons[f] < -150 + f * 5 + 1e-9, 'it eases toward the new place, never jumps: ' + lons.join(' '));
  const jump = tr.update([{ lon: 120, lat: 50, dam: 18, kind: 'ridge' }, { lon: 100, lat: 40, dam: -14, kind: 'trough' }]);
  assert.notEqual(jump[0].id, +ids[0].split(',')[0], 'a feature that moved 800+ km is a new feature');
  assert.equal(jump[1].id, +ids[0].split(',')[1]);
  // the same place with the other sign is another feature
  const flip = createFlip();
  function createFlip() { const t = A.createTracker(); const a = t.update([{ lon: 0, lat: 0, dam: 15, kind: 'ridge' }]); const b = t.update([{ lon: 0, lat: 0, dam: -15, kind: 'trough' }]); return [a[0].id, b[0].id]; }
  assert.notEqual(flip[0], flip[1]);
});

test('a still map settles: update with snap puts every plate on its pick at once, an eased frame never overshoots', () => {
  const tr = A.createTracker({ ease: 0.35 });
  tr.update([{ lon: -54, lat: 50, dam: -18, kind: 'trough' }]);
  const eased = tr.update([{ lon: -50, lat: 50, dam: -18, kind: 'trough' }]);
  assert.ok(eased[0].lon > -54 && eased[0].lon < -50, 'one eased frame is partway: ' + eased[0].lon);
  let out = eased;
  for (let f = 0; f < 3; f++) out = tr.update([{ lon: -50, lat: 50, dam: -18, kind: 'trough' }]);
  assert.ok(out[0].lon !== -50, 'easing alone does not arrive in finite frames: ' + out[0].lon);
  const still = tr.update([{ lon: -50, lat: 50, dam: -18, kind: 'trough' }], { snap: true });
  assert.equal(still[0].lon, -50); assert.equal(still[0].lat, 50);
  assert.equal(still[0].id, eased[0].id, 'snapping keeps the identity');
  const next = tr.update([{ lon: -46, lat: 50, dam: -18, kind: 'trough' }]);
  assert.ok(next[0].lon > -50 && next[0].lon < -46, 'easing starts from the snapped place: ' + next[0].lon);
  const t2 = A.createTracker(); t2.update([{ lon: 10, lat: 10, dam: 15, kind: 'ridge' }]);
  const e2 = t2.update([{ lon: 14, lat: 10, dam: 15, kind: 'ridge' }]);
  t2.snap(e2[0].id);
  assert.equal(t2.update([{ lon: 14, lat: 10, dam: 15, kind: 'ridge' }])[0].lon, 14, 'tracker.snap puts a plate on its target');
});
