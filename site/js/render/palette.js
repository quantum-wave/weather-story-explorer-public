// Lens palettes (DESIGN-SPEC sections 4.2, 5.1, 5.4, 6.1, 10.1). Pure: no DOM, no fetch, no globals.
// Each palette is a set of value bands in two colour families, chosen in the Display menu ("Map colors"):
//   - Reference: the Paper tables are the sourced ECMWF values (REFERENCES REF-20, 22, 26, 28) used hex for hex; Night tables are
//     built from them by the rule in section 10.1 (a construction, flagged). `p.paper`, `p.night` and `p.rgb` are this family.
//   - Soft (the default): derived from Reference in OKLab, band for band (a construction, flagged `softConstruction`): chroma cut
//     to SOFT_CHROMA of the Reference band's, hue kept, Paper lightness lifted part way toward white, and on a diverging palette
//     the two arms given the same lightness band for band (each pair at their mean), so the arms are symmetric. Lightness keeps
//     its order along every arm, the neutral gap stays unshaded, and every Night band still clears 3:1 on both Night grounds.
// Every function that returns a colour takes the family as its last argument ('soft' | 'reference'; anything else is Soft).
//
// Band model. `edges` are the ascending breakpoints; the intervals between them (and the two open ends) are the
// bands, and `paper[i]` / `night[i]` are the colours of the coloured bands, lowest value first. The `neutral` interval
// is not coloured (alpha 0, the ground shows through):
//   - a diverging palette (z500a, t850a) has neutral [lo, hi] in the middle, closed at both ends, and a value that
//     sits exactly on a band edge takes the band nearer zero (4 dam is the 2..4 band);
//   - a sequential palette (ws250, tp6, ivt, z500sd) has neutral [-Infinity, edges[0]); a value on an edge takes the
//     band above it (30 m/s is the first jet band).
// Beyond the last stop a value keeps the last colour. Opacity is always 1 for a coloured band.

import { CHART } from './chart-tokens.js';

// ---- colour maths (sRGB, OKLab) ----
const toRGB = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gam = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function toLab(c) {
  const [r, g, b] = c.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromLabLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const inGamut = (lc) => lc.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
/** The colour at OKLab lightness L with the given hue and at most the given chroma, chroma reduced only as far as sRGB needs. */
function atLightness(L, hueRad, chroma) {
  const make = (c) => fromLabLinear([L, c * Math.cos(hueRad), c * Math.sin(hueRad)]);
  let c = chroma;
  if (!inGamut(make(c))) { let lo = 0, hi = c; for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (inGamut(make(mid))) lo = mid; else hi = mid; } c = lo; }
  return make(c).map((v) => gam(Math.max(0, Math.min(1, v))));
}

// ---- Night construction (section 10.1) ----
const NIGHT_L = 0.58;
const NIGHT_GROUNDS = [CHART.night.ocean, CHART.night.land].map(toRGB);
function nightColour(hex, L) {
  const [, a, b] = toLab(toRGB(hex));
  const hue = Math.atan2(b, a), chroma = Math.hypot(a, b);
  let LL = L, c = atLightness(LL, hue, chroma);
  // Guard: if the hue's own luminance leaves a band under 3:1 on a Night ground, lift it until it clears.
  while (Math.min(...NIGHT_GROUNDS.map((g) => contrast(c, g))) < 3 && LL < 0.95) { LL += 0.005; c = atLightness(LL, hue, chroma); }
  return toHex(c);
}
/**
 * One arm of a palette (bands listed from the arm's strongest toward its lightest, or the reverse: any order).
 * `core` indexes the sourced bands that set the arm's lightness range; `ext` indexes construction extension stops.
 * If the core's darkest band has OKLab L under 0.58 the core is rescaled linearly from [Lmin, Lmax] to [0.58, Lmax],
 * hue kept per band; otherwise it keeps its Paper hex. An extension stop keeps its hue at L 0.58.
 */
