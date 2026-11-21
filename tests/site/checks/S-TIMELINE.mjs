// S-TIMELINE (W3-08, DESIGN-SPEC 7.1, 7.2): the timeline in the real shell. The track is coloured step by step with the band of the
// pattern at the focused place (home when none), worked out here independently of the code under test (own blend, own band lookup
// through the palette); the zones and their captions come only from zones(); on a run with no ensemble mean nothing says "51
// forecasts"; the readout names the zone, "Day n of N" and the run, and says "between model steps" off a step; a release eases to a
// step; the phone timeline is 56 px at peek and full and 72 px at half with text that fits. Known-positive mutants:
// tests/mutations/M-timeline-1.json (track from the single run after day 7) and M-timeline-2.json (51 forecasts without a mean).
export const id = 'S-TIMELINE';
export const freshProfile = true;
export const timeoutMs = 90000;
export const data = ['synthetic-15d', 'synthetic-15d-nomean'];

// In-page helpers (strings): the expected cells for the place at (lat, lon), from the loaded data alone.
const EXPECT = `(async (lat, lon) => {
  const pal = await import('./js/render/palette.js'), conf = await import('./js/story/confidence.js'), S = await import('./js/story/index.js');
  await S.ensureStoryData(lat, lon);
  const D = __wse.data, st = __wse.store.get();
  const ground = st.ground || (st.theme === 'light' ? 'paper' : 'night');
  const m = D.getManifest(), hasMean = !!m.fields.z500em;
  if (hasMean) { await D.ensureAll('z500em', S.domainFor('z500em', lat, lon)); await D.ensureAll('z500', S.domainFor('z500', lat, lon)); }
  const run = D.sampleSeries('z500a', lat, lon), sd = D.sampleSeries('z500sd', lat, lon), em = hasMean ? D.sampleSeries('z500em', lat, lon) : null, z5 = hasMean ? D.sampleSeries('z500', lat, lon) : null;
  const at = (ser, t) => { const i = ser.steps.indexOf(t); return i < 0 ? null : ser.values[i]; };
  const out = [];
  for (const el of document.querySelectorAll('#timeline .tl-cell')) {
    const t = +el.dataset.t; let g = at(run, t); if (g == null) { out.push({ t, got: el.dataset.state, want: 'nodata' }); continue; }
    let gRun = g;
    // z500em is an absolute height (gpm, 4500-6200): the anomaly of the mean is z500em - (z500 - z500a) at the same step
    if (hasMean && t > 168) { const e = at(em, t), h = at(z5, t); if (e != null && h != null) g = g + ((e - (h - g)) - g) * Math.min(1, (t - 168) / 72); }
    const dam = g / 10, s = at(sd, t);
    const none = conf.signalAt({ anomDam: dam, spreadDam: s == null ? NaN : s / 10, hasSpread: s != null }) === 'none';
    const c = pal.bandRGBA('z500a', dam, ground), c0 = pal.bandRGBA('z500a', gRun / 10, ground);
    const want = none ? 'none' : c[3] === 0 ? 'blank' : 'band';
    out.push({ t, got: el.dataset.state, want, gotRgb: el.dataset.rgb || '', wantRgb: want === 'band' ? c.slice(0, 3).join(',') : '', cssRgb: getComputedStyle(el).backgroundColor,
      runOnlyRgb: !none && c0[3] !== 0 ? c0.slice(0, 3).join(',') : '', dam });
  }
  return out; })`;

async function cellsFor(page, lat, lon) {
  return page.eval(`${EXPECT}(${lat}, ${lon})`);
}

