// Colour ramps (SPEC section 8). Anomaly: cool arm below, warm arm above, OKLab interpolation between the
// tabled stops, nothing at or below +-3 dam. Jet: purple to cream from 30 m/s.
// Pure: no DOM.

/** [dam, dark below, dark above, light below, light above] */
export const STOPS = [
  [3, '#202F42', '#3C2918', '#D4E6FE', '#F9DFCA'],
  [6, '#2B4260', '#58391D', '#B2CFF3', '#E9C4A5'],
  [9, '#355781', '#754A22', '#92B7E7', '#DAA97F'],
  [12, '#406CA3', '#935C25', '#72A0DA', '#C98E59'],
  [15, '#4C82C6', '#B26E27', '#5188CD', '#B9742E'],
  [18, '#5799EB', '#D38029', '#2F70BF', '#A25D04'],
  [24, '#73B1FF', '#F09638', '#0859AC', '#854A00'],
];
export const JET_STOPS = [[30, '#45266E'], [45, '#9553A4'], [60, '#E48EBF'], [80, '#F3DAB2']];
export const ANOM_ZERO = 3; // dam: no shading at or below
const ALPHA_RAMP = 1.5; // dam over which shading fades in above ANOM_ZERO

// ---- OKLab ----
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gamma = (c) => { c = Math.min(1, Math.max(0, c)); return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; };

/** sRGB [0-255 or 0-1 via hex string] -> OKLab [L, a, b]. */
export function toOKLab(rgb255) {
  const [r, g, b] = rgb255.map((c) => toLin(c / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function fromOKLab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => Math.round(gamma(c) * 255));
}
const lab = (h) => toOKLab(hex(h).map((c) => c * 255));
export const hexToOKLab = lab;

const ARMS = {
  dark: { below: STOPS.map((s) => [s[0], lab(s[1])]), above: STOPS.map((s) => [s[0], lab(s[2])]) },
  light: { below: STOPS.map((s) => [s[0], lab(s[3])]), above: STOPS.map((s) => [s[0], lab(s[4])]) },
};
const JET = JET_STOPS.map((s) => [s[0], lab(s[1])]);

function ramp(stops, x) {
  if (x <= stops[0][0]) return stops[0][1];
  const n = stops.length;
  if (x >= stops[n - 1][0]) return stops[n - 1][1];
  let i = 0;
  while (stops[i + 1][0] < x) i++;
  const [x0, c0] = stops[i], [x1, c1] = stops[i + 1], u = (x - x0) / (x1 - x0);
  return [c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u];
}

/** The OKLab colour of the anomaly ramp at |dam| (before the alpha ramp), `sat` scales chroma. */
export function anomalyLab(dam, theme = 'dark', sat = 1) {
  const arm = (ARMS[theme] || ARMS.dark)[dam < 0 ? 'below' : 'above'];
  const c = ramp(arm, Math.abs(dam));
  return [c[0], c[1] * sat, c[2] * sat];
}

/** dam anomaly -> [r, g, b, a] (a 0-255). Nothing at or below 3 dam; shading fades in over the next 1.5 dam.
 *  `sat` (0-1) scales colour saturation (the confidence fade and the jet-on halving). */
export function anomalyRGBA(dam, theme = 'dark', sat = 1) {
  const m = Math.abs(dam);
  if (!(m > ANOM_ZERO)) return [0, 0, 0, 0];
  const [r, g, b] = fromOKLab(anomalyLab(dam, theme, sat));
  return [r, g, b, Math.round(Math.min(1, (m - ANOM_ZERO) / ALPHA_RAMP) * 255)];
}

/** wind speed m/s -> [r, g, b, a]. Nothing below 30 m/s; alpha 0 -> 0.85 from 30 to 60 m/s. */
export function jetRGBA(ms) {
  if (!(ms > 30)) return [0, 0, 0, 0];
  const [r, g, b] = fromOKLab(ramp(JET, ms));
  return [r, g, b, Math.round(Math.min(1, (ms - 30) / 30) * 0.85 * 255)];
}

// ---- lookup tables (Uint32, little-endian RGBA) for the raster ----
export const LUT_SIZE = 1024;
export const ANOM_RANGE = 30; // dam-equivalents covered by the LUT: -30..+30
export const JET_MAX = 90; // m/s
const lutCache = new Map();
const pack = ([r, g, b, a]) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

/** 1024-entry LUT over -30..+30 dam. `sat` quantised to 1/16. */
export function anomalyLUT(theme = 'dark', sat = 1) {
  const q = Math.round(Math.min(1, Math.max(0, sat)) * 16) / 16, key = `a|${theme}|${q}`;
  let lut = lutCache.get(key);
  if (!lut) {
    lut = new Uint32Array(LUT_SIZE);
    for (let i = 0; i < LUT_SIZE; i++) lut[i] = pack(anomalyRGBA(-ANOM_RANGE + (i * 2 * ANOM_RANGE) / (LUT_SIZE - 1), theme, q));
    lutCache.set(key, lut);
  }
  return lut;
}
/** 1024-entry LUT over 0..90 m/s. */
export function jetLUT() {
  let lut = lutCache.get('j');
  if (!lut) {
    lut = new Uint32Array(LUT_SIZE);
    for (let i = 0; i < LUT_SIZE; i++) lut[i] = pack(jetRGBA((i * JET_MAX) / (LUT_SIZE - 1)));
    lutCache.set('j', lut);
  }
  return lut;
}

/** Confidence fade (SPEC section 8): saturation 1 up to 3 dam domain-mean spread, falling to 0.6 at 9 dam. */
export function fadeSaturation(spreadGpm) {
  if (!(spreadGpm > 0)) return 1;
  const dam = spreadGpm / 10;
  return 1 - 0.4 * Math.min(1, Math.max(0, (dam - 3) / 6));
}
