// W1-02 (Josh points 1, 8, 15, 16): the new fixtures decoded independently of site code. Every probe of every fixture is
// decoded and compared with the manifest; the named probes carry their meaning (a band, a clear signal, a rain sequence...);
// grids, steps, spread, amplitude and sizes are pinned; the committed files regenerate byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { artifactTmp } from '../lib/artifacts.mjs';

const root = new URL('../../../', import.meta.url).pathname;
const fxRoot = path.join(root, 'tests/site/fixtures');
const NEW = ['synthetic-15d', 'synthetic-15d-nomean', 'synthetic-hires-48h', 'synthetic-partial', 'recorded-min'];
const ALL = ['synthetic', 'sample-min', ...NEW];
const NODATA = -32768;

const manifests = {};
const man = (n) => (manifests[n] ??= JSON.parse(fs.readFileSync(path.join(fxRoot, n, 'manifest.json'), 'utf8')));
const chunkCache = new Map();
function frames(name, fid, dom, ci) {
  const m = man(name), f = m.fields[fid], ch = f.chunks[ci], d = m.domains[dom];
  const key = `${name}/${ch.files[dom].path}`;
  if (!chunkCache.has(key)) {
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(fxRoot, name, ch.files[dom].path)));
    const n = d.nx * d.ny, nf = ch.steps[1] - ch.steps[0];
    assert.equal(raw.length, nf * n * 2, key);
    const out = [];
    for (let k = 0; k < nf; k++) {
      const seg = raw.subarray(k * n * 2, (k + 1) * n * 2), q = new Int16Array(n);
      for (let y = 0; y < d.ny; y++) {
        let acc = 0;
        for (let x = 0; x < d.nx; x++) {
          const i = y * d.nx + x;
          acc = (acc + ((seg[n + i] << 8) | seg[i])) & 0xFFFF;
          q[i] = acc >= 0x8000 ? acc - 0x10000 : acc;
        }
      }
      out.push(q);
    }
    chunkCache.set(key, out);
  }
  return chunkCache.get(key);
}
/** Whole decoded frame (physical values, NaN for no data). */
function frame(name, fid, dom, step) {
  const m = man(name), f = m.fields[fid];
  const idx = f.steps.indexOf(step);
  assert.ok(idx >= 0, `${name} ${fid} has step ${step}`);
  const ci = f.chunks.findIndex((c) => c.steps[0] <= idx && idx < c.steps[1]);
  const q = frames(name, fid, dom, ci)[idx - f.chunks[ci].steps[0]];
  return Float64Array.from(q, (v) => (v === NODATA ? NaN : v * f.scale + f.offset));
}
function at(name, fid, dom, step, lat, lon) {
  const d = man(name).domains[dom];
  const i = Math.round((((lon - d.lon0) % 360) + 360) % 360 / d.dlon), j = Math.round((lat - d.lat0) / d.dlat);
  assert.ok(i >= 0 && i < d.nx && j >= 0 && j < d.ny, `${name} ${dom} point inside the grid`);
  const v = frame(name, fid, dom, step)[j * d.nx + i];
  return Number.isNaN(v) ? null : Math.round(v * 1e6) / 1e6;
}
const probe = (name, pname, dom, step, field) => {
  const p = man(name).probes.find((x) => x.name === pname && x.domain === dom && (step === undefined || x.step === step) && (!field || x.field === field));
  assert.ok(p, `${name}: probe ${pname} ${dom} ${step ?? ''}`);
  return p;
};
const dirBytes = (n) => fs.readdirSync(path.join(fxRoot, n)).reduce((s, f) => s + fs.statSync(path.join(fxRoot, n, f)).size, 0);

test('every probe of every fixture decodes to its manifest value', () => {
  let n = 0;
  for (const name of ALL) {
    const m = man(name);
    assert.ok(m.probes.length > 0, `${name} lists probes`);
    for (const p of m.probes) {
      assert.equal(at(name, p.field, p.domain, p.step, p.lat, p.lon), p.value, `${name} ${p.name} ${p.field} ${p.domain} ${p.step}`);
      n++;
    }
  }
  assert.ok(n > 150, `decoded ${n} probes`);
});

test('every new manifest says synthetic and is a sample', () => {
  for (const name of NEW) {
    const m = man(name);
    assert.equal(m.sample, true, name);
    assert.match(m.sample_note, /synthetic/i, name);
    assert.match(m.model, /synthetic/i, name);
    assert.match(m.attribution, /synthetic/i, name);
  }
});

