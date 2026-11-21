// S-ARTIFACT-NET (TEST-12, W4-09), network tier (nightly: --tier network). The artifact build loads d3, topojson-client, gifenc and fflate
// from cdn.jsdelivr.net; S-ARTIFACT answers those from the vendored copies. This check fetches the real CDN files and compares each
// sha256 with the vendored file it stands in for, so a vendored copy that drifts from what the artifact host really serves fails here.
// A CDN that cannot be reached is a failure of this check, stated as such (the tier exists to need the network).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { VENDORED, vendoredFile } from './S-ARTIFACT.mjs';

export const id = 'S-ARTIFACT-NET';
export const tier = 'network';
export const timeoutMs = 120000;

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const CDN = 'https://cdn.jsdelivr.net/npm/';

/** Compare each CDN file (fetched with `get(url) -> Buffer`) with its vendored copy. Returns { ok: [...], bad: [...] } lines. */
export async function compareWithCdn(get = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': 'wse-artifact-check' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}) {
  const ok = [], bad = [];
  for (const key of Object.keys(VENDORED)) {
    const url = CDN + key, file = vendoredFile(url);
    try {
      const local = sha(fs.readFileSync(file)), remote = sha(await get(url));
      (local === remote ? ok : bad).push(local === remote ? `${key} ${local.slice(0, 12)}` : `${key}: vendored ${local.slice(0, 12)} but the CDN serves ${remote.slice(0, 12)}`);
    } catch (e) { bad.push(`${key}: could not fetch ${url}: ${e.message}`); }
  }
  return { ok, bad };
}

export async function run({ assert }) {
  const { ok, bad } = await compareWithCdn();
  for (const l of ok) console.log('  identical ' + l);
  assert.deepEqual(bad, [], 'vendored copies differ from the CDN: ' + bad.join('; '));
  // known positive: a one-byte difference is reported
  const flipped = await compareWithCdn(async (url) => { const b = fs.readFileSync(vendoredFile(url)); return Buffer.concat([b, Buffer.from('\n')]); });
  assert.equal(flipped.bad.length, Object.keys(VENDORED).length, 'a CDN file that differs by one byte from the vendored copy must be reported for every package');
}
