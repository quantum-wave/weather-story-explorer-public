// Layout assertions (design spec 14.3, TEST-1; Josh points 5, 10, 11, 14). Run on every tour stop at both sizes.
// On the set of visible text nodes and interactive elements:
//   1 overlap     no two boxes intersect unless one contains the other in the DOM or the pair is on the stop's allowOverlap list
//   2 hscroll     no element has scrollWidth > clientWidth unless it is on the declared scrollers list (or is a deliberate ellipsis)
//   3 textsize    no text is rendered under 12 px (computed font-size times the on-screen scale: SVG viewBox shrink, CSS transforms)
//   4 clipped     no text node's box extends outside an ancestor that clips overflow (overflow hidden/clip; auto/scroll
//                 ancestors are scrollers and reach their content by scrolling)
//   5 target      on the phone every interactive element is at least 44 x 44 CSS px
// Scope: an open modal (aria-modal or <dialog open>) covers everything under it, so only its content is judged (result.scopedTo).
// `collect` runs inside the page (it is serialised with Function#toString, so it must not close over anything).
// Boxes are clipped to the viewport and to overflow-clipping ancestors first: what is not on screen is not judged.
// Text-overflow: ellipsis is a deliberate truncation, so an ellipsis element is exempt from 2 and 4 horizontally.

export const ASSERTIONS = { 1: 'overlap', 2: 'hscroll', 3: 'textsize', 4: 'clipped', 5: 'target' };
export const MIN_TEXT_PX = 12;
export const MIN_TARGET_PX = 44;

/** Runs in the page. opts: { phone, allowOverlap: [[selA, selB]], allowTarget: [sel], scrollers: [sel], root?: sel, minText, minTarget }.
 *  allowTarget lists controls whose small size is a documented design decision (each stop says why); they are not offenders but
 *  are returned in `allowedTargets` with their measured size, so the exception stays visible in the report. */
