// The day table: a place's forecast as one column per local day (DESIGN-SPEC 3.3, the card's day row). Each column reads top
// to bottom: the day ("Today 24 Nov", "Sat 28 Nov"), an icon for the day's class, the high (large) over the low, the rain
// (an amount for days 1-3, the chance of a wet day from day 4 with pr1; blank when the run has no rain field), and how sure
// the timing is (a three-step meter from the day's own confidence). Later days look less certain the way the zones table says
// (confidence.js zones(), DESIGN-SPEC 7.2): a dashed edge and "broad pattern" over the blend days, a hatch and "pattern only"
// over the mean (or single-run) days. The passed part of today is a grey bar at the top of its column ("earlier today").
// Columns are buttons (.strip-day) with data-day and data-t (the forecast hour to scrub to); the day line is their name.
//
// cellsFor is pure (no DOM): it turns day classes into what each column shows, so it is unit-tested in node. dayTable builds
// the DOM from it. Every word and number comes from the story layer (phrases.js, confidence.js, localday.js).
import { zones, zoneAt, zoneNote, CONFIDENCE_WORDS } from './confidence.js';
import { degrees, hasStoryData } from './phrases.js';
import { addDays, dateLabel, weekdayShort } from './localday.js';

const finite = Number.isFinite;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMonth = (date) => { const d = new Date(date + 'T12:00:00Z'); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

/** The narrowest column the table uses, in px: "10 mm" with its drop, "−10°" at 20 px and a weekday head fit with air. */
export const MIN_COL = 56;
/**
 * How much of the next column shows at the right edge of a table that scrolls: the cue that there are more days. A table that
 * scrolls ends in an empty PEEK px track, so its last scroll position also rests on a column edge (the last days whole).
 */
export const PEEK = 24;

/**
 * Column width and how many whole columns show at once for a table `width` px wide holding `n` days: every day when they
 * fit at MIN_COL or wider (the columns then share the width); else as many whole columns as fit beside a PEEK px slice of
 * the next one, and the rest scroll sideways.
 */
export function columnsFor(width, n) {
  if (!(n > 0)) return { col: width, visible: 0, scroll: false };
  if (n * MIN_COL <= width) return { col: width / n, visible: n, scroll: false };
  const fit = Math.max(1, Math.floor((width - PEEK) / MIN_COL));
  return { col: (width - PEEK) / fit, visible: fit, scroll: true };
}

/** Icon names the table draws, with their words (the icon's tooltip). Only classes the story layer computes. */
export const ICON_WORDS = Object.freeze({
  dry: 'Dry', light: 'Light rain', rain: 'Rain', heavy: 'Heavy rain', signal: 'A rain signal',
  warm: 'Warmer air', cold: 'Cooler air',
  ridge: 'Ridge aloft', trough: 'Trough aloft', normal: 'Near-normal pattern', unsure: 'No clear signal',
});

const RAIN_ICON = { dry: 'dry', light: 'light', moderate: 'rain', heavy: 'heavy' };
/**
 * The rain icon for a day, no surer than the day's rain words (phrases.js wetPhraseFor, wetFromProbability). From pr1 the
 * class stands as the story names it ("heavy rain possible", "mostly dry"). From tp6 alone: days 1-3 as measured; days 4-7
 * a lean, so never heavier than "rain" ("rain likely"); days 8-10 only a signal, so no sun and no rain class: a wet day gets
 * the faint "rain signal" mark and a dry one none (the air mass or the pattern speaks for it). Else null.
 */
export function rainIconFor(c) {
  const k = RAIN_ICON[c.wet];
  if (!k) return null;
  if (c.wetSource === 'tp6' && c.lead > 7) return k === 'dry' ? null : 'signal';
  if (c.wetSource === 'tp6' && c.lead > 3 && k === 'heavy') return 'rain';
  return k;
}

/**
 * The icon for a day class: the rain icon when the run has rain for the day (rainIconFor); else the air mass when it is
 * clearly warmer or cooler; else the pattern aloft (ridge, trough, near normal, no clear signal); else none.
 * There is no snow or wind class: the run has no precipitation type, and the storm-track flag is the jet 10 km up, not wind
 * at the ground.
 */
export function iconFor(c) {
  const r = rainIconFor(c);
  if (r) return r;
  if (c.airMass === 'much-warmer' || c.airMass === 'warmer') return 'warm';
  if (c.airMass === 'much-cooler' || c.airMass === 'cooler') return 'cold';
  if (c.signal === 'none' || c.pattern === 'no-signal') return 'unsure';
  if (c.pattern === 'ridge' || c.pattern === 'ridge-building') return 'ridge';
  if (c.pattern === 'trough' || c.pattern === 'trough-arriving') return 'trough';
  if (c.pattern === 'near-normal') return 'normal';
  return null;
}

/** The icon's words: a rain icon says the day's own rain phrase ("Rain likely", "Mostly dry"); the rest their ICON_WORDS. */
export function iconWordFor(c, icon = iconFor(c)) {
  if (!icon) return '';
  if (RAIN_ICON[c.wet] && icon === rainIconFor(c) && c.wetPhrase) return c.wetPhrase.charAt(0).toUpperCase() + c.wetPhrase.slice(1);
  return ICON_WORDS[icon];
}

/** "4 mm", "<1 mm", "0 mm"; "0.16 in" in US units. */
export function amount(mm, units = 'metric') {
  if (!finite(mm)) return '';
  if (units === 'us') { const v = mm / 25.4; return v < 0.005 ? '0 in' : `${v.toFixed(2)} in`; }
  if (mm < 0.05) return '0 mm';
  if (mm < 1) return '<1 mm';
  return `${Math.round(mm)} mm`;
}

/**
 * What the rain line says: on days 1-3 the tp6 amount summed over the local day; from day 4 with pr1 the chance of a wet
 * day (1 mm or more in the 24 h window), never an amount (the run holds none that far out); otherwise nothing. Nothing,
 * not 0, when the run has no rain field.
 */
export function rainFor(c, units = 'metric') {
  if (c.wetSource === 'pr' && finite(c.pr1)) {
    const p = Math.round(clamp(c.pr1, 0, 100));
    const extra = finite(c.pr10) ? `, ${Math.round(c.pr10)}% of 10 mm or more` : '';
    return { text: `${p}%`, kind: 'chance', title: `${p}% chance of a wet day (1 mm or more)${extra}` };
  }
  if (c.wetSource === 'tp6' && c.lead <= 3 && finite(c.rainMm)) {
    const t = amount(c.rainMm, units);
    return { text: t, kind: 'amount', title: `${t} of rain in the latest forecast` };
  }
  return { text: '', kind: 'none', title: '' };
}

/** Meter steps for a confidence level (3 high, 2 medium, 1 low); 0 for pattern only and none. A day whose forecasts disagree is at most low. */
export function sureSteps(c) {
  if (c.signal === 'none' || c.pattern === 'no-signal') return c.confidence === 'none' || c.confidence === 'pattern-only' ? 0 : 1;
  return { high: 3, medium: 2, low: 1 }[c.confidence] || 0;
}

/**
 * What every column shows, from the day classes of buildDays (with .series and .coverage). Pure.
 * @param {object[]} days
 * @param {{units?:'metric'|'us', sample?:boolean, hasMean?:boolean}} opts sample: a sample's spread is not a forecast's, so
 *   no column claims a confidence (as the day line drops its "Pattern: ..." there)
 * @returns {{cells:object[], bands:{from:number,to:number,texture:string,note:string}[]}}
 */
export function cellsFor(days, series = days?.series, opts = {}) {
  const n = days?.length || 0;
  const wins = series?.windows || [];
  const cov = days?.coverage || {};
  const units = opts.units === 'us' ? 'us' : 'metric';
  const hasMean = typeof opts.hasMean === 'boolean' ? opts.hasMean : typeof series?.hasMean === 'boolean' ? series.hasMean : !!series?.z500em;
  const zst = series?.z500a?.steps;
  const maxStep = zst?.length ? zst[zst.length - 1] : wins.length ? wins[wins.length - 1].endH : 360;
  const lastZone = zones(maxStep, { hasMean }).at(-1);
  const cells = [];
  for (let i = 0; i < n; i++) {
    const c = days[i], w = wins[i] || { startH: 0, endH: 24, date: c.date };
    // the zone of the latest hour the day reaches: a day that straddles 168 h already reads as the later zone (as the strip)
    const zone = zoneAt(clamp(Math.min(w.endH, maxStep) - 1e-6, 0, maxStep), maxStep, { hasMean }) || lastZone;
    const tomorrow = cov.todayDate && c.date === addDays(cov.todayDate, 1);
    const name = c.today ? 'Today' : tomorrow ? 'Tomorrow' : weekdayShort(c.date);
    const first = zst?.[0] ?? w.startH, last = zst?.[zst.length - 1] ?? w.endH;
    const lo = Math.max(w.startH, first), hi = Math.min(w.endH, last);
    const t = hi > lo ? (lo + hi) / 2 : Math.min(last, Math.max(first, w.startH));
    const steps = opts.sample ? 0 : sureSteps(c);
    const icon = iconFor(c);
    const temps = c.lead <= 7 && finite(c.hi) && finite(c.lo);
    cells.push({
      i, date: c.date, name, dateText: dayMonth(c.date), fullDate: dateLabel(c.date),
      icon, iconWord: iconWordFor(c, icon),
      hi: temps ? degrees(c.hi, units) : '', lo: temps ? degrees(c.lo, units) : '',
      rain: rainFor(c, units),
      level: opts.sample ? 'none' : c.confidence || 'none', steps,
      sureWords: opts.sample ? '' : c.confidence === 'pattern-only' ? 'pattern only' : CONFIDENCE_WORDS[c.confidence] || '',
      texture: zone?.texture || 'solid', zoneNote: zoneNote(zone),
      noData: !hasStoryData(c),
      passed: c.today && finite(c.passedH) ? clamp((c.passedH - w.startH) / (w.endH - w.startH), 0, 1) : 0,
      t: +t.toFixed(1),
    });
  }
  // the zone bands over the later columns: one per run of columns with the same note ("broad pattern", "pattern only")
  const bands = [];
  cells.forEach((x, i) => {
    if (!x.zoneNote) return;
    const b = bands.at(-1);
    if (b && b.note === x.zoneNote && b.to === i) b.to = i + 1; else bands.push({ from: i, to: i + 1, texture: x.texture, note: x.zoneNote });
  });
  return { cells, bands };
}

// ---------- icons: simple line drawings in the text colour (never a field palette colour) ----------

const CLOUD = 'M9 21h14.5a5 5 0 0 0 .6-9.96A7 7 0 0 0 10.5 12.5 4.3 4.3 0 0 0 9 21z';
const drops = (xs, len) => xs.map((x) => `<path d="M${x} 24.5l-1.2 ${len}"/>`).join('');
const ICON_SVG = {
  dry: '<circle cx="16" cy="16" r="5.2"/><path d="M16 5.5v2.6M16 23.9v2.6M5.5 16h2.6M23.9 16h2.6M8.6 8.6l1.8 1.8M21.6 21.6l1.8 1.8M8.6 23.4l1.8-1.8M21.6 10.4l1.8-1.8"/>',
  light: `<path d="${CLOUD}"/>${drops([14.5, 19.5], 3)}`,
  rain: `<path d="${CLOUD}"/>${drops([12, 16.5, 21], 4)}`,
  heavy: `<path d="${CLOUD}" class="dt-fill"/>${drops([10.5, 14.5, 18.5, 22.5], 5.5)}`,
  signal: `<path d="${CLOUD}" class="dt-thin" stroke-dasharray="2 2.5"/><path d="M16 24.5l-1.2 4" class="dt-thin"/>`,
  warm: '<path d="M14 7.5a2 2 0 0 1 4 0v11a4.2 4.2 0 1 1-4 0z"/><path d="M16 12.5v8"/><path d="M23 11l2.5-3 2.5 3M25.5 8v8"/>',
  cold: '<path d="M14 7.5a2 2 0 0 1 4 0v11a4.2 4.2 0 1 1-4 0z"/><path d="M16 17v3.5"/><path d="M23 13l2.5 3 2.5-3M25.5 16V8"/>',
  ridge: '<path d="M5 22c4 0 6-11 11-11s7 11 11 11"/><path d="M4 25h24" class="dt-thin"/>',
  trough: '<path d="M5 10c4 0 6 11 11 11s7-11 11-11"/><path d="M4 7h24" class="dt-thin"/>',
  normal: '<path d="M5 17c3.5-2 7.5-2 11 0s7.5 2 11 0"/>',
  unsure: '<path d="M5 25c3.5-2 7.5-2 11 0s7.5 2 11 0" class="dt-thin" stroke-dasharray="2 3"/><path d="M13 9a3 3 0 1 1 4.3 2.7c-.9.5-1.3 1.1-1.3 2.1v.7"/><circle cx="16" cy="18.6" r=".5"/>',
};
/** The icon's SVG markup (32 x 32, stroked in currentColor), or '' for none. Decorative: the column's name carries the words. */
export function iconSVG(name) {
  const body = ICON_SVG[name];
  return body ? `<svg class="dt-icon dt-icon-${name}" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">${body}</svg>` : '';
}
const DROP = '<svg class="dt-drop" viewBox="0 0 10 12" width="8" height="10" aria-hidden="true" focusable="false"><path d="M5 1.2C3.6 3.6 2 5.4 2 7.4a3 3 0 0 0 6 0c0-2-1.6-3.8-3-6.2z"/></svg>';

// ---------- the DOM ----------

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * The day table for a place. Returns a div.daytable (role group) whose grid holds the zone bands (when any) over one
 * button.strip-day per day. Over a table with bands, the days before the first band carry a plain rule (.dt-lead), so the
 * band row reads as one ruler (solid, dashed, hatched, as the timeline) wherever the table is scrolled. Columns are `columnsFor(width, n).col` px wide; the caller puts the table in a sideways scroller.
 * @param {object[]} days day classes from buildDays
 * @param {{width?:number, activeDay?:number, label?:(c:object)=>string, units?:'metric'|'us', sample?:boolean, hasMean?:boolean}} opts
 */
export function dayTable(days, series = days?.series, opts = {}) {
  const { cells, bands } = cellsFor(days, series, opts);
  const n = cells.length;
  const width = opts.width || 336;
  const { col, scroll } = columnsFor(width, n);
  const root = h('div', 'daytable');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Forecast for the coming days');
  root.dataset.cols = String(n);
  if (scroll) root.classList.add('dt-scrolls');
  root.style.gridTemplateColumns = `repeat(${n}, ${Math.round(col * 100) / 100}px)${scroll ? ` ${PEEK}px` : ''}`;
  if (bands.length) {
    root.classList.add('dt-has-bands');
    if (bands[0].from > 0) {
      const lead = h('div', 'dt-lead');
      lead.setAttribute('aria-hidden', 'true');
      lead.style.gridColumn = `1 / ${bands[0].from + 1}`;
      root.append(lead);
    }
    for (const b of bands) {
      const z = h('div', `dt-band dt-band-${b.texture}`);
      z.style.gridColumn = `${b.from + 1} / ${b.to + 1}`;
      z.append(h('span', 'dt-band-text', b.note));
      root.append(z);
    }
  }
  for (const x of cells) {
    const c = days[x.i];
    const b = h('button', `strip-day dt-day dt-${x.texture}`);
    b.type = 'button';
    b.style.gridColumn = String(x.i + 1);
    b.dataset.day = String(x.i);
    b.dataset.t = x.t.toFixed(1);
    b.dataset.level = x.level;
    if (x.noData) b.classList.add('hatch-nodata');
    const name = opts.label ? opts.label(c) : `${x.fullDate}`;
    b.setAttribute('aria-label', name);
    b.title = name;
    if (x.i === opts.activeDay) { b.classList.add('is-active'); b.setAttribute('aria-current', 'date'); }
    if (x.passed > 0) {
      const p = h('span', 'dt-passed');
      p.title = 'earlier today';
      p.append(h('i'));
      p.firstChild.style.width = `${Math.round(x.passed * 1000) / 10}%`;
      b.append(p);
    }
    const head = h('span', 'strip-label dt-head');
    const nm = h('span', 'dt-name', x.name);
    if (x.name === 'Tomorrow') nm.dataset.short = weekdayShort(x.date);
    head.append(nm, document.createTextNode(' '), h('span', 'dt-date', x.dateText));
    b.append(head);
    const ic = h('span', 'dt-iconbox');
    ic.innerHTML = iconSVG(x.icon);
    if (x.iconWord) { ic.dataset.icon = x.icon; ic.title = x.iconWord; }
    b.append(ic);
    const temps = h('span', 'dt-temps');
    if (x.hi) temps.append(h('span', 'dt-hi', x.hi), h('span', 'dt-lo', x.lo));
    else if (['ridge', 'trough', 'normal', 'unsure'].includes(x.icon)) temps.append(h('span', 'dt-aloft', { ridge: 'ridge', trough: 'trough', normal: 'normal', unsure: 'unsure' }[x.icon]));
    b.append(temps);
    const rain = h('span', `dt-rain dt-rain-${x.rain.kind}`);
    if (x.rain.text) { rain.innerHTML = DROP; rain.append(document.createTextNode(x.rain.text)); rain.title = x.rain.title; }
    b.append(rain);
    const sure = h('span', 'dt-sure');
    sure.dataset.steps = String(x.steps);
    if (x.sureWords) sure.title = `Timing: ${x.sureWords}`;
    if (x.level !== 'none' && x.level !== 'pattern-only') for (let k = 1; k <= 3; k++) sure.append(h('i', k <= x.steps ? 'on' : ''));
    b.append(sure);
    root.append(b);
  }
  // rows no column fills are left out (a run without rain, a sample that claims no confidence)
  if (!cells.some((x) => x.rain.text)) root.classList.add('dt-no-rain');
  if (!cells.some((x) => x.level !== 'none' && x.level !== 'pattern-only')) root.classList.add('dt-no-sure');
  if (!cells.some((x) => x.hi || ['ridge', 'trough', 'normal', 'unsure'].includes(x.icon))) root.classList.add('dt-no-temps');
  return root;
}

/**
 * A zone band's words stay put at the left edge of the visible table as it scrolls (sticky); where less of the band shows
 * than its words need, the words are hidden (.dt-band-tight) rather than cut, and the band's rule alone marks the zone.
 * Call once the table is in its scroller, and again on every scroll. Returns how many it hid.
 */
export function fitBands(table) {
  const wrap = table?.parentElement;
  if (!wrap?.getBoundingClientRect) return 0;
  const W = wrap.getBoundingClientRect();
  let k = 0;
  for (const band of table.querySelectorAll?.('.dt-band') || []) {
    const text = band.querySelector('.dt-band-text');
    if (!text) continue;
    const b = band.getBoundingClientRect();
    const shown = Math.min(b.right, W.right) - Math.max(b.left, W.left);
    const tight = shown < text.scrollWidth;
    band.classList.toggle('dt-band-tight', tight);
    if (tight) k++;
  }
  return k;
}

/** The clear space kept on each side of a day's name inside its column, in px. */
export const NAME_PAD = 2;
/**
 * Once the table is in the page: "Tomorrow" gives way to its weekday ("Wed") where the measured word does not fit its
 * column with NAME_PAD each side (the convention of the strip: Tomorrow, else the weekday). Returns how many it shortened.
 */
export function fitNames(table) {
  let k = 0;
  for (const nm of table?.querySelectorAll?.('.dt-name[data-short]') || []) {
    const col = nm.closest('.dt-day')?.clientWidth || 0;
    if (col > 0 && nm.getBoundingClientRect().width > col - 2 * NAME_PAD) { nm.textContent = nm.dataset.short; k++; }
  }
  return k;
}
