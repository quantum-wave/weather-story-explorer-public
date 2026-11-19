// Self-test of the mutation runner (W1-01 tests; spec 14.1 rule 2). Builds a tiny repo (site/, tests/) under
// $WSE_ARTIFACTS/mutations-selftest/ and runs the real gate against it, asserting the verdicts the gate must give:
//   killed mutant that dies           -> pass          known-survivor that survives -> pass
//   find missing / find twice         -> FAIL          killed mutant that SURVIVES  -> FAIL
//   known-survivor that is killed     -> FAIL          check red without the mutant -> FAIL
//   unknown check kind / no checks    -> FAIL
import fs from 'node:fs';
import path from 'node:path';
import { runGate } from './mutate.mjs';
import { artifactsDir } from '../../site/lib/artifacts.mjs';

const APP = `export function add(a, b) {\n  return a + b; // covered\n}\nexport function label(n) {\n  return 'n=' + n; // not covered by any test\n}\nexport const dup = 1 + 1;\nexport const dup2 = 1 + 1;\n`;
const TEST = `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../../../site/app.mjs';\ntest('add', () => assert.equal(add(2, 3), 5));\n`;
const BROKEN = `import test from 'node:test';\ntest('always red', () => { throw new Error('red without any mutant'); });\n`;

const mutant = (o) => ({ id: 'x', file: 'site/app.mjs', find: 'return a + b;', replace: 'return a - b;', checks: ['unit:add.test.mjs'], expect: 'killed', note: 'selftest', ...o });

export async function selftest() {
  const base = path.join(artifactsDir(), 'mutations-selftest');
  fs.rmSync(base, { recursive: true, force: true });
  const root = path.join(base, 'mini');
  fs.mkdirSync(path.join(root, 'site'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests', 'site', 'unit'), { recursive: true });
  fs.writeFileSync(path.join(root, 'site', 'app.mjs'), APP);
  fs.writeFileSync(path.join(root, 'tests', 'site', 'unit', 'add.test.mjs'), TEST);
  fs.writeFileSync(path.join(root, 'tests', 'site', 'unit', 'broken.test.mjs'), BROKEN);
  // a check that passes in the real repo but fails in the scratch copy: it reads tools/needed.txt, which the copy does not carry
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools', 'needed.txt'), 'present\n');
  fs.writeFileSync(path.join(root, 'tests', 'site', 'unit', 'env.test.mjs'), `import test from 'node:test';\nimport fs from 'node:fs';\ntest('needs tools/', () => { fs.readFileSync('tools/needed.txt'); });\n`);
  const cases = [
    ['a check that passes in the repo but fails in the scratch copy is an error, not a kill', mutant({ find: 'export const dup = 1 + 1;', replace: 'export const dup = 2; // comment-only change', checks: ['unit:env.test.mjs'] }), false, /does not pass on the unmutated code in a scratch copy/],
    ['a killed mutant that dies passes', mutant({}), true, /killed by unit:add\.test\.mjs/],
    ['a known-survivor that survives passes', mutant({ find: "return 'n=' + n;", replace: "return 'm=' + n;", expect: 'known-survivor' }), true, /known survivor/],
    ['a find that does not occur fails the runner', mutant({ find: 'return a * b;' }), false, /does not occur/],
    ['a find that occurs twice fails the runner', mutant({ find: '1 + 1', replace: '1 + 2' }), false, /exactly once/],
    ['a killed mutant that survives fails the runner', mutant({ find: "return 'n=' + n;", replace: "return 'm=' + n;" }), false, /SURVIVED/],
    ['a known-survivor that is killed fails the runner', mutant({ expect: 'known-survivor' }), false, /was KILLED/],
    ['a check that fails without the mutant fails the runner', mutant({ checks: ['unit:broken.test.mjs'] }), false, /does not pass on the unmutated code/],
    ['an unknown check kind fails the runner', mutant({ checks: ['nonsense'] }), false, /unknown check/],
    ['a missing unit file fails the runner', mutant({ checks: ['unit:nope.test.mjs'] }), false, /not found/],
    ['a mutant with no checks is rejected', mutant({ checks: [] }), false, /non-empty array/],
    ['a known-survivor with no note is rejected', mutant({ expect: 'known-survivor', note: '' }), false, /needs a "note"/],
    ['a mutation that changes nothing is rejected', mutant({ replace: 'return a + b;' }), false, /identical/],
    ['a file outside site/ and tests/ is rejected', mutant({ file: '../outside.js' }), false, /not under/],
  ];
  let bad = 0;
  for (const [name, m, wantOk, wantMsg] of cases) {
    const dir = path.join(base, 'mutants');
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'M-x.json'), JSON.stringify(m));
    const lines = [];
    const r = await runGate({ root, dir, scratch: path.join(base, 'scratch'), log: (l) => lines.push(l), timeoutMs: 60000 });
    const text = lines.join('\n');
    const good = r.ok === wantOk && wantMsg.test(text);
    console.log(`${good ? 'PASS' : 'FAIL'} mutation selftest: ${name}${good ? '' : `  (gate ok=${r.ok}, wanted ${wantOk}; output: ${text.slice(0, 300)})`}`);
    if (!good) bad++;
  }
  // an empty mutant folder must fail too: a gate with nothing to run proves nothing
  const empty = path.join(base, 'empty'); fs.mkdirSync(empty, { recursive: true });
  const r0 = await runGate({ root, dir: empty, scratch: path.join(base, 'scratch'), log: () => {} });
  const g0 = r0.ok === false;
  console.log(`${g0 ? 'PASS' : 'FAIL'} mutation selftest: an empty mutant folder fails the runner`);
  if (!g0) bad++;
  fs.rmSync(base, { recursive: true, force: true });
  console.log(bad ? `MUTATION SELFTEST: ${bad} failed` : `MUTATION SELFTEST: all ${cases.length + 1} passed`);
  return bad ? 1 : 0;
}
