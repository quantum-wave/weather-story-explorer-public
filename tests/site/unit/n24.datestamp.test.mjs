// N24 DATE pure units: the date stamp's words (ui/datestamp.js) and the GIF's stamp drawing (share/frame.js drawStamp). No browser.
// The words depend on the viewer's zone, so each test sets TZ (Node re-reads it when process.env.TZ changes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stampLines, nearestHour } from '../../../site/js/ui/datestamp.js';
import { drawStamp, STAMP } from '../../../site/js/share/frame.js';

const withTZ = (tz, fn) => { const was = process.env.TZ; process.env.TZ = tz; try { fn(); } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; } };

test('the day and hour lines in the timeline readout\'s words (Los Angeles)', () => withTZ('America/Los_Angeles', () => {
  const d = new Date('2026-11-28T00:00:00Z'); // 4 pm on Friday 27 Nov in Los Angeles
  assert.deepEqual(stampLines(d, 'PST'), { day: 'Fri 27 Nov', hour: '4 pm PST' });
  assert.deepEqual(stampLines(d, 'PST', { year: true }), { day: 'Fri 27 Nov 2026', hour: '4 pm PST' });
  assert.deepEqual(stampLines(d, ''), { day: 'Fri 27 Nov', hour: '4 pm' }, 'no zone name: no trailing space');
}));

test('playing: the nearest whole local hour; paused (exact): the minutes the timeline shows', () => withTZ('America/Los_Angeles', () => {
  assert.equal(stampLines(new Date('2026-11-28T00:29:00Z'), 'PST').hour, '4 pm PST');
  assert.equal(stampLines(new Date('2026-11-28T00:31:00Z'), 'PST').hour, '5 pm PST');
  assert.equal(stampLines(new Date('2026-11-28T00:29:00Z'), 'PST', { exact: true }).hour, '4:29 pm PST');
  // 11:45 pm rounds to midnight: the day moves with it
  assert.deepEqual(stampLines(new Date('2026-11-28T07:45:00Z'), 'PST'), { day: 'Sat 28 Nov', hour: '12 am PST' });
  assert.equal(stampLines(new Date('2026-11-28T19:00:00Z'), 'PST').hour, '11 am PST');
  assert.equal(stampLines(new Date('2026-11-28T20:00:00Z'), 'PST').hour, '12 pm PST');
}));

test('nearestHour is the local wall-clock hour, so a half-hour zone still gets whole hours', () => {
  withTZ('Asia/Kolkata', () => {
    const h = nearestHour(new Date('2026-11-27T10:50:00Z')); // 16:20 IST
    assert.equal(h.toISOString(), '2026-11-27T10:30:00.000Z');
    assert.equal(stampLines(new Date('2026-11-27T10:50:00Z'), 'GMT+5:30').hour, '4 pm GMT+5:30');
  });
  withTZ('UTC', () => assert.equal(nearestHour(new Date('2026-11-27T10:50:00Z')).toISOString(), '2026-11-27T11:00:00.000Z'));
});

test('nearestHour across a clock change rounds on absolute time: the fall-back night keeps the frame\'s UTC hour', () => withTZ('America/Los_Angeles', () => {
  // 2026-11-01: 1 am happens twice in Los Angeles (PDT 08Z, then PST 09Z)
  assert.equal(nearestHour(new Date('2026-11-01T09:00:00Z')).toISOString(), '2026-11-01T09:00:00.000Z', 'an exact hour in the repeated hour stays put');
  assert.equal(nearestHour(new Date('2026-11-01T09:10:00Z')).toISOString(), '2026-11-01T09:00:00.000Z');
  assert.equal(nearestHour(new Date('2026-11-01T08:45:00Z')).toISOString(), '2026-11-01T09:00:00.000Z', '1:45 am PDT rounds to 1 am PST, 15 minutes on');
  assert.equal(nearestHour(new Date('2026-11-01T08:10:00Z')).toISOString(), '2026-11-01T08:00:00.000Z');
  // spring forward 2026-03-08: 1:45 am PST rounds to 3 am PDT (10Z)
  assert.equal(nearestHour(new Date('2026-03-08T09:45:00Z')).toISOString(), '2026-03-08T10:00:00.000Z');
  // exactly :30 rounds up
  assert.equal(nearestHour(new Date('2026-11-28T00:30:00Z')).toISOString(), '2026-11-28T01:00:00.000Z');
}));

test('drawStamp: each line drawn once as text, translucent ink over a halo stroke, per ground', () => {
  for (const ground of ['paper', 'night']) {
    const calls = [];
    const ctx = {
      save() {}, restore() {},
      fillText(s, x, y) { calls.push({ op: 'fill', s, x, y, style: this.fillStyle, font: this.font }); },
      strokeText(s, x, y) { calls.push({ op: 'stroke', s, x, y, style: this.strokeStyle, blur: this.shadowBlur }); },
    };
    drawStamp(ctx, { day: 'Fri 27 Nov', hour: '4 pm PST (00Z)' }, 20, 50, (n) => n, ground);
    const fills = calls.filter((c) => c.op === 'fill'), strokes = calls.filter((c) => c.op === 'stroke');
    assert.deepEqual(fills.map((c) => c.s), ['Fri 27 Nov', '4 pm PST (00Z)'], `${ground}: the words once each`);
    assert.deepEqual(strokes.map((c) => c.s), ['Fri 27 Nov', '4 pm PST (00Z)'], `${ground}: a halo under each line`);
    assert.ok(calls.indexOf(strokes[1]) < calls.indexOf(fills[0]), 'the halo is drawn under the letters');
    for (const f of fills) {
      assert.equal(f.style, STAMP[ground].ink);
      const a = +/,\s*([\d.]+)\)$/.exec(f.style)[1];
      assert.ok(a >= 0.55 && a <= 0.7, `${ground}: translucent ink (${a})`);
    }
    assert.ok(strokes.every((c) => c.style === STAMP[ground].halo && c.blur > 0), `${ground}: a soft halo in the ground's colour`);
    assert.ok(/ 44px /.test(fills[0].font) && / 24px /.test(fills[1].font), 'the day large, the hour smaller');
    assert.ok(fills[1].y > fills[0].y && fills.every((c) => c.x === 20), 'the hour under the day, left-aligned');
  }
});