export async function run({ page, baseUrl, assert, fixture }) {
  const tag = (s) => `[${fixture}] ${s}`;
  const nomean = fixture === 'synthetic-15d-nomean';
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 20000 });
  await page.waitFor(`document.querySelectorAll('#timeline .tl-cell').length >= 10 && document.querySelectorAll('#timeline .tl-cell[data-state="band"], #timeline .tl-cell[data-state="blank"], #timeline .tl-cell[data-state="none"]').length >= 10`, { timeout: 15000 });

  // ---- zones: boundaries and captions only from zones()
  const zs = await page.eval(`(async () => {
    const conf = await import('./js/story/confidence.js'), clock = await import('./js/time/clock.js');
    const hi = clock.range()[1], hasMean = !!__wse.data.getManifest().fields.z500em;
    const want = conf.zones(hi, { hasMean }).map((z) => ({ from: z.from, to: z.to, kind: z.kind, caption: z.caption, texture: z.texture }));
    const got = [...document.querySelectorAll('#timeline .tl-zone')].map((z) => ({ from: +z.dataset.from, to: +z.dataset.to, kind: z.dataset.kind, texture: z.dataset.texture }));
    const caps = [...document.querySelectorAll('#timeline .tl-zonecap')].map((c) => ({ kind: c.dataset.kind, text: c.textContent }));
    return { hi, want, got, caps, all: document.getElementById('timeline').textContent, CAPS: conf.CAPTIONS }; })()`);
  assert.deepEqual(zs.got, zs.want.map(({ from, to, kind, texture }) => ({ from, to, kind, texture })), tag('zone boundaries, kinds and textures are the zones() table'));
  assert.deepEqual(zs.caps, zs.want.map((z) => ({ kind: z.kind, text: z.caption })), tag('captions equal the zones() captions, string for string'));
  for (const c of zs.caps) assert.equal(c.text, zs.CAPS[c.kind], tag(`caption of ${c.kind} equals the exported constant`));
  if (nomean) {
    assert.deepEqual(zs.got.map((z) => [z.from, z.to, z.kind]), [[0, 168, 'hres'], [168, zs.hi, 'hres-late']], tag('no mean: one high-resolution zone to 168 h, then one forecast with no average'));
    assert.ok(!/51 forecasts/.test(zs.all), tag('no text in the timeline says "51 forecasts" on a run with no ensemble mean'));
    assert.ok(/no ensemble average in this run/.test(zs.all), tag('the words say why'));
  } else {
    assert.deepEqual(zs.got.map((z) => [z.from, z.to, z.kind]), [[0, 168, 'hres'], [168, 240, 'blend'], [240, 360, 'mean']], tag('boundaries at 168 h and 240 h'));
    assert.ok(/51 forecasts/.test(zs.all), tag('the average of 51 forecasts is named where the mean is drawn'));
  }

  // ---- track: colour per cell equals the band of the pattern at the home place (own blend, own lookup)
  const home = await page.eval(`(() => { const h = __wse.pins.home(); return { lat: h.lat, lon: h.lon, name: h.name }; })()`);
  const cells = await cellsFor(page, home.lat, home.lon);
  assert.ok(cells.length >= 29, tag('one cell per time: ' + cells.length));
  const bad = cells.filter((c) => c.got !== c.want || c.gotRgb !== c.wantRgb);
  assert.deepEqual(bad.slice(0, 3), [], tag(`every cell matches the independently computed band (${bad.length} of ${cells.length} differ)`));
  for (const c of cells.filter((x) => x.got === 'band')) assert.equal(c.cssRgb, `rgb(${c.gotRgb.split(',').join(', ')})`, tag('painted colour at t=' + c.t));
  // sanity: a 500 hPa anomaly is tens of dam, never hundreds (an absolute height blended in as an anomaly reads 275 dam)
  for (const c of cells) assert.ok(!Number.isFinite(c.dam) || Math.abs(c.dam) < 60, tag(`|anomaly| < 60 dam at t=${c.t}: ${c.dam}`));
  const day2 = cells.find((c) => c.t === 36), day9 = cells.find((c) => c.t === 204);
  assert.ok(day2 && day9, tag('probes at day 2 and day 9 exist'));
  const states = cells.reduce((a, c) => { a[c.got] = (a[c.got] || 0) + 1; return a; }, {});
  console.log(`  S-TIMELINE ${fixture} home=${home.name} cells=${cells.length} states=${JSON.stringify(states)} day2=${day2.got}:${day2.gotRgb} day9=${day9.got}:${day9.gotRgb} dam9=${day9.dam.toFixed(1)}`);
  // after day 7 the track must come from the blend, not the single run: count the cells where the two differ
  if (!nomean) {
    const late = cells.filter((c) => c.t > 168);
    const differ = late.filter((c) => c.runOnlyRgb !== c.wantRgb).length;
    assert.ok(differ >= 1, tag('fixture sanity: the blend colours at least one late cell differently from the single run: ' + differ));
    for (const c of late.filter((x) => x.got === 'band')) assert.equal(c.gotRgb, c.wantRgb, tag('late cell from the blend at t=' + c.t));
  }

  // ---- track and map agree: at day 9 the track's sign at the place is the sign of what the map samples there
  if (!nomean) {
    const x = await page.eval(`(async () => { const clock = await import('./js/time/clock.js'); clock.pause(); clock.seek(204);
      await __wse.renderer.ensureFor({ t: 204 }); await new Promise((r) => setTimeout(r, 300));
      const h = __wse.pins.home(), m = __wse.renderer.sampleAt(h.lon, h.lat);
      clock.seek(36); return { t: m.t, map: m.values.z500a / 10 }; })()`);
    const trk = cells.find((c) => c.t === 204);
    assert.equal(x.t, 204, tag('map sampled at day 9'));
    if (Math.abs(x.map) >= 2 && trk.got === 'band') assert.equal(Math.sign(trk.dam), Math.sign(x.map), tag(`day 9: track (${trk.dam.toFixed(1)} dam) and map (${x.map.toFixed(1)} dam) have the same sign`));
    else assert.ok(Math.abs(trk.dam - x.map) < 30, tag('day 9 near-neutral: track and map are within 30 dam'));
  }

  // ---- the caption names the place; a focused place recolours the track
  assert.equal(await page.eval(`document.querySelector('#timeline .tl-cap').dataset.place`), home.name, tag('caption names the home place'));
  assert.ok((await page.eval(`document.querySelector('#timeline .tl-cap').textContent`)).includes(home.name));
  await page.eval(`__wse.store.set({ focus: { lat: 38.72, lon: -9.14, label: 'Lisbon' } })`);
  await page.waitFor(`document.querySelector('#timeline .tl-cap').dataset.place === 'Lisbon'`, { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 200));
  const lis = await cellsFor(page, 38.72, -9.14);
  assert.deepEqual(lis.filter((c) => c.got !== c.want || c.gotRgb !== c.wantRgb).slice(0, 3), [], tag('the track follows the focused place'));
  await page.eval(`__wse.store.set({ focus: null })`);
  await page.waitFor(`document.querySelector('#timeline .tl-cap').dataset.place === ${JSON.stringify(home.name)}`, { timeout: 5000 });

  // ---- readout: two lines, zone name, Day n of N, the run; "between model steps" off a step
  const ro = await page.eval(`(async () => {
    const clock = await import('./js/time/clock.js'), kind = await import('./js/data/kind.js'); clock.pause(); clock.seek(36);
    await new Promise((r) => setTimeout(r, 60));
    const q = (s) => document.querySelector('#timeline ' + s);
    const on = { l1: q('.tl-line1').textContent, l2: q('.tl-line2').textContent, between: document.getElementById('timeline').dataset.between };
    clock.seek(37.5); await new Promise((r) => setTimeout(r, 60));
    const off = { l2: q('.tl-line2').textContent, between: document.getElementById('timeline').dataset.between };
    clock.seek(36);
    const mm = __wse.data.getManifest(), cl = mm.sample ? mm.cases?.[__wse.data.activeCase()]?.label : '';
    return { on, off, run: kind.runLabel(mm) + (cl ? ' · sample: ' + cl : ''), range: clock.range(), rangeText: q('.tl-range').textContent }; })()`);
  assert.match(ro.on.l1, /^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}( \d{4})? · \d{1,2}(:\d\d)? (am|pm)( [A-Z]{2,5}| GMT[+-]\d+)?$/, tag('line 1: local date, time and the zone name: ' + ro.on.l1));
  assert.ok(!/\b\d\dZ\b/.test(ro.on.l1 + ro.on.l2), tag('no bare UTC hour beside a local date'));
  const of = Math.ceil((ro.range[1] - ro.range[0]) / 24);
  assert.equal(ro.on.l2, `Day 2 of ${of}` + (ro.run ? ` · ${ro.run}` : ''), tag('line 2: lead and the run, from runLabel(): ' + ro.on.l2));
  assert.equal(ro.on.between, '0'); assert.equal(ro.off.between, '1');
  assert.ok(/between model steps/.test(ro.off.l2), tag('paused off a step: ' + ro.off.l2));
  assert.ok(/^\d+ days?$/.test(ro.rangeText), tag('the range is text: ' + ro.rangeText));
  assert.equal(await page.eval(`document.querySelectorAll('#timeline .tl-range-opt').length`), 0, tag('no range control unless the map is expanded'));

  // ---- a release eases to the nearest model step
  const rel = await page.eval(`(async () => {
    const clock = await import('./js/time/clock.js'), tr = document.querySelector('#timeline .tl-track'), ar = document.querySelector('#timeline .tl-area').getBoundingClientRect();
    const [lo, hi] = clock.range(), steps = clock.steps(); clock.seek(lo);
    const x = ar.left + ar.width * ((37.7 - lo) / (hi - lo));
    const ev = (type) => tr.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 9, clientX: x, clientY: ar.top + 10, button: 0, pointerType: 'touch' }));
    ev('pointerdown'); ev('pointerup');
    const during = __wse.store.get().t;
    await new Promise((r) => setTimeout(r, 700));
    return { during, end: __wse.store.get().t, onStep: steps.includes(__wse.store.get().t), steps: steps.slice(0, 12) }; })()`);
  assert.ok(rel.onStep, tag(`released at ${rel.during.toFixed(2)} h, eased to a model step: ${rel.end}`));
  assert.ok(Math.abs(rel.end - rel.during) <= 3 + 1e-6, tag('to the nearest step'));

  // ---- Shift+arrow moves a day
  const day = await page.eval(`(async () => { const clock = await import('./js/time/clock.js'); clock.pause(); clock.seek(12);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 500)); return __wse.store.get().t; })()`);
  assert.equal(day, 36, tag('Shift+ArrowRight moves one day (24 h)'));

  // ---- Now pill: only on live data, and only when the present is inside the range
  const nowChk = await page.eval(`(async () => { const clock = await import('./js/time/clock.js'); __wse.store.set({ sample: false }); await new Promise((r) => setTimeout(r, 120));
    const [lo, hi] = clock.range(), h = (Date.now() - __wse.data.validTime(0).getTime()) / 3600e3, pill = document.querySelector('#timeline .tl-now');
    const r = { inRange: h >= lo && h <= hi, hidden: pill.hidden, sampleLabelLine: document.querySelector('#timeline .tl-line2').textContent };
    if (r.inRange) { pill.click(); await new Promise((x) => setTimeout(x, 800)); r.t = __wse.store.get().t; r.h = h; }
    __wse.store.set({ sample: true }); await new Promise((x) => setTimeout(x, 120)); r.sampleHidden = pill.hidden; return r; })()`);
  assert.equal(nowChk.hidden, !nowChk.inRange, tag('Now pill shows exactly when the present is inside the run: ' + JSON.stringify(nowChk)));
  if (nowChk.inRange) assert.ok(Math.abs(nowChk.t - nowChk.h) < 0.5, tag('Now returns to the present'));
  assert.equal(nowChk.sampleHidden, true, tag('no Now pill on sample data'));

  // ---- desktop, map expanded: speed, range, step buttons and Now stay on one row with the readout (1440 x 900)
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 20000 });
  await page.waitFor(`document.querySelectorAll('#timeline .tl-cell').length >= 10`, { timeout: 15000 });
  const exp = {};
  for (const sample of [true, false]) {
    exp[sample] = await page.eval(`(async () => { __wse.store.set({ sample: ${sample}, expanded: true, range: 15 }); const clock = await import('./js/time/clock.js'); clock.pause(); clock.seek(37.5); await new Promise((r) => setTimeout(r, 450)); // between steps: the longest readout
      const t = document.getElementById('timeline'), head = t.querySelector('.tl-head'), vis = (e) => e && !e.hidden && e.getClientRects().length;
      const parts = ['.tl-play', '.tl-time', '.tl-range', '.tl-now', '.tl-prev', '.tl-next', '.tl-speedwrap'].map((s) => t.querySelector(s)).filter(vis);
      const rows = parts.map((e) => { const r = e.getBoundingClientRect(); return Math.round((r.top + r.bottom) / 2); });
      const hr = head.getBoundingClientRect(), tm = t.querySelector('.tl-time').getBoundingClientRect(), l2 = t.querySelector('.tl-line2');
      return { n: parts.length, rows, headH: hr.height, control: !!t.querySelector('.tl-range[data-control]'), opts: t.querySelectorAll('.tl-range-opt').length,
        overflowX: document.documentElement.scrollWidth - innerWidth, l2sw: l2.scrollWidth, l2cw: l2.clientWidth, l2: l2.textContent, title: t.querySelector('.tl-time').title,
        keyRight: (() => { const tn = l2.firstChild, k = tn.textContent.indexOf('between model steps') + 'between model steps'.length, rg = document.createRange(); rg.setStart(tn, 0); rg.setEnd(tn, k); return rg.getBoundingClientRect().right - l2.getBoundingClientRect().right; })(), rightEdge: Math.max(...parts.map((e) => e.getBoundingClientRect().right)), tw: t.getBoundingClientRect().right }; })()`);
    const e = exp[sample];
    assert.ok(e.control && e.opts === 3, tag(`expanded (sample=${sample}): the range control shows`));
    assert.ok(e.n >= 6, tag(`expanded (sample=${sample}): ${e.n} head parts visible`));
    assert.ok(Math.max(...e.rows) - Math.min(...e.rows) <= 2, tag(`expanded (sample=${sample}): play, readout, range, step, speed on one row: centres ${e.rows}`));
    assert.ok(e.headH <= 52, tag(`expanded (sample=${sample}): head is one row (${e.headH} px)`));
    assert.ok(/between model steps/.test(e.l2), tag(`expanded (sample=${sample}): the readout is the between-steps one: ${e.l2}`));
    assert.ok(e.keyRight <= 0.5, tag(`expanded (sample=${sample}): "Day n of N · between model steps" is fully visible (${e.keyRight.toFixed(1)} px past the edge)`));
    assert.ok(e.l2sw <= e.l2cw || e.title.includes(e.l2.slice(-12)), tag(`expanded (sample=${sample}): a clipped tail is in the tooltip`));
    assert.ok(e.overflowX <= 0 && e.rightEdge <= e.tw + 1, tag(`expanded (sample=${sample}): nothing overflows the timeline ${JSON.stringify(e)}`));
  }
  await page.eval(`__wse.store.set({ expanded: false, sample: true })`);

  // ---- phone: 56 px at peek and full, 72 px at half; text-fit invariants at 390 px
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 20000 });
  await page.waitFor(`document.querySelectorAll('#timeline .tl-cell').length >= 10`, { timeout: 15000 });
  const heights = {};
  for (const snap of ['peek', 'half', 'full']) {
    await page.eval(`__wse.store.set({ sheet: ${JSON.stringify(snap)} })`);
    await page.waitFor(`document.getElementById('timeline').dataset.sheet === ${JSON.stringify(snap)}`, { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 450));
    heights[snap] = await page.eval(`(() => { const t = document.getElementById('timeline'), b = (s) => { const e = t.querySelector(s), r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), getComputedStyle(e).display]; };
      const pr = t.querySelector('.tl-phone-read'), cs = getComputedStyle(pr);
      return { h: t.getBoundingClientRect().height, dock: t.dataset.dock, play: b('.tl-play'), prev: b('.tl-prev'), next: b('.tl-next'), track: b('.tl-track'), ruler: getComputedStyle(t.querySelector('.tl-days')).display,
        speed: getComputedStyle(t.querySelector('.tl-speedwrap')).display, dayLabels: t.querySelectorAll('.tl-day').length, areaW: t.querySelector('.tl-area').getBoundingClientRect().width,
        dayLefts: [...t.querySelectorAll('.tl-day')].map((e) => Math.round(e.getBoundingClientRect().left)), dayFit: [...t.querySelectorAll('.tl-day')].every((e) => { const r = e.getBoundingClientRect(), a = t.querySelector('.tl-area').getBoundingClientRect(); return r.left >= a.left - 1 && r.right <= a.right + 1; }),
        read: { text: pr.textContent, ws: cs.whiteSpace, lh: parseFloat(cs.lineHeight), h: pr.getBoundingClientRect().height, sw: pr.scrollWidth, cw: pr.clientWidth }, overflowX: document.documentElement.scrollWidth - innerWidth }; })()`);
  }
  // the half-snap ruler is never empty on a 15-day run (labels thin to every second or third day, they are not dropped)
  assert.ok(heights.half.dayLabels >= 3, tag(`half snap shows at least 3 ruler labels on a ${Math.round(heights.half.areaW)} px area: ${heights.half.dayLabels}`));
  assert.equal(heights.peek.dock, 'sheet', tag('docked to the sheet on the phone'));
  assert.equal(heights.peek.h, 56, tag('peek is 56 px')); assert.equal(heights.full.h, 56, tag('full is 56 px')); assert.equal(heights.half.h, 72, tag('half is 72 px'));
  assert.equal(heights.half.ruler, 'block', tag('the ruler is the half-snap extra')); assert.equal(heights.peek.ruler, 'none'); assert.equal(heights.full.ruler, 'none');
  for (const [snap, v] of Object.entries(heights)) {
    for (const k of ['play', 'prev', 'next', 'track']) assert.ok(v[k][0] >= 44 && v[k][1] >= 44, tag(`${snap}: ${k} target ${v[k]}`));
    assert.equal(v.read.ws, 'nowrap', tag(`${snap}: readout is nowrap`));
    assert.equal(v.read.h, v.read.lh, tag(`${snap}: readout height equals one line box`));
    assert.ok(v.read.sw <= v.read.cw, tag(`${snap}: readout fits after truncation (${v.read.sw} <= ${v.read.cw})`));
    assert.equal(v.speed, 'none', tag('speed menu is not on the phone timeline'));
    assert.ok(v.overflowX <= 0, tag(`${snap}: no horizontal page scroll`));
  }
  assert.ok(heights.half.dayFit, tag('ruler labels stay inside the track: ' + heights.half.dayLefts));

  // ---- phone readout between steps: the whole phrase is visible, not cut by an ellipsis (every snap that shows the readout)
  for (const snap of ['peek', 'half', 'full']) {
    await page.eval(`__wse.store.set({ sheet: ${JSON.stringify(snap)} })`);
    const bt = await page.eval(`(async () => { const clock = await import('./js/time/clock.js'); clock.pause(); clock.seek(37.5); await new Promise((r) => setTimeout(r, 450));
      const pr = document.querySelector('#timeline .tl-phone-read'); const r = { text: pr.textContent, sw: pr.scrollWidth, cw: pr.clientWidth }; clock.seek(36); return r; })()`);
    assert.ok(/between steps$/.test(bt.text), tag(`${snap}: phone readout names the state: "${bt.text}"`));
    assert.ok(bt.sw <= bt.cw, tag(`${snap}: "${bt.text}" fits without an ellipsis (${bt.sw} <= ${bt.cw})`));
  }
  assert.deepEqual(page.errors(), [], tag('console errors: ' + JSON.stringify(page.errors())));
}
