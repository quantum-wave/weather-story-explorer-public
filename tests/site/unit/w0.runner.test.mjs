// W0-01 (Josh point 16, spec 14.1-7): the runner's tiers and per-fixture results, and the workflow wiring. The fake checks live in
// runner-fixtures/checks and are selected with --checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = new URL('../../../', import.meta.url).pathname;
const runner = new URL('../run.mjs', import.meta.url).pathname;
const checks = new URL('./runner-fixtures/checks', import.meta.url).pathname;
const run = (args, env = {}) => {
  const r = spawnSync(process.execPath, [runner, '--checks', checks, '--no-unit', ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout + r.stderr };
};

test('default tiers are deploy and full: the network check does not run; no tier means full', () => {
  const r = run([]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /PASS T-DEPLOY/); assert.match(r.out, /PASS T-FULL/); assert.doesNotMatch(r.out, /T-NET/);
});
test('--tier deploy runs only deploy checks', () => {
  const r = run(['--tier', 'deploy']);
  assert.match(r.out, /PASS T-DEPLOY/); assert.doesNotMatch(r.out, /T-FULL|T-NET/);
});
test('--tier network runs only network checks', () => {
  const r = run(['--tier', 'network']);
  assert.match(r.out, /PASS T-NET/); assert.doesNotMatch(r.out, /T-DEPLOY|T-FULL/);
});
test('an unknown tier is refused', () => { const r = run(['--tier', 'sometimes']); assert.equal(r.code, 2); assert.match(r.out, /unknown tier/); });
test('data as an array: one server and one result line per fixture', () => {
  const r = run(['--only', 'T-MULTI']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /PASS T-MULTI \[synthetic\]/); assert.match(r.out, /PASS T-MULTI \[sample-min\]/);
});
test('a failure in one fixture is reported against that fixture and fails the run', () => {
  const r = run(['--only', 'T-MULTI'], { T_MULTI_FAIL: '1' });
  assert.equal(r.code, 1);
  assert.match(r.out, /PASS T-MULTI \[synthetic\]/); assert.match(r.out, /FAIL T-MULTI \[sample-min\]: sample-min is the failing fixture/);
});
test('the five honesty checks carry tier deploy', async () => {
  for (const id of ['S-BOOT', 'S-DECODE', 'S-HONEST', 'S-STORY', 'S-RENDER']) {
    assert.match(fs.readFileSync(`${root}tests/site/checks/${id}.mjs`, 'utf8'), /^export const tier = 'deploy'/m, id);
  }
});
test('pages.yml installs the pinned browser, uses Node 24 and runs --tier deploy; test.yml pins Playwright and Node 24', () => {
  const pages = fs.readFileSync(`${root}.github/workflows/pages.yml`, 'utf8');
  assert.match(pages, /ci-install-browser\.sh \d+\.\d+\.\d+/); assert.match(pages, /node-version: "24"/); assert.match(pages, /run\.mjs --data data\/latest --tier deploy/);
  const t = fs.readFileSync(`${root}.github/workflows/test.yml`, 'utf8');
  assert.match(t, /PLAYWRIGHT_VERSION: "\d+\.\d+\.\d+"/); assert.match(t, /ci-install-browser\.sh "\$\{PLAYWRIGHT_VERSION\}"/);
  const inst = fs.readFileSync(`${root}tools/ci-install-browser.sh`, 'utf8');
  assert.match(inst, /playwright@\$v" install chromium-headless-shell/); assert.match(inst, /CHROME_BIN=\$shell" >> "\$GITHUB_ENV"/); assert.match(t, /node-version: "24"/); assert.match(t, /upload-artifact/);
});
