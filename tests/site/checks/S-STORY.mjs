// S-STORY (browser part): the story is built from the loaded data and drives the home card. On every fixture the number
// of columns equals the number of local days that have data (never a hatched phantom day), the summary is a short
// consequence-plus-cause sentence, and the strip's wave is a smooth curve. Goldens for the pure functions live in
// tests/site/unit/wp4.story.test.mjs and wp11.*.test.mjs.
export const id = 'S-STORY';
export const tier = 'deploy'; // fast, offline, about data honesty: the data and Pages workflows run it
export const freshProfile = true;
// 'recorded' is the product's own sample (W2-09): its San Francisco week ends in a no-clear-signal day, where the "normal"
// label once sat on the neutral band; 'synthetic-15d-nomean' is a run without the ensemble mean (zones 7.2, hasMean false).
export const data = ['synthetic', 'synthetic-15d', 'synthetic-15d-nomean', 'synthetic-partial', 'recorded-min', 'recorded', 'sample-min'];

// In-page helper (a string, evaluated in the page): every way the "normal" label meets a no-signal rect or the drawn wave
// path, from real getBBox boxes and path points. Empty when the label is clear or absent.
const NORMAL_HITS = `(svg) => {
  const nl = svg.querySelector('text.strip-normal'); if (!nl) return [];
  const bb = (e) => { const b = e.getBBox(); return { l: b.x, r: b.x + b.width, t: b.y, b: b.y + b.height }; };
  const B = bb(nl), out = [];
  for (const r of svg.querySelectorAll('rect.slice.nosignal')) { const R = bb(r); if (B.l < R.r && R.l < B.r && B.t < R.b && R.t < B.b) out.push('nosignal ' + JSON.stringify(R)); }
  const line = [...svg.querySelectorAll('path.wave-line')].find((p) => !p.classList.contains('wave-line-mini'));
  if (line) for (let q = 0, L = line.getTotalLength(); q <= L; q += 0.5) { const p = line.getPointAtLength(q); if (p.x >= B.l && p.x <= B.r && p.y >= B.t && p.y <= B.b) { out.push('curve ' + p.x.toFixed(1) + ',' + p.y.toFixed(1)); break; } }
  return out.map((h) => h + ' vs normal ' + JSON.stringify(B));
}`;