function nightArm(paper, core, ext, extSteps) {
  const night = paper.slice();
  const Ls = core.map((i) => toLab(toRGB(paper[i]))[0]);
  const Lmin = Math.min(...Ls), Lmax = Math.max(...Ls);
  if (Lmin < NIGHT_L - 1e-9) {
    core.forEach((i, k) => {
      const L = Lmax - Lmin < 1e-9 ? NIGHT_L : NIGHT_L + ((Ls[k] - Lmin) / (Lmax - Lmin)) * Math.max(0, Lmax - NIGHT_L);
      night[i] = nightColour(paper[i], L);
    });
  }
  // Extension stops: with `extSteps` (the arm is not remapped) each gets its own lightness so the stops keep falling outward;
  // otherwise they were already part of `core` and rescaled with it.
  ext.forEach((i, k) => { night[i] = nightColour(paper[i], extSteps ? extSteps[k] : NIGHT_L); });
  return night;
}

// ---- Soft family (a construction from Reference; see the top of the file) ----
/** Share of the Reference band's OKLab chroma a Soft band keeps. */
export const SOFT_CHROMA = 0.55;
/** Paper only: how far a Soft band's OKLab lightness moves toward white (L + (1 - L) * lift; order kept). */
const SOFT_LIFT = 0.12;
/** Night only: the Soft bands' lightness range is pulled toward its floor by this share, so the light end glares less on a dark ground. */
const SOFT_NIGHT_DIM = 0.25;
/**
 * The Soft table of one ground from that ground's Reference table. `split` (a diverging palette's first high-arm band) pairs
 * band i with band n-1-i, which on both diverging palettes is the band the same distance from zero, and gives both their mean
 * lightness. Night bands are lifted, hue and chroma kept, until they clear 3:1 on both Night grounds.
 */
function softTable(ref, { lift, split, night }) {
  const lab = ref.map((h) => toLab(toRGB(h)));
  let L = lab.map(([l]) => l + (1 - l) * lift);
  if (split != null && split * 2 === L.length) L = L.map((l, i) => (l + L[L.length - 1 - i]) / 2);
  if (night) { const lo = Math.min(...L); L = L.map((l) => l - (l - lo) * SOFT_NIGHT_DIM); }
  return lab.map(([, a, b], i) => {
    const hue = Math.atan2(b, a), chroma = Math.hypot(a, b) * SOFT_CHROMA;
    let LL = L[i], c = atLightness(LL, hue, chroma);
    if (night) while (Math.min(...NIGHT_GROUNDS.map((g) => contrast(c, g))) < 3 && LL < 0.95) { LL += 0.005; c = atLightness(LL, hue, chroma); }
    return toHex(c);
  });
}

/** The colour families, the default first. */
export const MAP_COLORS = Object.freeze(['soft', 'reference']);
export const DEFAULT_COLORS = 'soft';
/** 'reference' stays Reference; anything else (absent, unknown) is the default, Soft. */
export const colorsOf = (c) => (c === 'reference' ? 'reference' : 'soft');

// ---- number words ----
const MINUS = '−';
const signed = (n) => { const r = Math.round(n); return r === 0 ? '0' : (r > 0 ? '+' : MINUS) + Math.abs(r); };
const plain = (n, digits = 0) => { const f = 10 ** digits; const r = Math.round(n * f) / f; return String(r < 0 ? MINUS + Math.abs(r) : r); };
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// ---- palette definitions ----
const Z500A_NEG = ['#000bfe', '#0017fe', '#0023fe', '#002ffe', '#003bfe', '#0047fe', '#0053fe', '#005ffe', '#006bfe', '#0077fe', '#0083fe', '#008ffe', '#009bfe', '#00a7fe', '#00b3fe', '#00bffe', '#00cbfe', '#00d7fe', '#00e3fe'];
const Z500A_POS = ['#fea400', '#fe9c00', '#fe9400', '#fe8c00', '#fe8400', '#fe7c00', '#fe7400', '#fe6c00', '#fe6400', '#fe5c00', '#fe5400', '#fe4c00', '#fe4400', '#fe3c00', '#fe3400', '#fe2c00', '#fe2400', '#fe1c00', '#fe1400'];
// REF-20's closed form, used only to build the edges: band k from zero is 2k..2k+2 dam wide.
const Z500A_EDGES = [-50, -40, ...Array.from({ length: 19 }, (_, i) => -38 + 2 * i), ...Array.from({ length: 19 }, (_, i) => 2 + 2 * i), 40, 50];
const Z500A_PAPER = ['#3a0a6e', '#4b0fa8', ...Z500A_NEG, ...Z500A_POS, '#a8102e', '#6e0a3a'];

