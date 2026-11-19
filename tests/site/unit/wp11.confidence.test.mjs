// W2-06 story/confidence.js: the one zones table, signalAt and confidenceAt goldens.
import test from 'node:test';
import assert from 'node:assert/strict';

const C = await import(new URL('../../../site/js/story/confidence.js', import.meta.url).href);

test('Z1 zones() is exactly the section 7.2 table with the ensemble mean', () => {
  assert.deepEqual(C.zones(360, { hasMean: true }).map((z) => [z.from, z.to, z.kind, z.caption, z.texture, z.days]), [
    [0, 168, 'hres', 'one high-resolution forecast', 'solid', [1, 7]],
    [168, 240, 'blend', 'moving to the average of 51 forecasts · broad pattern', 'dashed', [8, 10]],
    [240, 360, 'mean', 'average of 51 forecasts · pattern only', 'hatch', [11, 15]],
  ]);
});

test('Z2 without the mean the last two rows are one hres-late row and nothing says "51 forecasts"', () => {
  const z = C.zones(360, { hasMean: false });
  assert.deepEqual(z.map((x) => [x.from, x.to, x.kind, x.caption, x.texture]), [
    [0, 168, 'hres', 'one high-resolution forecast', 'solid'],
    [168, 360, 'hres-late', 'one forecast, no ensemble average in this run · pattern only', 'hatch'],
  ]);
  assert.ok(z.every((x) => !/51 forecasts/.test(x.caption)));
});

test('Z3 the zones never overlap, are contiguous from 0 and the captions are the exported constants', () => {
  for (const hasMean of [true, false]) for (const max of [48, 120, 168, 200, 240, 300, 360]) {
    const z = C.zones(max, { hasMean });
    assert.equal(z[0].from, 0);
    for (let i = 1; i < z.length; i++) assert.equal(z[i].from, z[i - 1].to, `contiguous ${max} ${hasMean}`);
    assert.equal(z[z.length - 1].to, Math.min(360, max));
    for (const x of z) { assert.ok(x.to > x.from); assert.equal(x.caption, C.CAPTIONS[x.kind]); }
  }
  assert.equal(Object.keys(C.CAPTIONS).length, 4);
  assert.equal(C.zoneAt(167.9).kind, 'hres'); assert.equal(C.zoneAt(168).kind, 'blend');
  assert.equal(C.zoneAt(240).kind, 'mean'); assert.equal(C.zoneAt(360).kind, 'mean'); assert.equal(C.zoneAt(361), null);
  assert.equal(C.zoneAt(300, 360, { hasMean: false }).kind, 'hres-late');
});

test('S1 signalAt: none when the spread is known, at least 4 dam and larger than the mean anomaly', () => {
  const s = (anomDam, spreadDam, hasSpread = true) => C.signalAt({ anomDam, spreadDam, hasSpread });
  assert.equal(s(1, 5.96), 'none');
  assert.equal(s(3.9, 4), 'none');
  assert.equal(s(-3.9, 4), 'none');
  assert.equal(s(4, 4), 'clear', 'the anomaly is not smaller than the spread');
  assert.equal(s(0, 3.9), 'clear', 'spread under 4 dam');
  assert.equal(s(13.5, 5.2), 'clear');
  assert.equal(s(1, 8, false), 'clear', 'no spread known');
  assert.equal(s(1, NaN), 'clear');
  assert.equal(s(NaN, 8), 'clear');
  assert.equal(C.NO_CLEAR_SIGNAL, 'No clear signal yet: forecasts disagree');
});

test('F1 confidenceAt reproduces the SPEC section 6 thresholds', () => {
  const c = (day, spreadDam, hasSpread = true) => C.confidenceAt(day * 24 - 12, { spreadDam, hasSpread }).level;
  assert.deepEqual([2.9, 3, 6, 6.1].map((v) => c(1, v)), ['high', 'medium', 'medium', 'low']);
  assert.equal(c(9, 1), 'medium', 'days 8-10 are at most medium');
  assert.equal(c(11, 1), 'pattern-only');
  assert.deepEqual([1, 4, 5, 7, 8, 10].map((d) => c(d, undefined, false)), ['high', 'high', 'medium', 'medium', 'low', 'low']);
  assert.deepEqual(C.confidenceAt(12, { spreadDam: 2, hasSpread: true }), { level: 'high', phrase: 'confident', source: 'spread' });
  assert.deepEqual(C.confidenceAt(12, { hasSpread: false }), { level: 'high', phrase: 'confident', source: 'lead' });
  assert.equal(C.confidenceAt(300, { spreadDam: 2, hasSpread: true }).phrase, 'pattern only, not specifics');
});

test('F2 a spread that is not meaningful is "none" with a reason, never a confident claim', () => {
  for (const spreadDam of [0, -1, NaN, undefined]) {
    const r = C.confidenceAt(24, { spreadDam, hasSpread: true });
    assert.equal(r.level, 'none'); assert.equal(r.phrase, ''); assert.match(r.reason, /not meaningful/);
  }
});