const hrs = (a, b, s) => Array.from({ length: Math.floor((b - a) / s) + 1 }, (_, i) => a + i * s);

test('synthetic-15d: grids, steps and field set', () => {
  const m = man('synthetic-15d');
  assert.deepEqual(m.domains.g1, { lon0: -180, lat0: 90, dlon: 2, dlat: -2, nx: 181, ny: 91 });
  assert.deepEqual(m.domains.np05, { lon0: 150, lat0: 75, dlon: 1, dlat: -1, nx: 161, ny: 66 });
  const all = hrs(0, 360, 6);
  for (const f of ['z500', 'z500a', 'z500sd', 'ws250', 'msl']) { assert.deepEqual(m.fields[f].steps, all, f); assert.deepEqual(m.fields[f].domains, ['g1', 'np05'], f); }
  assert.deepEqual(m.fields.z500em.steps, hrs(144, 360, 6)); assert.deepEqual(m.fields.z500em.domains, ['g1', 'np05']);
  assert.deepEqual(m.fields.tp6.steps, hrs(6, 360, 6)); assert.deepEqual(m.fields.tp6.domains, ['g1']);
  assert.deepEqual(m.fields.t850a.steps, hrs(0, 168, 6)); assert.deepEqual(m.fields.t2m.steps, hrs(0, 168, 6));
  assert.deepEqual(m.fields.t2m.domains, ['g1']);
  assert.deepEqual(m.fields.pr1.steps, hrs(24, 360, 12)); assert.deepEqual(m.fields.pr10.steps, hrs(24, 360, 12));
  assert.equal(m.fields.pr1.steps.length, 29);
  assert.deepEqual(m.fields.pr1.domains, ['g1']);
  assert.deepEqual(m.fields.ivt.steps, hrs(0, 168, 6)); assert.deepEqual(m.fields.ivt.domains, ['g1', 'np05']);
  assert.equal(m.missing, undefined);
});

test('synthetic-15d: anomaly reaches +-30 dam, spread grows from 0.2 to 8.7 dam, z500em carries the mean', () => {
  let hi = -1e9, lo = 1e9;
  for (const dom of ['g1', 'np05']) for (const s of hrs(0, 360, 6)) for (const v of frame('synthetic-15d', 'z500a', dom, s)) { if (v > hi) hi = v; if (v < lo) lo = v; }
  assert.ok(hi >= 300 && hi <= 450, `max anomaly ${hi} gpm`); assert.ok(lo <= -300 && lo >= -450, `min anomaly ${lo} gpm`);
  const sd = (dom, s) => frame('synthetic-15d', 'z500sd', dom, s);
  for (const dom of ['g1', 'np05']) {
    const a = sd(dom, 0), b = sd(dom, 360);
    assert.ok(Math.min(...a) >= 1.9 && Math.max(...a) <= 2.1, `0 h spread ${Math.min(...a)}..${Math.max(...a)} gpm`);
    assert.ok(Math.max(...b) >= 86 && Math.max(...b) <= 88, `360 h max spread ${Math.max(...b)} gpm`);
    assert.ok(Math.max(...sd(dom, 180)) > Math.max(...a) && Math.max(...sd(dom, 180)) < Math.max(...b), 'spread grows with lead');
  }
  // the ensemble mean has its own values: not the run's z500, and its anomaly is the pattern damped with lead (MET-14).
  for (const dom of ['g1', 'np05']) for (const s of [144, 216, 300, 360]) {
    const em = frame('synthetic-15d', 'z500em', dom, s), z = frame('synthetic-15d', 'z500', dom, s), za = frame('synthetic-15d', 'z500a', dom, s);
    let diff = 0, emAnom = 0, hAnom = 0;
    for (let i = 0; i < em.length; i++) {
      diff = Math.max(diff, Math.abs(em[i] - z[i]));
      emAnom = Math.max(emAnom, Math.abs(em[i] - (z[i] - za[i]))); hAnom = Math.max(hAnom, Math.abs(za[i]));
    }
    assert.ok(diff > 50, `${dom} ${s} h: z500em differs from z500 (max |diff| ${diff} gpm)`);
    assert.ok(emAnom < hAnom, `${dom} ${s} h: mean anomaly ${emAnom} is damped against the run's ${hAnom} gpm`);
  }
});

