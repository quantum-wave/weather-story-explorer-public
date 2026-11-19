#!/usr/bin/env node
// Site test runner. Usage: node tests/site/run.mjs [--data <dir>] [--only ID[,ID...]] [--tier deploy|full|network[,...]]
// Serves site/ plus /data/ from --data (default the synthetic fixture), runs each tests/site/checks/*.mjs in
// headless Chrome, then node --test over tests/site/unit (only when no --only and the tiers include `full`).
// A check exports `id`, optional `tier` ('deploy' | 'full' | 'network'; none means full) and optional `data`: one fixture
// name or an array of names (a server per fixture, one result line per fixture). Default tiers: deploy,full (network
// checks run nightly with --tier network; --no-unit skips the unit tests). --only names checks explicitly and ignores the tier. Exit 0 only if all pass.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer, DEFAULT_DATA } from './lib/server.mjs';
import { Browser, killAll } from './lib/cdp.mjs';

const TIERS = ['deploy', 'full', 'network'];
const tierOf = (c) => c.tier || 'full';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const dataDir = path.resolve(opt('--data') || DEFAULT_DATA);
const only = opt('--only')?.split(',').map((s) => s.trim()).filter(Boolean);
const tiers = (opt('--tier') ? opt('--tier').split(',').map((s) => s.trim()).filter(Boolean) : ['deploy', 'full']);
const badTier = tiers.filter((t) => !TIERS.includes(t));
if (badTier.length) { console.error(`unknown tier: ${badTier.join(', ')} (use ${TIERS.join(', ')})`); process.exit(2); }

let server = null; const browsers = new Set(); let unitChild = null;
async function cleanup() {
  for (const b of browsers) await b.close().catch(() => {});
  browsers.clear();
  killAll();
  if (unitChild && unitChild.exitCode === null) try { unitChild.kill('SIGKILL'); } catch {}
  if (server) { await server.close().catch(() => {}); server = null; }
}
let exiting = false;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { if (exiting) return; exiting = true; cleanup().finally(() => process.exit(130)); });
}
process.on('uncaughtException', (e) => { console.error('FATAL', e); cleanup().finally(() => process.exit(2)); });
process.on('unhandledRejection', (e) => { console.error('FATAL', e); cleanup().finally(() => process.exit(2)); });

function withTimeout(p, ms, label) {
  let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${ms} ms`)), ms); })]).finally(() => clearTimeout(t));
}

async function main() {
  if (!fs.existsSync(path.join(dataDir, 'manifest.json'))) { console.error(`no manifest.json in ${dataDir}`); return 2; }
  const checksDir = path.resolve(opt('--checks') || path.join(here, 'checks')); // --checks is for the runner's own tests
  const files = fs.readdirSync(checksDir).filter((f) => f.endsWith('.mjs')).sort();
  const checks = [];
  for (const f of files) checks.push(await import(pathToFileURL(path.join(checksDir, f)).href));
  const missing = (only || []).filter((id) => !checks.some((c) => c.id === id));
  if (missing.length) { console.error('unknown check id: ' + missing.join(', ')); return 2; }
  const bad = checks.filter((c) => c.tier && !TIERS.includes(c.tier));
  if (bad.length) { console.error('check with an unknown tier: ' + bad.map((c) => `${c.id}=${c.tier}`).join(', ')); return 2; }
  const selected = checks.filter((c) => (only ? only.includes(c.id) : tiers.includes(tierOf(c))));

  server = await startServer({ dataDir });
  const baseUrl = server.baseUrl;
  let passed = 0, failed = 0;
  let shared = null;
  for (const c of selected) {
    // A check can name fixtures (`export const data = 'sample-min'` or an array) to run against each whatever --data is.
    const fixtures = c.data ? [].concat(c.data) : [null];
    for (const fx of fixtures) {
      const label = fx && fixtures.length > 1 ? `${c.id} [${fx}]` : c.id;
      let page, own = null, extra = null;
      try {
        let cBase = baseUrl, cData = dataDir;
        if (fx) {
          cData = path.join(here, 'fixtures', fx);
          extra = await startServer({ dataDir: cData });
          cBase = extra.baseUrl;
        }
        const b = c.freshProfile || extra ? (own = await Browser.launch({ baseUrl: cBase })) : (shared ||= await Browser.launch({ baseUrl }));
        browsers.add(b);
        const newPage = () => b.newPage();
        page = await newPage();
        await withTimeout(Promise.resolve(c.run({ page, baseUrl: cBase, assert, newPage, dataDir: cData, fixture: fx })), c.timeoutMs || 60000, label);
        console.log(`PASS ${label}`); passed++;
      } catch (e) {
        console.log(`FAIL ${label}: ${String(e.message || e).split('\n')[0]}`); failed++;
      } finally {
        if (page) await page.close();
        if (own) { await own.close(); browsers.delete(own); }
        if (extra) await extra.close().catch(() => {});
      }
    }
  }
  console.log(`SITE: ${passed} passed, ${failed} failed (tiers ${only ? 'by --only' : tiers.join('+')})`);
  let code = failed || !selected.length ? 1 : 0;

  if (!only && tiers.includes('full') && !args.includes('--no-unit')) {
    const unitDir = path.join(here, 'unit');
    const unitFiles = fs.existsSync(unitDir) ? fs.readdirSync(unitDir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(unitDir, f)) : [];
    if (unitFiles.length) {
      const rc = await new Promise((resolve) => {
        unitChild = spawn(process.execPath, ['--test', ...unitFiles], { stdio: 'inherit', env: { ...process.env, WSE_DATA_DIR: dataDir } });
        unitChild.on('exit', (c) => resolve(c ?? 1));
        unitChild.on('error', () => resolve(1));
      });
      console.log(`UNIT: ${rc === 0 ? 'passed' : 'FAILED'} (${unitFiles.length} files)`);
      if (rc !== 0) code = 1;
    }
  }
  return code;
}

main().then(async (code) => { await cleanup(); process.exit(code); }, async (e) => { console.error(e); await cleanup(); process.exit(2); });
