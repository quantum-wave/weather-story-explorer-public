// S-LINEART: coastlines, country borders (and in Regional the US state lines) can be seen, measured on RENDERED PIXELS
// (Josh point 6 "country outlines are too hard to see"; AUDIT-UX UX-12, TEST-2; DESIGN-SPEC 4.4 and 14.3 "Line-art contrast").
//
// Method (14.3), at DPR 2, in all three views (np, nh, gl), with the field off and on, on Paper and on Night:
//   - take sample points on real coast and border geometry (decoded from the bundled 50 m files, projected by the renderer
//     itself), chosen where the line is straight and nothing else is within 10 px;
//   - along the line's normal take the darkest (Paper) or lightest (Night) pixel within +-2 device px, and compare it with
//     the median of the pixels 4-6 device px away on each side (WCAG contrast);
//   - coast >= 4.5:1 and border >= 3:1 against at least one side at every sampled point, and against both sides at 90% of them;
//   - the coast core is at least 1 CSS px wide (its measured equivalent width).
// The casing counts: a line is read against the ring directly beside its core as well as against the field 4-6 px away,
// so a side's contrast is the better of the two. The ring is the most contrasting pixel 1.5-2 device px from the centre, which is inside
// the casing (2.25-2.5 CSS px wide, so 2.25-2.5 device px each side) and outside the 1 CSS px core (1 device px each side). Without a casing the ring IS the field, so removing it fails here.
// Known-positive mutants: M-audit-1 (transparent borders) and M-borders-1 (casing removed) must both fail this check.
//
// The ground is chosen the way the app does it today: theme 'light' draws Paper, 'dark' draws Night; once the store has a
// `ground` key (W3-01) the check sets it as well so the ground is explicit.
import fs from 'node:fs';
import { mount, shoot, pixel, decodePNG } from '../wp2/shot.mjs';

export const id = 'S-LINEART';
export const freshProfile = false;
export const timeoutMs = 300000;

