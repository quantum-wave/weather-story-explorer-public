// W4-01 (design spec 6.1 and 15, critique C3): the retired `layers` and `case` store keys have no readers under site/js/ except the
// hash compatibility shim in links.js, the lens decides what is drawn (and which sample case), and "Coming soon" ships nowhere.
// The scan reads source text with comments and strings of prose removed; it proves it can fail by scanning planted readers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './hygiene.mjs';

const SITE = path.join(REPO, 'site');
const JS = path.join(SITE, 'js');
const SHIM = path.join('js', 'links.js');

function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['vendor', 'data'].includes(e.name)) walk(p, ext, out); } else if (ext.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}
/** Source with // and block comments blanked (line numbers kept). Naive on purpose: no site/js line holds `//` inside a string. */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}
// What a reader of the store's retired keys looks like: `x.layers`, `x.case`, `'layers' in patch`, `{ layers: ... }`, `{ case: ... }`.
// Not readers: the renderer's grid layers (`spec.layers`, `sp.layers`, `doubt.layers`, `layers: grids`) and the manifest's per-field
// `case` (`meta.case`, `fields?.[f]?.case`), which are different things with the same names.
const BEFORE_OK = /(?:\bspec|\bsp|\bdoubt|\bmeta|\]\?)$/;
export function findReaders(file, src) {
  const text = stripComments(src), hits = [];
  const lineOf = (i) => text.slice(0, i).split('\n').length;
  for (const m of text.matchAll(/\.(layers|case)\b/g)) if (!BEFORE_OK.test(text.slice(Math.max(0, m.index - 24), m.index))) hits.push([lineOf(m.index), m[0]]);
  for (const m of text.matchAll(/['"`](layers|case)['"`]\s+in\b/g)) hits.push([lineOf(m.index), m[0]]);
  for (const m of text.matchAll(/[{,]\s*case\s*:/g)) hits.push([lineOf(m.index), m[0].trim()]);
  if (!/render[\\/](compose|sample)\.js$/.test(file)) for (const m of text.matchAll(/[{,]\s*layers\s*:/g)) hits.push([lineOf(m.index), m[0].trim()]);
  return hits;
}

test('no reader of store.layers or store.case under site/js/ except the links.js hash shim', () => {
  const bad = [];
  for (const f of walk(JS, ['.js'])) {
    if (path.relative(SITE, f) === SHIM) continue;
    for (const [line, what] of findReaders(f, fs.readFileSync(f, 'utf8'))) bad.push(`${path.relative(REPO, f)}:${line} ${what}`);
  }
  assert.deepEqual(bad, [], 'a reader of a retired key:\n' + bad.join('\n'));
});

test('the store starts without the retired keys, and a lens decides the sample case', async () => {
  const { store } = await import(path.join(JS, 'state.js'));
  const keys = Object.keys(store.get());
  assert.ok(!keys.includes('layers') && !keys.includes('case'), 'initial state has: ' + keys);
  const { caseForLens } = await import(path.join(JS, 'data', 'kind.js'));
  const m = { cases: { A: {}, B: {} }, fields: { z500a: { case: 'A' }, ws250: { case: 'B' } } };
  assert.equal(caseForLens(m, 'z'), 'A'); assert.equal(caseForLens(m, 'j'), 'B');
  assert.equal(caseForLens(m, 'r'), 'A', 'a field no case holds falls back to the first case');
  assert.equal(caseForLens({ fields: {} }, 'j'), null, 'a live or recorded run has no cases');
});

test('the scan fails on a planted reader and passes the renderer\'s own layers and the manifest\'s field case', () => {
  const planted = [
    'const a = store.get().layers.j;', 'const c = s.case;', "if ('layers' in patch) redraw();", 'store.set({ case: \'B\' });',
    'store.set({ layers: { j: true } });', 'const k = JSON.stringify(state.layers);',
  ];
  for (const src of planted) assert.ok(findReaders('site/js/x.js', src).length >= 1, 'missed: ' + src);
  const fine = [
    'const g = spec.layers.map(f);', 'sp.layers = grids.map(own);', 'x = doubt.layers.length;', 'return meta.case === id;',
    'const c = m.fields?.[f]?.case;', '// store.get().layers is retired', '/* s.case */ let y = 1;',
  ];
  for (const src of fine) assert.deepEqual(findReaders('site/js/x.js', src), [], 'flagged: ' + src);
  assert.deepEqual(findReaders('site/js/render/compose.js', 'const sp = { layers: grids };'), [], 'compose passes grid layers');
});

test('"Coming soon" appears nowhere in site/', () => {
  const bad = [];
  for (const f of walk(SITE, ['.html', '.js', '.css', '.json'])) if (/coming soon/i.test(fs.readFileSync(f, 'utf8'))) bad.push(path.relative(REPO, f));
  assert.deepEqual(bad, []);
});
