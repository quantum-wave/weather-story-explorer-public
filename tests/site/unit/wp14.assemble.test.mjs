// W4-02: assemble.sh --artifact rewrites the library script tags of every *.html, and how.html is a complete document.
// A file of its own: it needs the repo's tools/ folder, which the mutation gate's scratch copy of site and tests does not have.
import test from 'node:test';
import assert from 'node:assert/strict';

test('assemble.sh --artifact rewrites the library script tags of every *.html, and how.html is a complete document', async () => {
  const { spawnSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = new URL('../../../', import.meta.url).pathname;
  const out = path.join(process.env.WSE_ARTIFACTS || path.join(root, 'out', 'test-artifacts'), 'assemble-explain');
  fs.rmSync(out, { recursive: true, force: true });
  const r = spawnSync('bash', [path.join(root, 'tools/assemble.sh'), out, '--artifact'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const pages = fs.readdirSync(out).filter((f) => f.endsWith('.html')).sort();
  assert.deepEqual(pages, ['how.html', 'index.html']);
  for (const p of pages) {
    const html = fs.readFileSync(path.join(out, p), 'utf8');
    assert.ok(!/src="vendor\//.test(html), `${p}: no vendored script tag is left`);
    assert.match(html, /src="https:\/\/cdn\.jsdelivr\.net\/npm\/d3@7\.9\.2\/dist\/d3\.min\.js"/, `${p}: d3 from the CDN`);
    assert.match(html, /src="https:\/\/cdn\.jsdelivr\.net\/npm\/topojson-client@3\.1\.0\/dist\/topojson-client\.min\.js"/, `${p}: topojson from the CDN`);
  }
  const how = fs.readFileSync(path.join(out, 'how.html'), 'utf8');
  assert.match(how, /^<!doctype html>/i);
  assert.match(how, /<meta charset="utf-8">/);
  assert.match(how, /<meta name="viewport"/);
  assert.match(how, /<title>[^<]+<\/title>/);
  assert.ok(!/(src|href)="\/(?!\/)/.test(how) && !/(src|href)="https?:\/\/(?!cdn\.jsdelivr\.net\/npm\/)/.test(how), 'relative paths only (but the allowed CDN)');
  fs.rmSync(out, { recursive: true, force: true });
});
