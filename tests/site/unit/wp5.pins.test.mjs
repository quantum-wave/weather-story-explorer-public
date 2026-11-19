// WP5: pins, trips, groups, storage, copy-all round trip, CSV (fictional people only).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as gz from '../../../site/js/pins/gazetteer.js';
import { createPins } from '../../../site/js/pins/index.js';
import { STORE_KEY } from '../../../site/js/contract.js';
import { toCSV, csvText } from '../../../site/js/pins/format.js';

gz.setData(JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../../site/geo/cities.json', import.meta.url)), 'utf8')));
const TODAY = '2026-11-17';
const mem = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };
const make = (storage = mem()) => ({ storage, pins: createPins({ storage, today: () => TODAY }) });
const nobus = { emit() {} };

test('add, edit, group, remove with undo', async () => {
  const { pins } = make();
  const r = await pins.quickAdd('Maya in Portland');
  assert.equal(r.ok, true);
  const p = pins.get(r.id);
  assert.deepEqual([p.kind, p.name, p.city.name, p.city.admin, p.group], ['person', 'Maya', 'Portland', 'OR', '']);
  assert.ok(pins.update(r.id, { name: 'Maya R', group: 'friends', note: 'fictional' }));
  assert.deepEqual([pins.get(r.id).name, pins.get(r.id).group, pins.get(r.id).note], ['Maya R', 'friends', 'fictional']);
  pins.update(r.id, { group: 'no-such-group' });
  assert.equal(pins.get(r.id).group, '', 'an unknown group falls back to none');
  const undo = pins.remove(r.id);
  assert.equal(pins.all().length, 0);
  assert.equal(undo(), true);
  assert.equal(pins.all().length, 1);
  assert.equal(undo(), false, 'undo works once');
});

test('trips: quick add resolves South Lake Tahoe, edit keeps start <= end, remove with undo', async () => {
  const { pins } = make();
  const r = await pins.quickAdd('Trip: Tahoe Nov 27-30');
  const t = pins.get(r.id);
  assert.deepEqual([t.label, t.city.name, t.start, t.end], ['Tahoe', 'South Lake Tahoe', '2026-11-27', '2026-11-30']);
  pins.update(r.id, { start: '2026-12-05' });
  assert.deepEqual([pins.get(r.id).start, pins.get(r.id).end], ['2026-12-05', '2026-12-05']);
  assert.equal(pins.addTrip({ label: 'x', city: t.city, start: 'nope', end: 'nope' }), null);
  const undo = pins.remove(r.id); assert.equal(pins.trips().length, 0); undo(); assert.equal(pins.trips().length, 1);
});

test('groups: defaults, add, remove with undo, groupFor creates on no match', async () => {
  const { pins } = make();
  assert.deepEqual(pins.groups().map((g) => g.id), ['family', 'friends', 'work']);
  const id = pins.addGroup('Climbing crew');
  assert.equal(id, 'climbing-crew');
  assert.equal(pins.addGroup('climbing CREW'), id, 'no duplicate by name');
  const r = await pins.quickAdd('#climbing-crew Sam in Austin, TX');
  assert.equal(pins.get(r.id).group, 'climbing-crew');
  const r2 = await pins.quickAdd('#fam Ana in Boise');
  assert.equal(pins.get(r2.id).group, 'family', 'unique prefix matches');
  const r3 = await pins.quickAdd('#cousins Lee in Denver');
  assert.equal(pins.get(r3.id).group, 'cousins');
  const undo = pins.removeGroup('climbing-crew');
  assert.equal(pins.get(r.id).group, '');
  undo(); assert.equal(pins.get(r.id).group, 'climbing-crew');
});

