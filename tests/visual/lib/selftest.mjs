// Self-test of the tour runner and the layout assertions (W1-01 tests; spec 14.1 rule 2 and 14.3 "known-positive").
// node tests/visual/lib/selftest.mjs
// Proves, on small synthetic pages, that: each of the five assertions fires on its known-positive and stays quiet on a clean page;
// a legend shifted 40 px over the timeline fails assertion 1 AND exceeds the pixel-diff tolerance; an ungated stop reports without
// failing the run; a stop that throws fails the run; and the contact sheet is one self-contained file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Browser } from '../../site/lib/cdp.mjs';
import { artifactsDir } from '../../site/lib/artifacts.mjs';
import { runLayoutAssertions } from './layout-assert.mjs';
import { runTour } from './tour.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} visual selftest: ${name}${ok ? '' : '  ' + extra}`); if (!ok) failed++; };
const data = (body, css = '') => 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px/20px system-ui;background:#fff;color:#111}${css}</style>${body}`);

const CASES = [
  // [name, html, opts, expected failing assertions, text the first offender must mention]
  ['a clean page has no offenders', data(`<h1 style="font-size:24px">Title</h1><button style="width:48px;height:48px">A</button><p>Plain text that wraps normally in its box.</p><div id=sc style="width:100px;overflow-x:auto;white-space:nowrap"><span style="display:inline-block;width:300px">scrolls</span></div>`), { phone: true, scrollers: ['#sc'] }, []],
  ['1 overlap: two texts that intersect', data(`<p id=a style="position:absolute;left:20px;top:40px;margin:0">First line of text</p><p id=b style="position:absolute;left:30px;top:44px;margin:0">Second line over it</p>`), {}, [1], '#a'],
  ['1 overlap: a declared allowOverlap pair is not flagged', data(`<p id=a style="position:absolute;left:20px;top:40px;margin:0">First line of text</p><p id=b style="position:absolute;left:30px;top:44px;margin:0">Second line over it</p>`), { allowOverlap: [['#a', '#b']] }, []],
  ['1 overlap: a button containing its text is not flagged', data(`<button style="width:120px;height:44px">Contained label</button>`), {}, []],
  ['2 hscroll: scrollWidth beyond clientWidth', data(`<div id=sc style="width:100px;overflow-x:auto;white-space:nowrap"><span style="display:inline-block;width:300px">x</span></div>`), {}, [2], '#sc'],
  ['2 hscroll: a declared scroller is not flagged', data(`<div id=sc style="width:100px;overflow-x:auto;white-space:nowrap"><span style="display:inline-block;width:300px">x</span></div>`), { scrollers: ['#sc'] }, []],
  ['3 textsize: text at 10 px', data(`<span id=s style="font-size:10px">tiny text</span>`), {}, [3], '#s'],
  ['3 textsize: text at 12 px passes', data(`<span style="font-size:12px">twelve px text</span>`), {}, []],
  ['3 textsize: 12-unit SVG text in a viewBox shrunk to half size renders at 6 px', data(`<svg id=sv viewBox="0 0 400 40" width="200" style="display:block"><text id=st x="4" y="24" font-size="12">shrunk label</text></svg>`), {}, [3], '#st'],
  ['3 textsize: 12-unit SVG text in a viewBox drawn at full size passes', data(`<svg viewBox="0 0 400 40" width="400" style="display:block"><text x="4" y="24" font-size="12">full size label</text></svg>`), {}, []],
  ['3 textsize: 14 px text under transform:scale(.5) renders at 7 px', data(`<div style="transform:scale(.5);transform-origin:0 0"><p id=tp style="margin:0;font-size:14px">scaled down</p></div>`), {}, [3], '#tp'],
  ['3 textsize: 14 px text under transform:scale(1) passes', data(`<div style="transform:scale(1)"><p style="margin:0;font-size:14px">not scaled</p></div>`), {}, []],
  ['4 clipped: text taller than its overflow:hidden box', data(`<div id=c style="width:100px;height:20px;overflow:hidden">A long line that wraps onto several lines and does not fit</div>`), {}, [4], '#c'],
  ['2+4: text wider than its overflow:hidden box is both a scroll overflow and clipped', data(`<div id=c style="width:50px;height:24px;overflow:hidden;white-space:nowrap">A long line that does not fit</div>`), {}, [2, 4], '#c'],
  ['4 clipped: a deliberate ellipsis is not flagged', data(`<div style="width:50px;height:24px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">A long line that does not fit</div>`), {}, []],
  ['4 clipped: scrolled-out text in a scroller is not flagged', data(`<div style="width:200px;height:40px;overflow:hidden"><div style="height:40px;overflow-y:auto"><p style="margin:0;height:100px">first</p><p style="margin:0">second</p></div></div>`), {}, []],
  ['5 target: a 30 px button on the phone', data(`<button id=t style="width:30px;height:30px">x</button>`), { phone: true }, [5], '#t'],
  ['5 target: a listed allowTarget control is not an offender, an unlisted one still is', data(`<button id=ok style="width:30px;height:30px">x</button><button id=t style="width:30px;height:30px">y</button>`), { phone: true, allowTarget: ['#ok'] }, [5], '#t'],
  ['5 target: allowTarget alone clears the stop', data(`<button id=ok style="width:30px;height:30px">x</button>`), { phone: true, allowTarget: ['#ok'] }, []],
  ['5 target: the same button on the desktop is fine', data(`<button style="width:30px;height:30px">x</button>`), { phone: false }, []],
  ['visually hidden text is not judged', data(`<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);font-size:8px">screen reader text that is long</span><p>ok</p>`), {}, []],
  ['an open modal scopes the check to its own content', data(`<p id=a style="position:absolute;left:20px;top:40px;margin:0">under one</p><p id=b style="position:absolute;left:30px;top:44px;margin:0">under two</p><div role=dialog aria-modal=true style="position:fixed;left:0;right:0;bottom:0;height:300px;background:#eee"><button style="width:60px;height:44px">OK</button></div>`), {}, []],
];

