// WP2 data module (Node): decode, blend, sampling against the real sample fixture and the synthetic one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { artifactTmp } from '../lib/artifacts.mjs';

const site = new URL('../../../site/js/', import.meta.url);
const load = (p) => import(new URL(p, site).href);
const fixtures = new URL('../fixtures/', import.meta.url).pathname;

const shim = (dir) => async (url) => {
  const f = path.join(dir, url.replace(/^data\//, ''));
  if (!fs.existsSync(f)) return { ok: false, status: 404 };
  const buf = fs.readFileSync(f);
  return { ok: true, status: 200, json: async () => JSON.parse(buf.toString()), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
const open = async (name) => {
  const data = await load('data/index.js');
  data._reset({ fetch: shim(path.join(fixtures, name)) });
  const m = await data.loadManifest();
  return { data, m };
};
const loadAll = async (data, m) => {
  for (const [f, meta] of Object.entries(m.fields)) for (const d of meta.domains) await data.ensureAll(f, d);
};

// reference encoder (mirrors the frozen format in contract.js)
function encodeFrames(frs, nx, ny, filter) {
  const n = nx * ny, raw = new Uint8Array(n * 2 * frs.length);
  frs.forEach((fr, f) => {
    const b = f * n * 2;
    for (let j = 0; j < ny; j++) {
      let prev = 0;
      for (let i = 0; i < nx; i++) {
        const v = fr[j * nx + i] & 0xffff;
        if (filter === 'none') { raw[b + 2 * (j * nx + i)] = v & 255; raw[b + 2 * (j * nx + i) + 1] = v >> 8; continue; }
        const d = (v - prev) & 0xffff; prev = v;
        raw[b + j * nx + i] = d & 255; raw[b + n + j * nx + i] = d >> 8;
      }
    }
  });
  return raw;
}

test('decode: dx-shuffle and none round-trip, bad magic rejected, fflate fallback agrees', async () => {
  const { unfilter, gunzip, decodeChunk } = await load('data/decode.js');
  const { fflate } = await load('vendor.js');
  const nx = 7, ny = 5, frs = [0, 1].map((f) => Int16Array.from({ length: nx * ny }, (_, k) => ((k * 7919 + f * 104729) % 65536) - 32768));
  for (const filter of ['dx-shuffle', 'none']) {
    const gz = fflate.gzipSync(encodeFrames(frs, nx, ny, filter));
    for (const forceFflate of [false, true]) {
      const out = await decodeChunk(gz, { nx, ny, nFrames: 2, filter }, { forceFflate });
      assert.deepEqual(out.map((a) => Array.from(a)), frs.map((a) => Array.from(a)), `${filter} fflate=${forceFflate}`);
    }
  }
  await assert.rejects(() => gunzip(new Uint8Array([1, 2, 3, 4])), /magic/);
  assert.throws(() => unfilter(new Uint8Array(10), nx, ny, 1, 'none'), /chunk size/);
});

for (const name of ['sample-min', 'synthetic']) {
  test(`data: every manifest probe matches the decoded value (${name})`, async () => {
    const { data, m } = await open(name);
    await loadAll(data, m);
    assert.ok(m.probes.length > 0);
    for (const p of m.probes) {
      const meta = m.fields[p.field], d = m.domains[p.domain];
      const f = data.fieldAt(p.field, p.domain, p.step);
      assert.ok(f, `${p.field} ${p.domain} step ${p.step} decodes`);
      const i = Math.round(((((p.lon - d.lon0) % 360) + 360) % 360) / d.dlon), j = Math.round((p.lat - d.lat0) / d.dlat);
      assert.ok(Math.abs(f[j * d.nx + i] - p.value) <= meta.scale, `${p.name} ${p.field}: ${f[j * d.nx + i]} vs ${p.value}`);
    }
  });
}

test('data: fieldAt blends the field own adjacent steps, null outside and when not loaded', async () => {
  const { data, m } = await open('sample-min');
  const { cubicAt } = await load('data/interp.js');
  assert.equal(data.fieldAt('z500a', 'np05', 6), null, 'not loaded yet');
  await data.ensure('z500a', 'np05', 6);
  const steps = data.fieldSteps('z500a');
  assert.deepEqual(steps, [0, 12, 24, 36]);
  const a = Float32Array.from(data.fieldAt('z500a', 'np05', 0));
  const b = Float32Array.from(data.fieldAt('z500a', 'np05', 12));
  const c = Float32Array.from(data.fieldAt('z500a', 'np05', 24));
  // between 0 and 12 h: the monotone cubic through 0, 12 and 24 h (no step before 0), inside the two bracketing values
  const mid = data.fieldAt('z500a', 'np05', 6);
  let checked = 0;
  for (let k = 0; k < a.length; k += 97) {
    if (a[k] === a[k] && b[k] === b[k] && c[k] === c[k]) {
      assert.ok(Math.abs(mid[k] - cubicAt(6, 0, a[k], 12, b[k], null, { t: 24, v: c[k] })) < 1e-3, 'node ' + k);
      assert.ok(mid[k] >= Math.min(a[k], b[k]) - 1e-3 && mid[k] <= Math.max(a[k], b[k]) + 1e-3, 'inside the bracket at node ' + k);
      checked++;
    }
  }
  assert.ok(checked > 100);
  const q = data.fieldAt('z500a', 'np05', 9); // 3/4 of the way 0 -> 12
  const k0 = 60 * m.domains.np05.nx + 100;
  assert.ok(Math.abs(q[k0] - cubicAt(9, 0, a[k0], 12, b[k0], null, { t: 24, v: c[k0] })) < 1e-3);
  assert.equal(data.fieldAt('z500a', 'np05', 37), null, 'beyond the last step');
  assert.equal(data.fieldAt('z500a', 'np05', -1), null);
  assert.equal(data.fieldAt('nope', 'np05', 0), null);
  assert.equal(data.fieldAt('z500a', 'g1', 0), null, 'other domain not loaded');
});

test('data: no blending across a gap longer than 12 h (a partial run must not show a made-up frame)', async () => {
  const dir = artifactTmp('wp2-gap-');
  try {
    const src = path.join(fixtures, 'sample-min');
    for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dir, f));
    const mp = path.join(dir, 'manifest.json'), man = JSON.parse(fs.readFileSync(mp, 'utf8'));
    man.fields.z500a.steps = [0, 12, 24, 168]; // the last step is 144 h after the one before it
    fs.writeFileSync(mp, JSON.stringify(man));
    const data = await load('data/index.js');
    data._reset({ fetch: shim(dir) });
    await data.loadManifest();
    await data.ensureAll('z500a', 'np05');
    assert.ok(data.fieldAt('z500a', 'np05', 18), 'inside a 12 h interval still blends');
    assert.ok(data.fieldAt('z500a', 'np05', 168), 'the step itself is real data');
    assert.equal(data.fieldAt('z500a', 'np05', 100) === null, true, 'inside the 144 h gap there is no frame');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('data: nodata decodes to NaN (case B covers only part of np05)', async () => {
  const { data } = await open('sample-min');
  await data.ensure('ws250', 'np05', 0);
  const f = data.fieldAt('ws250', 'np05', 3);
  const nan = f.reduce((n, v) => n + (v !== v ? 1 : 0), 0);
  assert.ok(nan > 1000 && nan < f.length, `some but not all nodata: ${nan}`);
});

test('data: sampleSeries, maxWithin, spread, valid time, case, loaded ranges', async () => {
  const { data, m } = await open('sample-min');
  const [lat, lon] = [37.77, -122.42];
  const empty = data.sampleSeries('z500a', lat, lon);
  assert.ok(empty.values.every((v) => v !== v), 'nothing loaded: all NaN, and loading has started');
  assert.deepEqual(data.loadedRanges('z500a'), []);
  await data.ensureAll('z500a', 'np05'); await data.ensureAll('z500sd', 'np05'); await data.ensureAll('ws250', 'np05');
  assert.deepEqual(data.loadedRanges('z500a'), [[0, 36]]);
  const s = data.sampleSeries('z500a', lat, lon);
  assert.deepEqual(s.steps, [0, 12, 24, 36]);
  const d = m.domains.np05;
  const gi = (((lon - d.lon0) % 360) + 360) % 360 / d.dlon, gj = (lat - d.lat0) / d.dlat;
  for (let k = 0; k < 4; k++) {
    const f = data.fieldAt('z500a', 'np05', s.steps[k]);
    const i0 = Math.floor(gi), j0 = Math.floor(gj), fx = gi - i0, fy = gj - j0, n = d.nx;
    const want = (f[j0 * n + i0] * (1 - fx) + f[j0 * n + i0 + 1] * fx) * (1 - fy) + (f[(j0 + 1) * n + i0] * (1 - fx) + f[(j0 + 1) * n + i0 + 1] * fx) * fy;
    assert.ok(Math.abs(s.values[k] - want) < 1e-3, `series step ${k}: ${s.values[k]} vs ${want}`);
  }
  assert.ok(data.sampleSeries('z500a', 5, 100), 'g1 holds places outside np05 (series exists, loading started)');
  assert.equal(data.sampleSeries('ws250', 60, 100), null, 'ws250 exists only on np05; this place is outside it');
  assert.equal(data.sampleSeries('nope', lat, lon), null);
  // maxWithin: never below the value at the place, never above the global maximum
  const mx = data.maxWithin('ws250', 25, -75, 300, 2);
  assert.ok(mx > 5 && mx < 120, `ws250 max within 300 km: ${mx}`);
  assert.ok(data.maxWithin('ws250', 25, -75, 900, 2) >= mx);
  assert.equal(data.maxWithin('ws250', 25, -75, 300, 99), null);
  // domain spread: z500sd mean in gpm, finite for case A steps
  const sp = data.sampleDomainSpread();
  assert.deepEqual(sp.steps, [0, 12, 24, 36]);
  assert.ok(sp.values.every((v) => v > 0.1 && v < 10), 'ERA5 EDA spread is about a metre: ' + Array.from(sp.values));
  // time and case
  // sample mode shows the case's REAL dates, never the run rebased to today (SAMPLE MODE HONESTY)
  assert.equal(data.validTime(0, 'A').toISOString(), '2017-01-01T00:00:00.000Z');
  assert.equal(data.validTime(24, 'A').toISOString(), '2017-01-02T00:00:00.000Z');
  assert.equal(data.validTime(24).toISOString(), '2017-01-02T00:00:00.000Z', 'active case defaults to A');
  assert.equal(data.validTime(6, 'B').toISOString(), '2017-09-05T18:00:00.000Z', 'Irma case');
  assert.equal(data.validTime(12, 'C').toISOString(), '2013-01-01T12:00:00.000Z', 'motion demo case');
  assert.ok(data.validTime(0, 'A').getUTCFullYear() < 2020, 'never a date near today');
  assert.equal(data.realValidTime('z500a', 6).toISOString(), '2017-01-01T06:00:00.000Z');
  assert.equal(data.realValidTime('z500a', 99), null);
  assert.deepEqual(data.caseOf('ws250').id, 'B');
  assert.equal(data.caseOf('nope'), null);
});

test('data: loadManifest sets sample and emits data:manifest; chunk events fire', async () => {
  const { store, bus } = await load('state.js');
  const data = await load('data/index.js');
  data._reset({ fetch: shim(path.join(fixtures, 'synthetic')) });
  let got = null, chunks = [];
  const off = bus.on('data:manifest', (m) => { got = m; }), off2 = bus.on('data:chunk', (c) => chunks.push(c));
  await data.loadManifest();
  await data.ensure('z500', 'g1', 0);
  off(); off2();
  assert.equal(got.sample, true);
  assert.equal(store.get().sample, true);
  assert.deepEqual(chunks, [{ field: 'z500', domain: 'g1', chunk: 'a' }]);
  await assert.rejects(() => data.loadManifest('data/missing.json'), /404/);
  store._reset();
});

test('data: concurrent ensure fetches a chunk once; a failed fetch is retried; unknown field or domain resolve quietly', async () => {
  const data = await load('data/index.js');
  const inner = shim(path.join(fixtures, 'sample-min'));
  const calls = []; let failNext = false;
  data._reset({ fetch: async (u) => { calls.push(u); if (failNext && u.endsWith('.bin')) { failNext = false; return { ok: false, status: 503 }; } return inner(u); } });
  await data.loadManifest();
  await Promise.all([data.ensure('z500a', 'np05', 0), data.ensure('z500a', 'np05', 12), data.ensure('z500a', 'np05', 30)]);
  assert.equal(calls.filter((u) => u.endsWith('z500a.np05.a.bin')).length, 1, 'one request for one chunk');
  await data.ensure('nope', 'np05', 0); await data.ensure('ws250', 'g1', 0); await data.ensure('z500a', 'np05', 999);
  failNext = true;
  await assert.rejects(() => data.ensure('z500sd', 'np05', 0), /503/);
  await data.ensure('z500sd', 'np05', 0);
  assert.ok(data.fieldAt('z500sd', 'np05', 0), 'the retry succeeded');
  data._reset();
});

test('data: a live (non-sample) manifest keeps run + t; a sample without dates falls back to the run', async () => {
  const data = await load('data/index.js');
  const dir = path.join(fixtures, 'sample-min');
  const m0 = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const serve = (mut) => async (url) => {
    if (!url.endsWith('manifest.json')) return shim(dir)(url);
    const m = structuredClone(m0); mut(m);
    return { ok: true, status: 200, json: async () => m };
  };
  data._reset({ fetch: serve((m) => { m.sample = false; m.run = '2026-11-20T00:00Z'; delete m.cases; }) });
  await data.loadManifest();
  assert.equal(data.validTime(24).toISOString(), '2026-11-21T00:00:00.000Z');
  assert.equal(data.caseOrigin(), null, 'a live manifest has no case origin');
  data._reset({ fetch: serve((m) => { for (const f of Object.values(m.fields)) f.source.valid = null; }) });
  await data.loadManifest();
  assert.equal(data.validTime(0, 'A').toISOString(), '2026-11-17T00:00:00.000Z', 'undated sample falls back to the run');
});

// ---------- W3-09: ensemble blend for the map and the story, dataset kinds, visible failures ----------

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
/** Bilinear value of a frame at a place (the same arithmetic the series uses), from the domain in the manifest. */
async function bil(frame, d, lat, lon) {
  const { toGrid, bilinear } = await load('data/grid.js');
  const [gi, gj] = toGrid(d, lon, lat);
  return bilinear(frame, d, gi, gj);
}

test('blend: patternField weights are 0 at 168 h, 0.5 at 204 h, 1 at 240 h (z500 and z500a), from the stored frames', async () => {
  const { data, m } = await open('synthetic-15d');
  assert.equal(data.hasMean(), true);
  await data.ensureAll('z500', 'g1'); await data.ensureAll('z500a', 'g1'); await data.ensureAll('z500em', 'g1');
  const n = m.domains.g1.nx * m.domains.g1.ny;
  for (const [t, w, src] of [[0, 0, 'hres'], [150, 0, 'hres'], [168, 0, 'blend'], [204, 0.5, 'blend'], [240, 1, 'mean'], [300, 1, 'mean']]) {
    const z = Float32Array.from(data.storedFieldAt('z500', 'g1', t)), za = Float32Array.from(data.storedFieldAt('z500a', 'g1', t));
    const em = t >= 144 ? Float32Array.from(data.storedFieldAt('z500em', 'g1', t)) : null;
    const pz = data.patternField('z500', 'g1', t), pa = data.patternField('z500a', 'g1', t);
    assert.equal(data.patternSource(t), src, `source at ${t} h`);
    let checked = 0;
    for (let k = 0; k < n; k += 53) {
      const e = em ? em[k] : 0;
      const wantZ = z[k] + w * (e - z[k]), wantA = za[k] + w * (e - z[k]); // anomaly of the mean: z500em - (z500 - z500a)
      if (!(wantZ === wantZ)) continue;
      near(pz[k], wantZ, 1e-3, `z500 ${t} h node ${k}`); near(pa[k], wantA, 1e-3, `z500a ${t} h node ${k}`); checked++;
    }
    assert.ok(checked > 100, `${checked} nodes checked at ${t} h`);
  }
  assert.equal(data.patternField('z500a', 'g1', 361), null, 'beyond the last step');
});

test('blend: the point series uses the same weights as the field (identical at the place)', async () => {
  const { data, m } = await open('synthetic-15d');
  await data.ensureAll('z500', 'g1'); await data.ensureAll('z500a', 'g1'); await data.ensureAll('z500em', 'g1');
  const [lat, lon] = [37.77, -122.42], d = m.domains.g1;
  for (const kind of ['z500a', 'z500']) {
    const s = data.patternSeries(kind, lat, lon);
    assert.deepEqual(s.steps, data.fieldSteps(kind));
    for (const t of [0, 162, 168, 174, 204, 222, 240, 300, 360]) {
      const i = s.steps.indexOf(t);
      const fromField = await bil(data.patternField(kind, 'g1', t), d, lat, lon);
      near(s.values[i], fromField, 1e-3, `${kind} series vs field at ${t} h`);
    }
    // the weights themselves: the series at 204 h is half way between the single run and the mean
    const raw = data.sampleSeries(kind, lat, lon), z = data.sampleSeries('z500', lat, lon), em = data.sampleSeries('z500em', lat, lon);
    const at = (S, t) => S.values[S.steps.indexOf(t)];
    for (const [t, w] of [[168, 0], [204, 0.5], [240, 1]]) near(s.values[s.steps.indexOf(t)], at(raw, t) + w * (at(em, t) - at(z, t)), 1e-3, `${kind} weight ${w} at ${t} h`);
  }
  assert.equal(data.patternSeries('nope', lat, lon), null);
});

test('blend: no mean in the run means the single run at every t, and hasMean() is false', async () => {
  const { data } = await open('synthetic-15d-nomean');
  assert.equal(data.hasMean(), false);
  await data.ensureAll('z500', 'g1'); await data.ensureAll('z500a', 'g1');
  for (const t of [0, 168, 204, 240, 300, 360]) {
    assert.equal(data.patternSource(t), 'hres', `source at ${t} h`);
    const p = data.patternField('z500a', 'g1', t), r = data.storedFieldAt('z500a', 'g1', t);
    for (let k = 0; k < p.length; k += 211) { if (r[k] === r[k]) near(p[k], r[k], 1e-6, `no-mean ${t} h`); }
  }
  const s = data.patternSeries('z500a', 37.77, -122.42), r = data.sampleSeries('z500a', 37.77, -122.42);
  assert.deepEqual(Array.from(s.values), Array.from(r.values), 'the series is the single run too');
  assert.deepEqual(data.missing().map((x) => x.field), ['z500em']);
  assert.ok(data.missing()[0].reason.length > 5);
});

test('blend: consecutive calls for different kinds return different buffers, and neither overwrites the other', async () => {
  const { data } = await open('synthetic-15d');
  for (const f of ['z500', 'z500a', 'z500em']) await data.ensureAll(f, 'g1');
  const a = data.patternField('z500a', 'g1', 204), copyA = Float32Array.from(a);
  const z = data.patternField('z500', 'g1', 204);
  assert.notEqual(a, z, 'different kinds, different buffers');
  assert.deepEqual(Array.from(a), Array.from(copyA), 'the second call did not overwrite the first');
  const pub = data.fieldAt('z500a', 'g1', 204);
  assert.deepEqual(Array.from(pub), Array.from(copyA), 'the public fieldAt for z500a is the blended map');
  assert.notEqual(data.fieldAt('z500', 'g1', 204), pub);
  const copyZ = Float32Array.from(z);
  data.patternField('z500a', 'g1', 210); // a later frame of one kind leaves the other kind's frame alone
  assert.deepEqual(Array.from(z), Array.from(copyZ), 'the z500 frame survives a z500a call at another time');
});

test('blend: ensure() loads the ensemble-mean chunks a blended frame needs', async () => {
  const data = await load('data/index.js');
  const inner = shim(path.join(fixtures, 'synthetic-15d')), calls = [];
  data._reset({ fetch: async (u) => { calls.push(u); return inner(u); } });
  await data.loadManifest();
  await data.ensure('z500a', 'g1', 100);
  assert.ok(!calls.some((u) => u.includes('z500em')), 'before day 7 the mean is not fetched');
  await data.ensure('z500a', 'g1', 204);
  assert.ok(calls.some((u) => u.includes('z500em.g1')), 'at 204 h the ensemble mean is fetched');
  assert.ok(data.patternField('z500a', 'g1', 204), 'and the blended frame is ready');
});

test('data:error is emitted for a corrupt chunk and for a missing one; the rejection stays; missing() reflects the manifest', async () => {
  const { bus } = await load('state.js');
  const data = await load('data/index.js');
  const inner = shim(path.join(fixtures, 'sample-min'));
  data._reset({ fetch: async (u) => {
    if (u.endsWith('z500a.np05.a.bin')) { const r = await inner(u); const b = new Uint8Array(await r.arrayBuffer()).slice(); b[0] = 0; return { ok: true, status: 200, arrayBuffer: async () => b.buffer }; }
    if (u.endsWith('z500sd.np05.a.bin')) return { ok: false, status: 404 };
    return inner(u);
  } });
  await data.loadManifest();
  assert.deepEqual(data.missing(), [], 'a manifest without a missing list reports none');
  const seen = []; const off = bus.on('data:error', (e) => seen.push(e));
  await assert.rejects(() => data.ensure('z500a', 'np05', 0), /gzip/);
  await assert.rejects(() => data.ensure('z500sd', 'np05', 0), /404/);
  off();
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map((e) => [e.field, e.domain, e.chunk]), [['z500a', 'np05', 'a'], ['z500sd', 'np05', 'a']]);
  assert.match(seen[0].message, /gzip/); assert.match(seen[1].message, /404/);
  data._reset();
});

test('kinds: no read of manifest.sample for cases; recorded (no cases) has an origin and valid times', async () => {
  const { data, m } = await open('recorded-min');
  assert.equal(m.sample, true); assert.equal(m.cases, undefined);
  assert.equal(data.activeCase(), null, 'a recorded forecast has no case');
  const o = data.caseOrigin();
  assert.ok(o instanceof Date, 'caseOrigin works without cases');
  assert.equal(o.toISOString(), '2026-11-17T00:00:00.000Z');
  assert.equal(data.caseOrigin('A')?.toISOString(), '2026-11-17T00:00:00.000Z', 'a stale case id from a hash is ignored');
  assert.equal(data.validTime(24).toISOString(), '2026-11-18T00:00:00.000Z');
  assert.equal(data.validTime(24, 'A').toISOString(), '2026-11-18T00:00:00.000Z');
  assert.equal(data.realValidTime('z500a', 12).toISOString(), '2026-11-17T12:00:00.000Z');
  const multi = await open('sample-min');
  assert.equal(multi.data.activeCase(), 'A', 'a multi-case manifest has its case A by default');
  const live = await open('synthetic-15d');
  assert.equal(live.data.activeCase(), 'A');
});

test('blend: a frame a caller holds is never overwritten by a later call, at or before 168 h or after (E-A6)', async () => {
  const { data } = await open('synthetic-15d');
  for (const f of ['z500', 'z500a', 'z500em']) await data.ensureAll(f, 'g1');
  const same = (a, b) => a.length === b.length && a.every((v, k) => v === b[k] || (v !== v && b[k] !== b[k]));
  for (const [first, second] of [[['z500', 100], ['z500a', 204]], [['z500a', 204], ['z500', 100]]]) {
    const held = data.fieldAt(first[0], 'g1', first[1]), copy = Float32Array.from(held);
    const later = data.fieldAt(second[0], 'g1', second[1]);
    assert.ok(same(held, copy), `fieldAt(${first}) survives fieldAt(${second}) (max change ${Math.max(...held.map((v, k) => Math.abs(v - copy[k]) || 0))})`);
    assert.ok(later && later !== held, 'a different buffer');
  }
  // the stored frame is not the pattern's buffer either: a pattern call at another time leaves a held storedFieldAt frame alone
  const raw = data.storedFieldAt('z500', 'g1', 100), rawCopy = Float32Array.from(raw);
  data.fieldAt('z500a', 'g1', 204); data.fieldAt('z500', 'g1', 204);
  assert.ok(same(raw, rawCopy), 'storedFieldAt frame survives pattern calls');
});

const openEdited = async (name, edit) => {
  const data = await load('data/index.js'), inner = shim(path.join(fixtures, name));
  data._reset({ fetch: async (u) => { const r = await inner(u); if (!/manifest\.json$/.test(u) || !r.ok) return r; const m = await r.json(); edit(m); return { ok: true, status: 200, json: async () => m }; } });
  const m = await data.loadManifest();
  return { data, m };
};

test('blend: a mean recorded on fewer domains than z500 still draws the pattern, resampled and announced (np05 without z500em)', async () => {
  const { data, m } = await open('synthetic-15d-em-g1only');
  const { bus } = await load('state.js'), notes = [], off = bus.on('data:mean', (e) => notes.push(e));
  assert.deepEqual(m.fields.z500em.domains, ['g1']);
  assert.equal(data.hasMean(), true); assert.equal(data.hasMean('np05'), true); assert.equal(data.hasMean('g1'), true);
  assert.equal(data.hasMean({ lat: 45, lon: -150 }), true, 'a place in the north Pacific');
  for (const f of ['z500', 'z500a']) await data.ensureAll(f, 'np05');
  await data.ensure('z500a', 'np05', 204); // loads the mean from g1 by itself
  const { toGrid, bilinear, nodeLonLat } = await load('data/grid.js');
  const g1 = m.domains.g1, np = m.domains.np05;
  for (const t of [150, 168, 180, 204, 240, 300]) {
    await data.ensure('z500a', 'np05', t); await data.ensure('z500', 'np05', t);
    const pa = data.patternField('z500a', 'np05', t), pz = data.patternField('z500', 'np05', t);
    assert.ok(pa && pz, `np05 draws at ${t} h (was null)`);
    assert.equal(data.patternSource(t, 'np05'), t < 168 ? 'hres' : t >= 240 ? 'mean' : 'blend');
    const w = t <= 168 ? 0 : t >= 240 ? 1 : (t - 168) / 72;
    const za = Float32Array.from(data.storedFieldAt('z500a', 'np05', t)), z = Float32Array.from(data.storedFieldAt('z500', 'np05', t));
    let checked = 0;
    const emG = Float32Array.from(data.storedFieldAt('z500em', 'g1', t)), zG = data.storedFieldAt('z500', 'g1', t), dzG = emG.map((v, q) => v - zG[q]);
    for (let j = 3; j < np.ny; j += 7) for (let i = 3; i < np.nx; i += 9) {
      const k = j * np.nx + i; if (!(za[k] === za[k])) continue;
      const [lo, la] = nodeLonLat(np, i, j), [gi, gj] = toGrid(g1, lo, la);
      const dz = bilinear(dzG, g1, gi, gj, NaN);
      if (t <= 168) assert.ok(Math.abs(pa[k] - za[k]) < 1e-3, 'single run up to 168 h');
      else { assert.ok(Math.abs(pa[k] - (za[k] + w * dz)) < 0.5, `z500a ${t} h node ${k}: ${pa[k]} vs ${za[k] + w * dz}`); assert.ok(Math.abs(pz[k] - (z[k] + w * dz)) < 0.5, 'z500'); }
      checked++;
    }
    assert.ok(checked > 30, `${checked} nodes checked`);
  }
  assert.equal(notes.length, 1, 'announced once: ' + JSON.stringify(notes));
  assert.deepEqual(notes[0], { domain: 'np05', source: 'resampled', from: 'g1' });
  // the point series for a place in np05 follows the same blend (the mean's own finest domain covers it)
  const s = data.patternSeries('z500a', 45, -150); assert.ok(s.values[s.steps.indexOf(204)] === s.values[s.steps.indexOf(204)]);
  off();
});

test('blend: no domain can supply the mean for a domain -> the single run, announced, never a blank frame or a silent blend', async () => {
  const { data } = await openEdited('synthetic-15d', (m) => { const em = m.fields.z500em; em.domains = ['np05']; em.chunks.forEach((c) => { delete c.files.g1; }); });
  const { bus } = await load('state.js'), notes = [], off = bus.on('data:mean', (e) => notes.push(e));
  assert.equal(data.hasMean(), true, 'the run has a mean somewhere'); assert.equal(data.hasMean('np05'), true); assert.equal(data.hasMean('g1'), false, 'but not one that covers g1');
  await data.ensureAll('z500a', 'g1'); await data.ensureAll('z500', 'g1');
  for (const t of [204, 300]) {
    assert.equal(data.patternSource(t, 'g1'), 'hres', `g1 at ${t} h says single run`);
    const p = data.patternField('z500a', 'g1', t), r = data.storedFieldAt('z500a', 'g1', t);
    assert.ok(p, `g1 draws at ${t} h`); for (let k = 0; k < p.length; k += 97) if (r[k] === r[k]) assert.ok(Math.abs(p[k] - r[k]) < 1e-6);
  }
  assert.deepEqual(notes, [{ domain: 'g1', source: 'none' }], 'announced once');
  off();
});
