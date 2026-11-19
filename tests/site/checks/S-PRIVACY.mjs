// S-PRIVACY: after adding pins, the hash, config.json and drawn share text hold no pin name; a person-focused link
// carries no place; a fresh profile opening the link has zero pins.
export const id = 'S-PRIVACY';
export const freshProfile = false;
export const timeoutMs = 90000;

const NAME = 'Zorblax Quimby';
const CABIN = 'Zorblax Cabin';

export async function run({ page, baseUrl, assert, newPage }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 15000 });
  const out = await page.eval(`(async () => {
    const L = await import('./js/links.js'); const S = await import('./js/share/index.js'); const F = await import('./js/share/facade.js');
    F.setRenderer({ renderTo(ctx, o) { ctx.fillStyle = '#223'; ctx.fillRect(0, 0, o.width, o.height);
      for (const ov of o.overlays || []) ov(ctx, ([lon, lat]) => [o.width / 2, o.height / 2], {}); } });
    const drawn = [];
    for (const P of [CanvasRenderingContext2D.prototype, OffscreenCanvasRenderingContext2D.prototype]) {
      const o = P.fillText; P.fillText = function (s, ...r) { drawn.push(String(s)); return o.call(this, s, ...r); };
    }
    const { store, pins } = __wse;
    const city = { id: 5746545, name: 'Portland', admin: 'OR', cc: 'US', lat: 45.52, lon: -122.68 };
    pins.add({ kind: 'person', name: ${JSON.stringify(NAME)}, group: 'friends', city });
    pins.add({ kind: 'place', name: ${JSON.stringify(CABIN)}, group: 'friends', city });
    // the focus object is what the app hands to share: label is a city, never a name. A stray name field must still not leak.
    const person = { lat: 45.52, lon: -122.68, label: 'Portland', kind: 'person', placeRef: null, name: ${JSON.stringify(NAME)}, pin: ${JSON.stringify(NAME)} };
    store.set({ view: 'np', layers: { z: true, j: false, c: false, t: false }, t: 12, focus: person });
    const hashPerson = L.formatHash(store.get());
    const linkPerson = await L.linkText();
    const metaPerson = JSON.stringify(S.shareMeta(store.get()));
    store.set({ focus: { ...person, placeRef: 5746545 } });
    const hashPersonRef = L.formatHash(store.get());
    store.set({ focus: person });
    // a bare place with a custom label and no gazetteer id: no place token, label never in the hash
    store.set({ focus: { lat: 40.1, lon: -121.2, label: ${JSON.stringify(CABIN)}, kind: 'place', placeRef: null } });
    const hashCabin = L.formatHash(store.get());
    store.set({ focus: person });
    await S.exportStill({});
    await S.exportLoop({ from: 0, to: 2 });
    const cfg = await (await fetch('config.json')).text();
    return { hashPersonRef, hashPerson, linkPerson, metaPerson, hashCabin, drawn, cfg, ls: Object.entries(localStorage).map(([k, v]) => k + '=' + v).join('|'), url: location.href };
  })()`);
  const leaks = (s) => /zorblax|quimby/i.test(s);
  assert.ok(!leaks(out.hashPerson), 'hash: ' + out.hashPerson);
  assert.ok(!/-(sf|c\d+)$/.test(out.hashPerson), 'a person-focused link carries no place: ' + out.hashPerson);
  assert.ok(!/-(sf|c\d+)$/.test(out.hashPersonRef), 'a person focus carries no place even with a stray ref: ' + out.hashPersonRef);
  assert.ok(!leaks(out.linkPerson));
  assert.ok(!leaks(out.metaPerson), 'share meta: ' + out.metaPerson);
  assert.ok(!leaks(out.hashCabin) && !/-(sf|c\d+)$/.test(out.hashCabin), 'bare place: ' + out.hashCabin);
  assert.ok(!leaks(out.cfg), 'config.json');
  assert.ok(out.drawn.length > 10, 'share text was drawn');
  assert.ok(!out.drawn.some(leaks), 'drawn share text: ' + out.drawn.filter(leaks).join(' | '));
  assert.ok(!leaks(out.url), 'page URL');
  assert.ok(out.drawn.includes('Portland'), 'the ring carries the city name');

  // a fresh profile opening the link starts with zero pins
  const p2 = await newPage();
  try {
    await p2.goto(baseUrl + out.hashPerson);
    await p2.waitFor('window.__wse && window.__wse.ready === true', { timeout: 15000 });
    const fresh = await p2.eval(`(async () => {
      const L = await import('./js/links.js'); const r = await L.applyHash(location.hash);
      return { pins: __wse.pins.all().length, trips: __wse.pins.trips().length, ls: localStorage.getItem('wse.v1.store'), applied: r.applied, view: __wse.store.get().view, focus: __wse.store.get().focus };
    })()`);
    assert.equal(fresh.pins, 0);
    assert.equal(fresh.trips, 0);
    assert.ok(!fresh.ls || !leaks(fresh.ls), 'fresh profile storage holds no names');
    assert.equal(fresh.applied, true, 'the link still opens the view and time');
    assert.ok(!fresh.focus || fresh.focus.kind !== 'person', 'a person-focused link opens with no person place');
  } finally { await p2.close(); }
  assert.deepEqual(page.errors(), [], JSON.stringify(page.errors()));
}
