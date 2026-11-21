// S-A11Y (TEST-11, W4-09, Josh points 4 and 16): accessibility, two parts.
//  1. axe-core (vendored under tests/vendor/axe-core, injected with Runtime.evaluate; no CDN) runs on every tour stop state at both
//     sizes. Serious and critical violations fail the check on every stop whose owner package is merged (UNMERGED_OWNERS stops
//     report instead); the tour's layout `gate` flag is not consulted. Every finding is written, grouped by the
//     owning source file, to $WSE_ARTIFACTS/S-A11Y/findings.json and .txt for W5-01 (POLISH).
//  2. The visible-label rule (DESIGN-SPEC 3.1) on the real shell: no icon-only control. Every button shows text. The exceptions are
//     exactly EXCEPTIONS below (the sheet's close glyph and the timeline's play and step glyphs), each of which must carry an
//     accessible name and a tooltip that is absent at rest and appears on hover and on focus, rendered visible, tied to the control
//     and naming what it does (tipProbe; gated by identity against KNOWN_TOOLTIP, written to the findings files under the owning
//     file). No label pairs two meanings ("Unsettled Sun").
// Known positives (run every time): an <img> with no alt fails axe; an icon-only button and "Unsettled Sun" fail the label rule;
// the TOOLTIP_CASES controls are each judged right (an always-present opacity:0 pseudo-element, among others, must fail).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, DEFAULT_DATA, REPO } from '../lib/server.mjs';
import { artifactPath } from '../lib/artifacts.mjs';
import { Browser } from '../lib/cdp.mjs';
import * as input from '../lib/input.mjs';
import { VIEWPORTS, loadStops, settle } from '../../visual/lib/tour.mjs';

export const id = 'S-A11Y';
export const tier = 'full';
export const timeoutMs = 900000;
export const freshProfile = true;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AXE = path.resolve(HERE, '..', '..', 'vendor', 'axe-core', 'axe.min.js');
const IMPACTS = ['critical', 'serious'];
/** Owner packages whose surface is not merged yet: their stops report, never fail. Every other stop is gated, whatever the tour's own
 *  layout `gate` flag says (that flag judges overlap and target size, which other packages' boxes can break). Empty while every stop's
 *  owner is merged; add a package id here only while its stops are on the tour ahead of its merge, and remove it at the merge. */
export const UNMERGED_OWNERS = [];
export const axeGated = (stop) => !UNMERGED_OWNERS.includes(stop.owner);

/** The only controls without visible text (DESIGN-SPEC 3.1). Each needs an accessible name and a tooltip on hover and focus. */
export const EXCEPTIONS = [
  { selector: '.wse-sheet-close', what: "the sheet's close glyph" },
  { selector: '.tl-play', what: "the timeline's play glyph" },
  { selector: '.tl-prev', what: "the timeline's step-back glyph" },
  { selector: '.tl-next', what: "the timeline's step-forward glyph" },
];
/** Real findings the label rule reports today. Each is gated by identity: any finding not listed fails, and a listed one that no
 *  longer reproduces fails too (delete the entry when W5-01 fixes it). */
export const KNOWN_LABEL = [
  { rule: 'icon-only', selector: '#sheet-handle', viewport: 'phone', owner: 'site/index.html, site/css/shell.css, site/js/ui/layout.js',
    note: 'the phone sheet handle is an icon-only button ("Resize panel") and is not one of the 3.1 exceptions; give it visible text or add it to the spec exceptions' },
];

/** Exception controls that show no visible tooltip today (DESIGN-SPEC 3.1 and section 11 require one on hover and on focus), by the
 *  exception selector, viewport and what is missing ('hover', 'focus' or 'hover+focus'). Same discipline as KNOWN_LABEL: an unlisted
 *  finding on a gated state fails, a listed one that no longer reproduces fails (update or delete the entry when W5-01 adds the tooltip). */
export const KNOWN_TOOLTIP = ['desktop', 'phone'].flatMap((viewport) => [
  { selector: '.tl-play', viewport, missing: 'hover+focus', owner: 'site/js/time/scrubber.js', note: 'the play glyph carries aria-label "Play" but shows no tooltip' },
  { selector: '.tl-prev', viewport, missing: 'hover+focus', owner: 'site/js/time/scrubber.js', note: 'the step-back glyph carries aria-label "Previous model step" but shows no tooltip' },
  { selector: '.tl-next', viewport, missing: 'hover+focus', owner: 'site/js/time/scrubber.js', note: 'the step-forward glyph carries aria-label "Next model step" but shows no tooltip' },
  { selector: '.wse-sheet-close', viewport, missing: 'hover+focus', owner: 'site/js/ui/sheet.js', note: 'the sheet close glyph carries aria-label "Close" but shows no tooltip (seen on the tour stops that open a sheet)' },
]);

/** Real serious or critical axe findings on gated stops today, by rule and a substring of the node's target. Same discipline as
 *  KNOWN_LABEL: an unlisted finding fails, a listed one that no longer reproduces fails (delete the entry when W5-01 fixes it). */
export const KNOWN_AXE = [
  { rule: 'aria-required-attr', target: 'Search for a city', owner: 'site/js/pins/picker.js:41',
    note: 'the city search input is role=combobox with aria-expanded but no aria-controls naming its results list' },
];

export const isKnownAxe = (rule, target) => KNOWN_AXE.some((k) => k.rule === rule && target.includes(k.target));
export const isKnownLabel = (l) => KNOWN_LABEL.some((k) => k.rule === l.rule && k.selector === l.node && k.viewport === l.viewport);
/** What an exception control's tooltip lacks: '' when it shows on hover and on focus. */
export const tipMissing = (t) => [!t.hover && 'hover', !t.focus && 'focus'].filter(Boolean).join('+');
export const isKnownTooltip = (t) => KNOWN_TOOLTIP.some((k) => k.selector === t.selector && k.viewport === t.viewport && k.missing === tipMissing(t));

