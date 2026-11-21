// S-SHARE (W4-07): PNG 1080 x 1350 with headline, valid time, the one provenance label, confidence, the stepped legend (title, edges,
// ridge and trough words) and footer drawn, for the lens and ground the screen shows and with its rotation; GIF starts GIF89a with the
// expected frame count and delays; delivery per host never downloads; the share sheet is the one sheet; "Copied" is said only after the
// clipboard promise resolved, and a blocked clipboard shows the link to select and copy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const id = 'S-SHARE';
export const freshProfile = false;
export const timeoutMs = 120000;

// Every site script (relative to site/js), so the no-download scan covers the whole app, not one folder.
const JS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../site/js');
const walk = (d, rel = '') => fs.readdirSync(path.join(d, rel), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(d, path.join(rel, e.name)) : e.name.endsWith('.js') ? [path.join(rel, e.name)] : []);
const SCRIPT_FILES = walk(JS_ROOT).sort();

// A renderer double that draws a flat field and calls overlays like WP2's renderTo does. The real renderer is
// exercised in integration; this check is about the share frame.
const FAKE = `
  window.__calls = [];
  const fake = { getTransform() { return window.__xf || { k: 1, tx: 0, ty: 0, rot: [0, 0, 0] }; }, renderTo(ctx, o) {
    window.__calls.push({ w: o.width, h: o.height, t: o.t, view: o.view, centre: o.centre, lens: o.lens, ground: o.ground, theme: o.theme, xf: o.xf });
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
    __wse.store.set({ view: 'np', lens: 'z', t: 12, speed: 12, playing: false, theme: 'dark',
      focus: { lat: 37.77, lon: -122.42, label: 'San Francisco', kind: 'place', placeRef: 5391959 } });
    return true; })()`);

  const man = await page.eval(`fetch('data/manifest.json').then(r => r.json())`);
  const steps = await page.eval(`__wse.data.fieldSteps('z500a')`);
  const isSample = man.sample === true; // sample data names a case and a banner; live data does not
  const caseLabel = isSample ? man.cases[await page.eval(`__wse.data.activeCase()`)].label : '';
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
  const legendRun = await page.eval(`document.querySelector('.mlg-run')?.textContent.trim()`);
  if (isSample) {
    assert.ok(still.drawn.includes(legendRun), 'the sample banner is the legend run line, string for string: ' + legendRun);
    assert.equal(still.drawn.filter((x) => x === legendRun).length, 1, 'the provenance label is drawn once');
    assert.ok(!/Model run|Sample case/.test(text), 'a sample frame must not say Model run');
    has(/Pattern confidence: not meaningful for sample data|Pattern: (confident|fairly sure of the timing|timing uncertain)|Pattern only, not specifics|No clear signal yet/, 'confidence (sample)');
  } else {
    assert.ok(!/SAMPLE DATA|Sample case/.test(text), 'a live frame carries no sample banner');
    assert.ok(still.drawn.includes(legendRun), 'the run line is the legend run line: ' + legendRun);
    has(/Pattern: (confident|fairly sure of the timing|timing uncertain)|Pattern only, not specifics|No clear signal yet/, 'confidence (live)');
  }
  has(/Pressure pattern aloft, vs normal/, 'the lens title on the stepped legend');
  assert.ok(still.drawn.includes('lower: trough') && still.drawn.includes('higher: ridge'), 'trough and ridge words under the bar');
  assert.ok(['\u221210', '\u22122', '+2', '+10'].every((t) => still.drawn.includes(t)), 'the countable edges are labelled: ' + still.drawn.filter((x) => /^[+\u2212]\d+$/.test(x)).join(' '));
  assert.ok(!/usually unsettled|usually settled/.test(text), 'the retired words settled and unsettled appear nowhere');
  has(/Model output, not an official forecast/, 'footer');
  has(new RegExp('anomaly vs ' + esc(man.climatology.label)), 'climatology in footer');
  has(/You are here: San Francisco/, 'you are here');
  assert.ok(still.drawn.filter((s) => s === 'San Francisco').length >= 1, 'ring label drawn by the map overlay');
  assert.equal(still.meta.headline, still.drawn.find((s) => s.startsWith('San Francisco ·')), 'lastShareMeta matches what is drawn');
  assert.equal(still.call.w, 1080);
  assert.equal(still.call.t, 12);
  assert.deepEqual(still.call.centre, { lat: 37.77, lon: -122.42 });
  assert.equal(still.call.xf, undefined, 'an unmoved map is framed on the place');

  // the lens, the ground and the rotation are the screen's: store.lens wins over the layer flags, Paper draws the light frame, a rotated globe keeps its rotation
  const look = await page.eval(`(async () => {
    window.__xf = { k: 1, tx: 0, ty: 0, rot: [40, -10, 0] };
    __wse.store.set({ lens: 'j', ground: 'paper', view: 'gl' });
    window.__drawn = [];
    await S.exportStill({});
    const out = { drawn: window.__drawn.slice(), call: window.__calls.at(-1), meta: S.shareMeta(__wse.store.get()) };
    window.__xf = null; __wse.store.set({ lens: undefined, ground: undefined, view: 'np' }); return out;
  })()`);
  assert.equal(look.call.lens, 'j'); assert.equal(look.call.ground, 'paper'); assert.equal(look.call.theme, 'light');
  assert.deepEqual(look.call.xf.rot, [40, -10, 0], 'a rotated view keeps its rotation');
  assert.equal(look.call.centre, null, 'a moved map is not re-centred');
  assert.ok(look.drawn.includes('Jet stream wind speed'), 'the jet legend title, though the layer flags say pattern: ' + look.drawn.slice(0, 20).join(' | '));
  assert.ok(!look.drawn.includes('Pressure pattern aloft, vs normal'));
  assert.equal(look.meta.ground, 'paper'); assert.equal(look.meta.lens, 'j');

  // World (W4-10): a share of the flat map is drawn in the World view and says so
  const world = await page.eval(`(async () => {
    __wse.store.set({ lens: 'z', view: 'wm' }); window.__drawn = [];
    await S.exportStill({});
    const out = { drawn: window.__drawn.slice(), call: window.__calls.at(-1), meta: S.shareMeta(__wse.store.get()) };
    __wse.store.set({ view: 'np' }); return out;
  })()`);
  assert.equal(world.call.view, 'wm', 'the still is rendered in the World view');
  assert.equal(world.meta.region, 'World');

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
    __wse.store.set({ t: 6, speed: 12 });
    const prog = [];
    const blob = await S.exportLoop({ from: 0, to: 12, onProgress: (f) => prog.push(f) });
    const u8 = new Uint8Array(await blob.arrayBuffer());
    return { type: blob.type, bytes: Array.from(u8), prog, drawn: window.__drawn.slice() };
  })()`);
  assert.ok(gif.drawn.filter((x) => x === 'Pressure pattern aloft, vs normal').length >= 13, 'every GIF frame carries the stepped legend title');
  assert.ok(gif.drawn.filter((x) => x === 'higher: ridge').length >= 13, 'every GIF frame carries the ridge word');
  const g = parseGif(gif.bytes);
  assert.equal(gif.type, 'image/gif');
  assert.equal(g.header, 'GIF89a');
  assert.equal(g.width, 720);
  assert.equal(g.frames.length, 13, '12 h at 12 h/s and 12 fps is one frame per hour: 13 frames, saw ' + g.frames.length + ' at ' + g.width);
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

  // ---- the header Share button opens the one sheet (ui/sheet.js) with image, loop and link; playback pauses on open; tabs keep the sheet
  const tabsUi = await page.eval(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    __wse.store.set({ playing: true });
    document.getElementById('btn-share').click();
    await wait(600);
    const sheet = document.querySelector('.wse-sheet');
    const out = { playing: __wse.store.get().playing, onOneSheet: !!sheet && sheet.getAttribute('role') === 'dialog', title: document.querySelector('.wse-sheet-title')?.textContent,
      tabs: [...document.querySelectorAll('.share-tab')].map((b) => b.textContent + ':' + b.getAttribute('aria-pressed')), oldSheet: !!document.querySelector('.share-sheet, .share-card') };
    document.querySelector('.share-tab[data-kind="loop"]').click();
    await wait(200);
    out.loopTitle = document.querySelector('.wse-sheet-title')?.textContent; out.sameSheet = document.querySelector('.wse-sheet') === sheet;
    document.querySelector('.share-tab[data-kind="link"]').click();
    for (let i = 0; i < 40 && !document.querySelector('.share-link')?.value; i++) await wait(50);
    out.linkTitle = document.querySelector('.wse-sheet-title')?.textContent; out.linkValue = document.querySelector('.share-link')?.value;
    out.people = document.querySelector('.share-people')?.textContent;
    document.querySelector('.wse-sheet-close').click();
    await wait(400);
    out.closed = !document.querySelector('.wse-sheet');
    return out;
  })()`);
  assert.equal(tabsUi.playing, false, 'opening the share sheet pauses the loop');
  assert.equal(tabsUi.onOneSheet, true, 'the share sheet is the one sheet'); assert.equal(tabsUi.oldSheet, false, 'no second modal');
  assert.deepEqual(tabsUi.tabs, ['Image:true', 'Loop:false', 'Link:false']);
  assert.equal(tabsUi.loopTitle, 'Share a loop'); assert.equal(tabsUi.linkTitle, 'Share a link'); assert.equal(tabsUi.sameSheet, true, 'switching tabs keeps the sheet');
  assert.match(tabsUi.linkValue || '', /#np-z-2\d{9}/, 'link tab shows the link: ' + tabsUi.linkValue);
  assert.match(tabsUi.people || '', /never include people/, 'the link tab says links never include people');
  assert.equal(tabsUi.closed, true);

  // ---- copy says "Copied" only after the clipboard promise resolved; a blocked clipboard shows the link selected, to copy by hand
  const clip = await page.eval(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const status = () => document.querySelector('.share-status')?.textContent || '';
    const out = {};
    const open = async () => { const { bus } = await import('./js/state.js'); bus.emit('share:open', { kind: 'link' });
      for (let i = 0; i < 60 && !document.querySelector('.share-link')?.value; i++) await wait(50); };
    const copyBtn = () => [...document.querySelectorAll('.wse-sheet-btn')].find((b) => b.textContent === 'Copy link');
    const closeIt = async () => { document.querySelector('.wse-sheet-close')?.click(); await wait(350); };
    // 1. a slow clipboard: not "Copied" while the promise is pending
    let release; const writes = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { writes.push(t); return new Promise((r) => { release = r; }); } }, configurable: true });
    await open(); copyBtn().click(); await wait(100);
    out.pending = status(); release(); await wait(100); out.resolved = status(); out.written = writes[0] === document.querySelector('.share-link').value;
    await closeIt();
    // 2. a denied clipboard (the artifact sandbox): no "Copied", the link is selected, and the sheet says to select and copy
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) }, configurable: true });
    const execs = []; const oe = document.execCommand; document.execCommand = (...a) => { execs.push(a[0]); return true; };
    await open(); copyBtn().click(); await wait(200);
    const f = document.querySelector('.share-link');
    out.deniedStatus = status(); out.hint = document.querySelector('.share-select')?.textContent || ''; out.hintVisible = !document.querySelector('.share-select')?.hidden;
    out.selected = f.selectionStart === 0 && f.selectionEnd === f.value.length && f.value.length > 0 && document.activeElement === f; out.execs = execs;
    document.execCommand = oe; await closeIt();
    // 3. no clipboard at all
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await open(); copyBtn().click(); await wait(150); out.noneStatus = status(); await closeIt();
    // 4. a person in focus: the copy says links never include people
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
    const keep = __wse.store.get().focus;
    __wse.store.set({ focus: { lat: 40.7, lon: -74, label: 'New York', kind: 'person' } });
    await open(); const lv = document.querySelector('.share-link').value; copyBtn().click(); await wait(150); out.personStatus = status(); out.personLink = lv;
    __wse.store.set({ focus: keep }); await closeIt();
    delete navigator.clipboard;
    return out;
  })()`);
  assert.ok(!/copied/i.test(clip.pending), 'a pending clipboard write is not "Copied": ' + clip.pending);
  assert.match(clip.resolved, /^Copied/, 'Copied once the clipboard resolved: ' + clip.resolved);
  assert.equal(clip.written, true, 'the text written is the link in the field');
  assert.ok(!/copied/i.test(clip.deniedStatus), 'a denied clipboard never says Copied: ' + clip.deniedStatus);
  assert.match(clip.hint, /Select and copy/); assert.equal(clip.hintVisible, true);
  assert.equal(clip.selected, true, 'the link is selected in its field');
  assert.deepEqual(clip.execs, [], 'no document.execCommand fallback that could report a copy that did not happen');
  assert.ok(!/copied/i.test(clip.noneStatus), 'no clipboard: not "Copied"');
  assert.match(clip.personStatus, /^Copied/); assert.match(clip.personStatus, /never include people/, 'person-focused copy says so: ' + clip.personStatus);
  // only the part after the host: the test server's port is random and may contain "74"
  const linkTail = clip.personLink.replace(/^[a-z]+:\/\/[^/]*/i, '');
  assert.ok(!/york|40\.7|-74|74\.0/i.test(linkTail), 'a person-focused link carries no place: ' + clip.personLink);

  // ---- the sheet is tall enough to show what it says (W4-07 round 2): the link field, the people note and the status after a copy each
  // sit inside the visible rect of the sheet body, on a fresh Link open, after Image -> Link, and with the Loop tab opened fresh; phone and desktop
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    await page.setViewport(w, h, 1);
    const vis = await page.eval(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const { bus } = await import('./js/state.js');
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
      const keep = __wse.store.get().focus;
      __wse.store.set({ focus: { lat: 40.7, lon: -74, label: 'New York', kind: 'person' } });
      // inside: the element's whole box lies in the body's visible rect (the body scrolls, so a clipped element is outside it)
      const inside = (sel) => { const e = document.querySelector(sel), b = document.querySelector('.wse-sheet-body'); if (!e || !b) return sel + ': missing';
        const r = e.getBoundingClientRect(), v = b.getBoundingClientRect(); return r.height > 0 && r.top >= v.top - 0.5 && r.bottom <= v.bottom + 0.5 ? 'ok' : sel + ': box ' + Math.round(r.top) + '-' + Math.round(r.bottom) + ' outside body ' + Math.round(v.top) + '-' + Math.round(v.bottom); };
      const settle = async () => { await wait(450); };
      const out = {};
      const checkLink = async (name) => {
        for (let i = 0; i < 60 && !document.querySelector('.share-link')?.value; i++) await wait(50);
        await settle();
        out[name + '.field'] = inside('.share-link'); out[name + '.note'] = inside('.share-people');
        [...document.querySelectorAll('.wse-sheet-btn')].find((b) => b.textContent === 'Copy link').click();
        await wait(200); await settle();
        out[name + '.status'] = /^Copied/.test(document.querySelector('.share-status').textContent) ? inside('.share-status') : 'status is not Copied: ' + document.querySelector('.share-status').textContent;
      };
      bus.emit('share:open', { kind: 'link' }); await checkLink('fresh');
      document.querySelector('.wse-sheet-close').click(); await wait(400);
      bus.emit('share:open', { kind: 'still' });
      for (let i = 0; i < 100 && !document.querySelector('.share-preview img'); i++) await wait(50);
      document.querySelector('.share-tab[data-kind="link"]').click(); await checkLink('switched');
      document.querySelector('.wse-sheet-close').click(); await wait(400);
      bus.emit('share:open', { kind: 'loop' }); await settle();
      const sb = document.querySelector('.wse-sheet-body');
      out.loopFits = sb.scrollHeight <= sb.clientHeight + 1 ? 'ok' : 'loop body clips: client ' + sb.clientHeight + ' scroll ' + sb.scrollHeight;
      out.loopNote = inside('.share-note');
      document.querySelector('.wse-sheet-close').click(); await wait(400);
      __wse.store.set({ focus: keep }); delete navigator.clipboard;
      return out;
    })()`);
    for (const [k, v] of Object.entries(vis)) assert.equal(v, 'ok', `${w}x${h}: ${k}: ${v}`);
  }
  await page.setViewport(1280, 800, 1);

  // ---- delivery per host: never a download
  const del = await page.eval(`(async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const out = { downloads: [] };
    const origClick = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { out.downloads.push(this.download || this.href); };
    const origCreate = URL.createObjectURL; out.navigations = 0;
    const origAssign = window.open; window.open = () => { out.navigations++; return null; };
    // off the artifact, no Web Share: the picture goes on the page, nothing is downloaded
    delete window.claude; D._resetDeliver();
    out.off = await D.deliver(blob, 'a.png'); out.offImg = !!document.querySelector('.share-inline img'); document.querySelector('.share-inline button')?.click();
    // into a host element (the sheet)
    const host = document.createElement('div'); document.body.append(host);
    out.hosted = await D.deliver(blob, 'a.png', { host }); out.hostedImg = !!host.querySelector('img'); host.remove();
    // off the artifact with Web Share
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', { value: async () => {}, configurable: true });
    out.shared = await D.deliver(blob, 'a.png');
    Object.defineProperty(navigator, 'share', { value: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); }, configurable: true });
    out.shareCancel = await D.deliver(blob, 'a.png');
    Object.defineProperty(navigator, 'share', { value: async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); }, configurable: true });
    out.shareBlocked = await D.deliver(blob, 'a.png'); document.querySelector('.share-inline button')?.click();
    delete navigator.canShare; delete navigator.share;
    // artifact with downloads
    const saves = [];
    window.claude = { use: async (n) => n === 'downloads' ? { save: async (r) => { saves.push([r.filename, r.data === blob]); return { status: 'saved' }; } } : null };
    D._resetDeliver(); out.saved = await D.deliver(blob, 'b.png'); out.saves = saves;
    window.claude = { use: async () => ({ save: async () => { throw { code: 'declined', message: 'no' }; } }) };
    D._resetDeliver(); out.declined = await D.deliver(blob, 'b.png');
    window.claude = { use: async () => ({ save: async () => { throw { code: 'too_large', message: 'big' }; } }) };
    D._resetDeliver(); try { await D.deliver(blob, 'b.png'); out.big = 'resolved'; } catch (e) { out.big = e.code; }
    // artifact without the capability: inline, and Web Share is not tried
    window.claude = { use: async () => null };
    D._resetDeliver(); out.inline = await D.deliver(blob, 'c.png');
    out.inlineImg = !!document.querySelector('.share-inline img');
    document.querySelector('.share-inline')?.remove();
    HTMLAnchorElement.prototype.click = origClick; window.open = origAssign; delete window.claude;
    return out;
  })()`);
  assert.equal(del.off, 'inline'); assert.equal(del.offImg, true, 'the picture is on the page to press and hold');
  assert.equal(del.hosted, 'inline'); assert.equal(del.hostedImg, true);
  assert.deepEqual(del.downloads, [], 'no <a download> or blob link was ever clicked');
  assert.equal(del.navigations, 0);
  assert.equal(del.shared, 'shared'); assert.equal(del.shareCancel, 'declined'); assert.equal(del.shareBlocked, 'inline');
  assert.equal(del.saved, 'saved'); assert.deepEqual(del.saves, [['b.png', true]]);
  assert.equal(del.declined, 'declined'); assert.equal(del.big, 'too_large');
  assert.equal(del.inline, 'inline'); assert.equal(del.inlineImg, true);
  // every script the page can load: the share files and the whole of site/js (the pins CSV fallback once created a blob <a download>)
  const files = await page.eval(`fetch('js/contract.js').then(() => Promise.all(${JSON.stringify(SCRIPT_FILES)}.map((f) => fetch('js/' + f).then((r) => r.ok ? r.text() : ''))))`);
  const bad = files.map((t, i) => [SCRIPT_FILES[i], t.replace(/\/\/.*$/gm, '')]).filter(([, t]) => /\.download\s*=|\bdownload\s*:|createElement\(['"]a['"]\)|createObjectURL\([^)]*\)\s*[,}]\s*download|<a\b[^>]*download/.test(t)).map(([f]) => f);
  assert.deepEqual(bad, [], 'no code path in site/js creates an <a download> or navigates to a blob (files: ' + bad.join(', ') + ')');
  assert.ok(files.filter(Boolean).length >= SCRIPT_FILES.length - 2, 'the scan read the scripts (' + files.filter(Boolean).length + ' of ' + SCRIPT_FILES.length + ')');

  // ---- the sheet opens from bus 'share:open' and from data-share, and makes an image
  const sheet = await page.eval(`(async () => {
    const S2 = await import('./js/share/sheet.js'); S2.installShareSheet();
    const { bus } = await import('./js/state.js');
    bus.emit('share:open', { kind: 'still' });
    await new Promise(r => { const i = setInterval(() => { if (document.querySelector('.share-preview img')) { clearInterval(i); r(); } }, 50); setTimeout(r, 8000); });
    const out = { dialog: !!document.querySelector('.wse-sheet[role=dialog]'), img: !!document.querySelector('.share-preview img'),
      headline: document.querySelector('.share-headline')?.value, save: [...document.querySelectorAll('.wse-sheet-btn')].map(b => b.textContent) };
    S2.closeShare(); await new Promise((r) => setTimeout(r, 400));
    out.closed = !document.querySelector('.wse-sheet');
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
