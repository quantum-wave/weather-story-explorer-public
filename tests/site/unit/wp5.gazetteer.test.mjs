// WP5: the bundled gazetteer file and its search (site/geo/cities.json, built by tools/gazetteer).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as gz from '../../../site/js/pins/gazetteer.js';

const file = fileURLToPath(new URL('../../../site/geo/cities.json', import.meta.url));
const raw = fs.readFileSync(file);
const doc = JSON.parse(raw.toString('utf8'));
gz.setData(doc);
const labels = (q, n = 4) => gz.searchSync(q, n).map(gz.cityLabel);

test('file: under 600 KB gzipped, licence and attribution recorded, rows well formed and population sorted', () => {
  assert.ok(zlib.gzipSync(raw, { level: 9 }).length < 600 * 1024, 'gzipped size');
  assert.equal(doc.license, 'CC-BY-4.0');
  assert.match(doc.attribution, /GeoNames/);
  assert.deepEqual(doc.cols, ['id', 'name', 'admin', 'cc', 'lat', 'lon', 'pop100']);
  let prev = Infinity;
  for (const r of doc.rows) {
    assert.equal(r.length, 7);
    assert.ok(Number.isInteger(r[0]) && typeof r[1] === 'string' && r[3].length === 2);
    assert.ok(Math.abs(r[4]) <= 90 && Math.abs(r[5]) <= 180);
    assert.ok(r[6] <= prev); prev = r[6];
  }
  assert.ok(doc.rows.length > 20000);
});

test('file: no row-level personal data, only places (spot check of public cities)', () => {
  const sf = doc.rows.find((r) => r[0] === 5391959);
  assert.deepEqual(sf.slice(1, 6), ['San Francisco', 'CA', 'US', 37.77, -122.42]);
});

test('search: spec cases and ranking', () => {
  assert.equal(labels('Portland')[0], 'Portland, OR');
  assert.equal(labels('Tahoe')[0], 'South Lake Tahoe, CA', 'a prefix of any word matches');
  assert.equal(labels('portland or')[0], 'Portland, OR');
  assert.equal(labels('Portland, Maine')[0], 'Portland, ME');
  assert.equal(labels('lisbon')[0], 'Lisbon, Portugal');
  assert.equal(labels('zurich')[0], 'Zürich, Switzerland', 'accents fold');
  assert.equal(labels('london')[0], 'London, United Kingdom');
  assert.equal(labels('london ontario')[0], 'London, ON');
  assert.equal(labels('san fran')[0], 'San Francisco, CA');
  assert.equal(labels('SF')[0], 'San Francisco, CA');
  assert.equal(labels('Whistler')[0], 'Whistler, BC');
  assert.deepEqual(labels('qzxqzx'), []);
  assert.deepEqual(labels(''), []);
  assert.ok(gz.searchSync('san', 3).length === 3);
});

test('nearest: a point maps to a real city', () => {
  assert.equal(gz.cityLabel(gz.nearestSync(45.52, -122.68)), 'Portland, OR');
  assert.equal(gz.cityLabel(gz.nearestSync(38.93, -119.98)), 'South Lake Tahoe, CA');
  assert.ok(gz.nearestSync(0, -30), 'mid-ocean still answers');
});

test('snapshotCity rounds to two decimals and rejects junk', () => {
  assert.deepEqual(gz.snapshotCity({ id: 1, name: 'X', admin: 'CA', cc: 'US', lat: 37.77493, lon: -122.41942 }), { id: 1, name: 'X', admin: 'CA', cc: 'US', lat: 37.77, lon: -122.42 });
  assert.equal(gz.snapshotCity({ lat: 'x', lon: 1 }), null);
  assert.equal(gz.snapshotCity({ lat: 91, lon: 1 }), null);
  assert.equal(gz.snapshotCity(null), null);
});

test('byId resolves a GeoNames id (number or c-prefixed) after loading; unknown ids give null', async () => {
  const sea = await gz.byId('c5809844');
  assert.equal(sea.name, 'Seattle');
  assert.equal((await gz.byId(5809844)).name, 'Seattle');
  assert.equal(await gz.byId('c1'), null);
  assert.equal(gz.gazetteer.byId, gz.byId, 'also on the gazetteer object');
});
