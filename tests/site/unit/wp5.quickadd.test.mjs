// WP5: the pure quick-add grammar (SPEC section 5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd as p, extractDates } from '../../../site/js/pins/quickadd.js';

const T = '2026-11-17';

test('person, place, group tag, region qualifier', () => {
  assert.deepEqual(p('Maya in Portland', T), { kind: 'person', name: 'Maya', group: null, cityQuery: 'Portland' });
  assert.deepEqual(p('#friends Maya in Portland, OR', T), { kind: 'person', name: 'Maya', group: 'friends', cityQuery: 'Portland, OR' });
  assert.deepEqual(p('Lisbon', T), { kind: 'place', name: 'Lisbon', group: null, cityQuery: 'Lisbon' });
  assert.deepEqual(p('#close-friends Sam - Austin, TX', T), { kind: 'person', name: 'Sam', group: 'close friends', cityQuery: 'Austin, TX' });
});

test('a name that contains "in" or a month word is still a person', () => {
  assert.equal(p('May in Portland', T).kind, 'person');
  assert.equal(p('Tripoli', T).kind, 'place');
  assert.equal(p('Maya in Barrow in Furness — nope', T).cityQuery, 'nope'); // em dash wins over " in "
  assert.equal(p('Maya — Barrow in Furness, United Kingdom', T).cityQuery, 'Barrow in Furness, United Kingdom');
});

test('trips: forms, year rollover, missing dates', () => {
  assert.deepEqual(p('Trip: Tahoe Nov 27-30', T), { kind: 'trip', name: 'Tahoe', group: null, cityQuery: 'Tahoe', trip: { start: '2026-11-27', end: '2026-11-30' } });
  assert.deepEqual(p('Trip: Ski weekend in Tahoe Nov 27 - Dec 2', T).trip, { start: '2026-11-27', end: '2026-12-02' });
  assert.equal(p('Trip: Ski weekend in Tahoe Nov 27 - Dec 2', T).name, 'Ski weekend');
  assert.deepEqual(p('Tahoe 11/27-30', T).trip, { start: '2026-11-27', end: '2026-11-30' });
  assert.deepEqual(p('trip to Lisbon 2026-12-03 to 2026-12-10', T).trip, { start: '2026-12-03', end: '2026-12-10' });
  assert.deepEqual(p('Trip: Banff 27-30 Nov', T).trip, { start: '2026-11-27', end: '2026-11-30' });
  assert.deepEqual(p('Trip: Tahoe Nov 3-5', T).trip, { start: '2027-11-03', end: '2027-11-05' }, 'a past range rolls to next year');
  assert.deepEqual(p('Trip: X Dec 28 - Jan 3', T).trip, { start: '2026-12-28', end: '2027-01-03' }, 'end before start rolls the end');
  assert.deepEqual(p('Trip: Tahoe Nov 14-20', T).trip, { start: '2026-11-14', end: '2026-11-20' }, 'a trip under way stays this year');
  assert.equal(p('Trip: Lisbon', T).trip, null);
  assert.equal(p('Trip: Tahoe Feb 30-31', T).trip, null, 'impossible dates are not accepted');
});

test('home, custom place with coordinates, note', () => {
  assert.deepEqual(p('Home: Oakland, CA', T), { kind: 'home', name: '', group: null, cityQuery: 'Oakland, CA' });
  const r = p('Place: Yosemite in Mariposa @37.5,-119.6', T);
  assert.deepEqual([r.kind, r.name, r.cityQuery, r.coords], ['place', 'Yosemite', 'Mariposa', { lat: 37.5, lon: -119.6 }]);
  assert.equal(p('Maya in Portland | likes ski', T).note, 'likes ski');
});

test('extractDates takes a Date or an ISO string and ignores plain numbers', () => {
  assert.equal(extractDates('Springfield', T), null);
  assert.equal(extractDates('Route 66', T), null);
  assert.deepEqual(extractDates('Tahoe Nov 27', new Date(2026, 10, 17)), { rest: 'Tahoe', start: '2026-11-27', end: '2026-11-27' });
});

// ---- W3-07: a place several matches answer to is never picked (design spec 8.2, UX-6) ----
import fs from 'node:fs';
import * as gaz from '../../../site/js/pins/gazetteer.js';
import { resolvePlace, kindWord } from '../../../site/js/pins/picker.js';

const geo = (f) => JSON.parse(fs.readFileSync(new URL('../../../site/geo/' + f, import.meta.url), 'utf8'));
gaz.setData(geo('cities.json'), geo('places-extra.json'));

test('resolvePlace: Tahoe and Portland are a choice, never settled for the person', async () => {
  for (const q of ['Tahoe', 'Portland']) {
    const r = await resolvePlace(q, gaz);
    assert.equal(r.state, 'choose', q);
    assert.equal(r.city, undefined, q + ': no place was picked');
  }
  const tahoe = (await resolvePlace('Tahoe', gaz)).found.map((c) => c.name);
  for (const want of ['North Lake Tahoe', 'South Lake Tahoe', 'Lake Tahoe']) assert.ok(tahoe.includes(want), want + ' in ' + tahoe);
});

test('resolvePlace: a qualified or unshared name is settled; nothing is none; curated entries say region', async () => {
  const pdx = await resolvePlace('Portland, OR', gaz);
  assert.equal(pdx.state, 'one'); assert.equal(pdx.city.admin, 'OR');
  assert.equal((await resolvePlace('Seattle', gaz)).state, 'one');
  assert.equal((await resolvePlace('Zzzzqqq', gaz)).state, 'none');
  const north = (await resolvePlace('Tahoe', gaz)).found.find((c) => c.name === 'North Lake Tahoe');
  assert.equal(kindWord(north), 'region');
});
