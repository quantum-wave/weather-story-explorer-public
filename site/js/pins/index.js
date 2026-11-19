// Pins, trips and groups: per-viewer store (SPEC section 5). Pins never leave this browser: no file, link or share
// path reads them except through exports the viewer triggers. Names and notes are user text: render with textContent.
import { STORE_KEY } from '../contract.js';
import { bus, store } from '../state.js';
import * as gaz from './gazetteer.js';
import { parseQuickAdd, todayISO, isoDate } from './quickadd.js';
import { copyAllLines, toCSV } from './format.js';

export { gazetteer } from './gazetteer.js';
export { parseQuickAdd } from './quickadd.js';
export { pinOverlay } from './overlay.js';

const SF = { id: 5391959, name: 'San Francisco', admin: 'CA', cc: 'US', lat: 37.77, lon: -122.42 };
const DEFAULT_GROUPS = [{ id: 'family', name: 'Family', hue: 30 }, { id: 'friends', name: 'Friends', hue: 200 }, { id: 'work', name: 'Work', hue: 290 }];
const NEXT_HUES = [140, 350, 75, 250, 170, 320, 110, 230];
const MAX_NAME = 80, MAX_NOTE = 500;

const fresh = () => ({ v: 1, home: { ...SF }, homeSet: false, groups: DEFAULT_GROUPS.map((g) => ({ ...g })), pins: [], trips: [], meta: { backupDismissedAt: 0 } });
const rid = (p) => p + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6);
const clone = (o) => JSON.parse(JSON.stringify(o));
const fold = gaz.fold;
const isISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !!isoDate(+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10));
const r1 = (x) => Math.round(x * 10) / 10;
const titleCase = (s) => (s === s.toLowerCase() ? s.replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : s);

// ---- storage: localStorage, then sessionStorage, then memory; each step in try/catch --------------------------------
function makeBackend(globalObj) {
  const probe = (kind) => {
    try {
      const s = globalObj[kind];
      if (!s) return null;
      const k = STORE_KEY + '.probe';
      s.setItem(k, '1'); s.removeItem(k);
      return s;
    } catch { return null; }
  };
  const mem = new Map();
  const memory = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => { mem.delete(k); } };
  const local = probe('localStorage');
  const session = local ? null : probe('sessionStorage');
  return { kind: local ? 'local' : session ? 'session' : 'memory', local, area: local || session || memory, memory };
}

/**
 * Build a pins store. Tests pass their own `storage` (an object with getItem/setItem/removeItem, or {localStorage, sessionStorage}),
 * `gazetteer`, `bus`, and `today`.
 */
