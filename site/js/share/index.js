// Sharing (WP6): stills, loops, delivery, the share sheet. Deep links live in ../links.js.
//   installShare()  call once from main.js: resolves the downloads capability, primes the manifest, wires the sheet
//                   (bus 'share:open' {kind: 'still'|'loop'|'link'} and any element with data-share="<kind>").
import { shareMeta as meta, primeManifest } from './meta.js';
import { exportStill, exportLoop } from './export.js';
import { deliver, resolveDownloads } from './deliver.js';
import { installShareSheet, openShare, closeShare } from './sheet.js';

export const shareMeta = meta;
export { exportStill, exportLoop, deliver, openShare, closeShare };
export { setRenderer } from './facade.js';

export function installShare() {
  resolveDownloads();
  primeManifest();
  installShareSheet();
}