// mean anomaly of a z500em probe: z500em - (z500 - z500a) at the same node and step (DESIGN-SPEC 15)
const meanAnom = (N, dom, step, lat, lon) => at(N, 'z500em', dom, step, lat, lon) - (at(N, 'z500', dom, step, lat, lon) - at(N, 'z500a', dom, step, lat, lon));
// 2 dam bands: the index of the band a gpm anomaly falls in (0 = the unshaded +-2 dam gap)
const bandOf = (g) => Math.sign(g) * Math.floor(Math.abs(g) / 20);

test('synthetic-15d: no-signal and clear-signal are defined on the mean anomaly, off every band edge', () => {
  const N = 'synthetic-15d';
  for (const dom of ['g1', 'np05']) {
    const ns = probe(N, 'no-signal', dom, 300, 'z500a'), nm = probe(N, 'no-signal.mean', dom, 300, 'z500em'), nsd = probe(N, 'no-signal.spread', dom, 300, 'z500sd');
    const nAnom = meanAnom(N, dom, 300, nm.lat, nm.lon);
    assert.ok(nsd.value >= 40, `no-signal spread ${nsd.value} gpm is at least 4 dam`);
    assert.ok(Math.abs(nAnom) < nsd.value, `|mean anomaly ${nAnom}| < spread ${nsd.value}`);
    // inside the +-2 dam no-fill gap by 1 dam on both the run and the mean, so "No clear signal yet" has to beat "near normal"
    assert.ok(Math.abs(ns.value) <= 10 && Math.abs(nAnom) <= 10, `no-signal run ${ns.value}, mean ${nAnom} gpm: well inside +-20`);
    const cm = probe(N, 'clear-signal.mean', dom, 300, 'z500em'), csd = probe(N, 'clear-signal.spread', dom, 300, 'z500sd');
    const cAnom = meanAnom(N, dom, 300, cm.lat, cm.lon);
    assert.ok(Math.abs(cAnom) >= 120 && Math.abs(cAnom) > csd.value, `clear: |mean anomaly ${cAnom}| vs spread ${csd.value}`);
  }
});

test('synthetic-15d: blend-bands puts the run, the 0.5 blend and the mean in three different 2 dam bands at 204 h', () => {
  const N = 'synthetic-15d';
  for (const dom of ['g1', 'np05']) {
    const hres = probe(N, 'blend-bands', dom, 204, 'z500a').value, em = probe(N, 'blend-bands.mean', dom, 204, 'z500em'), z = probe(N, 'blend-bands.z500', dom, 204, 'z500');
    const mean = em.value - (z.value - hres), blend = (hres + mean) / 2;
    assert.deepEqual([hres, mean, blend], [170, 50, 110]);
    assert.equal(new Set([bandOf(hres), bandOf(mean), bandOf(blend)]).size, 3, `bands ${bandOf(hres)}, ${bandOf(blend)}, ${bandOf(mean)}`);
    for (const g of [hres, mean, blend]) assert.ok(Math.abs(g) % 20 >= 5 && Math.abs(g) % 20 <= 15, `${g} gpm is off a band edge`);
    // the same holds at the blend's weights 0 / 0.5 / 1 (168 / 204 / 240 h) on the decoded fields
    for (const s of [168, 204, 240]) assert.equal(meanAnom(N, dom, s, 50, 160), 50);
  }
});

test('synthetic-15d: home tp6 agrees with pr1 (dry days 1-3 under 1 mm, wet days 4-7)', () => {
  const N = 'synthetic-15d';
  for (let d = 1; d <= 7; d++) {
    const ps = man(N).probes.filter((p) => p.name === `home-tp6-d${d}` && p.field === 'tp6');
    assert.deepEqual(ps.map((p) => p.step), [0, 6, 12, 18].map((k) => 24 * (d - 1) + k + 6), `day ${d} has its four 6 h steps`);
    const sum = ps.reduce((a, p) => a + p.value, 0);
    if (d <= 3) assert.ok(sum < 1, `day ${d} dry: ${sum} mm`); else assert.ok(sum >= 10, `day ${d} wet: ${sum} mm`);
    const pr = probe(N, `home-rain-d${d}`, 'g1', 24 * d).value;
    assert.ok(d <= 3 ? pr <= 5 : pr >= 60, `day ${d}: pr1 ${pr} agrees with tp6 ${sum}`);
    // and the decoded field, not only the manifest
    let dec = 0; for (const p of ps) dec += at(N, 'tp6', 'g1', p.step, p.lat, p.lon);
    assert.ok(Math.abs(dec - sum) < 1e-9);
  }
});

