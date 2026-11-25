// Viewer preferences (Display menu choices, dismissed cards). Separate from the pins store (STORE_KEY belongs to pins/).
// Keys: themePref 'auto' | 'light' | 'dark' (default 'auto'), ground 'paper' | 'night' (default 'paper'), units 'metric' | 'us'
// (default 'metric'), colors 'soft' | 'reference' (the map's colour family, default 'soft': render/palette.js). The legacy key 'theme' is migrated: a saved 'theme' counts as themePref until themePref is set, and asking for 'theme' returns the resolved theme.
const KEY = 'wse.v1.prefs';
let mem = {};
function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return mem; } }

export const THEME_PREFS = ['auto', 'light', 'dark'];
export const GROUNDS = ['paper', 'night'];
export const UNITS = ['metric', 'us'];
export const COLORS = ['soft', 'reference'];

/** The theme the system asks for. */
export function systemTheme() {
  try { return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch { return 'dark'; }
}
/** 'auto' follows the system; light and dark are explicit. */
export function resolveTheme(pref, system = systemTheme()) { return pref === 'light' || pref === 'dark' ? pref : system; }

export const prefs = {
  get(k, d = null) {
    if (k === 'theme') return resolveTheme(prefs.themePref());
    const v = read()[k];
    return v === undefined ? d : v;
  },
  set(k, v) {
    const all = { ...read(), [k]: v };
    mem = all;
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage unavailable: keep in memory */ }
  },
  // A choice saved by the MVP is the legacy key 'theme' ('light' | 'dark'): honoured until a Display menu choice (themePref) replaces it.
  themePref() { const r = read(); if (THEME_PREFS.includes(r.themePref)) return r.themePref; return r.theme === 'light' || r.theme === 'dark' ? r.theme : 'auto'; },
  ground() { const v = read().ground; return GROUNDS.includes(v) ? v : 'paper'; },
  units() { const v = read().units; return UNITS.includes(v) ? v : 'metric'; },
  colors() { const v = read().colors; return COLORS.includes(v) ? v : 'soft'; },
};