export async function run({ page, baseUrl, assert, fixture }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 20000 });
  await page.eval(`(async () => { window.S = await import('./js/story/index.js'); window.ST = await import('./js/story/strip.js'); return true; })()`);
  const tag = (s) => `[${fixture}] ${s}`;

  // What the home card must show, worked out from the manifest alone: the local days (San Francisco, UTC-8) that the
  // data span overlaps, at most the seven the home asks for. Not hatched, not padded.
  const exp = await page.eval(`(() => {
    const m = __wse.data.getManifest(), f = m.fields.z500a, H = 3600e3, DAY = 24 * H, off = -8 * H;
    const v0 = f.source && f.source.valid && f.source.valid[0];
    const t0 = (v0 ? Date.parse(v0.replace(/Z$/, ':00Z')) : Date.parse(m.run.replace(/Z$/, ':00Z'))) - f.steps[0] * H;
    const first = t0 + f.steps[0] * H, last = t0 + f.steps[f.steps.length - 1] * H, now = Date.now();
    const start = !m.sample && now >= first && now <= last ? now : first;
    const d0 = Math.floor((start + off) / DAY), d1 = Math.floor((last + off - 1) / DAY);
    return { n: Math.min(7, d1 - d0 + 1), live: !m.sample };
  })()`);

  // home card: a summary sentence and one tappable column per day with data
  const card = await page.eval(`(() => { const c = document.querySelector('#sec-week .card'); return {
    summary: c.querySelector('.summary').textContent, days: c.querySelectorAll('.strip-day').length,
    hatchNoData: c.querySelectorAll('.hatch-nodata').length, text: c.textContent,
    normalHits: (${NORMAL_HITS})(c.querySelector('svg.strip')), normal: !!c.querySelector('text.strip-normal'), nosignal: c.querySelectorAll('rect.slice.nosignal').length }; })()`);
  // the home card as a person sees it (1440 x 900): "normal" never sits on the neutral band or the wave
  assert.deepEqual(card.normalHits, [], tag('home card: "normal" clear of the no-signal band and the curve'));
  if (fixture === 'recorded') assert.ok(card.nosignal >= 1 && card.normal, tag('the recorded week has its no-signal band and still a "normal" label: ' + JSON.stringify([card.nosignal, card.normal])));
  assert.equal(card.days, exp.n, tag(`columns equal days with data: ${card.days} vs ${exp.n}`));
  assert.equal(card.hatchNoData, 0, tag('no hatched day'));
  assert.ok(!/No data past/i.test(card.text), tag('no "No data past": ' + card.text));
  assert.ok(!/\b1 days\b/.test(card.text), tag('plural: ' + card.text));
  assert.ok(card.summary.length >= 12 && card.summary.length <= 110 && /\.$/.test(card.summary), tag(`summary (${card.summary.length}): ${card.summary}`));
  if (fixture === 'synthetic-15d') {
    // acceptance 7: a consequence AND a cause (DESIGN-SPEC 7.3 words), not rain words alone
    assert.ok(/a ridge builds|under a ridge|a trough approaches|under a trough|behind the trough/.test(card.summary), tag('the home summary names its cause: ' + card.summary));
  }
  assert.ok(!/settled/i.test(card.text), tag('the words settled and unsettled appear nowhere: ' + card.text));

  // buildDays + stripSVG on real loaded data
  const r = await page.eval(`(async () => {
    const days = await S.buildDays(37.77, -122.42, 0, 6);
    const svg = S.stripSVG(days, days.series, 'dark', { width: 336 });
    const n = S.notability(37.77, -122.42);
    return { n: days.length, c: days.coverage, d0: days[0], taps: svg.querySelectorAll('.strip-day').length, hatch: svg.querySelectorAll('.hatch-nodata').length,
      score: n.score, reason: n.reason, summary: S.summarize(days), arrayDays: Array.isArray(days.days) && days.days.length === days.length, hasSeries: !!days.series };
  })()`);
  assert.equal(r.n, r.c.withData, tag('coverage.withData equals the days returned'));
  assert.ok(r.n >= 1 && r.n <= r.c.requested, tag('days returned never exceed the request'));
  assert.ok(r.arrayDays && r.hasSeries, tag('buildDays returns {days, series, coverage}'));
  assert.equal(r.taps, r.n);
  assert.equal(r.hatch, 0, tag('strip: no hatched day'));
  assert.ok(['ridge', 'trough', 'trough-arriving', 'ridge-building', 'near-normal', 'no-signal'].includes(r.d0.pattern), tag('day 1 pattern: ' + r.d0.pattern));
  assert.ok(Number.isFinite(r.score), tag('notability ' + r.score));
  assert.ok(!/^(Trough|Ridge) /.test(r.reason) && !/settled/i.test(r.reason), tag('reason: ' + r.reason));
  assert.ok(r.summary.length >= 12 && r.summary.length <= 110, tag('summary: ' + r.summary));

  const range = await page.eval(`(() => { const st = __wse.data.fieldSteps('z500a'); return [st[0], st[st.length - 1]]; })()`);
  const ts = await page.eval(`[...document.querySelectorAll('#sec-week .strip-day')].map(x => +x.dataset.t)`);
  assert.ok(ts.every((t) => t >= range[0] && t <= range[1]), tag('every strip day scrubs inside the loaded range: ' + ts + ' in ' + range));

  // the wave is a smooth curve: turning angle under 30 degrees at every model-step point, no overshoot between points
  const curve = await page.eval(`(async () => {
    const measure = (path) => {
      const knots = JSON.parse(path.getAttribute('data-knots')), L = path.getTotalLength(), pts = [];
      for (let s = 0; s <= L; s += 1) { const p = path.getPointAtLength(s); pts.push([p.x, p.y]); }
      pts.push((() => { const p = path.getPointAtLength(L); return [p.x, p.y]; })());
      const idx = (x) => { let b = 0, bd = Infinity; pts.forEach((p, i) => { const d = Math.abs(p[0] - x); if (d < bd) { bd = d; b = i; } }); return b; };
      let maxTurn = 0, over = 0;
      for (let k = 1; k + 1 < knots.length; k++) {
        const i = idx(knots[k][0]); if (i < 2 || i + 2 >= pts.length) continue;
        const a = [pts[i][0] - pts[i - 2][0], pts[i][1] - pts[i - 2][1]], b = [pts[i + 2][0] - pts[i][0], pts[i + 2][1] - pts[i][1]];
        const cos = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b) || 1);
        maxTurn = Math.max(maxTurn, Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI);
      }
      for (let k = 0; k + 1 < knots.length; k++) {
        const lo = Math.min(knots[k][1], knots[k + 1][1]) - 0.05, hi = Math.max(knots[k][1], knots[k + 1][1]) + 0.05;
        for (const p of pts) if (p[0] >= knots[k][0] && p[0] <= knots[k + 1][0] && (p[1] < lo || p[1] > hi)) over = Math.max(over, p[1] < lo ? lo - p[1] : p[1] - hi);
      }
      return { knots: knots.length, maxTurn, over };
    };
    const mount = (svg) => { svg.style.position = 'absolute'; svg.style.left = '-9999px'; document.body.appendChild(svg); return svg; };
    // the loaded data
    const days = await S.buildDays(37.77, -122.42, 0, 14);
    const svg = mount(ST.stripSVG(days, days.series, { width: 336 }));
    const real = svg.querySelector('path.wave-line') ? measure(svg.querySelector('path.wave-line')) : null;
    svg.remove();
    // +-10 dam alternating every 12 h: a straight-join polyline turns by about 76 degrees at every step point here
    const wins = []; for (let i = 0; i < 7; i++) wins.push({ date: '2026-11-' + String(16 + i).padStart(2, '0'), startH: 24 * i, endH: 24 * i + 24 });
    const steps = [], values = []; for (let h = 0; h <= 168; h += 12) { steps.push(h); values.push(h / 12 % 2 ? 100 : -100); }
    const zs = { windows: wins, z500a: { steps, values: Float32Array.from(values) } };
    const zdays = wins.map((w, i) => S.classifyDay(zs, i, i + 1));
    const zsvg = mount(ST.stripSVG(zdays, zs, { width: 336 }));
    const zig = measure(zsvg.querySelector('path.wave-line'));
    zsvg.remove();
    return { real, zig };
  })()`);
  if (curve.real) {
    assert.ok(curve.real.maxTurn < 30, tag(`real data: turning angle ${curve.real.maxTurn.toFixed(1)} deg`));
    assert.ok(curve.real.over < 0.06, tag(`real data: overshoot ${curve.real.over}`));
  }
  assert.ok(curve.zig.knots >= 8, tag('zig-zag knots ' + curve.zig.knots));
  assert.ok(curve.zig.maxTurn < 30, tag(`zig-zag: turning angle ${curve.zig.maxTurn.toFixed(1)} deg`));
  assert.ok(curve.zig.over < 0.06, tag(`zig-zag: overshoot ${curve.zig.over}`));

  if (fixture === 'synthetic-15d') {
    // a 7-day request on a 15-day run: 7 columns, and the days beyond the request are not drawn
    const w = await page.eval(`(async () => { const d = await S.buildDays(37.77, -122.42, 0, 6); return { n: d.length, req: d.coverage.requested, first: d.coverage.firstDate, last: d.coverage.lastDate }; })()`);
    assert.equal(w.n, 7, tag('7 columns on a 7-day request'));
    // the no-signal probe at 300 h: forecasts disagree, said in those words, never "near normal"
    const sig = await page.eval(`(async () => {
      const out = {};
      for (const [name, lat, lon] of [['none', 30, -56], ['clear', 70, -120]]) {
        const d = await S.buildDays(lat, lon, 0, 14);
        const i = d.series.windows.findIndex((w) => 300 >= w.startH && 300 < w.endH);
        out[name] = { signal: d[i].signal, pattern: d[i].pattern, line: S.dayLine(name, 'Wed', d[i]) };
      }
      return out;
    })()`);
    assert.equal(sig.none.signal, 'none', tag(JSON.stringify(sig.none)));
    assert.ok(sig.none.line.includes('No clear signal yet: forecasts disagree'), tag(sig.none.line));
    assert.ok(!/near[- ]normal|settled/i.test(sig.none.line), tag(sig.none.line));
    assert.equal(sig.clear.signal, 'clear', tag(JSON.stringify(sig.clear)));
    assert.ok(/ridge/i.test(sig.clear.line), tag(sig.clear.line));
  }

  // DESIGN-SPEC 14.3 rule 1 on live-like days (a first column that is today, the state a person sees): no two strip-label
  // boxes intersect and none leaves the SVG, at the real card width (313), the phone card (324; ranges 7, 10, 15) and
  // 640 px; the active day always has its label; the "normal" label is drawn above the passed-hours block.
  const lab = await page.eval(`(async () => {
    const mount = (svg) => { svg.style.position = 'absolute'; svg.style.left = '-9999px'; document.body.appendChild(svg); return svg; };
    const out = [];
    // 280-400 px desktop strips at range 15 and expanded phone strips: the widths where the two zone notes compete for one lane
    for (const [W, phone, to, expanded] of [[313, false, 6], [324, true, 6], [324, true, 9], [324, true, 14], [313, false, 14], [640, false, 14], [640, false, 6],
      [280, false, 14], [330, false, 14], [360, false, 14], [400, false, 14], [280, true, 14, true], [313, true, 14, true], [360, true, 14, true], [400, true, 14, true], [313, true, 9, true]]) {
      const base = await S.buildDays(37.77, -122.42, 0, to);
      if (base.length < 2) continue;
      const days = Array.from(base);
      for (const k of ['series', 'windows']) Object.defineProperty(days, k, { value: base[k], enumerable: false });
      const cov = { ...base.coverage, todayDate: base[0].date, kind: 'live' };
      Object.defineProperty(days, 'coverage', { value: cov, enumerable: false });
      days[0] = { ...base[0], today: true, passedH: base.series.windows[0].startH + 9 };
      for (const active of [-1, 0, 1, Math.min(3, days.length - 1), Math.min(6, days.length - 1)]) {
        const svg = mount(ST.stripSVG(days, base.series, { width: W, phone, range: to + 1, activeDay: active, expanded: !!expanded }));
        const boxes = [...svg.querySelectorAll('text.strip-label')].map((t) => { const b = t.getBBox(); return { t: t.textContent, l: b.x, r: b.x + b.width }; });
        let minGap = Infinity, inside = true;
        boxes.forEach((b, i) => { if (b.l < -0.01 || b.r > W + 0.01) inside = false; if (i) minGap = Math.min(minGap, b.l - boxes[i - 1].r); });
        const mainCols = svg.querySelectorAll('rect.strip-day').length;
        const hasActive = active < 0 || (!!svg.querySelector('rect.strip-underline') && [...svg.querySelectorAll('text.strip-label')].some((t) => t.getAttribute('style').includes('600')));
        const nl = svg.querySelector('text.strip-normal'), passed = svg.querySelector('g.passed');
        const order = nl && passed ? !!(passed.compareDocumentPosition(nl) & Node.DOCUMENT_POSITION_FOLLOWING) : true;
        // zone notes: clear of every day label, the fill, the hatch and the curve at their x
        const nb = (e) => { const b = e.getBBox(); return { l: b.x, r: b.x + b.width, t: b.y, b: b.y + b.height }; };
        const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
        const notes = [...svg.querySelectorAll('text.strip-note')].filter((t) => !t.closest('.passed')).map((t) => ({ text: t.textContent, ...nb(t) }));
        const labs = [...svg.querySelectorAll('text.strip-label')].map(nb);
        const fills = [...svg.querySelectorAll('rect.slice, rect.hatch-pattern-only, rect.hatch-nodata, polygon.envelope')].map(nb);
        const line = svg.querySelector('path.wave-line'), lp = [];
        if (line) for (let q = 0, L = line.getTotalLength(); q <= L; q += 1) { const p = line.getPointAtLength(q); lp.push(p); }
        let noteHits = 0; const noteWhy = [];
        for (const t of notes) {
          if (labs.some((l) => hit(t, l))) { noteHits++; noteWhy.push('label'); }
          if (fills.some((f) => hit(t, f))) { noteHits++; noteWhy.push('fill ' + JSON.stringify(t) + JSON.stringify(fills.find((f) => hit(t, f)))); }
          if (lp.some((p) => p.x >= t.l && p.x <= t.r && p.y >= t.t && p.y <= t.b)) noteHits++;
          if (t.l < -0.01 || t.r > W + 0.01) { noteHits++; noteWhy.push('outside ' + JSON.stringify(t)); }
        }
        // the zone notes in the lane above the wave never meet each other (the stacked end-cell words sit below the
        // normal line, one per line, and are left out); 2 px of air between any two
        const mid0 = +svg.querySelector('line.normal-line').getAttribute('y1');
        const lane = notes.filter((t) => t.b < mid0);
        for (let a = 0; a < lane.length; a++) for (let b = a + 1; b < lane.length; b++) {
          const A = lane[a], B = lane[b];
          if (A.l < B.r + 2 && B.l < A.r + 2 && A.t < B.b && B.t < A.b) { noteHits++; noteWhy.push('note on note ' + JSON.stringify([A, B])); }
        }
        // phone end cell: the mini wave leaves the cell's own normal line (flat series: its baseline equals the line)
        const eline = svg.querySelector('line.end-normal-line'), mini = svg.querySelector('path.wave-line-mini');
        let miniOff = null;
        if (eline && mini) {
          const ly = +eline.getAttribute('y1');
          const sl = [...svg.querySelectorAll('g.wave-mini rect.slice')].map((r) => r.getBBox());
          miniOff = { ly, mainMid: +svg.querySelector('line.normal-line').getAttribute('y1'), sliceMid: sl.length ? sl[0].y + sl[0].height / 2 : null };
        }
        const normalHits = (${NORMAL_HITS})(svg);
        const noteMinPx = Math.min(...[...svg.querySelectorAll('text.strip-note, text.strip-label')].map((t) => parseFloat(t.style.fontSize || getComputedStyle(t).fontSize)));
        out.push({ expanded: !!expanded, normalHits, noteHits, noteWhy, notesN: notes.length, miniOff, minFont: noteMinPx, endLabel: (svg.querySelector('text.strip-label-end') || {}).textContent, W, phone, to, active, n: boxes.length, minGap: +minGap.toFixed(2), inside, hasActive, order, labels: boxes.map((b) => b.t).join(','), mainCols });
        svg.remove();
      }
    }
    return out;
  })()`);
  const GAP = await page.eval('ST.LABEL_GAP');
  assert.ok(GAP >= 4, tag('the label gap is a real gap: ' + GAP));
  for (const r of lab) {
    const where = tag(`labels at ${r.W} px phone=${r.phone}${r.expanded ? ' expanded' : ''} range=${r.to + 1} active=${r.active}: ${r.labels}`);
    assert.ok(r.inside, where + ' inside the SVG');
    assert.ok(r.n < 2 || r.minGap >= GAP - 0.05, where + ` no two label boxes meet: at least ${GAP} px apart (min gap ${r.minGap})`);
    assert.ok(r.hasActive, where + ' the active day keeps its label');
    assert.equal(r.noteHits, 0, where + ` zone notes (${r.notesN}) clear of labels, fill, hatch and curve ${r.noteWhy}`);
    assert.ok(r.minFont >= 12, where + ' no strip text under 12 px: ' + r.minFont);
    if (r.miniOff) assert.equal(r.miniOff.ly, r.miniOff.mainMid, where + ' the end cell line is the same normal line as the main strip');
    assert.ok(r.order, where + ' "normal" drawn after (above) the passed block');
    assert.deepEqual(r.normalHits, [], where + ' "normal" clear of the no-signal band and the curve');
  }
  // Wider glyphs than this machine's: GitHub's Linux runner rendered "Today ... Sun 22" at 313 px with the boxes
  // overlapping (run 44552620826, min gap -0.12). Force wider metrics here, platform-independently (letter-spacing on the
  // strip text, then a wide fallback font for --font-ui), and hold the same rule: every label box inside the strip, at
  // least LABEL_GAP apart (the end-cell label included), the active day named. Then the in-place refit: a strip built
  // with plain metrics and mounted into a container that spaces its letters re-fits its labels within a few frames.
  const WIDE = [['letter-spacing 1.5px', 'svg.strip text{letter-spacing:1.5px}'], ['letter-spacing 3px', 'svg.strip text{letter-spacing:3px}'],
    ['wide font', ':root{--font-ui:Verdana,"DejaVu Sans",Geneva,sans-serif} svg.strip text{letter-spacing:.6px}']];
  const wide = await page.eval(`(async () => {
    const out = [];
    const boxesOf = (svg, W) => {
      const all = [...svg.querySelectorAll('text.strip-label')].map((t) => { const b = t.getBBox(); return { t: t.textContent, l: b.x, r: b.x + b.width, bold: t.getAttribute('style').includes('600') }; }).sort((a, b) => a.l - b.l);
      let minGap = Infinity, inside = true;
      all.forEach((b, i) => { if (b.l < -0.01 || b.r > W + 0.01) inside = false; if (i) minGap = Math.min(minGap, b.l - all[i - 1].r); });
      return { n: all.length, minGap: +minGap.toFixed(2), inside, bold: all.some((b) => b.bold), labels: all.map((b) => b.t).join(',') };
    };
    for (const [name, css] of ${JSON.stringify(WIDE)}) {
      const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
      try {
        for (const [W, phone, to, expanded] of [[313, false, 6], [264, false, 6], [324, true, 6], [324, true, 9], [324, true, 14], [313, false, 14], [640, false, 14], [640, false, 6], [360, true, 14, true]]) {
          const base = await S.buildDays(37.77, -122.42, 0, to);
          if (base.length < 2) continue;
          const days = Array.from(base);
          for (const k of ['series', 'windows']) Object.defineProperty(days, k, { value: base[k], enumerable: false });
          Object.defineProperty(days, 'coverage', { value: { ...base.coverage, todayDate: base[0].date, kind: 'live' }, enumerable: false });
          days[0] = { ...base[0], today: true, passedH: base.series.windows[0].startH + 9 };
          for (const active of [-1, 0, 1, Math.min(3, days.length - 1), Math.min(6, days.length - 1)]) {
            const svg = ST.stripSVG(days, base.series, { width: W, phone, range: to + 1, activeDay: active, expanded: !!expanded });
            svg.style.position = 'absolute'; svg.style.left = '-9999px'; document.body.appendChild(svg);
            out.push({ name, W, phone, to, expanded: !!expanded, active, ...boxesOf(svg, W) });
            svg.remove();
          }
        }
      } finally { st.remove(); }
    }
    // the in-place refit: built with plain metrics, then mounted where the letters are spaced 3 px
    const base = await S.buildDays(37.77, -122.42, 0, 6);
    const host = document.createElement('div'); host.style.cssText = 'position:absolute;left:-9999px;letter-spacing:3px'; document.body.appendChild(host);
    const svg = ST.stripSVG(base, base.series, { width: 313, activeDay: 1 });
    const built = [...svg.querySelectorAll('text.strip-label')].length;
    host.appendChild(svg);
    const before = boxesOf(svg, 313);
    for (let f = 0; f < 3; f++) await new Promise((r) => requestAnimationFrame(r));
    const after = boxesOf(svg, 313);
    host.remove();
    return { out, refit: { built, before, after } };
  })()`);
  assert.ok(wide.out.length >= 3 * 5, tag('wide-glyph cases ran: ' + wide.out.length));
  for (const r of wide.out) {
    const where = tag(`${r.name}: labels at ${r.W} px phone=${r.phone}${r.expanded ? ' expanded' : ''} range=${r.to + 1} active=${r.active}: ${r.labels}`);
    assert.ok(r.inside, where + ' inside the SVG');
    assert.ok(r.n < 2 || r.minGap >= GAP - 0.05, where + ` at least ${GAP} px apart (min gap ${r.minGap})`);
    assert.ok(r.n >= 1, where + ' some label drawn');
    assert.ok(r.active < 0 || r.bold, where + ' the active day keeps its label');
  }
  assert.ok(wide.refit.after.inside && (wide.refit.after.n < 2 || wide.refit.after.minGap >= GAP - 0.05) && wide.refit.after.bold,
    tag('mounted into a letter-spaced card, the strip re-fits its labels: ' + JSON.stringify(wide.refit)));

  // the phone end cell's mini wave is centred on the cell's own normal line: its slice rects (full wave height about the
  // wave's baseline) have the line's y as their centre, so blue is below the visible line and orange above it
  const mini = await page.eval(`(() => {
    const wins = []; for (let i = 0; i < 15; i++) wins.push({ date: '2026-11-' + String(16 + i).padStart(2, '0'), startH: 24 * i, endH: 24 * i + 24 });
    const steps = [], values = []; for (let h = 0; h <= 360; h += 12) { steps.push(h); values.push(h < 180 ? 100 : -100); }
    const zs = { windows: wins, z500a: { steps, values: Float32Array.from(values) } };
    const zdays = wins.map((w, i) => S.classifyDay(zs, i, i + 1));
    const svg = ST.stripSVG(zdays, zs, { width: 324, phone: true, range: 15 }); svg.style.position = 'absolute'; svg.style.left = '-9999px'; document.body.appendChild(svg);
    const line = +svg.querySelector('line.end-normal-line').getAttribute('y1');
    const sl = [...svg.querySelectorAll('g.wave-mini rect.slice')].map((r) => { const b = r.getBBox(); return b.y + b.height / 2; });
    const knots = JSON.parse(svg.querySelector('path.wave-line-mini').getAttribute('data-knots'));
    svg.remove();
    return { line, slices: sl.length, off: sl.length ? Math.max(...sl.map((y) => Math.abs(y - line))) : null, kMin: Math.min(...knots.map((k) => k[1])), kMax: Math.max(...knots.map((k) => k[1])) };
  })()`);
  assert.ok(mini.slices >= 1 && mini.off < 0.5, tag('the end-cell mini wave is centred on the cell normal line: ' + JSON.stringify(mini)));
  assert.ok(mini.kMin < mini.line && mini.kMax > mini.line, tag('a +10 then -10 dam run crosses the cell line: ' + JSON.stringify(mini)));

  // The zones table drives the strip (DESIGN-SPEC 7.2): with the ensemble mean days 8-10 are the dashed "broad pattern"
  // and the hatch starts at day 11; without it (synthetic-15d-nomean, recorded-min, recorded) the hatch starts at day 8,
  // the note is "pattern only" and nothing says "broad".
  if (['synthetic-15d', 'synthetic-15d-nomean', 'recorded-min', 'recorded'].includes(fixture)) {
    const z = await page.eval(`(async () => {
      const d = await S.buildDays(37.77, -122.42, 0, 14);
      const svg = ST.stripSVG(d, d.series, { width: 640 }); svg.style.position = 'absolute'; svg.style.left = '-9999px'; document.body.appendChild(svg);
      const hx = [...svg.querySelectorAll('rect.hatch-pattern-only')].map((h) => +h.getAttribute('x'));
      const cols = [...svg.querySelectorAll('rect.strip-day')].map((c) => hx.includes(+c.getAttribute('x')));
      const notes = [...svg.querySelectorAll('text.strip-zone-note')].map((t) => t.textContent);
      const all = [...svg.querySelectorAll('text')].map((t) => t.textContent).join(' | ') + [...svg.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')).join(' | ');
      const out = { hasMean: d.series.hasMean, field: !!__wse.data.getManifest().fields.z500em, leads: d.map((c) => c.lead), cols, notes, dashed: svg.querySelectorAll('line.zone-dashed').length, broad: /broad/i.test(all), normalHits: (${NORMAL_HITS})(svg) };
      svg.remove();
      return out;
    })()`);
    const zt = tag('zones ' + JSON.stringify(z));
    assert.equal(z.hasMean, z.field, zt);
    assert.deepEqual(z.normalHits, [], zt);
    if (z.hasMean) {
      assert.deepEqual(z.cols, z.leads.map((l) => l >= 11), zt);
      if (z.leads.length >= 11) { assert.equal(z.dashed, 1, zt); assert.deepEqual(z.notes, ['broad pattern', 'pattern only'], zt); }
    } else {
      assert.ok(z.leads.length >= 8, zt);
      assert.deepEqual(z.cols, z.leads.map((l) => l >= 8), zt);
      assert.equal(z.dashed, 0, zt); assert.equal(z.broad, false, zt); assert.deepEqual(z.notes, ['pattern only'], zt);
    }
  }

  // a no-clear-signal day is visibly neutral, not a sliver: the neutral band is at least 8 px tall where signal is none
  if (fixture === 'synthetic-15d') {
    const band = await page.eval(`(async () => {
      const d = await S.buildDays(30, -56, 0, 14);
      const svg = ST.stripSVG(d, d.series, { width: 640 }); svg.style.position = 'absolute'; svg.style.left = '-9999px'; document.body.appendChild(svg);
      const none = d.filter((c) => c.signal === 'none').length, normalHits = (${NORMAL_HITS})(svg);
      const nodes = [...svg.querySelectorAll('rect.slice.nosignal')];
      // visible, not just present: a rect inside a clip-path group shows only the part inside the clip (a sliver on the curve)
      const clipped = nodes.filter((r) => r.closest('[clip-path]')).length;
      const rects = nodes.map((r) => r.getBBox());
      const area = rects.reduce((a, b) => a + b.width * b.height, 0), minH = Math.min(...rects.map((b) => b.height));
      svg.remove();
      return { none, rects: rects.length, clipped, area, minH, normalHits };
    })()`);
    assert.ok(band.none >= 1 && band.rects >= 1, tag('the no-signal probe has no-signal days: ' + JSON.stringify(band)));
    assert.deepEqual(band.normalHits, [], tag('"normal" clear of the band at the no-signal probe: ' + JSON.stringify(band)));
    assert.equal(band.clipped, 0, tag('no-signal band rects are not inside a clip-path group: ' + JSON.stringify(band)));
    assert.ok(band.minH >= 8 && band.area >= 8 * 640 / 15 * band.none * 0.8, tag('neutral band is visible on no-signal days: ' + JSON.stringify(band)));
  }

  // tapping a strip day scrubs the clock there and centres the focus
  await page.eval(`__wse.store.set({ playing: false })`);
  const before = await page.eval(`__wse.store.get().t`);
  const target = await page.eval(`(() => { const d = [...document.querySelectorAll('#sec-week .strip-day')].find(x => +x.dataset.t > 0 && Math.abs(+x.dataset.t - __wse.store.get().t) > 3); if (!d) return null; d.dispatchEvent(new MouseEvent('click', { bubbles: true })); return +d.dataset.t; })()`);
  if (target != null) {
    await page.waitFor(`Math.abs(__wse.store.get().t - ${target}) < 0.6`, { timeout: 4000 });
    assert.notEqual(before, target);
    assert.equal(await page.eval(`__wse.store.get().focus.label`), 'San Francisco');
  } else assert.ok(exp.n <= 1, tag('a later strip day exists unless the data hold one day'));

  // a person's name never reaches the focus: label is the city, placeRef null
  await page.eval(`(async () => { const g = await import('./js/pins/gazetteer.js'); const [c] = await g.gazetteer.search('Portland', 3); __wse.pins.add({ kind: 'person', name: 'Maya', group: 'friends', city: c }); })()`);
  await page.waitFor(`document.querySelector('.person-main')`, { timeout: 5000 });
  await page.eval(`document.querySelector('.person-main').click()`);
  await page.waitFor(`__wse.store.get().focus && __wse.store.get().focus.kind === 'person'`, { timeout: 5000 });
  const f = await page.eval(`__wse.store.get().focus`);
  assert.ok(/^Portland/.test(f.label) && !/Maya/.test(JSON.stringify(f)) && f.placeRef == null, JSON.stringify(f));
  assert.deepEqual(page.errors(), [], JSON.stringify(page.errors()));
}
