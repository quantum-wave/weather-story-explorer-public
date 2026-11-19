// S-PHONE: on a phone the map is fitted to the part of the screen the sheet and scrubber leave free, and a focused
// place stays inside it at every sheet height; the sheet can be dragged from its card as well as its handle.
export const id = 'S-PHONE';
export const freshProfile = true;
export const timeoutMs = 60000;

export async function run({ page, baseUrl, assert }) {
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 30000 });
  await page.eval(`(async () => { (await import(new URL('js/time/clock.js', document.baseURI).href)).pause(); })()`);
  const SF = [-122.42, 37.77];
  const settle = () => new Promise((r) => setTimeout(r, 400));
  // the free rectangle of the map canvas, in canvas px: below the view-switch row (56 px), above the sheet and the scrubber
  const free = () => page.eval(`(() => { const app = document.getElementById('app'), cv = document.getElementById('map').getBoundingClientRect();
    const sheet = parseFloat(getComputedStyle(app).getPropertyValue('--sheet-h')) || 0, tl = document.getElementById('timeline').getBoundingClientRect().height;
    return { top: 56, bottom: cv.height - sheet - tl, left: 0, right: cv.width }; })()`); // canvas coordinates, like renderer.project
  const where = (ll) => page.eval(`(() => { const p = __wse.renderer.project(${JSON.stringify(ll)}); return p && { x: p[0], y: p[1] }; })()`);
  const inside = (p, r, what) => assert.ok(p && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom, `${what} is in the free map area ${JSON.stringify(r)}: ${JSON.stringify(p)}`);

  // 1. opening view at peek: San Francisco is in view in every map view, and the Arctic does not fill the frame
  for (const view of ['np', 'nh', 'gl']) {
    await page.eval(`__wse.store.set({ view: ${JSON.stringify(view)} })`); await settle();
    const r = await free();
    inside(await where(SF), r, `San Francisco in ${view}`);
    if (view === 'gl') {
      inside(await where([-140, -30]), r, 'the south of the visible globe');
      assert.equal(await where([40, -35]), null, 'the far side of the globe has no pixel');
    }
    if (view === 'nh') { inside(await where([-122.42, 90]), r, 'the pole in nh'); inside(await where([-122.42, 15]), r, 'the rim of the disc (15N) in nh'); }
    if (view === 'np') {
      const sf = await where(SF), hgt = r.bottom - r.top;
      assert.ok(sf.y > r.top + 0.2 * hgt && sf.y < r.bottom - 0.1 * hgt, 'San Francisco sits in the middle of the free area, not at its edge: ' + JSON.stringify(sf));
      // portrait Regional fits 22-60N (spec 4.6): 60N and 25N are inside the free area, Anchorage may fall off the top, Honolulu off the bottom
      const north = await where([-122.42, 60]), south = await where([-122.42, 25]);
      assert.ok(north && south && north.y > r.top - 1 && south.y < r.bottom + 1, 'np shows 25N to 60N inside the free area: ' + JSON.stringify([north, south, r]));
      assert.ok(sf.x >= 0.5 * (r.right - r.left) && sf.x <= 0.75 * (r.right - r.left), 'San Francisco is 50-75 % across the free area: ' + JSON.stringify(sf));
    }
  }
  await page.eval(`__wse.store.set({ view: 'np' })`); await settle();

  // 2. a focused, zoomed place stays in the free area as the sheet moves
  await page.eval(`(async () => { __wse.store.set({ focus: { lat: ${SF[1]}, lon: ${SF[0]}, label: 'San Francisco', kind: 'place', placeRef: 5391959 } }); await __wse.renderer.centreOn(${SF[1]}, ${SF[0]}, 0, 2); })()`);
  await settle();
  for (const snap of ['half', 'peek', 'full', 'peek']) {
    await page.eval(`__wse.store.set({ sheet: ${JSON.stringify(snap)} })`); await settle();
    const r = await free();
    if (snap === 'full' && r.bottom - r.top < 40) continue; // a full sheet leaves almost no map
    inside(await where(SF), r, `the focused place at ${snap}`);
  }

  // 3. the sheet drags from its focus card, not only from the 44 px handle; a tap on a button in it still works
  const h = await page.eval(`document.getElementById('sheet-handle').getBoundingClientRect().height`);
  assert.ok(h >= 44, 'the drag handle is at least 44 px tall: ' + h);
  await page.eval(`__wse.store.set({ sheet: 'peek' })`); await settle();
  const card = await page.eval(`(() => { const c = document.getElementById('focus-card'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  assert.ok(card, 'the focus card exists');
  const touch = (type, x, y) => page.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', card.x, card.y);
  for (let i = 1; i <= 8; i++) await touch('touchMove', card.x, card.y - i * 40);
  await touch('touchEnd');
  await settle();
  assert.notEqual(await page.eval(`__wse.store.get().sheet`), 'peek', 'swiping up on the focus card raises the sheet');
  assert.deepEqual(page.errors(), [], JSON.stringify(page.errors()));
}
