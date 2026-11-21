// The Pattern lens: the 500 hPa height anomaly as ECMWF's banded fill, with the height itself as contours (DESIGN-SPEC 6.1, 5.2).
// The legend text comes from palette.legendSpec('z500a'); this descriptor carries the guide and the readout words.
import { PALETTES } from '../render/palette.js';

export default {
  code: 'z',
  id: 'pattern',
  name: 'Pattern',
  blurb: 'Ridges and troughs about 5.5 km up',
  implemented: true,
  /** Drawable when this run has the anomaly field. */
  available(manifest) {
    return manifest?.fields?.z500a ? { ok: true } : { ok: false, reason: 'Not in this run' };
  },
  fill: { field: 'z500a', palette: 'z500a' },
  // z500 is stored in whole metres (gpm): a level every 60 m is every 6 dam; 552, 564, 576 and 588 dam are bold; every 12 dam is labelled.
  lines: [{ field: 'z500', step: 60, bold: [5520, 5640, 5760, 5880], labelEvery: 120, unit: 0.1, style: 'contour' }],
  // The spread field behind the doubt hatch (the overlay "Uncertain areas").
  doubt: { field: 'z500sd', limitGpm: 60 },
  guide: {
    answer: 'Yes, this is the pressure pattern. It is the 500 mb height anomaly, the same kind of chart forecasters show in long-range videos. Meteorologists say "height" rather than "pressure" at this level: where the surface sits higher than normal, pressure aloft is higher than normal.',
    what: 'The height of the 500 hPa surface, about 5.5 km up, compared with the usual for this date. The colours show how far above or below normal it is; the black lines are the height itself.',
    read: 'Orange and red: a ridge. It is usually drier under a ridge; in winter, valleys can stay cold and foggy under one. Blue: a trough. Weather tends to be wettest just ahead of a trough as it approaches; behind it, colder and clearing. The black lines are the height itself, in tens of metres. The wind aloft, and the jet stream, flows along them, fastest where they crowd together, and storms travel with that flow.',
    worth: [
      'A faint orange wash over the tropics is normal: the atmosphere is warmer than the 1990-2019 average this is compared with.',
      'Count the thin lines inside the colour: each marks 10 dam (100 m) further from normal.',
    ],
  },
  /** Readout words for a value in dam: "+14 dam · strong ridge". `extra` may carry {signal, spread}. */
  describe(value, extra) { return PALETTES.z500a.describe(value, extra); },
};
