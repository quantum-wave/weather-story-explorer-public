// Lint fixtures (W0-01, Josh point 16): each hygiene defect and the unguarded workflow job must be flagged; the good
// fixture and the real tree must be clean. Run: node --test tests/lint/lint.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintAll, lintHygiene, lintWorkflows, REPO } from './hygiene.mjs';

const fx = (n) => path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', n);
const rules = (f) => [...new Set(f.map((x) => x.rule))].sort();

test('flags an absolute /home path', () => assert.deepEqual(rules(lintHygiene(fx('bad-home'))), ['path']));
test('flags a /tmp fallback', () => assert.deepEqual(rules(lintHygiene(fx('bad-tmp'))), ['path']));
test('flags a negated grep with no existence assert (the vacuous check)', () => assert.deepEqual(rules(lintHygiene(fx('bad-vacuous'))), ['vacuous']));
test('flags a read of a doc the public export omits', () => assert.deepEqual(rules(lintHygiene(fx('bad-private'))), ['private']));
test('flags a read of gitignored site/data', () => assert.deepEqual(rules(lintHygiene(fx('bad-untracked'))), ['untracked']));
test('flags a workflow job with no repository guard, and only that job', () => {
  const f = lintWorkflows(fx('bad-workflow'));
  assert.equal(f.length, 1);
  assert.match(f[0].message, /naked/);
});
test('the good fixture is clean', () => assert.deepEqual(lintAll(fx('good')), []));
test('the real tree is clean', () => assert.deepEqual(lintAll(REPO), []));
