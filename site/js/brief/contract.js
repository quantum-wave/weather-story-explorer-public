// The Briefing's frozen contract (CONCEPTS-2026-11-20.md section 5 as amended by CONCEPTS-REVIEW-2026-11-20.md M1-M12).
// Constants and typedefs shared by the script builder, the player, the card and the wiring. No logic, no DOM.

/**
 * @typedef {{level:'high'|'medium'|'low'|'pattern-only'|'none', phrase:string, source:'spread'|'lead'|'none',
 *   signal:'clear'|'none', days:[number, number], zone:'hres'|'blend'|'mean'|'hres-late', caption:string}} Sure
 *   level: the weakest reading over the whole beat (H1); phrase: '' when the data is not live, else the confidence words
 *   or the no-clear-signal line (H2); days: the lead days the beat covers; zone and caption: the zone of its latest hour.
 * @typedef {{key:string, kind:'home'|'trip'|'person'|'place'|'shared', name:string, city:string, lat:number, lon:number}} BriefPlace
 * @typedef {{id:string, chapter:'title'|'since'|'picture'|'home'|'trip'|'people'|'sure'|'end',
 *   hook?:'hold'|'rewind'|'forward',
 *   kicker:string, title:string, lines:string[],             // at most 2 lines, each at most 110 characters
 *   view:'np'|'nh'|'gl', lens:'z'|'s'|'c',
 *   camera:{lat:number, lon:number, zoom:number}|null,        // null = the view's own framing
 *   t0:number, t1:number, ms:number,                          // forecast hours played over ms; t1 < t0 plays backwards; t0 === t1 holds a frame
 *   place:BriefPlace|null, sure:Sure|null, strip:boolean,
 *   zoneCaptions?:{from:number, caption:string}[]}} Beat      // the sure chapter: the caption changes by forecast hour
 * @typedef {{run:string, sample:boolean, dataLabel:string, beats:Beat[], totalMs:number, morePeople:number}} Script
 */

/** H1: the most a beat's camera may zoom, by the beat's weakest confidence. */
export const ZOOM_CAP = Object.freeze({ high: 3, medium: 2, low: 1.4, 'pattern-only': 1, none: 1 });
/** H1: with no ensemble spread the level comes from lead time alone, which never earns more than this zoom. */
export const LEAD_ONLY_CAP = 2;
/** H3: day-level claims and every camera stop at this forecast hour. */
export const DETAIL_END_H = 168;
/** People: a place is briefed only when its notability score is at least this. */
export const NOTABLE_FLOOR = 1;
export const MAX_PEOPLE = 3;
export const BRIEF_KEY = 'wse.v1.brief';

/** Card limits every beat meets. */
export const MAX_LINES = 2;
export const MAX_LINE_CHARS = 110;
export const MIN_BEAT_MS = 1200;
export const MAX_BEAT_MS = 14000;
/** The playing time of each kind of beat, in ms (a script is about a minute with every chapter). */
export const BEAT_MS = Object.freeze({
  title: 1500, since: 4000, hold: 3500, rewind: 6000, forward: 8000, picture: 12000, near: 5000, later: 5000, rain: 4000,
  trip: 8000, person: 5000, sure: 9000, sureHeld: 5000, end: 4000,
});
/** The np05 domain (pipeline/grids.py): a place outside it is drawn on the globe, never on the regional map. */
export const NP_BOX = Object.freeze({ latMin: 10, latMax: 75, lonMin: 150, lonMax: 310 });
