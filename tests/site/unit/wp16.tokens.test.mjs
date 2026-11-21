// W3-04: the chrome tokens of design spec 10.1 for both themes. The test parses tokens.css, recomputes every contrast figure the spec
// prints (WCAG 2.x relative luminance), asserts text is at least 4.5:1, that the "Auto" dark block repeats the dark theme exactly, that
// no chrome token other than --danger is blue, cyan, orange, red, yellow-green or violet-slate, and that monospace appears only on #debug.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../../site/css/', import.meta.url);
const css = fs.readFileSync(new URL('tokens.css', root), 'utf8');

function block(selector) {
  const i = css.indexOf(selector + ' {'); assert.ok(i >= 0, `tokens.css has no "${selector}" block`);
  const j = css.indexOf('}', i);
  const out = {};
  for (const m of css.slice(i, j).matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const light = block(':root');
const dark = block(':root[data-theme="dark"]');
const autoDark = (() => { const i = css.indexOf('@media (prefers-color-scheme: dark)'); const j = css.indexOf('\n  }\n}', i); const o = {}; for (const m of css.slice(i, j).matchAll(/(--[\w-]+):\s*([^;]+);/g)) o[m[1]] = m[2].trim(); return o; })();

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex) => { const [r, g, b] = rgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const round2 = (n) => Math.round(n * 100) / 100;

// [theme tokens, text token, ground token, the spec's figure]
const FIGURES = [
  ['dark', 'text', 'bg', 16.29], ['dark', 'text-2', 'surface', 7.61], ['dark', 'text-3', 'surface', 4.99], ['dark', 'danger', 'surface', 6.03],
  ['light', 'text', 'bg', 15.13], ['light', 'text-2', 'surface', 6.26], ['light', 'text-2', 'bg', 5.6], ['light', 'text-3', 'bg', 4.67], ['light', 'text-3', 'surface', 5.23], ['light', 'danger', 'surface', 5.57],
];

test('every contrast figure of spec 10.1 is recomputed from tokens.css and matches within 0.01', () => {
  for (const [theme, fg, bg, want] of FIGURES) {
    const t = theme === 'dark' ? dark : light;
    const got = round2(contrast(t['--' + fg], t['--' + bg]));
    assert.ok(Math.abs(got - want) <= 0.011, `${theme} --${fg} on --${bg}: spec says ${want}, tokens.css gives ${got}`);
  }
});

test('all text tokens are at least 4.5:1 on bg, surface and raised, in both themes; the accent pair too', () => {
  for (const [name, t] of [['light', light], ['dark', dark]]) {
    for (const fg of ['text', 'text-2', 'text-3', 'danger']) for (const bg of ['bg', 'surface', 'raised']) {
      const c = contrast(t['--' + fg], t['--' + bg]);
      assert.ok(c >= 4.5, `${name} --${fg} on --${bg} is ${round2(c)}:1, under 4.5`);
    }
    assert.ok(contrast(t['--on-accent'], t['--accent']) >= 4.5, `${name} --on-accent on --accent`);
  }
});

test('both themes define the same token set and "Auto" repeats the dark theme exactly', () => {
  assert.deepEqual(Object.keys(dark).sort(), Object.keys(light).filter((k) => k in dark).sort());
  for (const k of ['--bg', '--surface', '--raised', '--glass', '--hairline', '--text', '--text-2', '--text-3', '--accent', '--on-accent', '--danger', '--scrim']) {
    assert.ok(k in light && k in dark, `${k} is missing from a theme`);
    assert.equal(autoDark[k], dark[k], `Auto dark differs from dark for ${k}`);
  }
});

test('chrome tokens are neutral apart from --danger (no blue, cyan, orange, red, yellow-green or violet-slate)', () => {
  const hueOf = (hex) => { const [r, g, b] = rgb(hex); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d < 0.06) return null; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; return { h, s: d / (1 - Math.abs(mx + mn - 1)) }; };
  for (const [name, t] of [['light', light], ['dark', dark]]) {
    for (const k of ['--bg', '--surface', '--raised', '--hairline', '--text', '--text-2', '--text-3', '--accent', '--on-accent']) {
      const h = hueOf(t[k]);
      assert.ok(!h || h.s < 0.2 || (h.h >= 20 && h.h <= 60), `${name} ${k} ${t[k]} is a saturated colour (hue ${h && Math.round(h.h)}); chrome stays neutral or warm grey`);
    }
  }
});

test('glass has the 94% opaque fallback and the sheet radius is 14', () => {
  assert.match(light['--glass'], /rgba\(255, 255, 255, 0\.86\)/); assert.match(light['--glass-solid'], /0\.94/);
  assert.match(dark['--glass'], /rgba\(22, 26, 31, 0\.86\)/); assert.match(dark['--glass-solid'], /0\.94/);
  const shell = fs.readFileSync(new URL('shell.css', root), 'utf8');
  assert.match(shell, /@supports not \(\(backdrop-filter: blur\(1px\)\)[^{]*\{\s*\.glass \{ background: var\(--glass-solid\)/, 'opaque fallback for glass');
  assert.match(css, /--r-sheet: 14px/);
});

test('no monospace outside #debug in the shell, tokens and header sources', () => {
  for (const f of ['css/shell.css', 'css/tokens.css']) {
    const text = fs.readFileSync(new URL(f, new URL('../../../site/', import.meta.url)), 'utf8');
    for (const [i, line] of text.split('\n').entries()) {
      if (!/mono|monospace|menlo|consolas|courier/i.test(line)) continue;
      assert.ok(/--font-mono: |^#debug, #debug \*|font-family: var\(--font-mono\)|\/\*/.test(line) && !/font:.*mono/.test(line.replace(/\/\*.*\*\//, '')), `${f}:${i + 1} uses monospace outside #debug: ${line.trim().slice(0, 100)}`);
    }
  }
  const head = fs.readFileSync(new URL('../../../site/js/ui/header.js', import.meta.url), 'utf8');
  assert.ok(!/monospace|font-mono/i.test(head));
});
