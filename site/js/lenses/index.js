// The lens registry (DESIGN-SPEC 6, section 15). One lens is active at a time: a fill, its lines, its legend, its guide.
// A lens is listed only when its code is complete (`implemented: true`): the other files are registered so a later package
// fills a descriptor without touching this file or compose.js.
import pattern from './pattern.js';
import jet from './jet.js';
import surface from './surface.js';
import airmass from './airmass.js';
import rivers from './rivers.js';
import confidence from './confidence.js';

/** All six, in the order of DESIGN-SPEC 6.1. */
export const LENSES = Object.freeze([pattern, jet, surface, airmass, rivers, confidence]);

/** The lenses a person can choose: those with `implemented: true`. */
export const listed = () => LENSES.filter((l) => l.implemented);

/** The descriptor for a store `lens` code ('z' | 'j' | 's' | 'a' | 'r' | 'c'), or undefined. */
export const lens = (code) => LENSES.find((l) => l.code === code);
