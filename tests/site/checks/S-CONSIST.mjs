// S-CONSIST (W4-07, DESIGN-SPEC 14.3 "One dataset per screen", TEST-6): everything on one screen describes one dataset.
//  1. Rendered text. The home card's tag, the header chip's "About this data" sentence (W3-04's one-row header replaced the
//     #sample-badge with #data-chip; the sentence is read from the popover a real click opens), the legend's run line, the
//     timeline's second line and the share picture's caption all name the run or sample the map shows: string-equal on a
//     recorded run (one sample label), and the active case's label, and no other case's, on a multi-case sample. The chip's own
//     line is the short sample label on a recorded run (shown whole or as a whole-segment shortening that keeps "not live") and
//     names no other case on a multi-case sample. The share also draws the legend's own title.
//  2. One data-derived number. On day 9 at a pin, the sign of the pattern as the card words it (the story), as the timeline track
//     colours it, and as renderer.sampleAt returns it agree: no two of them point opposite ways, and where the pattern is strong
//     (8 dam or more) they are equal. At day 9 this proves the card, the track and the map use the same blend.
//  3. Frame. On the desktop frame every view holds at least 80% of the active field's valid data (the box of the valid grid
//     nodes inside the view's region, projected). The line "Data covers part of this view" is accepted only on sample-min.
// Runs on recorded, synthetic-15d (a one-case multi-case manifest) and sample-min (three unrelated cases: A, B and C each).
export const id = 'S-CONSIST';
export const freshProfile = true;
export const timeoutMs = 150000;
export const data = ['recorded', 'synthetic-15d', 'sample-min'];

import * as inp from '../lib/input.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The header chip's sentence: what "About this data" says, opened and closed by real clicks on #data-chip (as S-LEGEND). */
const chipSentence = async (page) => {
  await inp.click(page, '#data-chip'); await sleep(150);
  const t = await page.eval(`document.getElementById('data-popover').hidden ? [] : [...document.querySelectorAll('#data-popover .full')].map((e) => e.textContent.trim())`);
  await inp.click(page, '#data-chip'); await sleep(150);
  return t;
};

const SPY = `
  window.__drawn = [];
  if (!window.__spied) { window.__spied = true;
    for (const C of [CanvasRenderingContext2D, OffscreenCanvasRenderingContext2D]) { const o = C.prototype.fillText;
      C.prototype.fillText = function (s, ...r) { window.__drawn.push(String(s)); return o.call(this, s, ...r); }; } }
`;

const SURFACES = `(async () => {
  const q = (s) => [...document.querySelectorAll(s)].map((e) => e.textContent.trim());
  await new Promise((r) => setTimeout(r, 900));
  const S = await import('./js/share/index.js');
  window.__drawn = [];
  await S.exportStill({});
  const chip = document.getElementById('data-chip');
  return { tag: q('.sample-tag'), chip: chip && !chip.hidden ? [chip.dataset.full || ''] : [], chipShown: q('#data-chip .chip-text'), legend: q('.mlg-run'), legendTitle: q('.mlg-title'),
    line2: q('.tl-line2'), drawn: window.__drawn.slice() };
})()`;