const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

function describeZ500a(v, x = {}) {
  if (!finite(v)) return '';
  if (x.signal === 'none') {
    const sp = finite(x.spread) ? `, spread ${plain(x.spread)} dam` : '';
    return `No clear signal yet\naverage of forecasts ${signed(v)} dam${sp}`;
  }
  const a = Math.abs(v), up = v > 0;
  let w;
  if (a <= 2) w = 'near normal';
  else if (a <= 6) w = `slightly ${up ? 'above' : 'below'} normal`;
  else if (a <= 12) w = up ? 'a ridge' : 'a trough';
  else if (a <= 24) w = up ? 'strong ridge' : 'strong trough';
  else w = up ? 'exceptional ridge' : 'exceptional trough';
  return `${signed(v)} dam · ${w}`;
}
const speed = (v, x) => (x && x.units === 'us' ? [v * 2.23694, 'mph'] : [v, 'm/s']);
const describeWs250 = (v, x = {}) => {
  if (!finite(v)) return '';
  const [n, u] = speed(v, x);
  const w = v < 30 ? 'no jet here' : v < 36 ? 'strong wind aloft, below jet strength' : v < 57 ? 'jet stream' : 'strong jet stream';
  return `${plain(n)} ${u} · ${w}`;
};
const describeT850a = (v, x = {}) => {
  if (!finite(v)) return '';
  const us = x.units === 'us', n = us ? v * 1.8 : v, u = us ? '°F' : '°C', a = Math.abs(v), warm = v > 0;
  const w = a <= 1 ? 'near normal' : a <= 3 ? `a little ${warm ? 'warmer' : 'cooler'} than normal` : a <= 6 ? `${warm ? 'warmer' : 'cooler'} than normal` : `much ${warm ? 'warmer' : 'colder'} than normal`;
  return `${signed(n)} ${u} · ${w}`;
};
const describeTp6 = (v, x = {}) => {
  if (!finite(v)) return '';
  const us = x.units === 'us', w = v < 0.1 ? 'dry' : v < 2 ? 'light rain' : v < 10 ? 'moderate rain' : v < 30 ? 'heavy rain' : 'very heavy rain';
  return `${us ? plain(v / 25.4, 2) : plain(v, v < 10 ? 1 : 0)} ${us ? 'in' : 'mm'} in 6 h · ${w}`;
};
const describeIvt = (v) => {
  if (!finite(v)) return '';
  const w = v < 250 ? 'below atmospheric-river strength' : v < 500 ? 'weak atmospheric river' : v < 750 ? 'moderate atmospheric river' : v < 1000 ? 'strong atmospheric river' : v < 1250 ? 'extreme atmospheric river' : 'exceptional atmospheric river';
  return `${plain(v)} kg/m/s · ${w}`;
};
const describeSd = (v) => {
  if (!finite(v)) return '';
  const w = v < 2 ? 'forecasts agree closely' : v < 6 ? 'forecasts mostly agree' : v < 12 ? 'forecasts disagree' : 'forecasts disagree strongly';
  return `${plain(v)} dam · ${w}`;
};

