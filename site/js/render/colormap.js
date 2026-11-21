// Colour entry points kept for callers that predate render/palette.js (the legend, the story strip, old tests). Every one
// now delegates to the palette: the ECMWF open-chart bands (REF-20, 22), exact hex, opacity 1, no fade. The ramp that was
// here (a muted blue/amber table capped at 24 dam, fading in over 1.5 dam) is gone: DESIGN-SPEC 4.2, Josh point 7.
// Pure: no DOM.
import { PALETTES, bandRGBA, bandLUT } from './palette.js';

/** The ground a legacy theme name stands for: light themes draw on Paper, dark on Night (the store's `ground` overrides it). */
export const groundOfTheme = (theme) => (theme === 'light' || theme === 'paper' ? 'paper' : 'night');

/** [dam, Night below, Night above, Paper below, Paper above] at a few round magnitudes: a view of the palette for old readers. */
export const STOPS = [6, 9, 12, 15, 18, 24].map((d) => {
  const hex = (g, v) => '#' + bandRGBA('z500a', v, g).slice(0, 3).map((c) => c.toString(16).padStart(2, '0')).join('');
  return [d, hex('night', -d + 0.5), hex('night', d + 0.5), hex('paper', -d + 0.5), hex('paper', d + 0.5)];
});
export const JET_STOPS = PALETTES.ws250.edges.map((e, i) => [e, PALETTES.ws250.paper[i]]);
export const ANOM_ZERO = 2; // dam: no shading inside +-2

/** dam anomaly -> [r, g, b, a]: the band's colour, alpha 255, or 0 inside +-2 dam and for no data. `sat` is ignored: bands never fade. */
export function anomalyRGBA(dam, theme = 'dark') { return bandRGBA('z500a', dam, groundOfTheme(theme)); }

/** wind speed m/s -> [r, g, b, a]: the ECMWF jet band, nothing below 30 m/s. */
export function jetRGBA(ms, theme = 'light') { return bandRGBA('ws250', ms, groundOfTheme(theme)); }

export const LUT_SIZE = 1024;
export const ANOM_RANGE = 60; // dam-equivalents covered by the LUT: -60..+60
export const JET_MAX = 100; // m/s
const cache = new Map();
/** LUT over -60..+60 dam, packed little-endian RGBA. Edges are the palette's own, so a sample is the band colour (at 0.12 dam steps). */
export function anomalyLUT(theme = 'dark') {
  const g = groundOfTheme(theme), key = `a|${g}`;
  if (!cache.has(key)) cache.set(key, bandLUT('z500a', g, LUT_SIZE, -ANOM_RANGE, ANOM_RANGE));
  return cache.get(key);
}
/** LUT over 0..100 m/s. */
export function jetLUT(theme = 'light') {
  const g = groundOfTheme(theme), key = `j|${g}`;
  if (!cache.has(key)) cache.set(key, bandLUT('ws250', g, LUT_SIZE, 0, JET_MAX));
  return cache.get(key);
}

/** The confidence fade is retired (a band's colour never depends on the spread; doubt is a hatch): always 1. */
export function fadeSaturation() { return 1; }
