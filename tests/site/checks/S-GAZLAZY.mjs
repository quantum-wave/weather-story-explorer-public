// S-GAZLAZY: the gazetteer (cities.json, places-extra.json) is not fetched at boot; it loads on first use (DESIGN-SPEC 8.4).
export const id = 'S-GAZLAZY';
export const tier = 'deploy';
export const freshProfile = false;
export async function run({ page, baseUrl, assert }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 3000)); // past any idle-callback or 1.5 s timer warm-up
  const loaded = await page.eval(`performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /cities\\.json|places-extra\\.json/.test(n))`);
  assert.deepEqual(loaded, [], 'the gazetteer was fetched at boot: ' + JSON.stringify(loaded));
}
