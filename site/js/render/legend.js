// The legend drawn on a 2D context: the canvas twin of the DOM legend card (ui/maplegend.js), used by every share still and GIF
// (share/frame.js) and by anything else that draws the legend into a canvas. It does not keep a second description of the legend:
// it draws legendModel() (ui/maplegend.js), the model the DOM card is built from, so the stepped bar, the band edges, the countable
// ticks, the end words, the line sample, the hatch note and every sentence are the screen's own (DESIGN-SPEC 5.1, 6.1).
import { legendModel } from '../ui/maplegend.js';
import { theme as themeTokens, FONT_UI } from './theme.js';
import { getManifest } from '../data/index.js';

function drawText(ctx, str, x, y, { font, color, align = 'left' }) {
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


/**
 * The stepped legend of the screen (legendModel: the same stops, edges and words) as one block. measure() gives its height at a
 * width; draw(y) paints it. Sized for the 1080 px still (`small` is its 21 px words font). Returns null without a model.
 */
export function legendBlock(ctx, model, pal, width, { small }) {
  if (!model) return null;
  const { spec } = model, bar = 20, tickFont = `500 21px ${FONT_UI}`, endsFont = `500 21px ${FONT_UI}`;
  const subLines = wrapLines(ctx, spec.subtitle, small, width, 2);
  const rows = [];
  if (spec.lineSample) rows.push({ kind: 'line', label: spec.lineSample.label, text: spec.lineSample.text });
  if (model.hatch && spec.hatch) rows.push({ kind: 'hatch', text: spec.hatch });
  const h = 30 /*title*/ + 12 + bar + 8 + 26 /*ticks*/ + (spec.ends ? 28 : 0) + 8 + subLines.length * 28 + rows.length * 30;
  const draw = (x, y) => {
    let cy = y;
    drawText(ctx, spec.title, x, cy + 24, { font: `600 26px ${FONT_UI}`, color: pal.text });
    drawText(ctx, spec.unit, x + width, cy + 24, { font: `400 22px ${FONT_UI}`, color: pal.sub, align: 'right' });
    cy += 30 + 12;
    for (const b of model.bar) {
      const bx = x + (b.left / 100) * width, bw = (b.width / 100) * width;
      if (b.gap) { ctx.strokeStyle = pal.sub; ctx.lineWidth = 1; ctx.strokeRect(Math.round(bx) + 0.5, cy + 0.5, Math.round(bw) - 1, bar - 1); }
      else { ctx.fillStyle = b.color; ctx.fillRect(Math.round(bx), cy, Math.ceil(bw) + 0.5, bar); }
    }
    ctx.fillStyle = pal.text;
    for (const t of model.ticks) ctx.fillRect(Math.round(x + (t.left / 100) * width) - 0.5, cy + bar, 1, 6);
    cy += bar + 8;
    for (const t of model.ticks) {
      const tx = x + (t.left / 100) * width, align = t.align === 'end' ? 'right' : t.align === 'start' ? 'left' : 'center';
      drawText(ctx, t.label, tx, cy + 22, { font: t.major ? `600 21px ${FONT_UI}` : tickFont, color: t.major ? pal.text : pal.sub, align });
    }
    cy += 26;
    if (spec.ends) {
      drawText(ctx, spec.ends.low, x, cy + 22, { font: endsFont, color: pal.sub });
      drawText(ctx, spec.ends.high, x + width, cy + 22, { font: endsFont, color: pal.sub, align: 'right' });
      cy += 28;
    }
    cy += 8;
    for (const line of subLines) { cy += 28; drawText(ctx, line, x, cy - 7, { font: small, color: pal.text }); }
    for (const r of rows) {
      cy += 30;
      if (r.kind === 'line') {
        drawText(ctx, r.label, x, cy - 8, { font: `600 22px ${FONT_UI}`, color: pal.text });
        drawText(ctx, r.text, x + 56, cy - 8, { font: small, color: pal.sub });
      } else {
        ctx.save(); ctx.beginPath(); ctx.rect(x, cy - 24, 40, 18); ctx.clip(); ctx.strokeStyle = pal.sub; ctx.lineWidth = 1.5;
        for (let i = -20; i < 60; i += 7) { ctx.beginPath(); ctx.moveTo(x + i, cy - 6); ctx.lineTo(x + i + 18, cy - 24); ctx.stroke(); } ctx.restore();
        drawText(ctx, r.text, x + 56, cy - 8, { font: small, color: pal.sub });
      }
    }
    return cy - y;
  };
  return { h, draw };
}


/**
 * Draw a lens's legend with its top-left corner at (x, y), `width` px wide, on the ground the screen shows. Options: lens
 * ('z' | 'j' | 's' | 'a' | 'r' | 'c', default Pattern), ground ('paper' | 'night'), state (store fields such as overlays and units,
 * default none), manifest (default the loaded one), model (a legendModel result, to draw exactly that). The block is sized for the
 * 1080 px still. Returns the height used.
 */
export function drawLegend(ctx, { x = 0, y = 0, width = 540, lens = 'z', ground = 'paper', state = {}, manifest = getManifest(), model } = {}) {
  const th = themeTokens(ground === 'paper' ? 'light' : 'dark');
  const m = model || legendModel({ ...state, lens, ground }, manifest);
  const block = legendBlock(ctx, m, { text: th.text, sub: th.text2 }, width, { small: `400 21px ${FONT_UI}` });
  ctx.save();
  block.draw(x, y);
  ctx.restore();
  return block.h;
}

/** "Pressure pattern aloft, vs normal (dam (tens of metres))"-style title for a lens: the legend's own title and unit. */
export function legendTitle(lens = 'z', ground = 'paper', manifest = getManifest()) {
  const { spec } = legendModel({ lens, ground }, manifest);
  return `${spec.title} (${spec.unit})`;
}

/** The plain-words sentence under a lens's legend bar. */
export function legendWords(lens = 'z', ground = 'paper', manifest = getManifest()) {
  return legendModel({ lens, ground }, manifest).spec.subtitle;
}
