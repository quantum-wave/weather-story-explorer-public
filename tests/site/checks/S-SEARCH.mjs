// S-SEARCH (N24 SEARCH): the Add sheet's place search on the real shell, with real input, at phone size.
// 1. "coastanoa" (Josh's typo) lists Costanoa, says "Did you mean Costanoa?", and Enter adds nothing (a typo guess is never picked).
// 2. A name nothing matches offers "Search online" and holding the map, and makes NO request by itself.
// 3. Pressing "Search online" where other hosts are blocked (as the artifact's CSP blocks them) makes exactly one request, to the
//    Open-Meteo geocoding URL with only the typed name and a count, and says "Online search isn't available here." with no page
//    error of its own. The harness records the blocked request as a console error; that one entry is expected and is the only one
//    tolerated, so this is an explicit allowance for a request the person asked for, not a loosened rule.
// 4. With the geocoding host answered by a canned reply, the results are listed as "found online"; choosing one and adding stores
//    a two-decimal snapshot with an om- id and nothing else.
import * as inp from '../lib/input.mjs';
import { artifactPath } from '../lib/artifacts.mjs';
export const id = 'S-SEARCH';
export const freshProfile = true;
export const timeoutMs = 90000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = '.wse-sheet';
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';

export async function run({ page, baseUrl, assert }) {
  const pinsNow = () => page.eval(`window.__wse.pins.all().map((p) => p.city)`);
  const options = () => page.eval(`[...document.querySelectorAll('${S} [role=option]')].map((b) => b.textContent)`);
  const msg = () => page.eval(`document.querySelector('${S} .pn-field:has([data-f=city]) .pn-msg')?.textContent || ''`);
  const offer = () => page.eval(`(() => { const o = document.querySelector('${S} .pn-online'); return o && !o.hidden ? o.textContent : ''; })()`);
  const typeCity = async (t) => {
    await page.eval(`(() => { const i = document.querySelector('${S} [data-f=city]'); i.value = ''; i.focus(); return true; })()`);
    await inp.type(page, null, t, { delay: 20 }); await sleep(600);
  };
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 30000 });
  await page.eval(`window.__wse.pins.clearAll()`);
  await page.eval(`(async () => { const m = await import('/js/pins/mount.js'); m.openAddSheet({ kind: 'place' }); return true; })()`);
  await page.waitFor(`document.querySelector('${S}') && document.querySelector('.wse-sheet-root').dataset.state === 'open'`, { timeout: 6000 });
  await inp.click(page, `${S} [data-f=city]`);

  // 1. the typo
  await typeCity('coastanoa');
  const typo = await options();
  assert.ok(typo.length >= 1 && typo[0].startsWith('Costanoa') && /CA/.test(typo[0]) && /lodge/.test(typo[0]), '"coastanoa" lists Costanoa, CA first: ' + typo);
  assert.equal(await msg(), 'Did you mean Costanoa?');
  await inp.key(page, null, 'Enter'); await sleep(200);
  assert.deepEqual(await pinsNow(), [], 'Enter on a typo guess adds nothing');
  assert.equal(await page.eval(`document.querySelector('${S} [data-action="save"]').disabled`), true, 'nothing is chosen yet');
  await page.screenshot(artifactPath('S-SEARCH', 'typo-coastanoa.png'));

  // 2. nothing at all: the offer, no request
  await typeCity('Zqxvbn Cove');
  assert.deepEqual(await options(), []);
  const o = await offer();
  assert.match(o, /No place called Zqxvbn Cove in the built-in list\./);
  assert.match(o, /Search online/);
  assert.match(o, /press and hold the map to drop a pin/);
  assert.ok(await page.eval(`!!document.querySelector('${S} .pn-online-btn') && document.querySelector('${S} .pn-online-btn').getBoundingClientRect().height >= 44`), 'a 44 px Search online button');
  assert.match(o, /\(via Open-Meteo/, 'the offer says the typed name goes to Open-Meteo');
  assert.ok(await page.eval(`(() => { const b = document.querySelector('${S} .pn-online-btn'), v = document.getElementById(b.getAttribute('aria-describedby') || '-'); return !!v && /Open-Meteo/.test(v.textContent) && v.getBoundingClientRect().height > 0 && getComputedStyle(v).visibility === 'visible'; })()`), 'the button is described by the visible Open-Meteo note');
  await sleep(500);
  assert.deepEqual(page.externalRequests, [], 'nothing is fetched until the person presses Search online');
  await page.screenshot(artifactPath('S-SEARCH', 'nothing-found.png'));

  // 3. blocked host: one request, only the name and a count, a quiet status
  await inp.click(page, `${S} .pn-online-btn`);
  await page.waitFor(`document.querySelector('${S} .pn-online')?.textContent.includes("Online search isn't available here.")`, { timeout: 10000 });
  assert.equal(page.externalRequests.length, 1, 'one request: ' + page.externalRequests);
  const u = new URL(page.externalRequests[0]);
  assert.equal(u.origin + u.pathname, GEO);
  assert.deepEqual([...u.searchParams.entries()], [['name', 'Zqxvbn Cove'], ['count', '5']], 'sends only the typed text and a count');
  assert.equal(await page.eval(`!!document.querySelector('${S} .pn-online-btn')`), false, 'the button goes; the other ways on stay');
  assert.match(await offer(), /press and hold the map/);
  const errs = page.errors().filter((e) => !(e.text === 'blocked external request: ' + page.externalRequests[0] || (/Failed to load resource|ERR_BLOCKED_BY_CLIENT/.test(e.text) && e.text.includes('geocoding-api.open-meteo.com'))));
  assert.deepEqual(errs, [], 'no page error beyond the harness noting the blocked request: ' + JSON.stringify(errs));
  await page.screenshot(artifactPath('S-SEARCH', 'online-unavailable.png'));

  // 4. a canned answer: listed, chosen, stored as a snapshot
  page.route((url) => (url.startsWith(GEO + '?') ? { contentType: 'application/json', body: JSON.stringify({ results: [
    { id: 900001, name: 'Zqxvbn Cove', latitude: 37.123456, longitude: -122.345678, country_code: 'US', admin1: 'California', population: 12, timezone: 'America/Los_Angeles' }] }) } : null));
  await typeCity('Zqxvbn Cove!');
  await inp.click(page, `${S} .pn-online-btn`);
  await page.waitFor(`document.querySelectorAll('${S} [role=option]').length === 1`, { timeout: 10000 });
  const on = await options();
  assert.ok(/Zqxvbn Cove/.test(on[0]) && /CA · found online/.test(on[0]), 'online result listed: ' + on);
  assert.equal(page.fulfilled.length, 1);
  assert.equal(new URL(page.fulfilled[0]).searchParams.get('name'), 'Zqxvbn Cove!');
  await inp.click(page, `${S} [role=option]`); await sleep(200);
  await inp.click(page, `${S} [data-action="save"]`); await sleep(500);
  const stored = await pinsNow();
  assert.deepEqual(stored, [{ id: 'om-900001', name: 'Zqxvbn Cove', admin: 'CA', cc: 'US', lat: 37.12, lon: -122.35 }], 'a two-decimal snapshot, nothing else');
  assert.equal(page.externalRequests.length, 1, 'still the one blocked request from step 3');
}
