// The Briefing's script builder (CONCEPTS-2026-11-20.md section 4 as amended by CONCEPTS-REVIEW-2026-11-20.md M1-M12).
// buildScript(input) turns the loaded run, the home, trips and pins into a deterministic list of beats. It is pure and
// synchronous: no DOM, no clock, no data facade, no weather wording of its own (every weather sentence is the output of
// story/phrases.js or story/confidence.js; the briefing's own words are brief/copy.js). gatherInput(app) is the only
// function that reads the data facade; it fills the plain input that buildScript takes.
//
// Honesty (H1-H4, H6-H8 of the review) in one place:
//   sure     the weakest reading over every 6-hourly step a beat plays and every day class it covers or talks about
//   zoom     at most ZOOM_CAP[level]; 1 where any covered step or day has no clear signal, past 168 h, or pattern-only;
//            at most LEAD_ONLY_CAP when the level comes from lead time alone (no ensemble spread)
//   lines    a day-level sentence never sits on a beat that plays past 168 h
import {
  ZOOM_CAP, LEAD_ONLY_CAP, DETAIL_END_H, NOTABLE_FLOOR, MAX_PEOPLE, MAX_LINES, MAX_LINE_CHARS, BEAT_MS, NP_BOX,
  MIN_BEAT_MS, MAX_BEAT_MS,
} from './contract.js';
import * as C from './copy.js';
import { zones, zoneAt, signalAt, confidenceAt, NO_CLEAR_SIGNAL, CONFIDENCE_WORDS } from '../story/confidence.js';
import * as P from '../story/phrases.js';
import { staleness, ageHours, isLive, sampleLabel, runLabel } from '../data/kind.js';
import { weekdayLong, localDate } from '../story/localday.js';
import { sinceLines } from './memory.js';

const finite = Number.isFinite;
const HOUR = 3600e3;
const DAY = 24 * HOUR;
const RANK = { none: 0, 'pattern-only': 1, low: 2, medium: 3, high: 4 };
const weaker = (a, b) => (RANK[a] <= RANK[b] ? a : b);
const isWet = (c) => c.wet === 'light' || c.wet === 'moderate' || c.wet === 'heavy';
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ---------- the run ----------

function runOf(input) {
  const f = input.manifest?.fields || {};
  let steps = f.z500a?.steps;
  if (!steps?.length) for (const m of Object.values(f)) if ((m.steps?.length || 0) > (steps?.length || 0)) steps = m.steps;
  steps = (steps || []).slice();
  const first = steps.length ? steps[0] : 0;
  const last = steps.length ? steps[steps.length - 1] : 0;
  return { steps, first, last, end168: Math.min(DETAIL_END_H, last) };
}
/** The step nearest t (the earlier one on a tie). */
function nearest(steps, t) {
  let best = steps[0] ?? t;
  for (const s of steps) if (Math.abs(s - t) < Math.abs(best - t)) best = s;
  return best;
}

/** 'np' when the place lies inside the np05 domain, else 'gl' (never the regional map outside its data). */
export function viewFor(lat, lon) {
  const l = ((lon % 360) + 360) % 360;
  return lat >= NP_BOX.latMin && lat <= NP_BOX.latMax && l >= NP_BOX.lonMin && l <= NP_BOX.lonMax ? 'np' : 'gl';
}

// ---------- day windows and leads ----------

/** A day class's window in forecast hours (the story's own binning); a plain array falls back to lead x 24 h. */
function winOf(days, c) {
  const w = days?.windows?.[c.dayIndex];
  return w ? { startH: w.startH, endH: w.endH } : { startH: (c.lead - 1) * 24, endH: c.lead * 24 };
}
function leadAt(days, t, nowH) {
  const list = days || [];
  for (const c of list) { const w = winOf(days, c); if (t >= w.startH && t < w.endH) return c.lead; }
  if (list.length) {
    const a = list[0], z = list[list.length - 1];
    if (t < winOf(days, a).startH) return a.lead;
    return z.lead + Math.max(1, Math.ceil((t - winOf(days, z).endH) / 24));
  }
  return Math.max(1, 1 + Math.floor((t - nowH) / 24));
}
const overlaps = (w, lo, hi) => (lo === hi ? w.startH <= lo && lo < w.endH : w.startH < hi && w.endH > lo);