/** One-line assertion message: the runner prints only an error's first line, so every offender (up to `cap`) sits on it. */
export function listMsg(head, items, cap = 8) {
  const shown = items.slice(0, cap).join('; ');
  return `${head} (${items.length}): ${shown}${items.length > cap ? `; +${items.length - cap} more (full list above)` : ''}`;
}
/** Print every offender, then assert none: the log carries the full list, the failure line the first `cap`. */
function assertNone(assert, items, head) {
  if (items.length) { console.log(`  ${head}:`); for (const i of items) console.log(`    ${i}`); }
  assert.deepEqual(items, [], listMsg(head, items));
}

/** Judge exception tooltips across frames ({ gate, tooltips: [{ selector, viewport, hover, focus }] }). `complete` says every state the
 *  check covers was audited, so a KNOWN_TOOLTIP entry whose control never appeared is stale too; otherwise only entries whose control
 *  was seen at that viewport are judged. Returns { unexpected, stale } as readable lines. */
export function tooltipVerdict(frames, { complete = true } = {}) {
  const seen = new Map(); // selector|viewport -> Set of missing strings observed ('' = fine)
  const unexpected = new Set();
  for (const f of frames) for (const t of f.tooltips || []) {
    const k = `${t.selector}|${t.viewport}`;
    (seen.get(k) || seen.set(k, new Set()).get(k)).add(tipMissing(t));
    if (f.gate && tipMissing(t) && !isKnownTooltip(t)) unexpected.add(`${t.selector} (${t.viewport}) no visible tooltip on ${tipMissing(t)}, name "${t.name}"`);
  }
  const stale = KNOWN_TOOLTIP.filter((k) => {
    const got = seen.get(`${k.selector}|${k.viewport}`);
    return got ? !got.has(k.missing) : complete;
  }).map((k) => `${k.selector} (${k.viewport}) ${k.missing}`);
  return { unexpected: [...unexpected], stale };
}

// ---------------------------------------------------------------------------------------------------------------- in the page
/** Runs in the page (serialised with toString: closes over nothing). Returns { findings, exceptions }. */
export function collectLabels(exceptionSelectors) {
  const Q = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=link]';
  const shown = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || e.hidden || e.inert) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const srOnly = (e) => { const cs = getComputedStyle(e), r = e.getBoundingClientRect(); return e.getAttribute('aria-hidden') === 'true' || (cs.position === 'absolute' && (r.width <= 1 || r.height <= 1)) || cs.clip === 'rect(0px, 0px, 0px, 0px)' || +cs.opacity === 0 || cs.display === 'none' || cs.visibility === 'hidden'; };
  const visibleText = (el) => {
    let t = '';
    const walk = (n) => {
      if (n.nodeType === 3) { t += n.textContent; return; }
      if (n.nodeType !== 1 || (n !== el && srOnly(n))) return;
      for (const c of n.childNodes) walk(c);
    };
    walk(el);
    return t.replace(/\s+/g, ' ').trim();
  };
  const hasWord = (t) => /[\p{L}\p{N}]/u.test(t);
  const sel = (el) => {
    if (el.id) return '#' + el.id;
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.body && parts.length < 3; e = e.parentElement) {
      if (e.id) { parts.unshift('#' + e.id); break; }
      const c = (e.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      parts.unshift(e.tagName.toLowerCase() + (c ? '.' + c : ''));
    }
    return parts.join(' > ');
  };
  const nameOf = (el) => {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) return lb.split(/\s+/).map((i) => document.getElementById(i)?.textContent || '').join(' ').trim();
    return (el.getAttribute('aria-label') || '').trim() || (el.getAttribute('title') || '').trim() || (el.textContent || '').trim();
  };
  const findings = [], exceptions = [];
  for (const el of document.querySelectorAll(Q)) {
    if (el instanceof SVGElement || !shown(el)) continue; // SVG hit targets (the strip's day columns) sit over drawn day labels
    const tag = el.tagName;
    let visible;
    if (tag === 'INPUT' && /^(button|submit|reset)$/.test(el.type)) visible = el.value || '';
    else if ((tag === 'INPUT' || tag === 'TEXTAREA') && el.readOnly && el.value) visible = el.value; // a read-only field shows its text (the share link)
    else if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      const labels = [...(el.labels || [])].filter(shown).map(visibleText).join(' ');
      visible = labels || el.getAttribute('placeholder') || '';
    } else visible = visibleText(el);
    if (hasWord(visible)) continue;
    const ex = exceptionSelectors.find((s) => el.matches(s));
    if (ex) { exceptions.push({ selector: ex, node: sel(el), name: nameOf(el), glyph: visible, html: el.outerHTML.slice(0, 140) }); continue; }
    findings.push({ rule: 'icon-only', node: sel(el), name: nameOf(el), glyph: visible, html: el.outerHTML.slice(0, 140) });
  }
  // a label that pairs a weather word with a bare weekday abbreviation reads as one phrase ("Unsettled Sun")
  const PAIR = /\b(Unsettled|Settled|Dry|Wet|Rain|Showers|Windy|Sunny|Cloudy|Stormy|Mild|Warm|Cool|Cold|Fair|Clear|Snow|Mostly|Partly)\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?![a-z])/;
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length || !shown(el)) continue;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    const m = t.match(PAIR);
    if (m) findings.push({ rule: 'paired-meanings', node: sel(el), name: t.slice(0, 80), glyph: '', html: m[0] });
  }
  return { findings, exceptions };
}

/** Runs the label rule on the page as it stands, and the tooltip check for each exception control found (judged by tooltipVerdict).
 *  `probed`, a Set of exception selectors, skips a control already probed on this page and records the ones probed now. */