export function collect(opts) {
  const MIN_OVERLAP = 1; // px a box must intrude on another, on both axes, to count
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const INTERACTIVE = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=slider], [role=switch], [role=checkbox], [role=menuitem], [tabindex]:not([tabindex="-1"])';
  const rectOf = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom });
  const sel = (el) => {
    if (!(el instanceof Element)) return '?';
    if (el.id) return '#' + el.id;
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.body && parts.length < 3; e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      if (e.id) { parts.unshift('#' + e.id); break; }
      const c = (e.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      if (c) s += '.' + c;
      parts.unshift(s);
    }
    return parts.join(' > ');
  };
  const visibleStyle = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || +cs.opacity === 0) return false;
      if (e.hidden) return false;
    }
    return true;
  };
  const clipsOverflow = (cs) => ['hidden', 'clip'].includes(cs.overflowX) || ['hidden', 'clip'].includes(cs.overflowY);
  // The visible part of `box` after the viewport and every overflow-clipping ancestor of `el`; null when nothing is left.
  const clipBox = (el, box, includeSelf) => {
    let { x, y, r, b } = box;
    x = Math.max(x, 0); y = Math.max(y, 0); r = Math.min(r, vw); b = Math.min(b, vh);
    for (let a = includeSelf ? el : el.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const ar = a.getBoundingClientRect();
        if (cs.overflowX !== 'visible') { x = Math.max(x, ar.left); r = Math.min(r, ar.right); }
        if (cs.overflowY !== 'visible') { y = Math.max(y, ar.top); b = Math.min(b, ar.bottom); }
      }
    }
    return r - x > 0.5 && b - y > 0.5 ? { x, y, r, b, w: r - x, h: b - y } : null;
  };
  // An ancestor that clips overflow and is itself at most 2 px wide or tall hides its text from sight (screen-reader-only text).
  const clippedToSliver = (el) => { for (let a = el; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (clipsOverflow(cs) || cs.clip !== 'auto' || cs.clipPath !== 'none') { const ar = a.getBoundingClientRect(); if (ar.width <= 2 || ar.height <= 2) return true; } } return false; };
  const srOnly = (el, r) => (r.width <= 1 || r.height <= 1) && getComputedStyle(el).overflow !== 'visible';
  // Scope: when a modal dialog is open (aria-modal or an open <dialog>), what is under it is covered and out of reach, so only the
  // modal's own content is judged; a stop can name its own `root` instead. Everything else is judged from <body>.
  const modals = [...document.querySelectorAll('[aria-modal="true"], dialog[open]')].filter((m) => { const r = m.getBoundingClientRect(); return r.width > 0 && r.height > 0 && visibleStyle(m); });
  const root = opts.root ? document.querySelector(opts.root) : modals[modals.length - 1] || document.body;
  const scopedTo = root === document.body ? null : sel(root);
  // The on-screen scale of an element's text: 1 for plain HTML, the product of the ancestors' transforms for HTML under a
  // transform, and the screen matrix for SVG text (a viewBox that shrinks the drawing, or a transform on the svg or a parent).
  const det2 = (m) => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 0;
  const renderScale = (el) => {
    if (el instanceof SVGElement) {
      const m = typeof el.getScreenCTM === 'function' ? el.getScreenCTM() : null;
      return m ? det2(m) : 1;
    }
    let k = 1;
    for (let a = el; a && a.nodeType === 1; a = a.parentElement) {
      if (a instanceof SVGElement) { const m = a.getScreenCTM && a.getScreenCTM(); return k * (m ? det2(m) : 1); }
      const t = getComputedStyle(a).transform;
      if (t && t !== 'none') { const m = new DOMMatrixReadOnly(t); k *= det2(m); }
    }
    return k;
  };
  const items = [];
  // interactive elements
  for (const el of root.querySelectorAll(INTERACTIVE)) {
    if (!visibleStyle(el)) continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    if (srOnly(el, r)) continue;
    if (el.matches('input[type=checkbox], input[type=radio], input[type=file]') && getComputedStyle(el).opacity === '0') continue;
    const vis = clipBox(el, rectOf(r));
    if (!vis) continue;
    items.push({ kind: 'control', el, own: rectOf(r), vis, text: (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().slice(0, 40) });
  }
  // visible text nodes
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!/\S/.test(n.nodeValue)) continue;
    const el = n.parentElement;
    if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE'].includes(el.tagName)) continue;
    if (el.closest('svg') && el.closest('defs')) continue;
    if (!visibleStyle(el)) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    let vis = clipBox(el, rectOf(r), true); // a text node is clipped by its own element too
    if (vis && (vis.w <= 2 || vis.h <= 2)) vis = null; // clipped to a sliver (the visually-hidden pattern): not visible text
    if (!vis && clippedToSliver(el)) continue;
    const cs = getComputedStyle(el);
    items.push({ kind: 'text', el, node: n, own: rectOf(r), vis, hidden: !vis, text: n.nodeValue.trim().replace(/\s+/g, ' ').slice(0, 40), fontSize: Math.round(parseFloat(cs.fontSize) * renderScale(el) * 100) / 100 }); // the rendered size, not the computed one
  }
  const out = [], allowedTargets = [];
  const desc = (it) => ({ sel: sel(it.el), kind: it.kind, text: it.text, box: [it.own.x, it.own.y, it.own.w, it.own.h].map((v) => Math.round(v * 10) / 10) });
  const matches = (el, s) => { try { return el.matches(s) || !!el.closest(s); } catch { return false; } };
  const allowed = (a, b) => (opts.allowOverlap || []).some(([p, q]) => (matches(a.el, p) && matches(b.el, q)) || (matches(a.el, q) && matches(b.el, p)));

  // 1 overlap, over the items that are on screen
  const shown = items.filter((i) => i.vis);
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
    const a = shown[i], b = shown[j];
    if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue; // one contains the other in the DOM
    const w = Math.min(a.vis.r, b.vis.r) - Math.max(a.vis.x, b.vis.x), h = Math.min(a.vis.b, b.vis.b) - Math.max(a.vis.y, b.vis.y);
    if (w > MIN_OVERLAP && h > MIN_OVERLAP && !allowed(a, b)) out.push({ assertion: 1, name: 'overlap', a: desc(a), b: desc(b), detail: `overlap ${Math.round(w)} x ${Math.round(h)} px` });
  }
  // 2 horizontal overflow of an element's own box
  const scrollerOk = (el) => (opts.scrollers || []).some((s) => matches(el, s));
  const seen = new Set();
  for (const it of items) {
    for (let e = it.el; e && e !== document.documentElement && !seen.has(e); e = e.parentElement) {
      seen.add(e);
      const cs = getComputedStyle(e);
      if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && cs.display !== 'inline') {
        if (scrollerOk(e)) continue;
        if (cs.textOverflow === 'ellipsis') continue;
        if (cs.overflowX === 'visible' && !['BODY', 'HTML'].includes(e.tagName)) continue; // overflowing but unclipped content is judged by 1 and 4
        const r = e.getBoundingClientRect();
        if (!r.width || !visibleStyle(e)) continue;
        out.push({ assertion: 2, name: 'hscroll', a: { sel: sel(e), kind: 'element', text: '', box: [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10) }, detail: `scrollWidth ${e.scrollWidth} > clientWidth ${e.clientWidth}` });
      }
    }
  }
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) out.push({ assertion: 2, name: 'hscroll', a: { sel: 'html', kind: 'element', text: '', box: [0, 0, vw, vh] }, detail: `the page scrolls sideways: scrollWidth ${document.documentElement.scrollWidth} > ${document.documentElement.clientWidth}` });
  // 3 text size and 4 clipped text
  for (const it of items) {
    if (it.kind !== 'text') continue;
    if (!it.hidden && it.fontSize < (opts.minText ?? 12) - 0.01) out.push({ assertion: 3, name: 'textsize', a: desc(it), detail: `${it.fontSize}px` });
    let scrollsX = false, scrollsY = false; // a scroller between the text and a clipper: the text is cut by scrolling, not by layout
    for (let a = it.el; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (['auto', 'scroll'].includes(cs.overflowX)) scrollsX = true;
      if (['auto', 'scroll'].includes(cs.overflowY)) scrollsY = true;
      if (!clipsOverflow(cs)) continue;
      const ar = a.getBoundingClientRect();
      if (!ar.width || !ar.height) continue;
      const ellipsis = cs.textOverflow === 'ellipsis' || getComputedStyle(it.el).textOverflow === 'ellipsis';
      const sx = !scrollsX && (cs.overflowX === 'hidden' || cs.overflowX === 'clip') && !ellipsis && (it.own.x < ar.left - 1 || it.own.r > ar.right + 1);
      const sy = !scrollsY && (cs.overflowY === 'hidden' || cs.overflowY === 'clip') && (it.own.y < ar.top - 1 || it.own.b > ar.bottom + 1);
      // text that is wholly outside the viewport is simply off screen, not clipped
      const onScreen = it.own.r > 0 && it.own.x < vw && it.own.b > 0 && it.own.y < vh;
      if ((sx || sy) && onScreen && !scrollerOk(a)) {
        out.push({ assertion: 4, name: 'clipped', a: desc(it), b: { sel: sel(a), kind: 'clipper', text: '', box: [ar.left, ar.top, ar.width, ar.height].map((v) => Math.round(v * 10) / 10) }, detail: `text box [${Math.round(it.own.x)},${Math.round(it.own.y)},${Math.round(it.own.r)},${Math.round(it.own.b)}] leaves its clipper` });
        break;
      }
    }
  }
  // 5 target size (phone only), judged on the element's own box, wherever it is on screen
  if (opts.phone) {
    for (const it of items) {
      if (it.kind !== 'control') continue;
      const m = opts.minTarget ?? 44;
      if (it.own.w < m - 0.5 || it.own.h < m - 0.5) {
        const o = { assertion: 5, name: 'target', a: desc(it), detail: `${Math.round(it.own.w * 10) / 10} x ${Math.round(it.own.h * 10) / 10} px, needs ${m} x ${m}` };
        if ((opts.allowTarget || []).some((q) => matches(it.el, q))) allowedTargets.push(o); else out.push(o);
      }
    }
  }
  return { offenders: out, allowedTargets, scopedTo, counts: { text: items.filter((i) => i.kind === 'text').length, controls: items.filter((i) => i.kind === 'control').length, onScreen: shown.length } };
}

/** Run the assertions in `page`. Returns { offenders, counts, failing: [assertion numbers present] }. */
export async function runLayoutAssertions(page, { phone, allowOverlap = [], allowTarget = [], scrollers = [], root } = {}) {
  const r = await page.eval(`(${collect.toString()})(${JSON.stringify({ phone: !!phone, allowOverlap, allowTarget, scrollers, root })})`);
  r.failing = [...new Set(r.offenders.map((o) => o.assertion))].sort();
  return r;
}

export const describeOffender = (o) =>
  `[${o.assertion} ${o.name}] ${o.a.sel}${o.a.text ? ` "${o.a.text}"` : ''} ${JSON.stringify(o.a.box)}` +
  (o.b ? `  vs  ${o.b.sel}${o.b.text ? ` "${o.b.text}"` : ''} ${JSON.stringify(o.b.box)}` : '') + (o.detail ? `  (${o.detail})` : '');
