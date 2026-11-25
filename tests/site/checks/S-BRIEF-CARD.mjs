// S-BRIEF-CARD (C1-03): the Briefing's card and pill, alone, on tests/site/pages/brief-card.html (fixture beats, no app).
// At 390x844 and 1440x900 in both themes: DOM contract (CONCEPTS-REVIEW M9), box and font sizes, no clipped text with 4 px of slack on
// every height limit, contrast from resolved colours, button names, each callback fired by a real click or tap, focus in and back,
// one polite announcement per beat, reduced motion, the strip slot, the segments, the pill. Plus a source lint: no raw hex colour
// in brief.css, every var() it uses is defined in tokens.css, and card.js and pill.js import neither data, store nor player.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as inp from '../lib/input.mjs';

export const id = 'S-BRIEF-CARD';
export const freshProfile = true;
export const timeoutMs = 120000;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..', '..');
const PAGE = fs.readFileSync(path.join(here, '..', 'pages', 'brief-card.html'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SLACK = 4; // px of slack on every limit (wider Linux fonts)

function lint(assert) {
  const css = fs.readFileSync(path.join(REPO, 'site/css/brief.css'), 'utf8');
  const tokens = fs.readFileSync(path.join(REPO, 'site/css/tokens.css'), 'utf8');
  const hex = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,8}\b/g);
  assert.ok(!hex, `brief.css has raw hex colours: ${hex}`);
  assert.ok(!/\b(rgba?|hsla?)\(/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'brief.css writes no rgb/hsl colour literal: colour comes from tokens.css custom properties');
  const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  for (const m of css.matchAll(/var\((--[\w-]+)/g)) assert.ok(defined.has(m[1]) || /^--brief-(dock|dock-wide|tl|card-h)$/.test(m[1]), // the wiring (C1-04) sets four inputs on #app: the gap above the timeline (phone, and from 700 px), the timeline's height and the card's height, each with a fallback
     `brief.css uses ${m[1]}, which tokens.css does not define`);
  for (const f of ['card.js', 'pill.js']) {
    const src = fs.readFileSync(path.join(REPO, 'site/js/brief', f), 'utf8');
    const imports = [...src.matchAll(/^\s*import[^;]*?from\s*['"]([^'"]+)['"]/gm), ...src.matchAll(/import\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const i of imports) assert.ok(!/data|state|store|player|main|render|time\//.test(i), `${f} imports ${i}: the surface reaches no data facade, store or player`);
  }
}

/** Runs in the page: every text-bearing element of the card with its font size, clip state and contrast against its resolved ground. */
const MEASURE = `(() => {
  const card = document.getElementById('brief-card'); if (!card) return null;
  const parse = (s) => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const ground = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) chain.push(c); if (c && c.a === 1) break; }
    let g = { r: 255, g: 255, b: 255, a: 1 }; const bodyBg = parse(getComputedStyle(document.body).backgroundColor); if (bodyBg && bodyBg.a === 1) g = bodyBg;
    for (let i = chain.length - 1; i >= 0; i--) g = over(chain[i], g); return g; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const cb = card.getBoundingClientRect();
  const texts = [];
  for (const el of card.querySelectorAll('*')) {
    if (el.closest('.brief-live') || el.closest('svg')) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const fg = parse(cs.color), bg = ground(el);
    texts.push({ cls: el.className || el.tagName, text: el.textContent.trim().slice(0, 40), size: parseFloat(cs.fontSize),
      clipH: el.scrollHeight - el.clientHeight, clipW: el.scrollWidth - el.clientWidth, outside: Math.max(cb.left - r.left, r.right - cb.right, cb.top - r.top, r.bottom - cb.bottom),
      ratio: cr(over(fg, bg), bg), ellipsis: cs.textOverflow === 'ellipsis', trans: cs.transitionDuration, anim: cs.animationName });
  }
  const parts = (sel) => [...card.querySelectorAll(sel)].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return { text: e.textContent.trim(), w: r.width, h: r.height, tag: e.tagName }; });
  const cardCs = getComputedStyle(card);
  const all = [card, ...card.querySelectorAll('*')].map((e) => getComputedStyle(e)).map((c) => ({ t: c.transitionDuration, a: c.animationName }));
  const stage = document.getElementById('stage').getBoundingClientRect(), tl = document.getElementById('fake-timeline').getBoundingClientRect();
  const strip = card.querySelector('.brief-strip'), sb = strip && strip.getBoundingClientRect();
  return { vw: innerWidth, vh: innerHeight, box: { l: cb.left, t: cb.top, r: cb.right, b: cb.bottom, w: cb.width, h: cb.height }, stage: { l: stage.left, t: stage.top, r: stage.right, b: stage.bottom }, timelineTop: tl.top,
    attrs: { role: card.getAttribute('role'), label: card.getAttribute('aria-label'), chapter: card.dataset.chapter, beat: card.dataset.beat, state: card.dataset.state },
    kicker: card.querySelector('.brief-kicker')?.textContent.trim(), title: card.querySelector('.brief-title')?.textContent.trim(),
    lines: [...card.querySelectorAll('.brief-line')].map((e) => e.textContent.trim()), date: card.querySelector('.brief-date')?.textContent.trim(),
    stamp: (() => { const s = card.querySelector('.brief-stamp'); return s && s.getClientRects().length ? { level: s.dataset.level, source: s.dataset.source, text: s.textContent.replace(/\\s+/g, ' ').trim(), texture: s.dataset.texture } : null; })(),
    segs: (() => { const g = card.querySelector('.brief-segs'); return g ? { role: g.getAttribute('role'), now: g.getAttribute('aria-valuenow'), n: g.querySelectorAll('.brief-seg').length,
      fills: [...g.querySelectorAll('.brief-seg')].map((s) => { const i = s.firstElementChild.getBoundingClientRect(), o = s.getBoundingClientRect(); return o.width ? +(i.width / o.width).toFixed(2) : 0; }) } : null; })(),
    strip: sb ? { h: sb.height, hasSvg: !!strip.querySelector('svg') } : null,
    buttons: parts('button'), texts, anims: all, live: [...card.querySelectorAll('[aria-live]')].map((e) => e.getAttribute('aria-live')),
    active: document.activeElement && (document.activeElement.id || document.activeElement.textContent.trim()),
    fontCard: cardCs.fontSize };
})()`;

export async function run({ page, baseUrl, assert }) {
  lint(assert);
  const VPS = [{ name: 'phone', w: 390, h: 844, phone: true }, { name: 'desktop', w: 1440, h: 900, phone: false }];
  const press = (vp, sel) => (vp.phone ? inp.tap(page, sel) : inp.click(page, sel));
  const btn = (name) => `#brief-card button[data-act="${name}"]`;
  let first = true;
  for (const vp of VPS) {
    for (const theme of ['light', 'dark']) {
      const label = `${vp.name}/${theme}`;
      await page.setViewport(vp.w, vp.h, 1);
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
      await page.goto(baseUrl + 'css/tokens.css'); // a static file on the site's origin (no app); the test page is written over it so /css and /js resolve
      await page.eval(`(() => { document.open(); document.write(${JSON.stringify(PAGE)}); document.close(); })()`);
      await page.waitFor('window.__briefReady === true', { timeout: 15000 });
      await page.eval(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      await sleep(120);
      const show = (name, o = {}) => page.eval(`__brief.show(${JSON.stringify(name)}, ${JSON.stringify(o)})`);
      const m = async () => { await sleep(60); return page.eval(MEASURE); };
      const mw = async () => { await sleep(260); return page.eval(MEASURE); }; // past the 120 ms fill transition

      // ---- focus on open: the Pause button
      let s = await m();
      assert.equal(s.active, 'Pause', `${label}: focus is on Pause after open (was ${s.active})`);

      // ---- every fixture beat: contract, sizes, clipping, contrast
      const FIX = ['title', 'hold', 'home', 'person', 'trip', 'late', 'sure', 'rewind', 'end'];
      for (const name of FIX) {
        await show(name, { which: 'full', state: 'playing', progress: 0.4 });
        s = await m();
        const w = `${label}/${name}`;
        const fx = await page.eval(`__brief.fixtures[${JSON.stringify(name)}]`);
        assert.deepEqual([s.attrs.role, s.attrs.label, s.attrs.chapter, s.attrs.beat, s.attrs.state], ['region', 'Briefing', fx.chapter, fx.id, 'playing'], `${w}: region, label and data attributes`);
        assert.equal(s.kicker, fx.kicker, `${w}: the kicker is real text`);
        assert.equal(s.title, fx.title, `${w}: the title is real text`);
        assert.deepEqual(s.lines, fx.lines, `${w}: the lines are real text`);
        assert.equal(s.date, 'Thu 4 pm', `${w}: the date is real text`);
        assert.equal(s.live.length, 1, `${w}: exactly one aria-live element`); assert.equal(s.live[0], 'polite', `${w}: polite`);
        // stamp
        if (fx.sure) {
          assert.ok(s.stamp, `${w}: a beat with sure carries a stamp`);
          assert.equal(s.stamp.level, fx.sure.level, `${w}: stamp level`); assert.equal(s.stamp.source, fx.sure.source, `${w}: stamp source`);
          const [a, b] = fx.sure.days; const lead = a === b ? `Day ${a}` : `Days ${a}-${b}`;
          assert.ok(s.stamp.text.includes(lead), `${w}: the stamp reads '${lead}' (got '${s.stamp.text}')`);
          assert.ok(s.stamp.text.includes(fx.sure.caption), `${w}: the stamp carries the zone caption`);
          if (fx.sure.phrase) assert.ok(s.stamp.text.includes(fx.sure.phrase), `${w}: the stamp carries the phrase`);
          assert.equal(s.stamp.texture, { hres: 'solid', blend: 'dashed', mean: 'hatch', 'hres-late': 'hatch' }[fx.sure.zone], `${w}: the stamp texture follows the zone`);
        } else assert.equal(s.stamp, null, `${w}: no stamp on ${name}`);
        // geometry
        const lim = vp.phone ? 300 : 320;
        assert.ok(s.box.h <= lim - SLACK, `${w}: card height ${s.box.h.toFixed(1)} px within ${lim} less ${SLACK} px of slack`);
        if (vp.phone) {
          assert.ok(Math.abs(s.box.l - 12) < 0.6 && Math.abs(s.vw - s.box.r - 12) < 0.6, `${w}: full width with 12 px side margins (${s.box.l}, ${s.vw - s.box.r})`);
          assert.ok(s.box.b <= s.timelineTop + 0.5, `${w}: docked above the timeline (bottom ${s.box.b}, timeline top ${s.timelineTop})`);
        } else {
          assert.ok(Math.abs(s.box.w - 420) < 0.6, `${w}: 420 px wide (${s.box.w})`);
          assert.ok(Math.abs(s.stage.r - s.box.r - 24) < 0.6 && Math.abs(s.stage.b - s.box.b - 24) < 0.6, `${w}: 24 px from the stage's right and bottom (${s.stage.r - s.box.r}, ${s.stage.b - s.box.b})`);
        }
        // type, clipping, contrast
        for (const t of s.texts) {
          const cls = String(t.cls);
          if (/brief-line/.test(cls)) assert.ok(t.size >= (vp.phone ? 15 : 14), `${w}: line text ${t.size}px`);
          if (/brief-kicker|brief-stamp/.test(cls)) assert.ok(t.size >= 12, `${w}: ${cls} ${t.size}px`);
          assert.ok(t.size >= 12, `${w}: '${t.text}' ${t.size}px under 12`);
          assert.ok(t.clipH <= 0 && t.clipW <= 0 && !t.ellipsis, `${w}: '${t.text}' (${cls}) is clipped (scroll-client ${t.clipH} x ${t.clipW})`);
          assert.ok(t.outside <= 0.5, `${w}: '${t.text}' sticks out of the card by ${t.outside}`);
          assert.ok(t.ratio >= 4.5, `${w}: '${t.text}' (${cls}) contrast ${t.ratio.toFixed(2)} under 4.5`);
        }
        // controls
        const names = s.buttons.map((b) => b.text);
        const wantEnd = ['Replay', 'Explore from here', 'Close'];
        if (name === 'end') { assert.deepEqual(names.sort(), [...wantEnd].sort(), `${w}: end controls ${names}`); }
        else assert.deepEqual(names.sort(), ['Back', 'Close', 'Next', 'Pause'], `${w}: controls ${names}`);
        for (const b of s.buttons) {
          if (vp.phone) assert.ok(b.w >= 44 && b.h >= 44, `${w}: '${b.text}' ${b.w}x${b.h} under 44x44`);
          else assert.ok(b.h >= 32, `${w}: '${b.text}' ${b.h} px high under 32`);
        }
        if (!first) continue;
      }
      first = false;

      // ---- end beat with no people and no trip also offers Add; the full script does not
      await show('end', { which: 'noPeople' });
      s = await m();
      assert.deepEqual(s.buttons.map((b) => b.text).sort(), ['Add', 'Close', 'Explore from here', 'Replay'], `${label}: end of a script with no people and no trip offers Add`);
      for (const b of s.buttons) vp.phone ? assert.ok(b.w >= 44 && b.h >= 44, `${label}: end '${b.text}' ${b.w}x${b.h}`) : assert.ok(b.h >= 32);
      assert.ok(s.box.h <= (vp.phone ? 300 : 320) - SLACK, `${label}: end card with Add is ${s.box.h} px high`);
      for (const t of s.texts) assert.ok(t.clipH <= 0 && t.clipW <= 0, `${label}: end '${t.text}' clipped`);

      // ---- paused: the button reads Play; a long zone caption set by the wiring does not clip
      await show('trip', { state: 'paused', caption: 'one forecast, no ensemble average in this run · pattern only' });
      s = await m();
      assert.equal(s.attrs.state, 'paused', `${label}: paused state`); assert.ok(s.buttons.some((b) => b.text === 'Play') && !s.buttons.some((b) => b.text === 'Pause'), `${label}: paused shows Play`);
      assert.ok(s.stamp.text.includes('one forecast, no ensemble average in this run'), `${label}: setZoneCaption replaces the caption`);
      assert.ok(s.box.h <= (vp.phone ? 300 : 320) - SLACK, `${label}: the stamp with the longest caption is ${s.box.h.toFixed(1)} px high`);
      for (const t of s.texts) assert.ok(t.clipH <= 0 && t.clipW <= 0 && t.ratio >= 4.5, `${label}: long-caption beat '${t.text}' clipped or low contrast`);

      // ---- segments: one per beat except title and end; the current fills with progress; a rewind beat empties
      await show('home', { progress: 0.25 }); s = await mw();
      assert.equal(s.segs.role, 'progressbar', `${label}: segs role`); assert.equal(s.segs.n, 5, `${label}: five segments for a seven-beat script`);
      const fill1 = s.segs.fills[1]; const now1 = +s.segs.now;
      assert.deepEqual(s.segs.fills.slice(0, 1), [1], `${label}: earlier segments are full`); assert.deepEqual(s.segs.fills.slice(2), [0, 0, 0], `${label}: later segments are empty`);
      await page.eval(`__brief.card.setProgress(0.75)`); s = await mw();
      assert.ok(s.segs.fills[1] > fill1 && +s.segs.now > now1, `${label}: the current segment fills with setProgress (${fill1} -> ${s.segs.fills[1]}, now ${now1} -> ${s.segs.now})`);
      await show('rewind', { which: 'noPeople', progress: 0.2 }); s = await mw(); const r0 = s.segs.fills[2];
      await page.eval(`__brief.card.setProgress(0.8)`); s = await mw();
      assert.ok(s.segs.fills[2] < r0, `${label}: a rewind beat's segment empties as progress runs (${r0} -> ${s.segs.fills[2]})`);
      await show('title'); s = await mw(); assert.ok(s.segs.fills.every((f) => f === 0), `${label}: title: segments empty`);
      await show('end'); s = await mw(); assert.ok(s.segs.fills.every((f) => f === 1), `${label}: end: segments full`);

      // ---- strip slot: shows the SVG, and takes no height without one
      await show('home'); s = await m();
      assert.ok(s.strip.hasSvg && s.strip.h > 20, `${label}: strip slot shows the SVG (${s.strip.h} px)`);
      await show('home', { withStrip: false }); s = await m();
      assert.ok(s.strip.h === 0, `${label}: with no strip the slot takes no height (${s.strip.h})`);

      // ---- announcements: once per beat change, not on progress or date ticks
      await show('hold'); await sleep(50);
      await page.eval(`(() => { const l = document.querySelector('#brief-card [aria-live]'); window.__ann = []; new MutationObserver(() => window.__ann.push(l.textContent)).observe(l, { childList: true, characterData: true, subtree: true }); })()`);
      await page.eval(`__brief.card.setProgress(0.6); __brief.card.setDate('Thu 5 pm'); __brief.card.setState('paused'); __brief.card.setState('playing');`);
      await show('hold', { progress: 0.9 }); await sleep(80);
      assert.equal(await page.eval('window.__ann.length'), 0, `${label}: no announcement without a beat change`);
      await show('sure'); await sleep(80);
      const ann = await page.eval('window.__ann');
      assert.ok(ann.length >= 1 && ann.at(-1).includes('Where the forecasts agree'), `${label}: a beat change is announced (${JSON.stringify(ann)})`);
      assert.ok(new Set(ann).size === 1 || ann.length === 1 || ann.slice(0, -1).every((a) => a === ''), `${label}: announced once (${JSON.stringify(ann)})`);

      // ---- callbacks fired by real clicks
      await show('home'); await page.eval('__brief.calls.length = 0'); await sleep(40);
      for (const [act, want] of [['pause', 'pause'], ['prev', 'prev'], ['next', 'next']]) {
        await press(vp, btn(act)); await sleep(40);
        assert.equal(await page.eval('__brief.calls.at(-1)'), want, `${label}: ${act} click fires ${want}`);
        if (act === 'pause') { await page.eval(`__brief.card.setState('paused')`); await press(vp, btn('pause')); await sleep(40); assert.equal(await page.eval('__brief.calls.at(-1)'), 'resume', `${label}: Play fires resume`); await page.eval(`__brief.card.setState('playing')`); }
      }
      await show('end', { which: 'noPeople' });
      for (const act of ['replay', 'add']) { await page.eval('__brief.calls.length = 0'); await press(vp, btn(act)); await sleep(40); assert.equal(await page.eval('__brief.calls.at(-1)'), act, `${label}: ${act} click fires ${act}`); }
      await press(vp, btn('stay')); await sleep(60);
      assert.equal(await page.eval('__brief.calls.at(-1)'), 'stay', `${label}: Explore from here fires onStay`);
      // focus returns to the pill on close (the page's onClose destroys the card, as the wiring does)
      await page.eval('__brief.open(); __brief.show("home")'); await sleep(60);
      assert.equal((await m()).active, 'Pause', `${label}: reopened with focus on Pause`);
      await press(vp, btn('close')); await sleep(80);
      assert.equal(await page.eval('__brief.calls.at(-1)'), 'close', `${label}: close click fires onClose`);
      assert.equal(await page.eval(`document.activeElement && document.activeElement.id`), 'brief-pill', `${label}: focus returns to the pill after close`);
      assert.equal(await page.eval(`document.getElementById('brief-card')`), null, `${label}: destroy removes the card`);

      // ---- the pill
      const pillM = () => page.eval(`(() => { const p = document.getElementById('brief-pill'); const r = p.getBoundingClientRect(), st = document.getElementById('stage').getBoundingClientRect(), cs = getComputedStyle(p);
        return { tag: p.tagName, text: p.textContent.trim(), w: r.width, h: r.height, stageW: st.width, disabled: p.disabled, size: parseFloat(cs.fontSize), clipW: p.scrollWidth - p.clientWidth, clipH: p.scrollHeight - p.clientHeight }; })()`);
      let p = await pillM();
      assert.equal(p.tag, 'BUTTON', `${label}: pill is a button`); assert.equal(p.text, 'Play the briefing', `${label}: pill text`);
      assert.ok(p.h >= (vp.phone ? 44 : 32), `${label}: pill ${p.h} px high`);
      await page.eval(`__brief.pill.set({ text: 'Updated Thursday at 4:10 pm with a longer line of words than any phone pill will usually need to carry', isNew: true, inert: false })`); await sleep(40);
      p = await pillM();
      assert.ok(p.text.startsWith('New'), `${label}: a new briefing's pill starts with the word New (${p.text.slice(0, 20)})`);
      assert.ok(p.w <= p.stageW - 24 + 0.5, `${label}: pill ${p.w} px within the stage ${p.stageW} less 24`);
      assert.ok(p.clipW <= 0 && p.clipH <= 0, `${label}: the long pill's text is not clipped`);
      assert.ok(p.h >= (vp.phone ? 44 : 32) && p.size >= 12);
      await page.eval(`__brief.pill.set({ text: 'Play the briefing', isNew: false, inert: true })`); await sleep(30);
      assert.ok((await pillM()).disabled, `${label}: inert disables the pill`);
      await page.eval(`__brief.pill.set({ text: 'Play the briefing', isNew: false, inert: false })`); await sleep(30);
      await page.eval('__brief.calls.length = 0'); await press(vp, '#brief-pill'); await sleep(40);
      assert.equal(await page.eval('__brief.calls.at(-1)'), 'open', `${label}: the pill click fires onOpen`);
      const pc = await page.eval(`(() => { const p = document.getElementById('brief-pill'), cs = getComputedStyle(p), pr = (s) => s.match(/[\\d.]+/g).map(Number); return { fg: cs.color, bg: cs.backgroundColor }; })()`);
      assert.ok(pc.fg !== pc.bg, `${label}: pill text differs from its ground`);
    }
  }

  // ---- reduced motion: no transition or animation anywhere on the card (the tour emulates it too)
  await page.setViewport(390, 844, 1);
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await page.goto(baseUrl + 'css/tokens.css');
  await page.eval(`(() => { document.open(); document.write(${JSON.stringify(PAGE)}); document.close(); })()`);
  await page.waitFor('window.__briefReady === true', { timeout: 15000 });
  await page.eval(`__brief.show('home')`); await sleep(80);
  const rm = (await page.eval(MEASURE)).anims;
  assert.ok(rm.every((a) => a.t.split(',').every((x) => parseFloat(x) === 0) && (a.a === 'none')), `reduced motion: card transition-duration 0s and no animation (${JSON.stringify(rm.find((a) => !a.t.split(',').every((x) => parseFloat(x) === 0) || a.a !== 'none'))})`);
  // and with motion allowed, the card does animate somewhere (the check can fail on the other side)
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await page.eval(`(() => { document.open(); document.write(${JSON.stringify(PAGE)}); document.close(); })()`);
  await page.waitFor('window.__briefReady === true', { timeout: 15000 });
  await page.eval(`__brief.show('home')`); await sleep(80);
  const mv = (await page.eval(MEASURE)).anims;
  assert.ok(mv.some((a) => a.t.split(',').some((x) => parseFloat(x) > 0) || a.a !== 'none'), 'with motion allowed the card does use a transition or animation');
  { const errs = page.errors().map((e) => e.text); assert.deepEqual(errs, [], 'no console errors: ' + errs.join(' | ').slice(0, 300)); }
}