function build(def) {
  const p = { ...def };
  p.paper = Object.freeze(def.paper.slice());
  const n = p.paper.length;
  if (def.neutral[0] === -Infinity) {
    p.night = nightArm(p.paper, range(0, n), []);
    p.armSplit = null;
  } else {
    p.night = p.paper.slice();
    const split = def.armSplit;
    // the low arm's extension stops are rescaled with the core (10.1 applied to the whole arm), so they fall outward
    const lowArm = nightArm(p.paper, range(0, split), []);
    const highArm = nightArm(p.paper, def.sourced ? range(split, def.sourced[1]) : range(split, n), def.sourced ? range(def.sourced[1], n) : [], [0.605, NIGHT_L]);
    for (let i = 0; i < split; i++) p.night[i] = lowArm[i];
    for (let i = split; i < n; i++) p.night[i] = highArm[i];
    p.armSplit = split;
  }
  p.night = Object.freeze(p.night);
  p.nightConstruction = true;
  p.rgb = { paper: p.paper.map(toRGB), night: p.night.map(toRGB) };
  const soft = {
    paper: Object.freeze(softTable(p.paper, { lift: def.softLift ?? SOFT_LIFT, split: p.armSplit, night: false })),
    night: Object.freeze(softTable(p.night, { lift: 0, split: p.armSplit, night: true })),
  };
  p.soft = Object.freeze(soft);
  p.softConstruction = true;
  p.tables = Object.freeze({ reference: Object.freeze({ paper: p.paper, night: p.night }), soft: p.soft });
  p.rgbs = Object.freeze({
    reference: Object.freeze({ paper: Object.freeze(p.rgb.paper), night: Object.freeze(p.rgb.night) }),
    soft: Object.freeze({ paper: Object.freeze(soft.paper.map(toRGB)), night: Object.freeze(soft.night.map(toRGB)) }),
  });
  // first interval index that is neutral
  p.neutralInterval = def.neutral[0] === -Infinity ? 0 : def.edges.indexOf(def.neutral[0]) + 1;
  Object.freeze(p.rgb.paper); Object.freeze(p.rgb.night);
  p.edges = Object.freeze(def.edges.slice());
  p.majorEdges = Object.freeze(def.majorEdges.slice());
  p.neutral = Object.freeze(def.neutral.slice());
  return Object.freeze(p);
}

export const PALETTES = Object.freeze({
  // Pattern: 19 bands per arm to +-40 dam (REF-20), two construction stops each side beyond (REF-31).
  z500a: build({
    id: 'z500a', unit: 'dam', toDisplay: (v) => v, edges: Z500A_EDGES, paper: Z500A_PAPER, neutral: [-2, 2],
    sourced: [2, 40], armSplit: 21, majorEdges: [-40, -30, -20, -10, 10, 20, 30, 40], construction: true, signed: true, describe: describeZ500a,
  }),
  // Jet stream: ECMWF 200 hPa wind bands from 30 m/s, no fade-in (REF-22, REF-23). Sourced.
  ws250: build({
    id: 'ws250', unit: 'm/s', toDisplay: (v, u) => (u === 'us' ? v * 2.23694 : v), edges: [30, 40, 50, 60, 70, 80, 90],
    paper: ['#ffff00', '#a7e700', '#5dd000', '#1fb800', '#00a110', '#008a34', '#00724b'], neutral: [-Infinity, 30],
    majorEdges: [], construction: false, signed: false, describe: describeWs250,
  }),
  // Air mass: ECMWF temperature-anomaly bins (REF-26); no fill inside +-1 C (6.1), so its two palest bins are not used.
  t850a: build({
    id: 't850a', unit: '°C', toDisplay: (v, u) => (u === 'us' ? v * 1.8 : v), edges: [-10, -6, -3, -1, 1, 3, 6, 10],
    paper: ['#003a58', '#0077b2', '#2fb9fe', '#98dbfe', '#fea998', '#fe5132', '#b21a00', '#580b00'], neutral: [-1, 1], armSplit: 4,
    majorEdges: [], construction: false, signed: true, describe: describeT850a,
  }),
  // Storms and rain: ECMWF accumulated-precipitation palette (REF-28) from 0.1 mm.
  tp6: build({
    id: 'tp6', unit: 'mm', toDisplay: (v, u) => (u === 'us' ? v / 25.4 : v), edges: [0.1, 1, 2, 5, 10, 15, 20, 30, 40, 50, 100, 300],
    paper: ['#efdbb7', '#b5f9aa', '#77f472', '#b5eff9', '#77baf9', '#3d96f4', '#1e6ded', '#ffe877', '#ffa000', '#ff0000', '#a32121', '#ff00ff'],
    neutral: [-Infinity, 0.1], majorEdges: [], construction: false, signed: false, describe: describeTp6,
  }),
  // Atmospheric rivers: CW3E thresholds from 250 kg/m/s (REF-25); the colours are a ColorBrewer-style construction.
  ivt: build({
    id: 'ivt', unit: 'kg/m/s', toDisplay: (v) => v, edges: [250, 375, 500, 625, 750, 1000, 1250, 1500],
    paper: ['#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026', '#54278f'], neutral: [-Infinity, 250],
    majorEdges: [], construction: true, signed: false, describe: describeIvt,
  }),
  // Confidence: ensemble spread of the 500 hPa height, paper to slate-violet, bands at 2, 4, 6, 8, 12 dam (a construction).
  z500sd: build({
    id: 'z500sd', unit: 'dam', toDisplay: (v) => v, edges: [2, 4, 6, 8, 12],
    paper: ['#e6e3ee', '#cbc6dc', '#a9a2c6', '#8780ad', '#5e5788'], neutral: [-Infinity, 2],
    majorEdges: [], construction: true, signed: false, describe: describeSd,
  }),
});

