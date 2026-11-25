// S-TABLE (N24 TABLE): the cards' day table (story/daytable.js) as a person sees it. On a live-like copy of synthetic-15d
// (Today, passed hours, rain amounts and chances, high and low, the zones of a run with the ensemble mean) and on
// sample-min (no rain, no temperature, a sample): each column shows what the day class says and nothing it does not, in the
// viewer's units; later days look less certain; every name fits its column; rows never overlap; on a desktop window
// with room the whole week shows without scrolling, at every time of day (a page clock at three hours); elsewhere the table scrolls on whole columns; the keyboard moves between days and picks one (the clock goes there and focus stays). recorded adds a
// run with tp6 but no pr1 past day 3 (no amount shown there). Expectations come
// from the story's own day classes (the data), never from the table's text.
import path from 'node:path';
import { startServer } from '../lib/server.mjs';
import { Browser } from '../lib/cdp.mjs';
import { makeLiveLike } from '../lib/livelike.mjs';
import { fakeClockScript, todayAtUTC } from '../lib/fakeclock.mjs';
import { artifactTmp } from '../lib/artifacts.mjs';
import { click, key, tap } from '../lib/input.mjs';

export const id = 'S-TABLE';
export const tier = 'full';
export const freshProfile = true;
export const timeoutMs = 300000;
export const data = ['synthetic-15d', 'sample-min', 'recorded'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READY = 'window.__wse && window.__wse.ready === true && window.__wse.storyReady === true';
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const DESK = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };

async function boot(page, url, phone) {
  await page.send('Emulation.setDeviceMetricsOverride', phone ? PHONE : DESK);
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: 5 });
  await page.goto(url);
  await page.waitFor(READY, { timeout: 30000 });
  await page.eval(`(async () => { (await import(new URL('js/time/clock.js', document.baseURI).href)).pause(); return true; })()`);
  await sleep(400);
}

/** What the week card's table shows, column by column, beside the story's day class for the same column. */
const read = (page) => page.eval(`(() => {
  const st = __wse.ui.home.stories.get('home'), wrap = document.querySelector('#sec-week .strip-wrap');
  const W = wrap.getBoundingClientRect();
  const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return b.width || b.height ? { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height } : null; };
  const shown = (e) => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0;
  const cols = [...wrap.querySelectorAll('.strip-day')].map((b) => {
    const c = st.days[+b.dataset.day];
    const name = b.querySelector('.dt-name');
    return {
      day: +b.dataset.day, t: +b.dataset.t, label: b.querySelector('.strip-label').textContent, name: name.textContent,
      nameOver: name.getBoundingClientRect().width > b.clientWidth - 2, active: b.classList.contains('is-active'),
      hi: (b.querySelector('.dt-hi') || {}).textContent || '', lo: (b.querySelector('.dt-lo') || {}).textContent || '',
      rain: shown(b.querySelector('.dt-rain')) ? b.querySelector('.dt-rain').textContent : '', icon: (b.querySelector('.dt-iconbox') || { dataset: {} }).dataset.icon || '',
      iconTitle: (b.querySelector('.dt-iconbox') || {}).title || '',
      dots: b.querySelectorAll('.dt-sure i').length, on: b.querySelectorAll('.dt-sure i.on').length, cls: b.className, level: b.dataset.level,
      passed: (() => { const p = b.querySelector('.dt-passed i'); return p ? parseFloat(p.style.width) : 0; })(),
      rows: ['.dt-head', '.dt-iconbox', '.dt-temps', '.dt-rain', '.dt-sure'].map((s) => shown(b.querySelector(s)) ? box(b.querySelector(s)) : null).filter(Boolean),
      box: box(b), aria: b.getAttribute('aria-label'),
      minFont: Math.min(...[...b.querySelectorAll('span')].filter((s) => s.children.length === 0 && s.textContent.trim()).map((s) => parseFloat(getComputedStyle(s).fontSize))),
      cls0: { date: c.date, today: !!c.today, lead: c.lead, hi: c.hi, lo: c.lo, wet: c.wet, wetPhrase: c.wetPhrase, wetSource: c.wetSource, rainMm: c.rainMm, pr1: c.pr1, confidence: c.confidence, signal: c.signal, pattern: c.pattern, passedH: c.passedH },
      win: st.days.series.windows[+b.dataset.day],
    };
  });
  return { cols, W: { l: W.left, r: W.right, w: W.width }, sl: wrap.scrollLeft, max: wrap.scrollWidth - wrap.clientWidth, scrolls: wrap.classList.contains('dt-scroll'),
    bands: [...wrap.querySelectorAll('.dt-band')].map((b) => b.textContent), units: __wse.store.get().units || 'metric', vw: innerWidth,
    todayDate: st.days.coverage.todayDate, sample: !!(__wse.data.getManifest().sample), svg: !!document.querySelector('#sec-week svg.strip') };
})()`);

