// Make a live-like data folder from a fixture: the shape the pipeline publishes (sample:false, no `cases`, no per-field
// `case`, a recent run) over the same chunk files. `now` (epoch ms, default the real clock) picks the run: the latest 00Z or 12Z. The weather stays synthetic and the manifest still says so, so
// tools/assemble.sh refuses to publish it. Usage: node tests/site/lib/livelike.mjs [<dst> [<src>]]   (dst defaults to $WSE_ARTIFACTS/livelike/data)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactPath } from './artifacts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SYNTHETIC = path.join(here, '..', 'fixtures', 'synthetic');

export function makeLiveLike(dst, src = SYNTHETIC, { now: nowMs = Date.now() } = {}) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f));
  const mp = path.join(dst, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  const now = new Date(nowMs);
  const run = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Math.floor(now.getUTCHours() / 12) * 12));
  const iso = (d) => d.toISOString().slice(0, 16) + 'Z';
  m.sample = false;
  delete m.sample_note;
  delete m.cases;
  for (const f of Object.values(m.fields)) delete f.case;
  m.run = iso(run);
  m.generated = iso(new Date(run.getTime() + 9.5 * 3600e3));
  fs.writeFileSync(mp, JSON.stringify(m, null, 1));
  return dst;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(makeLiveLike(process.argv[2] ? path.resolve(process.argv[2]) : path.dirname(artifactPath('livelike', 'data', 'x')), process.argv[3] ? path.resolve(process.argv[3]) : undefined));
}
