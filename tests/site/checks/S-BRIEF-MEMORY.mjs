// S-BRIEF-MEMORY (C2-03): "since your last briefing" in the real app. Two live-like copies of synthetic-15d with different run times
// are served in turn, from one server (one origin) to one browser profile: the first briefing has no 'since' beat and saves a digest
// to localStorage wse.v1.brief.memory; the second opens with the beat. A seeded person's name never reaches that key. On data that
// is not live nothing is saved and no beat appears. The card's lines are byte-equal to story/phrases.js output after 'Then: ' and 'Now: '
// (the honesty rule of S-BRIEF-HONEST; that check does not exist on this branch, so the rule lives here too).
// Playback speed comes from the briefing's testRate; nothing here waits on wall-clock time. WSE_SHOTS=<dir> writes screenshots.
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../lib/server.mjs';
import { Browser } from '../lib/cdp.mjs';
import { makeLiveLike } from '../lib/livelike.mjs';
import { artifactTmp } from '../lib/artifacts.mjs';
import * as inp from '../lib/input.mjs';

export const id = 'S-BRIEF-MEMORY';
export const tier = 'full';
export const freshProfile = true;
export const timeoutMs = 400000;
export const data = ['synthetic-15d'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READY = 'window.__wse && window.__wse.ready === true && window.__wse.storyReady === true && !!window.__wse.ui && !!window.__wse.ui.brief';
const VPS = [{ name: 'phone', w: 390, h: 844, phone: true }, { name: 'desktop', w: 1440, h: 900, phone: false }];
const KEY = 'wse.v1.brief.memory';
const NAME = 'Zzyx Testperson';
const iso = (d) => d.toISOString().slice(0, 16) + 'Z';

function setRun(dir, runAt) {
  const mp = path.join(dir, 'manifest.json'), m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  m.run = iso(runAt); m.generated = iso(new Date(runAt.getTime() + 9.5 * 3600e3));
  fs.writeFileSync(mp, JSON.stringify(m));
  return m.run;
}

async function boot(page, url, vp, { clear = false } = {}) {
  await page.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.phone ? 2 : 1, mobile: !!vp.phone });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: !!vp.phone, maxTouchPoints: 5 });
  if (clear) { await page.goto(new URL('css/tokens.css', url).href); await page.eval('localStorage.clear()'); }
  await page.goto('about:blank');
  await page.goto(url);
  await page.waitFor(READY, { timeout: 60000 });
  await page.eval(`(async () => { (await import(new URL('js/time/clock.js', document.baseURI).href)).pause(); })()`);
  await sleep(300);
}
const seedPerson = (page) => page.eval(`(() => { const c = __wse.pins.home();
  __wse.pins.add({ kind: 'person', name: ${JSON.stringify(NAME)}, city: { ...c, id: 5746545, name: 'Portland', lat: 45.52, lon: -122.68, admin: 'OR', cc: 'US' } }); })()`);
const seedLondon = (page) => page.eval(`(() => { const c = __wse.pins.home();
  __wse.pins.add({ kind: 'person', name: 'Qvxw Test', city: { ...c, id: 2643743, name: 'London', lat: 51.51, lon: -0.13, admin: 'England', cc: 'GB' } }); })()`);
const openBrief = async (page, rate) => {
  await page.eval(`__wse.ui.brief.testRate = ${rate}`);
  await inp.click(page, '#brief-pill');
  await page.waitFor(`document.getElementById('app').hasAttribute('data-brief') && !!document.getElementById('brief-card')`, { timeout: 30000 });
};
const beats = (page) => page.eval(`__wse.ui.brief.script().beats.map((b) => b.id)`);
const closeBrief = async (page) => {
  await inp.key(page, null, 'Escape');
  await page.waitFor(`!document.getElementById('app').hasAttribute('data-brief') && !document.getElementById('brief-card')`, { timeout: 8000 });
  await sleep(400);
};
const playToEnd = async (page) => {
  await openBrief(page, 20);
  await page.waitFor(`__wse.ui.brief.player() && __wse.ui.brief.player().state() === 'ended'`, { timeout: 90000 });
};
const memory = (page) => page.eval(`localStorage.getItem(${JSON.stringify(KEY)})`);
/** The reason phrase story/phrases.js gives for home, computed in the page from the story's own day classes. */
const phraseNow = (page) => page.eval(`(async () => { const P = await import(new URL('js/story/phrases.js', document.baseURI).href);
  const s = __wse.ui.home.stories.get('home'); return P.reasonPhrase(s.days.slice()); })()`);
