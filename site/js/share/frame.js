// The share frame: annotation drawn around (and over) an off-screen map render. Used by the PNG still and each GIF frame.
// All text goes through drawText -> ctx.fillText so tests can read exactly what a viewer would read.
import { legendBlock, wrapLines } from '../render/legend.js';

export { wrapLines };
export const STILL = { width: 1080, height: 1350 };
const SERIF = 'ui-serif, "New York", "Iowan Old Style", Georgia, serif';
const SANS = '-apple-system, "SF Pro Text", system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
/** The frame's palette for a ground: Paper is the light frame, Night the dark one (the chart's ground, not the page theme). */
export const paletteFor = (ground) => PALETTE[ground === 'paper' ? 'light' : 'dark'];
export const PALETTE = {
  dark: { bg: '#0C1014', sheet: '#12171C', hair: '#232B33', text: '#E6E9ED', sub: '#9AA4AF', ring: '#F4F1EA', sample: '#F0B429', sampleInk: '#1C1408' },
  light: { bg: '#F9F6F2', sheet: '#FFFFFF', hair: '#E2DED6', text: '#1C2024', sub: '#5F6670', ring: '#1C2024', sample: '#B7791F', sampleInk: '#FFFFFF' },
};
export function drawText(ctx, str, x, y, { font, color, align = 'left' }) {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, x, y);
}

/** True when the person has panned, zoomed or rotated the map away from its opening framing. */
export function isMoved(x) {
  return !!x && (x.k !== 1 || x.tx !== 0 || x.ty !== 0 || (x.rot || []).some((r) => r !== 0));
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

/**
 * Ask the renderer for the map at forecast hour t into ctx (0,0,width,height): the lens and ground the screen draws, and the
 * screen's own pan, zoom and rotation when the person has moved it (renderTo's xf). An unmoved map is framed on the place, as before.
 */
export function renderMap(renderer, ctx, { width, height, t, state, meta, flag, ringFont }) {
  const pal = paletteFor(meta.ground);
  ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, width, height);
  const f = state.focus;
  const xf = typeof renderer.getTransform === 'function' ? renderer.getTransform() : null;
  const moved = isMoved(xf);
  renderer.renderTo(ctx, {
    width, height, t, view: state.view, lens: state.lens, ground: meta.ground,
    theme: meta.ground === 'paper' ? 'light' : 'dark',
    xf: moved ? xf : undefined,
    centre: !moved && f ? { lat: f.lat, lon: f.lon } : null,
    overlays: [mapOverlayFor(state, pal.ring, ringFont, flag)],
  });
}

