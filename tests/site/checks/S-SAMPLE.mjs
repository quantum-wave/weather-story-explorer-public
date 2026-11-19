// S-SAMPLE: sample manifest -> amber badge in the header and the legend text, a dismissible demo card, one case at a
// time (the layer switch is a case switch), and a friend opening a link is asked for their city.
export const id = 'S-SAMPLE';
export const freshProfile = true;
export async function run({ page, baseUrl, assert, newPage }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 20000 });
  const m = await page.eval('__wse.data.getManifest()');
  if (m.sample !== true) {
    // live data: none of the sample furniture appears
    assert.equal(await page.eval(`document.querySelector('#topbar #sample-badge')?.hidden !== false`), true, 'live data: no sample badge');
    assert.equal(await page.eval(`!!document.getElementById('demo-card')`), false, 'live data: no demo card');
    const lg = await page.eval(`document.getElementById('legend').textContent`);
    assert.ok(!/not a forecast/.test(lg), 'live data: legend has no sample line: ' + lg);
    assert.deepEqual(page.errors(), [], JSON.stringify(page.errors()));
    return;
  }
  const cases = Object.keys(m.cases);
  const label = (c) => m.cases[c].label;

  // badge in the header, words in the legend
  const badge = () => page.eval(`document.querySelector('#topbar #sample-badge').hidden ? '' : document.querySelector('#topbar #sample-badge').textContent`);
  assert.equal(await badge(), `Sample data · ${label('A')} · not a forecast`);
  const legend = await page.eval(`document.getElementById('legend').textContent`);
  assert.ok(legend.includes('Blue: lower pressure aloft') && legend.includes(`Sample data · ${label('A')} · not a forecast`), 'legend: ' + legend);

  // demo card, dismissible, stays dismissed after a reload
  const demo = await page.eval(`document.getElementById('demo-card')?.textContent || ''`);
  assert.ok(/not a forecast/.test(demo) && /Live forecasts start when the data pipeline is connected/.test(demo), 'demo card: ' + demo);
  await page.eval(`document.querySelector('#demo-card button').click()`);
  assert.equal(await page.eval(`!!document.getElementById('demo-card')`), false);
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.storyReady === true', { timeout: 20000 });
  assert.equal(await page.eval(`!!document.getElementById('demo-card')`), false, 'dismissal persists');

  // the story card shows only days that have data: no hatched day, no "No data past", no "settled"
  const wk = await page.eval(`(() => { const c = document.querySelector('#sec-week .card'); return { hatch: c.querySelectorAll('.hatch-nodata').length, cols: c.querySelectorAll('.strip-day').length, text: c.textContent }; })()`);
  assert.equal(wk.hatch, 0, 'no hatched day in the sample card');
  assert.ok(wk.cols >= 1 && wk.cols <= 7, 'columns: ' + wk.cols);
  assert.ok(!/No data past|settled/i.test(wk.text), 'card text: ' + wk.text);

  // one case at a time
  const shown = (l) => Object.entries(l).filter(([, v]) => v).map(([k]) => k);
  await page.eval(`document.getElementById('btn-layers').click()`);
  const radios = await page.eval(`[...document.querySelectorAll('#layers-panel [data-case]')].map(b => b.dataset.case)`);
  assert.ok(radios.length >= 2, 'case switch lists the cases that have a layer: ' + radios);
  for (const c of radios) {
    await page.eval(`document.querySelector('#layers-panel [data-case="${c}"]').click()`);
    const st = await page.eval(`({ ...__wse.store.get() })`);
    assert.equal(st.case, c);
    assert.equal(shown(st.layers).length, 1, `case ${c} shows one layer, got ${shown(st.layers)}`);
    assert.equal(await badge(), `Sample data · ${label(c)} · not a forecast`, 'badge follows the case');
    const enabled = await page.eval(`[...document.querySelectorAll('#layers-panel [data-layer]:not([disabled])')].map(b => b.dataset.layer)`);
    assert.ok(enabled.includes(shown(st.layers)[0]), 'the active layer is toggleable');
    assert.ok(!enabled.includes('t') || c === 'C', 'the motion layer is only on in case C');
  }

  // a friend opening a link is never shown "Your week" as theirs
  const p2 = await newPage();
  await p2.goto(baseUrl + '#np-z-2026111700-sf');
  await p2.waitFor('window.__wse && window.__wse.storyReady === true', { timeout: 20000 });
  const sec = await p2.eval(`document.getElementById('sec-week').textContent`);
  assert.ok(sec.includes('Where are you?') && sec.includes('Add your city to see your own week.') && !sec.includes('Where are you? Add your city') && !sec.includes('Your week'), 'friend card: ' + sec);
  assert.equal(await p2.eval(`__wse.store.get().focus?.label`), 'San Francisco', 'the linked place is focused');
  const kick = await p2.eval(`document.querySelector('#focus-card .kicker')?.textContent || ''`);
  assert.ok(kick && !/^(.+) · \\1$/.test(kick), 'the place is named once in the focus kicker: ' + kick);
  await p2.close();
  assert.deepEqual(page.errors(), [], JSON.stringify(page.errors()));
}
