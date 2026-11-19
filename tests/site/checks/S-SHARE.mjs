// S-SHARE: PNG 1080 x 1350 with headline, valid time, run, confidence, word legend and footer drawn;
// GIF starts GIF89a with the expected frame count and delays; delivery per host.
export const id = 'S-SHARE';
export const freshProfile = false;
export const timeoutMs = 120000;

// A renderer double that draws a flat field and calls overlays like WP2's renderTo does. The real renderer is
// exercised in integration; this check is about the share frame.
const FAKE = `
  window.__calls = [];
  const fake = { renderTo(ctx, o) {
    window.__calls.push({ w: o.width, h: o.height, t: o.t, view: o.view, centre: o.centre });
    const g = ctx.createLinearGradient(0, 0, o.width, 0); g.addColorStop(0, '#2B4260'); g.addColorStop(1, '#58391D');
    ctx.fillStyle = g; ctx.fillRect(0, 0, o.width, o.height);
    const project = ([lon, lat]) => [o.width / 2 + (lon + 122.42) * 4, o.height / 2 - (lat - 37.77) * 4];
    for (const ov of o.overlays || []) ov(ctx, project, {});
  } };
  const F = await import('./js/share/facade.js'); F.setRenderer(fake);
`;
// Records every string drawn with fillText, from any canvas.
const SPY = `
  window.__drawn = [];
  if (!window.__spied) { window.__spied = true; const o = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (s, ...r) { window.__drawn.push(String(s)); return o.call(this, s, ...r); };
    const p = OffscreenCanvasRenderingContext2D.prototype.fillText;
    OffscreenCanvasRenderingContext2D.prototype.fillText = function (s, ...r) { window.__drawn.push(String(s)); return p.call(this, s, ...r); }; }
`;

