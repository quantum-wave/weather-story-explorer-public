// S-BOOT: the page loads, no console error, no external request, __wse.ready true.
// Integration only (later): no `// STUB` left in site/js/.
export const id = 'S-BOOT';
export const freshProfile = false;
export async function run({ page, baseUrl, assert, dataDir }) {
  const man = JSON.parse((await import('node:fs')).readFileSync((await import('node:path')).join(dataDir, 'manifest.json'), 'utf8'));
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 15000 });
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
  assert.deepEqual(page.externalRequests, []);
  assert.equal(await page.eval('typeof d3.contours'), 'function', 'd3 global loaded from vendor/');
  assert.equal(await page.eval('typeof topojson.feature'), 'function', 'topojson global loaded from vendor/');
  assert.equal(await page.eval('window.__wse.store.get().sample'), man.sample === true, 'manifest from /data/ was read');
}