// ---------- the stamp: how sure a beat is (H1, H2) ----------

/** The reading of one day class: its confidence, never stronger than the rain downgrade the day card applies. */
function classLevel(c) {
  const l = c?.confidence;
  if (!(l in RANK) || l === 'none') return null;
  return c.lead > 3 && isWet(c) && l === 'high' ? 'medium' : l;
}

/** The classes a shown reasonPhrase talks about: its used days and the tail of a wet spell that runs on to day 10. */
function phraseCover(days) {
  const list = days || [];
  const used = list.filter((c) => c.lead <= 7 && P.hasStoryData(c));
  const wi = used.findIndex(isWet);
  const out = used.slice();
  if (wi >= 0) {
    const reach = list.filter((c) => c.lead <= 10 && P.hasStoryData(c));
    for (let i = reach.indexOf(used[wi]) + 1; i < reach.length && isWet(reach[i]); i++) if (reach[i].lead > 7) out.push(reach[i]);
  }
  return out;
}

/**
 * The weakest reading of place `key` over forecast hours [t0, t1] (either order): every 6-hourly step from the one at
 * or before the earlier hour to the one at or after the later (confidenceAt with the sampled spread), and every day
 * class the beat covers (those whose local day overlaps it) or `extra` (classes a line on the beat talks about).
 */
function sureOf(R, key, t0, t1, extra = []) {
  const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
  const smp = R.input.sample?.[key] || null;
  const days = R.input.days?.[key] || [];
  const steps = smp?.steps?.length ? smp.steps : R.steps;
  const hasSpread = !!smp?.spreadDam;
  let a = -Infinity, b = Infinity;
  for (const s of steps) { if (s <= lo && s > a) a = s; if (s >= hi && s < b) b = s; }
  if (a === -Infinity) a = steps[0] ?? lo;
  if (b === Infinity) b = steps[steps.length - 1] ?? hi;
  let level = null, signal = 'clear';
  steps.forEach((s, i) => {
    if (s < a || s > b) return;
    const spreadDam = hasSpread ? smp.spreadDam[i] : undefined;
    if (hasSpread && !finite(spreadDam)) return; // a step the data does not hold cannot be graded
    const c = confidenceAt(s, { spreadDam, hasSpread });
    level = level === null ? c.level : weaker(level, c.level);
    if (hasSpread && signalAt({ anomDam: smp.anomDam?.[i], spreadDam, hasSpread }) === 'none') signal = 'none';
  });
  const covered = days.filter((c) => overlaps(winOf(days, c), lo, hi));
  for (const c of [...covered, ...extra]) {
    const l = classLevel(c);
    if (l) level = level === null ? l : weaker(level, l);
    if (c.signal === 'none' || c.pattern === 'no-signal') signal = 'none';
  }
  if (level === null) level = 'none';
  if (signal === 'none') level = weaker(level, 'low');
  const source = level === 'none' ? 'none' : hasSpread ? 'spread' : 'lead';
  const zk = zoneAt(hi > 0 ? hi - 1e-9 : hi, R.last, { hasMean: R.hasMean }) || zones(R.last, { hasMean: R.hasMean })[0];
  // the stamp names every day class the level was drawn from: the covered ones and the ones a line on the beat pulls in
  const dayList = [...new Set([...covered, ...extra])].sort((x, y) => x.lead - y.lead);
  const d0 = dayList.length ? dayList[0].lead : leadAt(days, lo, R.nowH);
  const d1 = dayList.length ? dayList[dayList.length - 1].lead : leadAt(days, hi, R.nowH);
  const phrase = !R.live ? '' : signal === 'none' ? NO_CLEAR_SIGNAL : CONFIDENCE_WORDS[level] || '';
  return { level, phrase, source, signal, days: [Math.min(d0, d1), Math.max(d0, d1)], zone: zk.kind, caption: zk.caption };
}

