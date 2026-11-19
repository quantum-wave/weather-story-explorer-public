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
    coast: { color: '#1A1D21', alpha: 1, width: 1, casing: '#FFFFFF', casingAlpha: 0.7, casingWidth: 2.5 },
    // casingAlpha 0.9, not the 0.7 of the spec table: S-LINEART measured only 2.8:1 for the border core against its halo on the
    // deepest blue at 0.7 (W3-02); the coast keeps 0.7 (its core is opaque).
    border: { color: '#1A1D21', alpha: 0.7, width: 1, casing: '#FFFFFF', casingAlpha: 0.9, casingWidth: 2.25 },
    stateLine: { color: '#1A1D21', alpha: 0.4, width: 0.75 },
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
    coast: { color: '#E6E9ED', alpha: 1, width: 1, casing: '#0B0D10', casingAlpha: 0.7, casingWidth: 2.5 },
    border: { color: '#E6E9ED', alpha: 0.7, width: 1, casing: '#0B0D10', casingAlpha: 0.9, casingWidth: 2.25 },
    stateLine: { color: '#E6E9ED', alpha: 0.4, width: 0.75 },
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
