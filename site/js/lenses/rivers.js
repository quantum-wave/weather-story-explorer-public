// The Atmospheric rivers lens (DESIGN-SPEC 6.1, MET-10): integrated vapour transport (IVT, how much water vapour is moving, summed
// up through the air), filled from 250 kg/m/s, with a thin contour every 250 and the CW3E category word in the readout.
//
// Sources and the colour record.
//   Thresholds: the CW3E Atmospheric River scale (REFERENCES REF-25): 250-500 weak, 500-750 moderate, 750-1000 strong,
//   1000-1250 extreme, above 1250 exceptional; contours every 250 starting at 250 as in CW3E's AR Landfall Tool. Sourced.
//   Colours: a construction (CW3E publishes no hex values; REF-25). The eight bands in render/palette.js are ColorBrewer's
//   YlOrRd-9 classes 3 to 9 (#fed976 #feb24c #fd8d3c #fc4e2a #e31a1c #bd0026 #800026) and, for IVT above 1500, Purples-9
//   class 8 (#54278f), so the ramp runs yellow, orange, red, dark red and then turns violet for the rare extreme.
//   Re-checked 2026-11-19 (W4-04) against ColorBrewer's published colour data (axismaps/colorbrewer export/colorbrewer.js,
//   the specification colorbrewer2.org serves): YlOrRd 9 = #ffffcc #ffeda0 #fed976 #feb24c #fd8d3c #fc4e2a #e31a1c #bd0026
//   #800026 and Purples 9 = #fcfbfd #efedf5 #dadaeb #bcbddc #9e9ac8 #807dba #6a51a3 #54278f #3f007d: all eight hex values match.
//   Not checked in the colorbrewer2.org web page itself (an interactive app a script cannot read); the data file is the source.
import { PALETTES } from '../render/palette.js';

export default {
  code: 'r',
  id: 'rivers',
  name: 'Atmospheric rivers',
  blurb: 'Narrow streams of moisture, and how strong',
  implemented: true,
  /** IVT is built on the 00Z run only, so most runs say when it arrives. */
  available(manifest) {
    return manifest?.fields?.ivt ? { ok: true } : { ok: false, reason: 'Arrives with the 00Z run' };
  },
  fill: { field: 'ivt', palette: 'ivt' },
  // Thin contours every 250 from 250 (no 0 line: `from`), labelled every 500.
  lines: [{ field: 'ivt', step: 250, from: 250, bold: [], labelEvery: 500, unit: 1, style: 'contour' }],
  guide: {
    answer: 'An atmospheric river is a long, narrow stream of moisture in the air, like a river in the sky. This shows where they are and how strong. Where one reaches land it brings heavy rain, or heavy snow in the mountains.',
    what: 'How much water vapour is moving, added up through the whole height of the air, in kilograms per metre per second. Shading starts at 250: below that there is no atmospheric river and nothing is drawn.',
    read: 'Yellow and orange are weak rivers (250 to 500), red is moderate to strong, dark red is extreme and violet is exceptional. The thin lines mark every 250. A bright streak pointing at a coast, such as California or Oregon, is the signal to watch: the longer and stronger it is, the more rain it can drop.',
    worth: [
      'The categories (weak, moderate, strong, extreme, exceptional) are the CW3E scale used for West Coast atmospheric rivers.',
      'Moisture alone does not make rain: where the river meets mountains or a storm is what matters.',
      'The colours are our own choice; the 250 and above thresholds are from CW3E.',
    ],
  },
  /** Readout words: "800 kg/m/s · strong atmospheric river". */
  describe(value, extra) { return PALETTES.ivt.describe(value, extra); },
};
