// Map overlay for pins (renderer.addOverlay(fn)), design spec 4.4. Pins are ink, not hue: an 8 px dot with a 2 px ring in the
// ground's opposite (ink on white on Paper, light on dark on Night), so a pin cannot vanish into a band of its own colour. A
// trip is an open ring, home a 2 px ring with a casing, the focused pin 11 px. On the viewer's own screen each pin carries its
// name (a person's name, a place or trip label); labels are placed in priority order (home, focused pin, trip pins, other pins)
// and one that would overlap a higher item or any dot by a pixel is not drawn. Above 40 pins on screen the map draws one dot per
// city with a count. `labels: 'export'` draws no name at all (shared images, GIFs and links never carry a person's name).
import { pins as defaultPins } from './index.js';
import { todayISO } from './quickadd.js';

export const GROUP_COUNT_THRESHOLD = 40;
export const DOT = 4;            // radius: 8 px dots
export const FOCUS_DOT = 5.5;    // 11 px
const RING = 2;
const FONT = '600 12px -apple-system, "SF Pro Text", system-ui, sans-serif';
const FOCUS_FONT = '600 13px -apple-system, "SF Pro Text", system-ui, sans-serif';
const MAX_LABEL = 22;

/** Colours per chart ground: the dot, the ring around it, text, and the text halo. */
export const INK = {
  paper: { dot: '#1A1D21', ring: '#FFFFFF', text: '#1A1D21', halo: 'rgba(255,255,255,0.85)' },
  night: { dot: '#F4F1EA', ring: '#0B0D10', text: '#F4F1EA', halo: 'rgba(11,13,16,0.85)' },
};
const groundOf = (s) => (s?.ground === 'paper' || s?.ground === 'night' ? s.ground : s?.theme === 'light' ? 'paper' : 'night');
const clip = (t) => { t = String(t ?? '').trim(); return t.length > MAX_LABEL ? t.slice(0, MAX_LABEL - 1) + '…' : t; };
const same = (f, c) => !!f && !!c && Math.abs(f.lat - c.lat) < 0.006 && Math.abs(f.lon - c.lon) < 0.006;

/**
 * @param {{project:(ll:number[])=>number[]|null}} renderer
 * @param {{pins?:object, today?:()=>string, labels?:boolean|'export'}} [opts] labels: true (default) names on screen; false none; 'export' no name
 * @returns {((ctx:CanvasRenderingContext2D, project:Function, state:object)=>void) & {hits:Array}}
 */
