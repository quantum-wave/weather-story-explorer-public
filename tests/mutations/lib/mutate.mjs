// Mutation gate library (design spec 14.1 rule 2, section 15; TEST-13). A mutant is a literal find/replace on one file. The runner
// applies it to a scratch copy of the repo, runs the checks the mutant names, and compares the outcome with `expect`.
// It cannot pass vacuously:
//   - `find` must occur exactly once (zero means the target was rewritten and the mutant rotted; two means it is ambiguous);
//   - every named check must PASS on the unmutated code first, else a "kill" proves nothing; the control runs in an unmutated scratch
//     copy built exactly like a mutant's (never in the real repo), so a check that needs something the copy lacks fails the control
//     and is reported as an error rather than counted as a kill;
//   - a check that did not run (crash, unknown id, timeout) is an error, never a kill;
//   - a result that differs from `expect` fails, in both directions (a known-survivor that dies must be promoted to killed).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const EXPECTS = ['killed', 'known-survivor'];
export const COPY_DIRS = ['site', 'tests'];

/** Read and validate every M-*.json in dir. Returns { mutants, problems }. */
export function loadMutants(dir, only) {
  const problems = [], mutants = [];
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^M-.*\.json$/.test(f)).sort() : [];
  for (const f of files) {
    let m;
    try { m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { problems.push(`${f}: not valid JSON (${e.message})`); continue; }
    const bad = [];
    for (const k of ['id', 'file', 'find', 'replace']) if (typeof m[k] !== 'string' || (k !== 'replace' && !m[k])) bad.push(`"${k}" must be a${k === 'replace' ? '' : ' non-empty'} string`);
    if (!Array.isArray(m.checks) || !m.checks.length || m.checks.some((c) => typeof c !== 'string')) bad.push('"checks" must be a non-empty array of "S-…" or "unit:<file>"');
    if (!EXPECTS.includes(m.expect)) bad.push(`"expect" must be one of ${EXPECTS.join(', ')}`);
    if (m.expect === 'known-survivor' && !(typeof m.note === 'string' && m.note.trim())) bad.push('a known-survivor needs a "note" naming the audit reference');
    if (typeof m.find === 'string' && m.find === m.replace) bad.push('"find" and "replace" are identical: not a mutation');
    if (m.id && m.id !== f.replace(/^M-|\.json$/g, '') && `M-${m.id}` !== f.replace(/\.json$/, '') && m.id !== f.replace(/\.json$/, '')) bad.push(`id "${m.id}" does not match the file name ${f}`);
    if (bad.length) { problems.push(`${f}: ${bad.join('; ')}`); continue; }
    mutants.push({ ...m, _file: f });
  }
  if (only?.length) {
    const missing = only.filter((o) => !mutants.some((m) => m.id === o));
    if (missing.length) problems.push(`unknown mutant id: ${missing.join(', ')}`);
    return { mutants: mutants.filter((m) => only.includes(m.id)), problems };
  }
  return { mutants, problems };
}

/** How many times `find` occurs in `text` (non-overlapping, literal). */
export function occurrences(text, find) {
  let n = 0;
  for (let i = text.indexOf(find); i !== -1; i = text.indexOf(find, i + find.length)) n++;
  return n;
}

/** Copy the parts of the repo the checks need into `dest` (site, tests; never out/ or node_modules). */
export function copyRepo(root, dest, dirs = COPY_DIRS) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const d of dirs) {
    const src = path.join(root, d);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src, path.join(dest, d), { recursive: true, filter: (p) => !/(^|[\\/])(out|node_modules|\.git)([\\/]|$)/.test(path.relative(root, p)) });
  }
}

/** Apply a mutant to `scratchRoot`. Returns { ok, error }. The file must sit under one of the copied dirs. */
export function applyMutant(root, scratchRoot, m, dirs = COPY_DIRS) {
  const rel = path.normalize(m.file);
  if (path.isAbsolute(rel) || rel.startsWith('..') || !dirs.some((d) => rel === d || rel.startsWith(d + path.sep))) return { ok: false, error: `file "${m.file}" is not under ${dirs.join(' or ')}` };
  const real = path.join(root, rel);
  if (!fs.existsSync(real)) return { ok: false, error: `file "${m.file}" does not exist` };
  const text = fs.readFileSync(real, 'utf8');
  const n = occurrences(text, m.find);
  if (n !== 1) return { ok: false, error: n === 0 ? `find does not occur in ${m.file} (the target was rewritten: re-target this mutant)` : `find occurs ${n} times in ${m.file}; it must occur exactly once` };
  fs.writeFileSync(path.join(scratchRoot, rel), text.replace(m.find, () => m.replace));
  return { ok: true, error: '' };
}

/** Describe a check spec as a command, or null when the spec is not understood. */
export function checkCommand(spec, cwd) {
  if (/^S-[A-Za-z0-9_-]+$/.test(spec)) return { kind: 'site', id: spec, args: [path.join('tests', 'site', 'run.mjs'), '--only', spec] };
  const m = spec.match(/^unit:(.+)$/);
  if (m) {
    const f = m[1].includes('/') ? m[1] : path.join('tests', 'site', 'unit', m[1]);
    return fs.existsSync(path.join(cwd, f)) ? { kind: 'unit', id: spec, args: ['--test', f] } : { kind: 'missing', id: spec, error: `unit file ${f} not found` };
  }
  return null;
}