export async function auditLabels(page, { viewport = 'desktop', probed = null } = {}) {
  const sels = EXCEPTIONS.map((e) => e.selector);
  const r = await page.eval(`(${collectLabels.toString()})(${JSON.stringify(sels)})`);
  const findings = r.findings.map((f) => ({ ...f, viewport }));
  for (const ex of r.exceptions) {
    if (!ex.name.trim() || /^[^\p{L}\p{N}]*$/u.test(ex.name)) findings.push({ rule: 'exception-unnamed', node: ex.node, name: ex.name, glyph: ex.glyph, viewport, html: '' });
  }
  const tooltips = [];
  for (const ex of r.exceptions) {
    if (probed?.has(ex.selector)) continue; // the tour probes each exception control once per stop page: its tooltip is the control's own
    probed?.add(ex.selector);
    tooltips.push({ ...ex, viewport, ...(await tooltipState(page, ex)) });
  }
  return { findings, exceptions: r.exceptions, tooltips };
}

/** Runs in the page (serialised with toString: closes over nothing). The tooltips of the control `selector` that are on screen now:
 *  each must be RENDERED VISIBLE (an element: a non-zero box, and it and every ancestor not display:none, not visibility:hidden and of
 *  opacity above 0; a ::before/::after pseudo-element of the control: non-empty content, computed display not none, visibility not
 *  hidden, opacity above 0 and a non-zero box), TIED TO THE CONTROL (an element named by its aria-describedby, an element inside it,
 *  or its own pseudo-element; a [role=tooltip] elsewhere on the page does not count) and SAY WHAT THE CONTROL DOES (its text, folded
 *  for case and spacing, equals or contains the control's accessible name). The title attribute alone never counts (it shows neither
 *  on touch nor in the artifact frame). Returns { name, tips: [{ via, text }] }. */
export function tipProbe(selector) {
  const el = document.querySelector(selector);
  if (!el) return { name: '', tips: [] };
  const fold = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const lb = el.getAttribute('aria-labelledby');
  const name = fold(lb ? lb.split(/\s+/).map((i) => document.getElementById(i)?.textContent || '').join(' ') : el.getAttribute('aria-label') || el.textContent);
  const says = (t) => !!name && fold(t).includes(name);
  const shownEl = (e) => {
    const r = e.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    for (let a = e; a && a.nodeType === 1; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === 'none' || cs.visibility === 'hidden' || !(+cs.opacity > 0) || a.hidden) return false;
    }
    return true;
  };
  // the control's computed `content` as the text it draws: quoted strings and attr() values, in order; '' for none, normal or empty
  const contentText = (c) => {
    if (!c || c === 'none' || c === 'normal') return '';
    let t = '';
    for (const m of c.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|attr\(\s*([\w-]+)\s*\)/g)) t += m[3] ? el.getAttribute(m[3]) || '' : (m[1] ?? m[2]).replace(/\\(.)/g, '$1');
    return t;
  };
  const px = (v) => (/px$/.test(v) ? parseFloat(v) : NaN);
  const tips = [];
  for (const ps of ['::before', '::after']) {
    const cs = getComputedStyle(el, ps);
    const text = contentText(cs.content);
    if (!text.trim() || cs.display === 'none' || cs.visibility === 'hidden' || !(+cs.opacity > 0)) continue;
    const w = px(cs.width), h = px(cs.height);
    if (!(w > 0 && h > 0)) continue; // a pseudo-element with no box (or none Chrome can resolve) shows nothing
    if (says(text)) tips.push({ via: ps, text });
  }
  const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  const cands = new Set([...ids.map((i) => document.getElementById(i)).filter(Boolean), ...el.querySelectorAll('*')]);
  for (const c of cands) {
    if (!shownEl(c)) continue;
    const text = c.textContent || '';
    if (says(text)) tips.push({ via: el.contains(c) ? 'inside' : 'aria-describedby', text: fold(text).slice(0, 60) });
  }
  return { name, tips };
}
/** A control has a tooltip on an interaction when no tied, visible tooltip shows at rest and one shows after the interaction. */
export const tipAppears = (rest, after) => !rest.tips.length && after.tips.length > 0;

const PROBE = (selector) => `(${tipProbe.toString()})(${JSON.stringify(selector)})`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
/** Probe until `done(result)` or `ms` pass (a tooltip may fade in or out over a transition); returns the last result. */
async function probeUntil(page, sel, done, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const r = await page.eval(PROBE(sel));
    if (done(r) || Date.now() >= end) return r;
    await pause(50);
  }
}
/** Hover, then keyboard focus, the control `ex.node` (or `ex.selector`); each is judged against the state just before it, with the
 *  pointer parked in the corner and nothing focused (given up to 400 ms to clear). A tooltip is given up to 600 ms to show.
 *  Returns { hover, focus, rest } (rest: what showed with no interaction). */
export async function tooltipState(page, ex) {
  const sel = ex.node.startsWith('#') ? ex.node : ex.selector;
  let hover = false, focus = false, rest = [];
  const park = async () => {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1, button: 'none', buttons: 0 });
    await page.eval(`document.activeElement && document.activeElement !== document.body && document.activeElement.blur()`);
    return probeUntil(page, sel, (r) => !r.tips.length, 400);
  };
  const shows = (r) => r.tips.length > 0;
  try {
    const p = await input.point(page, sel);
    const r1 = await park(); rest = r1.tips.map((t) => t.via);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 });
    hover = tipAppears(r1, await probeUntil(page, sel, shows, 600));
    const r2 = await park();
    // keyboard focus: a key press first puts the page in keyboard modality, so the focus that follows matches :focus-visible
    for (const type of ['rawKeyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16 });
    await page.eval(`document.querySelector(${JSON.stringify(sel)}).focus({ focusVisible: true })`);
    focus = tipAppears(r2, await probeUntil(page, sel, shows, 600));
    await park();
  } catch { /* an unreachable control reports no tooltip */ }
  return { hover, focus, rest };
}

