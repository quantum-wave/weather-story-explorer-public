// S-DATESTAMP: the date stamp over the map (ui/datestamp.js, css/datestamp.css). In a fixed time zone (America/Los_Angeles, set
// through DevTools) it shows the local day and hour of a known forecast hour, worked out here with Intl from the data's valid time
// alone, in the timeline readout's words; it changes when t changes; while playing, its text is rewritten only when the shown hour
// changes; it is aria-hidden and takes no pointer; at desktop (1280 x 800) and phone (390 x 844, at peek and half) it touches none of
// the header, the map tools, Reset, the legend, the Briefing pill or the timeline; it gives way (opacity 0) while the Layers panel
// covers it. The exported GIF draws the same two lines per frame, with the zone and the UTC hour.
export const id = 'S-DATESTAMP';
export const freshProfile = true;
export const timeoutMs = 120000;

const TZ = 'America/Los_Angeles';
/** The stamp's words for an ISO instant, independently of the app: {day: 'Tue 17 Nov 2026', hour: '11 pm PST'}. */
function expected(iso, { year, exact }) {
  let d = new Date(iso);
  const parts = (x) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h12', timeZoneName: 'short' }).formatToParts(x).map((p) => [p.type, p.value]));
  if (!exact) { const m = +parts(d).minute; d = new Date(d.getTime() + ((m >= 30 ? 60 : 0) - m) * 60e3 - d.getUTCSeconds() * 1e3 - d.getUTCMilliseconds()); }
  const p = parts(d);
  const clock = p.minute === '00' ? p.hour : `${p.hour}:${p.minute}`;
  return { day: `${p.weekday} ${p.day} ${p.month}${year ? ' ' + p.year : ''}`, hour: `${clock} ${p.dayPeriod.toLowerCase()} ${p.timeZoneName}` };
}

const CONTROLS = ['#topbar', '#map-tools button', '#btn-reset', '#map-legend', '.brief-pill', '#timeline', '#brief-card', '.coach'];
const RECTS = `((sels) => { const out = []; for (const s of sels) for (const e of document.querySelectorAll(s)) { if (e.hidden || e.closest('[hidden]')) continue;
  const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility !== 'visible' || +cs.opacity === 0) continue;
  const r = e.getBoundingClientRect(); if (r.width && r.height) out.push({ sel: s, l: r.left, t: r.top, r: r.right, b: r.bottom }); } return out; })`;
const STAMP = `(() => { const e = document.querySelector('.map-stamp'); if (!e) return null; const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
  return { day: e.querySelector('.map-stamp-day')?.textContent, hour: e.querySelector('.map-stamp-hour')?.textContent, hidden: e.hidden, ariaHidden: e.getAttribute('aria-hidden'),
    pe: cs.pointerEvents, op: +cs.opacity, vis: cs.visibility, yield: e.dataset.yield || '', l: r.left, t: r.top, r: r.right, b: r.bottom,
    tUsed: +e.dataset.t, dayPx: parseFloat(getComputedStyle(e.querySelector('.map-stamp-day')).fontSize), color: cs.color }; })()`;

