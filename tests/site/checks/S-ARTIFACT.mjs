// S-ARTIFACT (TEST-12, W4-09): the artifact build, offline. Assembles with `tools/assemble.sh --artifact`, serves the output,
// answers every cdn.jsdelivr.net request from the vendored copy of the same npm package and version (CDP Fetch.fulfillRequest),
// and fails on any other external request, any blocked or failed request, any console error and any download attempt. Opens
// index.html, and how.html when the build has one. The real CDN is compared nightly by S-ARTIFACT-NET (network tier).
// Known-positive (run every time): a script tag at an unvendored CDN package in a copy of the build must fail the audit.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer, REPO } from '../lib/server.mjs';
import { artifactPath, artifactsDir } from '../lib/artifacts.mjs';

export const id = 'S-ARTIFACT';
export const tier = 'full';
export const timeoutMs = 180000;
export const freshProfile = true;

const CDN = 'https://cdn.jsdelivr.net/npm/';
/** CDN path under /npm/ -> file under site/vendor/. The same table assemble.sh rewrites to (tools/assemble.sh, --artifact). */
export const VENDORED = {
  'd3@7.9.2/dist/d3.min.js': 'd3@7.9.2/d3.min.js',
  'topojson-client@3.1.0/dist/topojson-client.min.js': 'topojson-client@3.1.0/topojson-client.min.js',
  'gifenc@1.0.3/dist/gifenc.esm.js': 'gifenc@1.0.3/gifenc.esm.js',
  'fflate@0.8.3/esm/browser.js': 'fflate@0.8.3/browser.js',
};
const MIME = { '.js': 'text/javascript; charset=utf-8' };

