// The share frame: annotation drawn around (and over) an off-screen map render. Used by the PNG still and each GIF frame.
// All text goes through drawText -> ctx.fillText so tests can read exactly what a viewer would read.
import { drawLegend, legendTitle } from '../render/legend.js';
import { VIEWS, LAYER_CODES } from '../contract.js';

const LEGEND_H = 30 + 14 + 4 + 24; // title line, colour bar, tick numbers at 22 px
export const STILL = { width: 1080, height: 1350 };
const SERIF = 'ui-serif, "New York", "Iowan Old Style", Georgia, serif';
const SANS = '-apple-system, "SF Pro Text", system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
export const PALETTE = {
  dark: { bg: '#0C1014', sheet: '#12171C', hair: '#232B33', text: '#E6E9ED', sub: '#9AA4AF', ring: '#F4F1EA', sample: '#F0B429', sampleInk: '#1C1408' },
  light: { bg: '#F9F6F2', sheet: '#FFFFFF', hair: '#E2DED6', text: '#1C2024', sub: '#5F6670', ring: '#1C2024', sample: '#B7791F', sampleInk: '#FFFFFF' },
};

export function drawText(ctx, str, x, y, { font, color, align = 'left' }) {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, x, y);
}
/** Greedy word wrap to maxWidth using the context's current font settings; never more than maxLines (last line ellipsised). */
export function wrapLines(ctx, text, font, maxWidth, maxLines = 99) {
  ctx.font = font;
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (ctx.measureText(next).width <= maxWidth || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1] + ' …';
    while (last.length > 4 && ctx.measureText(last).width > maxWidth) last = last.slice(0, -3).trimEnd() + ' …';
    kept[maxLines - 1] = last;
    return kept;
  }
  return lines;
}

function mapOverlayFor(state, ringColor, font, flag) {
  const f = state.focus;
  return (ctx, project) => {
    flag.called = true;
    if (!f || !project) return;
    const xy = project([f.lon, f.lat]);
    if (!xy) return;
    ctx.save();
    ctx.lineWidth = 2; ctx.strokeStyle = ringColor;
    ctx.beginPath(); ctx.arc(xy[0], xy[1], 11, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    if (f.label) drawText(ctx, String(f.label), xy[0] + 18, xy[1] + 5, { font, color: ringColor });
  };
}

/** Ask the renderer for the map at forecast hour t into ctx (0,0,width,height). */
export function renderMap(renderer, ctx, { width, height, t, state, flag, ringFont }) {
  const pal = PALETTE[state.theme] || PALETTE.dark;
  ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, width, height);
  const f = state.focus;
  renderer.renderTo(ctx, {
    width, height, t, view: state.view, layers: state.layers, theme: state.theme,
    centre: f ? { lat: f.lat, lon: f.lon } : null,
    overlays: [mapOverlayFor(state, pal.ring, ringFont, flag)],
  });
}

