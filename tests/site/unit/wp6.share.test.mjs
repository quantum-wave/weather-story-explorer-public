// WP6 pure units: hash grammar and share text rules. No browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HASH_RE, RESERVED_HASHES, isReservedHash } from '../../../site/js/contract.js';
import { buildHash, parseHash, placeToken, placeIdOf, layersToken, utcStamp, dateOfStamp } from '../../../site/js/share/hashgrammar.js';
import { formatValid, defaultHeadline, confidencePhrase, footerLine, valueAt } from '../../../site/js/share/format.js';
import { confidenceAt } from '../../../site/js/story/confidence.js';

test('buildHash and parseHash round trip over every view and layer subset', () => {
  const views = ['np', 'nh', 'gl', 'wm'];
  for (const view of views) for (let m = 0; m < 16; m++) {
    const layers = { z: !!(m & 1), j: !!(m & 2), c: !!(m & 4), t: !!(m & 8) };
    for (const place of [null, 'sf', 'c123456']) {
      const h = buildHash({ view, layers, validTime: '2026112212', place });
      assert.match(h.slice(1), HASH_RE);
      assert.ok(!isReservedHash(h.slice(1)));
      assert.ok(h.length <= 65);
      const p = parseHash(h);
      assert.deepEqual({ view: p.view, layers: p.layers, validTime: p.validTime, place: p.place }, { view, layers, validTime: '2026112212', place });
    }
  }
  assert.equal(buildHash({ view: 'np', layers: { z: true, j: true }, validTime: '2026112212', place: 'sf' }), '#np-zj-2026112212-sf');
  assert.equal(layersToken({}), '0');
});

test('World is a view: #wm-z-2026112212-sf parses and rebuilds, the region reads World', async () => {
  const p = parseHash('#wm-z-2026112212-sf');
  assert.equal(p.view, 'wm');
  assert.equal(buildHash({ view: 'wm', lens: 'z', validTime: '2026112212', place: 'sf' }), '#wm-z-2026112212-sf');
  const { regionName } = await import('../../../site/js/share/format.js');
  assert.equal(regionName('wm'), 'World');
  assert.equal(regionName('gl'), 'Global');
});

test('parseHash rejects reserved names, junk, impossible dates and unknown places', () => {
  for (const r of [...RESERVED_HASHES, 'comment-abc', 'comment-1-2-3']) assert.equal(parseHash('#' + r), null, r);
  for (const bad of ['', '#', '#np', '#np-z', '#xx-z-2026112212', '#np-q-2026112212', '#np-zz-2026112212', '#np-z-2026133212',
    '#np-z-2026112224', '#np-z-202611221', '#np-z-2026112212-bob', '#np-z-2026112212-c', '#NP-z-2026112212', '#np-z-2026112212-sf-x', null, 42]) {
    assert.equal(parseHash(bad), null, String(bad));
  }
  assert.equal(parseHash('#np-z-2026022912'), null, '2026 is not a leap year');
  assert.ok(parseHash('#np-z-2026112212-debug'), 'trailing debug token is tolerated');
});

test('place tokens come only from numeric gazetteer ids', () => {
  assert.equal(placeToken(5391959), 'sf');
  assert.equal(placeToken('5391959'), 'sf');
  assert.equal(placeToken(2643743), 'c2643743');
  for (const bad of [null, undefined, 'p1', 't3', 'Maya', 'c', '12345678901', 'sf']) assert.equal(placeToken(bad), null, String(bad));
  assert.equal(placeIdOf('sf'), 5391959);
  assert.equal(placeIdOf('c42'), 42);
  assert.equal(placeIdOf('maya'), null);
});

test('utcStamp and dateOfStamp are inverse', () => {
  const d = new Date(Date.UTC(2026, 10, 22, 12));
  assert.equal(utcStamp(d), '2026112212');
  assert.equal(dateOfStamp('2026112212').getTime(), d.getTime());
});

test('formatValid prints local time with the UTC hour', () => {
  const d = new Date(Date.UTC(2026, 10, 22, 12));
  const v = formatValid(d, { timeZone: 'America/Los_Angeles' });
  assert.equal(v.local, 'Sun 22 Nov, 4 am PST (12Z)');
  assert.equal(v.dayLabel, 'Sun 22 Nov');
  assert.equal(formatValid(d, { timeZone: 'UTC' }).local, 'Sun 22 Nov, 12 pm UTC (12Z)');
  assert.equal(formatValid(new Date(Date.UTC(2026, 10, 22, 12, 30)), { timeZone: 'UTC' }).utc, '12:30Z');
});

test('headline defaults to a factual label', () => {
  assert.equal(defaultHeadline({ placeLabel: 'San Francisco', view: 'np', dayLabel: 'Sat 22 Nov' }), 'San Francisco · Sat 22 Nov');
  assert.equal(defaultHeadline({ placeLabel: '', view: 'nh', dayLabel: 'Sat 22 Nov' }), 'Northern Hemisphere · Sat 22 Nov');
});

test('the share words the one confidence table (story/confidence.js), never its own', () => {
  const words = (h, o) => confidencePhrase(confidenceAt(h, o));
  assert.equal(words(30, { spreadDam: 2, hasSpread: true }), 'Pattern: confident');
  assert.equal(words(30, { spreadDam: 4, hasSpread: true }), 'Pattern: fairly sure of the timing');
  assert.equal(words(30, { spreadDam: 7, hasSpread: true }), 'Pattern: timing uncertain');
  assert.equal(words(8 * 24, { spreadDam: 1, hasSpread: true }), 'Pattern: fairly sure of the timing', 'days 8-10 at most medium');
  assert.equal(words(11 * 24, { spreadDam: 1, hasSpread: true }), 'Pattern only, not specifics');
  assert.equal(words(24, { hasSpread: false }), 'Pattern: confident');
  assert.equal(words(9 * 24, { hasSpread: false }), 'Pattern: timing uncertain');
  assert.match(words(24, { spreadDam: 0, hasSpread: true }), /^Pattern confidence: not shown \(the ensemble spread is not meaningful here\)$/, 'no claim from nothing');
  assert.doesNotMatch(words(24, { hasSpread: false }), /settled/);
});

test('footer and series interpolation', () => {
  assert.equal(footerLine({ attribution: 'ECMWF open data CC-BY-4.0', climatologyLabel: 'ERA5 1990-2019' }),
    'Model output, not an official forecast · ECMWF open data CC-BY-4.0 · anomaly vs ERA5 1990-2019');
  const s = { steps: [0, 12], values: [0, 10] };
  assert.equal(valueAt(s, 6), 5);
  assert.equal(valueAt(s, -5), 0);
  assert.equal(valueAt(s, 99), 10);
  assert.equal(valueAt(null, 1), null);
});