/** The vendored file that answers a CDN URL, or null when the URL is not a vendored package file. */
export function vendoredFile(url) {
  if (!url.startsWith(CDN)) return null;
  const rel = VENDORED[url.slice(CDN.length).split(/[?#]/)[0]];
  return rel ? path.join(REPO, 'site', 'vendor', rel) : null;
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p); else yield p;
  }
}
const TEXT = /\.(html|js|mjs|css)$/;

/** Assemble the artifact build into `dist` (cleared first). Throws with the script's output when it fails. */
export function assemble(dist) {
  fs.rmSync(dist, { recursive: true, force: true });
  const r = spawnSync('bash', [path.join(REPO, 'tools', 'assemble.sh'), dist, '--artifact'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`assemble.sh --artifact failed (${r.status}): ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' | ')}`);
  return dist;
}

/** Static pass over the build: every CDN URL is a vendored package file, no external script or stylesheet, no vendor/ path left. */
export function scanBuild(dist) {
  const problems = [];
  for (const f of walk(dist)) {
    if (!TEXT.test(f)) continue;
    const rel = path.relative(dist, f), text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/https:\/\/cdn\.jsdelivr\.net\/[^\s'"`)<>]+/g)) if (!vendoredFile(m[0])) problems.push(`${rel}: CDN file with no vendored copy: ${m[0]}`);
    if (f.endsWith('.html')) {
      for (const m of text.matchAll(/<(script|link)\b[^>]*\b(?:src|href)="((?:https?:)?\/\/[^"]+)"/gi)) if (!vendoredFile(m[2])) problems.push(`${rel}: external <${m[1]}> not served from a vendored package: ${m[2]}`);
      if (/(?:src|href)="vendor\//.test(text)) problems.push(`${rel}: points at vendor/, which the artifact build leaves out`);
    }
    if (/\.m?js$/.test(f) && /['"`]\.\.?\/vendor\//.test(text)) problems.push(`${rel}: imports from vendor/, which the artifact build leaves out`);
  }
  return problems;
}

/** Open one page of the build with the CDN answered from the vendored files; return what the page did. */
async function openPage({ newPage, baseUrl, pathName, ready }) {
  const page = await newPage();
  page.baseUrl = baseUrl;
  try {
    page.route((url) => {
      const f = vendoredFile(url);
      return f ? { body: fs.readFileSync(f), contentType: MIME[path.extname(f)] } : null;
    });
    await page.denyDownloads();
    await page.watchNetwork();
    await page.goto(baseUrl + pathName);
    if (ready) await page.waitFor(ready, { timeout: 25000 });
    await new Promise((r) => setTimeout(r, 300)); // late requests and errors
    return {
      errors: page.errors().map((e) => e.text), external: [...page.externalRequests], fulfilled: [...page.fulfilled],
      downloads: [...page.downloads], failed: page.failedLoads.filter((f) => !page.externalRequests.includes(f.url)).map((f) => `${f.url} ${f.reason}`),
      probe: ready ? await page.eval(`({ d3: typeof d3 !== 'undefined' && typeof d3.contours, topo: typeof topojson !== 'undefined' && typeof topojson.feature, downloadLinks: document.querySelectorAll('a[download]').length })`) : null,
    };
  } finally { await page.close(); }
}

/** Full audit of an assembled build. Throws on the first group of problems; returns a summary line otherwise. */
export async function auditArtifact({ dist, newPage }) {
  const scan = scanBuild(dist);
  if (scan.length) throw new Error('artifact build: ' + scan.join('; '));
  const server = await startServer({ siteDir: dist, dataDir: path.join(dist, 'data') });
  try {
    const idx = await openPage({ newPage, baseUrl: server.baseUrl, pathName: '', ready: 'window.__wse && window.__wse.ready === true && window.__wse.storyReady === true' });
    const bad = [];
    if (idx.external.length) bad.push(`external requests: ${idx.external.join(', ')}`);
    if (idx.failed.length) bad.push(`failed requests: ${idx.failed.join(', ')}`);
    if (idx.downloads.length) bad.push(`download attempts: ${idx.downloads.join(', ')}`);
    if (idx.probe.downloadLinks) bad.push(`${idx.probe.downloadLinks} <a download> in index.html`);
    if (idx.errors.length) bad.push(`console errors: ${idx.errors.join(' | ')}`);
    if (idx.probe.d3 !== 'function' || idx.probe.topo !== 'function') bad.push(`libraries not loaded from the CDN copies (d3.contours ${idx.probe.d3}, topojson.feature ${idx.probe.topo})`);
    const want = Object.keys(VENDORED).map((k) => CDN + k), missing = want.filter((u) => !idx.fulfilled.includes(u));
    if (missing.length) bad.push(`the page never requested: ${missing.join(', ')}`);
    if (bad.length) throw new Error('index.html: ' + bad.join('; '));
    let how = 'how.html absent from the build (W4-02 not merged)';
    if (fs.existsSync(path.join(dist, 'how.html'))) {
      const h = await openPage({ newPage, baseUrl: server.baseUrl, pathName: 'how.html', ready: `document.readyState === 'complete'` });
      const hb = [...h.external.map((u) => `external ${u}`), ...h.failed.map((u) => `failed ${u}`), ...h.downloads.map((u) => `download ${u}`), ...h.errors.map((u) => `error ${u}`)];
      if (hb.length) throw new Error('how.html: ' + hb.join('; '));
      how = `how.html opened clean (${h.fulfilled.length} CDN files answered)`;
    }
    return `index.html opened clean, ${idx.fulfilled.length} CDN files answered from site/vendor/; ${how}`;
  } finally { await server.close().catch(() => {}); }
}

export async function run({ page, assert, newPage }) {
  const dist = assemble(artifactPath('S-ARTIFACT', 'dist'));
  console.log('  ' + await auditArtifact({ dist, newPage }));
  // known-positive: a script tag at a CDN package with no vendored copy must fail the audit
  const mut = path.join(artifactsDir(), 'S-ARTIFACT', 'dist-unvendored');
  fs.rmSync(mut, { recursive: true, force: true });
  fs.cpSync(dist, mut, { recursive: true });
  const f = path.join(mut, 'index.html');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('</head>', `<script src="${CDN}lodash@4.17.21/lodash.min.js"></script></head>`));
  let caught = null;
  try { await auditArtifact({ dist: mut, newPage }); } catch (e) { caught = e; }
  fs.rmSync(mut, { recursive: true, force: true });
  assert.ok(caught && /lodash/.test(caught.message), 'an unvendored CDN script must fail S-ARTIFACT, got: ' + (caught ? caught.message : 'a pass'));
  // and the runtime half alone (no static scan): the same tag injected only at run time is a blocked external request
  const page2 = await newPage();
  const server = await startServer({ siteDir: dist, dataDir: path.join(dist, 'data') });
  try {
    page2.baseUrl = server.baseUrl;
    page2.route((url) => { const v = vendoredFile(url); return v ? { body: fs.readFileSync(v), contentType: MIME['.js'] } : null; });
    await page2.watchNetwork();
    await page2.goto(server.baseUrl);
    await page2.eval(`new Promise((res) => { const s = document.createElement('script'); s.src = ${JSON.stringify(CDN + 'lodash@4.17.21/lodash.min.js')}; s.onload = s.onerror = res; document.head.appendChild(s); })`);
    assert.ok(page2.externalRequests.some((u) => u.includes('lodash')), 'a runtime script at an unvendored package is recorded as an external request');
  } finally { await page2.close(); await server.close().catch(() => {}); }
  // a download attempt is caught (the artifact sandbox blocks them; the build must never start one)
  const page3 = await newPage();
  const server3 = await startServer({ siteDir: dist, dataDir: path.join(dist, 'data') });
  try {
    page3.baseUrl = server3.baseUrl;
    await page3.denyDownloads();
    await page3.goto(server3.baseUrl);
    await page3.eval(`(() => { const a = document.createElement('a'); a.href = 'config.json'; a.download = 'x.json'; document.body.appendChild(a); a.click(); })()`);
    await page3.waitFor('true'); await new Promise((r) => setTimeout(r, 400));
    assert.ok(page3.downloads.length > 0, 'an injected <a download> click is recorded in page.downloads');
  } finally { await page3.close(); await server3.close().catch(() => {}); }
}
