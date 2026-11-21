// S-SAMPLE: sample manifest -> amber badge in the header and the legend text, a dismissible demo card, one case at a
// time (choosing a lens shows the case that holds its field), and a friend opening a link is asked for their city.
export const id = 'S-SAMPLE';
export const freshProfile = true;
export async function run({ page, baseUrl, assert, newPage }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 20000 });
  const m = await page.eval('__wse.data.getManifest()');
  if (m.sample !== true) {
    // live data: none of the sample furniture appears
    assert.equal(await page.eval(`!/^(Sample|Recorded)/.test(document.getElementById('data-chip').dataset.full || '')`), true, 'live data: no sample badge');
    assert.equal(await page.eval(`!!document.getElementById('demo-card')`), false, 'live data: no demo card');
    const lg = await page.eval(`document.getElementById('legend').textContent`);
    assert.ok(!/not a forecast/.test(lg), 'live data: legend has no sample line: ' + lg);
    assert.deepEqual(page.errors(), [], JSON.stringify(page.errors()));
    return;
  }
  const cases = Object.keys(m.cases);
  const label = (c) => m.cases[c].label;

  // badge in the header, words in the legend
  // the badge sentence lives in the data chip's popover (W3-04): open it with a tap, read it, close it
  const badge = async () => { await page.eval(`document.getElementById('data-chip').click()`); const t = await page.eval(`document.querySelector('#data-popover .full')?.textContent || ''`); await page.eval(`document.getElementById('data-chip').click()`); return t; };
  assert.equal(await badge(), `Sample data · ${label('A')} · not a forecast`);
  const legend = await page.eval(`document.getElementById('legend').textContent`);
  assert.ok(legend.includes('Pressure pattern aloft, vs normal') && legend.includes(`Sample data · ${label('A')} · not a forecast`), 'legend: ' + legend);

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

  // one case at a time: choosing a lens in the Layers panel shows the case that holds its field, and the badge and legend follow it
  await page.eval(`document.getElementById('btn-layers').click()`);
  const lenses = await page.eval(`[...document.querySelectorAll('#layers-panel [data-lens]:not([disabled])')].map(b => b.dataset.lens)`);
  assert.ok(lenses.length >= 2, 'the panel offers the lenses this sample can draw: ' + lenses);
  assert.equal(await page.eval(`document.querySelectorAll('#layers-panel [data-case], #layers-panel [data-layer]').length`), 0, 'no case switch and no layer toggles are left');
  const FILL = { z: 'z500a', j: 'ws250', s: 'tp6', a: 't850a', r: 'ivt', c: 'z500sd' };
  for (const code of lenses) {
    await page.eval(`document.querySelector('#layers-panel [data-lens="${code}"]').click()`);
    const st = await page.eval(`({ lens: __wse.store.get().lens ?? 'z', keys: Object.keys(__wse.store.get()), active: __wse.data.activeCase() })`);
    assert.equal(st.lens, code);
    assert.ok(!st.keys.includes('case') && !st.keys.includes('layers'), 'the retired keys are not in the store: ' + st.keys);
    assert.equal(st.active, m.fields[FILL[code]].case, `the ${code} lens shows the case that holds ${FILL[code]}`);
    assert.equal(await badge(), `Sample data · ${label(st.active)} · not a forecast`, 'badge follows the case');
    const sr = await page.eval(`document.getElementById('legend').textContent`);
    assert.ok(sr.includes(`Sample data · ${label(st.active)}`), 'the legend names the case: ' + sr);
  }
  const motion = await page.eval(`[...document.querySelectorAll('#layers-panel [role=radio]')].map(b => b.textContent).join(' ')`);
  assert.ok(!/motion demo|surface temperature/i.test(motion), 'the sample-only motion layer is not offered: ' + motion);

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
