// Shared store and event bus (PLAN Interfaces). Real implementation, owned by WP0a.
// Events: data:manifest, data:chunk ({field, domain, chunk}), pin:focus ({pinId}),
// story:scrub ({t, lat, lon}), pins:changed, share:open ({kind}).

const initial = () => ({
  view: 'np', // np | nh | gl
  layers: { z: true, j: false, c: false, t: false },
  case: 'A',
  t: 0, // forecast hours, float
  playing: false,
  speed: 12, // forecast hours per second: 6 | 12 | 24
  focus: null, // Focus | null
  theme: 'dark', // dark | light
  sheet: 'peek', // peek | half | full
  sample: true,
});

let state = initial();
const subs = new Set();

export const store = {
  get: () => state,
  /** Shallow-merges `patch`; `layers` is merged one level deeper. Notifies subscribers with (state, patch). */
  set(patch) {
    const next = { ...state, ...patch };
    if (patch.layers) next.layers = { ...state.layers, ...patch.layers };
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