/** The 1080 x 1350 annotated still. */
export function drawStill(ctx, meta, state, renderer) {
  const { width: W, height: H } = STILL;
  const pal = PALETTE[state.theme] || PALETTE.dark;
  const pad = 48;
  ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H);

  let y = 0;
  if (meta.sample) {
    ctx.fillStyle = pal.sample; ctx.fillRect(0, 0, W, 60);
    drawText(ctx, meta.sampleBanner, W / 2, 39, { font: `700 24px ${SANS}`, color: pal.sampleInk, align: 'center' });
    y = 60;
  }
  const hFont = `600 46px ${SERIF}`;
  const hLines = wrapLines(ctx, meta.headline, hFont, W - 2 * pad, 2);
  y += 30;
  for (const line of hLines) { y += 54; drawText(ctx, line, pad, y, { font: hFont, color: pal.text }); }
  y += 38;
  drawText(ctx, meta.validTime, pad, y, { font: `500 26px ${MONO}`, color: pal.sub });
  y += 26;

  // Bottom block first (fixed height), the map takes what is left.
  const wordsFont = `400 24px ${SANS}`;
  const small = `400 20px ${SANS}`;
  const wordLines = wrapLines(ctx, meta.legendWords, wordsFont, W - 2 * pad, 3);
  const footLines = wrapLines(ctx, meta.footer, small, W - 2 * pad, 3);
  const runLines = wrapLines(ctx, meta.run, small, W - 2 * pad, 2);
  const sampleFoot = meta.sample ? [meta.sampleBanner] : [];
  const bottomH = 28 + LEGEND_H /*legend title, bar, ticks*/ + 20 + wordLines.length * 32 + 14 + 32 /*you are here*/ + 32 /*confidence*/ + runLines.length * 26 + 6 + 14
    + (footLines.length + sampleFoot.length) * 26 + 28;
  const mapTop = y, mapH = H - bottomH - mapTop;
  const flag = { called: false };
  const mc = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, mapH) : Object.assign(document.createElement('canvas'), { width: W, height: mapH });
  const mctx = mc.getContext('2d');
  renderMap(renderer, mctx, { width: W, height: mapH, t: state.t, state, flag, ringFont: `600 24px ${SANS}` });
  ctx.drawImage(mc, 0, mapTop);
  ctx.strokeStyle = pal.hair; ctx.lineWidth = 1;
  ctx.strokeRect(0.5, mapTop + 0.5, W - 1, mapH - 1);

  let by = mapTop + mapH + 28;
  const layerId = LAYER_CODES[meta.layer];
  drawText(ctx, legendTitle(layerId), pad, by + 22, { font: `600 24px ${SANS}`, color: pal.text });
  drawLegend(ctx, { x: pad, y: by + 30, width: W - 2 * pad, layer: layerId, theme: state.theme, baseline: 0, words: false, tickPx: 22, barH: 14 });
  by += LEGEND_H + 20;
  for (const line of wordLines) { by += 32; drawText(ctx, line, pad, by - 8, { font: wordsFont, color: pal.text }); }
  by += 14;
  const place = meta.placeLabel ? `You are here: ${meta.placeLabel} (ring on the map)` : `Showing: ${meta.region}`;
  by += 32; drawText(ctx, place, pad, by - 8, { font: `500 22px ${SANS}`, color: pal.text });
  by += 32; drawText(ctx, meta.confidence, pad, by - 8, { font: `500 22px ${SANS}`, color: pal.text });
  by += 6; for (const line of runLines) { by += 26; drawText(ctx, line, pad, by - 4, { font: small, color: pal.sub }); }
  by += 14;
  ctx.fillStyle = pal.hair; ctx.fillRect(pad, by, W - 2 * pad, 1);
  for (const line of [...sampleFoot, ...footLines]) {
    by += 26;
    drawText(ctx, line, pad, by, { font: small, color: line === meta.sampleBanner ? pal.sample : pal.sub });
  }
  return { overlayCalled: flag.called };
}

/**
 * One GIF frame onto a square ctx: map, date chip, sample banner, footer, progress bar with the focused moment marked.
 * frac = position of this frame in the range (0..1); mark = position of the focused moment (0..1) or null.
 */
export function drawGifFrame(ctx, size, meta, state, renderer, { t, dateText, frac, mark }) {
  const pal = PALETTE[state.theme] || PALETTE.dark;
  const flag = { called: false };
  renderMap(renderer, ctx, { width: size, height: size, t, state, flag, ringFont: `600 ${Math.round(size / 32)}px ${SANS}` });
  const k = size / 720;
  const px = (n) => Math.round(n * k);
  let topY = 0;
  if (meta.sample) {
    ctx.fillStyle = pal.sample; ctx.fillRect(0, 0, size, px(34));
    drawText(ctx, meta.sampleBanner, size / 2, px(23), { font: `700 ${px(16)}px ${SANS}`, color: pal.sampleInk, align: 'center' });
    topY = px(34);
  }
  // date chip, sized to its text
  const chipFont = `600 ${px(21)}px ${MONO}`;
  ctx.font = chipFont;
  const chipW = Math.ceil(ctx.measureText(dateText).width) + px(24);
  ctx.fillStyle = pal.sheet; ctx.globalAlpha = 0.86;
  ctx.fillRect(px(16), topY + px(16), chipW, px(40)); ctx.globalAlpha = 1;
  drawText(ctx, dateText, px(28), topY + px(43), { font: chipFont, color: pal.text });
  // footer + progress
  const barY = size - px(14);
  ctx.fillStyle = pal.sheet; ctx.globalAlpha = 0.86; ctx.fillRect(0, size - px(62), size, px(62)); ctx.globalAlpha = 1;
  drawText(ctx, meta.legendWords, px(16), size - px(40), { font: `400 ${px(14)}px ${SANS}`, color: pal.text });
  drawText(ctx, 'Model output, not an official forecast', px(16), size - px(22), { font: `400 ${px(14)}px ${SANS}`, color: pal.sub });
  ctx.fillStyle = pal.hair; ctx.fillRect(0, barY, size, px(6));
  ctx.fillStyle = pal.text; ctx.fillRect(0, barY, Math.max(2, size * frac), px(6));
  if (mark != null) { ctx.fillStyle = pal.sample; ctx.fillRect(Math.round(size * mark) - 1, barY - px(5), px(3), px(16)); }
}
