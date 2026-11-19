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
  assert.equal(data.fieldAt('z500a', 'np05', 6), null, 'not loaded yet');
  await data.ensure('z500a', 'np05', 6);
  const steps = data.fieldSteps('z500a');
  assert.deepEqual(steps, [0, 12, 24, 36]);
  const a = Float32Array.from(data.fieldAt('z500a', 'np05', 0));
  const b = Float32Array.from(data.fieldAt('z500a', 'np05', 12));
  const mid = data.fieldAt('z500a', 'np05', 6);
  let checked = 0;
  for (let k = 0; k < a.length; k += 97) { if (a[k] === a[k] && b[k] === b[k]) { assert.ok(Math.abs(mid[k] - (a[k] + b[k]) / 2) < 1e-3); checked++; } }
  assert.ok(checked > 100);
  const q = data.fieldAt('z500a', 'np05', 9); // 3/4 of the way 0 -> 12
  const k0 = 60 * m.domains.np05.nx + 100;
  assert.ok(Math.abs(q[k0] - (a[k0] * 0.25 + b[k0] * 0.75)) < 1e-3);
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