async function layoutCases() {
  const b = await Browser.launch({ baseUrl: 'http://127.0.0.1:1/' });
  try {
    for (const [name, url, opts, want, mention] of CASES) {
      const page = await b.newPage();
      try {
        await page.setViewport(opts.phone ? 390 : 800, opts.phone ? 844 : 600, 1);
        await page.goto(url);
        const r = await runLayoutAssertions(page, opts);
        const got = r.failing.join(',');
        const hit = !mention || r.offenders.some((o) => o.a.sel.includes(mention) || (o.b && o.b.sel.includes(mention)));
        check(name, got === want.join(',') && hit, `wanted [${want}] got [${got}]${hit ? '' : ' without ' + mention}: ${JSON.stringify(r.offenders).slice(0, 240)}`);
      } finally { await page.close(); }
    }
  } finally { await b.close(); }
}

async function tourCases() {
  const base = path.join(artifactsDir(), 'visual-selftest');
  fs.rmSync(base, { recursive: true, force: true });
  const common = { stopsDir: path.join(here, 'selftest-stops'), baselineDir: path.join(base, 'baselines'), log: () => {} };
  // 1. unshifted run, saved as the baseline
  process.env.WSE_SELFTEST_SHIFT = '0';
  const r0 = await runTour({ ...common, only: ['00-legend-shift'], out: path.join(base, 'o0'), saveBaseline: true, gatePixels: true });
  check('the unshifted stop passes its gate and saves a baseline', r0.ok && r0.frames.length === 2 && r0.frames.every((f) => f.layout.offenders.length === 0), JSON.stringify(r0.problems));
  check('the first run says "no baseline yet" on the contact sheet', /no baseline yet/.test(fs.readFileSync(r0.sheet, 'utf8')));
  // 2. the same page again matches its baseline
  const r1 = await runTour({ ...common, only: ['00-legend-shift'], out: path.join(base, 'o1'), gatePixels: true });
  check('an unchanged stop is inside the diff tolerance', r1.ok && r1.frames.every((f) => f.diff && !f.diff.exceeds && f.diff.changedFraction === 0), JSON.stringify(r1.frames.map((f) => f.diff && f.diff.changedFraction)));
  // 3. the known positive: legend shifted 40 px over the timeline
  process.env.WSE_SELFTEST_SHIFT = '1';
  const r2 = await runTour({ ...common, only: ['00-legend-shift'], out: path.join(base, 'o2'), gatePixels: true });
  const pairs = r2.frames.map((f) => f.layout.offenders.filter((o) => o.assertion === 1 && [o.a.sel, o.b.sel].some((s) => s.includes('#legend')) && [o.a.sel, o.b.sel].some((s) => s.includes('#timeline'))).length);
  check('a legend shifted 40 px over the timeline FAILS the run', r2.ok === false);
  check('... with assertion 1 reporting a legend/timeline element pair at both sizes', pairs.length === 2 && pairs.every((n) => n > 0), `pairs per size: ${pairs}`);
  check('... and the pixel diff exceeds its tolerance at both sizes', r2.frames.length === 2 && r2.frames.every((f) => f.diff && f.diff.exceeds), JSON.stringify(r2.frames.map((f) => f.diff && f.diff.changedFraction)));
  const sheet = fs.readFileSync(r2.sheet, 'utf8');
  check('the contact sheet is one self-contained file with baseline, new and diff images and the platform', !/(src|href)=["']https?:/.test(sheet) && (sheet.match(/<img src="data:image\/jpeg/g) || []).length >= 6 && /Platform:/.test(sheet) && /over tolerance/.test(sheet), `imgs ${(sheet.match(/<img /g) || []).length}`);
  check('the diff PNG and new PNG are written under the output folder', fs.existsSync(path.join(base, 'o2', 'diff', '00-legend-shift--phone.png')) && fs.existsSync(path.join(base, 'o2', 'new', '00-legend-shift--desktop.png')));
  // 4. pixel diffs are reported, not gated, unless asked
  const r3 = await runTour({ ...common, only: ['00-legend-shift'], out: path.join(base, 'o3'), gatePixels: false });
  check('without --gate-pixels the diff is reported but only the layout assertion fails the run', r3.ok === false && r3.problems.every((p) => /layout offender/.test(p)), JSON.stringify(r3.problems));
  // 5. an ungated stop reports without failing; a throwing stop fails
  const r4 = await runTour({ ...common, only: ['01-known-fail'], out: path.join(base, 'o4') });
  check('an ungated stop with offenders still passes the run and is listed as a known failure', r4.ok && r4.frames[0].layout.failing.join() === '1' && /known fail/.test(fs.readFileSync(r4.sheet, 'utf8')));
  const r5 = await runTour({ ...common, only: ['02-throws'], out: path.join(base, 'o5') });
  check('a stop that throws fails the run even when not gated', r5.ok === false && /failed to run/.test(r5.problems.join()), JSON.stringify(r5.problems));
  // 6. the mvpFails cross-check reaches the sheet and report.json, per stop (not per frame)
  const r6 = await runTour({ ...common, only: ['03-stale-mvp', '01-known-fail'], out: path.join(base, 'o6') });
  const stale = r6.frames.filter((f) => f.stop === '03-stale-mvp'), fine = r6.frames.filter((f) => f.stop === '01-known-fail');
  const want = 'not in mvpFails: 1; listed but passing: 2,5';
  const rep = JSON.parse(fs.readFileSync(path.join(base, 'o6', 'report.json'), 'utf8'));
  const sh6 = fs.readFileSync(r6.sheet, 'utf8');
  check('a stale mvpFails list is noted on every frame of its stop, as a per-stop union', stale.length === 2 && stale.every((f) => f.note === want), JSON.stringify(stale.map((f) => f.note)));
  check('... the note is on the contact sheet and in report.json', sh6.includes(want) && rep.frames.filter((f) => f.stop === '03-stale-mvp').every((f) => f.note === want), `sheet ${sh6.includes(want)}`);
  check('a correct mvpFails list gets no note', fine.length === 1 && !fine[0].note && rep.frames.filter((f) => f.stop === '01-known-fail').every((f) => f.note === ''), JSON.stringify(fine.map((f) => f.note)));
  delete process.env.WSE_SELFTEST_SHIFT;
  fs.rmSync(base, { recursive: true, force: true });
}

try { await layoutCases(); await tourCases(); } catch (e) { console.log('FAIL visual selftest: crashed: ' + (e?.stack || e)); failed++; }
console.log(failed ? `VISUAL SELFTEST: ${failed} failed` : 'VISUAL SELFTEST: all passed');
process.exit(failed ? 1 : 0);
