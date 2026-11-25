// story/daytable.js: the cards' day table. cellsFor is pure (what each column shows); dayTable builds the DOM, checked here
// against a minimal fake document (the rendered table is measured in the browser by S-HOME and S-STORY).
import test from 'node:test';
import assert from 'node:assert/strict';

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.style = {}; this.className = ''; this._text = ''; this.title = ''; }
  get classList() { const self = this; return { add: (...c) => { self.className = [...new Set([...self.className.split(/\s+/).filter(Boolean), ...c])].join(' '); }, contains: (c) => self.className.split(/\s+/).includes(c) }; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  append(...c) { for (const x of c) { x.parent = this; this.children.push(x); } }
  get firstChild() { return this.children[0]; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(v) { this._html = v; }
  get innerHTML() { return this._html || ''; }
  all(cls) { const out = []; const walk = (e) => { for (const c of e.children) { if (c.className && c.className.split(/\s+/).includes(cls)) out.push(c); walk(c); } }; walk(this); return out; }
}
class Text { constructor(t) { this.textContent = t; this.children = []; this.className = ''; } }
globalThis.document = { createElement: (t) => new Node(t), createTextNode: (t) => new Text(t) };

const site = new URL('../../../site/js/', import.meta.url);
const T = await import(new URL('story/daytable.js', site).href);
const S = await import(new URL('story/index.js', site).href);
const P2 = await import(new URL('story/phrases.js', site).href);

const N = 15;
const DATES = Array.from({ length: N }, (_, i) => new Date(Date.UTC(2026, 10, 24 + i)).toISOString().slice(0, 10));
const windows = DATES.map((date, i) => ({ date, startH: 24 * i, endH: 24 * i + 24 }));
const steps = (to, by = 6) => { const a = []; for (let h = 0; h <= to; h += by) a.push(h); return a; };
const field = (n, fn) => ({ steps: steps(24 * n), values: Float32Array.from(steps(24 * n), fn) });
/** Day classes for n days with the fields asked for; `cov` becomes their coverage (today, tomorrow). */
function mk(n, { rain = true, temp = true, pr = false, spread = 2, mean = true, cov = {} } = {}) {
  const s = { windows: windows.slice(0, n), hasMean: mean, z500a: field(n, (h) => 120 * Math.sin(h / 40)), z500sd: field(n, () => spread * 10) };
  if (rain) s.tp6 = field(n, (h) => (h < 48 ? 2 : 0.1));
  if (temp) s.t2m = field(n, (h) => 283 + 4 * Math.sin((h / 24) * 2 * Math.PI));
  if (pr) { s.pr1 = field(n, (h) => (h > 72 ? 65 : 10)); s.pr10 = field(n, () => 12); }
  const d = s.windows.map((_, i) => S.classifyDay(s, i, i + 1));
  Object.defineProperty(d, 'series', { value: s });
  Object.defineProperty(d, 'coverage', { value: cov });
  return d;
}

test('columnsFor: every day shares the width when they fit, else whole columns beside a peek of the next', () => {
  assert.deepEqual(T.columnsFor(490, 7), { col: 70, visible: 7, scroll: false });
  const p = T.columnsFor(358, 7); // a 390 px phone
  assert.equal(p.scroll, true); assert.equal(p.visible, 5);
  assert.ok(p.col >= T.MIN_COL && Math.abs(p.col * 5 + T.PEEK - 358) < 1e-9, JSON.stringify(p));
  const d = T.columnsFor(313, 15); // the desktop panel at range 15
  assert.ok(d.scroll && d.visible === 5 && d.col >= T.MIN_COL, JSON.stringify(d));
  assert.deepEqual(T.columnsFor(313, 3), { col: 313 / 3, visible: 3, scroll: false });
  // with the end track, the last scroll position is a whole number of columns: the last days rest whole
  for (const [w, n] of [[358, 7], [358, 15], [419, 15], [313, 10]]) {
    const c = T.columnsFor(w, n), max = n * c.col + T.PEEK - w;
    assert.ok(Math.abs(max / c.col - Math.round(max / c.col)) < 1e-9, `${w} px, ${n} days: the end rests on a column edge (${max})`);
  }
});

test('cellsFor: names, dates, Today and Tomorrow only on live days, the passed part of today', () => {
  const days = mk(7, { cov: { todayDate: DATES[0] } });
  days[0].today = true; days[0].passedH = 6;
  const { cells } = T.cellsFor(days);
  assert.deepEqual(cells.map((c) => c.name), ['Today', 'Tomorrow', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon']);
  assert.deepEqual(cells.slice(0, 3).map((c) => c.dateText), ['24 Nov', '25 Nov', '26 Nov']);
  assert.equal(cells[0].passed, 0.25);
  assert.ok(cells.slice(1).every((c) => c.passed === 0));
  const rec = T.cellsFor(mk(3)).cells; // a recording: no today, every day named by its weekday and dated
  assert.deepEqual(rec.map((c) => `${c.name} ${c.dateText}`), ['Tue 24 Nov', 'Wed 25 Nov', 'Thu 26 Nov']);
});

test('cellsFor: high and low in the viewer units through day 7, blank after', () => {
  const days = mk(10);
  const m = T.cellsFor(days).cells, us = T.cellsFor(days, days.series, { units: 'us' }).cells;
  assert.match(m[0].hi, /^−?\d+°$/); assert.match(m[0].lo, /^−?\d+°$/);
  assert.equal(m[0].hi, `${Math.round(days[0].hi)}°`);
  assert.equal(us[0].hi, `${Math.round(days[0].hi * 9 / 5 + 32)}°`);
  assert.ok(m.slice(7).every((c) => c.hi === '' && c.lo === ''), 'no high or low past day 7');
});

test('rainFor: an amount for days 1-3, a chance from day 4 with pr1, blank (never 0) without a rain field', () => {
  const wet = mk(7, { pr: true });
  const c = T.cellsFor(wet).cells;
  assert.equal(c[0].rain.text, `${Math.round(wet[0].rainMm)} mm`);
  assert.equal(T.cellsFor(wet, wet.series, { units: 'us' }).cells[0].rain.text, `${(wet[0].rainMm / 25.4).toFixed(2)} in`);
  assert.equal(c[2].rain.text, '<1 mm');
  assert.equal(c[4].rain.text, `${Math.round(wet[4].pr1)}%`);
  assert.match(c[4].rain.title, /chance of a wet day/);
  // tp6 alone past day 3 is a lean, not a measured amount: no number is shown
  const lean = T.cellsFor(mk(7)).cells;
  assert.ok(lean.slice(3).every((x) => x.rain.text === ''), JSON.stringify(lean.map((x) => x.rain.text)));
  const dry = T.cellsFor(mk(7, { rain: false })).cells;
  assert.ok(dry.every((x) => x.rain.text === '' && x.rain.kind === 'none'), 'a run with no rain field shows no rain at all');
  assert.equal(T.amount(0), '0 mm'); assert.equal(T.amount(0.4), '<1 mm'); assert.equal(T.amount(12.6), '13 mm'); assert.equal(T.amount(NaN), '');
  assert.equal(T.amount(0.0149, 'us'), '0 in'); assert.equal(T.amount(2.53, 'us'), '0.10 in'); assert.equal(T.amount(9.98, 'us'), '0.39 in');
});

test('iconFor: only the classes the story computes', () => {
  const base = { wet: 'none', airMass: 'none', pattern: 'none', signal: 'clear' };
  assert.equal(T.iconFor({ ...base, wet: 'heavy' }), 'heavy');
  assert.equal(T.iconFor({ ...base, wet: 'moderate' }), 'rain');
  assert.equal(T.iconFor({ ...base, wet: 'light' }), 'light');
  assert.equal(T.iconFor({ ...base, wet: 'dry', airMass: 'much-cooler' }), 'dry');
  assert.equal(T.iconFor({ ...base, airMass: 'warmer' }), 'warm');
  assert.equal(T.iconFor({ ...base, airMass: 'much-cooler' }), 'cold');
  assert.equal(T.iconFor({ ...base, pattern: 'ridge-building' }), 'ridge');
  assert.equal(T.iconFor({ ...base, pattern: 'trough-arriving' }), 'trough');
  assert.equal(T.iconFor({ ...base, pattern: 'near-normal' }), 'normal');
  assert.equal(T.iconFor({ ...base, pattern: 'no-signal', signal: 'none' }), 'unsure');
  assert.equal(T.iconFor(base), null);
  for (const k of Object.keys(T.ICON_WORDS)) assert.ok(T.iconSVG(k).startsWith('<svg') && T.iconSVG(k).includes('aria-hidden="true"'), k);
  assert.ok(!Object.keys(T.ICON_WORDS).some((k) => /snow|wind|sun/.test(k)), 'no class the data cannot support');
});

test('iconFor: no surer than the day\'s rain words by lead (tp6 days 4-7 a lean, days 8-10 a signal)', () => {
  const P = { wetSource: 'tp6', airMass: 'near-normal', signal: 'clear', pattern: 'ridge' };
  const at = (wet, lead, wetSource = 'tp6') => ({ ...P, wet, lead, wetSource });
  assert.equal(T.iconFor(at('heavy', 3)), 'heavy', 'day 3 as measured');
  assert.equal(T.iconFor(at('heavy', 7)), 'rain', 'day 7 heavy reads "rain likely": no heavy icon');
  assert.equal(T.iconFor(at('light', 5)), 'light');
  assert.equal(T.iconFor(at('dry', 7)), 'dry');
  for (const lead of [8, 9, 10]) {
    for (const wet of ['light', 'moderate', 'heavy']) assert.equal(T.iconFor(at(wet, lead)), 'signal', `day ${lead} ${wet}: a rain signal only`);
    assert.equal(T.iconFor(at('dry', lead)), 'ridge', `day ${lead} dry: no sun, the pattern speaks`);
    assert.equal(T.iconFor({ ...at('dry', lead), airMass: 'cooler' }), 'cold');
  }
  assert.equal(T.iconFor(at('heavy', 9, 'pr')), 'heavy', 'pr10 says "heavy rain possible"');
  // the words: the day's own rain phrase, from the story layer
  for (const [wet, lead] of [['heavy', 2], ['heavy', 7], ['light', 5], ['dry', 6], ['moderate', 9], ['dry', 9]]) {
    const c = { ...at(wet, lead), wetPhrase: P2.wetPhraseFor(wet, lead) };
    const icon = T.iconFor(c), word = T.iconWordFor(c, icon);
    if (['dry', 'light', 'rain', 'heavy', 'signal'].includes(icon)) assert.equal(word.toLowerCase(), c.wetPhrase, `${wet} day ${lead}: ${word}`);
  }
  assert.equal(T.iconWordFor({ ...at('heavy', 7), wetPhrase: 'rain likely' }), 'Rain likely');
  assert.equal(T.iconWordFor({ ...at('moderate', 9), wetPhrase: 'a rain signal' }), 'A rain signal');
  assert.equal(T.iconWordFor({ ...at('dry', 9), wetPhrase: 'no rain signal' }), 'Ridge aloft');
  // on real day classes over ten days of heavy tp6: nothing past day 3 draws heavy, nothing past day 7 a rain class or sun
  const s = { windows: windows.slice(0, 10), hasMean: true, z500a: field(10, () => 80), z500sd: field(10, () => 20), tp6: field(10, () => 30) };
  const days = s.windows.map((_, i) => S.classifyDay(s, i, i + 1));
  const { cells } = T.cellsFor(days, s);
  assert.deepEqual(cells.map((x) => x.icon), ['heavy', 'heavy', 'heavy', 'rain', 'rain', 'rain', 'rain', 'signal', 'signal', 'signal']);
  assert.deepEqual(cells.map((x) => x.iconWord.toLowerCase()), days.map((d) => d.wetPhrase));
});

test('confidence: the meter follows each day, later zones carry their texture, and a sample claims nothing', () => {
  const days = mk(15, { spread: 2 });
  const { cells, bands } = T.cellsFor(days);
  // spread 2 dam: high through day 7, at most medium for days 8-10, pattern only beyond day 10
  assert.ok(cells.slice(0, 7).every((c) => c.steps === 3), cells.map((c) => c.steps).join(''));
  assert.ok(cells.slice(7, 10).every((c) => c.steps === 2 && c.texture === 'dashed'), cells.map((c) => c.texture).join(','));
  assert.ok(cells.slice(10).every((c) => c.steps === 0 && c.level === 'pattern-only' && c.texture === 'hatch'));
  assert.ok(cells.every((c, i) => i === 0 || c.steps <= cells[i - 1].steps), 'a later day never looks surer than an earlier one here');
  assert.deepEqual(bands, [{ from: 7, to: 10, texture: 'dashed', note: 'broad pattern' }, { from: 10, to: 15, texture: 'hatch', note: 'pattern only' }]);
  // no ensemble mean: day 8 on is the single run, pattern only, hatched
  const late = T.cellsFor(mk(10, { mean: false })).bands;
  assert.deepEqual(late, [{ from: 7, to: 10, texture: 'hatch', note: 'pattern only' }]);
  // a wide spread: low, one step
  assert.ok(T.cellsFor(mk(3, { spread: 8 })).cells.every((c) => c.steps === 1 && c.level === 'low'));
  // forecasts that disagree are never more than low
  assert.equal(T.sureSteps({ confidence: 'high', signal: 'none', pattern: 'no-signal' }), 1);
  const sample = T.cellsFor(days, days.series, { sample: true }).cells;
  assert.ok(sample.every((c) => c.steps === 0 && c.level === 'none' && c.sureWords === ''), 'a sample spread is not a forecast spread');
});

test('dayTable: one button per day carrying the scrub hour, its day line as name, and the active day marked', () => {
  const days = mk(10, { pr: true, cov: { todayDate: DATES[0] } });
  days[0].today = true; days[0].passedH = 12;
  const t = T.dayTable(days, days.series, { width: 358, activeDay: 2, label: (c) => `line ${c.date}` });
  assert.equal(t.getAttribute('role'), 'group');
  const cols = t.all('strip-day');
  assert.equal(cols.length, 10);
  cols.forEach((b, i) => {
    assert.equal(b.tag, 'button'); assert.equal(b.dataset.day, String(i));
    assert.ok(+b.dataset.t >= windows[i].startH && +b.dataset.t <= windows[i].endH, `day ${i} scrubs inside its own day: ${b.dataset.t}`);
    assert.equal(b.getAttribute('aria-label'), `line ${DATES[i]}`);
  });
  assert.ok(cols[2].classList.contains('is-active') && cols[2].getAttribute('aria-current') === 'date');
  assert.equal(cols.filter((b) => b.classList.contains('is-active')).length, 1);
  assert.equal(t.all('strip-label')[0].textContent, 'Today 24 Nov');
  assert.equal(t.all('strip-label')[1].textContent, 'Tomorrow 25 Nov');
  assert.equal(t.all('dt-name')[1].dataset.short, 'Wed', 'Tomorrow can give way to its weekday in a narrow column');
  assert.equal(t.all('dt-passed').length, 1);
  assert.equal(t.all('dt-passed')[0].firstChild.style.width, '50%');
  assert.equal(t.all('hatch-nodata').length, 0, 'no phantom hatched day');
  assert.ok(t.classList.contains('dt-scrolls'), 'ten days do not fit a phone: the table scrolls');
  assert.equal(t.all('dt-band').length, 1, 'the broad-pattern band over days 8-10');
  assert.match(t.style.gridTemplateColumns, new RegExp(`^repeat\\(10, [\\d.]+px\\) ${T.PEEK}px$`), 'a table that scrolls ends in a PEEK px track');
  assert.equal(t.all('dt-lead').length, 1, 'a plain rule over the days before the first band');
  assert.equal(t.all('dt-lead')[0].style.gridColumn, '1 / 8');
  // no rain field: the rain row is left out, not drawn as zeros
  const dry = mk(3, { rain: false });
  const td = T.dayTable(dry, dry.series, { width: 313 });
  assert.ok(td.classList.contains('dt-no-rain'));
  assert.ok(!/\b0 mm\b/.test(td.textContent));
});