// ------------------------------------------------------------------------------------------------------------------------ axe
let axeSource = null;
/** Run axe on the page as it stands. Returns the violations, trimmed. */
export async function runAxe(page) {
  axeSource ||= fs.readFileSync(AXE, 'utf8');
  if (!(await page.eval(`typeof window.axe !== 'undefined'`))) await page.eval(axeSource + '\n;true');
  return page.eval(`axe.run(document, { resultTypes: ['violations'] }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 160) })) })))`);
}

// -------------------------------------------------------------------------------------------------------------- owning files
let siteIndex = null;
function loadSiteIndex() {
  if (siteIndex) return siteIndex;
  siteIndex = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/^(vendor|data|geo)$/.test(e.name)) walk(p); } else if (/\.(js|css|html)$/.test(e.name)) siteIndex.push({ rel: path.relative(REPO, p), text: fs.readFileSync(p, 'utf8') }); } };
  walk(path.join(REPO, 'site'));
  return siteIndex;
}
const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** What identifies an element, read from the selector and the node's HTML: id and class tokens, and attribute or text values that
 *  a source file would hold as a literal (placeholder, aria-label, title, alt, visible text). */
export function evidenceOf(selectorText, html = '') {
  const ids = new Set(), classes = new Set(), literals = new Set();
  for (const m of selectorText.matchAll(/#([A-Za-z_][\w-]{2,})/g)) ids.add(m[1]);
  for (const m of selectorText.matchAll(/\.([A-Za-z_][\w-]{2,})/g)) classes.add(m[1]);
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]);
  for (const m of html.matchAll(/\sclass="([^"]+)"/g)) m[1].split(/\s+/).filter((t) => t.length > 2).forEach((t) => classes.add(t));
  for (const m of html.matchAll(/\s(?:placeholder|aria-label|title|alt|value)="([^"]{4,})"/g)) literals.add(m[1].trim());
  const text = html.replace(/<[^>]*>?/g, ' ').replace(/\s+/g, ' ').trim();
  if (/[\p{L}]{3,}/u.test(text) && text.length >= 4 && text.length <= 60) literals.add(text);
  const tag = (html.match(/^\s*<([a-z][a-z0-9]*)/i) || [])[1]?.toLowerCase() || '';
  const attrs = [...html.matchAll(/\s([a-z][\w-]*)=/g)].map((m) => m[1]).filter((a) => !/^(?:style|class|id)$/.test(a));
  const pairs = [...html.matchAll(/\s([a-z][\w-]*)="([^"]*)"/g)].filter((m) => !/^(?:style|class|id)$/.test(m[1])).map((m) => [m[1], m[2]]);
  return { ids: [...ids], classes: [...classes], literals: [...literals], tag, attrs, pairs };
}
/** Names a file uses to build elements: the repo's usual helpers (`el`, `h`, `mk`, defined locally or imported) and any function the
 *  file defines whose body calls createElement or createElementNS within its first lines. */
export function buildersOf(text) {
  const names = new Set(['el', 'h', 'mk']);
  const lines = text.split('\n');
  const def = /(?:\bfunction\s+([A-Za-z_$][\w$]*)\s*\(|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:function\b[^(]*)?\([^)]*\)\s*(?:=>)?)/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(def);
    if (m && /\bcreateElement(?:NS)?\(/.test(lines.slice(i, i + 4).join(' '))) names.add(m[1] || m[2]);
  }
  return [...names].map(escRe).join('|');
}
/** Source files that own this element, best first. A file that CREATES the element (markup carrying its id or class, a builder call
 *  such as h('tag', {class}), h('tag.cls'), el('tag', 'cls ...', {...}) or createElement, an id or className assignment, or a
 *  literal attribute value such as its placeholder or aria-label) outranks one that only mentions a class (CSS rules, querySelector, a
 *  lookup by id). A stylesheet never creates an element: it is listed only when no script or markup file names the element at all.
 *  Ties inside 80% of the best score are all listed, at most three. `files` is injectable for tests: [{ rel, text }]. */
