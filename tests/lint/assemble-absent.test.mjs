// W0-01 (Josh point 16, AUDIT-TESTS section 2): assemble.test.sh used `! grep file`, which passed when site/data/manifest.json
// was missing. It must now fail when the manifest is absent and the skip is not explicit, and say SKIPPED when it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { REPO } from './hygiene.mjs';
import { artifactPath } from '../site/lib/artifacts.mjs';

function run(extra) {
  const absent = artifactPath('lint', 'no-such-site-data', 'manifest.json'); // never created
  const env = { ...process.env, WSE_SITE_DATA_MANIFEST: absent, WSE_ARTIFACTS: artifactPath('lint', 'scripts-run') };
  delete env.WSE_SKIP_SITE_DATA;
  const r = spawnSync('bash', [path.join(REPO, 'tests/scripts/bootstrap.test.sh')], { env: { ...env, ...extra }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('site/data absent and not skipped: the shipped-data check FAILS', () => {
  const r = run({});
  assert.notEqual(r.code, 0);
  assert.match(r.out, /FAIL site\/data \(shipped by default\) is not synthetic: site\/data\/manifest\.json is absent/);
});

test('site/data absent and WSE_SKIP_SITE_DATA=1: the check says SKIPPED explicitly, nothing fails', () => {
  const r = run({ WSE_SKIP_SITE_DATA: '1' });
  assert.equal(r.code, 0, r.out.split('\n').filter((l) => l.startsWith('FAIL')).join('\n'));
  assert.match(r.out, /SKIPPED explicitly/);
});
