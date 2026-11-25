// C1-01: the Briefing's own copy (H7). Every string in brief/copy.js passes the banned-word test and names no weekday, rain
// word or temperature; the teaching line is exact; the module has no string the test cannot see.
import test from 'node:test';
import assert from 'node:assert/strict';

const site = new URL('../../../site/js/brief/', import.meta.url);
const C = await import(new URL('copy.js', site).href);
const K = await import(new URL('contract.js', site).href);

const BANNED = /\b(settled|unsettled|will|definitely|guaranteed|arrives?|reach(?:es)?|hits?)\b/i;
const WEEKDAY = /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day)?\b/i;
const RAIN = /\b(rain\w*|wet\w*|dry|drier|drizzle|showers?|storms?|stormy|snow\w*|downpour|thunder\w*)\b/i;
const TEMP = /°|\b(degrees?|warm\w*|cold\w*|hot|cool\w*|freez\w*|frost\w*|chill\w*|temperatures?)\b/i;

/** Every string the module can produce: its string exports, the values of its frozen tables, and its functions on sample arguments. */
function allStrings() {
  const out = [];
  const walk = (v, name) => {
    if (typeof v === 'string') out.push([name, v]);
    else if (typeof v === 'function') {
      for (const args of [['Your city'], [''], [3], ['3 pm'], [undefined]]) {
        let r; try { r = v(...args); } catch { continue; }
        if (typeof r === 'string') out.push([`${name}(${JSON.stringify(args[0])})`, r]);
      }
      if (v.length === 2) { const r = v('Your city', ''); if (typeof r === 'string') out.push([`${name}(2)`, r]); }
    } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${name}.${k}`);
  };
  for (const [k, v] of Object.entries(C)) if (k !== 'SHOW_SENTENCES') walk(v, k);
  return out;
}

test('copy: the walker sees every kind of string the module has', () => {
  const all = allStrings();
  assert.ok(all.length >= 30, `found ${all.length} strings`);
  const seen = new Set(all.map(([, s]) => s));
  for (const s of [C.TEACHING, C.KICKER.sure, C.TITLE.end, C.SURE_LINE, C.NO_SPREAD_LINE, C.END_ADD, C.moreInPeople(3), C.nextUpdate('3 pm'), C.teaching('Your city'), C.titleFor('Your city', ''), C.homeKicker('Your city')]) assert.ok(seen.has(s), `the walker did not see: ${s}`);
});

test('copy H7: no banned word, weekday, rain word or temperature in any string', () => {
  for (const [name, s] of allStrings()) {
    assert.ok(!BANNED.test(s), `${name} has a banned word: ${s}`);
    assert.ok(!WEEKDAY.test(s), `${name} names a weekday: ${s}`);
    assert.ok(!RAIN.test(s), `${name} has a rain word: ${s}`);
    assert.ok(!TEMP.test(s), `${name} has a temperature word: ${s}`);
  }
});

test('copy H7: the banned-word test can fail (it flags a planted word in each class)', () => {
  assert.match('It will clear', BANNED); assert.match('Settled weather', BANNED); assert.match('It arrives Sunday', BANNED);
  assert.match('Thursday briefing', WEEKDAY); assert.match('Rain likely', RAIN); assert.match('9°', TEMP);
});

test('copy H7: the teaching line is exactly the pattern lens vocabulary', () => {
  assert.equal(C.TEACHING, 'Orange and red: a ridge. Blue: a trough. Watch what moves toward {home}.');
  assert.equal(C.teaching('San Francisco'), 'Orange and red: a ridge. Blue: a trough. Watch what moves toward San Francisco.');
  assert.ok(C.teaching('San Francisco').length <= K.MAX_LINE_CHARS);
});

test('copy: every fixed line fits the card (110 characters) and SHOW_SENTENCES is a plain boolean switch', () => {
  for (const [name, s] of allStrings()) assert.ok(s.length <= K.MAX_LINE_CHARS, `${name} is ${s.length} characters`);
  assert.equal(typeof C.SHOW_SENTENCES, 'boolean');
  assert.equal(C.SHOW_SENTENCES, true);
});

test('copy: the title names the weekday only when it is given one', () => {
  assert.equal(C.titleFor('Lisbon', 'Thursday'), 'Thursday briefing · Lisbon');
  assert.equal(C.titleFor('Lisbon', ''), 'Briefing · Lisbon');
});

test('copy: the friend-link home kicker names the city naturally and falls back to the home kicker', () => {
  assert.equal(C.homeKicker('Paris'), 'In Paris');
  assert.equal(C.homeKicker(''), C.KICKER.home); assert.equal(C.homeKicker(undefined), C.KICKER.home);
  assert.ok(!/^At /.test(C.homeKicker('Paris')));
});
