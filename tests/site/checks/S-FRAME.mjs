// S-FRAME (W3-05, Josh point 9): Expand gives the map the whole viewport and Exit, Escape or F restores it. Normal page at desktop and
// phone size, and inside tests/site/pages/frame-host.html: a sandboxed iframe smaller than the window and without allowfullscreen,
// where native fullscreen cannot be used (REF-36). Real clicks, taps and key events (input.mjs); no state is set directly. At phone width
// sample data stays labelled on screen while expanded (the header that carries the label is hidden); live data is never labelled sample.
// W4-06 adds native fullscreen (expanded follows fullscreenchange, identical layout), the desktop divider (real mouse drag, keys, remembered
// width, double-click fold to a 44 px rail), the landscape phone side strip, and the canvas backing size after every such change.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as inp from '../lib/input.mjs';

export const id = 'S-FRAME';
export const freshProfile = true;
export const timeoutMs = 180000; // the native race cases (nativeRace) add about 25 s; a slower CI runner needs the margin

const here = path.dirname(fileURLToPath(import.meta.url));
const HOST = fs.readFileSync(path.join(here, '..', 'pages', 'frame-host.html'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wraps `ctx` so the same assertions run on the page itself and inside the iframe. */
function target(page, inFrame) {
  const win = inFrame ? `globalThis.document.getElementById('app-frame').contentWindow` : 'window';
  const ev = (expr) => page.eval(`(() => { const w = ${win}, document = w.document; return ${expr}; })()`);
  const centre = async (sel) => {
    const r = await ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    if (!inFrame) return { x: r[0], y: r[1] };
    const f = await page.eval(`(() => { const r = document.getElementById('app-frame').getBoundingClientRect(); return [r.left, r.top]; })()`);
    return { x: f[0] + r[0], y: f[1] + r[1] };
  };
  return { ev, centre };
}

async function exercise({ page, assert, phone, inFrame, label }) {
  const t = target(page, inFrame);
  const press = async (sel) => (phone ? inp.tap(page, await t.centre(sel)) : inp.click(page, await t.centre(sel)));
  const state = () => t.ev(`(() => {
    const app = document.getElementById('app'), m = document.getElementById('map').getBoundingClientRect(), btn = document.getElementById('btn-expand');
    const vis = (id) => { const e = document.getElementById(id); return !!e && e.getClientRects().length > 0; };
    return { expanded: app.hasAttribute('data-expanded'), vw: w.innerWidth, vh: w.innerHeight, left: m.left, top: m.top, width: m.width, height: m.height,
      // the map legend against the scrubber (rescue-2 review: expanded, the fixed scrubber covered the legend's foot, or all of it)
      legend: (() => { const L = document.getElementById('map-legend'), T = document.getElementById('timeline');
        if (!L || !T || L.getClientRects().length === 0 || T.getClientRects().length === 0) return null;
        const a = L.getBoundingClientRect(), b = T.getBoundingClientRect();
        const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)), oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        return { box: [a.left, a.top, a.right, a.bottom].map(Math.round), timeline: [b.left, b.top, b.right, b.bottom].map(Math.round), overlap: [Math.round(ox), Math.round(oy)] }; })(),
      btnText: btn ? btn.textContent.trim() : null, pressed: btn ? btn.getAttribute('aria-pressed') : null, topbar: vis('topbar'), home: vis('home'), tools: vis('map-tools'), timeline: vis('timeline'),
      // sample data is always labelled: an on-screen element (outside the hidden header) that says so, and nothing else drawn over it
      live: !(w.__wse && w.__wse.data.getManifest() && w.__wse.data.getManifest().sample),
      label: (() => {
        const els = [...document.querySelectorAll('#app *')].filter((e) => !e.closest('#topbar') && e.children.length === 0 && /\bsample\b|not live|recorded/i.test(e.textContent) && e.getClientRects().length > 0);
        for (const e of els) {
          const r = e.getBoundingClientRect(), cs = w.getComputedStyle(e);
          if (cs.visibility === 'hidden' || +cs.opacity === 0 || r.width < 4 || r.left < 0 || r.top < 0 || r.right > w.innerWidth || r.bottom > w.innerHeight) continue;
          // nothing the person uses lies over it or under it: buttons, the status line, toasts, the timeline, an open panel
          const hits = [...document.querySelectorAll('button, #map-status:not(:empty), .wse-toast, #timeline, #layers-panel:not([hidden])')].filter((o) => !o.contains(e) && !e.contains(o) && o.getClientRects().length > 0).filter((o) => {
            const q = o.getBoundingClientRect(); return q.width > 0 && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top;
          }).map((o) => o.id || o.className || o.tagName);
          // the box hugs its words: the width the text's lines take (a Range over it) against the box's content width; a wrapped label in
          // a pill kept at its max-width leaves an empty right half (round-4 review, about 100 px at 390 px)
          const rg = document.createRange(); rg.selectNodeContents(e);
          const lines = [...rg.getClientRects()].filter((q) => q.width > 0);
          const textW = lines.length ? Math.max(...lines.map((q) => q.right)) - Math.min(...lines.map((q) => q.left)) : 0;
          const contentW = r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
          return { text: e.textContent.trim(), box: [r.left, r.top, r.right, r.bottom].map(Math.round), hits, clear: hits.length === 0, slack: Math.round(contentW - textW) };
        }
        return null;
      })() };
  })()`);
  const full = (s, what) => {
    assert.ok(s.expanded, `${label}: ${what}: #app[data-expanded] set`);
    assert.deepEqual([Math.round(s.left), Math.round(s.top), Math.round(s.width), Math.round(s.height)], [0, 0, s.vw, s.vh], `${label}: ${what}: the map rect is the viewport`);
    assert.ok(!s.topbar && !s.home, `${label}: ${what}: header and story panel are hidden`);
    assert.ok(s.tools && s.timeline, `${label}: ${what}: map tools and timeline stay`);
    assert.equal(s.btnText, 'Exit', `${label}: ${what}: the button says Exit`);
    assert.ok(s.legend, `${label}: ${what}: the map legend is on screen while expanded`);
    assert.ok(s.legend.overlap[0] * s.legend.overlap[1] === 0, `${label}: ${what}: the map legend ${JSON.stringify(s.legend.box)} clears the scrubber ${JSON.stringify(s.legend.timeline)} (overlap ${s.legend.overlap.join('x')} px)`);
    assert.equal(s.pressed, 'true');
    // the header that carries the sample label is hidden; at phone width the legend is a one-line bar without one (the wide legend
    // draws its own on the canvas), so a label must be on screen; live data gets no such label
    if (phone && !s.live) assert.ok(s.label && s.label.clear, `${label}: ${what}: sample data is labelled on screen while expanded (found ${JSON.stringify(s.label)})`);
    if (phone && !s.live && s.label) console.log(`  S-FRAME ${label}: ${what}: label '${s.label.text}' box ${JSON.stringify(s.label.box)}, ${s.label.slack} px slack`);
    if (phone && !s.live && s.label) assert.ok(s.label.slack <= 4, `${label}: ${what}: the sample label's box hugs its words (${s.label.slack} px of empty pill beside the text: ${JSON.stringify(s.label)})`);
    if (s.live) assert.equal(s.label, null, `${label}: ${what}: live data carries no sample label (found ${JSON.stringify(s.label)})`);
  };
  const normal = (s, what) => {
    assert.ok(!s.expanded, `${label}: ${what}: not expanded`);
    assert.ok(s.topbar && s.home, `${label}: ${what}: header and story panel are back`);
    assert.ok(s.width < s.vw || s.height < s.vh, `${label}: ${what}: the map is smaller than the viewport again`);
    assert.equal(s.btnText, 'Expand', `${label}: ${what}: the button says Expand`);
  };
  const settle = async () => { await sleep(350); };

  assert.ok(await t.ev(`!!document.getElementById('btn-expand')`), `${label}: #btn-expand exists`);
  normal(await state(), 'before');
  assert.ok((await t.ev(`document.getElementById('btn-expand').getBoundingClientRect().height`)) >= 44, `${label}: the button is a 44 px target`);

  // the button
  await press('#btn-expand'); await settle();
  full(await state(), 'after the button');
  // the map really is drawn at the new size
  const sized = await t.ev(`(() => { const c = document.getElementById('map'); return c.width >= Math.round(c.clientWidth) && c.clientWidth === w.innerWidth; })()`);
  assert.ok(sized, `${label}: the canvas follows the new size`);
  await press('#btn-expand'); await settle();
  normal(await state(), 'after Exit');

  // F and Escape (the page has focus after the click above)
  await inp.key(page, null, 'f'); await settle();
  full(await state(), 'after F');
  await inp.key(page, null, 'Escape'); await settle();
  normal(await state(), 'after Escape');
  await inp.key(page, null, 'F', { modifiers: ['Shift'] }); await settle();
  full(await state(), 'after Shift+F');
  await inp.key(page, null, 'f'); await settle();
  normal(await state(), 'after F again');
  // Escape in the normal state does nothing
  await inp.key(page, null, 'Escape'); await settle();
  normal(await state(), 'Escape while not expanded');
}

/** Escape belongs to the topmost layer: with the Layers panel open in expanded mode it closes the panel only; a second Escape exits. */
async function escapeWithPanel({ page, assert, label }) {
  const st = () => page.eval(`({ exp: document.getElementById('app').hasAttribute('data-expanded'), layers: !document.getElementById('layers-panel').hidden })`);
  await inp.click(page, '#btn-expand'); await sleep(350);
  await inp.click(page, '#btn-layers'); await sleep(350);
  assert.deepEqual(await st(), { exp: true, layers: true }, `${label}: expanded with the Layers panel open`);
  await inp.key(page, null, 'Escape'); await sleep(350);
  assert.deepEqual(await st(), { exp: true, layers: false }, `${label}: the first Escape closes only the Layers panel`);
  await inp.key(page, null, 'Escape'); await sleep(350);
  assert.deepEqual(await st(), { exp: false, layers: false }, `${label}: the second Escape leaves expanded mode`);
}

/** Expanded at another desktop size (1024x768: the legend starts collapsed and the slim scrubber is taller than it): it clears the scrubber. */
async function legendClear({ page, assert, label }) {
  const m = () => page.eval(`(() => { const L = document.getElementById('map-legend'), T = document.getElementById('timeline');
    if (!L || L.getClientRects().length === 0) return null;
    const a = L.getBoundingClientRect(), b = T.getBoundingClientRect();
    return { box: [a.left, a.top, a.right, a.bottom].map(Math.round), timeline: [b.left, b.top, b.right, b.bottom].map(Math.round),
      overlap: Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) }; })()`);
  await inp.click(page, '#btn-expand'); await sleep(500);
  const r = await m();
  console.log(`  S-FRAME ${label}: expanded legend ${JSON.stringify(r?.box)} scrubber ${JSON.stringify(r?.timeline)}`);
  assert.ok(r, `${label}: the map legend is on screen while expanded`);
  assert.equal(r.overlap, 0, `${label}: the map legend ${JSON.stringify(r.box)} clears the scrubber ${JSON.stringify(r.timeline)} while expanded`);
  await inp.click(page, '#btn-expand'); await sleep(350);
}

/**
 * Expanded and playing at phone width: the sample chip is fitted once, not rewritten on every clock tick (rescue-2 review: 732 chip
 * mutations in 3 s, a forced layout per frame), and its full label, dataset name included, stays reachable by assistive technology
 * when the short form is drawn (a title on a pointer-events:none chip never shows).
 */
async function chipQuiet({ page, assert, label }) {
  await inp.tap(page, await page.eval(`(() => { const r = document.getElementById('btn-expand').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`));
  await page.waitFor(`document.getElementById('app').hasAttribute('data-expanded')`, { timeout: 3000 }); await sleep(400);
  const live = await page.eval(`!(window.__wse.data.getManifest() && window.__wse.data.getManifest().sample)`);
  if (live) { await inp.key(page, null, 'Escape'); await sleep(350); return; }
  await page.eval(`(() => { const c = document.getElementById('expanded-sample'); window.__chipMuts = 0; window.__chipSets = 0;
    window.__chipMo = new MutationObserver((l) => { window.__chipMuts += l.length; }); window.__chipMo.observe(c, { childList: true, characterData: true, subtree: true, attributes: true });
    window.__chipUn = window.__wse.store.subscribe((s, p) => { if ('t' in p) window.__chipSets++; }); })()`);
  await inp.tap(page, await page.eval(`(() => { const r = document.querySelector('#timeline .tl-play').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`));
  await sleep(1500);
  const r = await page.eval(`(() => { window.__chipMo.disconnect(); window.__chipUn && window.__chipUn();
    const c = document.getElementById('expanded-sample'), m = window.__wse.data.getManifest();
    return { muts: window.__chipMuts, ticks: window.__chipSets, text: c.textContent, playing: document.querySelector('#timeline .tl-play').getAttribute('aria-label') }; })()`);
  console.log(`  S-FRAME ${label}: playing ${r.ticks} clock ticks, ${r.muts} chip mutations, chip '${r.text}'`);
  assert.ok(r.ticks >= 10, `${label}: the clock played while expanded (${r.ticks} ticks)`);
  assert.equal(r.muts, 0, `${label}: the sample chip is not rewritten on clock ticks (${r.muts} mutations over ${r.ticks} ticks)`);
  // the full label is in the accessibility tree: some rendered element outside an aria-hidden subtree carries exactly the full text
  const a = await page.eval(`(async () => { const k = await import(new URL('js/data/kind.js', document.baseURI).href); const full = k.sampleLabel(window.__wse.data.getManifest());
    const c = document.getElementById('expanded-sample');
    const exposed = (e) => { for (let n = e; n; n = n.parentElement) { if (n.getAttribute('aria-hidden') === 'true' || n.hidden || getComputedStyle(n).display === 'none') return false; } return true; };
    const holders = [...document.querySelectorAll('#stage *')].filter((e) => e.children.length === 0 && e.textContent.trim() === full && exposed(e)).map((e) => e.id || e.className);
    return { full, shown: c.textContent, holders }; })()`);
  console.log(`  S-FRAME ${label}: full label '${a.full}' exposed by ${JSON.stringify(a.holders)}; chip shows '${a.shown}'`);
  assert.ok(a.holders.length === 1, `${label}: the full sample label '${a.full}' is exposed to assistive technology exactly once while expanded (${JSON.stringify(a)})`);
  await inp.key(page, null, ' '); await sleep(200); // pause
  await inp.key(page, null, 'Escape'); await sleep(350);
}


// ---------------------------------------------------------------------------------------------------------------------------
// W4-06: native fullscreen, the desktop divider, the landscape phone strip, and the canvas backing size after each change.
const rectJs = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`;
/** The canvas backing size is its client size x min(DPR, 2) (spec 4.7); polled, because the renderer follows a ResizeObserver. */
async function backingOk(page, assert, label, tries = 25) {
  let b;
  for (let i = 0; i < tries; i++) {
    b = await page.eval(`(() => { const c = document.getElementById('map'), d = Math.min(devicePixelRatio || 1, 2); return { cw: c.clientWidth, ch: c.clientHeight, w: c.width, h: c.height, wantW: Math.round(c.clientWidth * d), wantH: Math.round(c.clientHeight * d) }; })()`);
    if (Math.abs(b.w - b.wantW) <= 1 && Math.abs(b.h - b.wantH) <= 1) break;
    await sleep(100);
  }
  assert.ok(Math.abs(b.w - b.wantW) <= 1 && Math.abs(b.h - b.wantH) <= 1, `${label}: canvas backing ${b.w}x${b.h} equals client ${b.cw}x${b.ch} x min(DPR,2) = ${b.wantW}x${b.wantH}`);
  return b;
}

/** Native fullscreen where the document allows it: Expand requests it, `expanded` follows fullscreenchange, the layout is the CSS mode's. */
async function nativeFullscreen({ page, assert, baseUrl, phone, label }) {
  await page.setViewport(...(phone ? [390, 844] : [1440, 900]));
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.storyReady === true', { timeout: 20000 });
  const enabled = await page.eval('document.fullscreenEnabled === true');
  console.log(`  S-FRAME ${label}: document.fullscreenEnabled ${enabled}`);
  assert.ok(enabled, `${label}: the normal page allows fullscreen (document.fullscreenEnabled)`);
  const geom = () => page.eval(`(() => { const r = (id) => { const e = document.getElementById(id); if (!e || e.getClientRects().length === 0) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round); };
    return { vw: innerWidth, vh: innerHeight, map: r('map'), tools: r('map-tools'), timeline: r('timeline'), legend: r('map-legend'), expandBtn: r('btn-expand') }; })()`);
  const press = () => (phone ? inp.tap(page, '#btn-expand') : inp.click(page, '#btn-expand'));
  const isExpanded = `document.getElementById('app').hasAttribute('data-expanded')`;
  // the CSS mode alone first (native refused), the baseline for "identical layout in both modes"
  await page.eval(`Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => false })`);
  await press(); await page.waitFor(isExpanded, { timeout: 3000 }); await sleep(600);
  const css = await geom();
  assert.equal(await page.eval('!!document.fullscreenElement'), false, `${label}: with native refused, no native fullscreen is entered`);
  await press(); await page.waitFor(`!(${isExpanded})`, { timeout: 3000 }); await sleep(400);
  await page.eval(`delete document.fullscreenEnabled`);
  assert.equal(await page.eval('document.fullscreenEnabled === true'), true, `${label}: native allowed again`);
  // native: the button
  await press();
  await page.waitFor(`!!document.fullscreenElement`, { timeout: 5000 }).catch(() => {});
  assert.equal(await page.eval('!!document.fullscreenElement'), true, `${label}: Expand also enters native fullscreen`);
  await page.waitFor(isExpanded, { timeout: 3000 }); await sleep(700);
  const nat = await geom();
  console.log(`  S-FRAME ${label}: css ${JSON.stringify(css)}\n  S-FRAME ${label}: native ${JSON.stringify(nat)}`);
  assert.deepEqual(nat.map, [0, 0, nat.vw, nat.vh], `${label}: native: the map is the viewport`);
  assert.deepEqual(nat, css, `${label}: identical layout in both modes`);
  await backingOk(page, assert, `${label}: native`);
  // Escape in native fullscreen is taken by the browser: the page never sees the key, only fullscreenchange.
  await page.eval(`document.exitFullscreen()`);
  await page.waitFor(`!(${isExpanded})`, { timeout: 5000 }).catch(() => {});
  const after = await page.eval(`({ expanded: ${isExpanded}, full: !!document.fullscreenElement, label: document.getElementById('btn-expand').textContent.trim(), stored: window.__wse.store.get().expanded })`);
  assert.deepEqual(after, { expanded: false, full: false, label: 'Expand', stored: false }, `${label}: leaving native fullscreen clears expanded (the page saw no key)`);
  await sleep(300);
  await backingOk(page, assert, `${label}: after the native exit`);
  // Exit by the button leaves native too
  await press(); await page.waitFor(`!!document.fullscreenElement`, { timeout: 5000 }).catch(() => {}); await sleep(300);
  await press(); await sleep(600);
  assert.deepEqual(await page.eval(`({ expanded: ${isExpanded}, full: !!document.fullscreenElement })`), { expanded: false, full: false }, `${label}: Exit leaves both the CSS mode and native fullscreen`);
  await nativeRace({ page, assert, press, label });
}

/**
 * Presses that arrive while a native change is still in flight (macOS animates entering fullscreen for about half a second). The
 * browser's requestFullscreen / exitFullscreen are slowed by 300 ms, standing in for that animation. Each case must end with expanded
 * and native fullscreen agreeing, and expanded must still follow fullscreenchange afterwards (spec 4.7, E-B5).
 */
async function nativeRace({ page, assert, press, label }) {
  const st = () => page.eval(`({ expanded: document.getElementById('app').hasAttribute('data-expanded'), native: !!document.fullscreenElement, label: document.getElementById('btn-expand').textContent.trim() })`);
  const slow = (name, proto) => page.eval(`(() => { const o = ${proto}.${name}; if (o.__slowed) return; const f = function (...a) { return new Promise((res, rej) => setTimeout(() => o.apply(this, a).then(res, rej), 300)); }; f.__slowed = true; ${proto}.${name} = f; })()`);
  await slow('requestFullscreen', 'Element.prototype');
  // a double press on Expand: Exit arrives before the native request lands; the request lands and is left again
  await press(); await press(); await sleep(1500);
  assert.deepEqual(await st(), { expanded: false, native: false, label: 'Expand' }, `${label}: a double press on Expand (Exit before the slowed native request lands) ends neither expanded nor in native fullscreen`);
  // F F, the same race from the keyboard
  await inp.key(page, null, 'f'); await inp.key(page, null, 'f'); await sleep(1500);
  assert.deepEqual(await st(), { expanded: false, native: false, label: 'Expand' }, `${label}: F F ends neither expanded nor in native fullscreen`);
  // after the race, Expand is native again and expanded still follows fullscreenchange
  await press(); await page.waitFor(`!!document.fullscreenElement`, { timeout: 5000 }).catch(() => {}); await sleep(300);
  assert.deepEqual(await st(), { expanded: true, native: true, label: 'Exit' }, `${label}: Expand after the race enters native fullscreen`);
  await page.eval(`document.exitFullscreen()`); await sleep(1000);
  assert.deepEqual(await st(), { expanded: false, native: false, label: 'Expand' }, `${label}: after the race, leaving native fullscreen (Escape) still clears expanded`);
  // Expand, Exit, Expand inside one in-flight request: it lands and stays, owned by expanded
  await press(); await press(); await press(); await sleep(1500);
  assert.deepEqual(await st(), { expanded: true, native: true, label: 'Exit' }, `${label}: Expand, Exit, Expand before the request lands ends expanded and native`);
  await page.eval(`document.exitFullscreen()`); await sleep(1000);
  assert.deepEqual(await st(), { expanded: false, native: false, label: 'Expand' }, `${label}: and leaving native fullscreen then clears expanded`);
  // Exit then Expand while a slowed exit is in flight: the exit lands, then expanded asks for native again
  await slow('exitFullscreen', 'Document.prototype');
  await press(); await page.waitFor(`!!document.fullscreenElement`, { timeout: 5000 }).catch(() => {}); await sleep(300);
  await press(); await press(); await sleep(1800);
  const re = await st();
  console.log(`  S-FRAME ${label}: Exit then Expand during a slowed exit ends ${JSON.stringify(re)}`);
  assert.equal(re.expanded, true, `${label}: Exit then Expand while the exit is in flight ends expanded (${JSON.stringify(re)})`);
  assert.equal(re.label, 'Exit', `${label}: and the button says Exit`);
  if (re.native) { // the second request can be refused (no user activation left when the exit lands): the CSS mode alone then holds
    await page.eval(`document.exitFullscreen()`); await sleep(1500);
    assert.deepEqual(await st(), { expanded: false, native: false, label: 'Expand' }, `${label}: and leaving that native fullscreen clears expanded`);
  } else { await press(); await sleep(600); }
  assert.deepEqual(await st(), { expanded: false, native: false, label: 'Expand' }, `${label}: the race cases end restored`);
}

/** The divider: real mouse drag, arrow keys, remembered width, double-click fold to the 44 px rail. Desktop only. */
async function dividerChecks({ page, assert, baseUrl }) {
  const label = 'desktop divider';
  await page.setViewport(1440, 900);
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.storyReady === true', { timeout: 20000 });
  const st = () => page.eval(`(() => { const d = document.getElementById('divider'), h = document.getElementById('home'), s = document.getElementById('stage');
    const dr = d.getBoundingClientRect(), hr = h.getBoundingClientRect(), sr = s.getBoundingClientRect();
    return { shown: d.getClientRects().length > 0, role: d.getAttribute('role'), now: d.getAttribute('aria-valuenow'), min: d.getAttribute('aria-valuemin'), max: d.getAttribute('aria-valuemax'), tab: d.tabIndex,
      name: d.getAttribute('aria-label'), dw: dr.width, dh: dr.height, home: hr.width, divRight: dr.right, stageLeft: sr.left, stageW: sr.width, folded: document.getElementById('app').hasAttribute('data-folded'), focused: document.activeElement === d }; })()`);
  const s0 = await st();
  console.log(`  S-FRAME ${label}: ${JSON.stringify(s0)}`);
  assert.ok(s0.shown, `${label}: the divider is on screen at desktop width`);
  assert.equal(s0.role, 'separator'); assert.ok(s0.name, `${label}: it has an accessible name`);
  assert.ok(s0.dw >= 6 && s0.dw <= 12 && s0.dh > 300, `${label}: a slim full-height bar (${s0.dw} x ${s0.dh})`);
  assert.equal(s0.tab, 0, `${label}: focusable`);
  assert.equal(s0.min, '300'); assert.equal(s0.max, '560');
  // until the viewer sets a width, the panel is wide enough for the week card's seven days where the window has room (layout.js autoPanelW)
  assert.equal(Math.round(s0.home), 486, `${label}: the default panel width at 1440 px is 486`);
  assert.equal(s0.now, '486');
  await backingOk(page, assert, `${label}: initial`);
  // a real mouse drag, left
  await inp.drag(page, '#divider', { by: { dx: -100, dy: 0 }, steps: 10, ms: 200 }); await sleep(300);
  let s = await st();
  assert.ok(Math.abs(s.home - 386) <= 2, `${label}: a drag of -100 px sets the panel width to 386 (got ${s.home})`);
  assert.equal(s.now, String(Math.round(s.home)), `${label}: aria-valuenow follows`);
  assert.ok(Math.abs(s.stageLeft - s.divRight) <= 12, `${label}: the map follows the divider`);
  await backingOk(page, assert, `${label}: after the drag`);
  // beyond the limits it clamps
  await inp.drag(page, '#divider', { by: { dx: 400, dy: 0 }, steps: 10, ms: 200 }); await sleep(300);
  assert.equal(Math.round((await st()).home), 560, `${label}: the drag stops at 560`);
  await inp.drag(page, '#divider', { by: { dx: -600, dy: 0 }, steps: 10, ms: 200 }); await sleep(300);
  assert.equal(Math.round((await st()).home), 300, `${label}: the drag stops at 300`);
  await backingOk(page, assert, `${label}: at 300`);
  // keys
  await inp.drag(page, '#divider', { by: { dx: 100, dy: 0 }, steps: 6, ms: 120 }); await sleep(250);
  s = await st(); assert.ok(s.focused, `${label}: a drag focuses the divider`);
  const w1 = Math.round(s.home);
  await inp.key(page, null, 'ArrowRight'); await sleep(150);
  const w2 = Math.round((await st()).home);
  assert.ok(w2 > w1 && w2 - w1 <= 48, `${label}: ArrowRight widens (${w1} to ${w2})`);
  await inp.key(page, null, 'ArrowLeft'); await sleep(150);
  assert.equal(Math.round((await st()).home), w1, `${label}: ArrowLeft narrows back`);
  await inp.key(page, null, 'End'); await sleep(150);
  assert.equal(Math.round((await st()).home), 560, `${label}: End is 560`);
  await inp.key(page, null, 'ArrowRight'); await sleep(150);
  assert.equal(Math.round((await st()).home), 560, `${label}: no wider than 560`);
  await inp.key(page, null, 'Home'); await sleep(150);
  assert.equal(Math.round((await st()).home), 300, `${label}: Home is 300`);
  await inp.key(page, null, 'ArrowLeft'); await sleep(150);
  assert.equal(Math.round((await st()).home), 300, `${label}: no narrower than 300`);
  await backingOk(page, assert, `${label}: after the keys`);
  // remembered
  await inp.key(page, null, 'ArrowRight'); await inp.key(page, null, 'ArrowRight'); await sleep(200);
  const kept = Math.round((await st()).home);
  assert.ok(kept > 300, `${label}: two ArrowRight presses moved it (${kept})`);
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.storyReady === true', { timeout: 20000 });
  assert.equal(Math.round((await st()).home), kept, `${label}: the width (${kept}) is remembered across a reload`);
  // a double-click folds to the 44 px rail
  await inp.click(page, '#divider', { count: 2 }); await sleep(400);
  s = await st();
  assert.equal(Math.round(s.home), 44, `${label}: a double-click folds the panel to a 44 px rail`);
  assert.ok(s.folded, `${label}: #app[data-folded]`);
  await backingOk(page, assert, `${label}: folded`);
  assert.ok(s.stageW > 1440 - 44 - 40, `${label}: the map takes the room (${Math.round(s.stageW)} px)`);
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.storyReady === true', { timeout: 20000 });
  assert.equal(Math.round((await st()).home), 44, `${label}: the fold is remembered`);
  const fold = await page.eval(rectJs('#btn-fold'));
  assert.ok(fold && fold.w >= 44 && fold.h >= 44, `${label}: the collapse control is a 44 px target (${fold && fold.w}x${fold && fold.h})`);
  await inp.click(page, '#btn-fold'); await sleep(400);
  assert.equal(Math.round((await st()).home), kept, `${label}: the collapse control unfolds to the remembered width`);
  await inp.click(page, '#btn-fold'); await sleep(400);
  assert.equal(Math.round((await st()).home), 44, `${label}: and folds again`);
  await inp.click(page, '#divider', { count: 2 }); await sleep(400);
  assert.equal(Math.round((await st()).home), kept, `${label}: a double-click on the folded rail unfolds it`);
  await backingOk(page, assert, `${label}: unfolded`);
  // expanded hides the divider and ignores the width
  await inp.click(page, '#btn-expand'); await sleep(600);
  assert.ok(!(await st()).shown, `${label}: the divider is hidden while expanded`);
  const m = await page.eval(rectJs('#map'));
  assert.deepEqual([Math.round(m.l), Math.round(m.t), Math.round(m.w), Math.round(m.h)], [0, 0, 1440, 900], `${label}: the expanded map is the viewport whatever the panel width`);
  await backingOk(page, assert, `${label}: expanded`);
  await inp.key(page, null, 'Escape'); await sleep(500);
  assert.ok((await st()).shown, `${label}: the divider is back after Exit`);
  // a narrow window never lets the panel crowd the map's own controls out: at its maximum the panel leaves the map tools and the
  // timeline header their room (4 px to spare each way, for wider font metrics on other platforms)
  for (const [vw, vh] of [[1024, 768], [1000, 700], [900, 700]]) {
    const nl = `${label} at ${vw}x${vh}, panel at its maximum`;
    await page.setViewport(vw, vh); await sleep(400);
    await page.goto(baseUrl);
    await page.waitFor('window.__wse && window.__wse.storyReady === true', { timeout: 20000 });
    await sleep(500);
    await inp.drag(page, '#divider', { by: { dx: 900, dy: 0 }, steps: 10, ms: 200 }); await sleep(400);
    const g = await page.eval(`(() => { const r = (sel) => { const e = document.querySelector(sel); if (!e || e.getClientRects().length === 0) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
      const boxes = []; let ni = 0; const w = document.createTreeWalker(document.getElementById('timeline'), NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim()) continue; const el = n.parentElement, cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue; ni++;
        const rg = document.createRange(); rg.selectNodeContents(n);
        const clipBox = (() => { let c = null; for (let a = el; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a); if (/hidden|clip/.test(o.overflowX)) { const b = a.getBoundingClientRect(); c = c ? { l: Math.max(c.l, b.left), r: Math.min(c.r, b.right) } : { l: b.left, r: b.right }; } } return c; })();
        for (const b of rg.getClientRects()) { if (b.width <= 1 || b.height <= 1) continue; const l = clipBox ? Math.max(b.left, clipBox.l) : b.left, r = clipBox ? Math.min(b.right, clipBox.r) : b.right; if (r - l > 1) boxes.push({ t: n.textContent.trim().slice(0, 24), ni, l, r, tp: b.top, bt: b.bottom }); } } // only what is painted: text clipped by an overflow:hidden ancestor (an ellipsis) does not count
      const ctl = [...document.querySelectorAll('#timeline button, #timeline [role=button]')].filter((e) => e.getClientRects().length).map((e) => { const b = e.getBoundingClientRect(); return { t: (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 24), l: b.left, r: b.right, tp: b.top, bt: b.bottom }; });
      return { vw: innerWidth, home: document.getElementById('home').getBoundingClientRect().width, max: document.getElementById('divider').getAttribute('aria-valuemax'), stage: r('#stage'), timeline: r('#timeline'), layers: r('#btn-layers'), expand: r('#btn-expand'), views: r('#view-switch'), boxes, ctl }; })()`);
    console.log(`  S-FRAME ${nl}: ${JSON.stringify({ home: g.home, max: g.max, stage: g.stage, layers: g.layers, expand: g.expand })}`);
    assert.ok(g.layers && g.expand && g.stage && g.timeline, `${nl}: the map tools and the stage are laid out`);
    assert.equal(Math.round(g.home), Number(g.max), `${nl}: the drag reached the divider's maximum (${Math.round(g.home)} of aria-valuemax ${g.max})`);
    for (const [name, b] of [['Layers', g.layers], ['Expand', g.expand]]) {
      assert.ok(b.l >= g.stage.l + 4 && b.r <= g.stage.r - 4, `${nl}: ${name} (${Math.round(b.l)} to ${Math.round(b.r)}) lies inside the stage (${Math.round(g.stage.l)} to ${Math.round(g.stage.r)}) with 4 px to spare`);
      assert.ok(b.l >= 4 && b.r <= g.vw - 4, `${nl}: ${name} lies inside the ${g.vw} px viewport with 4 px to spare`);
    }
    if (g.views) assert.ok(g.views.r + 4 <= g.layers.l, `${nl}: the view switch ends 4 px before Layers (${Math.round(g.views.r)} vs ${Math.round(g.layers.l)})`);
    const clash = [];
    for (let i = 0; i < g.boxes.length; i++) for (let j = i + 1; j < g.boxes.length; j++) { const a = g.boxes[i], b = g.boxes[j]; if (a.ni === b.ni) continue; // the line boxes of one text run
      if (a.l < b.r + 4 && b.l < a.r + 4 && a.tp < b.bt && b.tp < a.bt) clash.push([a.t, b.t]); }
    assert.deepEqual(clash, [], `${nl}: no two timeline texts overlap or sit within 4 px of each other (${g.boxes.length} text runs)`);
    const clip = g.boxes.filter((b) => b.r > g.timeline.r - 4 || b.l < g.timeline.l);
    assert.deepEqual(clip.map((b) => b.t), [], `${nl}: every timeline text ends 4 px inside the timeline`);
    const bclash = [];
    for (let i = 0; i < g.ctl.length; i++) for (let j = i + 1; j < g.ctl.length; j++) { const a = g.ctl[i], b = g.ctl[j]; if (a.l < b.r && b.l < a.r && a.tp < b.bt && b.tp < a.bt) bclash.push([a.t, b.t]); }
    assert.deepEqual(bclash, [], `${nl}: no two timeline controls overlap`);
    await backingOk(page, assert, nl);
    if (process.env.WSE_SHOT_DIR) { const shot = await page.send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(process.env.WSE_SHOT_DIR, { recursive: true }); fs.writeFileSync(path.join(process.env.WSE_SHOT_DIR, `max-${vw}x${vh}.png`), Buffer.from(shot.data, 'base64')); }
  }
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
}

