// S-LINK: hash round trip, snap notice, no reserved name, throttled mirroring, canonical link.
export const id = 'S-LINK';
export const freshProfile = false;
export const data = ['synthetic', 'sample-min'];
export async function run({ page, baseUrl, assert, newPage, fixture }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 15000 });
  await page.eval(`(async () => { window.L = await import('./js/links.js'); window.C = await import('./js/contract.js'); return true; })()`);

  // steps of the loaded data (the check runs on any fixture); stamp(t) is the UTC hour stamp a link must carry
  await page.eval(`(async () => { window.G = await import('./js/share/hashgrammar.js'); return true; })()`);
  const steps = await page.eval(`__wse.data.fieldSteps('z500a')`);
  assert.ok(steps.length >= 3 && steps[1] - steps[0] >= 2, 'fixture has steps at least 2 h apart');
  const [s0, s1, s2] = steps;
  const stamp = (h) => page.eval(`G.utcStamp(__wse.data.validTime(${h}))`);

  // format + round trip
  const out = await page.eval(`(async () => {
    const { store } = __wse;
    store.set({ view: 'nh', lens: 'z', overlays: { jetline: true }, t: ${s2}, focus: null });
    const h = L.formatHash(store.get());
    store.set({ view: 'np', lens: 'j', overlays: { jetline: false }, t: ${s0} });
    const r = await L.applyHash(h);
    const s = store.get();
    return { h, r, view: s.view, lens: s.lens, jetline: s.overlays.jetline, t: s.t };
  })()`);
  assert.equal(out.h, '#nh-zj-' + (await stamp(s2)));
  assert.equal(out.view, 'nh');
  assert.equal(out.lens, 'z'); assert.equal(out.jetline, true, 'the link restores the lens and the Jet outline');
  assert.equal(out.t, s2);
  assert.equal(out.r.snapped, false);

  // a place focus is carried as a token and restored; a person focus never is
  const place = await page.eval(`(async () => {
    const { store } = __wse;
    store.set({ focus: { lat: 37.77, lon: -122.42, label: 'San Francisco', kind: 'place', placeRef: 5391959 } });
    const withPlace = L.formatHash(store.get());
    store.set({ focus: null, t: ${s0} });
    await L.applyHash(withPlace);
    const f = store.get().focus;
    store.set({ focus: { lat: 45.5, lon: -122.7, label: 'Portland', kind: 'person', placeRef: null } });
    const person = L.formatHash(store.get());
    store.set({ focus: { lat: 45.5, lon: -122.7, label: 'Portland', kind: 'person', placeRef: 4720 } });
    const personWithRef = L.formatHash(store.get());
    return { withPlace, label: f && f.label, kind: f && f.kind, person, personWithRef };
  })()`);
  assert.ok(place.withPlace.endsWith('-sf'), place.withPlace);
  assert.equal(place.label, 'San Francisco');
  assert.equal(place.kind, 'place');
  assert.ok(!/-(sf|c\d+)$/.test(place.person), 'person focus carries no place: ' + place.person);
  assert.ok(!/-(sf|c\d+)$/.test(place.personWithRef), 'person focus carries no place even with a ref: ' + place.personWithRef);

  // a link to a gazetteer place (not San Francisco) resolves to that place: the link opens on Seattle
  const gz = await page.eval(`(async () => {
    const r = await L.applyHash('#np-z-' + G.utcStamp(__wse.data.validTime(${s0})) + '-c5809844');
    const f = __wse.store.get().focus;
    return { applied: r.applied, label: f && f.label, kind: f && f.kind, placeRef: f && f.placeRef, hash: L.formatHash(__wse.store.get()) };
  })()`);
  assert.equal(gz.label, 'Seattle'); assert.equal(gz.kind, 'place');
  assert.ok(gz.hash.endsWith('-c5809844'), 'the place survives a round trip: ' + gz.hash);

  // World (W4-10): #wm-... opens the World view and formatHash writes it back
  const wm = await page.eval(`(async () => {
    const { store } = __wse; store.set({ view: 'np', lens: 'z', overlays: { jetline: false }, focus: null });
    const r = await L.applyHash('#wm-z-' + G.utcStamp(__wse.data.validTime(${s0})));
    return { r, view: store.get().view, hash: L.formatHash(store.get()) };
  })()`);
  assert.equal(wm.view, 'wm', 'a #wm link opens World: ' + JSON.stringify(wm));
  assert.ok(wm.hash.startsWith('#wm-z-'), 'World writes back as #wm-: ' + wm.hash);

  // snapping: an hour that is not a forecast step snaps to the nearest step and says so
  const snap = await page.eval(`(async () => {
    const { store } = __wse;
    const r = await L.applyHash('#np-z-' + G.utcStamp(__wse.data.validTime(${s0 + 1})));
    const el = document.getElementById('share-notice');
    return { r, t: store.get().t, notice: el && !el.hidden ? el.textContent : null, steps: __wse.data.fieldSteps('z500a') };
  })()`);
  assert.equal(snap.r.snapped, true);
  assert.equal(snap.t, s0, 'asked one hour past the first step: the nearest step is the first');
  assert.ok(snap.steps.includes(snap.t));
  assert.match(snap.notice || '', /nearest step/);
  const far = await page.eval(`(async () => { const r = await L.applyHash('#np-z-2027010100'); return { r, t: __wse.store.get().t, last: __wse.data.fieldSteps('z500a').at(-1) }; })()`);
  assert.equal(far.r.snapped, true);
  assert.equal(far.t, far.last, 'beyond the run snaps to the last step');

  // formatHash always lands on a real step, and never on a reserved name
  const sweep = await page.eval(`(async () => {
    const { store } = __wse; const bad = [];
    for (const view of ['np','nh','gl','wm']) for (let m = 0; m < 12; m++) for (const t of [0, 5.3, 17, 47.9, 359]) {
      store.set({ view, lens: 'zjsarc'[m % 6], overlays: { jetline: m >= 6 }, t, focus: null });
      const h = L.formatHash(store.get());
      if (!C.HASH_RE.test(h.slice(1)) || C.isReservedHash(h.slice(1)) || !L.parseHash(h)) bad.push(h);
    }
    return bad;
  })()`);
  assert.deepEqual(sweep, []);

  // MET-11: a deep link is read against the dataset it opens on. On the sample, #np-j-2017090600 is Irma (case B): no snap
  // notice and t = 12, not a snap against case A's January 2017 times.
  if (fixture === 'sample-min') {
    const irma = await page.eval(`(async () => {
      const { store } = __wse; store.set({ lens: 'z', t: 0 });
      document.getElementById('share-notice')?.setAttribute('hidden', '');
      const r = await L.applyHash('#np-j-2017090600'); const el = document.getElementById('share-notice');
      return { r, t: store.get().t, case: __wse.data.activeCase(), notice: el && !el.hidden ? el.textContent : null };
    })()`);
    assert.equal(irma.r.snapped, false, 'no snap: ' + JSON.stringify(irma));
    assert.equal(irma.notice, null, 'no snap notice');
    assert.equal(irma.t, 12); assert.equal(irma.case, 'B');
  }
  // old hashes still open: #np-zj-... is the pattern with the Jet outline overlay
  const old = await page.eval(`(async () => {
    const { store } = __wse; const t0 = __wse.data.fieldSteps('z500a')[0];
    const r = await L.applyHash('#np-zj-' + G.utcStamp(__wse.data.validTime(t0)));
    const s = store.get(); return { applied: r.applied, lens: s.lens ?? null, jet: s.overlays?.jetline ?? null };
  })()`);
  assert.equal(old.applied, true);
  assert.equal(old.lens, 'z'); assert.equal(old.jet, true);

  // reserved and foreign hashes are ignored and change nothing
  const reserved = await page.eval(`(async () => {
    const { store } = __wse; store.set({ view: 'gl' }); const res = [];
    for (const r of [...C.RESERVED_HASHES, 'comment-abc', 'debug', 'zzz']) {
      const a = await L.applyHash('#' + r); res.push([r, a.applied, store.get().view]);
    }
    return res;
  })()`);
  for (const [r, applied, view] of reserved) { assert.equal(applied, false, r); assert.equal(view, 'gl', r); }

  // mirroring into location.hash, at most twice a second, never over a reserved hash
  const mirror = await page.eval(`(async () => {
    const calls = []; const orig = history.replaceState.bind(history);
    history.replaceState = (a, b, u) => { calls.push([performance.now(), String(u)]); return orig(a, b, u); };
    const { store } = __wse; store.set({ view: 'np', lens: 'z', overlays: { jetline: false }, t: ${s0}, playing: false, focus: null });
    await L.installLinks();
    // a distinct state before and after the burst makes at least two writes certain whatever the timer phase
    store.set({ view: 'gl' }); await new Promise(r => setTimeout(r, 600));
    for (let i = 0; i < 40; i++) { store.set({ view: 'np', t: i % 2 ? ${s1} : ${s2} }); await new Promise(r => setTimeout(r, 40)); }
    store.set({ view: 'nh' });
    await new Promise(r => setTimeout(r, 700));
    const gaps = calls.slice(1).map((c, i) => c[0] - calls[i][0]);
    return { n: calls.length, minGap: Math.min(...gaps, 1e9), hash: location.hash, want: L.formatHash(store.get()) };
  })()`);
  assert.ok(mirror.n >= 2, 'hash was written');
  assert.ok(mirror.minGap >= 480, 'writes are at least ~500 ms apart, got ' + mirror.minGap);
  assert.equal(mirror.hash, mirror.want);

  // canonical link joins canonicalUrl and the hash (page cannot see its own URL when sandboxed)
  const p2 = await newPage();
  try {
    await p2.goto(baseUrl);
    await p2.waitFor('window.__wse && window.__wse.ready === true', { timeout: 15000 });
    const link = await p2.eval(`(async () => {
      const real = window.fetch.bind(window);
      window.fetch = (u, ...r) => String(u).includes('config.json')
        ? Promise.resolve(new Response(JSON.stringify({ canonicalUrl: 'https://example.test/app/' }), { headers: { 'content-type': 'application/json' } }))
        : real(u, ...r);
      const L2 = await import('./js/links.js');
      __wse.store.set({ view: 'gl', t: ${s1}, focus: null, lens: 'z', overlays: { jetline: false } });
      return L2.linkText();
    })()`);
    assert.equal(link, 'https://example.test/app/#gl-z-' + await stamp(s1));
  } finally { await p2.close(); }
  assert.deepEqual(page.errors(), [], JSON.stringify(page.errors()));
}
