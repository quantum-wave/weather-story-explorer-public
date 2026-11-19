// Group colours: oklch(0.78 0.11 hue) on dark, oklch(0.52 0.12 hue) on light (SPEC section 8), converted to hex
// here so canvas, SVG and Node tests agree and no browser needs oklch() support.
const clamp01 = (x) => Math.min(1, Math.max(0, x));
function enc(c) { c = clamp01(c); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }

/** oklch (L 0..1, C, hue degrees) -> '#rrggbb' (gamut-clipped by channel clamp). */
export function oklchHex(L, C, hueDeg) {
  const h = (hueDeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return '#' + [r, g, bl].map((v) => Math.round(enc(v) * 255).toString(16).padStart(2, '0')).join('');
}

export function groupColor(hue, theme = 'dark') {
  return theme === 'light' ? oklchHex(0.52, 0.12, hue) : oklchHex(0.78, 0.11, hue);
}
