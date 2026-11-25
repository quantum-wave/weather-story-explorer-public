// N24 SEARCH: typo-tolerant gazetteer search, the curated San Mateo / Santa Cruz coast places, and the opt-in online search.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as gz from '../../../site/js/pins/gazetteer.js';
import { resolvePlace, kindWord } from '../../../site/js/pins/picker.js';
import * as online from '../../../site/js/pins/online.js';

const read = (rel) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const doc = read('../../../site/geo/cities.json');
const extra = read('../../../site/geo/places-extra.json');
gz.setData(doc, extra);
const km = (a, b) => { const k = Math.PI / 180, x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k), y = (b.lat - a.lat) * k; return 6371 * Math.hypot(x, y); };

test('editDistance: Damerau (optimal string alignment) with an early exit past max', () => {
  assert.equal(gz.editDistance('coastanoa', 'costanoa'), 1, 'one extra letter');
  assert.equal(gz.editDistance('seatle', 'seattle'), 1);
  assert.equal(gz.editDistance('pescadaro', 'pescadero'), 1, 'one substitution');
  assert.equal(gz.editDistance('protland', 'portland'), 1, 'an adjacent transposition is one edit');
  assert.equal(gz.editDistance('abc', 'abc'), 0);
  assert.equal(gz.editDistance('kitten', 'sitting'), 3);
  assert.equal(gz.editDistance('kitten', 'sitting', 1), 2, 'returns max + 1 once it must exceed max');
  assert.equal(gz.editDistance('a', 'abcdef', 2), 3, 'length gap alone exceeds max');
  assert.deepEqual([1, 3, 4, 7, 8, 12].map(gz.fuzzyMax), [0, 0, 1, 1, 2, 2], 'none under 4 letters, one for 4-7, two for 8+');
});

test('typo: "coastanoa" finds Costanoa first, flagged fuzzy; the typo only suggests (resolvePlace says choose)', async () => {
  const r = gz.searchSync('coastanoa', 5);
  assert.ok(r.length >= 1);
  assert.equal(gz.cityLabel(r[0]), 'Costanoa, CA');
  assert.equal(r[0].fuzzy, true);
  assert.equal(r[0].kind, 'lodge');
  assert.equal(kindWord(r[0]), 'lodge', 'not "ski area"');
  const rp = await resolvePlace('coastanoa', gz);
  assert.equal(rp.state, 'choose', 'a typo guess is never settled for the person');
  assert.equal(rp.fuzzy, true);
  // typed right it is settled and carries no fuzzy flag
  const ok = gz.searchSync('Costanoa', 5);
  assert.equal(ok[0].name, 'Costanoa'); assert.equal(ok[0].fuzzy, undefined);
  assert.equal(ok.length, 1, 'beside a real match only one-edit names are added, and none is that close: ' + ok.map(gz.cityLabel));
  assert.equal((await resolvePlace('Costanoa', gz)).state, 'one');
  // a qualifier still works with a typo
  assert.equal(gz.cityLabel(gz.searchSync('coastanoa, CA', 3)[0]), 'Costanoa, CA');
  assert.equal(gz.cityLabel(gz.searchSync('coastanoa ca', 3)[0]), 'Costanoa, CA');
});

test('typo: other misspellings land; exact and prefix matches still rank first; short and nonsense queries stay empty', () => {
  const first = (q) => { const c = gz.searchSync(q, 5)[0]; return c ? gz.cityLabel(c) + (c.fuzzy ? '*' : '') : ''; };
  assert.equal(first('seatle'), 'Seattle, WA*');
  assert.equal(first('pescadaro'), 'Pescadero, CA*');
  assert.equal(first('halfmoon bay'), 'Half Moon Bay, CA*');
  assert.equal(first('big basn'), 'Big Basin Redwoods State Park, CA*');
  assert.equal(first('portlnd'), 'Portland, OR*');
  // exact / prefix first: every non-fuzzy result comes before every fuzzy one
  for (const q of ['Pescadero', 'kings be', 'tahoe ci', 'Costanoa', 'big basin', 'Portland', 'Tahoe']) {
    const r = gz.searchSync(q, 8);
    const k = r.findIndex((c) => c.fuzzy);
    assert.ok(k === -1 || r.slice(k).every((c) => c.fuzzy), q + ': ' + r.map((c) => gz.cityLabel(c) + (c.fuzzy ? '*' : '')).join(' | '));
    assert.ok(r.length && !r[0].fuzzy, q + ' leads with a real match');
  }
  assert.equal(gz.searchSync('Portland', 8).filter((c) => c.fuzzy).length, 0, 'a well-answered query runs no fuzzy pass');
  assert.deepEqual(gz.searchSync('qzxqzx', 5), []);
  assert.deepEqual(gz.searchSync('Nowhereville', 5), [], 'S-PINS relies on this staying empty');
  assert.deepEqual(gz.searchSync('sfa', 5).filter((c) => c.fuzzy), [], 'three letters are never fuzzy-matched');
});