test('synthetic-15d: home local days (longitude rounded to the hour, nearest pr1 window end) are dry 1-3 and rain likely 4-7', () => {
  const N = 'synthetic-15d', m = man(N);
  const home = m.probes.find((p) => p.name === 'home-rain-d1');
  const off = Math.round(home.lon / 15) * 60;  // offsetMinutes: longitude rounded to the hour (DESIGN-SPEC 15 buildDays)
  assert.equal(off, 0, 'home local days run on the 00Z run, same as UTC days');
  const stepsPr = m.fields.pr1.steps;
  for (let d = 1; d <= 7; d++) {
    const dayStart = 24 * (d - 1) + off / 60, dayEnd = dayStart + 24;  // local day d in forecast hours (offset 0)
    const win = stepsPr.reduce((best, s) => (Math.abs(s - dayEnd) < Math.abs(best - dayEnd) ? s : best));
    const v = at(N, 'pr1', 'g1', win, home.lat, home.lon);
    const tp = [6, 12, 18, 24].reduce((a, k) => a + at(N, 'tp6', 'g1', dayStart + k, home.lat, home.lon), 0);
    if (d <= 3) { assert.ok(v <= 5, `day ${d} pr1 ${v} at ${win} h`); assert.ok(tp < 1, `day ${d} tp ${tp}`); }
    else { assert.ok(v >= 60, `day ${d} pr1 ${v} at ${win} h`); assert.ok(tp >= 10, `day ${d} tp ${tp}`); }
  }
});

test('synthetic-15d probes: bands, signal, SF day 9, rain, filament, low, no-data block', () => {
  const N = 'synthetic-15d';
  for (const dom of ['g1', 'np05']) {
    assert.equal(probe(N, 'band+6.9dam', dom, 0).value, 69);
    assert.equal(probe(N, 'band-13dam', dom, 0).value, -130);
    assert.equal(probe(N, 'band+1dam', dom, 0).value, 10);
    assert.equal(probe(N, 'band+11dam', dom, 0).value, 110);
    assert.equal(probe(N, 'band+11dam', dom, 300).value, 110);
    const ns = probe(N, 'no-signal', dom, 300, 'z500a'), nsd = probe(N, 'no-signal.spread', dom, 300, 'z500sd');
    assert.ok(Math.abs(ns.value) < nsd.value, `no signal: |${ns.value}| < spread ${nsd.value}`);
    const cl = probe(N, 'clear-signal', dom, 300, 'z500a'), csd = probe(N, 'clear-signal.spread', dom, 300, 'z500sd');
    assert.ok(Math.abs(cl.value) >= 120 && Math.abs(cl.value) > csd.value, `clear: ${cl.value} vs spread ${csd.value}`);
    assert.ok(probe(N, 'sf-day9', dom, 216).value < 0, 'SF day 9 is a trough');
    assert.ok(probe(N, 'ivt-filament', dom, 0).value > 750);
    assert.ok(probe(N, 'closed-low', dom, 0).value < 99000);
    assert.equal(probe(N, 'band+6.9dam', dom, 0).field, 'z500a');
  }
  const rain = (d) => probe(N, `home-rain-d${d}`, 'g1', 24 * d);
  for (const d of [1, 2, 3]) assert.ok(rain(d).value <= 5, `day ${d} dry: ${rain(d).value}`);
  for (const d of [4, 5, 6, 7]) assert.ok(rain(d).value >= 60, `day ${d} wet: ${rain(d).value}`);
  assert.equal(rain(1).field, 'pr1');
  for (const d of [1, 2, 3, 4, 5, 6, 7]) assert.ok(probe(N, `home-rain-d${d}.pr10`, 'g1', 24 * d, 'pr10').value <= rain(d).value);
  // the closed low is closed: every node 14 degrees out is higher than the 990 hPa line, and the centre is the minimum nearby
  const msl = frame(N, 'msl', 'g1', 0), d = man(N).domains.g1;
  const lowp = probe(N, 'closed-low', 'g1', 0);
  const ci = Math.round((lowp.lon - d.lon0) / d.dlon), cj = Math.round((lowp.lat - d.lat0) / d.dlat);
  let ringMin = 1e9; for (let k = 0; k < 360; k += 5) {
    const i = Math.round(ci + (14 * Math.cos(k * Math.PI / 180)) / d.dlon), j = Math.round(cj + (14 * Math.sin(k * Math.PI / 180)) / d.dlat);
    ringMin = Math.min(ringMin, msl[j * d.nx + i]);
  }
  assert.ok(ringMin > 99000 && ringMin > lowp.value + 1000, `ring ${ringMin} Pa above the low ${lowp.value}`);
  // t850a no-data block over the Rockies
  assert.equal(probe(N, 't850a-nodata', 'g1', 0).value, null);
  assert.equal(at(N, 't850a', 'g1', 0, 40, -110), null);
  assert.equal(at(N, 't850a', 'g1', 168, 44, -106), null);
  assert.notEqual(probe(N, 't850a-valid', 'g1', 0).value, null);
  const t = frame(N, 't850a', 'g1', 0), nan = t.filter(Number.isNaN).length;
  assert.ok(nan >= 20 && nan < 120, `${nan} no-data nodes, a block not a hole in everything`);
});

