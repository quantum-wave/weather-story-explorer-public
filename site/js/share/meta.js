// What a share says about the current view (SPEC section 7): headline, valid time, run, confidence, footer.
// Reads the store and the data facade; the text rules themselves live in format.js (pure, unit-tested).
import { store, bus } from '../state.js';
import * as data from '../data/index.js';
import { LAYER_CODES } from '../contract.js';
import { formatValid, defaultHeadline, confidenceFor, footerLine, sampleBanner, legendWords, valueAt, regionName } from './format.js';

let manifest = null;
bus.on('data:manifest', (m) => { manifest = m; });

/** The manifest, from the data facade when it offers it, else the bus, else the site's own manifest file. */
export async function primeManifest() {
  const viaData = data.getManifest?.() ?? data.manifest?.();
  if (viaData && typeof viaData === 'object' && viaData.run) manifest = viaData;
  if (manifest) return manifest;
  try {
    const res = await fetch('data/manifest.json');
    if (res.ok) manifest = await res.json();
  } catch { /* meta falls back to blanks */ }
  return manifest;
}
export const cachedManifest = () => manifest;

export const LAYER_ORDER = ['z', 'j', 'c', 't'];
/** The layer a share is about: the first enabled one (z, j, c, t), else z. */
export function activeLayer(state) {
  return LAYER_ORDER.find((k) => state.layers && state.layers[k]) || 'z';
}
export const activeField = (state) => LAYER_CODES[activeLayer(state)];

export function nearestStep(field, t) {
  const steps = data.fieldSteps(field) || [];
  if (!steps.length) return null;
  let best = 0;
  for (let i = 1; i < steps.length; i++) if (Math.abs(steps[i] - t) < Math.abs(steps[best] - t)) best = i;
  return { index: best, step: steps[best] };
}

/** The valid time to print for forecast hour t: in sample mode the case's real date, else run + t. */
export function validDateFor(t, state = store.get(), field = activeField(state)) {
  if (state.sample && manifest?.fields?.[field]?.source?.valid) {
    const ns = nearestStep(field, t);
    const real = ns && manifest.fields[field].source.valid[ns.index];
    if (real) { const d = new Date(real); if (!Number.isNaN(d.getTime())) return d; }
  }
  return data.validTime(t);
}

function sdAt(state) {
  const f = state.focus;
  const series = f ? data.sampleSeries('z500sd', f.lat, f.lon) : data.sampleDomainSpread();
  const v = valueAt(series, state.t);
  return v == null ? null : v / 10; // gpm -> dam
}

export function shareMeta(state = store.get()) {
  const layer = activeLayer(state);
  const field = LAYER_CODES[layer];
  const date = validDateFor(state.t, state, field);
  const v = formatValid(date, { year: !!state.sample }); // sample dates are real past dates: show the year
  const m = manifest || {};
  const f = state.focus;
  const placeLabel = f ? String(f.label || '') : '';
  const conf = confidenceFor({ sd: sdAt(state), leadHours: state.t });
  const sample = !!state.sample;
  const caseLabel = sample ? (m.cases?.[state.case]?.label || m.sample_note || '') : '';
  // A sample is real past data, not a model run: say which case instead of printing a rebased run time.
  const runText = sample ? `Sample case: ${caseLabel}` : m.run ? `Model run ${String(m.run).replace('T', ' ').replace(/:00Z$/, 'Z')}${m.model ? ' · ' + m.model : ''}` : '';
  return {
    headline: defaultHeadline({ placeLabel, view: state.view, dayLabel: v.dayLabel }),
    placeLabel,
    region: regionName(state.view),
    layer,
    validTime: v.local,
    validShort: v.short,
    validDayLabel: v.dayLabel,
    validUtc: v.utc,
    run: runText,
    // Sample spreads are not forecast spreads (SPEC section 11): never print a confidence word as if it meant something.
    confidence: sample ? 'Pattern confidence: not meaningful for sample data' : conf.phrase,
    confidenceLevel: sample ? 'none' : conf.level,
    footer: footerLine({ attribution: m.attribution, climatologyLabel: m.climatology?.label }),
    legendWords: legendWords(layer),
    sample,
    sampleBanner: sample ? sampleBanner(caseLabel) : '',
    caseLabel,
    t: state.t,
  };
}