export function ownersOf(selectorText, html = '', files = null) {
  const index = files || loadSiteIndex();
  const ev = evidenceOf(selectorText, html);
  const score = new Map(); // rel -> { make, mention, code }
  const bump = (rel, code, k, n) => { const e = score.get(rel) || { make: 0, mention: 0, code }; e[k] += n; score.set(rel, e); };
  for (const f of index) {
    if (/^site\/css\/tokens/.test(f.rel)) continue;
    const code = !/\.css$/.test(f.rel);
    const B = code ? buildersOf(f.text) : '';
    for (const t of ev.ids) {
      const q = escRe(t);
      if (code && new RegExp(`\\bid\\s*(?:=|:)\\s*["'\`]${q}["'\`]|setAttribute\\(\\s*["']id["']\\s*,\\s*["'\`]${q}["'\`]`).test(f.text)) bump(f.rel, code, 'make', 6);
      else if (new RegExp(`(?<![\\w-])${q}(?![\\w-])`).test(f.text)) bump(f.rel, code, 'mention', 1);
    }
    for (const t of ev.classes) {
      const q = escRe(t), tok = `(?<![\\w-])${q}(?![\\w-])`;
      const make = code && new RegExp([
        `\\bclass(?:Name)?\\s*(?:=|:)\\s*["'\`][^"'\`\\n]*${tok}`,                     // class="..", className = '..', { class: '..' }
        `\\b(?:${B})\\(\\s*["'][a-z0-9]+\\.[\\w.-]*${tok}`,                           // h('div.cls')
        `\\b(?:${B})\\(\\s*["'][a-z0-9]+["']\\s*,\\s*["'\`][^"'\`\\n]*${tok}`,      // el('button', 'tl-btn tl-play', {...})
        `createElement[^\\n]*${tok}`,
        `classList\\.(?:add|toggle)\\(\\s*["']${tok}`,
      ].join('|')).test(f.text);
      if (make) bump(f.rel, code, 'make', 3);
      else if (new RegExp(tok).test(f.text)) bump(f.rel, code, 'mention', 1);
    }
    // the creating call: a line (or the two before it, for a multi-line props object) that builds this tag. Its attributes are compared
    // with the node's: a name and a value that agree count 1, a name alone 0.5 (the value is a variable), a name with another literal value -0.5. A literal of the node's
    // (its placeholder, label or text) counts only here: a file that merely passes the same words to the creator does not own the element.
    let best = 0;
    if (code && ev.tag) {
      const tagRe = new RegExp(`\\b(?:${B})\\(\\s*['"]${ev.tag}['"\\.]|createElement\\(\\s*['"]${ev.tag}['"]|<${ev.tag}[\\s>]`);
      const lines = f.text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!tagRe.test(lines[i])) continue;
        const blob = lines.slice(i, i + 3).join(' ');
        let sc = 0, named = 0;
        for (const [a, v] of ev.pairs) {
          if (new RegExp(`["']?${escRe(a)}["']?\\s*[:=]\\s*["']${escRe(v)}["']`).test(blob)) { sc += 1; named++; }
          else if (new RegExp(`["']?${escRe(a)}["']?\\s*[:=]\\s*["'][^"']*["']`).test(blob)) sc -= 0.5; // the same attribute with another literal value
          else if (new RegExp(`["']?${escRe(a)}["']?\\s*[:=,}]`).test(blob)) { sc += 0.5; named++; }
        }
        for (const lit of ev.literals) if (new RegExp(`(?<=["'\`>])${escRe(lit)}(?=["'\`<])`).test(blob)) sc += 3;
        if (named >= 3 || sc >= 3) best = Math.max(best, sc);
      }
    }
    if (best) bump(f.rel, code, 'make', best);
    else if (code) for (const lit of ev.literals) if (new RegExp(`(?<=["'\`>])${escRe(lit)}(?=["'\`<])`).test(f.text)) bump(f.rel, code, 'mention', 1);
  }
  const rows = [...score].map(([rel, e]) => ({ rel, ...e }));
  const makers = rows.filter((r) => r.make > 0).sort((x, y) => y.make - x.make || y.mention - x.mention);
  if (makers.length) { const top = makers[0].make; return makers.filter((r) => r.make >= 0.8 * top).slice(0, 3).map((r) => r.rel); }
  // nothing creates it: the files that mention it, scripts and markup first; a stylesheet only when no script or markup names it
  const named = rows.some((r) => r.code) ? rows.filter((r) => r.code) : rows;
  return named.sort((x, y) => y.mention - x.mention).filter((r) => r.mention >= 2 || named.length <= 3).slice(0, 3).map((r) => r.rel);
}

// --------------------------------------------------------------------------------------------------------------------- stops
function boundInput(page, phone) {
  return {
    phone,
    click: (t, o) => input.click(page, t, o), tap: (t, o) => input.tap(page, t, o),
    drag: (t, o) => input.drag(page, t, { touch: phone, ...o }), flick: (t, o) => input.flick(page, t, o),
    pinch: (t, o) => input.pinch(page, t, o), wheel: (t, o) => input.wheel(page, t, o),
    type: (t, text, o) => input.type(page, t, text, o), key: (t, k, o) => input.key(page, t, k, o),
    activate: (t, o) => (phone ? input.tap(page, t, o) : input.click(page, t, o)),
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}
async function setViewport(page, vp, ground) {
  await page.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
  if (vp.touch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: ground }] });
}

/** Walk every tour stop at both sizes; at each snapshot run axe and the label rule. Returns the frames. */
export async function auditStops({ log = () => {}, only } = {}) {
  const stops = await loadStops(path.resolve(HERE, '..', '..', 'visual', 'stops'), only);
  const frames = [], servers = new Map();
  let browser;
  try {
    const first = await startServer({}); servers.set('synthetic', first);
    browser = await Browser.launch({ baseUrl: first.baseUrl });
    for (const stop of stops) {
      if (!servers.has(stop.data)) servers.set(stop.data, await startServer({ dataDir: path.join(REPO, 'tests', 'site', 'fixtures', stop.data) }));
      const baseUrl = servers.get(stop.data).baseUrl;
      for (const vpName of stop.viewports) {
        const vp = VIEWPORTS[vpName];
        browser.baseUrl = baseUrl;
        const page = await browser.newPage(); page.baseUrl = baseUrl;
        const probed = new Set();
        const snap = async (name) => {
          await settle(page);
          const violations = (await runAxe(page)).filter((v) => IMPACTS.includes(v.impact));
          const labels = await auditLabels(page, { viewport: vpName, probed });
          frames.push({ stop: stop.id, owner: stop.owner, gate: axeGated(stop), viewport: vpName, name: name || '', violations, labels: labels.findings, tooltips: labels.tooltips });
        };
        try {
          await setViewport(page, vp, stop.ground === 'paper' || stop.theme === 'light' ? 'light' : 'dark');
          await page.goto(stop.url || baseUrl + (stop.hash || ''));
          await settle(page);
          const inp = boundInput(page, vpName === 'phone');
          if (stop.theme) {
            const cur = await page.eval(`document.documentElement.dataset.theme || ''`);
            if (cur !== stop.theme) { await inp.activate(vpName === 'phone' ? '#btn-more' : '#btn-display'); await inp.activate(`#display-menu [data-group="theme"] button[data-value="${stop.theme}"]`); await inp.key(null, 'Escape'); }
          }
          await stop.run(page, inp, { snap, viewport: vpName, baseUrl });
          await snap('');
        } catch (e) {
          frames.push({ stop: stop.id, owner: stop.owner, gate: axeGated(stop), viewport: vpName, name: 'error', violations: [], labels: [], tooltips: [], error: String(e?.message || e).split('\n')[0] });
          log(`  ${stop.id} ${vpName}: the stop failed to run: ${String(e?.message || e).split('\n')[0]}`);
        } finally { await page.close(); }
      }
    }
  } finally {
    try { await browser?.close(); } catch {}
    for (const s of servers.values()) await s.close().catch(() => {});
  }
  return frames;
}

