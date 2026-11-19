// The `synthetic` test fixture is test-only: it must not be in site/, and the data a user is served must be real.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../../../', import.meta.url).pathname;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test('site/ carries no synthetic fixture', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'site/data/manifest.json'), 'utf8'));
  assert.ok(!/synthetic/i.test(JSON.stringify(m)), 'site/data manifest must not mention synthetic data');
  for (const [id, f] of Object.entries(m.fields)) {
    assert.ok(Array.isArray(f.source?.valid) || m.sample === false, `${id}: a sample field carries real valid times`);
    assert.ok(!/synthetic/i.test(f.source?.dataset || ''), `${id}: dataset is real`);
  }
  for (const f of walk(path.join(root, 'site')).filter((p) => /\.(js|html|json|css)$/.test(p) && !p.includes('/vendor/') && !p.includes('/geo/'))) {
    if (f.endsWith('data/manifest.json')) continue;
    const text = fs.readFileSync(f, 'utf8');
    assert.ok(!/tests\/site\/fixtures|fixtures\/synthetic/.test(text), `${f} must not point at test fixtures`);
  }
});

test('sample dates in the shipped manifest are real past dates, not rebased to the build day', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'site/data/manifest.json'), 'utf8'));
  for (const [id, f] of Object.entries(m.fields)) {
    const first = Date.parse(f.source.valid[0]);
    assert.ok(first < Date.parse(m.run) - 365 * 86400e3, `${id}: first valid ${f.source.valid[0]} is far before the rebased run ${m.run}`);
  }
});
