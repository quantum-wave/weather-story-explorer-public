#!/usr/bin/env node
// Site test runner. Usage: node tests/site/run.mjs [--data <dir>] [--only ID[,ID...]]
// Serves site/ plus /data/ from --data (default the synthetic fixture), runs each tests/site/checks/*.mjs in
// headless Chrome, then node --test over tests/site/unit (skipped with --only). Exit 0 only if all pass.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer, DEFAULT_DATA } from './lib/server.mjs';
import { Browser, killAll } from './lib/cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const dataDir = path.resolve(opt('--data') || DEFAULT_DATA);
const only = opt('--only')?.split(',').map((s) => s.trim()).filter(Boolean);

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
  const files = fs.readdirSync(path.join(here, 'checks')).filter((f) => f.endsWith('.mjs')).sort();
  const checks = [];
  for (const f of files) checks.push(await import(pathToFileURL(path.join(here, 'checks', f)).href));
  const missing = (only || []).filter((id) => !checks.some((c) => c.id === id));
  if (missing.length) { console.error('unknown check id: ' + missing.join(', ')); return 2; }
  const selected = checks.filter((c) => !only || only.includes(c.id));

  server = await startServer({ dataDir });
  const baseUrl = server.baseUrl;
  let passed = 0, failed = 0;
  let shared = null;
  for (const c of selected) {
    let page, own = null, extra = null;
    try {
      // A check can name a fixture (`export const data = 'sample-min'`) to run against it whatever --data is.
      let cBase = baseUrl, cData = dataDir;
      if (c.data) {
        cData = path.join(here, 'fixtures', c.data);
        extra = await startServer({ dataDir: cData });
        cBase = extra.baseUrl;
      }
      const b = c.freshProfile || extra ? (own = await Browser.launch({ baseUrl: cBase })) : (shared ||= await Browser.launch({ baseUrl }));
      browsers.add(b);
      const newPage = () => b.newPage();
      page = await newPage();
      await withTimeout(Promise.resolve(c.run({ page, baseUrl: cBase, assert, newPage, dataDir: cData })), c.timeoutMs || 60000, c.id);
      console.log(`PASS ${c.id}`); passed++;
    } catch (e) {
      console.log(`FAIL ${c.id}: ${String(e.message || e).split('\n')[0]}`); failed++;
    } finally {
      if (page) await page.close();
      if (own) { await own.close(); browsers.delete(own); }
      if (extra) await extra.close().catch(() => {});
    }
  }
  console.log(`SITE: ${passed} passed, ${failed} failed`);
  let code = failed || !selected.length ? 1 : 0;

  if (!only) {
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
