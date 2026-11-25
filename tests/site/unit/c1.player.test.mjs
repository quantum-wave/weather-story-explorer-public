// C1-02: the Briefing's player on a fake clock, with fakes for store, clock, renderer and story that record every call in order.
// No browser, no real timers: the raf loop is stepped by hand and `now` is the fake time.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const site = new URL('../../../site/js/', import.meta.url);
const { createPlayer, hoursOf, HOLD_SKIP_MS } = await import(new URL('brief/player.js', site).href);
const { choice } = await import(new URL('state.js', site).href);
const { BRIEF_KEY } = await import(new URL('brief/contract.js', site).href);

/** The renderer's public surface after this package: the test fails on a call to anything else. */
const RENDERER_API = ['draw', 'resize', 'setView', 'centreOn', 'resetView', 'project', 'invert', 'addOverlay', 'setPadding', 'getTransform', 'setTransform', 'stats', 'sampleAt', 'ensureFor', 'renderTo', 'destroy'];

function world({ state = {}, rangeHi = 360, k = 2, lateCamera = false, glide = false, reduced = false, rate = 1, beats, gate = null } = {}) {
  const log = [];
  let time = 1000, nextId = 1;
  const pending = new Map(); // raf id -> callback
  const subs = new Set();
  let st = { view: 'np', lens: 'z', t: 30, playing: true, speed: 12, focus: { lat: 1, lon: 2 }, expanded: false, overlays: { contours: true, doubt: false, pins: true }, sheet: 'half', range: 10, ...state };
  const store = {
    get: () => st,
    set(patch) { log.push(['store.set', patch]); const next = { ...st, ...patch }; if (patch.overlays) next.overlays = { ...st.overlays, ...patch.overlays }; st = next; for (const f of [...subs]) f(st, patch); },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
  const clock = {
    pause() { log.push(['clock.pause']); store.set({ playing: false }); },
    // like the real clock: the loop range follows store.range (days), and seek clamps to it
    range: () => [0, Number.isFinite(st.range) ? Math.min(rangeHi, st.range * 24) : rangeHi],
    seek(t) { log.push(['clock.seek', t]); store.set({ t: Math.max(0, Math.min(clock.range()[1], t)) }); },
    reducedMotion: () => false,
  };
  const gates = []; // controllable ensureFor
  const cameraGates = []; // controllable centreOn
  // glide: like render/index.js animateTo, k moves from where it is to the target over `ms` of frames and the promise resolves on
  // landing; a new move cancels the old one, whose promise then never resolves; 0 ms lands at once. With lateCamera, a move with
  // ms > 0 never starts and its promise waits on cameraGates (a glide that never reports back).
  let xf = { k, tx: 5, ty: 6, rot: [1, 2, 3] }, anim = null;
  const moveTo = (to, ms) => {
    anim = null;
    if (!ms) { xf = { ...xf, k: to }; return Promise.resolve(); }
    if (lateCamera) return new Promise((res) => cameraGates.push(res));
    return new Promise((res) => { anim = { from: xf.k, to, start: time, ms, res }; });
  };
  const stepGlide = () => {
    if (!anim) return;
    const u = Math.min(1, (time - anim.start) / anim.ms); xf = { ...xf, k: anim.from + (anim.to - anim.from) * u };
    if (u >= 1) { const r = anim.res; anim = null; r(); }
  };
  const real = {
    ensureFor(o) { log.push(['ensureFor', o.view, o.lens, o.t]); if (!gate) return Promise.resolve(); return new Promise((res) => gates.push({ o, res })); },
    centreOn(...a) { log.push(['centreOn', ...a]); if (glide) return moveTo(a[3], a[2]); return lateCamera ? new Promise((res) => cameraGates.push(res)) : Promise.resolve(); },
    resetView(...a) { log.push(['resetView', ...a]); return glide ? moveTo(1, a[0]) : Promise.resolve(); },
    getTransform: () => (glide ? { ...xf } : { k, tx: 5, ty: 6, rot: [1, 2, 3] }),
    setTransform(x, ms) { log.push(['setTransform', x, ms]); return Promise.resolve(); },
  };
  const renderer = new Proxy(real, { get(o, k) { if (typeof k === 'symbol' || k === 'then') return undefined; if (!RENDERER_API.includes(k)) throw new Error(`renderer.${String(k)} is not a renderer method`); if (!(k in o)) throw new Error(`the player called renderer.${k}, which this fake does not provide`); return o[k]; } });
  const story = { ensureStoryData(lat, lon) { log.push(['ensureStoryData', lat, lon]); return gate ? new Promise((res) => gates.push({ story: true, res })) : Promise.resolve(); } };
  const app = { store, clock, renderer, story, now: () => 1.7e12 };
  const storage = { data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; } };
  const raf = (fn) => { const id = nextId++; pending.set(id, fn); return id; };
  const caf = (id) => { pending.delete(id); };
  const script = { run: '2026-11-20T00:00Z', beats: beats || defaultBeats(), totalMs: 0, sample: false, dataLabel: 'x', morePeople: 0 };
  const player = createPlayer({ app, script, raf, caf, now: () => time, reduced, rate, storage });
  const frame = (ms = 16) => { time += ms; stepGlide(); const fns = [...pending]; pending.clear(); for (const [, fn] of fns) fn(time); };
  const advance = (ms) => { for (let left = ms; left > 0; left -= 16) frame(Math.min(16, left)); };
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const events = []; for (const n of ['beat', 'tick', 'state', 'exit']) player.on(n, (d) => events.push([n, d]));
  return { player, log, store, subs, pending, gates, cameraGates, frame, advance, flush, events, storage, script, now: () => time, k: () => real.getTransform().k };
}