/** One line per rule and target within a file's rows: every stop it appears on (stop ids with a viewport tag, first six named) and the
 *  number of stop states. A line is gated when any of its states is. Its status: FAILS (a gated state not in a KNOWN_ list: the check
 *  fails on it), known (gated, listed for W5-01) or report (only on stops whose package is not merged). */
export function summarise(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = `${r.rule}|${r.target}`;
    const e = by.get(k) || { rule: r.rule, impact: r.impact, target: r.target, gate: false, fails: false, set: new Set(), n: 0 };
    e.gate ||= r.gate; e.fails ||= r.gate && !r.known; e.set.add(`${r.stop.split('/')[0]} ${r.viewport}`); e.n++;
    by.set(k, e);
  }
  return [...by.values()].map((e) => {
    const names = [...e.set].sort();
    return { rule: e.rule, impact: e.impact, target: e.target, gate: e.gate, status: e.fails ? 'FAILS' : e.gate ? 'known' : 'report', states: e.n, stops: names.slice(0, 6).join(', ') + (names.length > 6 ? `, +${names.length - 6} more` : '') };
  });
}

/** Group frames' findings by owning file: { file: [{ stop, viewport, rule, impact, target, gate, known }] }. Axe nodes, label-rule
 *  findings and exception controls without a tooltip on hover or focus are all listed. */
export function groupByFile(frames, owners = ownersOf) {
  const by = {};
  const add = (target, html, row, shown = target) => { const files = owners(target, html); for (const file of files.length ? files : ['(no source file names this element)']) (by[file] ||= []).push({ ...row, target: shown }); };
  for (const f of frames) {
    const stop = f.stop + (f.name ? '/' + f.name : '');
    for (const v of f.violations || []) for (const n of v.nodes) add(n.target, n.html, { stop, viewport: f.viewport, rule: v.id, impact: v.impact, gate: f.gate, known: isKnownAxe(v.id, n.target) });
    for (const l of f.labels || []) add(l.node, l.html, { stop, viewport: f.viewport, rule: 'label:' + l.rule, impact: 'label', gate: f.gate, known: isKnownLabel(l) });
    for (const t of f.tooltips || []) if (tipMissing(t)) add(t.node, t.html || '', { stop, viewport: f.viewport, rule: 'tooltip:none-on-' + tipMissing(t), impact: 'tooltip', gate: f.gate, known: isKnownTooltip(t) }, `${t.selector} (${t.node})`);
  }
  return by;
}
/** The findings files for W5-01: JSON rows and a text summary, both grouped by owning file. */
export function findingsText(by) {
  const head = '# S-A11Y findings by owning file. FAILS: a gated finding no KNOWN_ list names (the check fails on it); known: gated and listed for W5-01; report: only on stops whose package is not merged.\n';
  return head + Object.entries(by).sort(([a], [b]) => a.localeCompare(b)).map(([file, rows]) =>
    `${file}\n` + summarise(rows).map((r) => `    ${r.status.padEnd(6)} ${r.impact} ${r.rule}  ${r.target}  (${r.states} state(s): ${r.stops})`).join('\n')).join('\n') + '\n';
}
function writeFindings(frames, note) {
  const by = groupByFile(frames);
  const out = artifactPath('S-A11Y', 'findings.json');
  fs.writeFileSync(out, JSON.stringify({ states: frames.length, note, byFile: by }, null, 1));
  fs.writeFileSync(artifactPath('S-A11Y', 'findings.txt'), findingsText(by));
  return out;
}