const COVER = `(async (viewId) => {
  const { VIEWS } = await import('./js/contract.js'); const D = __wse.data, r = __wse.renderer, m = D.getManifest(), st = __wse.store.get();
  const fieldId = { z: 'z500a', j: 'ws250', s: 'tp6', a: 't850a', r: 'ivt', c: 'z500sd' }[st.lens || 'z'];
  const order = [VIEWS[viewId], 'g1'].filter((d, i, a) => m.domains[d] && m.fields[fieldId]?.domains?.includes(d) && a.indexOf(d) === i);
  const cv = document.getElementById('map'), W = cv.clientWidth, H = cv.clientHeight;
  for (const domId of order) {
    const dom = m.domains[domId]; await D.ensureAll(fieldId, domId);
    const arr = D.fieldAt(fieldId, domId, (D.fieldSteps(fieldId) || [0])[0]); if (!arr) continue;
    const pts = [];
    for (let j = 0; j < dom.ny; j++) for (let i = 0; i < dom.nx; i++) {
      if (!Number.isFinite(arr[j * dom.nx + i])) continue;
      const lat = dom.lat0 + j * dom.dlat; let lon = dom.lon0 + i * dom.dlon; if (lon > 180) lon -= 360;
      const inRegion = viewId === 'np' ? lat >= 15 && lat <= 72 && (lon >= 160 || lon <= -60) : viewId === 'nh' ? lat >= 15 : true;
      if (inRegion) pts.push([lon, lat]);
    }
    const q = pts.map((p) => r.project(p)).filter(Boolean);
    if (!q.length) continue;
    const x0 = Math.min(...q.map((a) => a[0])), x1 = Math.max(...q.map((a) => a[0])), y0 = Math.min(...q.map((a) => a[1])), y1 = Math.max(...q.map((a) => a[1]));
    const ix = Math.max(0, Math.min(x1, W) - Math.max(x0, 0)), iy = Math.max(0, Math.min(y1, H) - Math.max(y0, 0));
    return { fieldId, domId, W, H, box: [x0, y0, x1, y1].map(Math.round), frac: (ix * iy) / Math.max(1, (x1 - x0) * (y1 - y0)) };
  }
  return { fieldId, none: true, W, H };
})`;

