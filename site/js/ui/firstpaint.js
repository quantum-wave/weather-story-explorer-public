// First paint without d3 (W3-05, design spec 8.5; acceptance 4: "300 ms after navigation on a throttled network the ground and coastline
// are drawn"). d3, topojson, the renderer's modules and the 110 m basemap together are about 400 KB, which a fast-4G link cannot deliver in
// 300 ms. This module and its pre-projected geometry (firstpaint-geo.js, written by tools/build-firstpaint.mjs) are a few KB and need no
// library: the Regional view's coastline (world-atlas 110 m, the same mesh the renderer strokes) and its 30-degree graticule, projected
// once at build time with the renderer's own projection at scale 1 and translate 0. A conic projection's screen position is
// translate + scale * that unit position, so fitting the view here is two numbers, computed exactly as render/view.js baseProjection does.
//
// The ground and graticule go on #map itself (the renderer paints the same ground and graticule over them). The coastline goes on its own
// transparent canvas over #map, removed by main.js once the renderer has drawn the real 110 m coastline: the renderer draws once before the
// basemap has parsed, and that frame has no coastline, so a coastline painted on #map would vanish for a moment.
import { chartTokens } from '../render/chart-tokens.js';
import { GEO } from './firstpaint-geo.js';

const MAX_DPR = 2; // as render/index.js
const SF = [-122.42, 37.77], ANCHOR = [-150, 60]; // two places whose unit positions GEO carries, to compare with the renderer
// As ui/layout.js: the phone's one row of map tools (60 px), and the peek sheet. layout.js sizes the peek to the focus card (at most
// 180 px), which first paint cannot measure before the data arrives: 132 px is that peek on the default sample at 360-390 px wide
// (measured after W3-04), so the booted chart does not jump there. S-STATUS fails when the two fits differ by more than 2 px.
const VIEW_ROW_H = 60, PEEK_H = 132;
// The scrubber's height once it has mounted (measured on the synthetic, synthetic-15d and recorded data after W3-08: 56 px docked on the
// phone sheet at peek, 165 px on the desktop rail, at 360-390 and 1024-1440 px wide). main.js reserves it on #timeline at first paint,
// so the chart is fitted around the scrubber from the first frame and does not jump when the scrubber arrives. S-STATUS fails when the
// first-paint San Francisco and the booted renderer's differ by more than 2 px, so a change to the scrubber's height shows up there.
export const TIMELINE_H = { phone: 56, desktop: 165 };

/** Decode one encoded line set: lines separated by ';', each a run of delta-coded integers (x, y pairs) in units of 1 / GEO.q. */
export function decode(s, q = GEO.q) {
  if (!s) return [];
  return s.split(';').map((line) => {
    const v = line.split(',').map(Number), out = new Float64Array(v.length);
    let x = 0, y = 0;
    for (let i = 0; i < v.length; i += 2) { x += v[i]; y += v[i + 1]; out[i] = x / q; out[i + 1] = y / q; }
    return out;
  });
}

/**
 * The Regional view's scale and translate on a W x H canvas (CSS px) with `inset` reserved, as baseProjection('np', W, H, inset) fits it:
 * landscape fits the 160E-60W, 15-72N box; portrait fits 22-60N on San Francisco's meridian and puts San Francisco 60 % across.
 * Returns {k, tx, ty}: screen = [tx + k * ux, ty + k * uy].
 */
export function fitRegional(W, H, inset = {}, g = GEO) {
  const m = Math.round(Math.min(W, H) * 0.01);
  const x0 = m + (inset.left || 0), y0 = m + (inset.top || 0), x1 = W - m - (inset.right || 0), y1 = H - m - (inset.bottom || 0);
  const fx1 = Math.max(x0 + 1, x1), fy1 = Math.max(y0 + 1, y1), w = fx1 - x0, h = fy1 - y0;
  const b = W >= H ? g.land : g.port;
  const k = Math.min(w / (b[2] - b[0]), h / (b[3] - b[1]));
  let tx = x0 + (w - k * (b[0] + b[2])) / 2;
  const ty = y0 + (h - k * (b[1] + b[3])) / 2;
  if (W < H) tx = x0 + 0.6 * (fx1 - x0) - k * g.sf[0];
  return { k, tx, ty };
}

