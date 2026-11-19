// Where test output goes. Everything a test writes (screenshots, sandboxes, scratch copies, browser profiles) lives under
// $WSE_ARTIFACTS (default <repo>/out/test-artifacts, git-ignored by `out/`), never /tmp or an absolute machine path.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function artifactsDir() {
  const d = path.resolve(process.env.WSE_ARTIFACTS || path.join(REPO, 'out', 'test-artifacts'));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
/** A path under the artifacts folder (parent folders created): artifactPath('S-PINS', 'phone.png'). */
export function artifactPath(...parts) {
  const p = path.join(artifactsDir(), ...parts);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}
/** A fresh unique folder under the artifacts folder. */
export function artifactTmp(prefix = 'tmp-') {
  return fs.mkdtempSync(path.join(artifactsDir(), prefix));
}