const DPR = 2;
const VIEWS = [['np', 1000, 600], ['nh', 800, 800], ['gl', 1800, 1000]];
const GROUNDS = [['paper', 'light'], ['night', 'dark']];
const NEED = { coast: 4.5, border: 3 };
// 'off': a lens whose field this fixture lacks (rivers: ivt) draws no fill, just the ground; 'on': the Pattern lens
const FIELDS = [['off', { lens: 'r' }], ['on', { lens: 'z' }]];

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const grey = (img, x, y) => (x < 0 || y < 0 || x >= img.w || y >= img.h ? null : (([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b)(pixel(img, x, y)));
const at = (img, x, y) => (x < 0 || y < 0 || x >= img.w || y >= img.h ? null : lum(pixel(img, x, y)));

/** Measure one sample on a decoded screenshot. */
export function measure(img, s, ground) {
  const cx = s.x * DPR, cy = s.y * DPR, pick = ground === 'night' ? Math.max : Math.min;
  const sampleAt = (d) => at(img, Math.floor(cx + s.nx * d), Math.floor(cy + s.ny * d));
  let core = ground === 'night' ? -1 : 2;
  for (let d = -2; d <= 2.001; d += 0.5) { const v = sampleAt(d); if (v !== null) core = pick(core, v); }
  const side = (sign, lo, hi, step) => { const v = []; for (let d = lo; d <= hi + 0.001; d += step) { const q = sampleAt(sign * d); if (q !== null) v.push(q); } return v.length ? median(v) : null; };
  // the casing's halo on one side: its most contrasting pixel (lightest on Paper, darkest on Night) 1.5-2 device px out; a
  // single pixel is noisy because a slanted 1 CSS px core spills into the pixel next to it
  const halo = (sign) => { const v = [1.5, 1.75, 2].map((d) => sampleAt(sign * d)).filter((q) => q !== null); return v.length ? (ground === 'night' ? Math.min(...v) : Math.max(...v)) : null; };
  const out = { core, strict: [], aware: [] };
  for (const sign of [-1, 1]) {
    const field = side(sign, 4, 6, 0.5), ring = halo(sign);
    out.strict.push(ratio(core, field));
    out.aware.push(Math.max(ratio(core, field), ratio(core, ring)));
    out[sign < 0 ? 'fieldA' : 'fieldB'] = field;
    out[sign < 0 ? 'ringA' : 'ringB'] = ring;
  }
  // equivalent width of the stroke along the normal, relative to the ring, in CSS px. Coverage blends linearly in the
  // encoded (sRGB) values, so the width is read from those, not from linear luminance.
  const gAt = (d) => grey(img, Math.floor(cx + s.nx * d), Math.floor(cy + s.ny * d));
  const gcore = ground === 'night' ? Math.max(...Array.from({ length: 9 }, (_, i) => gAt(-2 + i * 0.5) ?? 0)) : Math.min(...Array.from({ length: 9 }, (_, i) => gAt(-2 + i * 0.5) ?? 255));
  const ringG = [-1.75, 1.75].map((d) => gAt(d)), base = (ringG[0] + ringG[1]) / 2;
  let w = 0;
  for (let d = -3; d <= 3; d += 0.25) { const v = gAt(d); if (v !== null && base !== gcore) w += Math.min(1, Math.max(0, (v - base) / (gcore - base))) * 0.25; }
  out.width = w / DPR;
  return out;
}

/** In the page: sample points on the renderer's own projection of the real coast and border geometry. */
const PICK = `(async () => {
  const r = window.__lineartProj || window.__wp2.renderer, view = window.__lineartView || window.__wp2.store.get().view;
  const j = (u) => fetch(u).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  const land = await j('geo/land-50m.json');
  const c50 = await j('geo/countries-50m.json'), c110 = c50 ? null : await j('geo/countries-110m.json'), c = c50 || c110;
  const sts = view === 'np' ? await j('geo/states-10m.json') : null;
  const sets = {
    coast: topojson.mesh(land, land.objects.land).coordinates,
    border: topojson.mesh(c, c.objects.countries, (a, b) => a !== b).coordinates,
    state: sts ? topojson.mesh(sts, sts.objects.states, (a, b) => a !== b).coordinates : [],
  };
  const runs = [];
  for (const [kind, lines] of Object.entries(sets)) for (const line of lines) {
    let cur = null;
    for (const ll of line) {
      const p = r.project(ll);
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) { cur = null; continue; }
      if (cur && Math.hypot(p[0] - cur.pts[cur.pts.length - 1][0], p[1] - cur.pts[cur.pts.length - 1][1]) < 0.05) continue;
      if (!cur) { cur = { kind, id: runs.length, pts: [], cum: [] }; runs.push(cur); }
      const n = cur.pts.length;
      cur.cum.push(n ? cur.cum[n - 1] + Math.hypot(p[0] - cur.pts[n - 1][0], p[1] - cur.pts[n - 1][1]) : 0);
      cur.pts.push(p);
    }
  }
  const CELL = 10, hash = new Map();
  const put = (x, y, run, s) => { const k = Math.floor(x / CELL) + ',' + Math.floor(y / CELL); (hash.get(k) || hash.set(k, []).get(k)).push([x, y, run.id, s]); };
  for (const run of runs) for (let i = 0; i + 1 < run.pts.length; i++) {
    const [a, b] = [run.pts[i], run.pts[i + 1]], len = run.cum[i + 1] - run.cum[i], n = Math.max(1, Math.ceil(len / 2));
    for (let q = 0; q <= n; q++) put(a[0] + (b[0] - a[0]) * q / n, a[1] + (b[1] - a[1]) * q / n, run, run.cum[i] + len * q / n);
  }
  const pointAt = (run, s) => {
    let lo = 0, hi = run.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (run.cum[m] <= s) lo = m; else hi = m; }
    const f = (s - run.cum[lo]) / Math.max(1e-9, run.cum[hi] - run.cum[lo]);
    return [run.pts[lo][0] + (run.pts[hi][0] - run.pts[lo][0]) * f, run.pts[lo][1] + (run.pts[hi][1] - run.pts[lo][1]) * f];
  };
  const W = innerWidth, H = innerHeight, out = { coast: [], border: [] };
  for (const run of runs) {
    if (run.kind === 'state') continue;
    const total = run.cum[run.cum.length - 1];
    for (let i = 0; i < run.pts.length; i++) {
      const [x, y] = run.pts[i], s = run.cum[i];
      if (x < 28 || x > W - 28 || y < H * 0.1 || y > H * 0.55 || s < 10 || s > total - 10) continue;
      if (out[run.kind].some((q) => Math.hypot(q.x - x, q.y - y) < 20)) continue;
      const a = pointAt(run, s - 8), b = pointAt(run, s + 8), chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (chord < 15.5) continue;
      const tx = (b[0] - a[0]) / chord, ty = (b[1] - a[1]) / chord, nx = -ty, ny = tx;
      let clear = true;
      const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
      for (let u = cx - 2; u <= cx + 2 && clear; u++) for (let v = cy - 2; v <= cy + 2 && clear; v++) for (const h of hash.get(u + ',' + v) || []) {
        if (Math.hypot(h[0] - x, h[1] - y) <= 10 && (h[2] !== run.id || Math.abs(h[3] - s) > 14)) { clear = false; break; }
      }
      if (!clear) continue;
      const f = r.invert([x + nx * 16, y + ny * 16]), g = r.invert([x - nx * 16, y - ny * 16]);
      if (!f || !g) continue; // too near the edge of the globe
      out[run.kind].push({ kind: run.kind, x, y, nx, ny });
      if (out[run.kind].length >= 90) break;
    }
  }
  return out;
})()`;


/**
 * In the page: draw the real lines (basemap.drawLines, the field off, on a transparent canvas) and look for ink where there
 * is no shoreline. The land POLYGON is clipped by the view (a hemisphere's rim) and closed along the pole (Antarctica), and
 * stroking that polygon draws those clip edges as coast (Josh points 6 and 11: a bold arc round the Northern Hemisphere,
 * a box along the bottom of Global). A real coast only CROSSES the outline, so the ink along it is a few px long; a false
 * one runs for tens. Reported in CSS px: the longest unbroken run of ink along the outline and the ink within +-1 px of the pole line (the real coast nearest it, an ice-front, is 4 px away).
 */
const SEAMS = (view, ground, withPng) => `(async () => {
  const [{ baseProjection, MapView, IDENTITY }, basemap, { d3 }] = await Promise.all([import('/js/render/view.js'), import('/js/render/basemap.js'), import('/js/vendor.js')]);
  const W = innerWidth, H = innerHeight, mv = new MapView(baseProjection(${JSON.stringify(view)}, W, H), IDENTITY());
  const cv = document.createElement('canvas'); cv.width = W * ${DPR}; cv.height = H * ${DPR};
  const c = cv.getContext('2d', { willReadFrequently: true }); c.scale(${DPR}, ${DPR});
  basemap.drawLines(c, mv, { ocean: ${JSON.stringify(ground === 'paper' ? '#FFFFFF' : '#000000')} }, false, ${JSON.stringify(ground)});
  const data = c.getImageData(0, 0, cv.width, cv.height).data;
  const inkAt = (x, y) => { const X = Math.floor(x * ${DPR}), Y = Math.floor(y * ${DPR}); return X < 0 || Y < 0 || X >= cv.width || Y >= cv.height ? 0 : data[(Y * cv.width + X) * 4 + 3]; };
  const proj = mv.base.proj;
  // a polyline of screen points -> densified to 0.5 px steps
  const dense = (pts) => { const o = []; for (let i = 0; i + 1 < pts.length; i++) { const [a, b] = [pts[i], pts[i + 1]], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5)); for (let q = 0; q < n; q++) o.push([a[0] + (b[0] - a[0]) * q / n, a[1] + (b[1] - a[1]) * q / n]); } return o; };
  const ink = (pts, band) => pts.map(([x, y], i) => {
    const q = pts[Math.min(pts.length - 1, i + 1)], p = pts[Math.max(0, i - 1)], tx = q[0] - p[0], ty = q[1] - p[1], l = Math.hypot(tx, ty) || 1, nx = -ty / l, ny = tx / l;
    for (let d = -band; d <= band + 1e-6; d += 0.5) if (inkAt(x + nx * d, y + ny * d) > 24) return 1;
    return 0;
  });
  const longest = (flags, step) => { let best = 0, run = 0; for (const f of flags) { run = f ? run + 1 : 0; best = Math.max(best, run); } return best * step; };
  const out = {};
  if (${withPng ? 'true' : 'false'}) out.png = cv.toDataURL('image/png'); // WSE_SHOT_DIR: look at the lines alone
  let outline = [];
  if (${JSON.stringify(view)} === 'nh') {
    // the rim: the circle 74.9 degrees from the pole, just inside the clip
    for (let lon = -180; lon <= 180; lon += 0.25) { const q = proj([lon, 90 - 74.9]); if (q) outline.push(q); }
  } else {
    const lo = -150 - 179.99, hi = -150 + 179.99;
    for (let lat = -89.9; lat <= 89.9; lat += 0.25) { const q = proj([hi, lat]); if (q) outline.push(q); }
    for (let lat = 89.9; lat >= -89.9; lat -= 0.25) { const q = proj([lo, lat]); if (q) outline.push(q); }
  }
  const d = dense(outline);
  out.outlineLongestRun = longest(ink(d, 3), 0.5);
  out.outlineLength = d.length * 0.5;
  out.outlineInkPx = ink(d, 3).reduce((a, b) => a + b, 0) * 0.5;
  if (${JSON.stringify(view)} === 'gl') {
    const pole = []; for (let t = -1; t <= 1.0001; t += 0.005) { const q = proj([-150 + t * 179.9, -90]); if (q) pole.push(q); }
    const pd = dense(pole);
    out.poleInkPx = ink(pd, 1).reduce((a, b) => a + b, 0) * 0.5;
    out.poleLength = pd.length * 0.5;
  }
  return out;
})()`;

export async function run({ page, baseUrl, assert }) {
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 45000 });
  const t = await page.eval('window.__wse.data.getManifest().fields.z500a.steps[1]');
  const report = [];
  const failures = [];
  const analyse = (img, pool, label, gname) => {
        const need = { coast: 5, border: 3 };
        for (const kind of ['coast', 'border']) {
          const samples = pool[kind].map((s) => ({ ...s, m: measure(img, s, gname) }));
          if (samples.length < need[kind]) { failures.push(`${label}: only ${samples.length} usable ${kind} samples (need ${need[kind]})`); continue; }
          const best = samples.map((s) => Math.max(...s.m.aware)), both = samples.map((s) => Math.min(...s.m.aware));
          const strictBest = samples.map((s) => Math.max(...s.m.strict));
          const okOne = best.filter((v) => v >= NEED[kind]).length, okBoth = both.filter((v) => v >= NEED[kind]).length;
          const minBest = Math.min(...best);
          // the sample whose surroundings are darkest (Paper) / lightest (Night): the deepest band of the field
          const deep = samples.reduce((a, s) => ((gname === 'night' ? Math.max(s.m.fieldA, s.m.fieldB) > Math.max(a.m.fieldA, a.m.fieldB) : Math.min(s.m.fieldA, s.m.fieldB) < Math.min(a.m.fieldA, a.m.fieldB)) ? s : a), samples[0]);
          const widths = samples.map((s) => s.m.width);
          report.push({ label, kind, n: samples.length, minBest: +minBest.toFixed(2), minStrict: +Math.min(...strictBest).toFixed(2), share: +(okBoth / samples.length).toFixed(2), deepBest: +Math.max(...deep.m.aware).toFixed(2), medianWidthCss: +median(widths).toFixed(2) });
          if (okOne < samples.length) { const w = samples[best.indexOf(minBest)]; console.log(`  worst ${label} ${kind}: at (${w.x.toFixed(0)},${w.y.toFixed(0)}) n=(${w.nx.toFixed(2)},${w.ny.toFixed(2)}) core L ${w.m.core.toFixed(3)} ring ${w.m.ringA?.toFixed(3)}/${w.m.ringB?.toFixed(3)} field ${w.m.fieldA?.toFixed(3)}/${w.m.fieldB?.toFixed(3)}`); }
          if (okOne < samples.length) failures.push(`${label}: ${kind} below ${NEED[kind]}:1 against every side at ${samples.length - okOne} of ${samples.length} points (worst ${minBest.toFixed(2)}:1, strict ${Math.min(...strictBest).toFixed(2)}:1)`);
          if (okBoth / samples.length < 0.9) failures.push(`${label}: ${kind} reaches ${NEED[kind]}:1 on both sides at only ${(okBoth / samples.length * 100).toFixed(0)}% of ${samples.length} points`);
          if (kind === 'coast' && median(widths) < 0.85) failures.push(`${label}: coast core is ${median(widths).toFixed(2)} CSS px wide (need >= 1, within a 15% measurement tolerance)`);
        }

  };

  for (const [view, w, h] of VIEWS) {
    await mount(page, { width: w, height: h, dpr: DPR });
    // the 50 m files swap in when idle: wait for them (a build without the tier hook has nothing to wait for)
    await page.eval(`(async () => { const b = window.__wp2.basemap; if (b.basemapFull) await b.basemapFull(); })()`);
    for (const [gname, theme] of GROUNDS) {
      for (const [fname, lensPatch] of FIELDS) {
        const patch = { view, ...lensPatch, theme, t };
        if (await page.eval(`'ground' in window.__wp2.store.get()`)) patch.ground = gname;
        const img = await shoot(page, patch, `lineart-${view}-${gname}-${fname}`);
        analyse(img, await page.eval(PICK), `${view}/${gname}/field ${fname}`, gname);
      }
      // The deepest bands: the real lines drawn by basemap.drawLines over a solid fill of the palette's deepest blue and deepest
      // red (z500a -39 and +39 dam). Where the synthetic field is pale this is what proves the casing (core alone is 1.85:1
      // on the deepest Paper blue, DESIGN-SPEC 4.4).
      for (const [bandName, dam] of [['deepest blue', -39], ['deepest red', 39]]) {
        const png = await page.eval(`(async () => {
          const [{ baseProjection, MapView, IDENTITY }, basemap, { bandRGBA }] = await Promise.all([import('/js/render/view.js'), import('/js/render/basemap.js'), import('/js/render/palette.js')]);
          const W = innerWidth, H = innerHeight, mv = new MapView(baseProjection(${JSON.stringify(view)}, W, H), IDENTITY());
          const cv = document.createElement('canvas'); cv.width = W * ${DPR}; cv.height = H * ${DPR};
          const c = cv.getContext('2d'); c.scale(${DPR}, ${DPR});
          const [r, g, b] = bandRGBA('z500a', ${dam}, ${JSON.stringify(gname)});
          c.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')'; c.fillRect(0, 0, W, H);
          basemap.drawLines(c, mv, { ocean: ${JSON.stringify(gname === 'paper' ? '#FFFFFF' : '#000000')} }, false, ${JSON.stringify(gname)});
          window.__lineartProj = mv; window.__lineartView = ${JSON.stringify(view)};
          return cv.toDataURL('image/png');
        })()`);
        const pool = await page.eval(PICK);
        await page.eval('delete window.__lineartProj; delete window.__lineartView');
        analyse(decodePNG(Buffer.from(png.split(',')[1], 'base64')), pool, `${view}/${gname}/${bandName} (solid)`, gname);
      }
    }
  }
  console.log('S-LINEART measurements:\n' + report.map((r) => `  ${r.label} ${r.kind}: n=${r.n} worst ${r.minBest}:1 (strict ${r.minStrict}:1) both-sides ${r.share} deepest-band ${r.deepBest}:1 width ${r.medianWidthCss} css px`).join('\n'));
  if (failures.length) console.log('S-LINEART failures:\n  ' + failures.join('\n  '));
  assert.deepEqual(failures, [], 'line-art contrast failures:\n  ' + failures.join('\n  '));

  // ---- false coastlines: the clip circle of the hemisphere and the pole closure of Global must carry no ink ----
  // CSS px. Real coasts and borders cross the outline and some run along it for a while (measured 54 px in nh and 65 px in gl on the
  // 50 m files); a stroked clip edge is the whole arc across every continent (measured 463 and 512 px before the fix).
  const SEAM_MAX_RUN = 150, POLE_MAX_INK = 20; // the pole line has 8.5 px of real ice-front ink within 1 px after the fix, 1200 before
  const seams = [];
  for (const [view, w, h] of VIEWS.filter(([v]) => v !== 'np')) {
    await mount(page, { width: w, height: h, dpr: DPR });
    await page.eval(`(async () => { const b = window.__wp2.basemap; if (b.basemapFull) await b.basemapFull(); })()`);
    for (const [gname] of GROUNDS) {
      const m = await page.eval(SEAMS(view, gname, !!process.env.WSE_SHOT_DIR));
      if (m.png) { fs.writeFileSync(`${process.env.WSE_SHOT_DIR}/lineart-seams-${view}-${gname}.png`, Buffer.from(m.png.split(',')[1], 'base64')); delete m.png; }
      seams.push(`${view}/${gname}: longest ink run along the outline ${m.outlineLongestRun} px, ink on ${m.outlineInkPx} of ${m.outlineLength} px` + (m.poleInkPx !== undefined ? `, ink on the pole line ${m.poleInkPx} px of ${m.poleLength}` : ''));
      if (!(m.outlineLongestRun <= SEAM_MAX_RUN)) failures.push(`${view}/${gname}: a ${m.outlineLongestRun} px unbroken line is drawn along the edge of the map (a clip edge stroked as coastline; real coast and borders stay under ${SEAM_MAX_RUN} px)`);
      if (m.poleInkPx !== undefined && m.poleInkPx > POLE_MAX_INK) failures.push(`${view}/${gname}: ${m.poleInkPx} px of coast ink on the pole line, over ${POLE_MAX_INK} (Antarctica's closure stroked as coastline)`);
    }
  }
  console.log('S-LINEART outline seams:\n  ' + seams.join('\n  '));
  assert.deepEqual(failures, [], 'false coastline ink:\n  ' + failures.join('\n  '));

  // ---- load order: the 110 m files first, the first chart drawn, and only then the 50 m files requested ----
  await page.goto(baseUrl);
  await page.waitFor('window.__wse && window.__wse.ready === true', { timeout: 45000 });
  const order = await page.eval(`(async () => {
    const b = await import('/js/render/basemap.js');
    if (b.basemapFull) await b.basemapFull();
    const res = performance.getEntriesByType('resource').filter((e) => /\\/geo\\/(land|countries|states)-/.test(e.name)).map((e) => ({ f: e.name.split('/').pop(), start: e.startTime }));
    return { log: b.basemapLog ? b.basemapLog() : null, res, tier: b.basemapTier ? b.basemapTier() : null };
  })()`);
  assert.ok(order.log, 'basemap.js exports basemapLog (the load-order record)');
  const when = (e) => order.log.find((x) => x.e === e)?.t;
  assert.ok(when('ready110') !== undefined && when('firstDraw110') !== undefined && when('request50') !== undefined && when('ready50') !== undefined, `load events: ${JSON.stringify(order.log)}`);
  assert.ok(when('ready110') <= when('firstDraw110') && when('firstDraw110') <= when('request50') && when('request50') < when('ready50'), `110 m parses, draws, then 50 m is requested: ${JSON.stringify(order.log)}`);
  const startOf = (f) => order.res.find((x) => x.f === f)?.start;
  assert.ok(startOf('countries-110m.json') !== undefined && startOf('countries-50m.json') !== undefined && startOf('land-50m.json') !== undefined, `geo requests: ${JSON.stringify(order.res)}`);
  assert.ok(startOf('countries-110m.json') < startOf('countries-50m.json') && startOf('countries-110m.json') < startOf('land-50m.json'), 'the 110 m file is requested before either 50 m file');
  assert.equal(order.tier, 2, 'the 50 m basemap swapped in');
  assert.deepEqual(page.errors(), [], 'console errors: ' + JSON.stringify(page.errors()));
}