export async function run({ page, assert, baseUrl }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const boot = async (w, h, mobile, { tips = false } = {}) => {
    await page.send('Emulation.setTimezoneOverride', { timezoneId: TZ });
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
    if (mobile) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.goto(baseUrl);
    // the first-visit tips are marked seen unless asked for (S-EXPLAIN covers them)
    await page.eval(`localStorage.setItem('wse.v1.prefs', JSON.stringify({ ...JSON.parse(localStorage.getItem('wse.v1.prefs') || '{}'), coachSeen: ${tips ? '[]' : "['drag', 'play', 'tap']"} }))`);
    await page.goto(baseUrl);
    await page.waitFor('window.__wse && window.__wse.ready === true && window.__wse.storyReady === true', { timeout: 30000 });
    await page.waitFor(`!!document.querySelector('.brief-pill') || !!window.__wse.ui.brief`, { timeout: 10000 }).catch(() => {});
    await page.eval(`(async () => { (await import('./js/time/clock.js')).pause(); return true; })()`);
    await sleep(400);
  };
  const clockRange = () => page.eval(`import('./js/time/clock.js').then((c) => c.range())`);
  const at = async (t) => {
    await page.eval(`__wse.store.set({ t: ${t}, playing: false })`); await sleep(120);
    return { s: await page.eval(STAMP), iso: await page.eval(`__wse.data.validTime(${t}).toISOString()`), sample: await page.eval(`!!__wse.store.get().sample`) };
  };
  const clear = async (what) => {
    const s = await page.eval(STAMP);
    assert.ok(s && !s.hidden && s.op > 0 && s.vis === 'visible', `${what}: the stamp is showing: ${JSON.stringify(s)}`);
    const hits = (await page.eval(`${RECTS}(${JSON.stringify(CONTROLS)})`)).filter((c) => Math.min(c.r, s.r) - Math.max(c.l, s.l) > 0.5 && Math.min(c.b, s.b) - Math.max(c.t, s.t) > 0.5);
    assert.deepEqual(hits.map((c) => c.sel), [], `${what}: the stamp ${JSON.stringify([s.l, s.t, s.r, s.b].map(Math.round))} touches no control: ${JSON.stringify(hits)}`);
    return s;
  };

  // ---- desktop
  await boot(1280, 800, false);
  const [lo, hi] = await clockRange();
  const t1 = lo + 30;
  let r = await at(t1);
  assert.ok(r.s, 'a .map-stamp is mounted over the map');
  assert.equal(r.s.ariaHidden, 'true', 'the stamp is hidden from assistive tech (the timeline announces the time)');
  assert.equal(r.s.pe, 'none', 'the stamp takes no pointer');
  assert.ok(r.s.dayPx >= 32, 'desktop: the day is large (>= 32 px): ' + r.s.dayPx);
  const alpha = +(/rgba?\([^)]*,\s*([\d.]+)\)/.exec(r.s.color)?.[1] ?? 1);
  assert.ok(alpha >= 0.45 && alpha <= 0.8, 'the letters are translucent (alpha 0.45-0.8): ' + r.s.color);
  let want = expected(r.iso, { year: r.sample, exact: true });
  assert.deepEqual({ day: r.s.day, hour: r.s.hour }, want, `t=${t1} (${r.iso}) in ${TZ}`);
  const tl = await page.eval(`document.querySelector('#timeline .tl-time-main')?.textContent`);
  assert.equal(`${r.s.day} · ${r.s.hour}`, tl, 'the stamp says what the timeline readout says, in the same zone');
  await clear('desktop');
  // another t: the words follow
  const t2 = Math.min(hi, t1 + 17);
  r = await at(t2);
  want = expected(r.iso, { year: r.sample, exact: true });
  assert.deepEqual({ day: r.s.day, hour: r.s.hour }, want, `after t changes to ${t2}`);
  // paused off a step, 40 s before the next hour: the stamp keeps the timeline's minute (seconds dropped, not rounded up to the next hour)
  const tf = Math.min(hi, t1) + 3580 / 3600;
  r = await at(tf);
  assert.ok(new Date(r.iso).getUTCSeconds() >= 30, `t=${tf} lands 30 s or more into a minute: ${r.iso}`);
  want = expected(r.iso, { year: r.sample, exact: true });
  assert.deepEqual({ day: r.s.day, hour: r.s.hour }, want, `paused at t=${tf} (${r.iso}): the minute the timeline shows`);
  const tlf = await page.eval(`document.querySelector('#timeline .tl-time-main')?.textContent`);
  assert.equal(`${r.s.day} · ${r.s.hour}`, tlf, `paused at t=${tf}: the stamp says what the timeline readout says`);
  // ---- playing: the text is rewritten only when the shown hour changes, and it is the nearest hour
  await page.eval(`(() => { window.__stampWrites = 0; window.__stampFrames = 0; const e = document.querySelector('.map-stamp');
    new MutationObserver((m) => { window.__stampWrites += m.filter((x) => x.type === 'childList' || x.type === 'characterData').length; }).observe(e, { subtree: true, childList: true, characterData: true });
    window.__stampSeen = new Set(); const off = __wse.store.subscribe((s) => { window.__stampFrames++; window.__stampSeen.add(e.querySelector('.map-stamp-hour').textContent); }); window.__stampOff = off; return true; })()`);
  await page.eval(`(async () => { const c = await import('./js/time/clock.js'); __wse.store.set({ t: ${lo} }); c.play(); return true; })()`);
  await sleep(1500);
  const play = await page.eval(`(async () => { window.__stampOff?.(); const c = await import('./js/time/clock.js'); c.pause(); const s = __wse.store.get();
    return { writes: __stampWrites, frames: __stampFrames, hours: [...__stampSeen], t: s.t }; })()`);
  assert.ok(play.frames >= 20, 'the clock wrote t many times while playing: ' + JSON.stringify(play));
  assert.ok(play.hours.length >= 3, 'the shown hour changed while playing: ' + JSON.stringify(play.hours));
  assert.ok(play.writes <= 2 * play.hours.length + 6 && play.writes < play.frames, `text rewritten only when the hour changes (${play.writes} writes, ${play.frames} frames, ${play.hours.length} hours)`);
  assert.ok(play.hours.every((h) => /^\d{1,2} (am|pm) \S+$/.test(h)), 'while playing the hour is whole: ' + JSON.stringify(play.hours));
  // the playing words for a known t are its nearest local hour
  const tp = lo + 30.7; // 42 minutes past: the nearest hour is the next one, not the one it is in
  await page.eval(`__wse.store.set({ t: ${tp}, playing: true })`); await sleep(80);
  const sp2 = await page.eval(STAMP); // the clock may have moved t on: the stamp records the t it shows
  const isoP = await page.eval(`__wse.data.validTime(${sp2.tUsed}).toISOString()`);
  await page.eval(`__wse.store.set({ playing: false })`);
  assert.ok(Math.abs(sp2.tUsed - tp) < 2, 'the stamp shows the t just set: ' + sp2.tUsed);
  assert.deepEqual({ day: sp2.day, hour: sp2.hour }, expected(isoP, { year: r.sample, exact: false }), `playing at t=${sp2.tUsed}: the nearest hour`);

  // ---- the GIF draws the same two lines (zone and UTC on the hour line)
  const gif = await page.eval(`(async () => {
    window.__drawn = []; const o = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (s, ...a) { window.__drawn.push(String(s)); return o.call(this, s, ...a); };
    const X = await import('./js/share/export.js');
    try { await X.exportLoop({ from: ${lo}, to: ${lo + 6} }); } finally { CanvasRenderingContext2D.prototype.fillText = o; }
    const times = X.frameTimes(${lo}, ${lo + 6}, __wse.store.get().speed);
    return { drawn: window.__drawn, isos: times.map((t) => __wse.data.validTime(t).toISOString()) }; })()`);
  const g0 = expected(gif.isos[0], { year: r.sample, exact: true });
  assert.ok(gif.drawn.includes(g0.day), `the GIF's first frame draws the day "${g0.day}"`);
  const utc = `${String(new Date(gif.isos[0]).getUTCHours()).padStart(2, '0')}Z`;
  assert.ok(gif.drawn.includes(`${g0.hour} (${utc})`), `the GIF's first frame draws "${g0.hour} (${utc})": ${JSON.stringify(gif.drawn.filter((x) => /Z\)$/.test(x)).slice(0, 3))}`);
  assert.ok(!gif.drawn.some((x) => /^\w{3} \d{1,2} \w{3}( \d{4})?, /.test(x)), 'no one-line date chip left in the GIF');

  // ---- phone, at peek and half, Regional and after a pan (Reset shown)
  await boot(390, 844, true);
  r = await at(lo + 30);
  assert.ok(r.s.dayPx >= 24, 'phone: the day is still large (>= 24 px): ' + r.s.dayPx);
  assert.deepEqual({ day: r.s.day, hour: r.s.hour }, expected(r.iso, { year: r.sample, exact: true }), 'phone words');
  for (const snap of ['peek', 'half']) {
    await page.eval(`__wse.store.set({ sheet: '${snap}' })`); await sleep(600);
    await clear(`phone ${snap}`);
  }
  await page.eval(`__wse.store.set({ sheet: 'peek' })`); await sleep(500);
  await page.eval(`(async () => { await __wse.renderer.centreOn(37.77, -122.42, 0, 2); return true; })()`); await sleep(600);
  assert.equal(await page.eval(`!document.getElementById('btn-reset')?.hidden`), true, 'phone: Reset view is showing after the zoom');
  await clear('phone, zoomed (Reset shown)');
  await page.eval(`__wse.store.set({ sheet: 'full' })`); await sleep(600);
  const full = await page.eval(STAMP);
  assert.ok(full.vis !== 'visible' || full.op === 0, 'phone full sheet: the stamp is not drawn under the sheet');
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));

  // ---- a first visit on the phone: the first tip lands over the stamp's corner, and the stamp gives way until it goes
  await boot(390, 844, true, { tips: true });
  await page.waitFor(`!!document.querySelector('.coach')`, { timeout: 10000 });
  await sleep(500);
  const tip = await page.eval(`(() => { const c = document.querySelector('.coach'), e = document.querySelector('.map-stamp'); const a = c.getBoundingClientRect(), b = e.getBoundingClientRect();
    return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5; })()`);
  const sy = await page.eval(STAMP);
  if (tip) assert.ok(sy.op === 0 && sy.yield === '.coach', 'the stamp gives way while the tip overlaps it: ' + JSON.stringify(sy));
  else await clear('phone, first tip showing');
  await page.eval(`document.querySelector('.coach-skip').click()`); await sleep(500);
  await clear('phone, tips skipped');
}