/** Landscape phone: the sheet becomes a side strip, the chart keeps the rest, the timeline stays usable, Expand still works. */
async function landscape({ page, assert, baseUrl }) {
  const metrics = (width, height) => page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
  const shares = {};
  for (const [w, h] of [[844, 390], [667, 375], [932, 430], [915, 412]]) {
    const label = `landscape phone ${w}x${h}`;
    await metrics(w, h);
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.goto(baseUrl);
    await page.waitFor('window.__wse && window.__wse.storyReady === true', { timeout: 20000 });
    await sleep(700);
    const g = await page.eval(`(() => { const r = (id) => { const e = document.getElementById(id); if (!e || e.getClientRects().length === 0) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      return { vw: innerWidth, vh: innerHeight, home: r('home'), stage: r('stage'), timeline: r('timeline'), handle: r('sheet-handle'), tools: r('map-tools'), body: r('home-body'), inert: document.getElementById('home-body').inert, topbar: r('topbar'),
        hscroll: document.documentElement.scrollWidth > innerWidth }; })()`);
    console.log(`  S-FRAME ${label}: ${JSON.stringify({ home: g.home, stage: g.stage, timeline: g.timeline, tools: g.tools })}`);
    assert.ok(g.home && g.stage, `${label}: panel and stage are laid out`);
    assert.ok(!g.handle, `${label}: no sheet handle (there is no sheet)`);
    assert.ok(g.home.l <= 1 && g.home.r <= g.vw * 0.45 && g.home.w >= 240, `${label}: the panel is a side strip on the left (${Math.round(g.home.w)} px of ${g.vw})`);
    assert.ok(g.home.b >= g.vh - 1 && g.home.t >= g.topbar.b - 1, `${label}: the strip runs from the header to the bottom edge`);
    assert.ok(g.stage.l >= g.home.r - 1, `${label}: the chart starts where the strip ends (${Math.round(g.stage.l)} vs ${Math.round(g.home.r)})`);
    assert.ok(g.timeline.l >= g.home.r - 1 && g.timeline.b >= g.vh - 1 && g.timeline.h <= 90, `${label}: the timeline sits under the chart, not the strip (${JSON.stringify(g.timeline)})`);
    assert.ok(g.timeline.w >= 200, `${label}: the timeline is wide enough to scrub (${Math.round(g.timeline.w)})`);
    assert.ok(!g.inert && g.body && g.body.h > 60, `${label}: the panel's content is reachable (${g.body && Math.round(g.body.h)} px tall)`);
    assert.ok(g.tools, `${label}: the map tools are visible`);
    assert.ok(!g.hscroll, `${label}: no horizontal page scroll`);
    const free = g.timeline.t - g.tools.b;
    assert.ok(free >= 100, `${label}: at least 100 px of chart between the tools and the timeline (${Math.round(free)})`);
    // text collisions in the timeline (the scrubber words and its date line), with at least 4 px of slack, and a chart that keeps most of the height
    const boxes = await page.eval(`(() => { const out = []; const w = document.createTreeWalker(document.getElementById('timeline'), NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim()) continue; const el = n.parentElement, cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
        const rg = document.createRange(); rg.selectNodeContents(n); for (const b of rg.getClientRects()) if (b.width > 1 && b.height > 1) out.push({ t: n.textContent.trim().slice(0, 24), l: b.left, r: b.right, tp: b.top, bt: b.bottom }); }
      return out; })()`);
    const clash = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j];
      if (a.l < b.r + 4 && b.l < a.r + 4 && a.tp < b.bt && b.tp < a.bt) clash.push([a.t, b.t]); }
    assert.deepEqual(clash, [], `${label}: no two timeline texts overlap or sit within 4 px of each other (${boxes.length} text runs)`);
    assert.ok(boxes.every((b) => b.r <= g.vw && b.l >= g.home.r - 1), `${label}: every timeline text is inside the chart column`);
    shares[label] = g.stage.h / g.vh;
    console.log(`  S-FRAME ${label}: stage ${Math.round(g.stage.h)} of ${g.vh} px (${(100 * g.stage.h / g.vh).toFixed(1)}%), timeline ${Math.round(g.timeline.h)} px`);
    if (w >= 900) assert.ok(shares[label] >= shares['landscape phone 844x390'] - 0.08, `${label}: the chart keeps a share of the height comparable to 844x390 (${shares[label].toFixed(2)} vs ${shares['landscape phone 844x390'].toFixed(2)})`);
    await backingOk(page, assert, label);
    await inp.tap(page, '#btn-expand'); await sleep(600);
    const e = await page.eval(`(() => { const m = document.getElementById('map').getBoundingClientRect(); return [m.left, m.top, m.width, m.height, innerWidth, innerHeight, document.getElementById('app').hasAttribute('data-expanded')].map((v) => typeof v === 'number' ? Math.round(v) : v); })()`);
    assert.deepEqual(e, [0, 0, w, h, w, h, true], `${label}: expanded: the map is the viewport`);
    // expanded on sample data, the header that carries the sample label is hidden and the landscape legend is a one-row bar with no
    // badge: the sample chip must say so on screen, inside the viewport, under no control (review 2: at 932x430 and 915x412 it stayed
    // display:none because frame.css placed it by width alone)
    const chip = await page.eval(`(() => { const m = window.__wse.data.getManifest(); const c = document.getElementById('expanded-sample');
      if (!(m && m.sample)) return { live: true, shown: !!c && c.getClientRects().length > 0 };
      if (!c || c.getClientRects().length === 0) return null;
      const r = c.getBoundingClientRect(), cs = getComputedStyle(c);
      const hits = [...document.querySelectorAll('button, #map-status:not(:empty), .wse-toast, #timeline, #map-legend')].filter((o) => !o.contains(c) && o.getClientRects().length > 0)
        .filter((o) => { const q = o.getBoundingClientRect(); return q.width > 0 && q.left < r.right + 4 && q.right > r.left - 4 && q.top < r.bottom + 4 && q.bottom > r.top - 4; }).map((o) => o.id || o.className || o.tagName);
      return { text: c.textContent.trim(), box: [r.left, r.top, r.right, r.bottom].map(Math.round), visible: cs.visibility !== 'hidden' && +cs.opacity > 0,
        inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, hits }; })()`);
    console.log(`  S-FRAME ${label}: expanded sample chip ${JSON.stringify(chip)}`);
    if (chip && chip.live) assert.equal(chip.shown, false, `${label}: expanded on live data: no sample chip`);
    else {
      assert.ok(chip && chip.visible && /sample/i.test(chip.text) && /not live/i.test(chip.text), `${label}: expanded on sample data: the sample chip is on screen and says sample and not live (found ${JSON.stringify(chip)})`);
      assert.ok(chip.inside, `${label}: the sample chip is inside the viewport (${JSON.stringify(chip.box)})`);
      assert.deepEqual(chip.hits, [], `${label}: the sample chip keeps 4 px clear of every control, the legend and the timeline (${JSON.stringify(chip.box)})`);
    }
    await backingOk(page, assert, `${label} expanded`);
    await inp.tap(page, '#btn-expand'); await sleep(600);
    const back = await page.eval(rectJs('#home'));
    assert.ok(back && back.w >= 240 && back.l <= 1, `${label}: Exit brings the strip back`);
    await backingOk(page, assert, `${label} restored`);
    // rotate to portrait: the sheet returns; back to landscape: the strip returns
    await metrics(h, w); await sleep(800);
    const p = await page.eval(`(() => { const hd = document.getElementById('sheet-handle').getBoundingClientRect(), hm = document.getElementById('home').getBoundingClientRect(); return { handle: hd.height, homeW: hm.width, vw: innerWidth, homeB: hm.bottom, vh: innerHeight }; })()`);
    assert.ok(p.handle >= 44 && Math.abs(p.homeW - p.vw) <= 1 && p.homeB >= p.vh - 1, `${label}: rotated to portrait the bottom sheet is back (${JSON.stringify(p)})`);
    await backingOk(page, assert, `${label} portrait`);
    await metrics(w, h); await sleep(800);
    const l2 = await page.eval(rectJs('#home'));
    assert.ok(l2.w < w * 0.45, `${label}: and back to landscape the strip returns`);
    await backingOk(page, assert, `${label} landscape again`);
    // the add sheet (ui/sheet.js, sheet.css): a drag handle on screen must work. Either the sheet is the centered dialog with no handle,
    // or a real finger drag down the handle closes it (review 2: at 932x430 the CSS drew a phone sheet with a handle while sheet.js took
    // the desktop path, so the handle did nothing)
    await page.eval(`document.getElementById('empty-people').scrollIntoView({ block: 'center' })`); await sleep(200);
    await inp.tap(page, '#empty-people'); await sleep(900);
    const sh = await page.eval(`(() => { const s = document.querySelector('.wse-sheet'), hd = document.querySelector('.wse-sheet-handle');
      if (!s) return null; const r = s.getBoundingClientRect();
      return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), bottomGap: Math.round(innerHeight - r.bottom), handle: !!hd && hd.getClientRects().length > 0 && hd.getBoundingClientRect().height > 0 }; })()`);
    assert.ok(sh, `${label}: the add sheet opens`);
    if (sh.handle) {
      await inp.drag(page, '.wse-sheet-handle', { by: { dx: 0, dy: 250 }, steps: 10, ms: 200, touch: true }); await sleep(900);
      const after = await page.eval(`(() => { const s = document.querySelector('.wse-sheet'); return s ? Math.round(s.getBoundingClientRect().top) : 'closed'; })()`);
      console.log(`  S-FRAME ${label}: add sheet ${JSON.stringify(sh)}, after a 250 px finger drag down the handle: ${after}`);
      assert.equal(after, 'closed', `${label}: the add sheet shows a drag handle, so a finger drag down it closes the sheet (top ${sh.top} before, ${after} after)`);
    } else {
      console.log(`  S-FRAME ${label}: add sheet ${JSON.stringify(sh)}, no handle`);
      assert.ok(sh.width <= 440 && Math.abs(sh.left + sh.width / 2 - w / 2) <= 2 && sh.bottomGap > 0, `${label}: with no handle, the add sheet is the centered dialog (${JSON.stringify(sh)})`);
      await inp.key(page, null, 'Escape'); await sleep(600);
      assert.equal(await page.eval(`!!document.querySelector('.wse-sheet')`), false, `${label}: Escape closes the add sheet`);
    }
  }
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
}

