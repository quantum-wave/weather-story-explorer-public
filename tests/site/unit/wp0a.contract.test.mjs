// Interface guard: every frozen export (PLAN Interfaces) exists with the right type. Prints STUBS OK.
// Stays valid after stubs are replaced; a package that drops or renames an export fails here.
import test from 'node:test';
import assert from 'node:assert/strict';

const site = new URL('../../../site/js/', import.meta.url);
const load = (p) => import(new URL(p, site).href);
const expectFns = (mod, names) => { for (const n of names) assert.equal(typeof mod[n], 'function', `${n} is a function`); };

test('contract.js constants', async () => {
  const c = await load('contract.js');
  assert.deepEqual(c.DOMAIN_IDS, ['g1', 'np05']);
  assert.deepEqual(c.VIEWS, { np: 'np05', nh: 'g1', gl: 'g1' });
  assert.deepEqual(c.LAYER_CODES, { z: 'z500a', j: 'ws250', c: 'z500sd', t: 't2a' });
  assert.equal(c.NODATA, -32768);
  assert.equal(c.STORE_KEY, 'wse.v1.store');
  assert.ok(c.HASH_RE.test('np-zj-2026112212-sf') && !c.HASH_RE.test('Bad Hash') && !c.HASH_RE.test('a'.repeat(65)));
  for (const h of ['settings', 'sidebar', 'customize', 'upgrade', 'downloads', 'comment-12']) assert.ok(c.isReservedHash(h), h);
  assert.ok(!c.isReservedHash('np-z'));
  assert.ok(c.domainWraps({ nx: 361, dlon: 1 }) && !c.domainWraps({ nx: 321, dlon: 0.5 }));
});

test('state.js store and bus', async () => {
  const { store, bus } = await load('state.js');
  store._reset();
  const seen = [];
  const off = store.subscribe((s, p) => seen.push(p));
  store.set({ t: 6, layers: { j: true } });
  assert.equal(store.get().t, 6);
  assert.deepEqual(store.get().layers, { z: true, j: true, c: false, t: false });
  off(); store.set({ t: 12 });
  assert.equal(seen.length, 1);
  let got; const offB = bus.on('pin:focus', (d) => { got = d; }); bus.emit('pin:focus', { pinId: 'p1' }); offB();
  assert.deepEqual(got, { pinId: 'p1' });
  for (const k of ['view', 'layers', 'case', 't', 'playing', 'speed', 'focus', 'theme', 'sheet', 'sample']) assert.ok(k in store.get(), k);
  store._reset();
});

test('vendored libraries import', async () => {
  const v = await load('vendor.js');
  assert.equal(v.d3.version, '7.9.2');
  assert.equal(typeof v.topojson.feature, 'function');
  expectFns(v.gifenc, ['GIFEncoder', 'quantize', 'applyPalette']);
  expectFns(v.fflate, ['gunzipSync', 'gzipSync']);
});

test('module interfaces (STUBS OK)', async () => {
  expectFns(await load('data/index.js'), ['loadManifest', 'ensure', 'fieldAt', 'fieldSteps', 'sampleSeries', 'maxWithin', 'sampleDomainSpread', 'validTime', 'caseOf']);
  expectFns(await load('render/index.js'), ['createRenderer']);
  const cm = await load('render/colormap.js'); expectFns(cm, ['anomalyRGBA', 'jetRGBA']); assert.ok(Array.isArray(cm.STOPS));
  expectFns(await load('render/legend.js'), ['drawLegend']);
  expectFns(await load('time/clock.js'), ['play', 'pause', 'toggle', 'step', 'seek', 'tweenTo', 'setSpeed', 'range']);
  expectFns(await load('time/keys.js'), ['installKeys']);
  expectFns(await load('time/scrubber.js'), ['mountScrubber']);
  expectFns(await load('time/debug.js'), ['installDebug']);
  expectFns(await load('story/index.js'), ['classifyDay', 'summarize', 'dayLine', 'notability', 'buildDays', 'stripSVG']);
  const { pins } = await load('pins/index.js');
  expectFns(pins, ['all', 'trips', 'groups', 'home', 'setHome', 'add', 'update', 'remove', 'addTrip', 'copyAllText', 'pasteLines', 'exportCSV', 'storageOk']);
  expectFns((await load('pins/gazetteer.js')).gazetteer, ['search', 'nearest']);
  expectFns(await load('pins/quickadd.js'), ['parseQuickAdd']);
  expectFns(await load('pins/overlay.js'), ['pinOverlay']);
  expectFns(await load('links.js'), ['formatHash', 'parseHash', 'copyLink']);
  expectFns(await load('share/index.js'), ['shareMeta', 'exportStill', 'exportLoop', 'deliver']);
  console.log('STUBS OK');
});