/** Run one check in `cwd`. Returns { status: 'pass' | 'fail' | 'error', detail }. */
export async function runCheck(spec, cwd, env, timeoutMs = 240000) {
  const cmd = checkCommand(spec, cwd);
  if (!cmd) return { status: 'error', detail: `unknown check "${spec}" (use S-<ID> or unit:<file>)` };
  if (cmd.kind === 'missing') return { status: 'error', detail: cmd.error };
  const { code, out, timedOut } = await new Promise((resolve) => {
    const child = spawn(process.execPath, cmd.args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    child.stdout.on('data', (d) => { buf += d; }); child.stderr.on('data', (d) => { buf += d; });
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGTERM'); } catch {} setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 4000); }, timeoutMs);
    child.on('exit', (c) => { clearTimeout(t); resolve({ code: c, out: buf, timedOut }); });
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: String(e), timedOut }); });
  });
  const tail = out.trim().split('\n').slice(-6).join(' | ').slice(0, 400);
  if (timedOut) return { status: 'error', detail: `timed out after ${timeoutMs} ms` };
  if (cmd.kind === 'site') {
    if (code === 0 && new RegExp(`^PASS ${cmd.id}\\b`, 'm').test(out)) return { status: 'pass', detail: '' };
    if (code === 1 && new RegExp(`^FAIL ${cmd.id}\\b`, 'm').test(out)) return { status: 'fail', detail: (out.match(new RegExp(`^FAIL ${cmd.id}.*$`, 'm')) || [''])[0].slice(0, 300) };
    return { status: 'error', detail: `the check did not report PASS or FAIL for ${cmd.id} (exit ${code}): ${tail}` };
  }
  if (code === 0) return { status: 'pass', detail: '' };
  if (code === 1) return { status: 'fail', detail: tail };
  return { status: 'error', detail: `exit ${code}: ${tail}` };
}

/** Run the whole gate. opts: { root, dir, only, scratch, env, timeoutMs, log, keep }. Returns { ok, results, problems }. */
export async function runGate(opts) {
  const log = opts.log || ((m) => console.log(m));
  const { mutants, problems } = loadMutants(opts.dir, opts.only);
  const results = [];
  if (!mutants.length && !problems.length) problems.push(`no mutants (M-*.json) in ${opts.dir}`);
  const pristine = new Map(); // spec -> { status, detail }
  let control = null; // the unmutated scratch copy the control runs in: same copy, same folders, same cwd shape as a mutant's
  const controlDir = () => { if (!control) { control = path.join(opts.scratch, 'work', '_pristine'); copyRepo(opts.root, control); } return control; };
  const env = (sub) => ({ ...(opts.env || {}), WSE_ARTIFACTS: path.join(opts.scratch, sub) });
  for (const m of mutants) {
    const r = { id: m.id, expect: m.expect, checks: m.checks, outcome: '', ok: false, detail: '', per: {} };
    results.push(r);
    // 1. the mutation must apply exactly once
    const sd = path.join(opts.scratch, 'work', m.id);
    copyRepo(opts.root, sd);
    const ap = applyMutant(opts.root, sd, m);
    if (!ap.ok) { r.outcome = 'error'; r.detail = ap.error; fs.rmSync(sd, { recursive: true, force: true }); continue; }
    // 2. every named check must pass on the unmutated code
    let pristineBad = '';
    for (const c of m.checks) {
      if (!pristine.has(c)) pristine.set(c, await runCheck(c, controlDir(), env('pristine'), opts.timeoutMs));
      const p = pristine.get(c);
      if (p.status !== 'pass') pristineBad = `check ${c} does not pass on the unmutated code in a scratch copy of ${COPY_DIRS.join(' + ')} (${p.status}: ${p.detail}), so its result on the mutant proves nothing`;
    }
    if (pristineBad) { r.outcome = 'error'; r.detail = pristineBad; fs.rmSync(sd, { recursive: true, force: true }); continue; }
    // 3. run them on the mutant
    for (const c of m.checks) r.per[c] = await runCheck(c, sd, env(path.join('mutant', m.id)), opts.timeoutMs);
    const st = Object.values(r.per).map((x) => x.status);
    r.outcome = st.includes('error') ? 'error' : st.includes('fail') ? 'killed' : 'survived';
    const killedBy = Object.entries(r.per).filter(([, x]) => x.status === 'fail').map(([c]) => c);
    if (r.outcome === 'error') r.detail = Object.entries(r.per).filter(([, x]) => x.status === 'error').map(([c, x]) => `${c}: ${x.detail}`).join('; ');
    else if (m.expect === 'killed') { r.ok = r.outcome === 'killed'; r.detail = r.ok ? `killed by ${killedBy.join(', ')}` : `expected killed but it SURVIVED: ${m.checks.join(', ')} all passed with the mutation applied`; }
    else { r.ok = r.outcome === 'survived'; r.detail = r.ok ? `known survivor (${m.note})` : `recorded known-survivor but it was KILLED by ${killedBy.join(', ')}: promote it to expect "killed"`; }
    if (!opts.keep) fs.rmSync(sd, { recursive: true, force: true });
  }
  if (control && !opts.keep) fs.rmSync(control, { recursive: true, force: true });
  for (const r of results) log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.id} [${r.expect}] ${r.outcome}: ${r.detail}`);
  for (const p of problems) log(`FAIL ${p}`);
  return { ok: results.every((r) => r.ok) && !problems.length, results, problems };
}