// ------------------------------------------------------------------------------------------------------------- tooltip cases
/** Injected controls, each named "Play" (or as noted), and whether the tooltip check must find a tooltip on hover and on focus. */
export const TOOLTIP_CASES = {
  'kp-tip-good': true,       // ::after with attr(aria-label), shown only on :hover and :focus-visible
  'kp-tip-desc': true,       // a [role=tooltip] named by aria-describedby, shown by script on pointerenter and focus
  'kp-tip-hidden': false,    // ::after with attr(aria-label) always present at opacity 0: never visible
  'kp-tip-always': false,    // ::after always visible: not a hover or focus tooltip
  'kp-tip-unrelated': false, // a visible [role=tooltip] with the same words appears on hover and focus, but nothing ties it to the control
  'kp-tip-wrong': false,     // a visible ::after on hover and focus whose words do not name the control
  'kp-tip-vis': false,       // ::after on hover and focus with visibility:hidden
};
/** Runs in the page (serialised with toString): adds the TOOLTIP_CASES controls in a fixed tray over the page. */
export function injectTooltipCases() {
  const css = `
    #kp-tray { position: fixed; left: 40px; top: 120px; z-index: 2147483647; display: flex; gap: 24px; padding: 8px; background: #fff; }
    #kp-tray button { position: relative; width: 44px; height: 44px; font-size: 18px; }
    #kp-tip-good:hover::after, #kp-tip-good:focus-visible::after,
    #kp-tip-wrong:hover::after, #kp-tip-wrong:focus-visible::after,
    #kp-tip-vis:hover::after, #kp-tip-vis:focus-visible::after { position: absolute; top: 100%; left: 0; padding: 2px 6px; background: #111; color: #fff; white-space: nowrap; }
    #kp-tip-good:hover::after, #kp-tip-good:focus-visible::after { content: attr(aria-label); }
    #kp-tip-wrong:hover::after, #kp-tip-wrong:focus-visible::after { content: "Settings"; }
    #kp-tip-vis:hover::after, #kp-tip-vis:focus-visible::after { content: attr(aria-label); visibility: hidden; }
    #kp-tip-hidden::after { content: attr(aria-label); position: absolute; opacity: 0; pointer-events: none; }
    #kp-tip-always::after { content: attr(aria-label); position: absolute; top: 100%; left: 0; background: #111; color: #fff; }
    #kp-tray [role=tooltip] { position: absolute; top: 100%; left: 0; padding: 2px 6px; background: #111; color: #fff; }`;
  const tray = document.createElement('div');
  tray.id = 'kp-tray';
  tray.innerHTML = `<style>${css}</style>` + Object.keys({ good: 1, desc: 1, hidden: 1, always: 1, unrelated: 1, wrong: 1, vis: 1 })
    .map((k) => `<button type="button" id="kp-tip-${k}" aria-label="Play"${k === 'desc' ? ' aria-describedby="kp-tip-desc-t"' : ''}>▶</button>`).join('') +
    '<div role="tooltip" id="kp-tip-desc-t" hidden>Play</div><div role="tooltip" id="kp-tip-unrelated-t" hidden>Play</div>';
  document.body.appendChild(tray);
  const wire = (btn, tip) => {
    const on = () => { tip.hidden = false; }, off = () => { tip.hidden = true; };
    btn.addEventListener('pointerenter', on); btn.addEventListener('pointerleave', off); btn.addEventListener('focus', on); btn.addEventListener('blur', off);
  };
  wire(document.getElementById('kp-tip-desc'), document.getElementById('kp-tip-desc-t'));
  wire(document.getElementById('kp-tip-unrelated'), document.getElementById('kp-tip-unrelated-t'));
}

// ---------------------------------------------------------------------------------------------------------------------- run
async function shellStates(page, phone, vpName) {
  const out = [];
  const inp = boundInput(page, phone);
  const take = async (state) => { const r = await auditLabels(page, { viewport: vpName }); out.push({ state, viewport: vpName, ...r }); };
  // close a surface the way a person does (Escape), then wait until it and any sheet holding it have left before the next tap
  const dismiss = async (id) => {
    await inp.key(null, 'Escape');
    await page.waitFor(`document.getElementById(${JSON.stringify(id)}).hidden && !document.querySelector('.wse-sheet-root')`, { timeout: 5000 });
  };
  await take('home');
  await inp.activate(phone ? '#btn-more' : '#btn-display');
  await page.waitFor(`!document.getElementById('display-menu').hidden`, { timeout: 5000 });
  await take('display menu');
  await dismiss('display-menu');
  await inp.activate('#btn-layers');
  await page.waitFor(`!document.getElementById('layers-panel').hidden`, { timeout: 5000 });
  await take('layers panel');
  await dismiss('layers-panel'); // a popover on desktop, a modal sheet with a scrim on the phone: Escape closes both, as for a person
  await inp.activate('#data-chip');
  await page.waitFor(`!document.getElementById('data-popover').hidden`, { timeout: 5000 });
  await take('about this data');
  await dismiss('data-popover');
  return out;
}

