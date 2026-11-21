// S-DATA (W3-09): the data client in a real page. The pattern moves from the single run to the ensemble mean the same way
// for the map (patternField) and the story (patternSeries): weight 0 at 168 h, 0.5 at 204 h, 1 at 240 h; a run without the
// mean stays the single run at every time; a corrupt chunk is announced on the bus; missing() reflects the manifest.
export const id = 'S-DATA';
export const tier = 'deploy'; // fast, offline, about data honesty
export const freshProfile = true;
export const data = ['synthetic-15d', 'synthetic-15d-nomean', 'synthetic-15d-em-g1only'];
export const timeoutMs = 90000;

export async function run({ page, baseUrl, assert, fixture }) {
  const tag = (s) => `[${fixture}] ${s}`;
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 30000 });
  const withMean = fixture !== 'synthetic-15d-nomean';

  const res = await page.eval(`(async () => {
    const d = window.__wse.data, m = d.getManifest(), dom = m.domains.g1, n = dom.nx * dom.ny;
    for (const f of ['z500', 'z500a', 'z500em']) if (m.fields[f]) await d.ensureAll(f, 'g1');
    const out = { hasMean: d.hasMean(), missing: d.missing(), rows: [], sources: {}, series: [], buffers: null };
    const ts = [0, 150, 168, 204, 240, 300, 360];
    for (const t of ts) {
      out.sources[t] = d.patternSource(t);
      const z = Float32Array.from(d.storedFieldAt('z500', 'g1', t)), za = Float32Array.from(d.storedFieldAt('z500a', 'g1', t));
      const em = d.hasMean() && t >= 144 ? Float32Array.from(d.storedFieldAt('z500em', 'g1', t)) : null;
      const pa = d.patternField('z500a', 'g1', t), pz = d.patternField('z500', 'g1', t);
      let worstA = 0, worstZ = 0, moved = 0, w = t <= 168 ? 0 : t >= 240 ? 1 : (t - 168) / 72;
      if (!d.hasMean()) w = 0;
      for (let k = 0; k < n; k += 61) {
        const e = em ? em[k] : 0;
        const wa = za[k] + w * (e - z[k]), wz = z[k] + w * (e - z[k]);
        if (wa !== wa) continue;
        worstA = Math.max(worstA, Math.abs(pa[k] - wa)); worstZ = Math.max(worstZ, Math.abs(pz[k] - wz));
        moved = Math.max(moved, Math.abs(pa[k] - za[k]));
      }
      out.rows.push({ t, w, worstA, worstZ, moved });
    }
    // the point series: the same weights, at the places the story reads
    const sf = d.patternSeries('z500a', 37.77, -122.42), raw = d.sampleSeries('z500a', 37.77, -122.42);
    const zs = d.sampleSeries('z500', 37.77, -122.42), es = d.hasMean() ? d.sampleSeries('z500em', 37.77, -122.42) : null;
    for (const t of [0, 168, 204, 240, 300]) {
      const i = sf.steps.indexOf(t), w = !d.hasMean() ? 0 : t <= 168 ? 0 : t >= 240 ? 1 : (t - 168) / 72;
      out.series.push({ t, got: sf.values[i], want: raw.values[i] + (es && w ? w * (es.values[es.steps.indexOf(t)] - zs.values[zs.steps.indexOf(t)]) : 0) });
    }
    // two kinds called one after the other keep their own buffers
    const a = d.patternField('z500a', 'g1', 204), copy = Float32Array.from(a), z = d.patternField('z500', 'g1', 204);
    out.buffers = { different: a !== z, intact: copy.every((v, k) => v === a[k] || (v !== v && a[k] !== a[k])) };
    // a frame a caller holds survives a later call of the other kind at another time, at or before 168 h and after (E-A6)
    const same = (x, y) => x.length === y.length && x.every((v, k) => v === y[k] || (v !== v && y[k] !== y[k]));
    out.held = [];
    for (const [f1, t1, f2, t2] of [['z500', 100, 'z500a', 204], ['z500a', 204, 'z500', 100], ['z500a', 100, 'z500', 204]]) {
      const held = d.fieldAt(f1, 'g1', t1), c = Float32Array.from(held);
      d.fieldAt(f2, 'g1', t2); out.held.push({ f1, t1, f2, t2, intact: same(held, c) });
    }
    // np05: z500 and z500a are recorded there; the mean may not be. The map must still draw, at every t.
    out.np = [];
    if (m.fields.z500.domains.includes('np05')) {
      for (const f of ['z500', 'z500a']) await d.ensureAll(f, 'np05');
      for (const t of [150, 180, 204, 240, 300]) { await d.ensure('z500a', 'np05', t); out.np.push({ t, frame: !!d.patternField('z500a', 'np05', t), src: d.patternSource(t, 'np05') }); }
    }
    return out;
  })()`);

  for (const h of res.held) assert.ok(h.intact, tag(`a held ${h.f1} frame at ${h.t1} h survives ${h.f2} at ${h.t2} h`));
  for (const r of res.np) assert.ok(r.frame, tag(`np05 draws at ${r.t} h (a blank map with no data:error otherwise)`));
  if (withMean) for (const r of res.np) assert.equal(r.src, r.t < 168 ? 'hres' : r.t >= 240 ? 'mean' : 'blend', tag(`np05 source at ${r.t} h`));
  assert.equal(res.hasMean, withMean, tag('hasMean()'));
  for (const r of res.rows) {
    assert.ok(r.worstA < 1e-3 && r.worstZ < 1e-3, tag(`${r.t} h: patternField is z + ${r.w} x (mean - z): ${JSON.stringify(r)}`));
    if (withMean && r.t >= 204) assert.ok(r.moved > 5, tag(`${r.t} h: the mean really moves the frame (${r.moved} gpm)`));
    if (!withMean) assert.equal(r.moved, 0, tag(`${r.t} h: no mean, the single run`));
  }
  const expectSrc = withMean ? { 0: 'hres', 150: 'hres', 168: 'blend', 204: 'blend', 240: 'mean', 300: 'mean', 360: 'mean' } : { 0: 'hres', 150: 'hres', 168: 'hres', 204: 'hres', 240: 'hres', 300: 'hres', 360: 'hres' };
  assert.deepEqual(res.sources, Object.fromEntries(Object.entries(expectSrc)), tag('patternSource at every t'));
  for (const s of res.series) assert.ok(Math.abs(s.got - s.want) < 1e-3, tag(`series at ${s.t} h: ${s.got} vs ${s.want}`));
  assert.deepEqual(res.buffers, { different: true, intact: true }, tag('buffers'));
  assert.deepEqual(res.missing.map((x) => x.field), withMean ? [] : ['z500em'], tag('missing() reflects the manifest'));

  // a corrupt chunk (one response damaged in flight) is announced; so is a missing one; the data layer carries on
  const err = await page.eval(`(async () => {
    const { bus } = await import('/js/state.js'), d = window.__wse.data, real = window.fetch.bind(window), seen = [];
    const off = bus.on('data:error', (e) => seen.push(e));
    window.fetch = async (u, ...r) => {
      const url = String(u);
      if (url.endsWith('ivt.g1.b.bin')) { const b = new Uint8Array(await (await real(u, ...r)).arrayBuffer()).slice(); b[0] = 0; b[1] = 0; return new Response(b); }
      if (url.endsWith('ivt.g1.a.bin')) return new Response('nope', { status: 404 });
      return real(u, ...r);
    };
    const tried = [];
    for (const t of [160, 12]) { try { await d.ensure('ivt', 'g1', t); tried.push('ok'); } catch (e) { tried.push(String(e.message)); } }
    window.fetch = real; off();
    const ok = await d.ensure('ivt', 'g1', 12).then(() => 'ok', (e) => String(e.message));
    return { seen, tried, ok, still: !!d.fieldAt('z500a', 'g1', 24) };
  })()`);
  assert.equal(err.seen.length, 2, tag('two failures, two data:error events: ' + JSON.stringify(err.seen)));
  assert.deepEqual(err.seen.map((e) => [e.field, e.domain, e.chunk]), [['ivt', 'g1', 'b'], ['ivt', 'g1', 'a']], tag('which chunks'));
  assert.ok(err.seen.every((e) => typeof e.message === 'string' && e.message.length > 3), tag('each says why'));
  assert.match(err.seen[0].message, /gzip/, tag('corrupt: bad magic'));
  assert.match(err.seen[1].message, /404/, tag('missing: 404'));
  assert.equal(err.ok, 'ok', tag('the next try (clean fetch) loads the chunk'));
  assert.equal(err.still, true, tag('other fields still draw'));
  assert.deepEqual(page.errors().filter((e) => !/data:error|404|gzip|ivt/.test(JSON.stringify(e))), [], tag('console errors: ' + JSON.stringify(page.errors())));
}
