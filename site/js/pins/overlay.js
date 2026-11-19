// Map overlay for pins (renderer.addOverlay(fn)): group-coloured dots, trip rings, the home marker, and city counts
// when more than 40 pins are on screen. Draws no names of people, ever: exports may include this overlay.
import { groupColor } from './color.js';
import { pins as defaultPins } from './index.js';
import { todayISO } from './quickadd.js';

export const GROUP_COUNT_THRESHOLD = 40;
const DOT = 3.5;          // radius: 7 px dots (SPEC section 8)
const RING = 1.5;
const FONT = '12px -apple-system, "SF Pro Text", system-ui, sans-serif';

const THEME = {
  dark: { bg: '#0C1014', ink: '#F4F1EA', text: '#E6E9ED', trip: '#9AA4AF' },
  light: { bg: '#F9F6F2', ink: '#1C2024', text: '#1C2024', trip: '#5F6670' },
};

/**
 * @param {{project:(ll:number[])=>number[]|null}} renderer
 * @param {{pins?:object, today?:()=>string, labels?:boolean}} [opts] `pins` for tests; labels:false drops the city count text
 * @returns {((ctx:CanvasRenderingContext2D, project:Function, state:object)=>void) & {hits:Array}}
 */
export function pinOverlay(renderer, opts = {}) {
  const source = opts.pins || defaultPins;
  const today = opts.today || (() => todayISO());
  const labels = opts.labels !== false;

  function draw(ctx, project, state) {
    const proj = project || renderer?.project;
    if (!proj) return;
    const theme = THEME[state?.theme === 'light' ? 'light' : 'dark'];
    const themeName = state?.theme === 'light' ? 'light' : 'dark';
    const canvas = ctx.canvas || {};
    const W = state?.width ?? canvas.clientWidth ?? canvas.width ?? Infinity;
    const H = state?.height ?? canvas.clientHeight ?? canvas.height ?? Infinity;
    const onScreen = (p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] >= -DOT && p[1] >= -DOT && p[0] <= (W || Infinity) + DOT && p[1] <= (H || Infinity) + DOT;
    const hues = new Map(source.groups().map((g) => [g.id, g.hue]));

    const items = [];
    for (const p of source.all()) {
      const xy = proj([p.city.lon, p.city.lat]);
      if (onScreen(xy)) items.push({ id: p.id, xy, city: p.city, hue: hues.get(p.group) });
    }
    draw.hits = [];
    ctx.save();
    ctx.lineJoin = 'round';

    if (items.length > GROUP_COUNT_THRESHOLD) {
      // One dot per city, with a count. Position is the first pin's projection of that city.
      const byCity = new Map();
      for (const it of items) {
        const k = it.city.id !== '' ? String(it.city.id) : it.city.lat + ',' + it.city.lon;
        const e = byCity.get(k) || { xy: it.xy, city: it.city, ids: [], hues: new Map() };
        e.ids.push(it.id); e.hues.set(it.hue, (e.hues.get(it.hue) || 0) + 1);
        byCity.set(k, e);
      }
      const clusters = [...byCity.values()].sort((a, b) => b.ids.length - a.ids.length);
      for (const c of clusters) {
        const n = c.ids.length;
        const top = [...c.hues.entries()].sort((a, b) => b[1] - a[1])[0][0];
        const r = n === 1 ? DOT : Math.min(11, DOT + 1.5 + Math.sqrt(n));
        dot(ctx, c.xy, r, top === undefined ? theme.trip : groupColor(top, themeName), theme.bg);
        draw.hits.push({ x: c.xy[0], y: c.xy[1], r: Math.max(r, 14), ids: c.ids, cityId: c.city.id, lat: c.city.lat, lon: c.city.lon });
      }
      if (labels) {
        ctx.font = FONT; ctx.textBaseline = 'middle'; ctx.lineWidth = 3; ctx.strokeStyle = theme.bg; ctx.fillStyle = theme.text;
        const placed = [];
        for (const c of clusters) {
          if (c.ids.length < 2) continue;
          const text = `${c.city.name} · ${c.ids.length}`;
          const w = ctx.measureText(text).width;
          const x = c.xy[0] + 10, y = c.xy[1];
          if (placed.some((b) => x < b.x + b.w && x + w > b.x && Math.abs(y - b.y) < 14)) continue; // skip a label that would collide
          placed.push({ x, y, w });
          ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
        }
      }
    } else {
      for (const it of items) {
        dot(ctx, it.xy, DOT, it.hue === undefined ? theme.trip : groupColor(it.hue, themeName), theme.bg);
        draw.hits.push({ x: it.xy[0], y: it.xy[1], r: 14, ids: [it.id] });
      }
    }

    // Upcoming and current trips: hollow rings. Home: a ring in the focus-ring ink.
    const t0 = today();
    for (const t of source.trips()) {
      if (t.end < t0) continue;
      const xy = proj([t.city.lon, t.city.lat]);
      if (!onScreen(xy)) continue;
      ctx.beginPath(); ctx.arc(xy[0], xy[1], DOT + 1.5, 0, Math.PI * 2);
      ctx.lineWidth = RING + 0.5; ctx.strokeStyle = theme.bg; ctx.stroke();
      ctx.lineWidth = RING; ctx.strokeStyle = theme.ink; ctx.stroke();
      draw.hits.push({ x: xy[0], y: xy[1], r: 14, ids: [t.id] });
    }
    const home = source.home();
    const hxy = home && proj([home.lon, home.lat]);
    if (onScreen(hxy)) {
      ctx.beginPath(); ctx.arc(hxy[0], hxy[1], DOT + 3.5, 0, Math.PI * 2);
      ctx.lineWidth = 2; ctx.strokeStyle = theme.ink; ctx.stroke();
      draw.hits.push({ x: hxy[0], y: hxy[1], r: 14, ids: ['home'] });
    }
    ctx.restore();
  }
  draw.hits = [];
  return draw;
}

function dot(ctx, xy, r, fill, bg) {
  ctx.beginPath(); ctx.arc(xy[0], xy[1], r, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = RING; ctx.strokeStyle = bg; ctx.stroke();
}
