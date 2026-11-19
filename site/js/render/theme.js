// Design tokens (SPEC section 8) used by the canvas renderer and legend.
export const THEMES = {
  dark: {
    ocean: '#0C1014', land: '#14191E', hairline: '#232B33', sheet: '#12171C',
    coast: '#6B7684', border: 'rgba(107,118,132,0.4)',
    text: '#E6E9ED', text2: '#9AA4AF', ring: '#F4F1EA', sample: '#F0B429',
    contour: 'rgba(255,255,255,0.35)', contourBold: 'rgba(255,255,255,0.5)',
    halo: 'rgba(12,16,20,0.85)', panel: 'rgba(18,23,28,0.78)', isotach: 'rgba(243,218,178,0.55)',
  },
  light: {
    ocean: '#F9F6F2', land: '#EEEBE5', hairline: '#E2DED6', sheet: '#FFFFFF',
    coast: '#8A847A', border: 'rgba(138,132,122,0.4)',
    text: '#1C2024', text2: '#5F6670', ring: '#1C2024', sample: '#B7791F',
    contour: 'rgba(28,32,36,0.45)', contourBold: 'rgba(28,32,36,0.62)',
    halo: 'rgba(249,246,242,0.88)', panel: 'rgba(255,255,255,0.82)', isotach: 'rgba(69,38,110,0.55)',
  },
};
export const theme = (name) => THEMES[name] || THEMES.dark;

export const FONT_MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
export const FONT_UI = '-apple-system, "SF Pro Text", system-ui, sans-serif';
