// Viewer preferences (theme, dismissed cards). Separate from the pins store (STORE_KEY belongs to pins/).
const KEY = 'wse.v1.prefs';
let mem = {};
function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return mem; } }
export const prefs = {
  get(k, d = null) { const v = read()[k]; return v === undefined ? d : v; },
  set(k, v) {
    const all = { ...read(), [k]: v };
    mem = all;
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage unavailable: keep in memory */ }
  },
};
