// LENSES-A (W4-03, DESIGN-SPEC 6.1): the Jet stream and Confidence lenses are complete: listed, each with a fill, lines, guide text,
// readout words and a truthful available(). Pure parts only; the pixels are S-LENS-A and the tour stops 26 and 27.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const site = new URL('../../../site/js/', import.meta.url);
const load = (p) => import(new URL(p, site).href);
const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`../fixtures/${name}/manifest.json`, import.meta.url), 'utf8'));

test('both lenses are implemented and listed, in the spec order, and the registry stays six long', async () => {
  const { LENSES, listed, lens } = await load('lenses/index.js');
  assert.deepEqual(LENSES.map((l) => l.id), ['pattern', 'jet', 'surface', 'airmass', 'rivers', 'confidence']);
  for (const code of ['j', 'c']) {
    const L = lens(code);
    assert.equal(L.implemented, true, `${L.id} is implemented`);
    assert.ok(listed().includes(L), `${L.id} is listed`);
  }
  assert.deepEqual(listed().map((l) => l.id).filter((id) => id === 'jet' || id === 'confidence'), ['jet', 'confidence']);
});

test('Jet: ECMWF 200 hPa bands from 30 m/s with no fade-in: 35 m/s is exactly #ffff00, 25 m/s is unfilled', async () => {
  const { lens } = await load('lenses/index.js'), pal = await load('render/palette.js'), J = lens('j');
  assert.deepEqual(J.fill, { field: 'ws250', palette: 'ws250' });
  assert.equal(pal.LENS_FIELDS.j.fill, J.fill.field);
  const HEX = ['#ffff00', '#a7e700', '#5dd000', '#1fb800', '#00a110', '#008a34', '#00724b'];
  assert.deepEqual([...pal.PALETTES.ws250.paper], HEX, 'the REF-22 table');
  assert.deepEqual([...pal.PALETTES.ws250.edges], [30, 40, 50, 60, 70, 80, 90]);
  const hex = (c) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
  // the REF-22 hex is the Reference family; the default (Soft) is its own table, band for band
  assert.equal(hex(pal.bandRGBA('ws250', 35, 'paper', 'reference')), '#ffff00'); assert.equal(pal.bandRGBA('ws250', 35, 'paper')[3], 255);
  assert.equal(hex(pal.bandRGBA('ws250', 35, 'paper')), pal.PALETTES.ws250.soft.paper[0]);
  for (const v of [0, 20, 20.5, 25, 29.99]) assert.equal(pal.bandRGBA('ws250', v, 'paper')[3], 0, `${v} m/s draws nothing (no fade-in)`);
  for (const [v, want] of [[30, 0], [39.9, 0], [40, 1], [55, 2], [65, 3], [75, 4], [85, 5], [95, 6], [130, 6]]) assert.equal(hex(pal.bandRGBA('ws250', v, 'paper', 'reference')), HEX[want], `${v} m/s`);
  // the fill is opaque at every lead time: the descriptor carries no alpha, ramp or fade of its own
  assert.ok(!('alpha' in J.fill) && !('fadeFrom' in J.fill) && !('ramp' in J.fill));
});

test('Jet: isotachs at 36, 46, 57 and 67 m/s (70, 90, 110, 130 kt), z500 in grey for context', async () => {
  const jet = await load('lenses/jet.js'), J = jet.default;
  assert.deepEqual(jet.ISOTACHS, [36, 46, 57, 67]);
  assert.deepEqual(jet.ISOTACHS.map((v) => Math.round(v / 0.514444 / 10) * 10), [70, 90, 110, 130], 'knots');
  assert.deepEqual(jet.ISOTACH_KT, [70, 90, 110, 130]);
  const iso = J.lines.find((l) => l.style === 'isotach'), ctx = J.lines.find((l) => l.style === 'context');
  assert.deepEqual(iso, { field: 'ws250', levels: [36, 46, 57, 67], style: 'isotach', color: '#00724b', width: 1.5, unit: 'kt' });
  assert.equal(ctx.field, 'z500'); assert.equal(ctx.step, 60);
  // nothing in `lines` is style 'contour': compose would draw it in ink; the grey context is the lens' own mark
  assert.ok(!J.lines.some((l) => l.style === 'contour'));
});

