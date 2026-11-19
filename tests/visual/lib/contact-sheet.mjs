// One self-contained contact-sheet.html: per stop and size, baseline | new | diff | reference, then the layout-assertion
// offenders with their boxes. Images are inlined as JPEG thumbnails (the full PNGs sit beside it under new/ and diff/).
// The sheet says which platform made it: CI sheets and Mac sheets are not comparable for type rendering.
import fs from 'node:fs';
import path from 'node:path';
import { thumbnail } from './diff.mjs';
import { ASSERTIONS, describeOffender } from './layout-assert.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function img(scratch, file, label, maxW) {
  if (!file || !fs.existsSync(file)) return `<div class="missing">${esc(label)}</div>`;
  const src = await thumbnail(scratch, fs.readFileSync(file), maxW);
  return `<img src="${src}" alt="${esc(label)}" loading="lazy">`;
}

export async function writeContactSheet({ frames, outDir, platform, scratch, opts }) {
  const stops = [...new Set(frames.map((f) => f.stop))];
  const rows = [];
  const summary = [];
  for (const sid of stops) {
    const fs0 = frames.filter((f) => f.stop === sid);
    const head = fs0[0];
    const cards = [];
    for (const f of fs0) {
      const maxW = f.viewport === 'phone' ? 300 : 520;
      const pxState = !f.baseline ? 'no baseline yet' : f.diff?.sizeMismatch ? `size differs (${esc(f.diff.note)})` : `${(f.diff.changedFraction * 100).toFixed(3)}% of cells changed (tolerance ${(f.diff.tolerance * 100).toFixed(2)}%)${f.diff.exceeds ? ' <b class="bad">over tolerance</b>' : ''}`;
      const off = f.layout.offenders;
      const status = f.error ? 'error' : off.length ? (f.gate ? 'fail' : 'known') : 'pass';
      summary.push({ sid, vp: f.viewport, name: f.name, status, n: off.length, fails: f.layout.failing });
      cards.push(`<article class="frame ${f.viewport}">
  <h3>${esc(f.viewport)}${esc(f.name ? ' · ' + f.name : ' · final')} <span class="pill ${status}">${status === 'known' ? 'known fail (gate off)' : status}</span>${f.stable === false ? ' <span class="pill known">screenshot never settled</span>' : ''}</h3>
  <div class="imgs">
    <figure><figcaption>baseline</figcaption>${f.baseline ? await img(scratch, f.baseline.path, 'baseline', maxW) : '<div class="missing">no baseline yet</div>'}</figure>
    <figure><figcaption>new</figcaption>${await img(scratch, f.newPath, 'new', maxW)}</figure>
    <figure><figcaption>diff</figcaption>${f.baseline && f.diff?.diffPng ? await img(scratch, path.join(outDir, 'diff', f.key + '.png'), 'diff', maxW) : '<div class="missing">no diff (no baseline)</div>'}</figure>
    <figure><figcaption>reference</figcaption>${f.referenceFile ? await img(scratch, f.referenceFile, 'reference', maxW) : '<div class="missing">no reference image</div>'}</figure>
  </div>
  <p class="meta">pixels: ${pxState}${opts.gatePixels ? '' : ' (reported, not gated: baselines are approved by Josh)'} ${f.layout.scopedTo ? ` · modal scope ${esc(f.layout.scopedTo)}` : ''} · text nodes ${f.layout.counts.text ?? "?"}, controls ${f.layout.counts.controls ?? '?'}</p>
  ${f.error ? `<p class="bad">stop failed to run: ${esc(f.error)}</p>` : ''}
  ${f.note ? `<p class="meta bad">${esc(f.note)}</p>` : ''}
  ${off.length ? `<details ${f.gate ? 'open' : ''}><summary>${off.length} layout offender(s): ${f.layout.failing.map((n) => `${n} ${ASSERTIONS[n]}`).join(', ')}</summary><ul>${off.slice(0, 60).map((o) => `<li><code>${esc(describeOffender(o))}</code></li>`).join('')}${off.length > 60 ? `<li>… ${off.length - 60} more in report.json</li>` : ''}</ul></details>` : '<p class="meta ok">layout assertions 1-5: no offenders</p>'}
  ${f.consoleErrors?.length ? `<p class="meta">console errors: ${esc(f.consoleErrors.slice(0, 3).join(' | '))}</p>` : ''}
</article>`);
    }
    rows.push(`<section id="${esc(sid)}"><h2>${esc(sid)} <small>owner ${esc(head.owner)} · gate ${head.gate ? 'ON' : 'off'}${head.gate ? '' : ' · MVP fails ' + (head.mvpFails.join(',') || 'none') + (head.mvpReason ? ' (' + esc(head.mvpReason) + ')' : '')}</small></h2><div class="cards">${cards.join('\n')}</div></section>`);
  }
  const tally = (s) => summary.filter((x) => x.status === s).length;
  const table = `<table><thead><tr><th>stop</th><th>size</th><th>layout</th><th>failing assertions</th></tr></thead><tbody>${summary.map((s) => `<tr><td><a href="#${esc(s.sid)}">${esc(s.sid)}${esc(s.name ? ' · ' + s.name : ' · final')}</a></td><td>${s.vp}</td><td><span class="pill ${s.status}">${s.status}</span></td><td>${s.fails.map((n) => `${n} ${ASSERTIONS[n]}`).join(', ') || '–'}</td></tr>`).join('')}</tbody></table>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Weather Story Explorer tour contact sheet</title>
<style>
:root{color-scheme:light dark;--bg:#f7f5f1;--fg:#1d2126;--mut:#5e6670;--card:#fff;--line:#d9d5cc;--bad:#b3261e;--ok:#1b7a3d;--warn:#8a5a00}
@media (prefers-color-scheme:dark){:root{--bg:#0f1317;--fg:#e6e9ed;--mut:#9aa4af;--card:#161c22;--line:#2a323a;--bad:#ff8a80;--ok:#6fd08c;--warn:#f0b429}}
body{margin:0;padding:24px 20px 64px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
h1{margin:0 0 4px;font-size:22px}h2{margin:32px 0 12px;font-size:17px}h2 small{font-weight:400;color:var(--mut);font-size:13px;margin-left:8px}
h3{margin:0 0 8px;font-size:14px}.sub{color:var(--mut);margin:0 0 16px}
.cards{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
.frame{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;max-width:100%}
.imgs{display:flex;gap:10px;flex-wrap:wrap}figure{margin:0}figcaption{font-size:12px;color:var(--mut);margin-bottom:4px}
.imgs img{display:block;border:1px solid var(--line);border-radius:4px;max-width:100%;height:auto}
.missing{display:grid;place-items:center;min-height:90px;min-width:140px;padding:8px;border:1px dashed var(--line);border-radius:4px;color:var(--mut);font-size:12px;text-align:center}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;font-weight:600;border:1px solid currentColor}
.pill.pass{color:var(--ok)}.pill.fail,.pill.error{color:var(--bad)}.pill.known{color:var(--warn)}
.bad{color:var(--bad)}.ok{color:var(--ok)}.meta{margin:6px 0 0;color:var(--mut);font-size:12px}
code{font:12px/1.4 ui-monospace,Menlo,monospace;word-break:break-word}
table{border-collapse:collapse;margin:8px 0}td,th{padding:3px 12px 3px 0;text-align:left;border-bottom:1px solid var(--line);font-size:13px}
details ul{margin:6px 0 0;padding-left:18px}
</style></head><body>
<h1>Tour contact sheet</h1>
<p class="sub">Platform: <b>${esc(platform)}</b>. Judge type rendering on the Mac sheet only; a CI sheet is labelled by its platform and differs in fonts. Pixel diffs are reported, ${opts.gatePixels ? 'and gated in this run' : 'not gated, until Josh approves baselines'}. Baselines: <code>${esc(path.basename(path.dirname(opts.baselineDir)))}/${esc(path.basename(opts.baselineDir))}</code>.</p>
<p class="sub">${stops.length} stops, ${summary.length} frames: ${tally('pass')} pass, ${tally('known')} known fail (gate off), ${tally('fail')} gated fail, ${tally('error')} error. Generated ${new Date().toISOString()}.</p>
${table}
${rows.join('\n')}
</body></html>`;
  const file = path.join(outDir, 'contact-sheet.html');
  fs.writeFileSync(file, html);
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ platform, frames: frames.map((f) => ({ stop: f.stop, owner: f.owner, gate: f.gate, viewport: f.viewport, name: f.name, error: f.error, stable: f.stable, note: f.note || '', failing: f.layout.failing, offenders: f.layout.offenders, counts: f.layout.counts, diff: f.diff && { exceeds: f.diff.exceeds, changedFraction: f.diff.changedFraction, tolerance: f.diff.tolerance, note: f.diff.note }, baseline: !!f.baseline })) }, null, 1));
  return file;
}