/** H1: the zoom a stamp earns a camera over [t0, t1]. */
function zoomOf(sure, t0, t1) {
  if (sure.signal === 'none' || t0 > DETAIL_END_H || t1 > DETAIL_END_H) return 1;
  if (sure.level === 'pattern-only' || sure.level === 'none') return 1;
  let z = ZOOM_CAP[sure.level];
  if (sure.source === 'lead') z = Math.min(z, LEAD_ONLY_CAP);
  return z;
}

// ---------- beats ----------

function beat(R, o) {
  const lines = (o.lines || []).filter((l) => typeof l === 'string' && l && l.length <= MAX_LINE_CHARS).slice(0, MAX_LINES);
  const sure = o.sure ?? null;
  const camera = o.place && o.cam ? { lat: o.place.lat, lon: o.place.lon, zoom: zoomOf(sure, o.t0, o.t1) } : null;
  const kicker = o.kicker ?? (R.live ? o.kick : (R.dataLabel ? `${o.kick} · ${R.dataLabel}` : o.kick));
  return {
    id: o.id, chapter: o.chapter, ...(o.hook ? { hook: o.hook } : {}), kicker, title: o.title, lines,
    view: o.view ?? (o.place ? viewFor(o.place.lat, o.place.lon) : 'nh'), lens: o.lens || 'z', camera,
    t0: o.t0, t1: o.t1, ms: clamp(o.ms, MIN_BEAT_MS, MAX_BEAT_MS), place: o.place || null, sure,
    strip: !!o.strip, ...(o.zoneCaptions ? { zoneCaptions: o.zoneCaptions } : {}),
  };
}

const sentence = (R, s) => (R.showSentences ? s : '');
const patternLine = (c) => {
  const base = P.PATTERN_LINE[c.pattern];
  return base && P.coherent(P.PATTERN_FAMILY[c.pattern], c) ? base + '.' : '';
};
const withCoverage = (list, days) => Object.assign(list, { coverage: days?.coverage });

function titleBeat(R) {
  const cov = R.homeDays?.coverage;
  const weekday = R.live && cov && finite(cov.viewerOffset) ? weekdayLong(localDate(R.input.nowMs, cov.viewerOffset)) : '';
  const stale = R.live && staleness(R.input.manifest, R.input.nowMs);
  const kicker = !R.live ? R.dataLabel : stale === 'stale' || stale === 'very-stale' ? P.EMPTY.stale(Math.round(ageHours(R.input.manifest, R.input.nowMs))) : R.dataLabel;
  return beat(R, {
    id: 'title', chapter: 'title', kick: C.KICKER.title, kicker: kicker || C.KICKER.title, title: C.titleFor(R.main?.city || 'your place', weekday),
    t0: R.nowH, t1: R.nowH, ms: BEAT_MS.title,
  });
}

/**
 * The reason phrase as the memory keeps it: date-anchored (weekday names, never today/tonight/tomorrow, so it reads the same on any
 * later day) and with no place name (no '(London time)' suffix). Both go when the days are read without their coverage.
 */
export function savedReason(days) {
  return P.reasonPhrase(Array.isArray(days) ? days.slice() : days) || '';
}

/**
 * What the memory keeps of this run (memory.js): per briefed place, its reason phrase and the day classes of days 1-7 (no name, no
 * label, no city, no coordinate). A friend's place is never kept. Pure: the same input gives the same digest.
 */
