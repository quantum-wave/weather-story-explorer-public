// W4-09: S-A11Y's owner attribution and gating are pure functions; prove them on small synthetic source trees (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as A from '../checks/S-A11Y.mjs';

const { ownersOf, summarise, axeGated, UNMERGED_OWNERS } = A;

const files = [
  { rel: 'site/index.html', text: '<button id="sheet-handle" class="sheet-handle" type="button" aria-label="Resize panel"><span></span></button>' },
  { rel: 'site/js/main.js', text: "const layout = mountLayout({ handle: $('sheet-handle'), stage: $('stage') });" },
  { rel: 'site/js/pins/toast.js', text: "const tries = [below('map-tools'), below('sheet-handle')];" },
  { rel: 'site/css/shell.css', text: '.sheet-handle { display: none; } @media (max-width: 700px) { .sheet-handle { display: grid; } }' },
  { rel: 'site/js/pins/picker.js', text: "export function mount({ placeholder = 'Search for a city' } = {}) {\n  const input = h('input', { type: 'text', placeholder, autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'search', 'aria-label': label, spellcheck: 'false', role: 'combobox', 'aria-expanded': 'false' });\n}" },
  { rel: 'site/js/pins/addsheet.js', text: "mount({ placeholder: 'Search for a city or place', onLayout: resize });\nconst name = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'next', spellcheck: 'false', 'data-f': 'name', placeholder: st.kind });" },
  { rel: 'site/js/pins/other.js', text: "const q = document.querySelector('input[role=combobox]');" },
  { rel: 'site/js/ui/status.js', text: "h('button', { class: 'wse-status-retry', type: 'button', text: 'Retry' })" },
  { rel: 'site/css/status.css', text: '.wse-status-retry { color: red }' },
];

test('an element made in markup is owned by the markup, not by files that look it up or style it', () => {
  const html = '<button id="sheet-handle" class="sheet-handle" type="button" aria-label="Resize panel">';
  assert.deepEqual(ownersOf('#sheet-handle', html, files), ['site/index.html']);
});
test('an unseen element is attributed through its placeholder and the h() call that builds it, not the file that passes a longer string', () => {
  const html = '<input type="text" placeholder="Search for a city" autocomplete="off" role="combobox" aria-expanded="false"';
  assert.deepEqual(ownersOf('input[placeholder="Search for a city"]', html, files), ['site/js/pins/picker.js']);
});
test('a sibling input built with some of the same attributes does not share ownership when its values differ', () => {
  const html = '<input type="text" placeholder="Search for a city or place" autocomplete="off" autocapitalize="words" enterkeyhint="search" aria-label="City" spellcheck="false"';
  assert.deepEqual(ownersOf('input[placeholder="Search for a city or place"]', html, files), ['site/js/pins/picker.js']);
});
test('a class created by an h() call is owned by that file; the stylesheet and lookups only mention it', () => {
  assert.deepEqual(ownersOf('.wse-status-retry', '<button class="wse-status-retry" type="button">Retry</button>', files), ['site/js/ui/status.js']);
});
test('an element nothing creates falls back to the files that mention it, never to an arbitrary file', () => {
  assert.deepEqual(ownersOf('#nowhere-at-all', '<div id="nowhere-at-all">', files), []);
});

// The repo's own builder helpers: el('tag', 'cls ...', {attrs}) with a positional class (time/scrubber.js), el('tag', {props}) (ui/header.js),
// and a locally named helper that wraps createElement. Stylesheets and lookups only mention the class.
const elFiles = [
  { rel: 'site/js/time/scrubber.js', text: "function el(tag, cls, attrs) {\n  const n = document.createElement(tag);\n  if (cls) n.className = cls;\n  return n;\n}\nconst play = el('button', 'tl-btn tl-play', { type: 'button', 'aria-label': 'Play' });\nconst speed = el('button', 'tl-speed', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Playback speed' });" },
  { rel: 'site/js/ui/header.js', text: "function el(tag, props = {}, ...kids) { const n = document.createElement(tag); return n; }\nbar.append(el('span', { class: 'hd-runtag', text: label }));" },
  { rel: 'site/js/pins/daterange.js', text: "const make = (tag, cls, text) => {\n  const e = doc.createElement(tag); if (cls) e.className = cls; return e; };\nconst lab = make('span', 'dr-label', text);" },
  { rel: 'site/js/main.js', text: "document.querySelector('.tl-speed').focus(); const p = $('.tl-play'); const r = q('.dr-label');" },
  { rel: 'site/css/shell.css', text: '.tl-speed { min-width: 44px } .tl-play { color: red } .hd-runtag { color: blue } .dr-label { font-weight: 600 } .css-only { color: red }' },
  { rel: 'site/css/timeline.css', text: '.tl-speed { padding: 0 } .tl-btn.tl-play { width: 44px } .dr-label { margin: 0 } .css-only { margin: 0 }' },
];
test('el() with a positional class argument owns the element; the stylesheets that style it and a file that queries it do not', () => {
  const html = '<button class="tl-speed" type="button" aria-haspopup="menu" aria-expanded="maybe" aria-label="Playback speed">';
  assert.deepEqual(ownersOf('.tl-speed', html, elFiles), ['site/js/time/scrubber.js']);
  assert.deepEqual(ownersOf('div.tl-row > button.tl-btn.tl-play', '<button class="tl-btn tl-play" type="button" aria-label="Play">', elFiles), ['site/js/time/scrubber.js']);
});
test('el() with a props object and a locally named createElement wrapper each own their element', () => {
  assert.deepEqual(ownersOf('.hd-runtag', '<span class="hd-runtag">GFS 00z</span>', elFiles), ['site/js/ui/header.js']);
  assert.deepEqual(ownersOf('.dr-label', '<span class="dr-label">From</span>', elFiles), ['site/js/pins/daterange.js']);
});
test('a stylesheet is never an owner while a script or markup file names the element; it is listed only when nothing else does', () => {
  const files = [
    { rel: 'site/js/a.js', text: "const b = document.querySelector('.ghost'); b.hidden = true; b.dataset.x = '1'; document.querySelectorAll('.ghost');" },
    { rel: 'site/css/a.css', text: '.ghost { color: red } .ghost:hover { color: blue } .ghost:focus { outline: 0 }' },
  ];
  assert.deepEqual(ownersOf('.ghost', '<div class="ghost">', files), ['site/js/a.js']);
  assert.deepEqual(ownersOf('.css-only', '<div class="css-only">', elFiles), ['site/css/shell.css', 'site/css/timeline.css']);
});

