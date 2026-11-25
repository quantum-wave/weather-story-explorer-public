// Header (design spec 3.1 and 10.4): the one-row bar. Brand, the data chip (which run or which recorded forecast, in the viewer's
// time), Share, and the Display menu (Theme, Chart, Units, Time). On the phone Share and Display live inside "More".
// Pure parts (chipModel, fitText) are exported for tests. Times are the viewer's local time; no chip text carries a Z.
// Every fact the chip states comes from data/kind.js (spec 9, 15): the kind (isLive, isMultiCase, isRecorded), the age and
// staleness, the recorded label (sampleLabel) and the run's time and zone (runLabel). The chip only chooses how much of it fits.
import { clear } from './dom.js';
import { prefs, resolveTheme, systemTheme } from './prefs.js';
import { parseRun } from './format.js';
import { caseForLens, isLive, isMultiCase, isRecorded, staleness, ageHours, sampleLabel, runLabel, runMs } from '../data/kind.js';

export const THEME_COLOR = { dark: '#0E1114', light: '#F4F2EE' };
const SEP = ' · ';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The viewer's zone name ('PST'), or '' when the browser has none. */
export function zoneName(d = new Date()) {
  try { return new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value || ''; } catch { return ''; }
}

/** Real start of a sample case, '1 Jan 2017' (never the rebased run time, never a Z suffix). */
export function caseStartLabel(manifest, caseId) {
  for (const f of manifest?.cases?.[caseId]?.fields || []) {
    const v = manifest.fields?.[f]?.source?.valid?.[0];
    if (v) { const d = parseRun(v); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
  }
  return '';
}

/** The badge sentence of SPEC section 11. */
export function sampleBadgeText(manifest, caseId) {
  if (isRecorded(manifest)) return sampleLabel(manifest); // one recorded run: the one label every surface shares (kind.js, W3-09)
  const label = manifest?.cases?.[caseId]?.label || manifest?.sample_label || '';
  return label ? `Sample data · ${label} · not a forecast` : 'Sample data · not a forecast';
}

const SEG = (parts) => parts.filter(Boolean).join(SEP);
const words = (s) => s.split(/\s+/).filter(Boolean);
/** The widest-first list of whole-segment shortenings: drop 'run', then trailing words of the model name (with the middle part), then the middle part, then more of the model name, then the model.
 *  The tail (age, stale, 'not a forecast', 'not live') is in every one and is never cut. */
function ladder(lead, mid, tail, midShort) {
  const out = [SEG([lead, mid, tail])];
  const m2 = midShort ?? mid;
  if (m2 !== mid) out.push(SEG([lead, m2, tail]));
  const lw = words(lead || '');
  if (m2) for (let n = lw.length - 1; n >= 1; n--) out.push(SEG([lw.slice(0, n).join(' '), m2, tail]));
  if (m2) out.push(SEG([lead, tail]));
  for (let n = lw.length - 1; n >= 1; n--) out.push(SEG([lw.slice(0, n).join(' '), tail]));
  out.push(tail || lead);
  return [...new Set(out.filter(Boolean))];
}

/** "ECMWF run Wed 18 Nov, 4 pm PST" (kind.runLabel) split into its parts; null if it is not in that shape. */
function runParts(label) {
  const p = /^(.*) run (\S+) (\d+) (\S+), (.+) (\S+)$/.exec(label);
  return p && { model: p[1], weekday: p[2], time: p[5] };
}

/**
 * What the chip says, as three parts (lead, mid, tail), the state, the longer text for the popover, and `variants`: the same line from
 * widest to narrowest, each a whole-segment shortening of the one before (fitText picks the first that fits; the tail is always kept).
 * The state is kind.staleness() for live data, 'recorded' for kind.isRecorded() and 'multi-case' for a sample with cases.
 * live fresh: "ECMWF · Wed 4 pm run · 9 h old" (model, weekday, time from kind.runLabel); stale: "... · 30 h old, stale";
 * recorded: kind.sampleLabel(m, {short: true}), "Recorded · 19 Nov · not live" (the run's UTC date);
 * sample with cases: "Sample · 1 Jan 2017 · not a forecast" (the case label when the case has no start date, else no middle part).
 * `zone` (an IANA name) is passed to runLabel; by default the viewer's zone.
 */
export function chipModel(manifest, { now = Date.now(), caseId = 'A', zone } = {}) {
  if (!manifest) return null;
  if (!isLive(manifest) && isMultiCase(manifest)) {
    const start = caseStartLabel(manifest, caseId);
    const mid = start || manifest.cases?.[caseId]?.label || '';
    const note = `Past weather standing in for a forecast.${start ? ` It starts ${start}.` : ''}`;
    return { state: 'multi-case', stale: false, lead: 'Sample', mid, tail: 'not a forecast', variants: ladder('Sample', mid, 'not a forecast'), detail: sampleBadgeText(manifest, caseId), note };
  }
  if (isRecorded(manifest)) {
    const [lead, ...rest] = sampleLabel(manifest, { short: true }).split(SEP);
    const tail = rest.pop() || '', mid = rest.join(SEP);
    return { state: 'recorded', stale: false, lead, mid, tail, variants: ladder(lead, mid, tail), detail: sampleLabel(manifest), note: 'A recorded forecast run, kept so the page works without a live feed. It is not today\'s forecast.' };
  }
  const label = runLabel(manifest, zone ? { zone } : {});
  if (!(runMs(manifest) === runMs(manifest))) {
    const lead = label.replace(/ run$/, '') || 'Forecast';
    return { state: 'fresh', stale: false, lead, mid: 'run time unknown', tail: '', variants: [`${lead} · run time unknown`, lead], detail: lead, note: '' };
  }
  const st = staleness(manifest, now);
  const age = Math.max(0, Math.floor(ageHours(manifest, now))); // whole hours shown; the state is decided on the exact age
  const tail = st === 'fresh' ? `${age} h old` : st === 'stale' ? `${age} h old, stale` : `${age} h old, very stale`;
  // runLabel is always "<model> run <Wkd> <d> <Mon>, <time> <zone>"; should its shape ever change, the chip shows it whole
  const parts = runParts(label) || { model: label, weekday: '', time: '' };
  const at = [parts.weekday, parts.time].filter(Boolean).join(' '), mid = at ? `${at} run` : '';
  return {
    state: st, stale: st !== 'fresh', lead: parts.model, mid, tail, variants: ladder(parts.model, mid, tail, at || undefined),
    detail: label,
    note: st === 'fresh' ? 'The latest forecast run this site has built.' : 'This run is older than expected; a newer one has not been built yet.',
  };
}

const join = (m) => m.variants[0];

/** Writes `model` into `el` on one line: the widest variant that fits. Segments and words are dropped, never cut, so the age,
 *  the stale warning and 'not a forecast' / 'not live' always stay whole. If even the narrowest does not fit it is still shown whole
 *  (the CSS clips it); the S-SHELL check proves that does not happen at 320 px. */
export function fitText(el, model) {
  const vs = model.variants;
  el.textContent = vs[0];
  if (!el.clientWidth) return vs[0];
  for (const v of vs) {
    el.textContent = v;
    if (el.scrollWidth <= el.clientWidth) return v;
  }
  return el.textContent;
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme] || THEME_COLOR.dark);
}