export function digestOf(input) {
  const out = [];
  for (const [key, days] of Object.entries(input?.days || {})) {
    if (key === 'shared') continue;
    const list = (days || []).filter((c) => c.lead >= 1 && c.lead <= 7);
    if (!list.length) continue;
    out.push({
      key, reason: savedReason(days),
      days: list.map((c) => ({ date: c.date, wet: c.wet || 'none', family: P.PATTERN_FAMILY[c.pattern] || 'none', confidence: c.confidence || 'none', signal: c.signal || 'none' })),
    });
  }
  return out;
}

/** The 'since' beat: today's reason phrase beside the saved one (input.previous = {run, label, entries}); none when it cannot be said. */
function sinceBeat(R) {
  const prev = R.input.previous;
  if (!R.live || R.friend || !R.main || !R.showSentences || !prev?.entries) return null;
  const key = R.main.key;
  const then = prev.entries.find((e) => e.key === key);
  const now = digestOf({ days: { [key]: R.homeDays } }).find((e) => e.key === key);
  const lines = then && now ? sinceLines(then, now) : null;
  if (!lines || lines.some((l) => l.length > MAX_LINE_CHARS)) return null;
  return beat(R, {
    id: 'since', chapter: 'since', kicker: C.sinceKicker(prev.label), title: C.TITLE.since, lines, view: 'nh', lens: 'z',
    t0: R.nowH, t1: R.nowH, ms: BEAT_MS.since, place: R.main, sure: sureOf(R, key, R.nowH, R.nowH, phraseCover(R.homeDays)),
  });
}

function pictureBeats(R) {
  const h = R.main, days = R.homeDays || [];
  const kick = C.KICKER.picture;
  const phrase = sentence(R, P.reasonPhrase(days));
  const extra = h ? phraseCover(days) : [];
  const start = Math.min(R.nowH, Math.max(R.first, R.end168 - 6));
  const headline = days.find((c) => c.lead >= 2 && c.lead <= 7 && (c.pattern === 'trough' || c.pattern === 'trough-arriving') && c.signal === 'clear' && ['high', 'medium'].includes(classLevel(c)));
  let held = null;
  if (headline && h) {
    const w = winOf(days, headline);
    held = nearest(R.steps.filter((s) => s <= DETAIL_END_H), (w.startH + w.endH) / 2);
    if (!(held > start)) held = null;
  }
  const key = h?.key;
  if (!held) {
    return [beat(R, {
      id: 'picture', chapter: 'picture', kick, title: C.TITLE.picture, lines: [C.teaching(h?.city), phrase], view: 'nh', lens: 'z',
      t0: start, t1: R.end168, ms: BEAT_MS.picture, place: h, sure: sureOf(R, key, start, R.end168, extra),
    })];
  }
  return [
    beat(R, {
      id: 'picture-hold', chapter: 'picture', hook: 'hold', kick, title: C.TITLE.hold, lines: [phrase, sentence(R, patternLine(headline))],
      lens: 'z', t0: held, t1: held, ms: BEAT_MS.hold, place: h, cam: true, sure: sureOf(R, key, held, held, extra),
    }),
    beat(R, {
      id: 'picture-rewind', chapter: 'picture', hook: 'rewind', kick, title: C.TITLE.rewind, lines: [R.live ? C.REWIND_LIVE : C.REWIND_FIXED],
      view: 'nh', lens: 'z', t0: held, t1: start, ms: BEAT_MS.rewind, place: h, sure: sureOf(R, key, start, held),
    }),
    beat(R, {
      id: 'picture-forward', chapter: 'picture', hook: 'forward', kick, title: C.TITLE.forward, lines: [C.teaching(h.city)], view: 'nh', lens: 'z',
      t0: start, t1: R.end168, ms: BEAT_MS.forward, place: h, sure: sureOf(R, key, start, R.end168),
    }),
  ];
}