const B = (id, o = {}) => ({ id, chapter: 'picture', kicker: 'k', title: id, lines: [], view: 'nh', lens: 'z', camera: null, t0: 0, t1: 48, ms: 1000, place: null, sure: null, strip: false, ...o });
const defaultBeats = () => [
  B('a', { t0: 0, t1: 48, ms: 1000 }),
  B('b', { view: 'np', lens: 's', t0: 24, t1: 72, ms: 2000, camera: { lat: 37.8, lon: -122.4, zoom: 2 }, place: { key: 'home', kind: 'home', name: 'Home', city: 'SF', lat: 37.8, lon: -122.4 } }),
  B('c', { view: 'nh', lens: 'c', t0: 168, t1: 72, ms: 1000 }), // a rewind
];

test('player: no browser, the fake renderer lists exactly the real method set and rejects anything else', async () => {
  const w = world();
  const stray = new Proxy({}, { get(_o, k) { if (typeof k === 'symbol' || k === 'then') return undefined; throw new Error(`renderer.${String(k)} is not a renderer method`); } });
  const p = createPlayer({ app: { store: w.store, clock: w.player && { pause() {}, seek() {}, range: () => [0, 360], reducedMotion: () => false }, story: { ensureStoryData: () => Promise.resolve() }, renderer: stray }, script: { beats: [B('x')] }, raf: () => 1, now: () => 0 });
  assert.throws(() => p.start(), /renderer\.(getTransform|ensureFor) is not a renderer method/, 'the guard names the forbidden renderer method');
  // and the real fake: every method the player calls is on the list
  const w2 = world(); w2.player.start(); await w2.flush(); w2.advance(3500); w2.player.exit();
});

