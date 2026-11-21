// The map tools row (four views, Layers, Expand, Reset): one measurement and one set of rules, shared by the S-SHELL width sweep and
// the visual tour's 01-views stop, so both enforce the same thing. Leaves SLACK px on every fit (label inside its button, gap between
// groups, row inside the stage) because Linux fonts are wider than the Mac's and a sub-pixel fit on one is an overflow on the other.
export const SLACK = 4;
export const PHONE_WIDTHS = [320, 360, 375, 390, 414, 430, 600, 679, 680];
export const DESKTOP_WIDTHS = [900, 960, 1000, 1075, 1076, 1100, 1440];

/** In-page expression: the visible #map-tools buttons with their label fit, plus the stage and the tools box. */
export const MEASURE = `(() => {
  const st = document.getElementById('stage').getBoundingClientRect(), mt = document.getElementById('map-tools').getBoundingClientRect();
  const btns = [...document.querySelectorAll('#map-tools button')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => {
    const r = b.getBoundingClientRect(), cs = getComputedStyle(b), rg = document.createRange(); rg.selectNodeContents(b);
    const tr = rg.getBoundingClientRect(), inner = b.clientWidth; // the whole padding box: a label has room when SLACK px stay free on each side of it
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
    return { id: b.id || b.dataset.view, group: b.parentElement.id || b.parentElement.className, l: r.left, r: r.right, t: r.top, b: r.bottom,
      text: b.innerText.trim(), name: b.getAttribute('aria-label') || b.textContent.trim(), textW: tr.width, textH: tr.height, inner, lh, over: b.scrollWidth - b.clientWidth };
  });
  return { sl: st.left, sr: st.right, mtl: mt.left, mtr: mt.right, vw: innerWidth, btns };
})()`;

/** The problems with one measurement, as strings ([] when the row is sound). `label` names the width and Reset state. */
export function toolsRowProblems(m, label) {
  const p = [];
  const { btns } = m;
  if (btns.length < 5) p.push(`${label}: only ${btns.length} tools visible`);
  for (const b of btns) {
    const side = (b.inner - b.textW) / 2;
    if (side < SLACK) p.push(`${label}: "${b.text}" (${b.id}) has ${side.toFixed(1)} px free on each side of its label, want ${SLACK}`);
    if (b.textH > b.lh * 1.5) p.push(`${label}: "${b.text}" (${b.id}) wraps onto ${Math.round(b.textH / b.lh)} lines`);
    if (b.over > 0) p.push(`${label}: "${b.text}" (${b.id}) overflows its button by ${b.over} px`);
    if (b.l < m.sl + SLACK || b.r > m.sr - SLACK) p.push(`${label}: ${b.id} ${b.l.toFixed(1)}-${b.r.toFixed(1)} is within ${SLACK} px of the stage edge (stage ${m.sl}-${m.sr})`);
    if (b.l < 0 || b.r > m.vw) p.push(`${label}: ${b.id} leaves the screen`);
  }
  const reset = btns.find((b) => b.id === 'btn-reset');
  const row = btns.filter((b) => b !== reset).sort((a, b) => a.l - b.l);
  const top = Math.min(...row.map((b) => b.t)), bottom = Math.max(...row.map((b) => b.b));
  if (bottom - top > 44.5) p.push(`${label}: the row spans ${(bottom - top).toFixed(1)} px, want one 44 px row`);
  const inRow = reset && Math.abs(reset.t - top) < 2;
  const flow = inRow ? [...row, reset].sort((a, b) => a.l - b.l) : row;
  for (let i = 1; i < flow.length; i++) {
    const gap = flow[i].l - flow[i - 1].r, joined = flow[i].group === flow[i - 1].group && flow[i].group === 'view-switch' ? -0.5 : SLACK - 0.01;
    if (gap < joined) p.push(`${label}: ${flow[i - 1].id} and ${flow[i].id} are ${gap.toFixed(1)} px apart, want ${joined < 0 ? 'touching' : SLACK}`);
  }
  if (reset && !inRow) {
    if (reset.t < bottom - 0.5 || reset.t - bottom > 8.5) p.push(`${label}: Reset should sit just under the row: top ${reset.t.toFixed(1)}, row bottom ${bottom.toFixed(1)}`);
  }
  const names = Object.fromEntries(btns.map((b) => [b.id, b.name]));
  if (names.np !== 'Regional' || names.nh !== 'Hemisphere' || names.gl !== 'Globe' || names.wm !== 'World') p.push(`${label}: the view buttons lost their full names: ${JSON.stringify(names)}`);
  return p;
}