test('synthetic-15d-nomean: the same without z500em, and says so', () => {
  const a = man('synthetic-15d'), b = man('synthetic-15d-nomean');
  assert.equal(b.fields.z500em, undefined);
  assert.deepEqual(Object.keys(b.fields).sort(), Object.keys(a.fields).filter((f) => f !== 'z500em').sort());
  assert.deepEqual(b.missing.map((x) => x.field), ['z500em']); assert.ok(b.missing[0].reason.length > 5);
  for (const f of Object.keys(b.fields)) assert.deepEqual(b.fields[f].steps, a.fields[f].steps, f);
  assert.deepEqual(b.domains, a.domains);
  assert.equal(at('synthetic-15d-nomean', 'z500a', 'g1', 300, 56, -80), 110);
});

test('synthetic-partial: 0-48 h only, z500sd missing', () => {
  const m = man('synthetic-partial');
  assert.ok(!m.fields.z500sd);
  assert.deepEqual(m.missing.map((x) => x.field), ['z500sd']);
  for (const [fid, f] of Object.entries(m.fields)) assert.ok(Math.max(...f.steps) <= 48, `${fid} ends by 48 h`);
  assert.deepEqual(m.fields.z500a.steps, hrs(0, 48, 6));
  assert.ok(m.fields.z500 && m.fields.ws250 && m.fields.msl);
});

test('recorded-min: a recorded-shape sample with a label, no cases, pattern fields only, 0-240 h twice daily', () => {
  const m = man('recorded-min');
  assert.equal(m.sample, true); assert.equal(typeof m.sample_label, 'string'); assert.ok(m.sample_label.length > 5);
  assert.equal(m.cases, undefined);
  assert.deepEqual(Object.keys(m.fields).sort(), ['z500', 'z500a', 'z500sd']);
  for (const f of Object.values(m.fields)) { assert.deepEqual(f.steps, hrs(0, 240, 12)); assert.equal(f.case, undefined); assert.equal(f.source.valid.length, 21); }
  assert.equal(m.fields.z500a.source.valid[0], '2026-11-17T00:00Z'); assert.equal(m.fields.z500a.source.valid[20], '2026-11-27T00:00Z');
});

test('synthetic-hires-48h: real grids and one exactly circular +20 dam anomaly of radius 12 degrees', () => {
  const N = 'synthetic-hires-48h', m = man(N);
  assert.deepEqual(m.domains.g1, { lon0: -180, lat0: 90, dlon: 1, dlat: -1, nx: 361, ny: 181 });
  assert.deepEqual(m.domains.np05, { lon0: 150, lat0: 75, dlon: 0.5, dlat: -0.5, nx: 321, ny: 131 });
  assert.deepEqual(Object.keys(m.fields).sort(), ['msl', 'tp6', 'ws250', 'z500', 'z500a', 'z500sd']);
  assert.deepEqual(m.fields.z500a.steps, hrs(0, 48, 6)); assert.deepEqual(m.fields.tp6.steps, hrs(6, 48, 6));
  const C = { lat: 46, lon: -160 };
  for (const dom of ['g1', 'np05']) {
    const d = m.domains[dom];
    for (const s of [0, 24, 48]) {
      const a = frame(N, 'z500a', dom, s);
      let worst = 0, peak = -1e9;
      for (let j = 0; j < d.ny; j++) for (let i = 0; i < d.nx; i++) {
        const lat = d.lat0 + j * d.dlat, lon = d.lon0 + i * d.dlon;
        const dl = ((lon - C.lon + 540) % 360) - 180, r = Math.hypot(lat - C.lat, dl);
        const want = 200 * Math.exp(-Math.LN2 * (r / 12) ** 2);
        worst = Math.max(worst, Math.abs(a[j * d.nx + i] - want)); if (a[j * d.nx + i] > peak) peak = a[j * d.nx + i];
      }
      assert.ok(worst <= 0.5 + 1e-6, `${dom} ${s} h: max departure from the analytic circle ${worst} gpm`);
      assert.equal(peak, 200);
    }
    assert.equal(probe(N, 'circle-centre', dom, 0).value, 200);
    assert.equal(probe(N, 'circle-edge-east', dom, 0).value, 100);   // +10 dam is the 12 degree circle
    assert.equal(probe(N, 'circle-edge-north', dom, 0).value, 100);
  }
});

