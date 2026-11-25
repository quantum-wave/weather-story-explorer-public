// The motion raster's playback plan (sample.js acquirePlan): a planned raster is the unplanned raster bit for bit, frame after
// frame while the field moves, across a size change, with no-data patches and the feathered edge; the row sampler equals its
// per-pixel specification (fastValue, else _value); a raster not asked to plan never builds one; one plan set is held however
// many views have been played on; the plan's key keeps it to its own ground and layer set.
import test from 'node:test';
import assert from 'node:assert/strict';

const site = new URL('../../../site/js/', import.meta.url);
const load = (p) => import(new URL(p, site).href);
const NP = { lon0: 150, lat0: 75, dlon: 1, dlat: -1, nx: 161, ny: 66 };
const G1 = { lon0: -180, lat0: 90, dlon: 2, dlat: -2, nx: 181, ny: 91 };

/** A field (gpm) on a domain that moves with frame f, with an optional no-data disc that moves too. */
function field(dom, f, amp, hole) {
  const v = new Float32Array(dom.nx * dom.ny);
  for (let j = 0; j < dom.ny; j++) for (let i = 0; i < dom.nx; i++) {
    const lon = dom.lon0 + i * dom.dlon, lat = dom.lat0 + j * dom.dlat;
    v[j * dom.nx + i] = amp * Math.sin(lon / 17 + f * 0.31) * Math.cos(lat / 11 - f * 0.17) + amp * 0.3 * Math.sin((lon + lat) / 5 + f);
    if (hole && Math.hypot(lon - (200 + 3 * f), lat - 45) < 6) v[j * dom.nx + i] = NaN;
  }
  return v;
}

function specFor(mv, rw, rh, f, plan, withUnder = true) {
  const layers = [{ domId: 'np05', dom: NP, vals: field(NP, f, 260, true), feather: true }];
  const doubt = [{ domId: 'np05', dom: NP, vals: field(NP, f + 0.5, 90, false).map(Math.abs), feather: true }];
  if (withUnder) { layers.push({ domId: 'g1', dom: G1, vals: field(G1, f, 240, false), feather: false }); doubt.push({ domId: 'g1', dom: G1, vals: field(G1, f + 0.5, 90, false).map(Math.abs), feather: false }); }
  return { mv, W: mv.W, H: mv.H, rw, rh, u32: new Uint32Array(rw * rh), layers, factor: 0.1, palette: 'z500a', ground: 'paper', colors: 'soft', bicubic: false, hairlines: true, doubt: { layers: doubt, limit: 60 }, plan };
}

test('raster plan: a planned motion raster equals the unplanned one, frame after frame, across a size change and back', async () => {
  const { RasterJob } = await load('render/sample.js'), { baseProjection, MapView } = await load('render/view.js');
  for (const [view, W, H] of [['np', 600, 360], ['nh', 400, 400], ['gl', 400, 400], ['wm', 640, 340]]) {
    const mv = new MapView(baseProjection(view, W, H)); // one view, as while playing: its meshes (and so its plans) persist
    const sizes = [[300, 180], [300, 180], [300, 180], [300, 180], [255, 153], [255, 153], [255, 153], [300, 180], [300, 180]];
    let built = 0, planned = 0;
    for (let f = 0; f < sizes.length; f++) {
      const [rw, rh] = sizes[f].map((s) => Math.round(s * W / 600));
      const a = new RasterJob(specFor(mv, rw, rh, f, true));
      const fresh = new MapView(baseProjection(view, W, H)); // its own meshes: no plan
      const b = new RasterJob(specFor(fresh, rw, rh, f, false));
      assert.equal(b.planL, null);
      // row by row, the sampled values themselves (not only the band each falls in): the field, its alpha, the spread on hatch lines
      let vdiff = 0, first = null;
      for (let py = 0; py < rh; py++) {
        mv.apply(); a._row(py); fresh.apply(); b._row(py);
        for (let px = 0; px < rw; px++) {
          const same = Object.is(a.rowV[px], b.rowV[px]) && a.rowA[px] === b.rowA[px] && a.rowSel[px] === b.rowSel[px] && (!a.rowSel[px] || Object.is(a.rowSD[px], b.rowSD[px]));
          if (!same) { vdiff++; first ||= `(${px}, ${py}): ${a.rowV[px]} / ${a.rowSD[px]} against ${b.rowV[px]} / ${b.rowSD[px]}`; }
        }
      }
      assert.equal(vdiff, 0, `${view} frame ${f} at ${rw} x ${rh}: ${vdiff} pixels sample other values, first ${first}`);
      let diff = 0; for (let i = 0; i < a.u32.length; i++) if (a.u32[i] !== b.u32[i]) diff++;
      assert.equal(diff, 0, `${view} frame ${f} at ${rw} x ${rh}: ${diff} pixels differ between the planned and unplanned raster`);
      if (a.stats.planRows > 0) built++;
      else if (a.planL && a.planL.complete) planned++;
      if (f === 0) assert.ok(a.stats.planRows > 0, `${view}: the first raster asked to plan at a size builds the plan`);
      if (f === 1) assert.ok(a.planL?.complete && a.planD?.complete && a.stats.planRows === 0, `${view}: the next uses it`);
    }
    assert.equal(built, 3, `${view}: a plan built at each size change (${built})`);
    assert.equal(planned, 6, `${view}: and used on every other frame (${planned})`);
    const M = mv.mesh('np05', NP);
    assert.ok(M.plans.filter((p) => p.role === 'L').length <= 1, 'one plan per layer set');
  }
});