// The behaviour (setTransform(getTransform()) leaves the transform unchanged, ms 0 and 300, desktop and phone) runs in S-GESTURE part 11.
test('render/index.js: one new public method beside getTransform, setTransform(x, ms = 0)', () => {
  const src = fs.readFileSync(new URL('render/index.js', site), 'utf8');
  assert.match(src, /setTransform\(x, ms = 0\) \{ return animateTo\(\{ k: x\.k, tx: x\.tx, ty: x\.ty, rot: rot3\(x\.rot\) \}, ms\); \}/);
  const api = src.slice(src.indexOf('const api = {'));
  const methods = [...api.matchAll(/^ {4}(?:async )?([a-zA-Z]+)(?:\(|:|,)/gm)].map((m) => m[1]);
  if (/^ {4}draw: drawNow, resize,/m.test(api)) methods.push('resize');
  assert.deepEqual([...methods].sort(), [...RENDERER_API].sort(), 'the renderer API is the documented list plus setTransform and nothing else');
});

test('rate: divides every beat ms; progress is 0..1 within the beat', async () => {
  for (const rate of [1, 2]) {
    const w = world({ rate });
    w.player.start(); await w.flush();
    assert.equal(w.player.state(), 'playing');
    w.advance(1000 / rate / 2);
    assert.ok(Math.abs(w.player.progress() - 0.5) < 0.05, `rate ${rate}: progress ${w.player.progress()}`);
    w.advance(1000 / rate / 2 + 40);
    assert.equal(w.player.index(), 1, `rate ${rate}: beat 0 over after ms / rate`);
  }
});

test('start records the prior state, pauses the clock, expands and turns doubt on; exit restores it with store.set', async () => {
  const w = world();
  const before = { ...w.store.get() };
  w.player.start(); await w.flush();
  assert.equal(w.store.get().playing, false);
  assert.equal(w.store.get().expanded, true);
  assert.equal(w.store.get().overlays.doubt, true);
  w.advance(3500);
  assert.notEqual(w.store.get().view, before.view === 'np' ? 'zz' : 'np');
  w.player.exit();
  const after = w.store.get();
  for (const k of ['view', 'lens', 'playing', 'speed', 'expanded', 'sheet', 't']) assert.strictEqual(after[k], before[k], k);
  assert.strictEqual(after.focus, before.focus);
  assert.deepEqual(after.overlays, before.overlays);
  assert.equal(choice(after, 'range'), choice(before, 'range'));
  assert.equal(choice(after, 'lens'), choice(before, 'lens'));
  const last = w.log.filter((e) => e[0] === 'setTransform').pop();
  assert.deepEqual(last[1], { k: 2, tx: 5, ty: 6, rot: [1, 2, 3] });
  const iSet = w.log.findLastIndex((e) => e[0] === 'store.set' && e[1].view !== undefined), iTr = w.log.findLastIndex((e) => e[0] === 'setTransform');
  assert.ok(iTr > iSet, 'the transform is restored after the view');
  assert.equal(w.player.state(), 'idle');
});

test('exit restores a recorded playing:false, even after the app clock was started from outside mid-briefing', async () => {
  for (const outside of [false, true]) {
    const w = world({ state: { playing: false } });
    const before = { ...w.store.get() };
    w.player.start(); await w.flush(); w.advance(600);
    if (outside) { w.store.set({ playing: true }); assert.equal(w.player.state(), 'paused', 'an outside play pauses the player (M8)'); }
    w.player.exit();
    const after = w.store.get();
    assert.strictEqual(after.playing, false, `outside play ${outside}: the clock the person had stopped stays stopped after exit`);
    for (const k of ['view', 'lens', 'speed', 'expanded', 'sheet', 't', 'focus']) assert.strictEqual(after[k], before[k], `${k} (outside play ${outside})`);
    const iSeek = w.log.findLastIndex((e) => e[0] === 'clock.seek'), iPlay = w.log.findLastIndex((e) => e[0] === 'store.set' && 'playing' in e[1]);
    assert.ok(iPlay > iSeek, 'playing is put back with store.set after the seek');
  }
});

test('exit: keys that were absent are set to undefined, so the choice default returns', async () => {
  const w = world({ state: { range: undefined, lens: undefined, sheet: undefined } });
  delete w.store.get().range; delete w.store.get().lens; delete w.store.get().sheet;
  w.player.start(); await w.flush(); w.advance(1200);
  w.player.exit();
  const s = w.store.get();
  assert.equal(s.lens, undefined); assert.equal(s.range, undefined); assert.equal(s.sheet, undefined);
  assert.equal(choice(s, 'lens'), 'z'); assert.equal(choice(s, 'range'), 7);
});

test('exit({stay}) restores expanded, overlays, range and sheet but keeps view, lens, t, focus and transform', async () => {
  const w = world();
  w.player.start(); await w.flush(); w.advance(1300);
  const mid = { ...w.store.get() };
  assert.equal(mid.view, 'np'); // beat b
  w.player.exit({ stay: true });
  const s = w.store.get();
  assert.equal(s.expanded, false); assert.equal(s.sheet, 'half'); assert.equal(s.range, 10); assert.equal(s.overlays.doubt, false);
  for (const k of ['view', 'lens', 't', 'focus']) assert.strictEqual(s[k], mid[k], k);
  assert.ok(!w.log.some((e) => e[0] === 'setTransform'), 'the transform is not touched');
  assert.equal(w.events.at(-1)[1].stay, true);
});

test('per beat, in order: ensureFor at t0, t1 and every 24 h between, ensureStoryData, set view and lens, camera, then t moves linearly', async () => {
  const w = world();
  w.player.start(); await w.flush();
  const first = w.log.map((e) => e[0] + (e[0] === 'ensureFor' ? `:${e[3]}` : ''));
  assert.deepEqual(hoursOf(w.script.beats[0]), [0, 48, 24]);
  const iA = first.indexOf('ensureFor:0'), iB = first.indexOf('ensureFor:48'), iC = first.indexOf('ensureFor:24');
  const iView = w.log.findIndex((e) => e[0] === 'store.set' && e[1].view === 'nh' && e[1].lens === 'z'), iCam = first.indexOf('resetView'), iSeek = first.indexOf('clock.seek');
  assert.ok(iA >= 0 && iB >= 0 && iC >= 0);
  assert.ok(Math.max(iA, iB, iC) < iView && iView < iCam && iCam < iSeek, `order ${first.join(' ')}`);
  w.advance(500); const t = w.store.get().t;
  assert.ok(Math.abs(t - 24) < 3, `t at the half of a 0..48 beat is ${t}`);
  // beat b: centreOn with the beat's zoom over 600 ms, ensureStoryData for its place
  w.advance(600);
  assert.ok(w.log.some((e) => e[0] === 'centreOn' && e[1] === 37.8 && e[2] === -122.4 && e[3] === 600 && e[4] === 2));
  assert.ok(w.log.some((e) => e[0] === 'ensureStoryData' && e[1] === 37.8));
  assert.equal(w.events.filter(([n, d]) => n === 'beat' && d.index === 0).length, 1, "'beat' fires once per beat");
  assert.ok(w.events.some(([n]) => n === 'tick'));
});

test('a rewind beat moves store.t down, linearly, and ends exactly on t1', async () => {
  const w = world();
  w.player.start(); await w.flush(); w.player.goTo(2); await w.flush();
  assert.equal(w.store.get().t, 168);
  const seen = [];
  for (let i = 0; i < 70 && w.player.index() === 2; i++) { w.frame(); seen.push(w.store.get().t); }
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] <= seen[i - 1] + 1e-9, 'never up');
  assert.ok(seen.some((t) => t < 168 && t > 72));
  assert.equal(w.player.state(), 'ended');
  assert.equal(w.store.get().t, 72);
});

