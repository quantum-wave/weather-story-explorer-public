// Copy helpers: the focus kicker never says a place twice, and row tags carry the reason phrase unchanged.
// DESIGN-SPEC 3.4: the words "settled" and "unsettled" appear nowhere in the app; reason phrases come only from story/phrases.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { joinKicker, reasonTag } = await import(new URL('../../../site/js/ui/focus.js', import.meta.url).href);
const fmt = await import(new URL('../../../site/js/ui/format.js', import.meta.url).href);

test('joinKicker shows the place once when the title repeats it', () => {
  assert.equal(joinKicker('San Francisco', 'San Francisco'), 'San Francisco');
  assert.equal(joinKicker('Lisbon', 'Lisbon, PT'), 'Lisbon, PT');
  assert.equal(joinKicker('lisbon', 'Lisbon'), 'Lisbon');
  assert.equal(joinKicker('Maya', 'Portland, OR'), 'Maya · Portland, OR');
  assert.equal(joinKicker('Tahoe', 'South Lake Tahoe, CA'), 'Tahoe · South Lake Tahoe, CA');
  assert.equal(joinKicker('', 'Portland'), 'Portland');
});

test('reasonTag passes the story reason phrase through and never rewrites it into settled or unsettled', () => {
  assert.equal(reasonTag('Rain likely from Sunday').text, 'Rain likely from Sunday');
  assert.equal(reasonTag('Under a trough from Sun 1 Jan').text, 'Under a trough from Sun 1 Jan');
  assert.equal(reasonTag('Dry all week').text, 'Dry all week');
  assert.equal(reasonTag('').text, '');
  for (const r of ['Trough Sun', 'Ridge Mon', 'Trough Sun 1 Jan']) assert.doesNotMatch(reasonTag(r).text, /settled/i, r);
  assert.equal(reasonTag('Trough Sun').title, '', 'no information lives only in a title tooltip (UX-9)');
});

// layers.js is exempt: its map-legend sentence is pinned by the share tests (wp6.share, S-SHARE) and is replaced by W3-11's legend.
const EXEMPT = new Set(['layers.js']);
test('the words settled and unsettled appear nowhere in site/js/ui/', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'site', 'js', 'ui');
  const bad = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js') && !EXEMPT.has(x))) {
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => { if (/unsettled|\bsettled\b/i.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`); });
  }
  assert.deepEqual(bad, []);
});

test('staleHead words a stale forecast by its age and a very stale one by its date', () => {
  const m = { run: '2026-11-17T00:00Z' };
  const at = (h) => Date.parse('2026-11-17T00:00Z') + h * 3600e3;
  assert.equal(fmt.staleHead(m, at(10), 'fresh'), '');
  assert.equal(fmt.staleHead(m, at(30), 'stale'), 'Forecast from 30 h ago');
  assert.match(fmt.staleHead(m, at(60), 'very-stale'), /^Old forecast from (Mon|Tue) 1[67] Nov$/);
  assert.equal(fmt.staleHead(m, at(60), 'recorded'), '');
});

test('plural and rangeReason: the reason a range is disabled is a sentence', () => {
  assert.equal(fmt.plural(1, 'day'), '1 day');
  assert.equal(fmt.plural(10, 'day'), '10 days');
  assert.equal(fmt.rangeReason({ kind: 'recorded' }, 10), 'This recording covers 10 days');
  assert.equal(fmt.rangeReason({ kind: 'multi' }, 2), 'This sample covers 2 days');
  assert.equal(fmt.rangeReason({ kind: 'live' }, 5), 'This forecast covers 5 days');
});