export async function run({ page, baseUrl, assert, fixture }) {
  const tag = (s) => `[${fixture}] ${s}`;
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 30000 });
  await page.eval(`(async () => { ${SPY} (await import('./js/time/clock.js')).pause(); return true; })()`);
  const m = await page.eval('__wse.data.getManifest()');
  const kind = await page.eval(`import('./js/data/kind.js').then((k) => ({ recorded: k.isRecorded(__wse.data.getManifest()), long: k.sampleLabel(__wse.data.getManifest()), short: k.sampleLabel(__wse.data.getManifest(), { short: true }) }))`);

  // ---- 1. rendered text, every reachable case
  // a case is reachable when a lens fills from a field it holds (the motion demo's case has none: it is not offered)
  const FILLS = ['z500a', 'ws250', 'tp6', 't850a', 'ivt', 'z500sd'];
  const cases = m.cases ? Object.keys(m.cases).filter((k) => FILLS.some((f) => m.fields[f]?.case === k)) : [null];
  const CODE = { z500a: 'z', z500: 'z', ws250: 'j' };
  for (const c of cases) {
    if (c) {
      const code = CODE[m.cases[c].fields.find((f) => CODE[f])] || 'z';
      // the lens is what the screen's legend reads, and it decides the case
      await page.eval(`__wse.store.set({ lens: ${JSON.stringify(code)} })`);
      assert.equal(await page.eval('__wse.data.activeCase()'), c, `choosing the ${code} lens shows case ${c}`);
    }
    const about = await chipSentence(page);
    const s = { ...(await page.eval(SURFACES)), about };
    const where = tag(c ? `case ${c} (${m.cases[c].label})` : 'the recorded run');
    const shareText = s.drawn.join(' | ');
    if (kind.recorded) {
      for (const [name, list] of [['card tag', s.tag], ['header chip\'s About this data sentence', s.about], ['legend run line', s.legend]]) {
        assert.ok(list.length > 0, `${where}: the ${name} is there`);
        for (const t of list) assert.equal(t, kind.long, `${where}: the ${name} is the one sample label`);
      }
      assert.deepEqual(s.chip, [kind.short], `${where}: the header chip is the short sample label`);
      // what the chip shows is that label or a whole-segment shortening of it: every word is the label's, and the last segment ("not live") is kept
      const shown = s.chipShown[0] || '', lastSeg = kind.short.split(' · ').pop();
      assert.ok(shown && shown.split(/\s+/).every((w) => kind.short.split(/\s+/).includes(w)) && shown.endsWith(lastSeg),
        `${where}: the chip shows the short sample label or a shortening that keeps "${lastSeg}" (shows ${JSON.stringify(shown)})`);
      assert.ok(s.line2.every((t) => t.includes(kind.long)), `${where}: the timeline names the one sample label (saw ${JSON.stringify(s.line2)})`);
      assert.ok(s.drawn.includes(kind.long), `${where}: the share picture draws the one sample label as one line (drawn: ${shareText.slice(0, 400)})`);
    } else {
      const own = m.cases[c].label, others = Object.entries(m.cases).filter(([k]) => k !== c).map(([, v]) => v.label);
      for (const [name, list] of [['card tag', s.tag], ['header chip\'s About this data sentence', s.about], ['legend run line', s.legend], ['timeline line 2', s.line2]]) {
        assert.ok(list.length > 0, `${where}: the ${name} is there`);
        for (const t of list) {
          assert.ok(t.includes(own), `${where}: the ${name} names the case the map shows (saw ${JSON.stringify(t)})`);
          for (const o of others) assert.ok(!t.includes(o), `${where}: the ${name} names no other case (saw ${JSON.stringify(t)})`);
        }
      }
      assert.ok(s.chip.length === 1 && s.chip[0], `${where}: the header chip is there`);
      for (const o of others) assert.ok(!s.chip[0].includes(o), `${where}: the header chip names no other case (saw ${JSON.stringify(s.chip[0])})`);
      assert.deepEqual(s.drawn.filter((t) => t === s.legend[0]), [s.legend[0]], `${where}: the share picture draws the legend's own run line exactly once (drawn: ${shareText.slice(0, 400)})`);
      for (const o of others) assert.ok(!shareText.includes(o), `${where}: the share picture names no other case`);
    }
    assert.ok(s.drawn.includes(s.legendTitle[0]), `${where}: the share picture draws the legend's own title "${s.legendTitle[0]}" (drawn: ${shareText.slice(0, 400)})`);
  }

  // ---- 2. day 9: the sign at a pin, from the card's words, the track's colour and renderer.sampleAt
  if ((m.fields.z500a?.steps || []).at(-1) >= 240) {
    const lat = 47.6, lon = -122.3;
    await page.eval(`(async () => { __wse.store.set({ lens: 'z', view: 'np', focus: { lat: ${lat}, lon: ${lon}, label: 'Seattle', kind: 'place' } });
      await (await import('./js/story/index.js')).ensureStoryData(${lat}, ${lon}); return true; })()`);
    const d9 = await page.eval(`(async () => {
      const S = await import('./js/story/index.js'), pal = await import('./js/render/palette.js'), D = __wse.data;
      const days = await S.buildDays(${lat}, ${lon}, 0, 15); const cls = days[8], w = days.series.windows[8];
      const mid = (w.startH + w.endH) / 2;
      const ts = [...document.querySelectorAll('#timeline .tl-cell')].map((e) => +e.dataset.t);
      const t = ts.reduce((b, s) => (Math.abs(s - mid) < Math.abs(b - mid) ? s : b), ts[0]);
      __wse.store.set({ t }); await new Promise((r) => setTimeout(r, 1200));
      const ground = __wse.store.get().ground || (__wse.store.get().theme === 'light' ? 'paper' : 'night');
      const cell = [...document.querySelectorAll('#timeline .tl-cell')].find((e) => +e.dataset.t === t);
      let trackDam = null;
      if (cell?.dataset.rgb) for (let v = -60; v <= 60; v += 0.5) { const c = pal.bandRGBA('z500a', v, ground); if (c[3] && c.slice(0, 3).join(',') === cell.dataset.rgb && (trackDam === null || Math.abs(v) < Math.abs(trackDam))) trackDam = v; }
      const sa = __wse.renderer.sampleAt(${lon}, ${lat});
      const line = S.dayLine('Seattle', 'day 9', cls, { sample: !!__wse.store.get().sample });
      const strip = document.querySelectorAll('.strip-day')[8]?.getAttribute('aria-label') || '';
      return { t, storeT: __wse.store.get().t, pattern: cls.pattern, anomDam: cls.anomDam, line, strip, trackState: cell?.dataset.state, trackDam, mapDam: sa.values.z500a / 10, mapSignal: sa.signal };
    })()`);
    const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
    const cardSign = /ridge/.test(d9.pattern) ? 1 : /trough/.test(d9.pattern) ? -1 : 0;
    const words = d9.strip || d9.line;
    if (cardSign) assert.ok(new RegExp(cardSign > 0 ? 'ridge' : 'trough').test(words), tag(`the card's words for day 9 say a ${cardSign > 0 ? 'ridge' : 'trough'} (saw ${JSON.stringify(words)})`));
    assert.equal(d9.storeT, d9.t, tag('the clock stayed on the step under test'));
    const signs = [['card', cardSign], ['track', d9.trackDam == null ? 0 : sgn(d9.trackDam)], ['map', d9.mapSignal === 'none' ? 0 : sgn(d9.mapDam)]];
    const pos = signs.filter(([, s]) => s > 0).map(([n]) => n), neg = signs.filter(([, s]) => s < 0).map(([n]) => n);
    assert.ok(!(pos.length && neg.length), tag(`day 9: the card, the track and the map never point opposite ways (${JSON.stringify({ signs, d9 })})`));
    assert.ok(d9.trackState, tag('the track has a cell at the step under test'));
    if (Math.abs(d9.anomDam) >= 8 && Math.abs(d9.mapDam) >= 8 && d9.mapSignal === 'clear' && d9.pattern !== 'no-signal') {
      assert.deepEqual(signs.map(([, x]) => x), [sgn(d9.anomDam), sgn(d9.anomDam), sgn(d9.anomDam)], tag(`day 9 is strong (${d9.anomDam.toFixed(1)} dam): card, track and map agree (${JSON.stringify(d9)})`));
    }
    console.log(`  ${tag('day 9')} card ${d9.pattern} (${d9.anomDam.toFixed(1)} dam), track ${d9.trackDam} dam (${d9.trackState}), sampleAt ${d9.mapDam.toFixed(1)} dam (${d9.mapSignal}) at t=${d9.t}`);
  } else {
    console.log(`  ${tag('day 9')} not reached by this run (last step ${(m.fields.z500a?.steps || []).at(-1)} h): the sign check uses day 1 where it can`);
  }

  // ---- 3. the frame holds the data
  await page.setViewport(1440, 900, 1);
  await page.eval(`__wse.store.set({ lens: 'z' })`);
  await new Promise((r) => setTimeout(r, 600));
  const partialNote = (txt) => /Data covers part of this view/.test(txt);
  for (const view of ['np', 'nh', 'gl', 'wm']) {
    await page.eval(`__wse.store.set({ view: ${JSON.stringify(view)} })`);
    await new Promise((r) => setTimeout(r, 600));
    const c = await page.eval(`${COVER}(${JSON.stringify(view)})`);
    const note = partialNote(await page.eval('document.body.textContent'));
    console.log(`  ${tag(view)} frame ${c.W}x${c.H}: ${c.none ? 'no valid data' : `holds ${(c.frac * 100).toFixed(1)}% of the valid ${c.fieldId} data on ${c.domId}`}`);
    if (fixture !== 'sample-min') {
      assert.ok(!c.none && c.frac >= 0.8, tag(`${view}: the frame holds at least 80% of the valid-data box (${JSON.stringify(c)})`));
      assert.equal(note, false, tag(`${view}: "Data covers part of this view" is accepted only on sample-min`));
    }
  }
  assert.deepEqual(page.errors(), [], JSON.stringify(page.errors()));
}
