// Single import point for vendored libraries. d3 and topojson ship as UMD: index.html loads them as classic
// scripts (globals d3, topojson); under Node (unit tests) they are loaded from the same vendored files.
// gifenc and fflate are self-contained ES modules.
if (typeof globalThis.d3 === 'undefined' && globalThis.process?.versions?.node) {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  globalThis.d3 = req('../vendor/d3@7.9.2/d3.min.js');
  globalThis.topojson = req('../vendor/topojson-client@3.1.0/topojson-client.min.js');
}
export const d3 = globalThis.d3;
export const topojson = globalThis.topojson;
export * as gifenc from '../vendor/gifenc@1.0.3/gifenc.esm.js';
export * as fflate from '../vendor/fflate@0.8.3/browser.js';
