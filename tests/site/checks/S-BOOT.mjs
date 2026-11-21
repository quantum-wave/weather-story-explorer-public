// S-BOOT: the page loads, no console error, no external request, __wse.ready true.
// Integration only (later): no `// STUB` left in site/js/.
export const id = 'S-BOOT';
export const tier = 'deploy'; // fast, offline, about data honesty: the data and Pages workflows run it
export const freshProfile = false;
export async function run({ page, baseUrl, assert, dataDir }) {
  const man = JSON.parse((await import('node:fs')).readFileSync((await import('node:path')).join(dataDir, 'manifest.json'), 'utf8'));
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 15000 });
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
  assert.deepEqual(page.externalRequests, []);
  assert.equal(await page.eval('typeof d3.contours'), 'function', 'd3 global loaded from vendor/');
  assert.equal(await page.eval('typeof topojson.feature'), 'function', 'topojson global loaded from vendor/');
  await page.waitFor('window.__wse.storyReady === true', { timeout: 20000 });
  assert.deepEqual(page.errors(), [], 'console errors after the story loaded: ' + JSON.stringify(page.errors()));
  // W3-05: nothing is left loading, the store has the section 15 keys, and the shell stubs are mounted
  assert.equal(await page.eval(`document.getElementById('map-status').textContent`), '', 'no status line left once the data is in');
  assert.equal(await page.eval(`document.querySelectorAll('[data-skeleton]').length`), 0, 'no skeleton cards left once the story is in');
  // range, lens and ground are choices made with a control (state.js CHOICE_DEFAULTS): absent until made, unless the link set one
  assert.deepEqual(await page.eval(`(async () => { const s = window.__wse.store.get(), m = await import('./js/state.js'); return [m.choice(s, 'range'), m.choice(s, 'lens'), m.choice(s, 'ground'), s.units, s.themePref, s.expanded, Object.keys(s.overlays).sort().join()]; })()`),
    [7, 'z', 'paper', 'metric', 'auto', false, 'contours,doubt,jetline,marks,pins,places'], 'store keys and defaults');
  assert.ok(await page.eval(`!!document.getElementById('btn-expand') && !!document.getElementById('toasts')`), 'expand control and toast region exist');
  assert.equal(await page.eval('window.__wse.store.get().sample'), man.sample === true, 'manifest from /data/ was read');
}