test('assertion messages put every offender (capped) on their first line, since the runner prints only that line', () => {
  const items = Array.from({ length: 11 }, (_, i) => `offender-${i}`);
  const m = A.listMsg('findings', items);
  assert.ok(!m.includes('\n'), 'one line');
  assert.match(m, /^findings \(11\): offender-0; offender-1; .*offender-7; \+3 more/);
  assert.equal(A.listMsg('findings', ['only']), 'findings (1): only');
});

const tipFrames = (over = {}) => [{ gate: true, tooltips: ['desktop', 'phone'].flatMap((viewport) => ['.tl-play', '.tl-prev', '.tl-next', '.wse-sheet-close'].map((selector) => ({ selector, viewport, node: 'button' + selector, name: 'x', hover: false, focus: false, ...(over[selector + ' ' + viewport] || {}) }))) }];
test('tooltip findings are gated by identity: today\'s eight pass, an unlisted one fails, a stale entry fails', () => {
  assert.equal(A.KNOWN_TOOLTIP.length, 8);
  assert.deepEqual(A.tooltipVerdict(tipFrames()), { unexpected: [], stale: [] });
  const sheet = [...tipFrames(), { gate: true, tooltips: [{ selector: '.wse-sheet-close', viewport: 'phone', node: '.wse-sheet-close', name: 'Close', hover: false, focus: true }] }]; // focus fixed, hover not: a new identity
  assert.deepEqual(A.tooltipVerdict(sheet).unexpected, ['.wse-sheet-close (phone) no visible tooltip on hover, name "Close"']);
  const ungated = [...tipFrames(), { gate: false, tooltips: sheet[1].tooltips }];
  assert.deepEqual(A.tooltipVerdict(ungated).unexpected, [], 'an unmerged package\'s stop reports, never fails');
  const fixed = tipFrames({ '.tl-play desktop': { hover: true, focus: true } });
  assert.deepEqual(A.tooltipVerdict(fixed).stale, ['.tl-play (desktop) hover+focus']);
  const half = tipFrames({ '.tl-next phone': { hover: true } });
  assert.deepEqual(A.tooltipVerdict(half), { unexpected: ['.tl-next (phone) no visible tooltip on focus, name "x"'], stale: ['.tl-next (phone) hover+focus'] });
  const partial = [{ gate: true, tooltips: tipFrames()[0].tooltips.filter((t) => t.viewport === 'desktop') }];
  assert.deepEqual(A.tooltipVerdict(partial, { complete: false }).stale, [], 'a control not on screen is not judged until the tour has run');
  assert.equal(A.tooltipVerdict(partial, { complete: true }).stale.length, 4);
});
test('tooltip findings land in the findings files under the owning file, with FAILS, known and report kept apart', () => {
  const owners = (target) => (target.includes('tl-') ? ['site/js/time/scrubber.js'] : ['site/js/ui/sheet.js']);
  const frames = [
    ...tipFrames().map((f) => ({ ...f, stop: 'shell', name: 'home', viewport: 'desktop', violations: [], labels: [] })),
    { stop: '03-sheet-snaps', name: '', viewport: 'phone', gate: true, violations: [{ id: 'aria-valid-attr-value', impact: 'critical', nodes: [{ target: '.tl-speed', html: '' }] }], labels: [], tooltips: [{ selector: '.wse-sheet-close', viewport: 'phone', node: '.wse-sheet-close', hover: false, focus: false }] },
    { stop: '20-layers', name: '', viewport: 'phone', gate: false, violations: [{ id: 'color-contrast', impact: 'serious', nodes: [{ target: '.lyr-x', html: '' }] }], labels: [], tooltips: [] },
  ];
  const by = A.groupByFile(frames, owners);
  const tips = by['site/js/time/scrubber.js'].filter((r) => r.impact === 'tooltip');
  assert.equal(tips.length, 6);
  assert.equal(by['site/js/ui/sheet.js'].filter((r) => r.impact === 'tooltip').length, 3, 'the shell frames\' sheet-close tooltips and the tour stop\'s');
  assert.ok(tips.every((r) => r.known && r.rule === 'tooltip:none-on-hover+focus'));
  const txt = A.findingsText(by);
  assert.match(txt, /site\/js\/time\/scrubber\.js\n(?:.*\n)*? {4}known  tooltip tooltip:none-on-hover\+focus  \.tl-play \(button\.tl-play\)/);
  assert.match(txt, / {4}known  tooltip tooltip:none-on-hover\+focus  \.tl-prev \(button\.tl-prev\)/, 'prev and next stay on their own lines');
  assert.match(txt, / {4}FAILS  critical aria-valid-attr-value  \.tl-speed/);
  assert.match(txt, /site\/js\/ui\/sheet\.js\n {4}known  tooltip tooltip:none-on-hover\+focus  \.wse-sheet-close/);
  assert.match(txt, / {4}report serious color-contrast  \.lyr-x/);
  assert.ok(!/GATED/.test(txt));
});