test('holding: store.t does not change and no tick fires until the data arrives, then the beat plays from t0', async () => {
  const w = world({ gate: true });
  w.player.start(); await w.flush();
  assert.equal(w.player.state(), 'holding');
  const t0 = w.store.get().t, ticks = w.events.filter(([n]) => n === 'tick').length;
  w.advance(3000);
  assert.equal(w.store.get().t, t0); assert.equal(w.events.filter(([n]) => n === 'tick').length, ticks);
  assert.ok(!w.log.some((e) => e[0] === 'clock.seek'));
  for (const g of w.gates.splice(0)) g.res();
  await w.flush();
  assert.equal(w.player.state(), 'playing');
  assert.equal(w.store.get().t, 0, 'plays from t0');
  assert.ok(w.log.some((e) => e[0] === 'store.set' && e[1].view === 'nh' && e[1].lens === 'z'), 'the view and lens are set once the data is here');
});

test('a beat still holding after 8 s of fake time is skipped and beat fires for the next', async () => {
  const w = world({ gate: true });
  w.player.start(); await w.flush();
  assert.equal(HOLD_SKIP_MS, 8000);
  w.advance(7800); assert.equal(w.player.index(), 0);
  w.advance(400);
  assert.equal(w.player.index(), 1);
  assert.deepEqual(w.events.filter(([n]) => n === 'beat').map(([, d]) => d.index), [0, 1]);
  assert.equal(w.player.state(), 'holding');
  assert.ok(!w.log.some((e) => e[0] === 'clock.seek'), 'the skipped beat never moved the clock');
});