/** Lens id -> the field filled and the field drawn as lines (the legend can be built without the lens registry). */
export const LENS_FIELDS = Object.freeze({
  z: Object.freeze({ fill: 'z500a', lines: 'z500' }),
  j: Object.freeze({ fill: 'ws250', lines: 'ws250' }),
  s: Object.freeze({ fill: 'tp6', lines: 'msl' }),
  a: Object.freeze({ fill: 't850a', lines: 'z500' }),
  r: Object.freeze({ fill: 'ivt', lines: 'ivt' }),
  c: Object.freeze({ fill: 'z500sd', lines: 'z500' }),
});

const pal = (id) => { const p = PALETTES[id]; if (!p) throw new Error('unknown palette ' + id); return p; };
const gr = (ground) => (ground === 'night' ? 'night' : 'paper');

/** The band hex table of a palette on a ground in a colour family, lowest band first. */
export function bandColors(id, ground = 'paper', colors = DEFAULT_COLORS) { return pal(id).tables[colorsOf(colors)][gr(ground)]; }
/** The same as [r, g, b] triples. */
export function bandRGBs(id, ground = 'paper', colors = DEFAULT_COLORS) { return pal(id).rgbs[colorsOf(colors)][gr(ground)]; }

/** Interval index (0..edges.length) a value falls in, ties as described at the top of the file. */
function interval(p, v) {
  const e = p.edges, [lo, hi] = p.neutral;
  let j = 0;
  if (lo === -Infinity || v >= lo) {
    if (lo !== -Infinity && v <= hi) return p.neutralInterval; // closed neutral gap
    if (lo === -Infinity) { while (j < e.length && e[j] <= v) j++; return j; } // sequential: edge value goes up
    while (j < e.length && e[j] < v) j++; // above the gap: edge value goes down, toward zero
    return j;
  }
  while (j < e.length && e[j] <= v) j++; // below the gap: edge value goes up, toward zero
  return j;
}

/**
 * Index into a band table (`paper` / `night`, either family) of the band holding v; -1 where the palette is not drawn (the neutral interval);
 * null for no data (not a finite number). Beyond the last stop it clamps to the first or last colour.
 */
export function bandIndex(id, v) {
  const p = pal(id);
  if (!finite(v)) return null;
  const j = interval(p, v);
  if (j === p.neutralInterval) return -1;
  const i = j < p.neutralInterval ? j : j - 1;
  return Math.max(0, Math.min(p.paper.length - 1, i));
}

