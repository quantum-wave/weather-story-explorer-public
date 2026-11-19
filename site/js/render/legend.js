// Legend drawn on a 2D context (in-app on the map canvas, and into every export).
import { anomalyRGBA, jetRGBA } from './colormap.js';
import { theme as themeTokens, FONT_UI, FONT_MONO } from './theme.js';
import { getManifest } from '../data/index.js';
import { store } from '../state.js';

const SPECS = {
  z: { title: '500 hPa height vs normal', unit: 'dam', min: -24, max: 24, ticks: [-24, -12, 0, 12, 24], kind: 'anom', k: 1,
    words: 'Blue: lower pressure aloft, usually unsettled. Amber: higher, usually settled.' },
  t: { title: 'Surface temperature vs mean', unit: 'K', min: -12, max: 12, ticks: [-12, -6, 0, 6, 12], kind: 'anom', k: 2,
    words: 'Blue: colder than the mean. Amber: warmer.' },
  j: { title: '250 hPa jet', unit: 'm/s', min: 30, max: 80, ticks: [30, 45, 60, 80], kind: 'jet',
    words: 'Brighter: faster jet-stream winds, where storms steer.' },
  c: { title: 'Forecast spread', unit: 'dam', min: 0, max: 9, ticks: [0, 3, 6, 9], kind: 'none',
    words: 'Higher: the model runs disagree more.' },
};

function wrap(ctx, text, maxW) {
  const lines = []; let line = '';
  for (const w of text.split(' ')) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/** "500 hPa height vs normal (dam)": the bar's title for exports. */
export const legendTitle = (layer) => { const sp = SPECS[layer] || SPECS.z; return `${sp.title} (${sp.unit})`; };

/** The plain-words line under a layer's legend bar. */
export const legendWords = (layer) => (SPECS[layer] || SPECS.z).words;

/** The amber sample badge text for the active case, or '' for live data. */
export function sampleBadge(caseId) {
  const m = getManifest();
  if (!m?.sample) return '';
  const label = m.cases?.[caseId ?? store.get().case]?.label;
  return `Sample data · ${label ?? 'demo'} · not a forecast`;
}

/**
 * Draw one layer's legend with its top-left corner at (x, y), `width` CSS px wide. Returns the height used.
 * Options: layer 'z'|'j'|'t'|'c', theme 'dark'|'light', sat (anomaly saturation, as drawn on the map).
 * words true (default): title, colour bar with ticks, climatology baseline, plain-words line, sample badge, and a
 *   translucent panel (panel: false drops it); baseline = the climatology label ('vs ' is added; undefined = the
 *   manifest's; a falsy value = none); badge = the sample text (default derived from the manifest; '' = none);
 *   fade (0-1) adds the "colours fade" note.
 * words false: compact, just the colour bar and its tick numbers, no panel, text or padding (about 26 px tall).
 */
export function drawLegend(ctx, { x = 0, y = 0, width = 240, layer = 'z', theme = 'dark', baseline, words = true,
  badge, fade = 0, panel = true, sat = 1, tickPx = 12, barH = 0 } = {}) {
  const th = themeTokens(theme), spec = SPECS[layer] || SPECS.z, compact = !words, pad = compact ? 0 : 10, inner = Math.max(40, width - 2 * pad);
  const m = getManifest();
  const baseLabel = baseline === undefined ? (m?.climatology?.label ?? '') : (typeof baseline === 'string' ? baseline : '');
  const base = spec.kind === 'anom' && baseLabel ? (/^vs /i.test(baseLabel) ? baseLabel : `vs ${baseLabel}`) : '';
  const badgeText = typeof badge === 'string' ? badge : sampleBadge();
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  // measure
  ctx.font = `12px ${FONT_UI}`;
  const wordLines = !compact ? wrap(ctx, spec.words, inner) : [];
  const fadeLines = !compact && fade > 0.02 ? wrap(ctx, 'Colours fade where the forecast runs disagree.', inner) : [];
  const badgeLines = badgeText && !compact ? wrap(ctx, badgeText, inner) : [];
  const baseLines = base && !compact ? wrap(ctx, base, inner) : [];
  const LH = 15, bh = barH || (compact ? 8 : 10);
  const titleH = compact ? 0 : LH + 6;
  const h = pad + titleH + bh + (compact ? 3 : 4) + (compact ? tickPx : LH) + baseLines.length * LH
    + (wordLines.length + fadeLines.length) * LH + (badgeLines.length ? 4 + badgeLines.length * LH : 0) + (compact ? 0 : pad - 4);
  if (panel && !compact) {
    ctx.fillStyle = th.panel;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, width, h, 10) : ctx.rect(x, y, width, h); ctx.fill();
  }
  let cy = y + pad;
  if (!compact) {
    ctx.fillStyle = th.text; ctx.font = `600 12px ${FONT_UI}`;
    ctx.fillText(`${spec.title} · ${spec.unit}`, x + pad, cy + 11);
    cy += titleH;
  }
  // colour bar
  const bx = x + pad, by = cy, bw = inner, n = Math.max(2, Math.floor(bw));
  ctx.fillStyle = th.land; ctx.fillRect(bx, by, bw, bh);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1), v = spec.min + u * (spec.max - spec.min);
    const c = spec.kind === 'anom' ? anomalyRGBA(v * spec.k, theme, sat) : spec.kind === 'jet' ? jetRGBA(v) : [155, 164, 175, Math.round(255 * u * 0.8)];
    ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;
    ctx.fillRect(bx + (i * bw) / n, by, bw / n + 0.6, bh);
  }
  ctx.strokeStyle = th.hairline; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
  cy = by + bh + (compact ? 3 : 4) + Math.round(tickPx * 0.9);
  // ticks
  ctx.font = `${tickPx}px ${FONT_MONO}`; ctx.fillStyle = th.text2;
  for (const t of spec.ticks) {
    const u = (t - spec.min) / (spec.max - spec.min), tx = bx + u * bw;
    ctx.fillRect(tx - 0.5, by + bh, 1, 3);
    const label = (t > 0 && spec.kind === 'anom' ? '+' : '') + t;
    const tw = ctx.measureText(label).width;
    ctx.fillText(label, Math.min(bx + bw - tw, Math.max(bx, tx - tw / 2)), cy);
  }
  ctx.font = `12px ${FONT_UI}`; ctx.fillStyle = th.text2;
  for (const l of [...baseLines, ...wordLines, ...fadeLines]) { cy += LH; ctx.fillText(l, bx, cy); }
  if (badgeLines.length) {
    cy += 4; ctx.fillStyle = th.sample; ctx.font = `600 12px ${FONT_UI}`;
    for (const l of badgeLines) { cy += LH; ctx.fillText(l, bx, cy); }
  }
  ctx.restore();
  return h;
}
