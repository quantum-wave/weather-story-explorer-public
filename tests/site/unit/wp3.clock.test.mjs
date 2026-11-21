// WP3 clock with a fake scheduler: advance, loop, pause, tween, step, speeds, case range, hidden tab.
import test from 'node:test';
import assert from 'node:assert/strict';

const { store, bus } = await import(new URL('../../../site/js/state.js', import.meta.url).href);
const clock = await import(new URL('../../../site/js/time/clock.js', import.meta.url).href);

let now = 0, q = [], id = 0, hidden = false, reduced = false;
const raf = (fn) => { q.push([++id, fn]); return id; };
const caf = (i) => { q = q.filter(([j]) => j !== i); };
function frame(ms = 16) { now += ms; const run = q; q = []; for (const [, fn] of run) fn(now); }
const STEPS = { z500a: [0, 12, 24, 36], z500: [0, 12, 24, 36], t2a: Array.from({ length: 61 }, (_, i) => i * 6) };
const CASE = { z500a: 'A', z500: 'A', t2a: 'C' };
clock.configure({
  now: () => now, raf, caf, hidden: () => hidden, reduced: () => reduced,
  src: { fieldSteps: (f) => STEPS[f] || [], caseOf: (f) => (CASE[f] ? { id: CASE[f] } : null), ensure: async () => {} },
});
const reset = () => { clock.pause(); clock.seek(0); clock.pause(); store._reset(); q = []; now = 0; clock.refresh(); };

test('range is the active case steps; short case defaults to 3 h/s and 1.5/3/6 choices', () => {
  reset();
  assert.deepEqual(clock.range(), [0, 36]);
  assert.equal(store.get().speed, 3);
  assert.deepEqual(clock.speeds(), [1.5, 3, 6]);
});
test('playing advances t at speed, one rAF at a time, and loops', () => {
  reset();
  clock.play();
  assert.equal(q.length, 1);
  const seen = new Set();
  for (let i = 0; i < 60; i++) { frame(); seen.add(store.get().t); }
  assert.ok(seen.size >= 55, 'distinct values ' + seen.size);
  assert.ok(Math.abs(store.get().t - 0.96 * 3) < 0.2, 't after 0.96 s at 3 h/s: ' + store.get().t);
  store.set({ t: 35.9 }); frame(100); frame(100); frame(100);
  assert.ok(store.get().t < 5, 'looped: ' + store.get().t);
  assert.equal(q.length, 1, 'exactly one frame queued');
});
test('pause cancels the loop: no animation frame is queued while paused', () => {
  reset(); clock.play(); frame(); clock.pause();
  assert.equal(q.length, 0); assert.equal(clock.isRunning(), false);
  const t = store.get().t; frame(); frame();
  assert.equal(store.get().t, t);
});
test('a hidden tab never queues a frame; coming back resumes without a leap', () => {
  reset(); hidden = true; clock.play();
  assert.equal(q.length, 0);
  hidden = false; now = 60000; clock.play(); // restart under visible state (visibilitychange path)
  store.set({ playing: false }); store.set({ playing: true });
  const t0 = store.get().t; frame(16);
  assert.ok(store.get().t - t0 < 0.2, 'no leap after a long hidden gap');
});
test('a stalled frame never leaps more than 100 ms of motion', () => {
  reset(); clock.setSpeed(24); clock.play(); frame(16); const t = store.get().t; frame(5000);
  assert.ok(store.get().t - t <= 24 * 0.1 + 1e-6, 'moved ' + (store.get().t - t));
});
test('rAF timestamps that lag performance.now() do not stall the clock', () => {
  reset(); clock.play();
  const t0 = store.get().t;
  // the frame timestamp is 20 ms behind env.now(), as on a real browser when render work is long
  for (let i = 0; i < 30; i++) { now += 16; const run = q; q = []; for (const [, fn] of run) fn(now - 20); }
  const moved = store.get().t - t0;
  assert.ok(moved > 0.8 * 3 * 0.48, 'moved ' + moved + ' h in 30 frames at 3 h/s');
});
test('tweenTo eases to the target over the time given, pauses playback, resolves true', async () => {
  reset(); clock.play();
  let done = null; const p = clock.tweenTo(24, 500).then((v) => { done = v; });
  assert.equal(store.get().playing, false);
  let prev = store.get().t, mid = null;
  for (let i = 0; i < 40 && done === null; i++) {
    frame(16); await Promise.resolve();
    assert.ok(store.get().t >= prev - 1e-9, 'monotone'); prev = store.get().t;
    if (now >= 250 && mid === null) mid = store.get().t;
  }
  await p;
  assert.equal(done, true); assert.equal(store.get().t, 24);
  assert.ok(mid > 6 && mid < 18, 'halfway at 250 ms: ' + mid);
  assert.equal(q.length, 0, 'loop stopped after the tween');
});
test('a second tween, a seek or play interrupts the first, which resolves false', async () => {
  reset();
  let a = null; clock.tweenTo(30, 500).then((v) => { a = v; });
  frame(); clock.seek(5); await Promise.resolve(); assert.equal(a, false);
  assert.equal(store.get().t, 5);
});
test('tweenTo clamps to the range; reduced motion jumps at once', async () => {
  reset(); await (async () => { reduced = true; const v = await clock.tweenTo(500, 500); reduced = false; return v; })();
  assert.equal(store.get().t, 36);
  assert.equal(clock.openingPlay(), true);
  reduced = true; store.set({ playing: false });
  assert.equal(clock.openingPlay(), false); assert.equal(store.get().playing, false); reduced = false;
});
test('step moves one data step, clamps, and pauses', async () => {
  reset(); clock.play();
  const p = clock.step(1); frame(); frame(); frame(); frame(); frame(); frame(); frame(); frame(); frame(); frame(); frame(); frame();
  await p; assert.equal(store.get().t, 12); assert.equal(store.get().playing, false);
  reduced = true; await clock.step(1); await clock.step(1); await clock.step(1); reduced = false;
  assert.equal(store.get().t, 36);
  reduced = true; await clock.step(-1); reduced = false; assert.equal(store.get().t, 24);
});
test('seek clamps and does not change play state', () => {
  reset(); clock.play(); clock.seek(-4); assert.equal(store.get().t, 0); clock.seek(99); assert.equal(store.get().t, 36);
  assert.equal(store.get().playing, true);
});
test('a user-chosen speed survives a lens switch; a lens with a longer run changes range and clamps t', () => {
  reset(); clock.setSpeed(6);
  STEPS.ws250 = Array.from({ length: 61 }, (_, i) => i * 6);
  store.set({ t: 30 }); store.set({ lens: 'j' });
  assert.deepEqual(clock.range(), [0, 360]);
  assert.equal(store.get().speed, 6);
  assert.deepEqual(clock.speeds(), [6, 12, 24]);
  store.set({ lens: 'z' }); assert.equal(store.get().t, 30);
  store.set({ t: 100, lens: 'j' }); store.set({ lens: 'z' });
  assert.equal(store.get().t, 36, 't clamped into the new range');
  delete STEPS.ws250;
});
test('frame hooks receive interval and work time', () => {
  reset(); const got = []; const off = clock.onFrame((i, w) => got.push([i, w]));
  clock.play(); frame(16); frame(17); off(); frame(16);
  assert.equal(got.length, 2); assert.equal(got[1][0], 17);
});
test('data:manifest refreshes the range', () => {
  reset(); STEPS.z500a = [0, 12, 24, 36, 48]; STEPS.z500 = STEPS.z500a;
  bus.emit('data:manifest', {}); assert.deepEqual(clock.range(), [0, 48]);
  STEPS.z500a = STEPS.z500 = [0, 12, 24, 36];
});