test('typo: a fuzzy search is fast too (best-of-9 under 5 ms on the Mac; number reported)', () => {
  const qs = ['coastanoa', 'pescadaro', 'halfmoon bay', 'big basn', 'sna francisco', 'zqxvbn cove'];
  for (const q of qs) gz.searchSync(q, 8);
  let worstBest = 0, worstMedian = 0;
  for (const q of qs) {
    const ds = [];
    for (let k = 0; k < 9; k++) { const t = performance.now(); gz.searchSync(q, 8); ds.push(performance.now() - t); }
    ds.sort((x, y) => x - y); worstBest = Math.max(worstBest, ds[0]); worstMedian = Math.max(worstMedian, ds[4]);
  }
  console.log(`# fuzzy search: slowest query best-of-9 ${worstBest.toFixed(2)} ms, median ${worstMedian.toFixed(2)} ms`);
  if (process.platform === 'darwin' && !process.env.CI) assert.ok(worstBest < 5, 'best-of-9 ' + worstBest.toFixed(2) + ' ms');
  else assert.ok(worstMedian < 50, 'CI sanity bound');
});

test('coast places: each resolves by name within 1 km of its cited coordinate; cited entries carry url, date and a check', () => {
  const want = {
    Costanoa: [37.1569, -122.3491], Pescadero: [37.25494, -122.38136], 'San Gregorio': [37.32717, -122.38664], 'Davenport, CA': [37.01162, -122.19191],
    'Ano Nuevo': [37.13306, -122.33306], 'Big Basin': [37.1725, -122.2225], 'Butano State Park': [37.21333, -122.30972], 'Pigeon Point': [37.18175, -122.39392],
    'Half Moon Bay': [37.46, -122.43], 'Santa Cruz, CA': [36.97, -122.03],
  };
  for (const [q, [lat, lon]] of Object.entries(want)) {
    const c = gz.searchSync(q, 1)[0];
    assert.ok(c && !c.fuzzy, q + ' found');
    assert.ok(km(c, { lat, lon }) <= 1, `${q}: ${gz.cityLabel(c)} is ${km(c, { lat, lon }).toFixed(2)} km from the source`);
    assert.equal(c.admin, 'CA');
  }
  const cited = extra.places.filter((p) => p.source.type === 'cited');
  assert.ok(cited.length >= 8);
  for (const p of cited) {
    assert.match(p.source.url, /^https:\/\/(en\.wikipedia\.org|www\.openstreetmap\.org|geocoding-api\.open-meteo\.com)\//, p.name);
    assert.match(p.source.fetched, /^\d{4}-\d{2}-\d{2}$/, p.name);
    assert.ok(p.source.check && p.source.check.length > 10, p.name + ' names a cross-check');
  }
  assert.equal(gz.nearestSync(37.157, -122.349).name, 'Pescadero', 'a hold at Costanoa names the nearest town, not the lodge');
});

test('online: the request carries only the typed text and a count', () => {
  const u = new URL(online.geocodeUrl('  Coastanoa Point  '));
  assert.equal(u.origin + u.pathname, 'https://geocoding-api.open-meteo.com/v1/search');
  assert.deepEqual([...u.searchParams.keys()].sort(), ['count', 'name']);
  assert.equal(u.searchParams.get('name'), 'Coastanoa Point');
  assert.equal(u.searchParams.get('count'), '5');
});

test('online: results are snapshots (two decimals, om- ids, US state and CA province letters)', () => {
  const got = online.parseGeocode({ results: [
    { id: 5382215, name: 'Pescadero', latitude: 37.25494, longitude: -122.38136, country_code: 'US', admin1: 'California', population: 643, timezone: 'x' },
    { id: 1, name: 'Tofino', latitude: 49.1529, longitude: -125.9066, country_code: 'CA', admin1: 'British Columbia' },
    { id: 2, name: 'Pescadero', latitude: 22.18836, longitude: -105.32577, country_code: 'MX', admin1: 'Nayarit' },
    { id: 3, name: '', latitude: 1, longitude: 1, country_code: 'US' }, { id: 4, name: 'Bad', latitude: 'x', longitude: 1, country_code: 'US' }, null,
  ] });
  assert.deepEqual(got, [
    { id: 'om-5382215', name: 'Pescadero', admin: 'CA', cc: 'US', lat: 37.25, lon: -122.38, online: true },
    { id: 'om-1', name: 'Tofino', admin: 'BC', cc: 'CA', lat: 49.15, lon: -125.91, online: true },
    { id: 'om-2', name: 'Pescadero', admin: '', cc: 'MX', lat: 22.19, lon: -105.33, online: true },
  ]);
  assert.equal(gz.cityLabel(got[1]), 'Tofino, BC');
  assert.deepEqual(online.parseGeocode({}), []);
  assert.deepEqual(online.parseGeocode(null), []);
  // the stored pin keeps only the snapshot fields
  assert.deepEqual(Object.keys(gz.snapshotCity(got[0])).sort(), ['admin', 'cc', 'id', 'lat', 'lon', 'name']);
});

test('online: fails quietly (blocked, offline, HTTP error, bad JSON, slow); sends no cookies and no referrer', async () => {
  const calls = [];
  const ok = await online.searchOnline('Coastanoa', { fetchFn: async (url, o) => { calls.push([url, o]); return { ok: true, json: async () => ({ results: [{ id: 9, name: 'X', latitude: 1, longitude: 2, country_code: 'US', admin1: 'Oregon' }] }) }; } });
  assert.deepEqual(ok, { ok: true, places: [{ id: 'om-9', name: 'X', admin: 'OR', cc: 'US', lat: 1, lon: 2, online: true }] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], online.geocodeUrl('Coastanoa'));
  assert.equal(calls[0][1].credentials, 'omit'); assert.equal(calls[0][1].referrerPolicy, 'no-referrer');
  assert.deepEqual(Object.keys(calls[0][1]).filter((k) => !['credentials', 'referrerPolicy', 'cache', 'signal'].includes(k)), [], 'no headers or body');
  const logged = []; const ce = console.error, cw = console.warn; console.error = (...a) => logged.push(a); console.warn = (...a) => logged.push(a);
  try {
    assert.deepEqual(await online.searchOnline('x y', { fetchFn: async () => { throw new TypeError('Failed to fetch (CSP)'); } }), { ok: false });
    assert.deepEqual(await online.searchOnline('x y', { fetchFn: () => { throw new Error('sync throw'); } }), { ok: false });
    assert.deepEqual(await online.searchOnline('x y', { fetchFn: async () => ({ ok: false, status: 429 }) }), { ok: false });
    assert.deepEqual(await online.searchOnline('x y', { fetchFn: async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } }) }), { ok: false });
    const slow = await online.searchOnline('x y', { timeoutMs: 20, fetchFn: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted')))) });
    assert.deepEqual(slow, { ok: false }, 'times out');
    assert.deepEqual(await online.searchOnline('x', { fetchFn: async () => { throw new Error('must not be called'); } }), { ok: false }, 'one letter is not searched');
  } finally { console.error = ce; console.warn = cw; }
  assert.deepEqual(logged, [], 'fails quietly: nothing logged');
  assert.equal(online.UNAVAILABLE, "Online search isn't available here.");
});

test('quick add never adds a typo guess by itself: "Zork" (York is one edit away) and "Maya in Seatle" stay unresolved', async () => {
  const { createPins } = await import('../../../site/js/pins/index.js');
  const m = new Map(); const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
  const pins = createPins({ storage, today: () => '2026-11-24' });
  assert.equal(gz.searchSync('Zork', 1)[0]?.fuzzy, true, 'precondition: the search does suggest something for Zork');
  for (const line of ['Zork', 'Maya in Seatle']) {
    const r = await pins.quickAdd(line);
    assert.deepEqual([r.ok, r.reason], [false, 'no-city'], line);
  }
  assert.equal(pins.all().length, 0);
  assert.equal((await pins.quickAdd('Maya in Seattle')).ok, true, 'spelled right it adds');
});
