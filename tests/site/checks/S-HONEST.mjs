// S-HONEST: sample mode never shows a real historical case under today's date. Against the REAL sample fixture
// (own server, whatever --data is): header, scrubber, story lines, deep links and share text carry the case's real
// dates and name the case; no confidence claim from a sample spread; no "this year" date anywhere on the page.
export const id = 'S-HONEST';
export const tier = 'deploy'; // fast, offline, about data honesty: the data and Pages workflows run it
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
    const run = await page.eval(`document.getElementById('data-chip').dataset.full`);
    assert.match(run, /^Sample · \d+ Jan 2017 · not a forecast$/, 'data chip: ' + run);

    // scrubber: real date with year, and the case named
    await page.eval(`__wse.store.set({ t: 12 })`);
    await page.waitFor(`document.querySelector('#timeline .tl-time-main').textContent.includes('2017')`, { timeout: 3000 });
    const main = await page.eval(`document.querySelector('#timeline .tl-time-main').textContent`);
    const sub = await page.eval(`document.querySelector('#timeline .tl-time-sub').textContent`);
    assert.match(main, /Sun 1 Jan 2017|Mon 2 Jan 2017|Sat 31 Dec 2016/, 'readout is the real date: ' + main);
    assert.ok(sub.includes('sample') && sub.includes(label), 'readout names the case: ' + sub);
    assert.equal(await page.eval(`!!document.querySelector('#timeline .tl-ribbon')`), false, 'no confidence ribbon from sample spread (the timeline draws none: W3-08)');

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

    // the card shows the days the sample has and nothing else: three columns (Sat 31 Dec to Mon 2 Jan in San Francisco),
    // no hatched phantom day, no "No data past", no "settled" or "unsettled", and the dates are real
    const card = await page.eval(`(() => { const c = document.querySelector('#sec-week .card'); return { cols: c.querySelectorAll('.strip-day').length, hatch: c.querySelectorAll('.hatch-nodata').length, text: c.textContent, labels: [...c.querySelectorAll('.strip-label')].map((x) => x.textContent) }; })()`);
    assert.equal(card.cols, 3, 'one column per day the sample has: ' + card.cols);
    assert.equal(card.hatch, 0, 'no hatched day');
    assert.ok(!/No data past/i.test(card.text) && !/settled/i.test(card.text), 'card text: ' + card.text);
    assert.deepEqual(card.labels, ['Sat 31', 'Sun 1', 'Mon 2'], 'columns are labelled with the real dates, never an initial: ' + card.labels);
    // (the map legend and the layers panel still carry the old words until the packages that own them land: the home panel is this package's)
    assert.ok(!/settled/i.test(await page.eval(`document.getElementById('home').innerText`)), 'the words settled and unsettled appear nowhere in the home panel');

    // deep link: the real date
    await page.eval(`__wse.store.set({ view: 'np', lens: 'z', t: 12 })`);
    const hash = await page.eval(`import('./js/links.js').then((L) => L.formatHash(__wse.store.get()))`);
    assert.match(hash, /^#np-z-20170101\d\d/, 'link carries the real UTC hour of the case: ' + hash);
    assert.ok(!hash.includes(String(year)), 'link must not carry this year');

    // share text: real date with year, the case, no rebased run
    const meta = await page.eval(`import('./js/share/meta.js').then((M) => { const x = M.shareMeta(__wse.store.get()); return { v: x.validTime, h: x.headline, run: x.run, banner: x.sampleBanner, conf: x.confidence }; })`);
    assert.match(meta.v, /2017/, 'share valid time: ' + meta.v);
    assert.ok(meta.run.includes(label) && !/Model run/.test(meta.run), 'share run line: ' + meta.run);
    assert.ok(meta.banner.includes(label));
    assert.match(meta.conf, /not meaningful for sample data/);

    // the legend is on the map (W3-11: a DOM card now, not canvas text): its title and ticks are in it, and the sample case is named in the legend words
    const lg = await page.eval(`document.getElementById('map-legend').textContent`);
    assert.ok(lg.startsWith('Pressure pattern aloft, vs normal'), 'legend title on the map: ' + lg.slice(0, 60));
    assert.ok(lg.includes('+10') && lg.includes('−10'), 'legend ticks drawn');
    assert.ok((await page.eval(`document.querySelector('#map-legend .mlg-run').textContent`)).includes(label), 'the sample case is named on the visible map legend');

    // another case: Irma shows September 2017 and its own name
    await page.eval(`document.getElementById('btn-layers').click()`);
    await page.eval(`document.querySelector('#layers-panel [data-lens="j"]').click()`);
    await page.waitFor(`document.querySelector('#timeline .tl-time-main').textContent.includes('Sep 2017') || document.querySelector('#timeline .tl-time-main').textContent.includes('Sep 2017')`, { timeout: 3000 });
    const sub2 = await page.eval(`document.querySelector('#timeline .tl-time-sub').textContent`);
    assert.ok(sub2.includes(m.cases.B.label), 'case B named: ' + sub2);
  }
}
