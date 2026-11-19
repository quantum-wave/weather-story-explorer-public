// S-STORY (browser part): the story is built from the loaded data and drives the home. Goldens for the pure
// functions live in tests/site/unit/wp4.story.test.mjs.
export const id = 'S-STORY';
export const freshProfile = true;
export async function run({ page, baseUrl, assert }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 20000 });
  await page.eval(`(async () => { window.S = await import('./js/story/index.js'); return true; })()`);

  // home card: a summary sentence and a strip of seven tappable days
  const card = await page.eval(`(() => { const c = document.querySelector('#sec-week .card'); return { summary: c.querySelector('.summary').textContent, days: c.querySelectorAll('.strip-day').length, h: c.querySelector('svg.strip').getAttribute('height') }; })()`);
  assert.ok(card.summary.length > 20 && /\.$/.test(card.summary), 'summary: ' + card.summary);
  assert.equal(card.days, 7);
  assert.equal(card.h, '56');

  // buildDays + stripSVG on real loaded data
  const r = await page.eval(`(async () => {
    const days = await S.buildDays(37.77, -122.42, 0, 6);
    const svg = S.stripSVG(days, days.series, 'dark', { width: 336 });
    const n = S.notability(37.77, -122.42);
    return { n: days.length, d0: days[0], hatch: svg.querySelectorAll('.hatch-nodata').length, taps: svg.querySelectorAll('.strip-day').length, score: n.score, reason: n.reason, summary: S.summarize(days) };
  })()`);
  assert.ok(r.n >= 7, 'at least a week of days');
  assert.ok(['ridge', 'trough', 'trough-arriving', 'ridge-building', 'near-normal'].includes(r.d0.pattern), 'day 1 pattern: ' + r.d0.pattern);
  assert.equal(r.taps, r.n);
  assert.ok(Number.isFinite(r.score) && r.score > 0, 'notability ' + r.score);
  assert.ok(r.summary.length > 20);

  const range = await page.eval(`(() => { const st = __wse.data.fieldSteps('z500a'); return [st[0], st[st.length - 1]]; })()`);
  const ts = await page.eval(`[...document.querySelectorAll('#sec-week .strip-day')].map(x => +x.dataset.t)`);
  assert.ok(ts.every((t) => t >= range[0] && t <= range[1]), 'every strip day scrubs inside the loaded range: ' + ts);

  // tapping a strip day scrubs the clock there and centres the focus
  await page.eval(`__wse.store.set({ playing: false })`);
  const before = await page.eval(`__wse.store.get().t`);
  const target = await page.eval(`(() => { const d = [...document.querySelectorAll('#sec-week .strip-day')].find(x => +x.dataset.t > 0 && Math.abs(+x.dataset.t - __wse.store.get().t) > 3); if (!d) return null; d.dispatchEvent(new MouseEvent('click', { bubbles: true })); return +d.dataset.t; })()`);
  assert.ok(target != null, 'a later strip day exists');
  await page.waitFor(`Math.abs(__wse.store.get().t - ${target}) < 0.6`, { timeout: 4000 });
  assert.notEqual(before, target);
  assert.equal(await page.eval(`__wse.store.get().focus.label`), 'San Francisco');

  // a person's name never reaches the focus: label is the city, placeRef null
  await page.eval(`(async () => { const g = await import('./js/pins/gazetteer.js'); const [c] = await g.gazetteer.search('Portland', 3); __wse.pins.add({ kind: 'person', name: 'Maya', group: 'friends', city: c }); })()`);
  await page.waitFor(`document.querySelector('.person-main')`, { timeout: 5000 });
  await page.eval(`document.querySelector('.person-main').click()`);
  await page.waitFor(`__wse.store.get().focus && __wse.store.get().focus.kind === 'person'`, { timeout: 5000 });
  const f = await page.eval(`__wse.store.get().focus`);
  assert.ok(/^Portland/.test(f.label) && !/Maya/.test(JSON.stringify(f)) && f.placeRef == null, JSON.stringify(f));
  assert.deepEqual(page.errors(), [], JSON.stringify(page.errors()));
}