test('summarise lists every stop a finding appears on and a state count, and keeps one line per rule and target', () => {
  const rows = [];
  for (let i = 0; i < 9; i++) rows.push({ stop: 'S' + i + '/a', viewport: 'phone', rule: 'r', impact: 'serious', target: 't', gate: i === 8 });
  rows.push({ stop: 'S0', viewport: 'desktop', rule: 'r', impact: 'serious', target: 'other', gate: false });
  const out = summarise(rows);
  assert.equal(out.length, 2);
  const t = out.find((r) => r.target === 't');
  assert.equal(t.states, 9);
  assert.ok(t.gate, 'gated when any state is');
  assert.match(t.stops, /S0 phone/);
  assert.match(t.stops, /\+3 more/);
});

test('axe gates every stop of a merged package whatever its layout gate says; only unmerged owners report', () => {
  assert.equal(axeGated({ owner: 'W3-05', gate: false }), true);
  assert.equal(axeGated({ owner: 'W3-06', gate: false }), true);
  for (const o of UNMERGED_OWNERS) assert.equal(axeGated({ owner: o, gate: true }), false);
});

// An owner left in UNMERGED_OWNERS after its merge turns every finding on its stops into a report, so the check stops gating them.
// The branch's own history says what is merged ("Merge W4-01: ..."); skipped where git or those merge subjects are absent.
test('UNMERGED_OWNERS names no package whose merge is in this branch\'s history', (t) => {
  const r = spawnSync('git', ['log', '--merges', '--format=%s', 'HEAD'], { cwd: new URL('../../..', import.meta.url), encoding: 'utf8' });
  if (r.status !== 0) { t.skip('no git history here'); return; }
  const merged = new Set([...r.stdout.matchAll(/^Merge (W\d+-\d+|FIX-\d+):/gm)].map((m) => m[1]));
  if (!merged.size) { t.skip('the history here names no package merges (a shallow clone or an export)'); return; }
  assert.deepEqual(UNMERGED_OWNERS.filter((o) => merged.has(o)), [], 'remove these from UNMERGED_OWNERS: their packages are merged');
});

// run_all.sh passes the live-like rerun an explicit --only list, and --only ignores tiers: the list must leave the network tier out.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('run_all.sh live-like id list holds every check except the network-tier ones', async () => {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const line = fs.readFileSync(path.join(repo, 'tests', 'run_all.sh'), 'utf8').split('\n').find((l) => /^\s*ids="\$\(/.test(l));
  assert.ok(line, 'run_all.sh has an ids= line');
  const ids = execFileSync('bash', ['-c', line.trim() + '; printf %s "$ids"'], { cwd: repo, encoding: 'utf8' }).split(',');
  const all = fs.readdirSync(path.join(repo, 'tests', 'site', 'checks')).filter((f) => f.endsWith('.mjs'));
  const network = [];
  for (const f of all) { const m = await import(path.join(repo, 'tests', 'site', 'checks', f)); if (m.tier === 'network') network.push(m.id); }
  assert.ok(network.includes('S-ARTIFACT-NET'), 'S-ARTIFACT-NET is network tier');
  assert.deepEqual(ids.filter((i) => network.includes(i)), [], 'network checks stay out of the live-like list');
  assert.equal(ids.length, all.length - network.length, 'every other check is in it');
});