export async function run({ page, baseUrl, assert, newPage }) {
  // expanded at 1024x768: the map legend stands clear of the scrubber
  await page.setViewport(1024, 768);
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.storyReady === true', { timeout: 20000 });
  await legendClear({ page, assert, label: 'desktop 1024 page' });

  for (const [name, vw, vh, phone] of [['desktop', 1440, 900, false], ['phone', 390, 844, true]]) {
    // normal page
    await page.setViewport(vw, vh);
    await page.goto(baseUrl);
    await page.waitFor('window.__wse && window.__wse.storyReady === true', { timeout: 20000 });
    await exercise({ page, assert, phone, inFrame: false, label: `${name} page` });
    if (!phone) await escapeWithPanel({ page, assert, label: `${name} page` });
    if (phone) await chipQuiet({ page, assert, label: `${name} page` });
    assert.deepEqual(page.errors(), [], name + ' console errors: ' + JSON.stringify(page.errors()));
    // sandboxed iframe, no allowfullscreen
    await page.goto(baseUrl + 'css/status.css'); // a same-origin document with no app running in it, to host the iframe
    await page.setViewport(vw, vh);
    await page.eval(`(() => { document.open(); document.write(${JSON.stringify(HOST)}); document.close(); })()`);
    await page.waitFor(`(() => { const f = document.getElementById('app-frame'); return f && f.contentWindow && f.contentWindow.__wse && f.contentWindow.__wse.ready === true; })()`, { timeout: 20000 });
    const frameInfo = await page.eval(`(() => { const f = document.getElementById('app-frame'); return { sandbox: f.getAttribute('sandbox'), allow: f.hasAttribute('allowfullscreen') || /fullscreen(?! 'none')/.test(f.getAttribute('allow') || '') }; })()`);
    assert.ok(!frameInfo.allow && !/allow-fullscreen/.test(frameInfo.sandbox), 'the host iframe gives no fullscreen permission');
    if (phone) {
      // the frame is 900x600: the phone layout needs a narrow frame, so resize it and put it at the window's corner
      await page.eval(`(() => { const f = document.getElementById('app-frame'); f.style.left = '0'; f.style.top = '0'; f.style.width = '390px'; f.style.height = '700px'; })()`);
      await sleep(400);
    }
    await exercise({ page, assert, phone, inFrame: true, label: `${name} sandboxed iframe` });
    // no fullscreen permission in the frame: the CSS mode alone, and no native fullscreen is entered by Expand
    const ft = target(page, true);
    assert.equal(await ft.ev(`document.fullscreenEnabled`), false, `${name} sandboxed iframe: document.fullscreenEnabled is false`);
    const fp = await ft.centre('#btn-expand');
    if (phone) await inp.tap(page, fp); else await inp.click(page, fp);
    await sleep(500);
    assert.equal(await ft.ev(`document.getElementById('app').hasAttribute('data-expanded')`), true, `${name} sandboxed iframe: Expand still works`);
    assert.equal(await ft.ev(`!!document.fullscreenElement`), false, `${name} sandboxed iframe: no native fullscreen in the frame`);
    assert.equal(await page.eval(`!!document.fullscreenElement`), false, `${name} sandboxed iframe: the host page is not fullscreen either`);
  }
  // W4-06
  await nativeFullscreen({ page, assert, baseUrl, phone: false, label: 'desktop native' });
  await nativeFullscreen({ page, assert, baseUrl, phone: true, label: 'phone native' });
  await dividerChecks({ page, assert, baseUrl });
  await landscape({ page, assert, baseUrl });
}
