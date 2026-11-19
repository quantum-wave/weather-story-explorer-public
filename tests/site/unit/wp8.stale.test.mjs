// The stale warning must stay quiet through a healthy build cadence (00Z/12Z runs built ~9.5 h later).
import test from 'node:test';
import assert from 'node:assert/strict';

const { isStale, ageHours } = await import(new URL('../../../site/js/ui/format.js', import.meta.url).href);

test('a run is not stale at the oldest age a healthy cadence shows, and is stale when a slot was missed', () => {
  const run = '2026-11-17T12:00Z';
  const at = (h) => ageHours(run, Date.parse('2026-11-17T12:00Z') + h * 3600e3);
  assert.equal(isStale(at(21.5)), false, '12Z run just before the next 00Z run is built (09:30Z)');
  assert.equal(isStale(at(19)), false);
  assert.equal(isStale(at(31)), true, 'a missed slot');
});