test('Jet: isotachLines finds exactly the four levels on a field that peaks at 72 m/s, and none that are not reached', async () => {
  const { isotachLines } = await load('lenses/jet.js');
  const dom = { lon0: 0, lat0: 20, dlon: 1, dlat: -1, nx: 41, ny: 21 };
  const nodes = new Float64Array(2 * dom.nx * dom.ny);
  for (let j = 0; j < dom.ny; j++) for (let i = 0; i < dom.nx; i++) { nodes[2 * (j * dom.nx + i)] = 20 * i; nodes[2 * (j * dom.nx + i) + 1] = 20 * j; }
  const mk = (peak) => { const v = new Float32Array(dom.nx * dom.ny); for (let j = 0; j < dom.ny; j++) for (let i = 0; i < dom.nx; i++) v[j * dom.nx + i] = 10 + (peak - 10) * Math.exp(-(((i - 20) / 8) ** 2 + ((j - 10) / 5) ** 2)); return v; };
  assert.deepEqual(isotachLines(mk(72), dom, nodes, 800).map((l) => l.level), [36, 46, 57, 67]);
  assert.deepEqual(isotachLines(mk(50), dom, nodes, 800).map((l) => l.level), [36, 46], 'a 50 m/s jet has no 57 or 67 isotach');
  for (const L of isotachLines(mk(72), dom, nodes, 800)) assert.ok(L.lines.every((p) => p.pts.length >= 6));
});

test('Jet: guide, readout words and availability', async () => {
  const { lens } = await load('lenses/index.js'), J = lens('j');
  assert.equal(J.name, 'Jet stream'); assert.ok(J.blurb.length > 10 && J.blurb.length < 60);
  for (const k of ['answer', 'what', 'read']) assert.ok(typeof J.guide[k] === 'string' && J.guide[k].length > 40, `guide.${k}`);
  assert.ok(Array.isArray(J.guide.worth) && J.guide.worth.length >= 1);
  assert.match(J.guide.what, /250 hPa/); assert.match(J.guide.what, /30 m\/s/);
  assert.match(J.guide.read, /36 m\/s/, 'the guide names the first isotach');
  for (const t of [J.guide.answer, J.guide.what, J.guide.read, ...J.guide.worth]) assert.ok(!/coming soon/i.test(t));
  assert.equal(J.describe(35), '35 m/s · strong wind aloft, below jet strength');
  assert.equal(J.describe(45), '45 m/s · jet stream');
  assert.equal(J.describe(25), '25 m/s · no jet here');
  assert.match(J.describe(35, { units: 'us' }), /^78 mph/);
  assert.equal(J.describe(NaN), '');
  assert.equal(typeof J.marks, 'function');
});

test('Jet: available() is truthful on the five datasets', async () => {
  const { lens } = await load('lenses/index.js'), J = lens('j');
  const no = { ok: false, reason: 'Not in this run' };
  assert.deepEqual(J.available(fixture('synthetic-15d')), { ok: true });
  assert.deepEqual(J.available(fixture('synthetic-partial')), { ok: true });
  assert.deepEqual(J.available(fixture('recorded')), { ok: true });
  assert.deepEqual(J.available(fixture('recorded-min')), no, 'the minimal recording has no wind');
  // sample-min is two cases: the wind is only in case B (Irma), so it is available there and not in case A
  assert.deepEqual(J.available(fixture('sample-min'), 'B'), { ok: true });
  assert.deepEqual(J.available(fixture('sample-min'), 'A'), no);
  assert.deepEqual(J.available(null), no); assert.deepEqual(J.available({}), no);
});

test('Confidence: spread bands at 2, 4, 6, 8, 12 dam; the 6 dam line is emphasised and labelled', async () => {
  const conf = await load('lenses/confidence.js'), C = conf.default, pal = await load('render/palette.js');
  assert.deepEqual(C.fill, { field: 'z500sd', palette: 'z500sd' });
  assert.deepEqual([...pal.PALETTES.z500sd.edges], [2, 4, 6, 8, 12]);
  assert.equal(pal.LENS_FIELDS.c.fill, C.fill.field);
  assert.equal(conf.SPREAD_LINE_GPM, 60, '6 dam in the field\'s own metres');
  assert.equal(conf.SPREAD_LABEL, "one contour's worth of doubt");
  const sp = C.lines.find((l) => l.style === 'spread-line');
  assert.deepEqual(sp, { field: 'z500sd', levels: [60], style: 'spread-line', width: 2.5, label: "one contour's worth of doubt" });
  const ctx = C.lines.find((l) => l.style === 'context');
  assert.equal(ctx.field, 'z500'); assert.equal(ctx.step, 60);
  assert.ok(!C.lines.some((l) => l.style === 'contour'));
  assert.equal(C.doubt, undefined, 'the fill is the spread: no second hatch on it');
});