function homeBeats(R) {
  const h = R.main, days = R.homeDays || [];
  if (!h) return [];
  const kick = h.kind === 'shared' ? C.homeKicker(h.city) : C.KICKER.home;
  const out = [];
  const span = (list) => {
    const wins = list.map((c) => winOf(days, c));
    const t0 = Math.max(R.first, R.nowH, Math.min(...wins.map((w) => w.startH)));
    const t1 = Math.min(R.end168, Math.max(...wins.map((w) => w.endH)));
    return t1 > t0 ? [t0, t1] : null;
  };
  for (const [id, title, from, to] of [['home-near', C.TITLE.near, 1, 3], ['home-later', C.TITLE.later, 4, 7]]) {
    const list = days.filter((c) => c.lead >= from && c.lead <= to && P.hasStoryData(c));
    const s = list.length ? span(list) : null;
    if (!s) continue;
    out.push(beat(R, {
      id, chapter: 'home', kick, title, lines: [sentence(R, P.summary(withCoverage(list.slice(), days), { sample: !R.live }))],
      t0: s[0], t1: s[1], ms: id === 'home-near' ? BEAT_MS.near : BEAT_MS.later, place: h, cam: true, strip: true, sure: sureOf(R, h.key, s[0], s[1]),
    }));
  }
  // the first wet day with at least half a day left to play (a wet day that is nearly over is not worth a beat of its own)
  const tp = R.input.manifest?.fields?.tp6?.steps?.[0] ?? R.first;
  const hoursOf = (c) => { const w = winOf(days, c); const t0 = Math.max(R.first, tp, R.nowH, w.startH), t1 = Math.min(R.end168, w.endH); return { t0, t1 }; };
  const wets = days.filter((c) => c.lead <= 7 && isWet(c));
  const wet = wets.find((c) => { const x = hoursOf(c); return x.t1 - x.t0 >= 12; }) || wets[0];
  if (wet && R.input.lensOk?.('s')) {
    const { t0, t1 } = hoursOf(wet);
    if (t1 > t0) {
      out.push(beat(R, {
        id: 'home-rain', chapter: 'home', kick, title: C.TITLE.rain, lines: [sentence(R, P.reasonPhrase(days)), sentence(R, patternLine(wet))],
        lens: 's', t0, t1, ms: BEAT_MS.rain, place: h, cam: true, sure: sureOf(R, h.key, t0, t1, phraseCover(days)),
      }));
    }
  }
  return out;
}

function tripBeat(R) {
  const homeCov = R.homeDays?.coverage;
  if (!homeCov) return null;
  const cov = { ...homeCov, todayDate: homeCov.todayDate || homeCov.firstDate };
  const trips = (R.input.trips || []).slice().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : String(a.label) < String(b.label) ? -1 : 1));
  for (const t of trips) {
    const state = P.tripState(t, cov, R.input.nowMs);
    if (state !== 'detail' && state !== 'broad') continue;
    const days = R.input.days?.[t.key] || [];
    const mine = days.filter((c) => c.date >= t.start && c.date <= t.end && P.hasStoryData(c));
    if (!mine.length) continue;
    const place = { key: t.key, kind: 'trip', name: t.label, city: t.city, lat: t.lat, lon: t.lon };
    let list = mine, t0, t1;
    if (state === 'detail') list = mine.filter((c) => c.lead <= 7);
    if (!list.length) continue;
    const wins = list.map((c) => winOf(days, c));
    t0 = Math.max(R.first, Math.min(...wins.map((w) => w.startH)));
    t1 = Math.min(state === 'detail' ? R.end168 : R.last, Math.max(...wins.map((w) => w.endH)));
    if (state === 'detail') t0 = Math.max(t0, R.nowH);
    t0 = Math.min(t0, R.last); t1 = Math.max(t1, t0);
    const text = P.tripLine(t, withCoverage(mine.slice(), days), cov, { state, now: R.input.nowMs, sample: !R.live });
    return beat(R, {
      id: 'trip', chapter: 'trip', kick: C.KICKER.trip, title: t.label, lines: [sentence(R, text)], lens: 'z', t0, t1, ms: BEAT_MS.trip, place, cam: true,
      sure: sureOf(R, t.key, t0, t1),
    });
  }
  return null;
}