export async function run({ page, newPage, assert, dataDir }) {
  const fullTour = path.resolve(dataDir) === path.resolve(DEFAULT_DATA); // the stops use their own fixtures: only the default run walks them
  // ---- part 2 first (fast): the label rule and the exception tooltips on the real shell, both sizes
  const phonePage = await newPage();
  const states = [];
  try {
    await setViewport(page, VIEWPORTS.desktop, 'light');
    await page.goto('/'); await settle(page);
    states.push(...await shellStates(page, false, 'desktop'));
    await setViewport(phonePage, VIEWPORTS.phone, 'light');
    await phonePage.goto('/'); await settle(phonePage);
    states.push(...await shellStates(phonePage, true, 'phone'));
  } finally { await phonePage.close(); }
  const shellFrames = states.map((s) => ({ stop: 'shell', owner: 'shell', gate: true, viewport: s.viewport, name: s.state, violations: [], labels: s.findings, tooltips: s.tooltips }));
  if (fullTour) writeFindings(shellFrames, 'shell states only: the tour stops did not run (an earlier assertion failed)');
  const real = new Map(); // identity -> finding
  for (const s of states) for (const f of s.findings) real.set(`${f.rule}|${f.node}|${f.viewport}`, f);
  const unexpected = [...real.values()].filter((f) => !isKnownLabel(f)).map((f) => `${f.rule} ${f.node} (${f.viewport}) "${f.name}"`);
  assertNone(assert, unexpected, 'label rule: controls with no visible text or a paired label outside the 3.1 exceptions');
  const stale = KNOWN_LABEL.filter((k) => !real.has(`${k.rule}|${k.selector}|${k.viewport}`)).map((k) => `${k.selector} (${k.viewport})`);
  assertNone(assert, stale, 'KNOWN_LABEL entries that no longer reproduce (remove them)');
  for (const k of KNOWN_LABEL) console.log(`  label finding for W5-01 [${k.owner}]: ${k.selector} (${k.viewport}): ${k.note}`);
  const seen = new Set(shellFrames.flatMap((f) => f.tooltips.map((t) => t.selector)));
  const missing = EXCEPTIONS.filter((e) => !seen.has(e.selector)).map((e) => e.selector);
  // an exception control that is only on screen in some states (the sheet close glyph needs an open sheet) is judged by the tour below
  const tipShell = tooltipVerdict(shellFrames, { complete: false });
  assertNone(assert, tipShell.unexpected, 'exception controls without a visible tooltip on hover and focus (DESIGN-SPEC 3.1), not in KNOWN_TOOLTIP');
  assertNone(assert, tipShell.stale, 'KNOWN_TOOLTIP entries that no longer reproduce (update or remove them)');
  for (const k of KNOWN_TOOLTIP) console.log(`  tooltip finding for W5-01 [${k.owner}]: ${k.selector} (${k.viewport}) no visible tooltip on ${k.missing}: ${k.note}`);
  console.log(`  label rule: ${real.size} finding(s), all known; exception controls seen: ${[...seen].join(', ') || 'none'}${missing.length ? ` (not on screen in the shell states: ${missing.join(', ')})` : ''}`);

  // ---- known positives
  await setViewport(page, VIEWPORTS.desktop, 'light');
  await page.goto('/'); await settle(page);
  await page.eval(`(() => { const d = document.createElement('div'); d.id = 'inj'; d.innerHTML = '<img id="inj-img" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><button id="inj-btn" type="button">\\u2715</button><span id="inj-pair">Unsettled Sun</span>'; document.body.appendChild(d); })()`);
  const kp = await auditLabels(page);
  assert.ok(kp.findings.some((f) => f.node === '#inj-btn' && f.rule === 'icon-only'), 'an injected icon-only button must fail the label rule');
  assert.ok(kp.findings.some((f) => f.node === '#inj-pair' && f.rule === 'paired-meanings'), 'an injected "Unsettled Sun" must fail the label rule');
  const kpAxe = await runAxe(page);
  assert.ok(kpAxe.some((v) => v.id === 'image-alt' && IMPACTS.includes(v.impact) && v.nodes.some((n) => n.target.includes('inj-img'))), 'an injected <img> without alt must fail axe (image-alt)');
  console.log('  known positives: the img without alt, the icon-only button and "Unsettled Sun" are each caught');
  // tooltip known positives: only a tooltip that is absent at rest, then rendered visible, tied to the control and naming what it does
  // on hover and on focus passes. An always-present opacity:0 pseudo-element (what a glyph "fix" can look like), one always shown,
  // an unrelated [role=tooltip], wrong words and a visibility:hidden pseudo-element must each fail.
  await page.eval(`(${injectTooltipCases.toString()})()`);
  const tipCases = {};
  for (const id of Object.keys(TOOLTIP_CASES)) tipCases[id] = await tooltipState(page, { node: '#' + id, selector: '#' + id });
  const wrong = Object.entries(TOOLTIP_CASES).filter(([id, want]) => tipCases[id].hover !== want || tipCases[id].focus !== want)
    .map(([id, want]) => `#${id} expected ${want ? 'a tooltip' : 'none'} on hover and focus, judged hover=${tipCases[id].hover} focus=${tipCases[id].focus} (at rest: ${tipCases[id].rest.join(',') || 'nothing'})`);
  assertNone(assert, wrong, 'tooltip known cases judged wrongly');
  console.log(`  known positives: tooltips judged right in ${Object.keys(TOOLTIP_CASES).length} cases (${Object.entries(TOOLTIP_CASES).map(([id, w]) => `${id.replace('kp-tip-', '')}=${w ? 'pass' : 'fail'}`).join(', ')})`);

  // ---- part 1: axe on every tour stop state (the stops run on their own fixtures, so the live-like rerun skips this)
  if (!fullTour) { console.log('  tour stops: skipped on this data folder (the stops use their own fixtures; the default run covers them)'); return; }
  const frames = await auditStops({ log: (m) => console.log(m) });
  const all = [...shellFrames, ...frames];
  const out = writeFindings(all, `${shellFrames.length} shell states and ${frames.length} tour stop states`);
  assertNone(assert, frames.filter((f) => f.error).map((f) => `${f.stop} ${f.viewport}: ${f.error}`), 'tour stops that failed to run');
  const gated = frames.filter((f) => f.gate);
  const total = frames.reduce((n, f) => n + f.violations.reduce((m, v) => m + v.nodes.length, 0), 0);
  console.log(`  tour: ${frames.length} stop states audited; ${total} serious/critical axe node(s); findings by owning file in ${path.relative(REPO, out)} and findings.txt`);
  for (const k of KNOWN_AXE) console.log(`  axe finding for W5-01 [${k.owner}]: ${k.rule} on "${k.target}": ${k.note}`);
  const staleAxe = KNOWN_AXE.filter((k) => !frames.some((f) => f.violations.some((v) => v.id === k.rule && v.nodes.some((n) => n.target.includes(k.target))))).map((k) => `${k.rule} ${k.target}`);
  assertNone(assert, staleAxe, 'KNOWN_AXE entries that no longer reproduce (remove them)');
  const tip = tooltipVerdict(all, { complete: true });
  assertNone(assert, tip.stale, 'KNOWN_TOOLTIP entries that no longer reproduce (update or remove them)');
  // one line per offender (rule, target, viewport), naming the first state it appears in and how many gated states share it
  const offenders = new Map();
  const note = (k, line) => { const e = offenders.get(k); if (e) e.n++; else offenders.set(k, { line, n: 1 }); };
  for (const f of gated) {
    const where = `${f.stop}${f.name ? '/' + f.name : ''}`;
    for (const v of f.violations) for (const n of v.nodes) if (!isKnownAxe(v.id, n.target)) note(`axe|${v.id}|${n.target}|${f.viewport}`, `axe ${v.impact} ${v.id} ${n.target} (${f.viewport}, first at ${where}`);
    for (const l of f.labels) if (!isKnownLabel(l)) note(`label|${l.rule}|${l.node}|${f.viewport}`, `label ${l.rule} ${l.node} (${f.viewport}, first at ${where}`);
  }
  const msg = [...[...offenders.values()].map((e) => `${e.line}, ${e.n} state(s))`), ...tip.unexpected.map((t) => 'tooltip ' + t)];
  assertNone(assert, msg, 'serious or critical findings on gated stops (rows marked FAILS in findings.txt)');
}