const deg = (c, us) => { const v = Math.round(us ? (c * 9) / 5 + 32 : c); return `${v < 0 ? '−' : ''}${Math.abs(v)}°`; };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10);

/** A desktop window with room: all seven days of range 7 show whole, 56 px a column or wider, with nothing to scroll. */
function weekWhole(assert, g, at) {
  const whole = g.cols.filter((c) => c.box.l >= g.W.l - 0.5 && c.box.r <= g.W.r + 0.5);
  // a live run has seven days here; a sample case may hold fewer
  if (!g.sample) assert.equal(g.cols.length, 7, at + ' seven days');
  assert.ok(g.cols.length <= 7, at + ` at most seven days: ${g.cols.length}`);
  assert.equal(whole.length, g.cols.length, at + ` every day shows whole: ${whole.length} of ${g.cols.length}`);
  assert.ok(!g.scrolls && g.max <= 0, at + ` nothing to scroll sideways: ${g.max} px`);
  assert.ok(g.cols.every((c) => c.box.w >= 56), at + ` every column is 56 px or wider: ${g.cols.map((c) => c.box.w.toFixed(1))}`);
}

function judge(assert, g, at, { us = false } = {}) {
  assert.ok(g.cols.length > 0, at + 'the table has columns');
  assert.ok(!g.svg, at + 'the card draws no pattern wave: the table replaces it');
  for (const c of g.cols) {
    const k = c.cls0, w = at + `day ${c.day} (${c.label}): `;
    // the day: Today, Tomorrow (or its weekday where the word does not fit) on a live run, else the weekday; always the date
    const d = new Date(k.date + 'T12:00:00Z'), wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
    const dm = `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
    const want = k.today ? ['Today'] : g.todayDate && k.date === addDays(g.todayDate, 1) ? ['Tomorrow', wd] : [wd];
    assert.ok(want.includes(c.name), w + `named ${want.join(' or ')}: ${c.name}`);
    assert.equal(c.label, `${c.name} ${dm}`, w + 'the head carries the date');
    assert.ok(!c.nameOver, w + 'the name fits its column');
    // the scrub hour lies in the column's own day
    assert.ok(c.t >= c.win.startH - 1e-6 && c.t <= c.win.endH + 1e-6, w + `scrubs inside its day: ${c.t}`);
    // high and low: through day 7 where the run has t2m, in the viewer's units; never past day 7
    if (k.lead <= 7 && Number.isFinite(k.hi)) { assert.equal(c.hi, deg(k.hi, us), w + 'the high'); assert.equal(c.lo, deg(k.lo, us), w + 'the low'); }
    else assert.ok(c.hi === '' && c.lo === '', w + 'no high or low where the story has none: ' + c.hi);
    // rain: the amount on days 1-3, the chance from day 4 with pr1, blank (never 0) where the run has no rain for the day
    if (k.wetSource === 'pr') assert.equal(c.rain, `${Math.round(k.pr1)}%`, w + 'the chance of a wet day');
    else if (k.wetSource === 'tp6' && k.lead <= 3) assert.match(c.rain, us ? /^(\d+\.\d\d|0) in$/ : /^(\d+|<1|0) mm$/, w + 'the amount: ' + c.rain);
    else assert.equal(c.rain, '', w + 'no rain number the run does not hold: ' + c.rain);
    // the icon says no more than the day's rain words (phrases.js): tp6 days 4-7 are a lean (never heavy), days 8-10 only a
    // signal (no sun, no rain class); a rain icon's words are the day's own rain phrase, and heavy or dry only when it says so
    const RAINY = ['dry', 'light', 'rain', 'heavy', 'signal'];
    if (k.wetSource === 'tp6' && k.lead > 3) assert.notEqual(c.icon, 'heavy', w + `tp6 past day 3 draws no heavy rain (${k.wetPhrase})`);
    if (k.wetSource === 'tp6' && k.lead > 7) assert.ok(!['dry', 'light', 'rain', 'heavy'].includes(c.icon), w + `tp6 past day 7 draws no sun or rain class (${k.wetPhrase}): ${c.icon}`);
    if (c.icon === 'heavy') assert.match(k.wetPhrase, /heavy/, w + 'a heavy-rain icon only where the day says heavy rain');
    if (c.icon === 'dry') assert.ok(['dry', 'mostly dry'].includes(k.wetPhrase), w + 'a sun only where the day says dry: ' + k.wetPhrase);
    if (RAINY.includes(c.icon) && k.wetPhrase) assert.equal(c.iconTitle.toLowerCase(), k.wetPhrase.toLowerCase(), w + 'the rain icon is titled with the day\'s rain words');
    // confidence: the dots follow the day's level; a sample claims none
    const steps = g.sample ? 0 : k.signal === 'none' ? Math.min(1, { high: 3, medium: 2, low: 1 }[k.confidence] || 0) : { high: 3, medium: 2, low: 1 }[k.confidence] || 0;
    assert.equal(c.on, steps, w + `confidence ${k.confidence} fills ${steps} dots: ${c.on}`);
    if (g.sample || k.confidence === 'pattern-only' || k.confidence === 'none') assert.equal(c.dots, 0, w + 'no meter where nothing is claimed');
    // later days carry their zone's texture: dashed for the blend, hatch for pattern only; never a solid day past day 7
    if (k.lead >= 8) assert.ok(/dt-(dashed|hatch)/.test(c.cls), w + 'a day past 7 carries its zone texture: ' + c.cls);
    if (k.lead >= 11) assert.ok(/dt-hatch/.test(c.cls), w + 'pattern only from day 11: ' + c.cls);
    // the passed part of today
    if (k.today) assert.ok(Math.abs(c.passed - 100 * (k.passedH - c.win.startH) / (c.win.endH - c.win.startH)) < 0.2, w + `the passed bar shows the hours gone: ${c.passed}%`);
    else assert.equal(c.passed, 0, w + 'only today has a passed bar');
    // rows stack without overlapping, all inside the column; no text under 12 px
    for (let r = 1; r < c.rows.length; r++) assert.ok(c.rows[r].t >= c.rows[r - 1].b - 0.5, w + `row ${r} clears the row above: ${JSON.stringify(c.rows)}`);
    for (const r of c.rows) assert.ok(r.l >= c.box.l - 0.5 && r.r <= c.box.r + 0.5, w + `every row sits inside its column: ${JSON.stringify(r)} in ${JSON.stringify(c.box)}`);
    assert.ok(c.minFont >= 12, w + 'no text under 12 px: ' + c.minFont);
    assert.ok(c.box.w >= 44 && c.box.h >= 44, w + `a 44 px target: ${c.box.w} x ${c.box.h}`);
    assert.ok(c.aria && c.aria.includes(':'), w + 'its name is the day line: ' + c.aria);
  }
  assert.equal(g.cols.filter((c) => c.active).length, 1, at + 'one day is marked selected');
  // the wrapper keeps the 16 px gutter on the phone
  if (g.vw < 500) assert.ok(g.W.l >= 15.5 && g.vw - g.W.r >= 15.5, at + `the table keeps the 16 px gutter: ${g.W.l} / ${g.vw - g.W.r}`);
}

export async function run({ page, baseUrl, assert, fixture, dataDir, newPage }) {
  const tag = (s) => `[${fixture}] ${s} `;
  let url = baseUrl, srv = null, br = null;
  if (fixture === 'synthetic-15d') {
    // live: Today, Tomorrow and the passed hours exist only on a live run inside its range
    const dir = path.join(artifactTmp('s-table-live-'), 'data');
    makeLiveLike(dir, dataDir);
    srv = await startServer({ dataDir: dir });
    br = await Browser.launch({ baseUrl: srv.baseUrl });
    page = await br.newPage();
    url = srv.baseUrl;
  }
  try {
    // ---- desktop, every range, both units ----
    await boot(page, url, false);
    for (const r of [7, 10, 15]) {
      await page.eval(`__wse.store.set({ range: ${r} })`); await sleep(900);
      const g = await read(page);
      judge(assert, g, tag(`1440 x 900, range ${r}:`));
      if (fixture === 'synthetic-15d') {
        if (r === 7) assert.equal(g.cols[0].name, 'Today', tag('live: the first column is Today'));
        if (r === 15) {
          assert.deepEqual(g.bands, ['broad pattern', 'pattern only'], tag('range 15 names its later zones over their columns: ' + g.bands));
          assert.ok(g.scrolls && g.max > 0, tag('fifteen days scroll sideways on the desktop panel'));
        }
        if (r === 7) assert.ok(g.cols.some((c) => /mm$/.test(c.rain)) && g.cols.some((c) => /%$/.test(c.rain)), tag('amounts for days 1-3 and chances later: ' + g.cols.map((c) => c.rain)));
      } else if (fixture === 'recorded') {
        if (r === 7) assert.ok(g.cols.some((c) => c.cls0.wetSource === 'tp6' && c.cls0.lead > 3), tag('the recording has tp6 days past day 3 (judged blank above)'));
        if (r === 10) assert.ok(g.cols.some((c) => c.cls0.wetSource === 'tp6' && c.cls0.lead > 7), tag('the recording has tp6 days past day 7 (their icons judged above)'));
      } else {
        assert.ok(g.cols.every((c) => c.rain === '' && c.hi === ''), tag('a sample with no rain or temperature shows neither, not zeros'));
        assert.ok(g.cols.every((c) => c.icon), tag('every sample day still has its pattern icon: ' + g.cols.map((c) => c.icon)));
      }
    }
    // ---- desktop: the week at a glance. Where the window has room (1280 and 1440 wide), the panel's default width shows all
    // seven days of range 7 whole, at 56 px a column or wider, with nothing to scroll, and the map keeps at least 60% of the
    // window; a narrower desktop window (1024) keeps the panel at 40% or less and lets the days scroll instead ----
    await page.eval(`__wse.store.set({ range: 7 })`);
    for (const [vw, vh, seven] of [[1280, 800, true], [1440, 900, true], [1024, 768, false]]) {
      await page.send('Emulation.setDeviceMetricsOverride', { ...DESK, width: vw, height: vh }); await sleep(900);
      const g = await read(page);
      const geo = await page.eval(`({ home: document.getElementById('home').getBoundingClientRect().width, stage: document.getElementById('stage').getBoundingClientRect().width })`);
      const at = tag(`${vw} x ${vh}, range 7:`);
      judge(assert, g, at);
      assert.ok(geo.home <= 0.4 * vw + 0.5, at + ` the panel takes at most 40% of the window: ${geo.home}`);
      assert.ok(geo.stage >= 0.6 * vw - 20, at + ` the map keeps the rest: ${geo.stage}`);
      if (seven) weekWhole(assert, g, at);
    }
    await page.send('Emulation.setDeviceMetricsOverride', DESK); await sleep(900);

    // ---- the week at a glance at every time of day: a live run on a 1280 x 800 window with the page clock at three hours
    // of the day. 10:00 UTC (02:00 in the San Francisco home place) falls after the place's midnight but before the 12Z run,
    // so the seventh day runs past hour 168 and carries a one-column "broad pattern" band; 04:00 and 20:00 UTC do not ----
    if (fixture === 'synthetic-15d') {
      for (const hUTC of [4, 10, 20]) {
        const now = todayAtUTC(hUTC);
        const dir = path.join(artifactTmp('s-table-clock-'), 'data');
        makeLiveLike(dir, dataDir, { now });
        const s2 = await startServer({ dataDir: dir });
        const b2 = await Browser.launch({ baseUrl: s2.baseUrl });
        try {
          const q = await b2.newPage();
          await q.send('Page.addScriptToEvaluateOnNewDocument', { source: fakeClockScript(now) });
          await boot(q, s2.baseUrl, false);
          await q.send('Emulation.setDeviceMetricsOverride', { ...DESK, width: 1280, height: 800 });
          await q.eval(`__wse.store.set({ range: 7 })`); await sleep(900);
          const g = await read(q);
          const at = tag(`1280 x 800, range 7, clock ${new Date(now).toISOString().slice(11, 16)}Z:`);
          assert.ok(Math.abs((await q.eval('Date.now()')) - now) < 120e3, at + ' the page clock reads the chosen time');
          judge(assert, g, at);
          weekWhole(assert, g, at);
          if (hUTC === 10) assert.deepEqual(g.bands, ['broad pattern'], at + ' the seventh day carries its zone band: ' + g.bands);
          assert.deepEqual(q.errors(), [], at + JSON.stringify(q.errors()));
        } finally {
          await b2.close();
          await s2.close();
        }
      }
    }

    await page.eval(`__wse.store.set({ range: 7, units: 'us' })`); await sleep(900);
    judge(assert, await read(page), tag('1440 x 900, US units:'), { us: true });
    await page.eval(`__wse.store.set({ units: 'metric' })`); await sleep(600);

    // ---- keyboard: arrows move between days, Enter picks one, the clock goes there and focus stays on it ----
    {
      await click(page, '#sec-week .strip-day[data-day="0"]'); await sleep(700);
      await key(page, null, 'ArrowRight'); await key(page, null, 'ArrowRight');
      const f = await page.eval(`(document.activeElement && document.activeElement.dataset.day) || null`);
      assert.equal(f, '2', tag('ArrowRight twice moves focus to the third day'));
      const t = await page.eval(`+document.activeElement.dataset.t`);
      await key(page, null, 'Enter'); await sleep(900);
      assert.ok(Math.abs((await page.eval('__wse.store.get().t')) - t) < 0.6, tag('Enter picks the day: the clock goes to its hour'));
      const after = await page.eval(`(() => { const a = document.activeElement; return a && a.classList.contains('strip-day') ? { day: a.dataset.day, active: a.classList.contains('is-active') } : null; })()`);
      assert.deepEqual(after, { day: '2', active: true }, tag('focus stays on the picked day after the table repaints'));
      await key(page, null, 'End');
      const last = await page.eval(`document.activeElement.dataset.day`);
      assert.equal(+last, (await read(page)).cols.length - 1, tag('End goes to the last day'));
    }
    assert.deepEqual(page.errors(), [], tag(JSON.stringify(page.errors())));

    // ---- phone: whole columns at rest, the selected day revealed, every range ----
    const p = br ? await br.newPage() : await newPage();
    await boot(p, url, true);
    await p.eval(`__wse.store.set({ sheet: 'full' })`); await sleep(700);
    for (const r of [7, 15]) {
      await p.eval(`__wse.store.set({ range: ${r} })`); await sleep(900);
      const g = await read(p);
      judge(assert, g, tag(`390 x 844, range ${r}:`));
      if (g.cols.length * 56 > g.W.w) {
        assert.ok(g.scrolls && g.max > 0, tag(`range ${r} on the phone scrolls sideways`));
        const col = g.cols[0].box.w;
        assert.ok(g.cols.filter((c) => c.box.l >= g.W.l - 0.5 && c.box.r <= g.W.r + 0.5).length >= 5, tag('five whole days show at once on a 390 px phone'));
        for (const to of [g.max, 130]) {
          await p.eval(`document.querySelector('#sec-week .strip-wrap').scrollTo({ left: ${to}, behavior: 'instant' })`); await sleep(900);
          const s = await read(p);
          const off = s.sl / col - Math.round(s.sl / col);
          assert.ok(Math.abs(off) * col < 1 || s.sl >= s.max - 1, tag(`scrolled to ${to}, the table rests on a column edge or its end: ${s.sl} (column ${col})`));
        }
        // a tap on a day that is off to the right reveals it whole
        const lastDay = g.cols.length - 1;
        await p.eval(`document.querySelector('#sec-week .strip-wrap').scrollTo({ left: 0, behavior: 'instant' })`); await sleep(500);
        await tap(p, `#sec-week .strip-day[data-day="${lastDay}"]`); await sleep(1000);
        const s = await read(p);
        const a = s.cols.find((c) => c.active);
        assert.ok(a && a.day === lastDay && a.box.l >= s.W.l - 0.5 && a.box.r <= s.W.r + 0.5, tag('the tapped day is the selected one and shows whole: ' + JSON.stringify(a && a.box) + ' in ' + JSON.stringify(s.W)));
      }
    }
    assert.deepEqual(p.errors(), [], tag(JSON.stringify(p.errors())));
  } finally {
    if (br) await br.close();
    if (srv) await srv.close();
  }
}