// ---- W3-08: the loop follows the active lens's field steps (store.lens), falling back to the case's fields
test('the clock loops over the active lens\'s steps; no lens is the pattern', () => {
  reset();
  STEPS.ws250 = [0, 6, 12, 18]; STEPS.t850a = Array.from({ length: 29 }, (_, i) => i * 6); CASE.ws250 = 'A'; CASE.t850a = 'A';
  store.set({ lens: 'j' }); clock.refresh();
  assert.deepEqual(clock.range(), [0, 18], 'jet lens: ws250 steps');
  assert.deepEqual(clock.steps(), [0, 6, 12, 18]);
  store.set({ lens: 'a' });
  assert.deepEqual(clock.range(), [0, 168], 'air-mass lens: t850a steps');
  store.set({ lens: 'z' });
  assert.deepEqual(clock.range(), [0, 36], 'pattern lens: z500a steps');
  store._reset(); clock.refresh();
  assert.deepEqual(clock.range(), [0, 36], 'no lens: the pattern, the default lens');
  delete STEPS.ws250; delete STEPS.t850a; delete CASE.ws250; delete CASE.t850a; clock.refresh();
});
test('a lens with no steps in this run falls back to the pattern range, never an empty loop', () => {
  reset(); store.set({ lens: 'r' }); clock.refresh();
  assert.deepEqual(clock.range(), [0, 36]);
});
test('speed names: Slow, Normal, Fast by position', () => {
  reset();
  assert.deepEqual(clock.speedChoices().map((c) => c.name), ['Slow', 'Normal', 'Fast']);
  assert.deepEqual(clock.speedChoices().map((c) => c.value), clock.speeds());
});
test('stepDay moves 24 h to the nearest step', async () => {
  reset(); reduced = true; STEPS.z500a = Array.from({ length: 13 }, (_, i) => i * 6); STEPS.z500 = STEPS.z500a; clock.refresh();
  await clock.stepDay(1); assert.equal(store.get().t, 24); await clock.stepDay(1); assert.equal(store.get().t, 48);
  await clock.stepDay(-1); assert.equal(store.get().t, 24); reduced = false;
  STEPS.z500a = [0, 12, 24, 36]; STEPS.z500 = STEPS.z500a; clock.refresh();
});
test('easeToStep: a release between steps eases to the nearest step', async () => {
  reset(); reduced = true; await clock.seek(14); const v = await clock.easeToStep(); reduced = false;
  assert.equal(v, true); assert.equal(store.get().t, 12);
});