const scoreOf = (n) => (typeof n === 'number' ? n : n?.score);
function peopleBeats(R) {
  const eligible = (R.input.pins || [])
    .map((p) => ({ p, score: scoreOf(R.input.notabilityOf?.(p.key)) }))
    .filter((x) => finite(x.score) && x.score >= NOTABLE_FLOOR)
    .sort((a, b) => b.score - a.score || (a.p.name < b.p.name ? -1 : a.p.name > b.p.name ? 1 : 0));
  const out = [];
  for (const { p } of eligible) {
    if (out.length >= MAX_PEOPLE) break;
    const days = R.input.days?.[p.key] || [];
    const used = days.filter((c) => c.lead <= 7 && P.hasStoryData(c));
    if (!used.length) continue;
    let day = used.find(isWet);
    if (!day) day = used.reduce((a, c) => (Math.abs(finite(c.anomDam) ? c.anomDam : 0) > Math.abs(finite(a.anomDam) ? a.anomDam : 0) ? c : a), used[0]);
    const w = winOf(days, day);
    const hour = nearest(R.steps.filter((s) => s <= DETAIL_END_H), (w.startH + w.endH) / 2);
    const place = { key: p.key, kind: p.kind === 'place' ? 'place' : 'person', name: p.name, city: p.city, lat: p.lat, lon: p.lon };
    out.push(beat(R, {
      id: `people-${out.length + 1}`, chapter: 'people', kick: place.kind === 'place' ? C.KICKER.places : C.KICKER.people, title: `${p.name} · ${p.city}`,
      lines: [sentence(R, P.reasonPhrase(days))], lens: 'z', t0: hour, t1: hour, ms: BEAT_MS.person, place, cam: true,
      sure: sureOf(R, p.key, hour, hour, phraseCover(days)),
    }));
  }
  R.morePeople = eligible.length - out.length;
  return out;
}

function sureBeat(R) {
  const h = R.main;
  const kick = C.KICKER.sure;
  const spread = !!R.input.manifest?.fields?.z500sd;
  if (spread && R.input.lensOk?.('c')) {
    return beat(R, {
      id: 'sure', chapter: 'sure', kick, title: C.TITLE.sure, lines: [C.SURE_LINE], view: 'nh', lens: 'c', t0: R.first, t1: R.last, ms: BEAT_MS.sure,
      place: h, sure: sureOf(R, h?.key, R.first, R.last),
      zoneCaptions: zones(R.last, { hasMean: R.hasMean }).map((z) => ({ from: z.from, caption: z.caption })),
    });
  }
  return beat(R, {
    id: 'sure', chapter: 'sure', kick, title: C.TITLE.sure, lines: [spread ? C.NO_MAP_LINE : C.NO_SPREAD_LINE], view: 'nh', lens: 'z',
    t0: R.last, t1: R.last, ms: BEAT_MS.sureHeld, place: h, sure: sureOf(R, h?.key, R.last, R.last),
  });
}

function nextUpdateTime(R) {
  const g = Date.parse(String(R.input.manifest?.generated || ''));
  if (!finite(g)) return '';
  let t = g + 12 * HOUR;
  while (t < R.input.nowMs) t += 12 * HOUR;
  let parts;
  try { parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: true, ...(R.input.zone ? { timeZone: R.input.zone } : {}) }).formatToParts(new Date(t)); } catch { return ''; }
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return p.hour && p.dayPeriod ? `${p.hour} ${p.dayPeriod.toLowerCase()}` : '';
}

