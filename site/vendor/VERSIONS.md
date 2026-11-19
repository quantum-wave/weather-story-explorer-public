# Vendored libraries

Each npm file below is unmodified from the npm tarball named here (registry.npmjs.org, fetched 2026-11-17). No CDN at runtime or in tests.
Load through `site/js/vendor.js`.

| Folder | npm package | Version | Licence | File used |
|---|---|---|---|---|
| `d3@7.9.2/` | d3 | 7.9.2 | ISC | `dist/d3.min.js` (UMD, classic `<script>`, global `d3`; the package's `d3.min.mjs` imports bare `d3-*` specifiers and needs a bundler) |
| `topojson-client@3.1.0/` | topojson-client | 3.1.0 | ISC | `dist/topojson-client.min.js` (UMD, classic `<script>`, global `topojson`) |
| `gifenc@1.0.3/` | gifenc | 1.0.3 | MIT | `dist/gifenc.esm.js` |
| `fflate@0.8.3/` | fflate | 0.8.3 | MIT | `esm/browser.js` |
| `site/js/render/versor.js` | d3/versor (source, not an npm tarball) | adapted from the d3/versor repository | ISC | Original source file, adapted (Euler-to-quaternion, delta, multiply) and kept with its ISC notice; imported as an ES module by `site/js/render/globe.js` |

Basemap data: `site/geo/LICENSES.md`.