export function createPins({ storage, gazetteer = gaz, eventBus = bus, today = () => todayISO(), focusStore = store } = {}) {
  const be = makeBackend(storage && storage.getItem ? { localStorage: storage } : storage || globalThis);
  let kind = be.kind;
  let area = be.area;
  let writeOk = true;
  let doc = fresh();
  let loadedRaw = null;

  function read() {
    let raw = null;
    try { raw = area.getItem(STORE_KEY); } catch { raw = null; }
    loadedRaw = raw;
    if (!raw) return fresh();
    try {
      const d = JSON.parse(raw);
      if (!d || d.v !== 1 || !Array.isArray(d.pins) || !Array.isArray(d.trips)) throw new Error('shape');
      const f = fresh();
      const out = { ...f, ...d, meta: { ...f.meta, ...(d.meta || {}) } };
      out.groups = Array.isArray(d.groups) && d.groups.length ? d.groups : f.groups;
      out.home = gaz.snapshotCity(d.home) || f.home;
      out.pins = d.pins.filter((p) => p && p.id && typeof p.name === 'string' && gaz.snapshotCity(p.city)).map((p) => ({ ...p, kind: p.kind === 'place' ? 'place' : 'person', group: p.group || '', note: p.note || '' }));
      out.trips = d.trips.filter((t) => t && t.id && isISO(t.start) && isISO(t.end) && gaz.snapshotCity(t.city));
      return out;
    } catch {
      try { area.setItem(STORE_KEY + '.unreadable', raw); } catch { /* keep going with an empty store */ }
      return fresh();
    }
  }
  function write() {
    const text = JSON.stringify(doc);
    try { area.setItem(STORE_KEY, text); loadedRaw = text; return; } catch { /* quota or blocked: step down */ }
    writeOk = false;
    if (area !== be.memory) {
      area = be.memory; kind = 'memory';
      try { area.setItem(STORE_KEY, text); } catch { /* memory cannot fail */ }
    }
  }
  const changed = (what) => { write(); eventBus.emit('pins:changed', what || {}); };

  doc = read();
  // Another tab changed the store.
  try {
    globalThis.addEventListener?.('storage', (e) => {
      if (e.key !== STORE_KEY || kind === 'memory') return;
      const raw = e.newValue;
      if (raw === loadedRaw) return;
      doc = read();
      eventBus.emit('pins:changed', { external: true });
    });
  } catch { /* no window */ }

  const ro = (o) => clone(o);
  const groupIds = () => new Set(doc.groups.map((g) => g.id));
  const findIdx = (id) => {
    let i = doc.pins.findIndex((p) => p.id === id);
    if (i >= 0) return { list: 'pins', i };
    i = doc.trips.findIndex((t) => t.id === id);
    return i >= 0 ? { list: 'trips', i } : null;
  };
  const cleanName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

  const api = {
    all: () => doc.pins.map(ro),
    trips: () => [...doc.trips].sort((a, b) => a.start.localeCompare(b.start) || a.label.localeCompare(b.label)).map(ro),
    groups: () => doc.groups.map(ro),
    home: () => ({ ...doc.home }),
    homeIsDefault: () => !doc.homeSet,
    setHome(city) {
      const c = gaz.snapshotCity(city);
      if (!c) return false;
      doc.home = c; doc.homeSet = true;
      changed({ home: true });
      return true;
    },
    get(id) { const f = findIdx(id); return f ? ro(doc[f.list][f.i]) : null; },
    count: () => doc.pins.length,

    add({ kind: k = 'person', name, group = '', city, note = '' } = {}) {
      const c = gaz.snapshotCity(city);
      const nm = cleanName(name);
      if (!c || !nm) return null;
      const pin = { id: rid('p'), kind: k === 'place' ? 'place' : 'person', name: nm, group: groupIds().has(group) ? group : '', city: c, note: String(note ?? '').slice(0, MAX_NOTE), updated: Date.now() };
      if (pin.kind === 'place' && nm !== c.name) { pin.city = { ...c, lat: r1(c.lat), lon: r1(c.lon) }; }
      doc.pins.push(pin);
      changed({ id: pin.id, op: 'add' });
      return pin.id;
    },
    update(id, patch = {}) {
      const f = findIdx(id);
      if (!f) return false;
      const o = doc[f.list][f.i];
      const next = { ...o };
      if (f.list === 'pins') {
        if ('name' in patch) { const n = cleanName(patch.name); if (n) next.name = n; }
        if ('group' in patch) next.group = groupIds().has(patch.group) ? patch.group : '';
        if ('note' in patch) next.note = String(patch.note ?? '').slice(0, MAX_NOTE);
        if ('kind' in patch && (patch.kind === 'person' || patch.kind === 'place')) next.kind = patch.kind;
        if ('city' in patch) { const c = gaz.snapshotCity(patch.city); if (c) next.city = c; }
        if (next.kind === 'place' && next.name !== next.city.name) next.city = { ...next.city, lat: r1(next.city.lat), lon: r1(next.city.lon) };
      } else {
        if ('label' in patch) { const n = cleanName(patch.label); if (n) next.label = n; }
        if ('city' in patch) { const c = gaz.snapshotCity(patch.city); if (c) next.city = c; }
        if ('start' in patch && isISO(patch.start)) next.start = patch.start;
        if ('end' in patch && isISO(patch.end)) next.end = patch.end;
        if (next.end < next.start) { if ('start' in patch && !('end' in patch)) next.end = next.start; else next.start = next.end; }
      }
      next.updated = Date.now();
      doc[f.list][f.i] = next;
      changed({ id, op: 'update' });
      return true;
    },
    /** Removes a pin or a trip. Returns undo(): puts it back where it was (once). */
    remove(id) {
      const f = findIdx(id);
      if (!f) return () => false;
      const [item] = doc[f.list].splice(f.i, 1);
      changed({ id, op: 'remove' });
      let used = false;
      return () => {
        if (used || findIdx(id)) return false;
        used = true;
        doc[f.list].splice(Math.min(f.i, doc[f.list].length), 0, item);
        changed({ id, op: 'add' });
        return true;
      };
    },
    addTrip({ label, city, start, end } = {}) {
      const c = gaz.snapshotCity(city);
      const nm = cleanName(label) || (c && c.name);
      if (!c || !nm || !isISO(start)) return null;
      const e = isISO(end) && end >= start ? end : start;
      const t = { id: rid('t'), label: nm, city: c, start, end: e, updated: Date.now() };
      doc.trips.push(t);
      changed({ id: t.id, op: 'add' });
      return t.id;
    },

    addGroup(name) {
      const nm = cleanName(name).slice(0, 30);
      if (!nm) return null;
      const have = doc.groups.find((g) => fold(g.name) === fold(nm));
      if (have) return have.id;
      let id = fold(nm).replace(/ /g, '-') || 'group';
      for (let n = 2; doc.groups.some((g) => g.id === id); n++) id = id.replace(/-\d+$/, '') + '-' + n;
      doc.groups.push({ id, name: nm, hue: NEXT_HUES[(doc.groups.length - DEFAULT_GROUPS.length + NEXT_HUES.length) % NEXT_HUES.length] });
      changed({ group: id });
      return id;
    },
    updateGroup(id, patch = {}) {
      const g = doc.groups.find((x) => x.id === id);
      if (!g) return false;
      if ('name' in patch) { const n = cleanName(patch.name).slice(0, 30); if (n) g.name = n; }
      if ('hue' in patch && Number.isFinite(+patch.hue)) g.hue = ((+patch.hue % 360) + 360) % 360;
      changed({ group: id });
      return true;
    },
    /** Pins in the group become ungrouped. Returns undo(). */
    removeGroup(id) {
      const i = doc.groups.findIndex((g) => g.id === id);
      if (i < 0 || doc.groups.length <= 1) return () => false;
      const [g] = doc.groups.splice(i, 1);
      const members = doc.pins.filter((p) => p.group === id).map((p) => p.id);
      for (const p of doc.pins) if (p.group === id) p.group = '';
      changed({ group: id });
      return () => {
        if (doc.groups.some((x) => x.id === id)) return false;
        doc.groups.splice(Math.min(i, doc.groups.length), 0, g);
        for (const p of doc.pins) if (members.includes(p.id)) p.group = id;
        changed({ group: id });
        return true;
      };
    },
    /** Match a #tag or typed name to a group (exact, then unique prefix); create it when nothing matches. */
    groupFor(token) {
      const t = fold(token);
      if (!t) return '';
      const exact = doc.groups.find((g) => fold(g.name) === t || g.id === t.replace(/ /g, '-'));
      if (exact) return exact.id;
      const pre = doc.groups.filter((g) => fold(g.name).startsWith(t));
      if (pre.length === 1) return pre[0].id;
      return api.addGroup(titleCase(String(token).replace(/[-_]+/g, ' ')));
    },

    /** Where a pin, trip or the home sits, as the story and share code want it. `label` is a city name, never a person. */
    focusOf(id) {
      if (id === 'home') return { lat: doc.home.lat, lon: doc.home.lon, label: doc.home.name, kind: 'home', placeRef: 'c' + doc.home.id };
      const f = findIdx(id);
      if (!f) return null;
      const o = doc[f.list][f.i];
      const kind = f.list === 'trips' ? 'trip' : o.kind;
      return { lat: o.city.lat, lon: o.city.lon, label: o.city.name, kind, placeRef: kind === 'person' ? null : 'c' + o.city.id };
    },
    focus(id) {
      const fo = api.focusOf(id);
      if (!fo) return false;
      focusStore.set({ focus: fo });
      eventBus.emit('pin:focus', { pinId: id });
      return true;
    },

    copyAllText: () => copyAllLines(doc).join('\n'),
    exportCSV: () => toCSV(doc),
    storageOk: () => kind === 'local' && writeOk,
    storageKind: () => kind,
    needsBackupPrompt() { const n = doc.pins.length, d = doc.meta.backupDismissedAt || 0; return n >= 10 && (d === 0 || n >= d + 10); },
    dismissBackupPrompt() { doc.meta.backupDismissedAt = doc.pins.length; changed({ meta: true }); },
    /** Test and settings hook: forget everything (keeps nothing). Returns undo(). */
    clearAll() {
      const before = clone(doc);
      doc = fresh();
      changed({ clear: true });
      return () => { doc = before; changed({ clear: true }); return true; };
    },

    // ---- text entry --------------------------------------------------------------------------------------------
    /**
     * Quick add. One line adds one thing; several lines add them all.
     * @returns {Promise<{ok:boolean, kind?:string, id?:string, summary?:string, reason?:string, query?:string, bulk?:boolean,
     *   added?:number, unresolved?:Array, duplicates?:number}>}
     */
    async quickAdd(text, opts = {}) {
      const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length > 1) { const r = await api.pasteLines(lines.join('\n')); return { ok: r.added > 0, bulk: true, ...r }; }
      if (!lines.length) return { ok: false, reason: 'empty' };
      return applyLine(lines[0], opts);
    },
    /** Adds every resolvable line; skips exact duplicates of what is already stored. Always a Promise (the gazetteer loads lazily). */
    async pasteLines(text) {
      const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      let added = 0, duplicates = 0;
      const unresolved = [];
      for (const line of lines) {
        const r = await applyLine(line, { dedupe: true });
        if (r.ok) added++;
        else if (r.reason === 'duplicate') duplicates++;
        else unresolved.push({ line, reason: reasonText(r) });
      }
      return { added, unresolved, duplicates };
    },
  };

  const reasonText = (r) => r.reason === 'no-city' ? `no city called ${r.query}` : r.reason === 'dates' ? 'trip needs dates (like Nov 27-30)' : r.reason === 'name' ? 'no name' : r.reason || 'not understood';

  async function applyLine(line, opts = {}) {
    const p = parseQuickAdd(line, opts.today || today());
    const query = p.cityQuery;
    if (!query && !opts.city) return { ok: false, reason: 'no-city', query: line, parsed: p };
    if (p.kind === 'trip' && !p.trip && !opts.trip) return { ok: false, reason: 'dates', parsed: p, query };
    let city = opts.city ? gaz.snapshotCity(opts.city) : null;
    if (!city) {
      const found = await gazetteer.search(query, 1);
      city = found[0] ? gaz.snapshotCity(found[0]) : null;
    }
    if (!city) return { ok: false, reason: 'no-city', query, parsed: p };
    if (p.kind === 'home') {
      api.setHome(city);
      return { ok: true, kind: 'home', summary: `Home · ${gaz.cityLabel(city)}` };
    }
    const where = gaz.cityLabel(city);
    const grp = p.group ? api.groupFor(p.group) : (opts.group && groupIds().has(opts.group) ? opts.group : '');
    const typedIsCity = p.name === p.cityQuery;
    const named = (n) => (typedIsCity && (fold(n) === fold(city.name) || /,/.test(n)) ? city.name : titleCase(n));
    if (p.kind === 'trip') {
      const trip = opts.trip || p.trip;
      const label = named(p.name) || city.name;
      if (opts.dedupe && doc.trips.some((t) => fold(t.label) === fold(label) && t.city.id === city.id && t.start === trip.start && t.end === trip.end)) return { ok: false, reason: 'duplicate' };
      const id = api.addTrip({ label, city, start: trip.start, end: trip.end });
      return { ok: !!id, kind: 'trip', id, summary: `${label} · ${where} · ${fmtRange(trip.start, trip.end)}` };
    }
    let name = p.kind === 'person' ? cleanName(p.name) : (named(p.name) || city.name);
    if (!name) return { ok: false, reason: 'name', parsed: p };
    let c2 = city;
    if (p.kind === 'place' && p.coords) c2 = { ...city, lat: p.coords.lat, lon: p.coords.lon };
    if (opts.dedupe && doc.pins.some((x) => x.kind === p.kind && fold(x.name) === fold(name) && x.city.id === city.id && x.group === grp)) return { ok: false, reason: 'duplicate' };
    const id = api.add({ kind: p.kind, name, group: grp, city: c2, note: p.note || '' });
    return { ok: !!id, kind: p.kind, id, summary: p.kind === 'person' ? `${name} · ${where}` : (name === city.name ? where : `${name} · ${where}`) };
  }

  return api;
}

const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Nov 27–30", "Nov 27 – Dec 2", "Nov 27" */
export function fmtRange(a, b) {
  const d = (s) => ({ y: +s.slice(0, 4), m: +s.slice(5, 7), d: +s.slice(8, 10) });
  const A = d(a), B = d(b);
  const sy = (x) => (x.y !== Number(todayISO().slice(0, 4)) ? ` ${x.y}` : '');
  if (a === b) return `${MON3[A.m - 1]} ${A.d}${sy(A)}`;
  if (A.m === B.m && A.y === B.y) return `${MON3[A.m - 1]} ${A.d}–${B.d}${sy(A)}`;
  return `${MON3[A.m - 1]} ${A.d}${A.y !== B.y ? sy(A) : ''} – ${MON3[B.m - 1]} ${B.d}${sy(B)}`;
}

/** The app's store. */
export const pins = createPins();
// Warm the gazetteer once the page is idle so the first search is instant.
if (typeof document !== 'undefined') try { (globalThis.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => { gaz.load(); }); } catch { /* not a browser */ }
