// W3-02 basemap contract (Josh point 6; DESIGN-SPEC 4.4): casing under core from chartTokens(ground), one cached Path2D per
// view and layer, and only the 110 m coast core while rotating. Runs on a recording context, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';

let made = 0;
globalThis.Path2D = class { constructor() { made++; } moveTo() {} lineTo() {} arc() {} closePath() {} };
const { d3 } = await import('../../../site/js/vendor.js');
const bm = await import('../../../site/js/render/basemap.js');
const { chartTokens } = await import('../../../site/js/render/chart-tokens.js');

const line = { type: 'MultiLineString', coordinates: [[[0, 0], [10, 10]]] };
const land = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] } };
bm.setBasemap({ tier: 2, land, landLow: land, coast: line, coastLow: line, borders: line, states: line });

const mkView = (viewId, key) => ({ viewId, key, W: 100, H: 100, base: { proj: d3.geoEquirectangular() }, apply() { return this; } });
const rec = () => {
  const strokes = [];
  return { strokes, ctx: { globalAlpha: 1, lineWidth: 0, strokeStyle: '', stroke(p) { strokes.push({ p, w: this.lineWidth, c: this.strokeStyle, a: this.globalAlpha }); }, fill() {}, set lineJoin(v) {}, set lineCap(v) {} } };
};

test('Paper rest draw: casings first, then states, then border and coast cores, from chartTokens', () => {
  const tk = chartTokens('paper'), { strokes, ctx } = rec();
  bm.drawLines(ctx, mkView('np', 'v-rest'), { ocean: '#F9F6F2' }, false);
  assert.deepEqual(strokes.map((s) => [s.c, s.w, s.a]), [
    [tk.border.casing, tk.border.casingWidth, tk.border.casingAlpha], [tk.coast.casing, tk.coast.casingWidth, tk.coast.casingAlpha],
    [tk.stateLine.color, tk.stateLine.width, tk.stateLine.alpha],
    [tk.border.color, tk.border.width, tk.border.alpha], [tk.coast.color, tk.coast.width, tk.coast.alpha]]);
  assert.equal(strokes[0].p, strokes[3].p, 'border casing and core are strokes of the same Path2D');
  assert.equal(strokes[1].p, strokes[4].p, 'coast casing and core are strokes of the same Path2D');
});

test('Night draws the Night tokens; the ground argument beats the theme', () => {
  const { strokes, ctx } = rec();
  bm.drawLines(ctx, mkView('nh', 'v-night'), { ocean: '#F9F6F2' }, false, 'night'); // a light theme, an explicit Night ground
  assert.equal(strokes.at(-1).c, chartTokens('night').coast.color);
  assert.equal(strokes.length, 4, 'state lines are Regional only');
});

test('one Path2D per view and layer: a repeat draw builds none', () => {
  const v = mkView('np', 'v-cache');
  bm.drawLines(rec().ctx, v, { ocean: '#000' }, false);
  const before = made;
  bm.drawLines(rec().ctx, v, { ocean: '#000' }, false);
  assert.equal(made, before, 'second draw of the same view reuses its paths');
});

test('rotating (low) draws one stroke: the 110 m coast core, no casing, no borders', () => {
  const tk = chartTokens('night'), { strokes, ctx } = rec();
  bm.drawLines(ctx, mkView('nh', 'v-low'), { ocean: '#0C1014' }, true);
  assert.deepEqual(strokes.map((s) => [s.c, s.w, s.a]), [[tk.coast.color, tk.coast.width, tk.coast.alpha]]);
});
