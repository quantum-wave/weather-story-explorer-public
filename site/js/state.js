// Shared store and event bus (PLAN Interfaces). Real implementation, owned by WP0a.
// Events: data:manifest, data:chunk ({field, domain, chunk}), pin:focus ({pinId}),
// story:scrub ({t, lat, lon}), pins:changed, share:open ({kind}), data:error ({field, domain, chunk, message}).
// Keys added by the redesign (design spec section 15): range, lens, overlays, ground, units, themePref, expanded.
// Readers use the default when a key is absent (range, lens and ground start absent: CHOICE_DEFAULTS). `overlays` is deep-merged one level by set(). The retired `layers` and `case` keys are gone: the lens decides what is drawn and, for a multi-case sample, which case (data/kind.js caseForLens).

const initial = () => ({
  view: 'np', // np | nh | gl | wm
  t: 0, // forecast hours, float
  playing: false,
  speed: 12, // forecast hours per second: 6 | 12 | 24
  focus: null, // Focus | null
  theme: 'dark', // dark | light
  sheet: 'peek', // peek | half | full
  sample: true,
  // range, lens and ground start absent: see CHOICE_DEFAULTS
  overlays: { contours: true, marks: true, doubt: true, jetline: false, pins: true, places: true },
  units: 'metric', // metric | us
  themePref: 'auto', // auto | light | dark
  expanded: false, // the map has the whole viewport
});

/**
 * Section 15 keys that record a choice the person makes with a control (the range control, the lens list, the Display menu). They start
 * absent, and `choice(state, key)` gives the section 15 default for a reader that wants one. Absent means "not chosen yet": the wave-3
 * readers merged before this (time/clock.js and scrubber.js loop the whole run, ui/maplegend.js takes the
 * ground from the theme) keep their behaviour until the package that adds the control sets the key. Set in the initial state they imposed
 * choices nobody could make or see: a 7-day loop on a 15-day run, the jet dropped from links, a Paper legend over a Night map
 * (S-TIMELINE, S-LINK and S-LEGEND fail on that).
 */
export const CHOICE_DEFAULTS = Object.freeze({ range: 7, lens: 'z', ground: 'paper' });
/** The key's value, else its section 15 default. */
export const choice = (s, key) => (s && s[key] !== undefined ? s[key] : CHOICE_DEFAULTS[key]);

/** Keys whose value is an object of flags merged one level deep, so a partial patch keeps the other flags. */
const DEEP = ['overlays'];

let state = initial();
const subs = new Set();

export const store = {
  get: () => state,
  /** Shallow-merges `patch`; `overlays` is merged one level deeper. Notifies subscribers with (state, patch). */
  set(patch) {
    const next = { ...state, ...patch };
    for (const k of DEEP) if (patch[k] && typeof patch[k] === 'object') next[k] = { ...state[k], ...patch[k] };
    state = next;
    for (const fn of [...subs]) fn(state, patch);
  },
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  /** Test helper: back to the initial state without notifying. */
  _reset() { state = initial(); },
};

const handlers = new Map();
export const bus = {
  on(name, fn) {
    if (!handlers.has(name)) handlers.set(name, new Set());
    handlers.get(name).add(fn);
    return () => handlers.get(name).delete(fn);
  },
  emit(name, detail) { for (const fn of [...(handlers.get(name) || [])]) fn(detail); },
};
