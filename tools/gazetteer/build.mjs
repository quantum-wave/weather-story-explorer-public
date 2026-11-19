// Builds site/geo/cities.json from npm all-the-cities 3.1.0 (tool time only; the site never loads the package).
// Usage: cd tools/gazetteer && npm install && node build.mjs [--out ../../site/geo/cities.json]
//
// Selection: population >= 15,000 anywhere, plus US and Canadian places >= 5,000 (SPEC section 5 says US only; Canada is added for ski towns such as Banff and Whistler).
// Row: [id, name, admin, cc, lat, lon, pop100] (population in hundreds, for ranking only), lat/lon at two decimals, sorted by population descending
// (ties by id) so array order is the default search rank. The ASCII-folded name is not stored: the
// browser derives it with normalize('NFD') at load time. `admin` is the GeoNames admin1 code
// (kept only for US: state letters, and CA: two digits mapped to province letters in the browser; empty elsewhere to save bytes).
//
// Licence: the code is ours; the data is GeoNames (CC-BY-4.0, https://creativecommons.org/licenses/by/4.0/)
// as repackaged by all-the-cities (MIT). The attribution travels inside the output file.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require('all-the-cities/package.json');
if (pkg.version !== '3.1.0') throw new Error(`expected all-the-cities 3.1.0, found ${pkg.version}`);
const cities = require('all-the-cities');

const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const out = path.resolve(oi >= 0 ? args[oi + 1] : path.join(here, '../../site/geo/cities.json'));

const keep = cities.filter((c) => c.population >= 15000 || ((c.country === 'US' || c.country === 'CA') && c.population >= 5000));
keep.sort((a, b) => b.population - a.population || Number(a.cityId) - Number(b.cityId));
const r2 = (x) => Math.round(x * 100) / 100;
const rows = keep.map((c) => [Number(c.cityId), c.name, (c.country === 'US' || c.country === 'CA') ? (c.adminCode || '') : '', c.country, r2(c.loc.coordinates[1]), r2(c.loc.coordinates[0]), Math.round(c.population / 100)]);

const doc = {
  v: 1,
  source: 'GeoNames via npm all-the-cities@3.1.0',
  license: 'CC-BY-4.0',
  attribution: 'Cities: GeoNames (geonames.org), CC-BY-4.0',
  select: 'population >= 15000, plus US and CA places >= 5000',
  cols: ['id', 'name', 'admin', 'cc', 'lat', 'lon', 'pop100'],
  rows,
};
// One row per line keeps diffs and `git` happy; still plain JSON.
const text = '{' + ['v', 'source', 'license', 'attribution', 'select', 'cols'].map((k) => JSON.stringify(k) + ':' + JSON.stringify(doc[k])).join(',') +
  ',\n"rows":[\n' + rows.map((r) => JSON.stringify(r)).join(',\n') + '\n]}\n';
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, text);
JSON.parse(text);
console.log(`wrote ${out}: ${rows.length} rows, ${text.length} bytes`);
