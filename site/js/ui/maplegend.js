// The always-visible on-map legend: colour bar, ticks, what it measures and (sample mode) the amber case badge.
// A renderer overlay (live canvas only; exports draw their own legend). Wide screens get the full panel with the
// plain-words line; phones get a compact bar with its title so the map keeps its room (the header carries the
// sample badge there).
import { drawLegend, sampleBadge, legendWords } from '../render/legend.js';
import { getManifest } from '../data/index.js';
import { theme as themeTokens, FONT_UI } from '../render/theme.js';

const ORDER = ['z', 'j', 't', 'c'];
const TITLE = { z: '500 hPa height vs normal · dam', j: '250 hPa wind · m/s', t: 'Surface temperature vs mean · K', c: 'Forecast spread · dam' };
const MARGIN = 12;
let scratch = null;
const heights = new Map();

function measure(opts) {
  // the height depends on the climatology label and the sample badge, which arrive with the manifest
  const key = [opts.layer, opts.theme, opts.width, opts.baseline, opts.badge, getManifest()?.climatology?.label, sampleBadge()].join('|');
  if (!heights.has(key)) {
    scratch ||= (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : Object.assign(document.createElement('canvas'), { width: 8, height: 8 })).getContext('2d');
    heights.set(key, drawLegend(scratch, { ...opts, x: 0, y: 0 }));
    if (heights.size > 40) heights.delete(heights.keys().next().value);
  }
  return heights.get(key);
}

/** Bottom of the part of the canvas the user can see: the scrubber and the phone sheet are docked over its lower edge. */
function visibleHeight(info) {
  try {
    const c = document.getElementById('map')?.getBoundingClientRect(), t = document.getElementById('timeline')?.getBoundingClientRect();
    const st = document.getElementById('stage')?.getBoundingClientRect();
    let h = info.height;
    if (c && st && st.bottom > c.top) h = Math.min(h, st.bottom - c.top);
    if (c && t && t.height > 0 && t.top > c.top && t.top < c.top + h) h = t.top - c.top;
    return h;
  } catch { /* use the whole canvas */ }
  return info.height;
}

export function legendOverlay(ctx, _project, info0) {
  const info = { ...info0, height: visibleHeight(info0) };
  const layer = ORDER.find((k) => info.layers?.[k]);
  if (!layer || !info.width) return;
  const wide = info.width >= 620 && info.height >= 420;
  const base = { layer, theme: info.theme };
  if (wide) {
    const opts = { ...base, width: 290, words: true, panel: true, baseline: layer === 't' ? 'the 2-year mean of this sample' : undefined };
    const h = measure(opts);
    drawLegend(ctx, { ...opts, x: MARGIN, y: info.height - MARGIN - h });
    return;
  }
  // compact: a small panel with the title, the bar, its ticks and the plain-words line
  const th = themeTokens(info.theme), w = Math.min(info.width - 2 * MARGIN, 330);
  ctx.save();
  ctx.font = `11px ${FONT_UI}`;
  const words = wrapWords(ctx, legendWords(layer), w - 16).slice(0, 2);
  const h = 14 + 8 + 26 + 4 + words.length * 14 + 6;
  const x = MARGIN, y = info.height - MARGIN - h;
  ctx.fillStyle = th.panel;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, 8) : ctx.rect(x, y, w, h); ctx.fill();
  ctx.font = `600 11px ${FONT_UI}`; ctx.fillStyle = th.text; ctx.textBaseline = 'alphabetic';
  ctx.fillText(TITLE[layer], x + 8, y + 16);
  ctx.font = `11px ${FONT_UI}`; ctx.fillStyle = th.text2;
  words.forEach((l, i) => ctx.fillText(l, x + 8, y + 14 + 8 + 26 + 14 + i * 14));
  ctx.restore();
  drawLegend(ctx, { ...base, x: x + 8, y: y + 22, width: Math.min(220, w - 16), words: false, baseline: false });
}

function wrapWords(ctx, text, maxW) {
  const lines = []; let line = '';
  for (const word of text.split(' ')) {
    const t = line ? line + ' ' + word : word;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = word; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}
