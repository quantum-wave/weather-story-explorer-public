// W4-02: the spread chart's reference label goes where the curve keeps clear of it, wherever the curve runs.
import test from 'node:test';
import assert from 'node:assert/strict';

const G = { L: 34, R: 10, T: 14, W: 320, H: 166, B: 42 };
const yAt = (v, maxV = 10) => G.T + (1 - v / maxV) * (G.H - G.T - G.B);
const xAt = (d) => G.L + (d / 15) * (G.W - G.L - G.R);
const curve = (f) => Array.from({ length: 31 }, (_, i) => [xAt(i / 2), yAt(f(i / 2))]);
// the label's box as the chart estimates it (6.4 units a letter), from the spot returned
const boxOf = (s) => ({ x: s.x, y: s.y - 10, w: Math.max(...s.lines.map((l) => l.trim().length)) * 6.4 + 4, h: 14 + 17 * (s.lines.length - 1) });
const gapTo = (pts, b) => { let g = Infinity; for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k <= 20; k++) { const q = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k / 20, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k / 20]; g = Math.min(g, Math.hypot(Math.max(b.x - q[0], 0, q[0] - b.x - b.w), Math.max(b.y - q[1], 0, q[1] - b.y - b.h))); } return g; };

test('refLabelSpot keeps the label at least REF_CLEAR from curves that rise through the old fixed spot', async () => {
  const { refLabelSpot, REF_CLEAR } = await import('../../../site/js/ui/guide.js');
  const yRef = yAt(6);
  const shapes = {
    'rises early (through the left of the line)': (d) => Math.min(8, d * 1.4),
    'rises through the middle': (d) => Math.max(0, (d - 4) * 1.2),
    'rises late': (d) => Math.max(0, (d - 9) * 1.5),
    'stays low': () => 1.5,
    'crosses the line and stays above': (d) => 5 + d * 0.3,
  };
  for (const [name, f] of Object.entries(shapes)) {
    const pts = curve(f), s = refLabelSpot(pts, { ...G, yRef });
    assert.ok(gapTo(pts, boxOf(s)) >= REF_CLEAR - 1e-6, `${name}: gap ${gapTo(pts, boxOf(s)).toFixed(1)}`);
    assert.ok(s.x >= G.L && s.x + boxOf(s).w <= G.W, `${name}: inside the chart ${JSON.stringify(s)}`);
  }
  // the old spot (left, 16 below the line) is not taken when the curve passes through it
  const early = curve(shapes['rises early (through the left of the line)']);
  assert.notDeepEqual(refLabelSpot(early, { ...G, yRef }), { x: G.L + 8, y: yRef + 16, anchor: 'start', lines: ['one contour’s worth of doubt'] }, 'moved off the old fixed spot');
});