test('sizes are measured and inside the caps (a miss is reported, never fixed by coarsening)', () => {
  const sizes = Object.fromEntries(NEW.map((n) => [n, dirBytes(n)]));
  console.log('fixture sizes (bytes):', JSON.stringify(sizes), 'total', Object.values(sizes).reduce((a, b) => a + b, 0));
  assert.ok(sizes['synthetic-15d'] <= 8e6, `synthetic-15d ${sizes['synthetic-15d']} > 8 MB`);
  assert.ok(sizes['synthetic-hires-48h'] <= 5e6, `synthetic-hires-48h ${sizes['synthetic-hires-48h']} > 5 MB`);
  assert.ok(Object.values(sizes).reduce((a, b) => a + b, 0) <= 16e6, 'all new fixtures together over 16 MB');
});

const py = process.env.WSE_PYTHON || 'python3';
const regen = (which, out, extra = []) => spawnSync(py, ['-I', path.join(root, 'tools/make_fixtures.py'), which, '--out', out, ...extra], { encoding: 'utf8' });
// Compared as decoded content: the gzip bytes depend on the zlib build (the unmodified pre-W1-02 script already writes
// different gzip bytes for `synthetic` on Python 3.14 than the committed files, with identical decoded payloads), so the
// manifest is compared without the per-file byte counts and hashes, and each chunk after gunzip.
function sameContent(a, b) {
  const fa = fs.readdirSync(a).sort(), fb = fs.readdirSync(b).sort();
  assert.deepEqual(fa, fb, 'same file list');
  const strip = (m) => { for (const f of Object.values(m.fields)) for (const c of f.chunks) for (const x of Object.values(c.files)) { delete x.bytes; delete x.sha256; } return m; };
  for (const f of fa) {
    if (f === 'manifest.json') {
      assert.deepEqual(strip(JSON.parse(fs.readFileSync(path.join(a, f), 'utf8'))), strip(JSON.parse(fs.readFileSync(path.join(b, f), 'utf8'))), 'manifest');
    } else {
      assert.ok(zlib.gunzipSync(fs.readFileSync(path.join(a, f))).equals(zlib.gunzipSync(fs.readFileSync(path.join(b, f)))), `${f} decodes identically`);
    }
  }
}
test('regeneration: synthetic and every new fixture rebuild to the same decoded content', () => {
  const tmp = artifactTmp('wp10-regen-');
  try {
    for (const which of ['synthetic', ...NEW]) {
      const out = path.join(tmp, which);
      const r = regen(which, out);
      assert.equal(r.status, 0, `${which}: ${r.stderr}`);
      sameContent(path.join(fxRoot, which), out);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
test('regeneration: sample-min rebuilds to the same decoded content when the spike fixtures are present', (t) => {
  const fx = process.env.WSE_FIXTURES;
  if (!fx || !fs.existsSync(fx)) return t.skip('WSE_FIXTURES is not set (the spike fixture directory)');
  const tmp = artifactTmp('wp10-regen-');
  try {
    const out = path.join(tmp, 'sample-min');
    const r = regen('sample-min', out, ['--fixtures', fx]);
    assert.equal(r.status, 0, r.stderr);
    sameContent(path.join(fxRoot, 'sample-min'), out);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
test('the existing synthetic and sample-min files are the ones committed before W1-02', () => {
  // sha256 of every file, taken from the integration tip t/redesign before this package changed anything.
  const pinned = JSON.parse(fs.readFileSync(new URL('./wp10.baseline-hashes.json', import.meta.url), 'utf8'));
  for (const name of ['synthetic', 'sample-min']) {
    for (const f of fs.readdirSync(path.join(fxRoot, name))) {
      const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(fxRoot, name, f))).digest('hex');
      assert.equal(h, pinned[`${name}/${f}`], `${name}/${f}`);
    }
    assert.equal(fs.readdirSync(path.join(fxRoot, name)).length, Object.keys(pinned).filter((k) => k.startsWith(name + '/')).length);
  }
});