const cardText = (page) => page.eval(`({ kicker: document.querySelector('#brief-card .brief-kicker').textContent, title: document.querySelector('#brief-card .brief-title').textContent,
  lines: [...document.querySelectorAll('#brief-card .brief-line')].map((e) => e.textContent), chapter: document.getElementById('brief-card').dataset.chapter,
  stamp: !!document.querySelector('#brief-card .brief-stamp') && !document.querySelector('#brief-card .brief-stamp').hidden })`);
const shot = async (page, name) => { const d = process.env.WSE_SHOTS; if (d) { fs.mkdirSync(d, { recursive: true }); await page.screenshot(path.join(d, name)); } };

export async function run({ baseUrl, assert, dataDir }) {
  const dir = path.join(artifactTmp('s-brief-memory-'), 'data');
  makeLiveLike(dir, path.join(path.dirname(dataDir), 'synthetic-15d'));
  const runB = new Date(Math.floor((Date.now() - 14 * 3600e3) / 3600e3) * 3600e3);
  const runA = new Date(runB.getTime() - 12 * 3600e3);
  const srv = await startServer({ dataDir: dir }), br = await Browser.launch({ baseUrl: srv.baseUrl });
  try {
    for (const vp of VPS) {
      const T = (s) => `S-BRIEF-MEMORY ${vp.name}: ${s}`;
      const page = await br.newPage();
      // ---- the first briefing in a browser: exactly the C1 script, then a digest is saved
      const A = setRun(dir, runA);
      await boot(page, srv.baseUrl, vp, { clear: true });
      await seedPerson(page); await seedLondon(page); await sleep(200);
      await playToEnd(page);
      const first = await beats(page);
      assert.ok(!first.includes('since'), T('the first briefing has no since beat: ' + first));
      assert.equal(first[0], 'title'); assert.equal(first[1] === 'since', false);
      const rawA = await memory(page);
      assert.ok(rawA, T('a briefing that ended on a live run saves a digest'));
      const memA = JSON.parse(rawA);
      assert.equal(memA.runs.length, 1); assert.equal(memA.runs[0].run, A);
      assert.ok(memA.runs[0].entries.some((e) => e.key === 'home'), T('home is in the digest'));
      assert.ok(!rawA.includes(NAME) && !rawA.includes('Zzyx') && !/Portland|San Francisco|London|Qvxw/.test(rawA), T('the digest holds no name or city: ' + rawA));
      assert.ok(memA.runs[0].entries.filter((e) => e.key.startsWith('pin:')).length >= 2, T('both pinned people are in the digest by key only'));
      assert.ok(!/\(.* time\)|today|tonight|tomorrow/i.test(JSON.stringify(memA.runs[0].entries.map((e) => e.reason))), T('no zone suffix and no relative day word in any saved reason'));
      await closeBrief(page);
      assert.deepEqual(page.errors(), [], T('no console errors after the first briefing: ' + JSON.stringify(page.errors())));

      // ---- the second run, same browser: the beat is there, its lines are the saved and today's phrases (whatever the weather did)
      const B = setRun(dir, runB);
      await boot(page, srv.baseUrl, vp);
      await openBrief(page, 0.01);
      const second = await beats(page);
      assert.equal(second[0], 'title'); assert.equal(second[1], 'since', T('the since beat is the second beat: ' + second));
      assert.equal(second.length, first.length + 1, T('exactly one beat more than the first script'));
      await page.eval(`__wse.ui.brief.player().goTo(1)`);
      await page.waitFor(`document.getElementById('brief-card').dataset.beat === 'since'`, { timeout: 10000 });
      let c = await cardText(page);
      const savedReason = memA.runs[0].entries.find((e) => e.key === 'home').reason;
      const now = await phraseNow(page);
      assert.match(c.kicker, /^Since your last briefing · /, T('kicker: ' + c.kicker));
      assert.ok(c.kicker.includes('run'), T('the kicker carries the earlier run\'s label: ' + c.kicker));
      assert.ok(JSON.stringify(c.lines) === JSON.stringify(['Same as your last briefing.']) || JSON.stringify(c.lines) === JSON.stringify([`Then: ${savedReason}`, `Now: ${now}`]),
        T('the lines are the single line or the saved and today\'s phrases: ' + JSON.stringify(c.lines)));
      assert.equal(c.stamp, true, T('the since beat carries today\'s stamp'));
      assert.equal(await page.eval(`__wse.ui.brief.script().beats[1].camera`), null, T('camera null'));
      await closeBrief(page);
      // it ends, and its own digest is kept; the name is still absent
      await playToEnd(page);
      const memB = JSON.parse(await memory(page));
      assert.deepEqual(memB.runs.map((r) => r.run), [A, B], T('both runs are kept'));
      assert.ok(!(await memory(page)).includes('Zzyx'), T('the name is absent from the memory after two runs'));
      await closeBrief(page);

      // ---- the earlier run saw the same weather as today: the single line
      await page.eval(`(() => { const m = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); m.runs[0].entries = m.runs[1].entries; localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(m)); })()`);
      await boot(page, srv.baseUrl, vp);
      await openBrief(page, 0.01);
      await page.eval(`__wse.ui.brief.player().goTo(1)`);
      await page.waitFor(`document.getElementById('brief-card').dataset.beat === 'since'`, { timeout: 10000 });
      c = await cardText(page);
      assert.deepEqual(c.lines, ['Same as your last briefing.'], T('the same weather reads the single line: ' + JSON.stringify(c.lines)));
      await shot(page, `since-same-${vp.name}.png`);
      await closeBrief(page);

      // ---- the earlier run said something else: Then and Now, byte-equal to phrases.js after the labels
      const other = ['Dry all week', 'Rain from Sunday', 'Under a trough all week'].find((x) => x !== now);
      await page.eval(`(() => { const m = JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})); const r = m.runs.find((x) => x.run === ${JSON.stringify(A)});
        r.entries.find((e) => e.key === 'home').reason = ${JSON.stringify(other)}; localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify(m)); })()`);
      await boot(page, srv.baseUrl, vp);
      await openBrief(page, 0.01);
      await page.eval(`__wse.ui.brief.player().goTo(1)`);
      await page.waitFor(`document.getElementById('brief-card').dataset.beat === 'since'`, { timeout: 10000 });
      c = await cardText(page);
      assert.deepEqual(c.lines, [`Then: ${other}`, `Now: ${now}`], T('Then and Now are the saved and today\'s phrases: ' + JSON.stringify(c.lines)));
      assert.equal(c.lines[1].slice('Now: '.length), await phraseNow(page), T('the Now line is byte-equal to phrases.js output'));
      for (const l of c.lines) assert.ok(l.length <= 110, T('line length ' + l.length));
      const box = await page.eval(`(() => { const e = document.getElementById('brief-card'), r = e.getBoundingClientRect(); const bad = [...e.querySelectorAll('*:not(.brief-live)')].filter((x) => x.scrollHeight > x.clientHeight + 1 && getComputedStyle(x).overflow !== 'visible').map((x) => x.className || x.tagName); return { b: r.bottom, h: innerHeight, l: r.left, r: r.right, w: innerWidth, bad }; })()`);
      assert.ok(box.b <= box.h + 4 && box.l >= -4 && box.r <= box.w + 4 && box.bad.length === 0, T('the card fits the viewport: ' + JSON.stringify(box)));
      await shot(page, `since-thennow-${vp.name}.png`);
      await closeBrief(page);
      assert.deepEqual(page.errors(), [], T('no console errors: ' + JSON.stringify(page.errors())));
      await page.close();
    }
  } finally { await br.close(); await srv.close(); }

  // ---- data that is not live (the recorded-style sample): nothing is saved and no beat appears, even with a digest on file
  const srv2 = await startServer({ dataDir: path.join(path.dirname(dataDir), 'synthetic-15d') }), br2 = await Browser.launch({ baseUrl: srv2.baseUrl });
  try {
    const vp = VPS[1], T = (s) => `S-BRIEF-MEMORY not live: ${s}`;
    const page = await br2.newPage();
    await boot(page, srv2.baseUrl, vp, { clear: true });
    const seeded = JSON.stringify({ v: 1, runs: [{ run: '2000-01-01T00:00Z', label: 'old', entries: [{ key: 'home', reason: 'Dry all week', days: [] }] }] });
    await page.eval(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(seeded)})`);
    await boot(page, srv2.baseUrl, vp);
    await playToEnd(page);
    assert.ok(!(await beats(page)).includes('since'), T('no since beat on data that is not live'));
    assert.equal(await memory(page), seeded, T('nothing is saved'));
    await closeBrief(page);
    assert.deepEqual(page.errors(), [], T('no console errors'));
    await page.close();
  } finally { await br2.close(); await srv2.close(); }
}