test('raster plan: the feather with nothing beneath (no underlay) fades the same with and without a plan', async () => {
  const { RasterJob } = await load('render/sample.js'), { baseProjection, MapView } = await load('render/view.js');
  const mv = new MapView(baseProjection('np', 600, 360));
  for (let f = 0; f < 4; f++) {
    const a = new RasterJob(specFor(mv, 300, 180, f, true, false)); a.step(Infinity);
    const b = new RasterJob(specFor(new MapView(baseProjection('np', 600, 360)), 300, 180, f, false, false)); b.step(Infinity);
    assert.deepEqual(a.u32, b.u32, `frame ${f}`);
    if (f === 3) assert.ok(a.planL.complete, 'planned');
  }
});

test('raster plan: the row sampler equals its per-pixel specification (fastValue, else _value)', async () => {
  const { RasterJob, fastValue } = await load('render/sample.js'), { baseProjection, MapView } = await load('render/view.js');
  for (const view of ['np', 'gl']) {
    const mv = new MapView(baseProjection(view, 500, 400));
    const job = new RasterJob(specFor(mv, 250, 200, 2, false));
    mv.apply();
    let checked = 0, general = 0;
    for (let py = 0; py < job.rh; py++) {
      job._row(py);
      const y = (py + 0.5) * job.sy;
      for (let px = 0; px < job.rw; px++) {
        const x = (px + 0.5) * job.sx;
        let ref = fastValue(job.LS, x, false), a = 1;
        if (ref === Infinity) { ref = job._value(job.LS, x, y, false); a = job.fa; general++; }
        assert.ok(Object.is(job.rowV[px], ref) && job.rowA[px] === a, `${view} (${px}, ${py}): ${job.rowV[px]} / ${job.rowA[px]} against ${ref} / ${a}`);
        checked++;
      }
    }
    assert.ok(general > 100, `${view}: ${general} of ${checked} pixels took the general path`);
  }
});

test('raster plan: a raster not asked to plan (a gesture frame) never builds one; planBytes counts a built one', async () => {
  const { RasterJob, planBytes } = await load('render/sample.js'), { baseProjection, MapView } = await load('render/view.js');
  const base = baseProjection('np', 600, 360);
  for (let f = 0; f < 3; f++) {
    const mv = new MapView(base, { k: 1.5, tx: -20 - 7 * f, ty: -10, rot: [0, 0, 0] });
    const job = new RasterJob(specFor(mv, 300, 180, f, false)); job.step(Infinity);
    assert.equal(job.planL, null, `frame ${f}`);
    assert.equal(planBytes(mv.mesh('np05', NP)), 0);
  }
  const mv = new MapView(base);
  for (let f = 0; f < 2; f++) new RasterJob(specFor(mv, 300, 180, f, true)).step(Infinity);
  const bytes = planBytes(mv.mesh('np05', NP));
  assert.ok(bytes > 300 * 180 * 21, `a built plan's bytes are counted: ${bytes}`);
  // a rotate raster (pooled buffers) and a bicubic one never plan
  for (const extra of [{ pool: true }, { bicubic: true }]) {
    const j = new RasterJob({ ...specFor(new MapView(base), 300, 180, 0, true), ...extra });
    assert.equal(j.planL, null, JSON.stringify(extra));
  }
});

test('raster plan: playing on one view after another holds one plan set, not one per view', async () => {
  const { RasterJob, planBytes, rasterSize } = await load('render/sample.js'), { baseProjection, MapView } = await load('render/view.js');
  const W = 390, H = 844, base = baseProjection('np', W, H), meshes = [];
  const big = rasterSize(W, H, 2, 'motion', 1);
  for (let v = 0; v < 5; v++) {
    const mv = new MapView(base, { k: 2.2, tx: -40 - v * 30, ty: -60, rot: [0, 0, 0] });
    for (const fit of [1, 0.85]) for (let f = 0; f < 3; f++) {
      const { rw, rh } = rasterSize(W, H, 2, 'motion', fit);
      mv.apply(); new RasterJob(specFor(mv, rw, rh, f, true)).step(Infinity);
    }
    meshes.push(mv.mesh('np05', NP), mv.mesh('g1', G1));
  }
  // one set: a field plan (about 25 B a pixel) and a spread plan (one pixel in seven, plus grid coordinates)
  const held = meshes.reduce((n, M) => n + planBytes(M), 0), oneSet = big.rw * big.rh * 40;
  assert.ok(held > 0 && held <= oneSet, `plans held after playing on 5 views at 2 sizes: ${(held / 1e6).toFixed(1)} MB (one set at most ${(oneSet / 1e6).toFixed(1)} MB)`);
});

test('raster plan: a plan built on a view does not serve another ground or a set without its underlay', async () => {
  const { RasterJob } = await load('render/sample.js'), { baseProjection, MapView } = await load('render/view.js');
  const mv = new MapView(baseProjection('np', 600, 360));
  for (let f = 0; f < 3; f++) new RasterJob(specFor(mv, 300, 180, f, true)).step(Infinity);
  for (const [tag, o, under] of [['night ground', { ground: 'night' }, true], ['no underlay', {}, false], ['paper again', {}, true]]) {
    for (let f = 3; f < 6; f++) {
      const a = new RasterJob({ ...specFor(mv, 300, 180, f, true, under), ...o }); a.step(Infinity);
      const b = new RasterJob({ ...specFor(new MapView(baseProjection('np', 600, 360)), 300, 180, f, false, under), ...o }); b.step(Infinity);
      assert.deepEqual(a.u32, b.u32, `${tag} frame ${f}`);
    }
  }
});
