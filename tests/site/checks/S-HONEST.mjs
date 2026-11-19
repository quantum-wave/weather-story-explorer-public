// S-HONEST: sample mode never shows a real historical case under today's date. Against the REAL sample fixture
// (own server, whatever --data is): header, scrubber, story lines, deep links and share text carry the case's real
// dates and name the case; no confidence claim from a sample spread; no "this year" date anywhere on the page.
export const id = 'S-HONEST';
export const data = 'sample-min'; // the real sample fixture, whatever --data is
export const freshProfile = true;
export const timeoutMs = 90000;

export async function run({ page, baseUrl, assert }) {
  {
    await page.goto(baseUrl);
    await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 30000 });
    await page.eval(`__wse.store.set({ playing: false })`);
    const m = await page.eval('__wse.data.getManifest()');
    assert.equal(m.sample, true);
    const label = m.cases.A.label; // 'ERA5, 1-2 Jan 2017'
    const year = new Date().getFullYear();
    const body = () => page.eval(`document.body.innerText`);

    // header: the case's real start, not the rebased run
    const run = await page.eval(`document.getElementById('run-label').textContent`);
    assert.match(run, /^Sample · \d+ Jan 2017 00Z$/, 'run label: ' + run);

    // scrubber: real date with year, and the case named
    await page.eval(`__wse.store.set({ t: 12 })`);
    await page.waitFor(`document.querySelector('#timeline .tl-time-main').textContent.includes('2017')`, { timeout: 3000 });
    const main = await page.eval(`document.querySelector('#timeline .tl-time-main').textContent`);
    const sub = await page.eval(`document.querySelector('#timeline .tl-time-sub').textContent`);
    assert.match(main, /Sun 1 Jan 2017|Mon 2 Jan 2017|Sat 31 Dec 2016/, 'readout is the real date: ' + main);
    assert.ok(sub.includes('sample') && sub.includes(label), 'readout names the case: ' + sub);
    assert.equal(await page.eval(`document.querySelector('#timeline .tl-ribbon').hidden`), true, 'no confidence ribbon from sample spread');

    // story lines: real dates, the case named, no confidence claim, no rain/air claims the sample lacks
    const text = await body();
    assert.ok(!new RegExp('\\b' + year + '\\b').test(text), `no ${year} date anywhere on the page`);
    const tag = await page.eval(`document.querySelector('#home .sample-tag')?.textContent || ''`);
    assert.ok(tag.includes(label) && /not a forecast/.test(tag), 'story names its case: ' + tag);
    const dayline = await page.eval(`document.querySelector('#focus-card .dayline, #home .dayline')?.textContent || ''`);
    assert.match(dayline, /(Sat|Sun|Mon) \d+ (Dec|Jan) (2016|2017)/, 'day line has the real date: ' + dayline);
    assert.ok(/(Rain|Temperature)[^.]* (isn’t|aren’t) in this sample/.test(dayline), 'missing rows say so: ' + dayline);
    const stories = await page.eval(`[...document.querySelectorAll('#home .summary, #home .dayline, #focus-card .summary, #focus-card .dayline')].map(e => e.textContent).join(' | ')`);
    assert.ok(!/Pattern: (confident|fairly|timing)/.test(stories), 'no confidence claim in sample stories: ' + stories);
    assert.ok(!/(dry|rain|warmer|cooler|colder|mild|settled)/i.test(stories.replace(/(Rain and temperature aren’t|Rain isn’t|Temperature isn’t) in this sample/g, '')), 'no rain or air-mass claim the sample lacks: ' + stories);

    // deep link: the real date
    await page.eval(`__wse.store.set({ view: 'np', layers: { z: true, j: false, c: false, t: false }, t: 12 })`);
    const hash = await page.eval(`import('./js/links.js').then((L) => L.formatHash(__wse.store.get()))`);
    assert.match(hash, /^#np-z-20170101\d\d/, 'link carries the real UTC hour of the case: ' + hash);
    assert.ok(!hash.includes(String(year)), 'link must not carry this year');

    // share text: real date with year, the case, no rebased run
    const meta = await page.eval(`import('./js/share/meta.js').then((M) => { const x = M.shareMeta(__wse.store.get()); return { v: x.validTime, h: x.headline, run: x.run, banner: x.sampleBanner, conf: x.confidence }; })`);
    assert.match(meta.v, /2017/, 'share valid time: ' + meta.v);
    assert.ok(meta.run.includes(label) && !/Model run/.test(meta.run), 'share run line: ' + meta.run);
    assert.ok(meta.banner.includes(label));
    assert.match(meta.conf, /not meaningful for sample data/);

    // the legend is on the map: draw once with a fillText spy (desktop-size viewport: title, ticks, baseline, badge)
    const drawn = await page.eval(`(() => { const out = []; const o = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (t, ...r) { out.push(String(t)); return o.call(this, t, ...r); };
      __wse.store.set({ t: 13 }); __wse.renderer.draw();
      CanvasRenderingContext2D.prototype.fillText = o; return out; })()`);
    assert.ok(drawn.some((t) => t.startsWith('500 hPa height vs normal')), 'legend title drawn on the map: ' + drawn.slice(0, 12));
    assert.ok(drawn.includes('+24') && drawn.includes('-24'), 'legend ticks drawn');
    assert.ok(drawn.some((t) => t.includes(label)), 'the sample badge with the case is on the map');

    // another case: Irma shows September 2017 and its own name
    await page.eval(`document.getElementById('btn-layers').click()`);
    await page.eval(`document.querySelector('#layers-panel [data-case="B"]').click()`);
    await page.waitFor(`document.querySelector('#timeline .tl-time-main').textContent.includes('Sep 2017') || document.querySelector('#timeline .tl-time-main').textContent.includes('Sep 2017')`, { timeout: 3000 });
    const sub2 = await page.eval(`document.querySelector('#timeline .tl-time-sub').textContent`);
    assert.ok(sub2.includes(m.cases.B.label), 'case B named: ' + sub2);
  }
}
