// Chart tokens per ground (DESIGN-SPEC section 10.1, "Chart tokens"). Pure data: no DOM. The chrome tokens live in
// css/tokens.css; these are the colours and widths the canvas draws with. Colours are hex, alphas are 0-1, widths are
// CSS px. Both grounds are frozen so a renderer cannot change them by accident.
// Paper is the default ground (light, the ECMWF published look); Night is the dark ground (a construction, labelled so).

const deepFreeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v); return Object.freeze(o); };

export const CHART = deepFreeze({
  paper: {
    ground: 'paper',
    ocean: '#F6F7F9',
    land: '#E9E6E0',
    // Heavier than the spec table (outlines drowned in the bands: "still hard to see country outlines"): both lines sit on a 3 px casing
    // at 0.9 (the table: 2.25-2.5 px at 0.7); the border core is 1.25 px at 0.85 (table: 1 px at 0.7). The coast core stays 1 px: at
    // 1.25 px S-LINEART measured the Hemisphere Night coast under 4.5:1 on both sides at one sample in eight. State lines 0.5 (table 0.4).
    coast: { color: '#1A1D21', alpha: 1, width: 1, casing: '#FFFFFF', casingAlpha: 0.9, casingWidth: 3 },
    border: { color: '#1A1D21', alpha: 0.85, width: 1.25, casing: '#FFFFFF', casingAlpha: 0.9, casingWidth: 3 },
    stateLine: { color: '#1A1D21', alpha: 0.5, width: 0.75 },
    graticule: { color: '#1A1D21', alpha: 0.12, width: 0.5 },
    contour: { color: '#111417', width: 1, boldWidth: 2, casing: null, casingAlpha: 0, casingWidth: 0 },
    contextContour: { color: '#111417', alpha: 0.35, width: 1 },
    // Every fifth band edge. The ink does not clear 1.5:1 on the deepest blue bands, so palette.edgeHairline() swaps to
    // the light variant on those edges (DESIGN-SPEC 4.2 asks for >= 1.5:1 against both bands; see the W2-03 notes).
    bandEdge: { color: '#111417', alpha: 0.35, width: 1 },
    bandEdgeLight: { color: '#FFFFFF', alpha: 0.35, width: 1 },
    label: { ink: '#111417', halo: '#F6F7F9', haloWidth: 3 },
    hatch: { color: '#1A1D21', alpha: 0.35, width: 1, pitch: 7, angle: 45 },
    noDataHatch: { color: '#1A1D21', alpha: 0.18, pitch: 6 },
    pin: { dot: '#1A1D21', ring: '#FFFFFF', ringWidth: 2 },
  },
  night: {
    ground: 'night',
    ocean: '#12161B',
    land: '#1C2127',
    coast: { color: '#E6E9ED', alpha: 1, width: 1, casing: '#0B0D10', casingAlpha: 0.9, casingWidth: 3 },
    border: { color: '#E6E9ED', alpha: 0.85, width: 1.25, casing: '#0B0D10', casingAlpha: 0.9, casingWidth: 3 },
    stateLine: { color: '#E6E9ED', alpha: 0.5, width: 0.75 },
    graticule: { color: '#E6E9ED', alpha: 0.14, width: 0.5 },
    contour: { color: '#E6E9ED', width: 1, boldWidth: 2, casing: '#0B0D10', casingAlpha: 0.7, casingWidth: 2.5 },
    contextContour: { color: '#E6E9ED', alpha: 0.4, width: 1 },
    bandEdge: { color: '#0B0D10', alpha: 0.45, width: 1 },
    bandEdgeLight: { color: '#E6E9ED', alpha: 0.35, width: 1 },
    label: { ink: '#E6E9ED', halo: '#12161B', haloWidth: 3 },
    hatch: { color: '#E6E9ED', alpha: 0.35, width: 1, pitch: 7, angle: 45 },
    noDataHatch: { color: '#E6E9ED', alpha: 0.2, pitch: 6 },
    pin: { dot: '#E6E9ED', ring: '#0B0D10', ringWidth: 2 },
  },
});

/** The token table for a ground; anything but 'night' is Paper. */
export function chartTokens(ground) { return ground === 'night' ? CHART.night : CHART.paper; }