test('no match leaves the store alone and says why', async () => {
  const { pins } = make();
  const r = await pins.quickAdd('Zork');
  assert.deepEqual([r.ok, r.reason, r.query], [false, 'no-city', 'Zork']);
  assert.equal(pins.all().length, 0);
  const t = await pins.quickAdd('Trip: Lisbon');
  assert.equal(t.reason, 'dates');
  const picked = await pins.quickAdd('Trip: Lisbon', { trip: { start: '2026-12-01', end: '2026-12-04' } });
  assert.equal(picked.ok, true, 'date inputs complete a trip typed without dates');
});

test('storage: reload keeps pins; unreadable JSON is set aside, not crashed on', async () => {
  const { storage, pins } = make();
  await pins.quickAdd('Maya in Portland'); await pins.quickAdd('Trip: Tahoe Nov 27-30');
  const again = createPins({ storage, today: () => TODAY });
  assert.deepEqual([again.all().length, again.trips().length], [1, 1]);
  assert.equal(again.storageOk(), true);
  storage.setItem(STORE_KEY, '{not json');
  const broken = createPins({ storage, today: () => TODAY });
  assert.equal(broken.all().length, 0);
  assert.equal(storage.getItem(STORE_KEY + '.unreadable'), '{not json');
  assert.equal(broken.home().name, 'San Francisco');
});

test('storage fallbacks: localStorage throws -> session, both throw -> memory; quota error keeps data', async () => {
  const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const s = mem();
  const a = createPins({ storage: { localStorage: boom, sessionStorage: s }, today: () => TODAY });
  await a.quickAdd('Maya in Portland');
  assert.deepEqual([a.storageKind(), a.storageOk(), s.m.has(STORE_KEY)], ['session', false, true]);
  const b = createPins({ storage: { localStorage: boom, sessionStorage: boom }, today: () => TODAY });
  await b.quickAdd('Maya in Portland');
  assert.deepEqual([b.storageKind(), b.storageOk(), b.all().length], ['memory', false, 1]);
  const c = createPins({ storage: { get localStorage() { throw new Error('SecurityError'); } }, today: () => TODAY });
  assert.equal(c.storageKind(), 'memory');
  const full = mem(); const realSet = full.setItem; let fail = false;
  full.setItem = (k, v) => { if (fail && k === STORE_KEY) throw new Error('QuotaExceededError'); realSet(k, v); };
  const q = createPins({ storage: full, today: () => TODAY });
  await q.quickAdd('Maya in Portland'); fail = true;
  await q.quickAdd('Sam in Austin, TX');
  assert.deepEqual([q.all().length, q.storageOk(), q.storageKind()], [2, false, 'memory']);
});

test('copy all -> clear -> paste restores everything (round trip)', async () => {
  const { pins } = make();
  await pins.quickAdd('Home: Oakland, CA');
  await pins.quickAdd('#friends Maya in Portland | fictional');
  await pins.quickAdd('Sam in Austin, TX');
  await pins.quickAdd('Lisbon');
  await pins.quickAdd('Place: Squaw in Tahoe @39.2,-120.2');
  await pins.quickAdd('Trip: Ski in Banff Dec 3-7');
  const text = pins.copyAllText();
  const snap = JSON.stringify([pins.all().map(({ id, updated, ...r }) => r), pins.trips().map(({ id, updated, ...r }) => r), pins.home()]);
  pins.clearAll();
  assert.equal(pins.all().length + pins.trips().length, 0);
  const res = await pins.pasteLines(text);
  assert.equal(res.unresolved.length, 0, JSON.stringify(res.unresolved));
  const snap2 = JSON.stringify([pins.all().map(({ id, updated, ...r }) => r), pins.trips().map(({ id, updated, ...r }) => r), pins.home()]);
  assert.equal(snap2, snap);
  assert.equal(pins.copyAllText(), text);
  const again = await pins.pasteLines(text);
  assert.equal(again.duplicates, 5, 'pasting twice adds no duplicates');
});