function endBeat(R, hasTrip, hasPeople) {
  const lines = [];
  if (R.morePeople > 0) lines.push(C.moreInPeople(R.morePeople));
  if (R.live && staleness(R.input.manifest, R.input.nowMs) === 'fresh') { const t = nextUpdateTime(R); if (t) lines.push(C.nextUpdate(t)); }
  if (!hasTrip && !hasPeople && !R.friend) lines.push(C.END_ADD);
  return beat(R, { id: 'end', chapter: 'end', kick: C.KICKER.end, title: C.TITLE.end, lines, lens: 'z', t0: R.nowH, t1: R.nowH, ms: BEAT_MS.end });
}

/**
 * The script for an input (see gatherInput for its shape). Pure and synchronous: the same input gives a deep-equal Script.
 * Chapter order: title, [since], picture, home, [trip], [people x up to MAX_PEOPLE], sure, end.
 * `opts.showSentences` overrides copy.js SHOW_SENTENCES (false drops every sentence of story/phrases.js from the beats).
 * @returns {import('./contract.js').Script}
 */
export function buildScript(input, opts = {}) {
  const run = runOf(input);
  const friend = !!input.friendPlace;
  const main = friend ? { ...input.friendPlace, kind: 'shared' } : input.home ? { ...input.home, kind: 'home' } : null;
  const R = {
    input, ...run, live: !!input.live, dataLabel: input.dataLabel || '', hasMean: !!input.hasMean, friend, main, morePeople: 0,
    showSentences: opts.showSentences ?? C.SHOW_SENTENCES,
    nowH: clamp(finite(input.nowH) ? input.nowH : run.first, run.first, run.last),
    homeDays: main ? input.days?.[main.key] || [] : [],
  };
  const since = sinceBeat(R);
  const beats = [titleBeat(R), ...(since ? [since] : []), ...pictureBeats(R), ...homeBeats(R)];
  const trip = friend ? null : tripBeat(R);
  if (trip) beats.push(trip);
  const people = friend ? [] : peopleBeats(R);
  beats.push(...people);
  beats.push(sureBeat(R));
  beats.push(endBeat(R, !!trip, people.length > 0));
  return {
    run: input.manifest?.run || '', sample: !!input.manifest?.sample, dataLabel: R.dataLabel, beats,
    totalMs: beats.reduce((a, b) => a + b.ms, 0), morePeople: R.morePeople,
  };
}

// ---------- gathering the input from the app ----------

const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
const startOfDay = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

/**
 * Reads everything a script needs from the running app: the only function here that touches the data facade. Awaits the
 * story's day classes for home (15 days), the next trip, and the most notable pins (7 days each), and samples the
 * pattern anomaly and the ensemble spread at each place. Returns the plain input buildScript takes:
 * {manifest, dataLabel, live, nowMs, nowH, hasMean, zone?, home, trips, pins, friendPlace, days, sample, notabilityOf, lensOk}.
 * Places are {key, kind, name, city, lat, lon}; trips add {label, start, end}; pins add {kind: 'person'|'place'}.
 */