test('Confidence: guide, readout words and availability', async () => {
  const { lens } = await load('lenses/index.js'), C = lens('c');
  assert.equal(C.name, 'Confidence'); assert.ok(C.blurb.length > 10 && C.blurb.length < 60);
  for (const k of ['answer', 'what', 'read']) assert.ok(typeof C.guide[k] === 'string' && C.guide[k].length > 40, `guide.${k}`);
  assert.ok(C.guide.worth.length >= 1);
  assert.match(C.guide.answer, /not the weather|does not show|how much the forecasts disagree/i, 'says what it is not');
  assert.match(C.guide.read, /one contour's worth of doubt/);
  assert.equal(C.describe(1), '1 dam · forecasts agree closely');
  assert.equal(C.describe(7), '7 dam · forecasts disagree');
  assert.equal(C.describe(NaN), '');
  assert.equal(typeof C.marks, 'function');
  const no = { ok: false, reason: 'Not in this run' };
  assert.deepEqual(C.available(fixture('synthetic-15d')), { ok: true });
  assert.deepEqual(C.available(fixture('synthetic-partial')), no, 'the partial build has no spread');
  assert.deepEqual(C.available(fixture('recorded')), { ok: true });
  assert.deepEqual(C.available(fixture('recorded-min')), { ok: true });
  assert.deepEqual(C.available(fixture('sample-min'), 'A'), { ok: true });
  assert.deepEqual(C.available(fixture('sample-min'), 'B'), no);
  assert.deepEqual(C.available(null), no);
});

test('the registry still honours the one-active-lens contract: plan() fills the spread for Confidence and the wind for Jet', async () => {
  const { plan } = await load('render/compose.js');
  const m = fixture('synthetic-15d');
  const pj = plan({ lens: 'j', case: 'A', overlays: {} }, m), pc = plan({ lens: 'c', case: 'A', overlays: {} }, m);
  assert.equal(pj.anom.field, 'ws250'); assert.equal(pj.anom.palette, 'ws250'); assert.equal(pj.jet, 'ws250'); assert.equal(pj.contour, null);
  assert.equal(pc.anom.field, 'z500sd'); assert.equal(pc.anom.factor, 0.1); assert.equal(pc.doubt, false); assert.equal(pc.contour, null);
  const partial = plan({ lens: 'c', case: 'A', overlays: {} }, fixture('synthetic-partial'));
  assert.equal(partial.anom, null, 'no spread in the build: nothing is drawn');
});

test('labelSpots: a corner inside the stretch refuses the spot (maxDev), and `taken` spots keep their gap', async () => {
  const { labelSpots } = await load('render/isolines.js');
  // an L-shaped line: 300 px right, then 300 px down. A 190 px label centred on the corner would sit on a bend; chord ratio alone is loose.
  const L = [{ level: 60, lines: [{ pts: [100, 100, 400, 100, 400, 400], closed: false }] }];
  const opt = { minGap: 100, unit: 10, every: 6, bold: [], charW: 188, straight: 0.7 };
  const loose = labelSpots(L, 800, 600, opt);
  assert.ok(loose.some((s) => Math.hypot(s.x - 400, s.y - 100) < 20), 'with only a loose chord ratio the label is put on the corner');
  const tight = labelSpots(L, 800, 600, { ...opt, maxDev: 4 });
  assert.ok(tight.every((s) => Math.hypot(s.x - 400, s.y - 100) > 60), `with maxDev no label sits on the corner: ${JSON.stringify(tight)}`);
  // `taken`: a spot already there blocks a new one within minGap
  const line = [{ level: 60, lines: [{ pts: [100, 300, 700, 300], closed: false }] }];
  const free = labelSpots(line, 800, 600, { minGap: 200, unit: 10, every: 6, bold: [], charW: 10, max: 1 });
  assert.equal(free.length, 1);
  const blocked = labelSpots(line, 800, 600, { minGap: 200, unit: 10, every: 6, bold: [], charW: 10, max: 1, taken: [{ x: free[0].x, y: free[0].y }] });
  assert.ok(blocked.length === 0 || Math.hypot(blocked[0].x - free[0].x, blocked[0].y - free[0].y) >= 200, 'a taken spot is respected');
});

test('Confidence: besideSpot sets the phrase level beside the largest loop when no stretch of the 6 dam line is straight enough', async () => {
  const { besideSpot } = await load('lenses/confidence.js');
  const { labelSpots } = await load('render/isolines.js');
  // a phone-sized view of small 6 dam loops (radius 12 to 30 px), the mid-lead shape on which the phrase went missing (review round 2)
  const ring = (cx, cy, r) => { const pts = []; for (let i = 0; i < 48; i++) { const a = (i / 48) * 2 * Math.PI; pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); } return { pts, closed: true }; };
  const loops = [ring(80, 90, 14), ring(250, 140, 30), ring(140, 300, 18), ring(300, 420, 12), ring(60, 460, 16)];
  const iso = [{ level: 60, lines: loops }];
  const W = 390, H = 520, w = 176, h = 16;
  assert.deepEqual(labelSpots(iso, W, H, { minGap: 360, unit: 10, every: 6, bold: [], charW: w, straight: 0.975, maxDev: 6 }), [], 'no on-line spot fits the phrase');
  const at = besideSpot(iso, W, H, { w, h });
  assert.ok(at, 'a spot beside a loop is found');
  assert.equal(at.angle, 0, 'level text');
  const box = { x0: at.x - w / 2, x1: at.x + w / 2, y0: at.y - h / 2, y1: at.y + h / 2 };
  assert.ok(box.x0 >= 12 && box.y0 >= 12 && box.x1 <= W - 12 && box.y1 <= H - 12, `inside the canvas: ${JSON.stringify(box)}`);
  // the largest loop (r 30 at 250, 140) is the one labelled, and the box touches it within a few px without any loop crossing it
  const dist = (cx, cy) => Math.hypot(Math.max(box.x0 - cx, 0, cx - box.x1), Math.max(box.y0 - cy, 0, cy - box.y1));
  assert.ok(dist(250, 140) >= 30 && dist(250, 140) <= 34, `beside the largest loop: ${dist(250, 140).toFixed(1)} px from its centre`);
  for (const { pts } of loops) for (let k = 0; k < pts.length; k += 2) {
    assert.ok(!(pts[k] > box.x0 && pts[k] < box.x1 && pts[k + 1] > box.y0 && pts[k + 1] < box.y1), `no loop runs through the label box (${pts[k].toFixed(0)}, ${pts[k + 1].toFixed(0)})`);
  }
  // a control over that spot moves the phrase elsewhere; a canvas covered by controls has no spot
  const moved = besideSpot(iso, W, H, { w, h, avoid: [{ x: box.x0, y: box.y0, w, h }] });
  assert.ok(moved && Math.hypot(moved.x - at.x, moved.y - at.y) > 4, `a control over the first spot moves it: ${JSON.stringify(moved)}`);
  assert.equal(besideSpot(iso, W, H, { w, h, avoid: [{ x: 0, y: 0, w: W, h: H }] }), null);
  // a long straight segment across the box is caught even though no vertex lies inside it
  const cross = [{ level: 60, lines: [ring(195, 260, 20), { pts: [0, 228, 390, 228], closed: false }] }];
  const c = besideSpot(cross, W, H, { w, h });
  assert.ok(c && !(c.y - h / 2 < 228 && c.y + h / 2 > 228), `a segment with its ends outside the box still blocks it: ${JSON.stringify(c)}`);
});

test('the lens labels keep clear of every floating map control: Reset view is named among them', async () => {
  const { MAP_CONTROLS } = await load('lenses/jet.js');
  for (const id of ['map-legend', 'legend', 'map-tools', 'btn-reset']) assert.ok(MAP_CONTROLS.includes(id), `${id} is a map control labels avoid`);
  const fs = await import('node:fs');
  const made = fs.readFileSync(new URL('render/index.js', site), 'utf8').match(/resetBtn\.id = '([^']+)'/);
  assert.ok(made && MAP_CONTROLS.includes(made[1]), `the button render/index.js makes (${made && made[1]}) is in the list`);
});
