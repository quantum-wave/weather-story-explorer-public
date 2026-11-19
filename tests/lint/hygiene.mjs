// Test-suite hygiene lint (TEST-0, AUDIT-TESTS section 2). Guards: Josh point 16 (a suite that is green off the cloud
// workspace and in the public mirror). Usage: node tests/lint/hygiene.mjs [<root>]   (root defaults to the repo)
// Flags, under <root>/tests (except tests/lint and tests/site/fixtures):
//   path        a literal /home/, /Users/ or /tmp path (cloud-only or machine-only; output goes under $WSE_ARTIFACTS)
//   vacuous     a negated grep on a file path with no earlier assertion that the file exists (`! grep -q x missing`
//               succeeds when the file is missing, so the check can never fail)
//   private     a read of a private-only doc that tools/export-public.sh does not export (the public mirror lacks it)
//   untracked   a read of site/data/ under the repo root (gitignored: absent in a clean clone and in CI)
// A line carrying `wse-lint: ok` (with a reason) is exempt: use it only for a guarded, explicit skip.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');
const J = (...p) => p.join('');
// Built from pieces so this file does not flag itself.
const PATH_RE = new RegExp(`(^|[^A-Za-z0-9_])(${J('/ho', 'me/')}|${J('/Us', 'ers/')}|${J('/t', 'mp')}(?![A-Za-z0-9_-]))`);
const PRIVATE_DOCS = ['GUIDE.md', 'WORKING.md', 'PARKED.md', 'DECISIONS.md', 'ACTIVITY.md', 'ARCHITECTURE.md', 'AGENTS.md', 'INDEX.md', 'docs/'];
const UNTRACKED_RE = /(root|ROOT|REPO|repo)\b[^\n]*site\/data/;
const SCAN_EXT = /\.(mjs|js|py|sh|json|yml|yaml)$/;

function walk(dir, skip, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (skip(p)) continue;
    if (e.isDirectory()) walk(p, skip, out); else if (SCAN_EXT.test(e.name)) out.push(p);
  }
  return out;
}

/** The names export-public.sh lets through (its ALLOW=( ... ) line), or null when the script is absent. */
export function exportAllow(root) {
  const f = path.join(root, 'tools', 'export-public.sh');
  if (!fs.existsSync(f)) return null;
  const m = fs.readFileSync(f, 'utf8').match(/^ALLOW=\(([^)]*)\)/m);
  return m ? m[1].trim().split(/\s+/) : null;
}

export function lintHygiene(root = REPO) {
  const tests = path.join(root, 'tests');
  const skip = (p) => p === path.join(tests, 'lint') || p === path.join(tests, 'site', 'fixtures') || p.includes(`${path.sep}__pycache__`) || p.includes(`${path.sep}node_modules`);
  const allow = exportAllow(root);
  const findings = [];
  for (const file of walk(tests, skip)) {
    const rel = path.relative(root, file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const isSh = file.endsWith('.sh');
    lines.forEach((line, i) => {
      if (/wse-lint:\s*ok/.test(line)) return;
      const at = (rule, msg) => findings.push({ file: rel, line: i + 1, rule, message: msg, text: line.trim().slice(0, 120) });
      const t = line.trim();
      if (t.startsWith('#') || t.startsWith('//')) return; // comment-only lines make no reads
      const code = /\.(py|sh)$/.test(file) ? line.replace(/\s#\s.*$/, '') : line; // a trailing comment is not a read
      if (PATH_RE.test(code)) at('path', 'absolute machine path literal; write under $WSE_ARTIFACTS');
      if (UNTRACKED_RE.test(code) && !/\$A\/|\$B\/|\$WORK/.test(line)) at('untracked', 'reads site/data/, which is gitignored (absent in a clean clone); assert it exists or skip explicitly');
      for (const d of PRIVATE_DOCS) {
        if (allow && allow.some((a) => d === a || d.startsWith(a + '/'))) continue;
        if (code.includes(d)) at('private', `reads ${d}, which is not exported to the public mirror`);
      }
      if (isSh) {
        const m = code.match(/^\s*!\s*grep\b[^|;&]*?\s(\S+)\s*(?:[;&|].*|$)/);
        if (m) {
          const target = m[1];
          const guarded = lines.slice(0, i + 1).some((l) => /(\[\s+-[fes]|test\s+-[fes])\s/.test(l) && l.includes(target));
          if (!guarded && !target.startsWith('-')) at('vacuous', `negated grep on ${target} passes when the file is missing; assert it exists first`);
        }
      }
    });
  }
  return findings;
}

/** Workflow guard: every job in a workflow file other than clim, data and pages needs the public-mirror repository guard. */
export const GUARD = "github.repository == 'quantum-wave/weather-story-explorer-public'";
export function lintWorkflows(root = REPO) {
  const dir = path.join(root, '.github', 'workflows');
  const findings = [];
  if (!fs.existsSync(dir)) return findings;
  for (const f of fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n)).sort()) {
    if (['clim', 'data', 'pages'].includes(f.replace(/\.ya?ml$/, ''))) continue;
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
    let inJobs = false, job = null;
    const jobs = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^jobs:\s*$/.test(l)) { inJobs = true; continue; }
      if (inJobs && /^\S/.test(l) && !/^#/.test(l)) inJobs = false;
      if (!inJobs) continue;
      const jm = l.match(/^  ([A-Za-z0-9_-]+):\s*$/);
      if (jm) { job = { name: jm[1], line: i + 1, guarded: false }; jobs.push(job); continue; }
      if (job && /^    if:/.test(l) && l.replace(/\s+/g, ' ').includes(GUARD)) job.guarded = true;
    }
    if (!jobs.length) findings.push({ file: `.github/workflows/${f}`, line: 1, rule: 'workflow-guard', message: 'no jobs found' });
    for (const j of jobs) if (!j.guarded) findings.push({ file: `.github/workflows/${f}`, line: j.line, rule: 'workflow-guard', message: `job "${j.name}" lacks \`if: ${GUARD}\`` });
  }
  return findings;
}

export function lintAll(root = REPO) { return [...lintHygiene(root), ...lintWorkflows(root)]; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || REPO);
  const f = lintAll(root);
  for (const x of f) console.log(`LINT ${x.rule} ${x.file}:${x.line} ${x.message}${x.text ? '  | ' + x.text : ''}`);
  console.log(f.length ? `LINT: ${f.length} finding(s)` : 'LINT: clean');
  process.exit(f.length ? 1 : 0);
}
