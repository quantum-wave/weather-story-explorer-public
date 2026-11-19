// Bundled basemap (Natural Earth via world-atlas): ocean, land, graticule, coastlines, borders.
import { d3, topojson } from '../vendor.js';

let geo = null, loading = null;

/** Fetch and decode the bundled TopoJSON once. Resolves {land, borders}. */
export function loadBasemap(base = 'geo/') {
  if (geo) return Promise.resolve(geo);
  loading ||= Promise.all([fetch(base + 'land-50m.json').then(ok), fetch(base + 'countries-110m.json').then(ok)]).then(([l, c]) => {
    geo = {
      land: topojson.feature(l, l.objects.land),
      borders: topojson.mesh(c, c.objects.countries, (a, b) => a !== b),
      landLow: topojson.feature(c, c.objects.land), // 110 m coastline for drags that redraw every frame
    };
    return geo;
  });
  loading.catch(() => { loading = null; });
  return loading;
}
const ok = (r) => { if (!r.ok) throw new Error(`basemap ${r.status}`); return r.json(); };
export const basemapReady = () => geo !== null;
/** Test hook. */
export function setBasemap(g) { geo = g; }

const GRATICULE = d3.geoGraticule().step([30, 30])();

/** Ocean, graticule, land fill. ctx is in CSS px (already scaled for dpr). `low` uses the 110 m coastline. */
export function drawFills(ctx, mv, th, low = false) {
  const { W, H } = mv;
  mv.apply();
  ctx.fillStyle = th.ocean;
  ctx.fillRect(0, 0, W, H);
  const path = d3.geoPath(mv.base.proj, ctx);
  if (mv.viewId !== 'np') {
    ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = th.ocean; ctx.fill();
  }
  if (geo) { ctx.beginPath(); path(low ? geo.landLow : geo.land); ctx.fillStyle = th.land; ctx.fill(); }
  ctx.beginPath(); path(GRATICULE);
  ctx.strokeStyle = th.hairline; ctx.globalAlpha = 0.55; ctx.lineWidth = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
  if (mv.viewId !== 'np') { ctx.beginPath(); path({ type: 'Sphere' }); ctx.strokeStyle = th.hairline; ctx.lineWidth = 1; ctx.stroke(); }
}

/** Coastlines and borders, ink-thin, on a transparent canvas. */
export function drawLines(ctx, mv, th, low = false) {
  if (!geo) return;
  mv.apply();
  const path = d3.geoPath(mv.base.proj, ctx);
  ctx.lineJoin = 'round';
  ctx.beginPath(); path(geo.borders); ctx.strokeStyle = th.border; ctx.lineWidth = 0.75; ctx.stroke();
  ctx.beginPath(); path(low ? geo.landLow : geo.land); ctx.strokeStyle = th.coast; ctx.lineWidth = 0.75; ctx.stroke();
}