const GROUPS = [
  { id: 'theme', label: 'Theme', key: 'themePref', opts: [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], note: 'Auto follows your device.' },
  { id: 'chart', label: 'Chart', key: 'ground', opts: [['paper', 'Paper'], ['night', 'Night']], note: 'The ground the map is drawn on.' },
  { id: 'colors', label: 'Map colors', key: 'colors', opts: [['soft', 'Soft'], ['reference', 'Reference (ECMWF)']], note: 'Soft is easier on the eye. Reference is ECMWF’s own chart colours.' },
  { id: 'units', label: 'Units', key: 'units', opts: [['metric', 'Metric'], ['us', 'US']], note: 'Metric: mm and °C. US: in and °F.' },
  { id: 'time', label: 'Time', key: null, opts: [['local', 'Local']], note: null },
];

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (v == null || v === false) continue; if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : String(v)); }
  e.append(...kids.filter(Boolean));
  return e;
}

export function mountHeader({ store, bus }) {
  const top = document.getElementById('topbar');
  const chip = document.getElementById('data-chip');
  const chipText = chip.querySelector('.chip-text');
  const popover = document.getElementById('data-popover');
  const menu = document.getElementById('display-menu');
  const btnDisplay = document.getElementById('btn-display');
  const btnMore = document.getElementById('btn-more');
  let manifest = null;
  let nowFn = null;
  const now = () => (nowFn ? nowFn() : Date.now());

  // ---------- Display preferences ----------
  const themePref = prefs.themePref();
  store.set({ themePref, ground: prefs.ground(), colors: prefs.colors(), units: prefs.units(), theme: resolveTheme(themePref) });
  applyTheme(store.get().theme);
  const setPref = (key, value) => {
    prefs.set(key, value);
    if (key === 'themePref') store.set({ themePref: value, theme: resolveTheme(value) }); else store.set({ [key]: value });
    paintMenu();
  };
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (store.get().themePref === 'auto') store.set({ theme: resolveTheme('auto', systemTheme()) });
    });
  } catch { /* no matchMedia: the theme stays as set */ }

  // ---------- the chip ----------
  let model = null;
  function paint() {
    model = chipModel(manifest, { now: now(), caseId: caseForLens(manifest, store.get().lens) ?? undefined });
    if (!model) { chipText.textContent = ''; chip.dataset.full = ''; chip.hidden = true; return; }
    chip.hidden = false;
    chip.classList.toggle('stale', model.stale);
    chip.dataset.state = model.state;
    const full = join(model);
    chip.dataset.tail = model.tail;
    chip.dataset.full = full;
    chip.setAttribute('aria-label', `${full}. About this data`);
    fitText(chipText, model);
    if (!popover.hidden) paintPopover();
  }
  function paintPopover() {
    clear(popover);
    if (!model) return;
    popover.append(el('h2', { text: 'About this data' }), el('p', { class: 'full', text: model.detail }));
    if (model.note) popover.append(el('p', { text: model.note }));
    popover.append(el('p', { text: `Times are in your time zone${zoneName() ? ' (' + zoneName() + ')' : ''}.` }));
  }
  let lastW = 0;
  const ro = new ResizeObserver(() => { const w = top.clientWidth; if (model && (w !== lastW || chipText.scrollWidth > chipText.clientWidth)) { lastW = w; fitText(chipText, model); } });
  ro.observe(top); ro.observe(chip);

  // ---------- menus: one open at a time; Escape and an outside press close; focus returns to the opener ----------
  let openBy = null;
  const triggers = () => [btnDisplay, btnMore];
  function visibleTrigger() { return triggers().find((b) => b.getClientRects().length) || btnDisplay; }
  function closeAll(returnFocus = false) {
    const was = openBy;
    menu.hidden = true; popover.hidden = true; openBy = null;
    for (const b of [...triggers(), chip]) b.setAttribute('aria-expanded', 'false');
    if (returnFocus && was) was.focus();
  }
  function toggleMenu(btn) {
    const wasOpen = !menu.hidden;
    closeAll();
    if (wasOpen) return;
    paintMenu(); menu.hidden = false; openBy = btn; btn.setAttribute('aria-expanded', 'true');
  }
  chip.addEventListener('click', () => {
    const wasOpen = !popover.hidden;
    closeAll();
    if (wasOpen) return;
    paintPopover(); popover.hidden = false; openBy = chip; chip.setAttribute('aria-expanded', 'true');
    bus.emit('about-data:open', { state: model?.state });
  });
  btnDisplay.addEventListener('click', () => toggleMenu(btnDisplay));
  btnMore.addEventListener('click', () => toggleMenu(btnMore));
  document.addEventListener('pointerdown', (e) => {
    if (menu.hidden && popover.hidden) return;
    if (e.target.closest?.('#display-menu, #data-popover, #btn-display, #btn-more, #data-chip')) return;
    closeAll();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (!menu.hidden || !popover.hidden) && !document.querySelector('.wse-sheet-root')) { closeAll(true); e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ---------- menu content ----------
  function buildMenu() {
    clear(menu);
    menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', 'Display');
    const share = el('div', { class: 'menu-share' }, el('button', { type: 'button', class: 'menu-item', 'data-share': 'still', text: 'Share this view' }), el('hr', { class: 'menu-sep' }));
    share.querySelector('button').addEventListener('click', () => closeAll());
    menu.append(share);
    for (const g of GROUPS) {
      const row = el('div', { class: 'menu-opts', role: 'radiogroup', 'aria-label': g.label });
      for (const [value, label] of g.opts) {
        const b = el('button', { type: 'button', class: 'menu-opt', role: 'radio', 'data-value': value, text: value === 'local' ? `Local${zoneName() ? ' (' + zoneName() + ')' : ''}` : label });
        b.addEventListener('click', () => { if (g.key) setPref(g.key, value); });
        row.append(b);
      }
      menu.append(el('div', { class: 'menu-group', 'data-group': g.id }, el('p', { class: 'menu-label', text: g.label }), row, g.note ? el('p', { class: 'menu-note', text: g.note }) : null));
    }
    menu.querySelector('[data-group="time"] .menu-note')?.remove();
    menu.querySelector('[data-group="time"]').append(el('p', { class: 'menu-note', text: 'Every time on the page is shown in your own time zone.' }));
  }
  function paintMenu() {
    const s = store.get();
    for (const g of GROUPS) {
      for (const b of menu.querySelectorAll(`[data-group="${g.id}"] .menu-opt`)) {
        const on = g.key ? s[g.key] === b.dataset.value : true;
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
    }
  }
  buildMenu(); paintMenu();

  store.subscribe((s, p) => { if ('theme' in p) applyTheme(s.theme); if ('lens' in p) paint(); });
  paint();
  return {
    setManifest(m) { manifest = m; paint(); },
    setNow(fn) { nowFn = fn; paint(); },
    paint, closeAll, visibleTrigger,
  };
}