/** The edges the renderer reserves on the canvas (ui/layout.js pad()): on the phone the view row and the peek sheet with the scrubber
 *  docked on it; on the desktop nothing (the scrubber is a grid row under the canvas). `timelineH` is #timeline's height. */
export function firstInset(phone, timelineH = 0) {
  return phone ? { top: VIEW_ROW_H, bottom: PEEK_H + Math.round(timelineH) } : {};
}

let coastLines = null, gratLines = null;

/**
 * Paint the ground, the graticule and the coastline on `canvas` (#map). `view` is the view the app opens on; only Regional (the default)
 * is pre-projected. `ocean` is the ground colour the renderer will paint. Returns null when nothing was drawn, else {fit, hold()}:
 * `anchors` are [lonlat, unit] pairs for comparing the fit with the renderer's. hold() lays the same coastline on a transparent canvas over the map and returns it. main.js calls it in the same task as the
 * renderer's first frame, which repaints #map before the basemap has parsed and so has no coastline; the overlay keeps the coastline on
 * screen until the renderer has drawn its own, then main.js removes it. No frame ever shows the line twice.
 */
export function paintFirst(canvas, { view = 'np', ocean, ground = 'paper', phone = false, timelineH = 0 } = {}) {
  if (!canvas || view !== 'np') return null;
  const r = canvas.getBoundingClientRect();
  const W = Math.round(r.width), H = Math.round(r.height);
  if (W < 2 || H < 2) return null;
  const dpr = Math.min(MAX_DPR, Math.max(1, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1));
  let fit = fitRegional(W, H, firstInset(phone, timelineH));
  const tk = chartTokens(ground);
  coastLines ||= decode(GEO.coast);
  gratLines ||= decode(GEO.graticule);
  const trace = (ctx, lines) => {
    ctx.beginPath();
    for (const p of lines) {
      ctx.moveTo(fit.tx + fit.k * p[0], fit.ty + fit.k * p[1]);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(fit.tx + fit.k * p[i], fit.ty + fit.k * p[i + 1]);
    }
  };
  const coast = (ctx) => { // casing under core, as render/basemap.js drawLines
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    trace(ctx, coastLines);
    ctx.globalAlpha = tk.coast.casingAlpha; ctx.strokeStyle = tk.coast.casing; ctx.lineWidth = tk.coast.casingWidth; ctx.stroke();
    ctx.globalAlpha = tk.coast.alpha; ctx.strokeStyle = tk.coast.color; ctx.lineWidth = tk.coast.width; ctx.stroke();
    ctx.globalAlpha = 1;
  };
  // on the map canvas, at the size the renderer will give it
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = ocean || tk.ocean; c.fillRect(0, 0, W, H);
  trace(c, gratLines);
  c.strokeStyle = tk.graticule.color; c.globalAlpha = tk.graticule.alpha; c.lineWidth = tk.graticule.width; c.stroke(); c.globalAlpha = 1;
  coast(c);
  const hold = () => {
    const over = document.createElement('canvas');
    over.className = 'wse-first-coast';
    over.setAttribute('aria-hidden', 'true');
    over.width = Math.round(W * dpr); over.height = Math.round(H * dpr);
    over.style.cssText = `position:absolute;left:${canvas.offsetLeft}px;top:${canvas.offsetTop}px;width:${W}px;height:${H}px;pointer-events:none;z-index:1`;
    const o = over.getContext('2d');
    o.setTransform(dpr, 0, 0, dpr, 0, 0);
    coast(o);
    // The phone's sheet settles on its measured peek while the data loads (ui/layout.js), which re-pads the renderer's view before the
    // basemap has parsed: the overlay is redrawn at the renderer's new scale and translate instead of leaving the map with no coastline.
    over.refit = (nf) => {
      fit = { k: nf.k, tx: nf.tx, ty: nf.ty };
      o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, over.width, over.height); o.setTransform(dpr, 0, 0, dpr, 0, 0);
      coast(o);
    };
    canvas.after(over);
    return over;
  };
  return { fit: { ...fit, W, H }, anchors: [[SF, GEO.sf], [ANCHOR, GEO.anchor]], hold };
}
