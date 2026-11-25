// The Briefing's memory (C2-03): a small digest of each briefed place per run, kept in the browser so the next briefing can set the
// earlier reason phrase beside today's. Pure over an injected storage; every access is in try/catch, and a blocked or damaged
// storage turns the feature off without an error. A digest holds dates, day classes and one phrase from story/phrases.js: no name,
// no label, no city name, no coordinate (a place is keyed by 'home' or by its pin or trip id).
//   createMemory(storage) -> { save(run, entries, label?), previous(run) }
//   entry: {key, reason, days: [{date, wet, family, confidence, signal}]}  (lead days 1-7)
//   sinceLines(then, now) -> the card's lines, or null when there is nothing to set side by side.
import { SINCE_SAME, thenLine, nowLine } from './copy.js';

export const MEMORY_KEY = 'wse.v1.brief.memory';
export const MAX_RUNS = 6;

const isStr = (x) => typeof x === 'string';
const cleanDay = (d) => (d && isStr(d.date) ? { date: d.date, wet: isStr(d.wet) ? d.wet : 'none', family: isStr(d.family) ? d.family : 'none', confidence: isStr(d.confidence) ? d.confidence : 'none', signal: isStr(d.signal) ? d.signal : 'none' } : null);
const cleanEntry = (e) => (e && isStr(e.key) && isStr(e.reason) && Array.isArray(e.days) ? { key: e.key, reason: e.reason, days: e.days.map(cleanDay).filter(Boolean) } : null);

export function createMemory(storage) {
  const read = () => {
    try {
      const raw = JSON.parse(storage.getItem(MEMORY_KEY));
      const runs = Array.isArray(raw?.runs) ? raw.runs : [];
      return runs.filter((r) => r && isStr(r.run) && Array.isArray(r.entries)).map((r) => ({ run: r.run, label: isStr(r.label) ? r.label : '', entries: r.entries.map(cleanEntry).filter(Boolean) }));
    } catch { return null; }
  };
  return {
    /** Keeps the run's digest (a run already held is not saved again); at most MAX_RUNS runs, the oldest dropped. Returns true when saved. */
    save(run, entries, label = '') {
      try {
        if (!isStr(run) || !run || !Array.isArray(entries)) return false;
        const runs = read() || [];
        if (runs.some((r) => r.run === run)) return false;
        const clean = entries.map(cleanEntry).filter(Boolean);
        if (!clean.length) return false;
        runs.push({ run, label: isStr(label) ? label : '', entries: clean });
        runs.sort((a, b) => (a.run < b.run ? -1 : a.run > b.run ? 1 : 0));
        storage.setItem(MEMORY_KEY, JSON.stringify({ v: 1, runs: runs.slice(-MAX_RUNS) }));
        return true;
      } catch { return false; }
    },
    /** The latest saved digest from a run before `run`: {run, label, entries}, or null. */
    previous(run) {
      const runs = read();
      if (!runs || !isStr(run)) return null;
      const older = runs.filter((r) => r.run < run);
      return older.length ? older[older.length - 1] : null;
    },
  };
}

/** A day that can be the basis of a difference: it has a clear signal and a confidence above low, in this digest. */
const gradable = (d) => d.signal !== 'none' && d.confidence !== 'low' && d.confidence !== 'none';

/**
 * The 'since' lines for place entries `then` (earlier run) and `now` (today), or null when either phrase is missing.
 * One line 'Same as your last briefing.' when the phrases are equal and no day common to both (by date) that is gradable in both
 * differs in wet class or pattern family; else 'Then: {phrase}' and 'Now: {phrase}'.
 */
export function sinceLines(then, now) {
  if (!then?.reason || !now?.reason) return null;
  const earlier = new Map((then.days || []).map((d) => [d.date, d]));
  let differs = false;
  for (const d of now.days || []) {
    const e = earlier.get(d.date);
    if (!e) continue;
    if (!gradable(e) || !gradable(d)) continue; // a day without a clear signal or with low confidence is no basis
    if (e.wet !== d.wet || e.family !== d.family) differs = true;
  }
  if (then.reason === now.reason && !differs) return [SINCE_SAME];
  return [thenLine(then.reason), nowLine(now.reason)];
}
