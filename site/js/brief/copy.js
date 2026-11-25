// The Briefing's own words (H7). Chapter kickers and titles, the teaching line, the rewind line, the doubt chapter's
// line and the end card. No weather statement lives here: every weather sentence in a script comes from story/phrases.js
// or story/confidence.js. A unit test holds every string here against a banned-word list and a no-weekday, no-rain,
// no-temperature rule.

/** Josh's switch (CONCEPTS-REVIEW section 5): false removes every sentence of story/phrases.js from the cards. */
export const SHOW_SENTENCES = true;

export const KICKER = Object.freeze({
  title: 'Briefing',
  picture: 'The big picture',
  home: 'At home',
  people: 'Your people',
  places: 'Your places',
  trip: 'Your next trip',
  sure: 'How sure is this?',
  end: 'The end',
});

/** The 'since' beat's kicker: the earlier run's own label (runLabel) after the words. */
export const sinceKicker = (label) => (label ? `Since your last briefing · ${label}` : 'Since your last briefing');

/** The home chapter's kicker on a friend's link: the friend's place, not the viewer's home. */
export const homeKicker = (city) => (city ? `In ${city}` : KICKER.home);

export const TITLE = Object.freeze({
  picture: 'The pattern aloft',
  hold: 'Where it lands',
  rewind: 'Where it comes from',
  forward: 'The week ahead',
  near: 'The next three days',
  later: 'Later this week',
  rain: 'A closer look',
  sure: 'Where the forecasts agree',
  end: 'That’s the briefing.',
  since: 'Then and now',
});

/** The 'since' beat's lines: the two reason phrases of story/phrases.js, unchanged, after these labels. */
export const thenLine = (phrase) => `Then: ${phrase}`;
export const nowLine = (phrase) => `Now: ${phrase}`;
export const SINCE_SAME = 'Same as your last briefing.';

/** "Orange and red: a ridge. Blue: a trough. Watch what moves toward {home}." (the vocabulary of lenses/pattern.js). */
export const TEACHING = 'Orange and red: a ridge. Blue: a trough. Watch what moves toward {home}.';
export const teaching = (home) => TEACHING.replace('{home}', home || 'you');

export const REWIND_LIVE = 'Run it backwards to today. Watch where the blue comes from.';
export const REWIND_FIXED = 'Run it backwards to the start of the forecast. Watch where the blue comes from.';

export const SURE_LINE = 'Pale: the forecasts agree. Darker: they disagree.';
export const NO_SPREAD_LINE = 'This run has no ensemble spread, so days past 7 are one forecast.';
export const NO_MAP_LINE = 'The map of how far the forecasts disagree is not available in this run.';

export const END_ADD = 'Add a trip or a person and they join the next briefing.';
export const moreInPeople = (n) => `${n} more in People`;
export const nextUpdate = (time) => `Next update usually about ${time}.`;

/** "Thursday briefing · San Francisco"; a dataset that is not live names no weekday (its date is not today's). */
export const titleFor = (city, weekday) => (weekday ? `${weekday} briefing · ${city}` : `Briefing · ${city}`);