test('paste: lists what it could not resolve, adds the rest', async () => {
  const { pins } = make();
  const r = await pins.pasteLines('Maya in Portland\n\nZork in Nowhereville\nTrip: Lisbon\nSam in Austin, TX\n');
  assert.equal(r.added, 2);
  assert.deepEqual(r.unresolved.map((u) => u.line), ['Zork in Nowhereville', 'Trip: Lisbon']);
  assert.match(r.unresolved[0].reason, /no city called Nowhereville/);
  assert.match(r.unresolved[1].reason, /dates/);
});

test('CSV: header, numbers stay numbers, text cells that start a formula get an apostrophe, quotes and commas are escaped', () => {
  assert.equal(csvText('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvText('+1'), "'+1");
  assert.equal(csvText('-x'), "'-x");
  assert.equal(csvText('@home'), "'@home");
  assert.equal(csvText('a,"b"'), '"a,""b"""');
  const city = { id: 1, name: 'Portland', admin: 'OR', cc: 'US', lat: 45.52, lon: -122.68 };
  const csv = toCSV({ groups: [{ id: 'friends', name: 'Friends', hue: 200 }], pins: [{ id: 'p1', kind: 'person', name: '=cmd()', group: 'friends', city, note: 'x, "y"' }], trips: [] });
  const [head, row] = csv.trim().split('\r\n');
  assert.equal(head, 'type,name,group,city,region,country,lat,lon,start,end,note');
  assert.equal(row, `person,'=cmd(),Friends,Portland,OR,US,45.52,-122.68,,,"x, ""y"""`);
});

test('focusOf: a person yields no placeRef and only a city name; places and trips carry a gazetteer ref', async () => {
  const { pins } = make();
  const person = (await pins.quickAdd('Maya in Portland')).id;
  const place = (await pins.quickAdd('Lisbon')).id;
  const trip = (await pins.quickAdd('Trip: Tahoe Nov 27-30')).id;
  assert.deepEqual(pins.focusOf(person), { lat: 45.52, lon: -122.68, label: 'Portland', kind: 'person', placeRef: null });
  assert.match(pins.focusOf(place).placeRef, /^c\d+$/);
  assert.equal(pins.focusOf(trip).kind, 'trip');
  assert.equal(pins.focusOf('home').label, 'San Francisco');
  assert.equal(pins.focusOf('nope'), null);
});

test('backup prompt appears with the tenth pin and returns after ten more', async () => {
  const { pins } = make();
  for (let i = 0; i < 9; i++) pins.add({ name: 'P' + i, city: { id: 1, name: 'X', lat: 1, lon: 1 } });
  assert.equal(pins.needsBackupPrompt(), false);
  pins.add({ name: 'P9', city: { id: 1, name: 'X', lat: 1, lon: 1 } });
  assert.equal(pins.needsBackupPrompt(), true);
  pins.dismissBackupPrompt();
  assert.equal(pins.needsBackupPrompt(), false);
  for (let i = 0; i < 10; i++) pins.add({ name: 'Q' + i, city: { id: 1, name: 'X', lat: 1, lon: 1 } });
  assert.equal(pins.needsBackupPrompt(), true);
});

test('300 pins and 50 trips: add, persist and copy in well under a second', async () => {
  const { storage, pins } = make();
  const city = gz.searchSync('Seattle', 1)[0];
  const t0 = performance.now();
  for (let i = 0; i < 300; i++) pins.add({ name: 'Person ' + i, group: 'work', city });
  for (let i = 0; i < 50; i++) pins.addTrip({ label: 'Trip ' + i, city, start: '2026-12-01', end: '2026-12-03' });
  const text = pins.copyAllText();
  assert.equal(text.split('\n').length, 350);
  assert.ok(performance.now() - t0 < 1500);
  assert.equal(createPins({ storage }).all().length, 300);
});

test('pin names are data only: a name that looks like markup is stored verbatim', async () => {
  const { pins } = make();
  const id = pins.add({ name: '<img src=x onerror=alert(1)>', city: { id: 1, name: 'X', lat: 1, lon: 1 } });
  assert.equal(pins.get(id).name, '<img src=x onerror=alert(1)>');
});