/** The 1080 x 1350 annotated still. */
export function drawStill(ctx, meta, state, renderer) {
  const { width: W, height: H } = STILL;
  const pal = paletteFor(meta.ground);
  const pad = 48, inner = W - 2 * pad;
  ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H);

  let y = 0;
  if (meta.sample) {
    ctx.fillStyle = pal.sample; ctx.fillRect(0, 0, W, 60);
    let px = 24; while (px > 15) { ctx.font = `700 ${px}px ${SANS}`; if (ctx.measureText(meta.sampleBanner).width <= inner) break; px--; }
    drawText(ctx, meta.sampleBanner, W / 2, 39, { font: `700 ${px}px ${SANS}`, color: pal.sampleInk, align: 'center' });
    y = 60;
  }
  const hFont = `600 46px ${SERIF}`;
  const hLines = wrapLines(ctx, meta.headline, hFont, inner, 2);
  y += 30;
  for (const line of hLines) { y += 54; drawText(ctx, line, pad, y, { font: hFont, color: pal.text }); }
  y += 38;
  drawText(ctx, meta.validTime, pad, y, { font: `500 26px ${MONO}`, color: pal.sub });
  y += 26;

  // Bottom block first (fixed height), the map takes what is left.
  const wordsFont = `400 24px ${SANS}`;
  const small = `400 21px ${SANS}`;
  const block = legendBlock(ctx, meta.legend, pal, inner, { small });
  const footLines = wrapLines(ctx, meta.footer, small, inner, 3);
  const runLines = meta.sample ? [] : wrapLines(ctx, meta.run, small, inner, 2); // a sample's provenance is its banner: said once
  const bottomH = 28 + block.h + 14 + 32 /*you are here*/ + 32 /*confidence*/ + (runLines.length ? 6 + runLines.length * 26 : 0) + 14
    + footLines.length * 26 + 28;
  const mapTop = y, mapH = H - bottomH - mapTop;
  const flag = { called: false };
  const mc = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, mapH) : Object.assign(document.createElement('canvas'), { width: W, height: mapH });
  const mctx = mc.getContext('2d');
  renderMap(renderer, mctx, { width: W, height: mapH, t: state.t, state, meta, flag, ringFont: `600 24px ${SANS}` });
  ctx.drawImage(mc, 0, mapTop);
  ctx.strokeStyle = pal.hair; ctx.lineWidth = 1;
  ctx.strokeRect(0.5, mapTop + 0.5, W - 1, mapH - 1);

  let by = mapTop + mapH + 28;
  block.draw(pad, by);
  by += block.h + 14;
  const place = meta.placeLabel ? `You are here: ${meta.placeLabel} (ring on the map)` : `Showing: ${meta.region}`;
  by += 32; drawText(ctx, place, pad, by - 8, { font: `500 22px ${SANS}`, color: pal.text });
  by += 32; drawText(ctx, meta.confidence, pad, by - 8, { font: `500 22px ${SANS}`, color: pal.text });
  if (runLines.length) { by += 6; for (const line of runLines) { by += 26; drawText(ctx, line, pad, by - 4, { font: small, color: pal.sub }); } }
  by += 14;
  ctx.fillStyle = pal.hair; ctx.fillRect(pad, by, inner, 1);
  for (const line of footLines) { by += 26; drawText(ctx, line, pad, by, { font: small, color: pal.sub }); }
  return { overlayCalled: flag.called };
}

/** The date stamp's ink and halo per ground: the screen's (css/datestamp.css). */
export const STAMP = {
  paper: { ink: 'rgba(28, 32, 36, 0.62)', halo: 'rgba(249, 246, 242, 0.85)' },
  night: { ink: 'rgba(244, 241, 234, 0.66)', halo: 'rgba(8, 11, 14, 0.8)' },
};
/** Draws the stamp's two lines with their top-left at (x, top), on a 720 px design scale (`px`). */
export function drawStamp(ctx, { day, hour }, x, top, px, ground) {
  const st = STAMP[ground === 'night' ? 'night' : 'paper'];
  const lines = [[day, `600 ${px(44)}px ${SANS}`, top + px(42)], [hour, `500 ${px(24)}px ${SANS}`, top + px(74)]].filter(([s]) => s);
  ctx.save();
  // the halo: a soft blurred stroke in the ground's colour under the letters (strokeText, so the words are drawn, and recorded, once)
  ctx.shadowColor = st.halo; ctx.shadowBlur = px(12); ctx.strokeStyle = st.halo; ctx.lineWidth = px(4); ctx.lineJoin = 'round';
  for (const [s, font, y] of lines) { ctx.font = font; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.strokeText(s, x, y); }
  ctx.shadowBlur = 0;
  for (const [s, font, y] of lines) drawText(ctx, s, x, y, { font, color: st.ink });
  ctx.restore();
}

