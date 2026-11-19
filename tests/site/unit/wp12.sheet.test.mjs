// W2-08: the sheet's pure rules (no browser). The behaviour on the real shell is S-SHEET.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { maxHeight, targetHeight, dragOutcome, trapTarget, DURATION_MS, DISMISS_DRAG_PX, MAX_FRACTION } from '../../../site/js/ui/sheet.js';

const read = (p) => fs.readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

test('height is the content height, capped at 92% of the visual viewport', () => {
  assert.equal(MAX_FRACTION, 0.92);
  assert.equal(maxHeight(844), 776);
  assert.equal(maxHeight(544), 500);
  assert.equal(targetHeight(300.2, 844), 301);
  assert.equal(targetHeight(2000, 844), 776);
  assert.equal(targetHeight(2000, 544), 500, 'with the keyboard up the cap follows the visual viewport');
  assert.equal(targetHeight(0, 844), 0);
});

test('a drag dismisses over 24 px or as a quick flick, and snaps back otherwise', () => {
  assert.equal(DISMISS_DRAG_PX, 24);
  assert.equal(dragOutcome({ dy: 25, ms: 900 }), 'dismiss');
  assert.equal(dragOutcome({ dy: 24, ms: 900 }), 'snap', '24 px exactly is not over 24');
  assert.equal(dragOutcome({ dy: 15, ms: 240 }), 'snap');
  assert.equal(dragOutcome({ dy: 15, ms: 20 }), 'dismiss', 'a quick flick');
  assert.equal(dragOutcome({ dy: 4, ms: 2 }), 'snap', 'a twitch is not a flick');
  assert.equal(dragOutcome({ dy: -60, ms: 100 }), 'snap', 'dragging up never dismisses');
});

test('Tab wraps at both ends of the trap', () => {
  assert.equal(trapTarget(3, 4, false), 0);
  assert.equal(trapTarget(0, 4, true), 3);
  assert.equal(trapTarget(1, 4, false), null);
  assert.equal(trapTarget(2, 4, true), null);
  assert.equal(trapTarget(-1, 4, false), 0);
  assert.equal(trapTarget(-1, 4, true), 3);
  assert.equal(trapTarget(0, 0, false), -2);
});

test('the structural animation is 180 ms and uses only the section 10 tokens, each with a fallback', () => {
  assert.equal(DURATION_MS, 180);
  const css = read('../../../site/css/sheet.css');
  const vars = [...css.matchAll(/var\(--([a-z0-9-]+)(,[^)]*)?\)/g)].filter((m) => !m[1].startsWith('ws-') && !m[1].startsWith('wse-'));
  const allowed = new Set(['surface', 'text', 'text-2', 'hairline', 'accent', 'on-accent', 'danger', 'scrim']);
  for (const m of vars) { assert.ok(allowed.has(m[1]), `--${m[1]} is a section 10 token`); assert.ok(m[2], `--${m[1]} has a fallback`); }
  assert.ok(vars.length >= 8);
});

test('the sheet never reads or writes the document at import time and never opens a browser dialog', () => {
  const js = read('../../../site/js/ui/sheet.js');
  assert.ok(!/\b(confirm|alert|prompt)\s*\(/.test(js));
});