test('preload: ensureFor for beat i+1 is called before beat i ends', async () => {
  const w = world();
  w.player.start(); await w.flush();
  const i = w.log.findIndex((e) => e[0] === 'ensureFor' && e[1] === 'np' && e[2] === 's');
  assert.ok(i >= 0, 'beat b is requested while beat a plays');
  assert.equal(w.player.index(), 0);
});

test('pause freezes t and progress; resume continues; next and prev land on the start of the neighbour; prev on the first restarts it', async () => {
  const w = world();
  w.player.start(); await w.flush(); w.advance(400);
  w.player.pause();
  const t = w.store.get().t, p = w.player.progress();
  assert.equal(w.player.state(), 'paused');
  assert.equal(w.pending.size, 0, 'no frame is requested while paused');
  w.advance(2000);
  assert.equal(w.store.get().t, t); assert.equal(w.player.progress(), p);
  w.player.resume(); w.advance(160);
  assert.ok(w.player.progress() > p && w.player.progress() < p + 0.3);
  w.player.next(); await w.flush();
  assert.equal(w.player.index(), 1); assert.equal(w.store.get().t, 24);
  w.advance(500); w.player.prev(); await w.flush();
  assert.equal(w.player.index(), 0); assert.equal(w.store.get().t, 0);
  w.advance(300); w.player.prev(); await w.flush();
  assert.equal(w.player.index(), 0); assert.equal(w.store.get().t, 0, 'prev on the first beat restarts it');
  assert.equal(w.player.progress(), 0);
  w.player.goTo(2); w.player.next(); await w.flush();
  assert.equal(w.player.state(), 'ended');
});

test('range: a beat past clock.range() sets range 15 for that beat and the recorded range returns on exit', async () => {
  const w = world({ state: { range: 3 } }); // 72 h loop range
  w.player.start(); await w.flush();
  assert.equal(w.store.get().range, 3, 'beat a ends at 48: inside');
  w.player.goTo(2); await w.flush();
  assert.equal(w.store.get().range, 15);
  w.player.goTo(0); await w.flush();
  assert.equal(w.store.get().range, 3, 'back inside: the recorded range');
  w.player.goTo(2); await w.flush();
  w.player.exit();
  assert.equal(w.store.get().range, 3);
});

test('range: two wide beats in a row both reach t1 (the second is judged by its own need, not the range the first left)', async () => {
  const beats = [B('w1', { t0: 240, t1: 360, ms: 1000 }), B('w2', { t0: 240, t1: 360, ms: 1000 }), B('n', { t0: 0, t1: 48, ms: 1000 })];
  const w = world({ state: { range: 7 }, beats });
  w.player.start(); await w.flush();
  for (const i of [0, 1]) {
    assert.equal(w.player.index(), i);
    assert.equal(w.store.get().range, 15, `beat ${i} runs at range 15`);
    let peak = 0;
    w.player.on('state', () => {}); // the store, not the tick events, is what the map draws from
    const off = []; const unsub = w.store.subscribe((st) => { if (w.player.index() === i) off.push(st.t); });
    for (let n = 0; n < 90 && w.player.index() === i; n++) { w.frame(); await w.flush(); }
    unsub(); peak = Math.max(...off);
    assert.equal(peak, 360, `beat ${i}: store.t reaches t1`);
  }
  assert.equal(w.player.index(), 2);
  assert.equal(w.store.get().range, 7, 'a beat inside the recorded range puts it back');
  w.player.exit();
  assert.equal(w.store.get().range, 7);
});