export async function gatherInput(app) {
  const { data, story, pins, store } = app;
  const manifest = app.manifest || data.getManifest();
  const nowMs = app.now ? app.now() : Date.now();
  const live = isLive(manifest);
  const anchor = story.anchorMs(nowMs);
  const caseId = data.activeCase?.();
  const origin = data.validTime(0, caseId).getTime();
  const nowH = (anchor - origin) / HOUR;
  const dataLabel = live ? runLabel(manifest) : sampleLabel(manifest, { short: true });
  const place = (key, kind, name, c) => ({ key, kind, name, city: c.name, lat: c.lat, lon: c.lon });
  const homeCity = pins.home();
  const home = place('home', 'home', homeCity.name, homeCity);
  let friendPlace = null;
  if (app.friend?.active?.()) {
    const f = store.get().focus;
    if (f && f.kind !== 'home' && finite(f.lat) && finite(f.lon)) friendPlace = place('shared', 'shared', String(f.label || '').split(',')[0].trim(), { name: String(f.label || '').split(',')[0].trim(), lat: f.lat, lon: f.lon });
  }
  const main = friendPlace || home;
  const days = {}, sample = {}, scores = new Map();
  const dayOpts = (p) => ({ tz: 'viewer', anchor, now: nowMs, placeName: p.city });
  days[main.key] = await story.buildDays(main.lat, main.lon, anchor, anchor + 14 * DAY, dayOpts(main));
  const sampleAt = (p) => {
    const s = story.seriesFor(p.lat, p.lon);
    const z = s?.z500a;
    if (!z?.steps?.length) return;
    sample[p.key] = { steps: Array.from(z.steps), anomDam: Array.from(z.values, (v) => v / 10), spreadDam: s.z500sd ? Array.from(s.z500sd.values, (v) => v / 10) : null };
  };
  sampleAt(main);
  const trips = [], pinList = [];
  if (!friendPlace) {
    const cov = days[main.key].coverage;
    const tripToday = { ...cov, todayDate: cov?.todayDate || cov?.firstDate };
    const next = pins.trips().find((t) => story.tripState(t, tripToday, nowMs) !== 'over');
    if (next && cov && ['detail', 'broad'].includes(story.tripState(next, tripToday, nowMs))) {
      const tp = { ...place(`trip:${next.id}`, 'trip', next.label, next.city), label: next.label, start: next.start, end: next.end };
      const from = Math.max(parseDay(next.start) - 12 * HOUR, startOfDay(anchor));
      days[tp.key] = await story.buildDays(tp.lat, tp.lon, from, parseDay(next.end), dayOpts(tp));
      sampleAt(tp);
      trips.push(tp);
    }
    // notability needs the pattern and rain chunks of each pin's domain (as the People list loads them)
    const all = pins.all();
    const need = new Map();
    for (const p of all) for (const f of ['z500a', 'tp6']) { const d = story.domainFor(f, p.city.lat, p.city.lon); need.set(`${f}|${d}`, [f, d]); }
    await Promise.all([...need.values()].map(([f, d]) => Promise.resolve(data.ensureAll ? data.ensureAll(f, d) : data.ensure(f, d, 0)).catch(() => {})));
    const scored = all.map((p) => ({ id: p.id, p: { ...place(`pin:${p.id}`, p.kind === 'place' ? 'place' : 'person', p.name, p.city) }, n: story.notability(p.city.lat, p.city.lon) }));
    for (const { p, n } of scored) { scores.set(p.key, n); pinList.push(p); }
    const top = scored.filter((x) => x.n.score >= NOTABLE_FLOOR).sort((a, b) => b.n.score - a.n.score || (a.p.name < b.p.name ? -1 : 1)).slice(0, MAX_PEOPLE);
    for (const { id, p } of top) {
      // the person's card's own day classes (its place's time zone and range), so the briefing never reads a day more surely
      // than the card does; a bare app (the component tests) builds the same 7 days in the viewer's zone
      days[p.key] = (await app.home?.pinDays?.(id)) || await story.buildDays(p.lat, p.lon, anchor, anchor + 6 * DAY, dayOpts(p));
      sampleAt(p);
    }
  }
  const { lens } = await import('../lenses/index.js');
  const ok = {};
  for (const code of ['z', 'j', 's', 'a', 'r', 'c']) { try { ok[code] = !!lens(code)?.available(manifest, caseId)?.ok; } catch { ok[code] = false; } }
  const hasMean = !!manifest?.fields?.z500em && (typeof data.hasMean === 'function' ? data.hasMean({ lat: main.lat, lon: main.lon }) : true);
  return {
    manifest, dataLabel, live, nowMs, nowH, hasMean, home, trips, pins: pinList, friendPlace, days, sample,
    notabilityOf: (key) => scores.get(key) || { score: 0, reason: '' }, lensOk: (code) => !!ok[code],
  };
}
