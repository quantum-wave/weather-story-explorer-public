// S-HOME (W3-06): every honest state of "Your week", trips, People and Places, and a phone sheet that never takes the panel away.
// Real input throughout (tests/site/lib/input.mjs): taps at 390 x 844 on every strip day at half and full, real touch drags on the
// strip. Expectations come from the manifest and the loaded data, not from the page's own report of itself. The live states (fresh,
// stale, very stale, short of range, short dataset) run on live-like copies of a fixture with the run moved to the real clock.
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../lib/server.mjs';
import { Browser } from '../lib/cdp.mjs';
import { makeLiveLike } from '../lib/livelike.mjs';
import { artifactPath, artifactTmp } from '../lib/artifacts.mjs';
import { tap, drag, click } from '../lib/input.mjs';

export const id = 'S-HOME';
export const tier = 'full';
export const freshProfile = true;
export const timeoutMs = 300000;
export const data = ['synthetic-15d', 'recorded-min', 'synthetic'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READY = 'window.__wse && window.__wse.ready === true && window.__wse.storyReady === true';
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

async function boot(page, url, { phone = false, blockStorage = false } = {}) {
  await page.send('Emulation.setDeviceMetricsOverride', phone ? PHONE : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: 5 });
  // a skeleton card is on screen while the chunks load: record that it was, and optionally make localStorage unusable
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__sawSkeleton = false;
    new MutationObserver(() => { if (document.querySelector('#sec-week .card .skeleton')) window.__sawSkeleton = true; }).observe(document, { childList: true, subtree: true });
    ${blockStorage ? `Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });` : ''}` });
  await page.goto(url);
  await page.waitFor(READY, { timeout: 30000 });
  await page.eval(`(async () => { (await import(new URL('js/time/clock.js', document.baseURI).href)).pause(); })()`);
  await sleep(300);
}
const homeSt = (page) => page.eval(`(() => { const s = __wse.ui.home.stories.get('home'); return s && { status: s.status, avail: s.avail, range: s.range, n: s.days.length, cov: s.days.coverage && { withData: s.days.coverage.withData, requested: s.days.coverage.requested, firstDate: s.days.coverage.firstDate, lastDate: s.days.coverage.lastDate, kind: s.days.coverage.kind } }; })()`);
const text = (page, sel) => page.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
const count = (page, sel) => page.eval(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const snapNow = (page) => page.eval(`document.getElementById('app').dataset.snap`);
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10);

/** The days a fixture's San Francisco week must have, from the manifest alone (UTC-8 local days that the data span overlaps; at most 15). */
const expectedDays = (page) => page.eval(`(() => {
  const m = __wse.data.getManifest(), f = m.fields.z500a, H = 3600e3, DAY = 24 * H, off = -8 * H;
  const v0 = f.source && f.source.valid && f.source.valid[0];
  const t0 = (v0 ? Date.parse(v0.replace(/Z$/, ':00Z')) : Date.parse(m.run.replace(/Z$/, ':00Z'))) - f.steps[0] * H;
  const first = t0 + f.steps[0] * H, last = t0 + f.steps[f.steps.length - 1] * H, now = Date.now();
  const start = !m.sample && now >= first && now <= last ? now : first;
  return Math.min(15, Math.floor((last + off - 1) / DAY) - Math.floor((start + off) / DAY) + 1);
})()`);

export async function run({ page, baseUrl, assert, fixture, dataDir }) {
  const tag = (s) => `[${fixture}] ${s}`;

  // ================= desktop: the states, the sections =================
  await boot(page, baseUrl);
  assert.ok(await page.eval('window.__sawSkeleton'), tag('a skeleton card was on screen while the forecast loaded'));
  const st = await homeSt(page);
  const n = await expectedDays(page);
  assert.equal(st.status, 'ready', tag('the home story is ready'));
  assert.equal(st.avail, n, tag(`the dataset fills ${n} days (from the manifest): the card says ${st.avail}`));
  const title = await text(page, '#sec-week .sec-title');
  const cols = () => count(page, '#sec-week .strip-day');
  const btn = (r) => page.eval(`(() => { const b = document.querySelector('#range-control .range-btn[data-range="${r}"]'); return b && { disabled: b.disabled, pressed: b.getAttribute('aria-pressed') }; })()`);
  assert.ok(await btn(7) && !(await btn(7)).disabled, tag('range 7 is always available'));
  for (const r of [10, 15]) {
    const b = await btn(r);
    assert.equal(b.disabled, n < r, tag(`range ${r} is ${n < r ? 'disabled' : 'enabled'} on a ${n}-day dataset`));
  }
  const note = await text(page, '#range-note');
  if (n < 15) assert.ok(new RegExp(`^This (recording|sample|forecast) covers ${n} days?$`).test(note), tag('the disabled range gives its reason in words: ' + JSON.stringify(note)));
  else assert.equal(note, '', tag('nothing disabled, no reason shown'));
  if (fixture === 'recorded-min') assert.equal(note, `This recording covers ${n} days`, tag('the recording says how many days it covers: ' + JSON.stringify(note)));
  assert.equal(title, n < 3 ? `${n} day${n === 1 ? '' : 's'} of data` : 'A recorded week', tag('the card title follows the data: ' + title));
  assert.equal(await cols(), Math.min(7, n), tag('columns equal the days with data inside the range'));
  // 1440 x 900, the 7-day card: every column carries its real date ("Thu 19"), never the weekday alone (spec 3.2 Recorded:
  // "the real dates in every column"; 3.3: "On desktop all columns show"), each label over its column and at least 4 px
  // clear of its neighbours, measured in the page (fails before: LABEL_GAP 6 dropped the row to "Mon | Tue | ... | Thu 19")
  if (n >= 7) {
    for (let a = 0; a < 7; a++) {
      await click(page, `#sec-week .strip-day[data-day="${a}"]`);
      await page.waitFor(`__wse.ui.home.stories.get('home').activeDay === ${a}`, { timeout: 5000 }).catch(() => {});
      await sleep(300);
      const g = await page.eval(`(() => {
        const box = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right }; };
        const svg = document.querySelector('#sec-week svg.strip');
        return { w: svg.getBoundingClientRect().width,
          cols: [...svg.querySelectorAll('rect.strip-day')].map(box),
          labels: [...svg.querySelectorAll('text.strip-label')].map((e) => ({ t: e.textContent, ...box(e) })) };
      })()`);
      const at = tag(`1440 x 900, 7 days, day ${a} selected, strip ${g.w.toFixed(0)} px: `);
      const names = g.labels.map((l) => l.t).join(' | ');
      assert.equal(g.labels.length, 7, at + 'seven labels: ' + names);
      assert.ok(g.labels.every((l) => /^[A-Z][a-z]{2} \d{1,2}$/.test(l.t)), at + 'every label is dated: ' + names);
      g.labels.forEach((L, k) => {
        const c = g.cols[k], mid = (L.l + L.r) / 2;
        assert.ok(mid > c.l && mid < c.r, at + `${L.t} sits over its column`);
        if (k) assert.ok(L.l - g.labels[k - 1].r >= 4, at + `${g.labels[k - 1].t} | ${L.t} at least 4 px apart: ${(L.l - g.labels[k - 1].r).toFixed(1)}`);
      });
    }
    await click(page, '#sec-week .strip-day[data-day="0"]'); await sleep(500);
  }
  if (n < 3) assert.match(await text(page, '#sec-week .coverage-note'), /^This dataset covers .+ only\.$/, tag('a short dataset says what it covers'));
  // the source label comes from the dataset the map shows
  const tagTxt = await text(page, '#sec-week .sample-tag');
  const m = await page.eval(`__wse.data.getManifest()`);
  if (fixture === 'recorded-min') assert.equal(tagTxt, `${m.sample_label} · not live`, tag('the recorded kicker is sampleLabel(): ' + tagTxt));
  else assert.ok(tagTxt.includes(Object.values(m.cases)[0].label) && !/ERA5|Irma/.test(tagTxt), tag('the card names the active case: ' + tagTxt));
  // the range control writes the store and changes the strip
  if (n >= 10) {
    await click(page, '#range-control .range-btn[data-range="10"]');
    await page.waitFor(`document.querySelectorAll('#sec-week .strip-day').length === 10`, { timeout: 8000 }).catch(() => {});
    assert.equal(await cols(), 10, tag('range 10 shows 10 columns'));
    assert.equal(await page.eval('__wse.store.get().range'), 10, tag('the control is bound to store.range'));
    assert.equal((await btn(10)).pressed, 'true', tag('range 10 is pressed'));
  }
  if (n >= 15) {
    await click(page, '#range-control .range-btn[data-range="15"]');
    await page.waitFor(`document.querySelectorAll('#sec-week .strip-day').length === ${n}`, { timeout: 8000 }).catch(() => {});
    assert.equal(await cols(), n, tag('range 15 shows every day there is'));
  }
  assert.equal(await count(page, '#sec-week .hatch-nodata'), 0, tag('no hatched phantom day'));
  assert.ok(!/settled/i.test(await page.eval(`document.getElementById('home').innerText`)), tag('the words settled and unsettled appear nowhere'));
  await page.eval(`__wse.store.set({ range: 7 })`); await sleep(400);

  // People and Places are separate sections (fails before: a place pin sat under People)
  await page.eval(`(() => { const c = __wse.pins.home(); __wse.pins.add({ kind: 'person', name: 'Maya', city: { ...c, id: 5746545, name: 'Portland', lat: 45.52, lon: -122.68, admin: 'OR', cc: 'US' } });
    __wse.pins.add({ kind: 'place', name: 'Cabin', city: { ...c, id: 5392171, name: 'San Jose', lat: 37.34, lon: -121.89, admin: 'CA', cc: 'US' } }); })()`);
  await sleep(900);
  const sec = (s) => page.eval(`[...document.querySelectorAll('${s} .person-name')].map((e) => e.textContent)`);
  assert.deepEqual(await sec('#sec-people'), ['Maya'], tag('People holds the person only'));
  assert.deepEqual(await sec('#sec-places'), ['Cabin'], tag('a place pin is under Places, not People'));
  assert.equal(await count(page, '#sec-people .not-saved'), 0, tag('storage is local here: no not-saved notice'));
  assert.ok(!/\b(un)?settled\b/i.test(await text(page, '#sec-people')), tag('row phrases are reason phrases'));
  const why = await page.eval(`[...document.querySelectorAll('.person-why')].map((e) => e.textContent)`);
  assert.ok(why.every((w) => w.length > 3 && !/^(Trough|Ridge) /.test(w)), tag('reason phrases from story/phrases.js: ' + JSON.stringify(why)));

  // trip wording on recorded and sample data never promises an update: the recording covers a trip or it does not
  if (fixture !== 'synthetic-15d') {
    const cov0 = (await homeSt(page)).cov;
    const lbl = fixture === 'recorded-min' ? 'recording' : 'sample';
    await page.eval(`(() => { __wse.pins.addTrip({ label: 'Past the data', city: __wse.pins.home(), start: ${JSON.stringify(addDays(cov0.lastDate, 6))}, end: ${JSON.stringify(addDays(cov0.lastDate, 10))} }); })()`);
    await sleep(1200);
    const tt = await page.eval(`(() => { const e = [...document.querySelectorAll('#sec-trips [data-state]')].find((x) => x.textContent.includes('Past the data')); return e && { state: e.dataset.state, text: e.textContent }; })()`);
    assert.equal(tt.state, 'too-far', tag('a trip after the last day is too far'));
    assert.ok(tt.text.includes(`This ${lbl} doesn’t cover these dates.`), tag(`the ${lbl} says it does not cover the trip: ` + tt.text));
    assert.ok(!/starts covering|Firmer from|Too far out/.test(tt.text), tag('and promises no date: ' + tt.text));
    if (cov0.withData >= 9) {
      await page.eval(`(() => { __wse.pins.addTrip({ label: 'Later in data', city: __wse.pins.home(), start: ${JSON.stringify(addDays(cov0.firstDate, 8))}, end: ${JSON.stringify(addDays(cov0.firstDate, 8))} }); })()`);
      await sleep(1500);
      const bt = await page.eval(`(() => { const e = [...document.querySelectorAll('#sec-trips [data-state]')].find((x) => x.textContent.includes('Later in data')); return e && { state: e.dataset.state, text: e.textContent }; })()`);
      assert.ok(bt && !/Firmer from|starts covering/.test(bt.text), tag('a later trip inside the recording promises no date: ' + JSON.stringify(bt)));
    }
  }

  // trips: the four states on a 15-day forecast, for trips starting on days 3, 9, 20 and in the past
  if (fixture === 'synthetic-15d') {
    const cov = (await homeSt(page)).cov;
    const T = (label, a, b) => `__wse.pins.addTrip({ label: ${JSON.stringify(label)}, city: __wse.pins.home(), start: ${JSON.stringify(addDays(cov.firstDate, a - 1))}, end: ${JSON.stringify(addDays(cov.firstDate, b - 1))} })`;
    await page.eval(`(() => { ${T('Detail trip', 3, 4)}; ${T('Broad trip', 9, 10)}; ${T('Far trip', 20, 21)}; ${T('Old trip', -6, -4)}; })()`);
    await sleep(1500);
    const state = (lbl) => page.eval(`(() => { const e = [...document.querySelectorAll('#sec-trips [data-state]')].find((x) => x.textContent.includes(${JSON.stringify(lbl)})); return e && { state: e.dataset.state, text: e.textContent, strips: e.querySelectorAll('.strip-day').length, svg: !!e.querySelector('svg.strip') }; })()`);
    const d = await state('Detail trip'), b = await state('Broad trip'), f = await state('Far trip'), o = await state('Old trip');
    assert.equal(d.state, 'detail', tag('a trip on day 3 is in detail range')); assert.ok(d.strips >= 1 && d.strips <= 2, tag('its strip holds the trip days only: ' + d.strips));
    assert.equal(b.state, 'broad', tag('a trip on day 9 is the broad pattern')); assert.match(b.text, /Beyond this sample’s detailed days\./, tag('broad on a sample: ' + b.text)); assert.ok(!/Firmer from|starts covering/.test(b.text), tag('a sample never promises a date: ' + b.text));
    assert.equal(f.state, 'too-far', tag('a trip on day 20 is too far out')); assert.match(f.text, /This sample doesn’t cover these dates\./, tag('too far on a sample: ' + f.text)); assert.ok(!/starts covering|Firmer from/.test(f.text), tag('a sample never promises a date: ' + f.text)); assert.equal(f.svg, false, tag('too far: no strip'));
    assert.equal(o.state, 'over', tag('a trip in the past is over')); assert.match(o.text, /ended /, tag('over: ' + o.text)); assert.match(o.text, /Remove/, tag('over: can be removed'));
    assert.ok(!/settled/i.test(await text(page, '#sec-trips')), tag('no settled words in trips'));
  }

  // not-saved notice: with localStorage blocked the pin store falls back to session or memory (acceptance 2)
  {
    await page.eval(`localStorage.clear()`).catch(() => {});
    await boot(page, baseUrl, { blockStorage: true });
    const kind = await page.eval(`__wse.pins.storageKind()`);
    assert.notEqual(kind, 'local', tag('storage is not local when localStorage throws: ' + kind));
    assert.match(await text(page, '#sec-people .not-saved'), /This browser isn’t saving your list\. Use Copy all to keep it\./, tag('the not-saved notice'));
    assert.equal(await count(page, '#sec-people .not-saved .copy-all'), 1, tag('with the Copy all action'));
    assert.match(await text(page, '#sec-people'), /No one here yet\. Add someone to see what the pattern does to their week\./, tag('People empty state is an instruction'));
  }

  // ================= phone: real taps and drags =================
  await boot(page, baseUrl, { phone: true });
  await page.eval(`(() => { const c = __wse.pins.home(); __wse.pins.add({ kind: 'person', name: 'Maya', city: { ...c, id: 5746545, name: 'Portland', lat: 45.52, lon: -122.68, admin: 'OR', cc: 'US' } }); })()`);
  await sleep(900);
  const setSnap = async (s) => { await page.eval(`__wse.store.set({ sheet: ${JSON.stringify(s)} })`); await sleep(650); };
  await setSnap('half');
  const days = await count(page, '#sec-week .strip-day');
  assert.ok(days >= 1, tag('the phone card has day columns'));
  const w = await page.eval(`(() => { const r = document.querySelector('#sec-week .strip-day').getBoundingClientRect(); return r.width; })()`);
  assert.ok(w >= 43.5 || days <= 2, tag(`a phone day column is at least 44 px wide: ${w}`));

  for (const start of ['half', 'full']) {
    for (let i = 0; i < days; i++) {
      await setSnap(start);
      await tap(page, `#sec-week .strip-day[data-day="${i}"]`);
      await sleep(900);
      const after = await snapNow(page);
      assert.equal(after, 'half', tag(`tapping day ${i} from ${start} leaves the sheet at half, not ${after}`));
      const probe = await page.eval(`(() => { const b = document.getElementById('home-body'), c = document.querySelector('#sec-week .card').getBoundingClientRect(), d = document.querySelector('#sec-week .strip-day[data-day="${i}"]').getBoundingClientRect();
        const hit = document.elementFromPoint(d.left + d.width / 2, d.top + d.height / 2);
        return { inert: b.inert, vis: c.height > 0 && c.bottom > 0 && c.top < innerHeight, hit: !!(hit && hit.closest('#sec-week .card')) }; })()`);
      assert.equal(probe.inert, false, tag(`the panel is never inert after a day tap (${start}, day ${i})`));
      assert.ok(probe.vis && probe.hit, tag(`the card stays visible and tappable after a day tap (${start}, day ${i}): ${JSON.stringify(probe)}`));
    }
  }
  assert.equal(await page.eval(`document.getElementById('home').dataset.dup`), '1', tag('the focus block knows the card below is the same place'));
  assert.equal(await page.eval(`getComputedStyle(document.getElementById('focus-card')).display`), 'none', tag('at half the focus block is hidden while the same place is the first card below'));

  // the peek: the sentence is never clamped, the peek is at most 180 px, and the panel is only inert there by being closed
  await setSnap('peek');
  const peek = await page.eval(`(() => { const s = document.querySelector('#focus-card .summary'), f = document.getElementById('focus-card'), hm = document.getElementById('home');
    return { h: hm.getBoundingClientRect().height, clamp: getComputedStyle(s).webkitLineClamp, sh: s.scrollHeight, ch: s.clientHeight, fsh: f.scrollHeight, fch: f.clientHeight, text: s.textContent }; })()`);
  assert.ok(peek.h <= 180, tag('the peek is at most 180 px: ' + peek.h));
  assert.ok(peek.clamp === 'none' && peek.sh <= peek.ch + 1, tag('the peek sentence is not clamped: ' + JSON.stringify(peek)));
  assert.ok(peek.fsh <= peek.fch + 1, tag('nothing in the peek is clipped: ' + JSON.stringify(peek)));

  // a horizontal drag on a strip never moves the sheet; a vertical one does (spec 4.6)
  await setSnap('half');
  const hBefore = await page.eval(`getComputedStyle(document.getElementById('app')).getPropertyValue('--sheet-h')`);
  await drag(page, '#sec-week .strip-wrap', { by: { dx: -90, dy: 4 }, touch: true });
  await sleep(700);
  assert.equal(await snapNow(page), 'half', tag('a horizontal drag on a strip leaves the sheet at half'));
  assert.equal(await page.eval(`getComputedStyle(document.getElementById('app')).getPropertyValue('--sheet-h')`), hBefore, tag('and does not change its height'));
  await drag(page, '#sec-week .strip-wrap', { by: { dx: 3, dy: -110 }, touch: true });
  await sleep(900);
  assert.equal(await snapNow(page), 'full', tag('a vertical drag that starts on a strip moves the sheet up'));

  // the strip keeps the card's 16 px side gutter: no strip text nearer than 16 px to a screen edge
  {
    const g = await page.eval(`(() => { const out = []; for (const t of document.querySelectorAll('#sec-week svg.strip text')) { const b = t.getBoundingClientRect(); if (b.width) out.push([b.left, innerWidth - b.right, t.textContent]); } const sv = document.querySelector('#sec-week svg.strip').getBoundingClientRect(); return { out, l: sv.left, r: innerWidth - sv.right }; })()`);
    assert.ok(g.l >= 15.5 && g.r >= 15.5, tag(`the strip stays inside the 16 px gutter: ${g.l}, ${g.r}`));
    const bad = g.out.filter(([l, r]) => l < 15.5 || r < 15.5);
    assert.deepEqual(bad, [], tag('no strip text inside the gutter: ' + JSON.stringify(bad)));
  }

  // a vertical finger drag on a strip scrolls the panel like a drag anywhere on it; the sheet moves only at the scroll edge
  {
    await setSnap('full');
    // make the panel long enough to scroll whatever the fixture holds
    await page.eval(`(() => { const s = document.createElement('div'); s.id = 'pad-test'; s.style.cssText = 'height:900px;flex:none'; document.getElementById('home-body').append(s); })()`);
    const st0 = () => page.eval(`({ top: document.getElementById('home-body').scrollTop, snap: document.getElementById('app').dataset.snap })`);
    const put = (y) => page.eval(`document.getElementById('home-body').scrollTop = ${y}`);
    const strip = '#sec-week .strip-wrap';
    // the strip's box is fixed in the panel, so aim the finger at it wherever the panel is scrolled
    const fingerOnStrip = async (scrollTo, dy) => {
      await put(scrollTo); await sleep(200);
      const r = await page.eval(`(() => { const b = document.querySelector('${strip}').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, vis: b.top > 0 && b.bottom < innerHeight }; })()`);
      return r;
    };
    // scroll position where the strip is on screen with room to drag either way
    const sc = await page.eval(`(() => { const b = document.getElementById('home-body'), s = document.querySelector('${strip}'); return Math.max(0, s.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop - 200); })()`);
    const at = Math.min(sc, 1); void at;
    // finger up while scrolled (sheet at full): the panel scrolls, the sheet stays
    await put(40); await sleep(200);
    const before = await st0();
    const r1 = await page.eval(`(() => { const b = document.querySelector('${strip}').getBoundingClientRect(); return { x: b.left + b.width / 2, y: Math.min(innerHeight - 160, b.top + b.height / 2) }; })()`);
    await drag(page, { x: r1.x, y: r1.y }, { by: { dx: 0, dy: -120 }, touch: true }); await sleep(700);
    const after = await st0();
    assert.ok(after.top > before.top + 40, tag(`finger up on a strip scrolls the list: ${before.top} -> ${after.top}`));
    assert.equal(after.snap, 'full', tag('and the sheet stays full'));
    // finger down while scrolled: the list scrolls back, the sheet does not collapse
    await put(Math.max(after.top, 300)); await sleep(200);
    const b2 = await st0();
    const r2 = await page.eval(`(() => { const b = document.querySelector('${strip}').getBoundingClientRect(); return b.top > 100 && b.bottom < innerHeight - 40 ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null; })()`);
    if (r2) {
      await drag(page, r2, { by: { dx: 0, dy: 120 }, touch: true }); await sleep(700);
      const a2 = await st0();
      assert.ok(a2.top < b2.top - 40, tag(`finger down on a strip scrolls the list back: ${b2.top} -> ${a2.top}`));
      assert.equal(a2.snap, 'full', tag('and the sheet does not collapse while the list is scrolled'));
    } else {
      // the strip sits above the fold at this scroll: drag from its first visible pixel row instead
      const y2 = await page.eval(`(() => { const b = document.querySelector('${strip}').getBoundingClientRect(); return Math.max(b.top, 120) + 10; })()`);
      const x2 = r1.x;
      await put(Math.max(after.top, 300)); await sleep(200);
      const b3 = await st0();
      const onStrip = await page.eval(`(() => { const e = document.elementFromPoint(${x2}, ${y2}); return !!(e && e.closest('${strip}')); })()`);
      if (onStrip) {
        await drag(page, { x: x2, y: y2 }, { by: { dx: 0, dy: 120 }, touch: true }); await sleep(700);
        const a3 = await st0();
        assert.ok(a3.top < b3.top - 40 && a3.snap === 'full', tag(`finger down on a strip scrolls the list back, sheet stays full: ${JSON.stringify([b3, a3])}`));
      }
    }
    // at the top of the list a downward drag on a strip does collapse the sheet one step, and from half an upward one raises it
    await put(0); await sleep(200);
    const r0 = await page.eval(`(() => { const b = document.querySelector('${strip}').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    assert.equal((await st0()).top, 0, tag('the list is at the top'));
    await drag(page, r0, { by: { dx: 0, dy: 110 }, touch: true }); await sleep(800);
    assert.equal(await snapNow(page), 'half', tag('at the top of the list a finger down on a strip steps the sheet down'));
    await page.eval(`document.getElementById('pad-test')?.remove()`);
  }

  // 44 px targets
  await setSnap('full');
  for (const sel of ['#sec-week .change-btn', '#range-control .range-btn:not(:disabled)', '#sec-trips .add-btn', '#sec-people .add-btn', '#sec-people .more-btn', '#sec-people .person-main']) {
    const r = await page.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { w: b.width, h: b.height }; })()`);
    assert.ok(r && r.w >= 43.5 && r.h >= 43.5, tag(`${sel} is at least 44 x 44: ${JSON.stringify(r)}`));
  }

  // 10 and 15 days on the phone, the compressed strip (seven columns and the end cell) inside the 16 px gutter: with each of
  // days 1-7 selected in turn, every column is a 44 px target and every one of days 1-7 keeps its own label, in order,
  // centred over its column, with visible air between neighbours (spec 3.3; acceptance 8)
  for (const r of [10, 15]) {
    if (n < r) continue;
    await setSnap('full');
    await tap(page, `#range-control .range-btn[data-range="${r}"]`);
    await sleep(900);
    assert.equal(await count(page, '#sec-week .strip-end'), 1, tag(`${r} days on the phone: the compressed end cell`));
    for (let a = 0; a < 7; a++) {
      await setSnap('full');
      await tap(page, `#sec-week .strip-day[data-day="${a}"]`);
      await sleep(700);
      const g = await page.eval(`(() => {
        const box = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width, h: b.height }; };
        const svg = document.querySelector('#sec-week svg.strip'), body = document.getElementById('home-body').getBoundingClientRect();
        const cols = [...svg.querySelectorAll('rect.strip-day')].map((e) => ({ day: +e.dataset.day, ...box(e) }));
        const labels = [...svg.querySelectorAll('text.strip-label:not(.strip-label-end)')].map((e) => ({ t: e.textContent, ...box(e) }));
        const end = box(svg.querySelector('rect.strip-end')), s = box(svg);
        return { cols, labels, end, svgL: s.l - body.left, svgR: body.right - s.r };
      })()`);
      const at = tag(`range ${r}, day ${a} selected: `);
      assert.equal(g.cols.length, 7, at + 'seven full columns');
      for (const c of g.cols) assert.ok(c.w >= 43.99 && c.h >= 44, at + `day ${c.day} column is at least 44 x 44: ${c.w.toFixed(1)} x ${c.h.toFixed(1)}`);
      assert.ok(g.end.w >= 43.99 && g.end.h >= 44, at + `the end cell is at least 44 x 44: ${g.end.w.toFixed(1)} x ${g.end.h.toFixed(1)}`);
      assert.ok(g.svgL >= 15.5 && g.svgR >= 15.5, at + `the strip keeps the 16 px gutter: ${g.svgL.toFixed(1)} / ${g.svgR.toFixed(1)}`);
      const names = g.labels.map((l) => l.t).join(', ');
      assert.equal(g.labels.length, 7, at + `every one of days 1-7 has a label: ${names}`);
      g.cols.forEach((c, k) => {
        const L = g.labels[k], mid = L && (L.l + L.r) / 2;
        assert.ok(L && mid > c.l && mid < c.r, at + `day ${c.day}'s label sits over its column: ${L && L.t}`);
        if (k) assert.ok(L.l - g.labels[k - 1].r >= 4, at + `labels ${g.labels[k - 1].t} | ${L.t} are at least 4 px apart: ${(L.l - g.labels[k - 1].r).toFixed(1)}`);
      });
      assert.ok(g.labels.every((l) => l.r <= g.end.l), at + 'no day label runs into the end cell');
    }
  }
  if (n >= 10) await setSnap('full');

  // 15 days on the phone: days 1-7 and the compressed end cell; the end cell swaps in the full strip, scrolling sideways
  if (n >= 15) {
    await tap(page, '#range-control .range-btn[data-range="15"]');
    await sleep(900);
    assert.equal(await count(page, '#sec-week .strip-day'), 7, tag('15 days on the phone: seven full columns'));
    assert.equal(await count(page, '#sec-week .strip-end'), 1, tag('and one compressed end cell'));
    await tap(page, '#sec-week .strip-end');
    await sleep(700);
    assert.equal(await count(page, '#sec-week .strip-day'), n, tag('the end cell expands to every day'));
    const sc = await page.eval(`(() => { const w = document.querySelector('#sec-week .strip-wrap'); return { sw: w.scrollWidth, cw: w.clientWidth, cls: w.className }; })()`);
    assert.ok(sc.sw > sc.cw, tag('the expanded strip scrolls sideways: ' + JSON.stringify(sc)));
    const cell = await page.eval(`document.querySelector('#sec-week .strip-day').getBoundingClientRect().width`);
    assert.ok(cell >= 43.5, tag('expanded columns are at least 44 px: ' + cell));
    const xl = await page.eval(`[...document.querySelectorAll('#sec-week svg.strip text.strip-label')].map((t) => t.textContent)`);
    assert.equal(xl.length, n, tag('every day of the expanded strip keeps its label: ' + xl.join(', ')));
    assert.equal(await snapNow(page), 'full', tag('expanding the strip leaves the sheet where it was'));
    // Nothing a reader needs is cut by the scrolling wrapper's edge (fails before: the key read "ssure aloft · Blue: lower"
    // and "pattern only, no detail", the normal label "nor", the first label "23" and its rain bar "]"). On opening (the
    // selected day revealed), at the far right (scrollLeft = max), and after a scroll to an arbitrary offset that settles:
    // every .strip-key and the "normal" label lie fully inside the wrapper's visible rect and are not inside the scroller;
    // every visible SVG text and every rain bar that shows at all shows whole; the scroll rests on a column boundary.
    const edges = async (how) => {
      const g = await page.eval(`(() => {
        const wrap = document.querySelector('#sec-week .strip-wrap'), W = wrap.getBoundingClientRect();
        const box = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width }; };
        const vis = (e) => getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
        const fixed = [...document.querySelectorAll('#sec-week .strip-key, #sec-week .strip-normal')].map((e) => ({ t: e.textContent, inScroller: wrap.contains(e), vis: vis(e), ...box(e) }));
        const svg = wrap.querySelector('svg.strip');
        const texts = [...svg.querySelectorAll('text')].filter(vis).map((e) => ({ t: e.textContent, ...box(e) }));
        const bars = [...svg.querySelectorAll('rect.bar')].map((e) => ({ t: 'bar ' + e.getAttribute('class'), ...box(e) }));
        const col = svg.querySelector('rect.strip-day').getBoundingClientRect().width;
        return { W: { l: W.left, r: W.right }, fixed, texts, bars, col, sl: wrap.scrollLeft, max: wrap.scrollWidth - wrap.clientWidth };
      })()`);
      const at = tag(`expanded 15-day strip, ${how} (scrollLeft ${g.sl.toFixed(1)} of ${g.max}): `);
      assert.ok(g.fixed.filter((f) => /normal/.test(f.t)).length === 1, at + 'one "normal" label: ' + JSON.stringify(g.fixed.map((f) => f.t)));
      assert.ok(g.fixed.some((f) => /pressure aloft/.test(f.t)), at + 'the key is on screen: ' + JSON.stringify(g.fixed.map((f) => f.t)));
      for (const f of g.fixed) {
        assert.ok(f.vis && f.w > 0, at + `"${f.t}" is shown`);
        assert.ok(f.l >= g.W.l - 0.5 && f.r <= g.W.r + 0.5, at + `"${f.t}" lies inside the wrapper's visible width: ${f.l.toFixed(1)}-${f.r.toFixed(1)} vs ${g.W.l.toFixed(1)}-${g.W.r.toFixed(1)}`);
        assert.ok(!f.inScroller, at + `"${f.t}" is not inside the scrolling wrapper`);
      }
      for (const x of [...g.texts, ...g.bars]) {
        if (x.r <= g.W.l + 0.5 || x.l >= g.W.r - 0.5) continue; // wholly scrolled out of view
        assert.ok(x.l >= g.W.l - 0.5 && x.r <= g.W.r + 0.5, at + `"${x.t}" is whole, not cut by the edge: ${x.l.toFixed(1)}-${x.r.toFixed(1)} vs ${g.W.l.toFixed(1)}-${g.W.r.toFixed(1)}`);
      }
      const off = g.sl / g.col - Math.round(g.sl / g.col);
      assert.ok(Math.abs(off) * g.col < 1, at + `the scroll rests on a column boundary (column ${g.col.toFixed(2)} px)`);
      return g;
    };
    await edges('on opening');
    await page.eval(`(() => { const w = document.querySelector('#sec-week .strip-wrap'); w.scrollLeft = w.scrollWidth - w.clientWidth; })()`);
    await sleep(700);
    const gMax = await edges('scrolled to the far right');
    assert.ok(gMax.sl >= gMax.max - 1, tag('the strip did scroll to its far right: ' + gMax.sl + ' / ' + gMax.max));
    await page.eval(`document.querySelector('#sec-week .strip-wrap').scrollLeft = 400`);
    await sleep(900);
    await edges('scrolled to 400 px and settled');
    await page.eval(`document.querySelector('#sec-week .strip-wrap').scrollLeft = 0`);
    await sleep(700);
    await edges('scrolled back to the start');
  }
  assert.deepEqual(page.errors(), [], tag(JSON.stringify(page.errors())));

  // ================= 1024 x 768 with touch: no sheet, so a finger on a strip must scroll the panel =================
  {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.goto(baseUrl); await page.waitFor(READY, { timeout: 30000 }); await sleep(500);
    await page.eval(`(() => { const s = document.createElement('div'); s.style.cssText = 'height:1500px;flex:none'; document.getElementById('home-body').append(s); })()`);
    const can = await page.eval(`(() => { const b = document.getElementById('home-body'); return { sh: b.scrollHeight, ch: b.clientHeight, ta: getComputedStyle(document.querySelector('#sec-week .strip-wrap')).touchAction }; })()`);
    assert.ok(can.sh > can.ch + 100, tag('the panel scrolls at 1024 wide: ' + JSON.stringify(can)));
    await page.eval(`document.getElementById('home-body').scrollTop = 0`); await sleep(200);
    const y0 = await page.eval(`(() => { const b = document.querySelector('#sec-week .strip-wrap').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await drag(page, y0, { by: { dx: 0, dy: -150 }, touch: true }); await sleep(800);
    const top = await page.eval(`document.getElementById('home-body').scrollTop`);
    assert.ok(top > 60, tag('a finger on a strip scrolls the panel at 1024 wide, touchAction ' + can.ta + ': ' + top));
  }

  // ================= load failure: a chunk the card needs is missing =================
  if (fixture === 'synthetic') {
    const broken = artifactTmp('s-home-broken-');
    for (const f of fs.readdirSync(dataDir)) if (!/\.bin$/.test(f)) fs.copyFileSync(path.join(dataDir, f), path.join(broken, f));
    const srv = await startServer({ dataDir: broken }), br = await Browser.launch({ baseUrl: srv.baseUrl });
    try {
      const p = await br.newPage();
      await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await p.goto(srv.baseUrl);
      await p.waitFor(READY, { timeout: 30000 });
      const err = await p.eval(`(() => { const c = document.querySelector('#sec-week .card'); return { text: c.textContent, retry: !!c.querySelector('.retry-btn') }; })()`);
      assert.ok(/Couldn’t load the forecast for this place/.test(err.text) && err.retry && !/No forecast data for this place yet/.test(err.text), tag('a failed load says so and offers Retry, never "No forecast data": ' + err.text));
    } finally { await br.close(); await srv.close(); }
  }

  // ================= the live states, on live-like copies with the run moved to the real clock =================
  if (fixture === 'synthetic-15d') {
    const live = async (name, src, ageH, steps) => {
      const dir = path.join(artifactTmp('s-home-live-'), name);
      makeLiveLike(dir, path.join(path.dirname(dataDir), src));
      const mp = path.join(dir, 'manifest.json'), mm = JSON.parse(fs.readFileSync(mp, 'utf8'));
      const run = new Date(Math.floor((Date.now() - ageH * 3600e3) / 3600e3) * 3600e3);
      mm.run = run.toISOString().slice(0, 16) + 'Z';
      mm.generated = new Date(run.getTime() + 9.5 * 3600e3).toISOString().slice(0, 16) + 'Z';
      fs.writeFileSync(mp, JSON.stringify(mm));
      return dir;
    };
    const open = async (dir, fn) => {
      const srv = await startServer({ dataDir: dir }), br = await Browser.launch({ baseUrl: srv.baseUrl });
      try { const p = await br.newPage(); await boot(p, srv.baseUrl); await fn(p); assert.deepEqual(p.errors(), [], JSON.stringify(p.errors())); } finally { await br.close(); await srv.close(); }
    };
    const labels = (p) => p.eval(`[...document.querySelectorAll('#sec-week svg.strip text.strip-label')].map((t) => t.textContent)`);
    const base = path.basename(dataDir);
    void base;
    // fresh: Today and Tomorrow, "Your week", the range control live
    await open(await live('fresh', 'synthetic-15d', 6), async (p) => {
      assert.equal(await text(p, '#sec-week .sec-title'), 'Your week', tag('live fresh: Your week'));
      assert.equal(await count(p, '#sec-week .stale-head'), 0, tag('live fresh: no stale head'));
      const l = await labels(p);
      // the second column is Tomorrow, its date, or its weekday where the column is too narrow for a date 6 px clear of its neighbours
      assert.ok(l[0] === 'Today' && /^(Tomorrow|[A-Z][a-z]{2}( \d{1,2})?)$/.test(l[1]), tag('live fresh: Today labels the first column: ' + l.slice(0, 4)));
      assert.equal(await text(p, '#sec-week .sample-tag'), '', tag('live data carries no sample label'));
      await click(p, '#range-control .range-btn[data-range="10"]'); await sleep(800);
      assert.equal(await text(p, '#sec-week .sec-title'), 'Your next 10 days', tag('live range 10 title'));
      assert.equal(await count(p, '#sec-week .strip-day'), 10, tag('live range 10: ten columns'));
      await click(p, '#range-control .range-btn[data-range="15"]'); await sleep(800);
      assert.equal(await text(p, '#sec-week .sec-title'), 'Your next 15 days', tag('live range 15 title'));
    });
    // live: a "starts covering" date is never before the run's first day
    await open(await live('trips', 'synthetic-15d', 6), async (p) => {
      await p.eval(`__wse.store.set({ range: 15 })`); await sleep(1000);
      const cov = (await homeSt(p)).cov;
      await p.eval(`__wse.pins.addTrip({ label: 'Far live', city: __wse.pins.home(), start: ${JSON.stringify(addDays(cov.lastDate, 3))}, end: ${JSON.stringify(addDays(cov.lastDate, 5))} })`);
      await sleep(1500);
      const t = await p.eval(`(() => { const e = [...document.querySelectorAll('#sec-trips [data-state]')].find((x) => x.textContent.includes('Far live')); return e && e.textContent; })()`);
      assert.match(t, /Too far out\./, tag('live: a trip past the run is too far out: ' + t));
      const m = /starts covering it on [A-Za-z]{3} (\d{1,2}) ([A-Za-z]{3})/.exec(t);
      if (m) { const d = Date.parse(`${m[1]} ${m[2]} ${cov.firstDate.slice(0, 4)} 12:00 UTC`); assert.ok(d > Date.parse(cov.firstDate + 'T12:00:00Z'), tag('live: the covering date is after the run starts: ' + t)); }
    });
    await open(await live('stale', 'synthetic-15d', 30), async (p) => {
      assert.match(await text(p, '#sec-week .stale-head'), /^Forecast from 3\d h ago$/, tag('live stale: the head says so in words'));
      assert.ok((await labels(p)).includes('Today'), tag('live stale still says Today'));
    });
    await open(await live('very-stale', 'synthetic-15d', 60), async (p) => {
      assert.match(await text(p, '#sec-week .stale-head'), /^Old forecast from [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/, tag('live very stale: the head names the date'));
      const l = await labels(p);
      assert.ok(!l.some((x) => /Today|Tomorrow/.test(x)) && l.length > 2, tag('live very stale: dates only, no Today or Tomorrow: ' + l.slice(0, 4)));
      assert.ok(l.every((x) => /^[A-Z][a-z]{2} \d{1,2}$/.test(x)), tag('live very stale: every label is a date, never a weekday alone: ' + l.join(' | ')));
      assert.ok(!/Today|Tomorrow/.test(await text(p, '#sec-week .summary')), tag('and none in the sentence'));
    });
    // short of range: a 10-day run with 15 chosen shows the days it has and one end note, no phantom hatched day
    await open(await live('short', 'recorded-min', 6), async (p) => {
      await p.eval(`__wse.store.set({ range: 15 })`); await sleep(900);
      const s = await homeSt(p);
      assert.ok(s.cov.withData < s.cov.requested && s.cov.withData >= 7, tag('the run holds fewer days than asked: ' + JSON.stringify(s.cov)));
      assert.equal(await count(p, '#sec-week .strip-day'), s.cov.withData, tag('live short of range: only the columns that exist'));
      assert.equal(await count(p, '#sec-week .hatch-nodata'), 0, tag('no hatched phantom day'));
      assert.match(await text(p, '#sec-week .end-cell'), /^Later days arrive with the next update \(about \d{1,2} [ap]m\)\.$/, tag('the end cell says when more arrives'));
    });
    // short dataset: fewer than 3 local days
    await open(await live('tiny', 'synthetic', 6), async (p) => {
      const s = await homeSt(p);
      const t = await text(p, '#sec-week .sec-title');
      if (s.cov.withData < 3) { assert.equal(t, `${s.cov.withData} day${s.cov.withData === 1 ? '' : 's'} of data`, tag('a short live dataset is titled by its days: ' + t)); assert.ok(await text(p, '#sec-week .coverage-note'), tag('and says what it covers')); }
      else assert.equal(t, 'Your week', tag('three days is a week card: ' + t));
      assert.equal(await count(p, '#sec-week .strip-day'), s.cov.withData, tag('short dataset: only its columns'));
    });
  }
  void artifactPath;
}