export function pinOverlay(renderer, opts = {}) {
  const source = opts.pins || defaultPins;
  const today = opts.today || (() => todayISO());
  const mode = opts.labels === undefined ? true : opts.labels;

  function draw(ctx, project, state) {
    const proj = project || renderer?.project;
    if (!proj) return;
    const ink = INK[groundOf(state)];
    const canvas = ctx.canvas || {};
    const W = state?.width ?? canvas.clientWidth ?? canvas.width ?? Infinity;
    const H = state?.height ?? canvas.clientHeight ?? canvas.height ?? Infinity;
    const onScreen = (p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] >= -DOT && p[1] >= -DOT && p[0] <= (W || Infinity) + DOT && p[1] <= (H || Infinity) + DOT;
    const focus = state?.focus || null;

    const items = [];
    for (const p of source.all()) {
      const xy = proj([p.city.lon, p.city.lat]);
      if (onScreen(xy)) items.push({ id: p.id, xy, city: p.city, label: p.name, focused: same(focus, p.city) && focus.kind !== 'trip' });
    }
    draw.hits = [];
    const dots = [];   // every drawn marker: labels of lower priority keep clear of them
    const boxes = [];  // placed labels
    ctx.save();
    ctx.lineJoin = 'round';

    const ring = (xy, r, hollow) => {
      ctx.beginPath(); ctx.arc(xy[0], xy[1], r, 0, Math.PI * 2);
      if (hollow) { ctx.lineWidth = RING + 2; ctx.strokeStyle = ink.ring; ctx.stroke(); ctx.lineWidth = RING; ctx.strokeStyle = ink.dot; ctx.stroke(); return; }
      ctx.lineWidth = RING * 2; ctx.strokeStyle = ink.ring; ctx.stroke();
      ctx.fillStyle = ink.dot; ctx.fill();
    };
    const mark = (xy, r) => dots.push({ x: xy[0] - r - 2, y: xy[1] - r - 2, w: 2 * r + 4, h: 2 * r + 4 });

    const wantText = mode === true;
    ctx.font = FONT; ctx.textBaseline = 'middle';
    // ui/focus.js draws the focused place's name 17 px right of the focus point in a 13 px 600 font. That label is the
    // highest-priority item: reserve its box so no pin name lands on it, and say nothing twice when a pin's own name is the
    // same place ("San Francisco" beside "San Francisco, CA").
    const focusLabel = focus && focus.label ? String(focus.label) : '';
    const fxy = focusLabel && Number.isFinite(focus.lat) && Number.isFinite(focus.lon) ? proj([focus.lon, focus.lat]) : null;
    if (wantText && fxy) {
      ctx.font = FOCUS_FONT; const fw = ctx.measureText(focusLabel).width; ctx.font = FONT;
      boxes.push({ x: fxy[0] + 17 - 2, y: fxy[1] - 9, w: fw + 4, h: 18 });
    }
    const norm = (t) => String(t).toLowerCase().replace(/\s+/g, ' ').trim();
    const namesFocus = (xy, text) => !!fxy && Math.abs(xy[0] - fxy[0]) < 1.5 && Math.abs(xy[1] - fxy[1]) < 1.5
      && (norm(focusLabel) === norm(text) || norm(focusLabel).startsWith(norm(text) + ','));
    const tryLabel = (xy, r, text) => {
      if (!wantText || !text || namesFocus(xy, text)) return;
      const w = ctx.measureText(text).width, hgt = 14;
      const spots = [[xy[0] + r + 6, xy[1], false], [xy[0] - r - 6 - w, xy[1], false], [xy[0] - w / 2, xy[1] - r - 11, false], [xy[0] - w / 2, xy[1] + r + 11, false]];
      for (const [x, y] of spots) {
        const box = { x: x - 2, y: y - hgt / 2, w: w + 4, h: hgt };
        const hitsBox = (b) => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y;
        // a dot of the label's own pin is not an obstacle; any other dot or label is
        const own = { x: xy[0] - r - 2, y: xy[1] - r - 2, w: 2 * r + 4, h: 2 * r + 4 };
        if (boxes.some(hitsBox) || dots.some((d) => !(d.x === own.x && d.y === own.y) && hitsBox(d))) continue;
        if (box.x < 0 || box.x + box.w > (W || Infinity)) continue;
        boxes.push(box);
        ctx.lineWidth = 3; ctx.strokeStyle = ink.halo; ctx.strokeText(text, x, y);
        ctx.fillStyle = ink.text; ctx.fillText(text, x, y);
        return;
      }
    };

    const home = source.home();
    const hxy = home && proj([home.lon, home.lat]);
    const homeOn = onScreen(hxy);
    const t0 = today();
    const trips = [];
    for (const t of source.trips()) {
      if (t.end < t0) continue;
      const xy = proj([t.city.lon, t.city.lat]);
      if (onScreen(xy)) trips.push({ id: t.id, xy, label: t.label, focused: same(focus, t.city) });
    }

    if (items.length > GROUP_COUNT_THRESHOLD) {
      // One dot per city, with a count. Position is the first pin's projection of that city.
      const byCity = new Map();
      for (const it of items) {
        const k = it.city.id !== '' ? String(it.city.id) : it.city.lat + ',' + it.city.lon;
        const e = byCity.get(k) || { xy: it.xy, city: it.city, ids: [] };
        e.ids.push(it.id);
        byCity.set(k, e);
      }
      const clusters = [...byCity.values()].sort((a, b) => b.ids.length - a.ids.length);
      for (const c of clusters) {
        const n = c.ids.length;
        const r = n === 1 ? DOT : Math.min(11, DOT + 1.5 + Math.sqrt(n));
        ring(c.xy, r, false); mark(c.xy, r);
        draw.hits.push({ x: c.xy[0], y: c.xy[1], r: Math.max(r, 20), ids: c.ids, cityId: c.city.id, lat: c.city.lat, lon: c.city.lon });
      }
      if (mode !== false) {
        // a city count is a city name, never a person's: it is also drawn in 'export' mode
        const was = ctx.font; ctx.font = FONT;
        for (const c of clusters) if (c.ids.length > 1) { const text = `${c.city.name} · ${c.ids.length}`; const w = ctx.measureText(text).width, x = c.xy[0] + 10, y = c.xy[1];
          const box = { x: x - 2, y: y - 7, w: w + 4, h: 14 };
          if (boxes.some((b) => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y)) continue;
          boxes.push(box); ctx.lineWidth = 3; ctx.strokeStyle = ink.halo; ctx.strokeText(text, x, y); ctx.fillStyle = ink.text; ctx.fillText(text, x, y); }
        ctx.font = was;
      }
    } else {
      for (const it of items) {
        const r = it.focused ? FOCUS_DOT : DOT;
        ring(it.xy, r, false); mark(it.xy, r);
        draw.hits.push({ x: it.xy[0], y: it.xy[1], r: 22, ids: [it.id] });
      }
    }
    for (const t of trips) { ring(t.xy, t.focused ? FOCUS_DOT + 1.5 : DOT + 1.5, true); mark(t.xy, DOT + 2); draw.hits.push({ x: t.xy[0], y: t.xy[1], r: 22, ids: [t.id] }); }
    if (homeOn) {
      ctx.beginPath(); ctx.arc(hxy[0], hxy[1], DOT + 3.5, 0, Math.PI * 2);
      ctx.lineWidth = RING + 2; ctx.strokeStyle = ink.ring; ctx.stroke(); ctx.lineWidth = RING; ctx.strokeStyle = ink.dot; ctx.stroke();
      mark(hxy, DOT + 4);
      draw.hits.push({ x: hxy[0], y: hxy[1], r: 22, ids: ['home'] });
    }

    // Names, highest priority first: home, the focused pin, trips, then the other pins.
    if (wantText && items.length <= GROUP_COUNT_THRESHOLD) {
      if (homeOn) tryLabel(hxy, DOT + 4, clip(home.name));
      for (const it of items.filter((x) => x.focused)) tryLabel(it.xy, FOCUS_DOT, clip(it.label));
      for (const t of trips) tryLabel(t.xy, DOT + 2, clip(t.label));
      for (const it of items.filter((x) => !x.focused)) tryLabel(it.xy, DOT, clip(it.label));
    } else if (wantText && homeOn) tryLabel(hxy, DOT + 4, clip(home.name));
    ctx.restore();
  }
  draw.hits = [];
  return draw;
}