/** The compact stepped bar of a GIF frame: title, bar, the countable ticks, the end words. Returns nothing; draws inside [x, x+w]. */
function gifLegend(ctx, meta, pal, size, px) {
  const x = px(16), w = size - px(32), model = meta.legend;
  if (!model) return;
  const { spec } = model;
  drawText(ctx, spec.title, x, size - px(72), { font: `600 ${px(14)}px ${SANS}`, color: pal.text });
  if (!meta.sample && meta.run) drawText(ctx, meta.run, x + w, size - px(72), { font: `400 ${px(12)}px ${SANS}`, color: pal.sub, align: 'right' });
  const by = size - px(64), bh = px(8);
  for (const b of model.bar) {
    const bx = x + (b.left / 100) * w, bw = (b.width / 100) * w;
    if (b.gap) { ctx.strokeStyle = pal.sub; ctx.lineWidth = 1; ctx.strokeRect(Math.round(bx) + 0.5, by + 0.5, Math.round(bw) - 1, bh - 1); }
    else { ctx.fillStyle = b.color; ctx.fillRect(Math.round(bx), by, Math.ceil(bw) + 0.5, bh); }
  }
  for (const t of model.ticks) {
    if (!t.major && model.ticks.length > 8) continue;
    const tx = x + (t.left / 100) * w;
    drawText(ctx, t.label, tx, size - px(42), { font: `600 ${px(11)}px ${SANS}`, color: pal.text, align: t.align === 'end' ? 'right' : t.align === 'start' ? 'left' : 'center' });
  }
  const f = `500 ${px(12)}px ${SANS}`;
  if (spec.ends) {
    drawText(ctx, spec.ends.low, x, size - px(26), { font: f, color: pal.sub });
    drawText(ctx, spec.ends.high, x + w, size - px(26), { font: f, color: pal.sub, align: 'right' });
  }
  drawText(ctx, 'Model output, not an official forecast', size / 2, size - px(26), { font: `400 ${px(12)}px ${SANS}`, color: pal.sub, align: 'center' });
}

/**
 * One GIF frame onto a square ctx: map, date stamp ({day, hour}; `dateText` alone is drawn as the day line), sample banner, legend band, progress bar with the focused moment marked.
 * frac = position of this frame in the range (0..1); mark = position of the focused moment (0..1) or null.
 */
export function drawGifFrame(ctx, size, meta, state, renderer, { t, dateText, stamp, frac, mark }) {
  const pal = paletteFor(meta.ground);
  const flag = { called: false };
  renderMap(renderer, ctx, { width: size, height: size, t, state, meta, flag, ringFont: `600 ${Math.round(size / 32)}px ${SANS}` });
  const k = size / 720;
  const px = (n) => Math.round(n * k);
  let topY = 0;
  if (meta.sample) {
    ctx.fillStyle = pal.sample; ctx.fillRect(0, 0, size, px(34));
    let f = 16; while (f > 9) { ctx.font = `700 ${px(f)}px ${SANS}`; if (ctx.measureText(meta.sampleBanner).width <= size - px(24)) break; f--; }
    drawText(ctx, meta.sampleBanner, size / 2, px(23), { font: `700 ${px(f)}px ${SANS}`, color: pal.sampleInk, align: 'center' });
    topY = px(34);
  }
  // the date stamp, as on the screen's map (ui/datestamp.js, css/datestamp.css): the day large, the hour and zone under it, translucent with a halo
  drawStamp(ctx, stamp || { day: dateText, hour: '' }, px(20), topY + px(14), px, meta.ground);
  // legend band + progress
  const barY = size - px(14);
  ctx.fillStyle = pal.sheet; ctx.globalAlpha = 0.9; ctx.fillRect(0, size - px(86), size, px(86)); ctx.globalAlpha = 1;
  gifLegend(ctx, meta, pal, size, px);
  ctx.fillStyle = pal.hair; ctx.fillRect(0, barY, size, px(6));
  ctx.fillStyle = pal.text; ctx.fillRect(0, barY, Math.max(2, size * frac), px(6));
  if (mark != null) { ctx.fillStyle = pal.sample; ctx.fillRect(Math.round(size * mark) - 1, barY - px(5), px(3), px(16)); }
}