/** [r, g, b, a] of a value on a ground ('paper' | 'night') in a colour family; alpha 0 for the neutral gap and for no data, else 255. */
export function bandRGBA(id, v, ground = 'paper', colors = DEFAULT_COLORS) {
  const i = bandIndex(id, v);
  if (i === null || i < 0) return [0, 0, 0, 0];
  const c = bandRGBs(id, ground, colors)[i];
  return [c[0], c[1], c[2], 255];
}

/** `size` entries sampling [lo, hi] evenly, packed little-endian RGBA (an ImageData Uint32Array view). */
export function bandLUT(id, ground, size, lo, hi, colors = DEFAULT_COLORS) {
  const out = new Uint32Array(size);
  for (let k = 0; k < size; k++) {
    const v = size === 1 ? lo : lo + ((hi - lo) * k) / (size - 1);
    const [r, g, b, a] = bandRGBA(id, v, ground, colors);
    out[k] = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  return out;
}

/**
 * The hairline drawn on a major band edge (every fifth edge on z500a), or null where the edge carries none.
 * The Paper token is ink at 35%; on the deepest blue bands that gives under 1.5:1, so the light variant is returned
 * there. Contrast is measured on the hairline pixel (the ink blended over a band) against that band.
 */
export function edgeHairline(id, ground, edge, colors = DEFAULT_COLORS) {
  const p = pal(id);
  if (!p.majorEdges.some((e) => Math.abs(e - edge) < 1e-9)) return null;
  const tk = ground === 'night' ? CHART.night : CHART.paper;
  const rgb = bandRGBs(id, ground, colors);
  const d = 1e-6;
  const sides = [bandIndex(id, edge - d), bandIndex(id, edge + d)].filter((i) => i != null && i >= 0).map((i) => rgb[i]);
  const score = (t) => { const ink = toRGB(t.color); return Math.min(...sides.map((b) => contrast(b.map((x, k) => x * (1 - t.alpha) + ink[k] * t.alpha), b))); };
  const pick = score(tk.bandEdge) >= 1.5 ? tk.bandEdge : (score(tk.bandEdgeLight) > score(tk.bandEdge) ? tk.bandEdgeLight : tk.bandEdge);
  return { color: pick.color, alpha: pick.alpha, width: pick.width };
}

// ---- legend (section 5.1) ----
const LEGEND = {
  z500a: {
    title: 'Pressure pattern aloft, vs normal',
    subtitle: 'Height of the 500 hPa surface, about 5.5 km up, compared with the usual for this date.',
    unit: 'dam (tens of metres)',
    ends: { low: 'lower: trough', high: 'higher: ridge' },
    lineSample: { label: '564', text: 'the height itself: 564 = 5,640 m, every 60 m' },
    hatch: 'forecasts disagree here',
    footer: 'vs 1990-2019 normal; the world now runs warmer than that, so a faint orange is common',
  },
  ws250: {
    title: 'Jet stream wind speed',
    subtitle: 'Wind speed at 250 hPa, about 10 km up. Shading starts at 30 m/s; 36 m/s (70 kt) is the usual edge of a jet.',
    unit: 'm/s', ends: null, lineSample: { label: '36', text: 'line at 36 m/s (70 kt), the edge of the jet' }, hatch: null,
    footer: 'Colours follow ECMWF’s 200 hPa wind chart; below 30 m/s nothing is shaded',
    softFooter: 'Colours softened from ECMWF’s 200 hPa wind chart; below 30 m/s nothing is shaded',
  },
  t850a: {
    title: 'Air mass temperature, vs normal',
    subtitle: 'Temperature about 1.5 km up, compared with the usual for this date.',
    unit: '°C', ends: { low: 'colder', high: 'warmer' }, lineSample: null, hatch: null,
    footer: 'ECMWF temperature-anomaly colours; nothing is shaded within ±1 °C',
    softFooter: 'ECMWF temperature-anomaly colours, softened; nothing is shaded within ±1 °C',
  },
  tp6: {
    title: 'Rain in 6 hours',
    subtitle: 'Rain expected to fall in the 6 hours before the time shown.',
    unit: 'mm', ends: null, lineSample: null, hatch: null,
    footer: 'ECMWF rain colours, shaded from 0.1 mm',
    softFooter: 'ECMWF rain colours, softened, shaded from 0.1 mm',
  },
  ivt: {
    title: 'Moisture transport (atmospheric rivers)',
    subtitle: 'How much water vapour is moving, summed up through the air. 250 and above is an atmospheric river.',
    unit: 'kg/m/s', ends: null, lineSample: null, hatch: null,
    footer: 'Thresholds from the CW3E scale; the colours are our own',
  },
  z500sd: {
    title: 'How much forecasts disagree',
    subtitle: 'Spread of the 51 forecasts for the 500 hPa height. 6 dam is one contour’s worth of doubt.',
    unit: 'dam', ends: { low: 'forecasts agree', high: 'forecasts disagree' }, lineSample: null, hatch: null,
    footer: 'Paler means the forecasts agree; darker means they do not',
  },
};

/** An inch amount to two significant figures, no trailing zeros: 0.0039 -> "0.004", 0.039 -> "0.039", 1.97 -> "2". */
const inchLabel = (x) => (x < 0.01 ? x.toFixed(3) : String(Number(x.toPrecision(2))));

/**
 * What a legend draws for a palette on a ground and colour family over the value range [lo, hi]:
 * `{title, subtitle, unit, ends, ticks, stops, lineSample, hatch, footer}`.
 * stops: contiguous {from, to, color, gap}; the unshaded gap (z500a +-2) has gap: true and color null.
 * ticks: {value, label, major} only at hairlined edges (z500a) plus the gap edges; every edge for a banded ramp
 * that has no hairlines.
 */
export function legendSpec(id, ground, lo, hi, units = 'metric', colors = DEFAULT_COLORS) {
  const p = pal(id), words = LEGEND[id], soft = colorsOf(colors) === 'soft';
  const rgb = bandColors(id, ground, colors);
  if (lo == null || hi == null) { const e = p.edges; lo = p.neutral[0] === -Infinity ? 0 : -Math.max(...e.filter((x) => Math.abs(x) <= 40).map(Math.abs)); hi = p.neutral[0] === -Infinity ? e[e.length - 1] + 10 : -lo; }
  const bounds = [-Infinity, ...p.edges, Infinity];
  const stops = [];
  for (let j = 0; j < bounds.length - 1; j++) {
    const from = Math.max(bounds[j], lo), to = Math.min(bounds[j + 1], hi);
    if (!(to > from)) continue;
    if (j === p.neutralInterval) stops.push({ from, to, color: null, gap: true });
    else stops.push({ from, to, color: rgb[j < p.neutralInterval ? j : j - 1], gap: false });
  }
  const gapEdges = p.neutral[0] === -Infinity ? [] : p.neutral;
  const major = p.majorEdges.length ? p.majorEdges : p.edges;
  const vals = [...new Set([...major, ...gapEdges])].filter((v) => v >= lo && v <= hi).sort((a, b) => a - b);
  // Rain has a mm / in switch (W4-05): the same bands and values, labelled in the chosen unit
  const rain = id === 'tp6', us = rain && units === 'us';
  const label = (v) => (us ? inchLabel(p.toDisplay(v, 'us')) : p.signed ? (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v) : String(v));
  const ticks = vals.map((v) => ({ value: v, label: label(v), major: p.majorEdges.includes(v) || !p.majorEdges.length }));
  return {
    title: words.title, subtitle: words.subtitle, unit: us ? 'in' : words.unit, ends: words.ends, ticks, stops, lineSample: words.lineSample, hatch: words.hatch, footer: soft && words.softFooter ? words.softFooter : words.footer,
    unitSwitch: rain ? { options: ['mm', 'in'], active: us ? 'in' : 'mm' } : null,
  };
}