export async function run({ page, baseUrl, assert }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 15000 });
  await page.eval(`(async () => { ${FAKE} ${SPY}
    window.S = await import('./js/share/index.js'); window.X = await import('./js/share/export.js'); window.D = await import('./js/share/deliver.js');
    (await import('./js/time/clock.js')).pause();
    __wse.store.set({ view: 'np', layers: { z: true, j: false, c: false, t: false }, t: 12, speed: 12, playing: false, theme: 'dark',
      focus: { lat: 37.77, lon: -122.42, label: 'San Francisco', kind: 'place', placeRef: 5391959 } });
    return true; })()`);

  const man = await page.eval(`fetch('data/manifest.json').then(r => r.json())`);
  const steps = await page.eval(`__wse.data.fieldSteps('z500a')`);
  const isSample = man.sample === true; // sample data names a case and a banner; live data does not
  const caseLabel = isSample ? man.cases[await page.eval(`__wse.store.get().case`)].label : '';
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ---- PNG still
  const still = await page.eval(`(async () => {
    window.__drawn = [];
    const blob = await S.exportStill({});
    const bmp = await createImageBitmap(blob);
    const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    return { type: blob.type, w: bmp.width, h: bmp.height, png: Array.from(head), drawn: window.__drawn.slice(), meta: __wse.lastShareMeta, call: window.__calls.at(-1) };
  })()`);
  assert.equal(still.type, 'image/png');
  assert.deepEqual(still.png, [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
  assert.equal(still.w, 1080);
  assert.equal(still.h, 1350);
  const text = still.drawn.join(' ');
  const has = (re, what) => assert.match(text, re, 'drawn text lacks ' + what + ': ' + text.slice(0, 600));
  has(isSample ? /San Francisco · \w{3} \d{1,2} \w{3} \d{4}/ : /San Francisco · \w{3} \d{1,2} \w{3}/, 'headline');
  has(/\(\d\d(:\d\d)?Z\)/, 'valid time with UTC');
  // a sample is real past data: the frame names the case, and never prints a rebased run time as if it were a model run
  if (isSample) {
    has(new RegExp('Sample case: ' + esc(caseLabel)), 'sample case line');
    assert.ok(!/Model run/.test(text), 'a sample frame must not say Model run');
    has(/Pattern confidence: not meaningful for sample data/, 'confidence (sample)');
  } else {
    assert.ok(!/SAMPLE DATA|Sample case/.test(text), 'a live frame carries no sample banner');
    has(/Pattern: (confident|fairly sure of the timing|timing uncertain)/, 'confidence (live)');
  }
  has(/Blue: lower pressure aloft, usually unsettled\. Amber: higher, usually settled\./, 'word legend');
  has(/500 hPa height vs normal \(dam\)/, 'a title on the colour bar');
  has(/Model output, not an official forecast/, 'footer');
  has(new RegExp('anomaly vs ' + esc(man.climatology.label)), 'climatology in footer');
  if (isSample) has(new RegExp('SAMPLE DATA \u00b7 ' + esc(caseLabel) + ' \u00b7 not a forecast'), 'sample banner');
  has(/You are here: San Francisco/, 'you are here');
  assert.ok(still.drawn.filter((s) => s === 'San Francisco').length >= 1, 'ring label drawn by the map overlay');
  assert.equal(still.meta.headline, still.drawn.find((s) => s.startsWith('San Francisco ·')), 'lastShareMeta matches what is drawn');
  assert.equal(still.call.w, 1080);
  assert.equal(still.call.t, 12);
  assert.deepEqual(still.call.centre, { lat: 37.77, lon: -122.42 });

  // live (non-sample) meta carries a real confidence word and no sample banner
  const live = await page.eval(`(() => { const m = S.shareMeta({ ...__wse.store.get(), sample: false }); return { c: m.confidence, b: m.sampleBanner, s: m.sample }; })()`);
  assert.match(live.c, /^Pattern: (confident|fairly sure of the timing|timing uncertain)$/);
  assert.equal(live.b, '');
  assert.equal(live.s, false);

  // custom headline replaces the default; person-safe default has no pin name
  const custom = await page.eval(`(async () => { window.__drawn = []; await S.exportStill({ headline: 'Dry weekend ahead' }); return window.__drawn.slice(); })()`);
  assert.ok(custom.includes('Dry weekend ahead'));
  assert.ok(!custom.some((s) => s.startsWith('San Francisco ·')));

  // ---- GIF
  const gif = await page.eval(`(async () => {
    window.__drawn = [];
    __wse.store.set({ t: 6 });
    const prog = [];
    const blob = await S.exportLoop({ from: 0, to: 12, onProgress: (f) => prog.push(f) });
    const u8 = new Uint8Array(await blob.arrayBuffer());
    return { type: blob.type, bytes: Array.from(u8), prog, drawn: window.__drawn.slice() };
  })()`);
  assert.ok(gif.drawn.some((x) => /^Blue: lower pressure aloft, usually unsettled\. Amber: higher, usually settled\.$/.test(x)), 'every GIF frame carries the word legend');
  const g = parseGif(gif.bytes);
  assert.equal(gif.type, 'image/gif');
  assert.equal(g.header, 'GIF89a');
  assert.equal(g.width, 720);
  assert.equal(g.frames.length, 13, '12 h at 12 h/s and 12 fps is one frame per hour: 13 frames');
  assert.equal(g.loop, true, 'NETSCAPE loop block');
  const holdIdx = 6; // t = 6 h
  assert.equal(g.frames[holdIdx].delay, 100, 'focused moment holds 1 s: ' + JSON.stringify(g.frames.map((f) => f.delay)));
  assert.equal(g.frames[12].delay, 8 + 70, 'last frame: normal delay plus 0.7 s');
  assert.equal(g.frames[3].delay, 8);
  assert.ok(gif.prog.length >= 13 && gif.prog.at(-1) === 1, 'progress reported');
  assert.ok(gif.prog.every((v, i, a) => !i || v >= a[i - 1]), 'progress never goes back');

  // a byte limit smaller than the first ten frames drops to 540 px
  const small = await page.eval(`(async () => { const b = await S.exportLoop({ from: 0, to: 4, byteLimit: 1 });
    return { head: Array.from(new Uint8Array(await b.slice(0, 10).arrayBuffer())) }; })()`);
  assert.equal(small.head[6] | (small.head[7] << 8), 540, 'size fallback to 540');

  // default range: run start to one day past the focused day, inside the steps
  const range = await page.eval(`(() => ({ r: X.defaultRange(__wse.store.get(), 'z500a'), f: X.frameTimes(0, 36, 12).length, f2: X.frameTimes(0, 168, 12).length }))()`);
  const last = steps.at(-1);
  assert.deepEqual(range.r, { from: steps[0], to: Math.min(48, last) });
  assert.equal(range.f, 37);
  assert.equal(range.f2, 96, 'frame count is capped');

  // cancel
  const cancelled = await page.eval(`(async () => {
    const ac = new AbortController();
    try { await S.exportLoop({ from: 0, to: 24, signal: ac.signal, onProgress: (f) => { if (f > 0.1) ac.abort(); } }); return 'finished'; }
    catch (e) { return e.name; }
  })()`);
  assert.equal(cancelled, 'AbortError');

  // ---- the header Share button opens one sheet with image, loop and link; playback pauses on open
  const tabsUi = await page.eval(`(async () => {
    __wse.store.set({ playing: true });
    document.getElementById('btn-share').click();
    await new Promise((r) => setTimeout(r, 600));
    const out = { playing: __wse.store.get().playing, title: document.querySelector('.share-title')?.textContent,
      tabs: [...document.querySelectorAll('.share-tab')].map((b) => b.textContent + ':' + b.getAttribute('aria-pressed')) };
    document.querySelector('.share-tab[data-kind="loop"]').click();
    await new Promise((r) => setTimeout(r, 200));
    out.loopTitle = document.querySelector('.share-title')?.textContent;
    document.querySelector('.share-tab[data-kind="link"]').click();
    for (let i = 0; i < 40 && !document.querySelector('.share-sheet input[readonly]')?.value; i++) await new Promise((r) => setTimeout(r, 50));
    out.linkTitle = document.querySelector('.share-title')?.textContent; out.linkValue = document.querySelector('.share-sheet input[readonly]')?.value;
    document.querySelector('.share-close').click();
    return out;
  })()`);
  assert.equal(tabsUi.playing, false, 'opening the share sheet pauses the loop');
  assert.deepEqual(tabsUi.tabs, ['Image:true', 'Loop:false', 'Link:false']);
  assert.equal(tabsUi.loopTitle, 'Share a loop'); assert.equal(tabsUi.linkTitle, 'Share a link');
  assert.match(tabsUi.linkValue || '', /#np-z-2\d{9}/, 'link tab shows the link: ' + tabsUi.linkValue);

  // ---- delivery per host
  const del = await page.eval(`(async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const out = {};
    const clicks = []; const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { clicks.push(this.download); };
    // off the artifact, no Web Share: <a download>
    delete window.claude; D._resetDeliver();
    out.off = await D.deliver(blob, 'a.png'); out.clicks = clicks.slice();
    // off the artifact with Web Share
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', { value: async () => {}, configurable: true });
    out.shared = await D.deliver(blob, 'a.png');
    Object.defineProperty(navigator, 'share', { value: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); }, configurable: true });
    out.shareCancel = await D.deliver(blob, 'a.png');
    delete navigator.canShare; delete navigator.share;
    // artifact with downloads
    const saves = [];
    window.claude = { use: async (n) => n === 'downloads' ? { save: async (r) => { saves.push([r.filename, r.data === blob]); return { status: 'saved' }; } } : null };
    D._resetDeliver(); out.saved = await D.deliver(blob, 'b.png'); out.saves = saves;
    window.claude = { use: async () => ({ save: async () => { throw { code: 'declined', message: 'no' }; } }) };
    D._resetDeliver(); out.declined = await D.deliver(blob, 'b.png');
    window.claude = { use: async () => ({ save: async () => { throw { code: 'too_large', message: 'big' }; } }) };
    D._resetDeliver(); try { await D.deliver(blob, 'b.png'); out.big = 'resolved'; } catch (e) { out.big = e.code; }
    // artifact without the capability: inline
    window.claude = { use: async () => null };
    D._resetDeliver(); out.inline = await D.deliver(blob, 'c.png');
    out.inlineImg = !!document.querySelector('.share-inline img');
    document.querySelector('.share-inline')?.remove();
    HTMLAnchorElement.prototype.click = origClick; delete window.claude;
    return out;
  })()`);
  assert.equal(del.off, 'downloaded');
  assert.deepEqual(del.clicks, ['a.png']);
  assert.equal(del.shared, 'shared');
  assert.equal(del.shareCancel, 'declined');
  assert.equal(del.saved, 'saved');
  assert.deepEqual(del.saves, [['b.png', true]]);
  assert.equal(del.declined, 'declined');
  assert.equal(del.big, 'too_large');
  assert.equal(del.inline, 'inline');
  assert.equal(del.inlineImg, true);

  // ---- the sheet opens from bus 'share:open' and from data-share, and makes an image
  const sheet = await page.eval(`(async () => {
    const S2 = await import('./js/share/sheet.js'); S2.installShareSheet();
    __wse.bus?.emit; const { bus } = await import('./js/state.js');
    bus.emit('share:open', { kind: 'still' });
    await new Promise(r => { const i = setInterval(() => { if (document.querySelector('.share-preview img')) { clearInterval(i); r(); } }, 50); setTimeout(r, 8000); });
    const out = { dialog: !!document.querySelector('.share-sheet[role=dialog]'), img: !!document.querySelector('.share-preview img'),
      headline: document.querySelector('.share-headline')?.value, save: [...document.querySelectorAll('.share-btn')].map(b => b.textContent) };
    S2.closeShare();
    out.closed = !document.querySelector('.share-sheet');
    return out;
  })()`);
  assert.equal(sheet.dialog, true);
  assert.equal(sheet.img, true, 'preview image appears');
  assert.match(sheet.headline, /^San Francisco · /);
  assert.ok(sheet.save.includes('Save'));
  assert.equal(sheet.closed, true);
  assert.deepEqual(page.errors(), [], JSON.stringify(page.errors()));
}

// Walk a GIF's blocks: header, logical screen, extensions, image descriptors. Returns frame delays in centiseconds.
function parseGif(arr) {
  const b = Uint8Array.from(arr);
  const header = String.fromCharCode(...b.slice(0, 6));
  const width = b[6] | (b[7] << 8);
  let p = 13;
  if (b[10] & 0x80) p += 3 * (1 << ((b[10] & 7) + 1));
  const frames = []; let loop = false, pendingDelay = 0;
  while (p < b.length) {
    const c = b[p];
    if (c === 0x3b) break;
    if (c === 0x21) {
      const label = b[p + 1]; p += 2;
      if (label === 0xf9) pendingDelay = b[p + 2] | (b[p + 3] << 8);
      if (label === 0xff && String.fromCharCode(...b.slice(p + 1, p + 12)) === 'NETSCAPE2.0') loop = true;
      while (b[p] !== 0) p += b[p] + 1; p++;
    } else if (c === 0x2c) {
      const flags = b[p + 9]; p += 10;
      if (flags & 0x80) p += 3 * (1 << ((flags & 7) + 1));
      p++; // LZW min code size
      while (b[p] !== 0) p += b[p] + 1; p++;
      frames.push({ delay: pendingDelay });
    } else throw new Error('bad GIF block ' + c + ' at ' + p);
  }
  return { header, width, frames, loop };
}
