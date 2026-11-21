// What a share says about the current view (DESIGN-SPEC sections 7 and 9): headline, valid time, the one provenance label, the
// confidence phrase, footer and the legend, all taken from the same places the screen takes them from: the lens (store.lens), the ground, the legend model, runLine() / sampleLabel(), confidenceAt() and the pattern blend.
// Reads the store and the data facade; the text rules themselves live in format.js (pure, unit-tested).
import { store, bus } from '../state.js';
import * as data from '../data/index.js';
import { LENS_CODES, LENS_FILL } from '../contract.js';
import { isMultiCase, caseForLens } from '../data/kind.js';
import { confidenceAt, signalAt, NO_CLEAR_SIGNAL } from '../story/confidence.js';
import { legendModel, groundOf, runLine } from '../ui/maplegend.js';
import { formatValid, defaultHeadline, footerLine, valueAt, regionName, confidencePhrase } from './format.js';

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

/** The lens a share is about, read the way the map reads it: store.lens, Pattern when it has none or an unknown one. */
export function shareLens(state) {
  return LENS_CODES.includes(state.lens) ? state.lens : 'z';
}
/** The field a state's fill draws. */
export const fillField = (state) => { const l = shareLens(state); return LENS_FILL[l] || LENS_FILL.z; };
export const activeField = (state) => fillField(state);

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

/** The pattern at the focus (or the domain's spread when there is no focus) at forecast hour t, in dam, plus whether a spread exists. */
function patternAt(state) {
  const f = state.focus;
  let spread = null, anom = null;
  try {
    const sd = f ? data.sampleSeries('z500sd', f.lat, f.lon) : data.sampleDomainSpread();
    const v = valueAt(sd, state.t);
    spread = { has: !!(sd && sd.steps?.length), dam: v == null ? NaN : v / 10 };
    if (f) {
      const z = (data.patternSeries?.('z500a', f.lat, f.lon)) || data.sampleSeries('z500a', f.lat, f.lon);
      const a = valueAt(z, state.t);
      anom = a == null || !Number.isFinite(a) ? NaN : a / 10;
    }
  } catch { /* a field the run lacks: no spread, no anomaly */ }
  return { hasSpread: !!spread?.has, spreadDam: spread ? spread.dam : NaN, anomDam: anom == null ? NaN : anom };
}

/** The confidence line a share carries: confidenceAt(), or no claim for unrelated sample cases (their spread is not a forecast's). */
export function confidenceFor(state, manifest) {
  if (isMultiCase(manifest) && state.sample) return { level: 'none', text: 'Pattern confidence: not meaningful for sample data' };
  const p = patternAt(state);
  const c = confidenceAt(state.t, { spreadDam: p.spreadDam, hasSpread: p.hasSpread });
  if (c.level !== 'none' && signalAt({ anomDam: p.anomDam, spreadDam: p.spreadDam, hasSpread: p.hasSpread }) === 'none') return { level: 'none', text: NO_CLEAR_SIGNAL };
  return { level: c.level, text: confidencePhrase(c) };
}

export function shareMeta(state = store.get()) {
  const lens = shareLens(state);
  const field = fillField(state);
  const date = validDateFor(state.t, state, field);
  const v = formatValid(date, { year: !!state.sample }); // sample dates are real past dates: show the year
  const m = manifest || data.getManifest?.() || {};
  const f = state.focus;
  const placeLabel = f ? String(f.label || '') : '';
  const sample = !!state.sample;
  // The legend as the screen draws it (palette.legendSpec through legendModel).
  const model = legendModel({ ...state, lens }, Object.keys(m).length ? m : null);
  const conf = confidenceFor(state, m);
  const label = model ? model.run : runLine(state, Object.keys(m).length ? m : null);
  const caseLabel = sample ? (m.cases?.[caseForLens(m, lens)]?.label || m.sample_note || '') : '';
  return {
    headline: defaultHeadline({ placeLabel, view: state.view, dayLabel: v.dayLabel }),
    placeLabel,
    region: regionName(state.view),
    layer: lens, lens, field,
    ground: groundOf(state),
    legend: model,
    validTime: v.local,
    validShort: v.short,
    validDayLabel: v.dayLabel,
    validUtc: v.utc,
    // The one provenance label: runLine(), the sentence the legend, the badge and the card carry. The picture draws it once: a
    // sample as its banner, a live run as its run line.
    provenance: label,
    run: label,
    confidence: conf.text,
    confidenceLevel: conf.level,
    footer: footerLine({ attribution: m.attribution, climatologyLabel: m.climatology?.label }),
    legendWords: model ? model.spec.subtitle : '',
    sample,
    sampleBanner: sample ? label : '',
    caseLabel,
    t: state.t,
  };
}
