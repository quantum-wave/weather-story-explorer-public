// S-DECODE: every manifest probe matches the value decoded in the browser; chunks decode the same through
// DecompressionStream and fflate; a bad file is refused; a chunk is fetched once.
import { mount } from '../wp2/shot.mjs';

export const id = 'S-DECODE';
export const tier = 'deploy'; // fast, offline, about data honesty: the data and Pages workflows run it
export const freshProfile = false;
export const timeoutMs = 90000;

export async function run({ page, baseUrl, assert }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 45000 });
  await mount(page, { width: 800, height: 500 });

  const res = await page.eval(`(async () => {
    const { data } = window.__wp2, m = data.getManifest(), out = { probes: [], ranges: [] };
    for (const [f, meta] of Object.entries(m.fields)) for (const d of meta.domains) await data.ensureAll(f, d);
    for (const p of m.probes) {
      const meta = m.fields[p.field], d = m.domains[p.domain], arr = data.storedFieldAt(p.field, p.domain, p.step); // as stored: fieldAt blends z500 and z500a toward the ensemble mean after day 7
      const i = Math.round(((((p.lon - d.lon0) % 360) + 360) % 360) / d.dlon), j = Math.round((p.lat - d.lat0) / d.dlat);
      out.probes.push({ name: p.name, field: p.field, domain: p.domain, step: p.step, want: p.value, got: arr ? arr[j * d.nx + i] : null, scale: meta.scale });
    }
    for (const f of ['z500', 'z500a']) if (m.fields[f]) {
      const d0 = m.fields[f].domains[0], a = data.storedFieldAt(f, d0, m.fields[f].steps[0]);
      let lo = Infinity, hi = -Infinity; for (const v of a) if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; }
      out.ranges.push({ f, lo, hi });
    }
    // decoder paths on the first chunk file of the first field
    const f0 = Object.keys(m.fields)[0], meta = m.fields[f0], c0 = meta.chunks[0], dom0 = Object.keys(c0.files)[0], d = m.domains[dom0];
    const bytes = new Uint8Array(await (await fetch('data/' + c0.files[dom0].path)).arrayBuffer());
    const dec = await import('/js/data/decode.js');
    const spec = { nx: d.nx, ny: d.ny, nFrames: c0.steps[1] - c0.steps[0], filter: meta.filter };
    const a = await dec.decodeChunk(bytes, spec), b = await dec.decodeChunk(bytes, spec, { forceFflate: true });
    out.same = a.length === b.length && a.every((fr, i) => fr.every((v, k) => v === b[i][k]));
    out.frames = a.length;
    const bad = bytes.slice(); bad[0] = 0;
    try { await dec.decodeChunk(bad, spec); out.bad = 'accepted'; } catch (e) { out.bad = String(e.message); }
    out.fetches = performance.getEntriesByType('resource').filter((r) => r.name.endsWith('/' + c0.files[dom0].path)).length;
    return out;
  })()`);

  assert.ok(res.probes.length > 0, 'the manifest lists probes');
  for (const p of res.probes) {
    assert.ok(p.got !== null, `${p.name} ${p.field}/${p.domain} step ${p.step}: not decoded`);
    assert.ok(Math.abs(p.got - p.want) <= p.scale, `${p.name} ${p.field}/${p.domain}: ${p.got} vs manifest ${p.want}`);
  }
  for (const r of res.ranges) {
    if (r.f === 'z500') assert.ok(r.lo > 4000 && r.hi < 6400, `z500 range ${r.lo}..${r.hi} gpm is physical`);
    else assert.ok(r.lo > -900 && r.hi < 900, `z500a range ${r.lo}..${r.hi} gpm is physical`);
  }
  assert.ok(res.same && res.frames > 0, 'DecompressionStream and fflate decode identically');
  assert.match(res.bad, /gzip/, 'a file that is not gzip is refused');
  assert.ok(res.fetches <= 2, `a chunk file is requested once by the app and the cache (saw ${res.fetches})`);
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
}
