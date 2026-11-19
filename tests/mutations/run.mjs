// node tests/mutations/run.mjs [--only id,id] [--root repo] [--dir mutant-dir] [--scratch dir] [--keep] [--selftest]
// The mutation gate: applies each tests/mutations/M-*.json to a scratch copy under $WSE_ARTIFACTS/mutations/, runs the checks it
// names, and fails on any result that differs from `expect`, on a `find` that does not occur exactly once, and on a named check
// that does not pass on the unmutated code. Exit 0 only when every mutant behaved as recorded. Format: design spec section 15.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGate } from './lib/mutate.mjs';
import { artifactsDir } from '../site/lib/artifacts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

if (args.includes('--selftest')) {
  const { selftest } = await import('./lib/selftest.mjs');
  process.exit(await selftest());
}
const root = path.resolve(opt('--root') || path.join(here, '..', '..'));
const dir = path.resolve(opt('--dir') || path.join(root, 'tests', 'mutations'));
const scratch = path.resolve(opt('--scratch') || path.join(artifactsDir(), 'mutations'));
fs.mkdirSync(scratch, { recursive: true });
try {
  const r = await runGate({ root, dir, scratch, only: opt('--only')?.split(',').filter(Boolean), keep: args.includes('--keep') });
  fs.writeFileSync(path.join(scratch, 'report.json'), JSON.stringify({ root: path.basename(root), results: r.results.map(({ per, ...x }) => ({ ...x, per })), problems: r.problems }, null, 1));
  const n = (f) => r.results.filter(f).length;
  console.log(`MUTATIONS: ${r.results.length} mutants, ${n((x) => x.outcome === 'killed')} killed, ${n((x) => x.outcome === 'survived')} survived, ${n((x) => x.outcome === 'error')} error; ${n((x) => !x.ok) + r.problems.length} not as recorded`);
  console.log(r.ok ? 'MUTATIONS: passed' : 'MUTATIONS: FAILED');
  process.exit(r.ok ? 0 : 1);
} catch (e) {
  console.error('MUTATIONS: error', e?.stack || e);
  process.exit(2);
}