test('camera: while a glide to a lower zoom is under way, store.t stays on the hour already on screen and no beat time counts; t0 comes once the camera lands', async () => {
  const beats = [B('h', { t0: 56, t1: 152, ms: 1000, camera: { lat: 1, lon: 2, zoom: 2 } })];
  const w = world({ beats, k: 3, lateCamera: true }); // the viewer was at t 30 at zoom 3
  w.player.start(); await w.flush(); w.advance(900);
  assert.equal(w.cameraGates.length, 1);
  assert.equal(w.store.get().t, 30, 'the hour already on screen at zoom 3 stays while the camera is above the beat cap');
  assert.ok(!w.log.some((e) => e[0] === 'clock.seek'), 'the beat t0 is not sought during the hold');
  assert.equal(w.player.progress(), 0);
  assert.ok(!w.events.some(([n, d]) => n === 'tick' && d.progress > 0), 'no tick with progress before the camera lands');
  w.cameraGates.splice(0).forEach((r) => r()); await w.flush();
  assert.equal(w.store.get().t, 56, 'the beat starts at t0 once the camera lands');
  w.advance(500);
  assert.ok(w.store.get().t > 56, `t moves after the camera lands (${w.store.get().t})`);
  assert.ok(w.player.progress() > 0.3 && w.player.progress() < 0.7, `only post-landing time counts (${w.player.progress()})`);
  // a glide that never reports back does not stall the film, and the wait cap cuts the camera to the beat's zoom before t0 shows
  const w2 = world({ beats, k: 3, lateCamera: true });
  w2.player.start(); await w2.flush(); w2.advance(1900);
  assert.equal(w2.store.get().t, 30);
  w2.advance(200);
  const iCut = w2.log.findIndex((e) => e[0] === 'centreOn' && e[3] === 0 && e[4] === 2), iSeek = w2.log.findIndex((e) => e[0] === 'clock.seek');
  assert.ok(iCut >= 0 && iSeek > iCut, 'the cap cuts the camera (0 ms, zoom 2) before it seeks t0');
  assert.equal(w2.log[iSeek][1], 56, 'and then seeks t0');
  w2.advance(1200);
  assert.equal(w2.player.state(), 'ended');
});

test('camera (M12 per frame): at every frame, the hour on screen never has more zoom than a beat showing that hour allowed', async () => {
  // A zoomed home beat, then a broad beat past 168 h; a zoomed person, then a no-signal person; then the big picture.
  const cam = (zoom) => ({ lat: 37.8, lon: -122.4, zoom });
  const beats = [
    B('home', { t0: 0, t1: 24, ms: 500, camera: cam(3) }),
    B('trip-broad', { t0: 216, t1: 264, ms: 500, camera: cam(1) }),
    B('person-sure', { t0: 0, t1: 20, ms: 500, camera: cam(3) }),
    B('person-none', { t0: 30, t1: 40, ms: 500, camera: cam(1) }),
    B('picture', { t0: 0, t1: 24, ms: 500 }),
  ];
  const zoomOf = (b) => (b.camera ? b.camera.zoom : 1);
  const capAt = (t) => Math.max(0, ...beats.filter((b) => t >= Math.min(b.t0, b.t1) - 1e-9 && t <= Math.max(b.t0, b.t1) + 1e-9).map(zoomOf));
  const w = world({ beats, k: 1, glide: true, state: { t: 0 } });
  const frames = [];
  w.player.start(); await w.flush();
  for (let n = 0; n < 2000 && w.player.state() !== 'ended'; n++) {
    w.frame(); await w.flush(); // a frame: the camera steps, the player ticks, a landed glide's promise settles before paint
    frames.push({ i: w.player.index(), t: w.store.get().t, k: w.k() });
  }
  assert.equal(w.player.state(), 'ended');
  for (const j of [1, 3]) {
    const b = beats[j], mine = frames.filter((f) => f.i === j), hold = mine.filter((f) => f.k > zoomOf(b) + 1e-6);
    assert.ok(hold.length >= 20, `${b.id}: the glide out is sampled frame by frame (${hold.length} frames above the cap)`);
    const wrong = hold.filter((f) => f.t === b.t0);
    assert.equal(wrong.length, 0, `${b.id}: ${wrong.length} frames pair t0 ${b.t0} with k above ${zoomOf(b)}: ${JSON.stringify(wrong.slice(0, 3))}`);
    const prevT = beats[j - 1].t1;
    assert.ok(hold.every((f) => f.t === prevT), `${b.id}: the hold keeps the previous beat's last hour ${prevT}`);
    assert.ok(mine.some((f) => f.t === b.t0 && f.k <= zoomOf(b) + 1e-6), `${b.id}: the beat starts at t0 once landed`);
    assert.ok(mine.some((f) => f.t > b.t0 && f.t < b.t1), `${b.id}: and plays on towards t1`);
  }
  const over = frames.filter((f) => f.k > capAt(f.t) + 1e-6);
  assert.equal(over.length, 0, `frames whose zoom exceeds every beat showing that hour: ${JSON.stringify(over.slice(0, 3))}`);
});

