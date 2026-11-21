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
  assert.deepEqual(c.VIEWS, { np: 'np05', nh: 'g1', gl: 'g1', wm: 'g1' });
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
  store.set({ t: 6, overlays: { jetline: true } });
  assert.equal(store.get().t, 6);
  assert.deepEqual(store.get().overlays, { contours: true, marks: true, doubt: true, jetline: true, pins: true, places: true });
  off(); store.set({ t: 12 });
  assert.equal(seen.length, 1);
  let got; const offB = bus.on('pin:focus', (d) => { got = d; }); bus.emit('pin:focus', { pinId: 'p1' }); offB();
  assert.deepEqual(got, { pinId: 'p1' });
  for (const k of ['view', 'overlays', 't', 'playing', 'speed', 'focus', 'theme', 'sheet', 'sample']) assert.ok(k in store.get(), k);
  for (const k of ['layers', 'case']) assert.ok(!(k in store.get()), `${k} is retired (W4-01)`);
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

test('W3-09: contract lists the new field ids and lens codes; old hashes open as lens plus overlay', async () => {
  const c = await load('contract.js'), g = await load('share/hashgrammar.js');
  for (const f of ['z500em', 'pr1', 'pr10', 't2m']) assert.ok(c.FIELD_IDS.includes(f), f);
  assert.deepEqual(c.LENS_CODES, ['z', 'j', 's', 'a', 'r', 'c']);
  assert.deepEqual(Object.keys(c.LENS_FILL).sort(), [...c.LENS_CODES].sort());
  assert.equal(c.LENS_FILL.z, 'z500a'); assert.equal(c.LENS_FILL.j, 'ws250');
  const old = g.parseHash('#np-zj-2026112212-sf');
  assert.equal(old.lens, 'z'); assert.equal(old.jetline, true); assert.deepEqual(old.layers, { z: true, j: true, c: false, t: false });
  const jet = g.parseHash('#np-j-2017090600');
  assert.equal(jet.lens, 'j'); assert.equal(jet.jetline, false);
  assert.equal(g.parseHash('#np-t-2026112212').lens, 'a', 'the retired 2 m anomaly layer reads as Air mass');
  assert.equal(g.parseHash('#np-0-2026112212').lens, null);
  assert.equal(g.parseHash('#gl-sj-2026112212').lens, 's');
  assert.equal(g.parseHash('#np-ss-2026112212'), null);
  assert.equal(g.buildHash({ view: 'np', lens: 'z', jetline: true, layers: {}, validTime: '2026112212', place: 'sf' }), '#np-zj-2026112212-sf');
  assert.equal(g.buildHash({ view: 'nh', lens: 'j', jetline: true, layers: {}, validTime: '2026112212' }), '#nh-j-2026112212');
  assert.equal(g.buildHash({ view: 'np', lens: 'r', layers: {}, validTime: '2026112212' }), '#np-r-2026112212');
});
