// node tests/visual/run.mjs [--only id,id] [--viewports phone,desktop] [--out dir] [--stops dir] [--baseline-dir dir]
//                           [--save-baseline] [--gate-pixels] [--references dir]
// Drives every tour stop at phone and desktop, writes PNGs and contact-sheet.html under $WSE_ARTIFACTS/visual/ and exits 1 when
// a gated stop has a layout offender, a stop fails to run, or (with --gate-pixels) a diff exceeds its tolerance.
// --save-baseline copies this run's PNGs into the baseline folder; baselines are approved by Josh, an agent never commits them.
import { runTour } from './lib/tour.mjs';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(n);
const list = (v) => (v ? v.split(',').filter(Boolean) : undefined);

try {
  const r = await runTour({
    only: list(opt('--only')), viewports: list(opt('--viewports')), out: opt('--out'), stopsDir: opt('--stops'), baselineDir: opt('--baseline-dir'),
    saveBaseline: has('--save-baseline'), gatePixels: has('--gate-pixels'), referencesDir: opt('--references'),
  });
  const failing = r.frames.filter((f) => f.layout.offenders.length);
  console.log(`TOUR: ${r.frames.length} frames, ${failing.length} with layout offenders (${failing.filter((f) => f.gate).length} gated); sheet ${r.sheet}`);
  for (const p of r.problems) console.log('FAIL ' + p);
  console.log(r.ok ? 'TOUR: passed' : 'TOUR: FAILED');
  process.exit(r.ok ? 0 : 1);
} catch (e) {
  console.error('TOUR: error', e?.stack || e);
  process.exit(2);
}