test('outside changes: store.playing turning true pauses; expanded turning false exits with stay', async () => {
  const w = world();
  w.player.start(); await w.flush(); w.advance(100);
  w.store.set({ playing: true });
  assert.equal(w.player.state(), 'paused');
  w.player.resume();
  assert.equal(w.store.get().playing, false, 'resume stops the app clock again');
  assert.equal(w.player.state(), 'playing');
  const view = w.store.get().view;
  w.store.set({ expanded: false });
  assert.equal(w.player.state(), 'idle');
  assert.deepEqual(w.events.at(-1), ['exit', { stay: true, finished: false }]);
  assert.equal(w.store.get().view, view, 'stay keeps the view');
  assert.equal(w.store.get().overlays.doubt, false);
});

test('reduced: no animation; each beat cuts its camera in 0 ms, seeks to t1 and waits in paused for next()', async () => {
  const w = world({ reduced: true });
  w.player.start(); await w.flush();
  assert.equal(w.player.state(), 'paused');
  assert.equal(w.store.get().t, 48);
  assert.equal(w.pending.size, 0);
  w.advance(5000); assert.equal(w.player.index(), 0);
  w.player.next(); await w.flush();
  assert.equal(w.player.index(), 1); assert.equal(w.player.state(), 'paused'); assert.equal(w.store.get().t, 72);
  const cam = w.log.find((e) => e[0] === 'centreOn'); assert.equal(cam[3], 0);
  w.player.next(); await w.flush(); assert.equal(w.store.get().t, 72);
  w.player.next();
  assert.equal(w.player.state(), 'ended');
  assert.deepEqual(w.log.filter((e) => e[0] === 'clock.seek').map(([, t]) => t), [48, 72, 72], 'every reduced beat seeks exactly t1');
});

test('ended writes exactly {run, finishedAt, plays+1} to wse.v1.brief', async () => {
  const w = world();
  w.storage.data[BRIEF_KEY] = JSON.stringify({ run: 'old', finishedAt: 'x', plays: 4 });
  w.player.start(); await w.flush();
  for (let i = 0; i < 400 && w.player.state() !== 'ended'; i++) { w.frame(); await w.flush(); }
  assert.equal(w.player.state(), 'ended');
  const rec = JSON.parse(w.storage.data[BRIEF_KEY]);
  assert.deepEqual(Object.keys(rec), ['run', 'finishedAt', 'plays']);
  assert.equal(rec.run, '2026-11-20T00:00Z'); assert.equal(rec.plays, 5);
  assert.ok(Number.isFinite(Date.parse(rec.finishedAt)));
  w.player.exit();
  assert.equal(w.events.at(-1)[1].finished, true);
  // a throwing storage never breaks the player
  const w2 = world(); w2.storage.setItem = () => { throw new Error('blocked'); };
  w2.player.start(); await w2.flush(); w2.player.goTo(2); w2.player.next(); assert.equal(w2.player.state(), 'ended');
});

test('no listener, subscription or raf is left after exit()', async () => {
  const w = world({ gate: true });
  const before = { subs: w.subs.size, raf: w.pending.size };
  w.player.start(); await w.flush(); w.advance(100);
  assert.ok(w.subs.size > before.subs && w.pending.size > before.raf);
  w.player.exit();
  assert.equal(w.subs.size, before.subs); assert.equal(w.pending.size, before.raf);
  for (const g of w.gates.splice(0)) g.res();
  await w.flush();
  assert.equal(w.pending.size, 0, 'a load that lands after exit starts nothing');
  const w2 = world();
  w2.player.start(); await w2.flush(); w2.player.goTo(2); w2.player.next();
  w2.player.exit();
  assert.equal(w2.subs.size, 0); assert.equal(w2.pending.size, 0);
});
