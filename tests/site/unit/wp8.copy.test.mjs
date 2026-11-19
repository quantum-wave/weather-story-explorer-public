// Copy helpers: the focus kicker never says a place twice, and row tags lead with the consequence.
import test from 'node:test';
import assert from 'node:assert/strict';

const { joinKicker, reasonTag } = await import(new URL('../../../site/js/ui/focus.js', import.meta.url).href);

test('joinKicker shows the place once when the title repeats it', () => {
  assert.equal(joinKicker('San Francisco', 'San Francisco'), 'San Francisco');
  assert.equal(joinKicker('Lisbon', 'Lisbon, PT'), 'Lisbon, PT');
  assert.equal(joinKicker('lisbon', 'Lisbon'), 'Lisbon');
  assert.equal(joinKicker('Maya', 'Portland, OR'), 'Maya · Portland, OR');
  assert.equal(joinKicker('Tahoe', 'South Lake Tahoe, CA'), 'Tahoe · South Lake Tahoe, CA');
  assert.equal(joinKicker('', 'Portland'), 'Portland');
});

test('reasonTag: Trough/Ridge become Unsettled/Settled with the term in the tooltip', () => {
  assert.deepEqual(reasonTag('Trough Sun').text, 'Unsettled Sun');
  assert.match(reasonTag('Trough Sun').title, /trough/i);
  assert.equal(reasonTag('Ridge Mon').text, 'Settled Mon');
  assert.equal(reasonTag('Heavy rain Tue').text, 'Heavy rain Tue');
  assert.equal(reasonTag('Settled').text, 'Settled');
  assert.equal(reasonTag('').text, '');
});
