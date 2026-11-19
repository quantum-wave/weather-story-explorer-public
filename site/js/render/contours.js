// Contour lines on the blended grid, computed directly in screen space with one marching-squares pass over all levels
// (d3.contours scans the grid once per level: too slow for 60 fps). Pure: no DOM, no d3.

export const CONTOUR_STEP_GPM = 60; // every 6 dam
export const BOLD_DAM = [552, 564, 576, 588];
export const LABEL_EVERY_DAM = 12;
const MAX_JUMP = 0.25; // a cell whose nodes are further apart than this fraction of the canvas width is not drawn

/** Multiples of `step` inside [min, max] of the finite values. */
export function levelsFor(values, step) {
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < values.length; k++) { const v = values[k]; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!(hi > lo)) return [];
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

// For each corner pattern (a = top-left 1, b = top-right 2, c = bottom-right 4, d = bottom-left 8), the edges the
// contour joins: T = a-b, R = b-c, B = d-c, L = a-d. Saddles (5, 10) are listed for a high centre then a low one.
const T = 0, R = 1, B = 2, L = 3;
const SEGS = [[], [[L, T]], [[T, R]], [[L, R]], [[R, B]], null, [[T, B]], [[L, B]], [[L, B]], [[T, B]], null, [[R, B]], [[L, R]], [[T, R]], [[L, T]], []];
const SADDLE5 = { high: [[T, R], [L, B]], low: [[L, T], [R, B]] };
const SADDLE10 = { high: [[L, T], [R, B]], low: [[T, R], [L, B]] };

/**
 * Marching squares over the grid, drawn from cached node positions.
 * `nodes` = Float32Array(2*nx*ny) screen positions (NaN = clipped); `W` canvas width in CSS px.
 * Levels: every `step` (default 60 gpm) or the explicit `levels` list. Cells touching a clipped node, or whose nodes
 * lie more than MAX_JUMP * W apart on screen (a projection seam), are skipped, so lines stop at seams and at the
 * domain edge. Returns [{level, seg: number[]}], seg = flat x0, y0, x1, y1 per segment.
 */
export function contourSegments(vals, dom, nodes, W, { step = CONTOUR_STEP_GPM, levels = null } = {}) {
  const nx = dom.nx, ny = dom.ny, maxJump = MAX_JUMP * W, byLevel = new Map();
  const edge = new Float64Array(8);
  const list = levels ? levels.slice().sort((x, y) => x - y) : null;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i, va = vals[k], vb = vals[k + 1], vd = vals[k + nx], vc = vals[k + nx + 1];
      if (va !== va || vb !== vb || vc !== vc || vd !== vd) continue;
      const mn = Math.min(va, vb, vc, vd), mx = Math.max(va, vb, vc, vd);
      let q0, q1;
      if (list) { q0 = 0; q1 = list.length - 1; while (q0 <= q1 && list[q0] < mn) q0++; while (q1 >= q0 && list[q1] > mx) q1--; }
      else { q0 = Math.ceil(mn / step); q1 = Math.floor(mx / step); }
      if (q0 > q1) continue;
      const pa = 2 * k, pb = pa + 2, pd = 2 * (k + nx), pc = pd + 2;
      const xa = nodes[pa], xb = nodes[pb], xc = nodes[pc], xd = nodes[pd];
      if (xa !== xa || xb !== xb || xc !== xc || xd !== xd) continue;
      if (Math.max(xa, xb, xc, xd) - Math.min(xa, xb, xc, xd) > maxJump) continue;
      const ya = nodes[pa + 1], yb = nodes[pb + 1], yc = nodes[pc + 1], yd = nodes[pd + 1];
      for (let q = q0; q <= q1; q++) {
        const lv = list ? list[q] : q * step;
        const idx = (va >= lv ? 1 : 0) | (vb >= lv ? 2 : 0) | (vc >= lv ? 4 : 0) | (vd >= lv ? 8 : 0);
        let pairs = SEGS[idx];
        if (pairs === null) pairs = (idx === 5 ? SADDLE5 : SADDLE10)[(va + vb + vc + vd) / 4 >= lv ? 'high' : 'low'];
        if (!pairs.length) continue;
        // crossing points on the four edges (only the ones used are valid)
        let t = (lv - va) / (vb - va); edge[0] = xa + t * (xb - xa); edge[1] = ya + t * (yb - ya); // T
        t = (lv - vb) / (vc - vb); edge[2] = xb + t * (xc - xb); edge[3] = yb + t * (yc - yb); // R
        t = (lv - vd) / (vc - vd); edge[4] = xd + t * (xc - xd); edge[5] = yd + t * (yc - yd); // B
        t = (lv - va) / (vd - va); edge[6] = xa + t * (xd - xa); edge[7] = ya + t * (yd - ya); // L
        let seg = byLevel.get(lv);
        if (!seg) { seg = []; byLevel.set(lv, seg); }
        for (const [e0, e1] of pairs) seg.push(edge[2 * e0], edge[2 * e0 + 1], edge[2 * e1], edge[2 * e1 + 1]);
      }
    }
  }
  return [...byLevel.entries()].sort((x, y) => x[0] - y[0]).map(([level, seg]) => ({ level, seg }));
}

/**
 * Label positions: per level that is a multiple of 12 dam, per 260 px screen cell, the segment nearest the cell centre,
 * where the line crosses at least `minSegs` segments of that cell (so small rings stay unlabelled); no two labels
 * within 34 px; the 552/564/576/588 lines first. Returns [{x, y, angle, text}], angle kept upright.
 */
export function labelSpots(lines, W, H, { cell = 260, minSegs = 8, margin = 24, unit = 10, gap = 34 } = {}) {
  const spots = [], taken = [];
  const bold = (l) => Number(BOLD_DAM.includes(l.level / unit));
  for (const { level, seg } of lines.slice().sort((a, b) => bold(b) - bold(a))) {
    const dam = level / unit;
    if (dam % LABEL_EVERY_DAM !== 0) continue;
    const best = new Map(), count = new Map();
    for (let s = 0; s < seg.length; s += 4) {
      const x = (seg[s] + seg[s + 2]) / 2, y = (seg[s + 1] + seg[s + 3]) / 2;
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), key = cx * 1000 + cy;
      count.set(key, (count.get(key) || 0) + 1);
      if (x < margin || y < margin || x > W - margin || y > H - margin) continue;
      const d = Math.hypot(x - (cx + 0.5) * cell, y - (cy + 0.5) * cell), cur = best.get(key);
      if (!cur || d < cur.d) best.set(key, { d, s, x, y });
    }
    for (const [key, b] of best) {
      if (count.get(key) < minSegs) continue;
      if (taken.some((q) => Math.abs(q[0] - b.x) < gap && Math.abs(q[1] - b.y) < gap * 0.6)) continue;
      taken.push([b.x, b.y]);
      let angle = Math.atan2(seg[b.s + 3] - seg[b.s + 1], seg[b.s + 2] - seg[b.s]);
      if (angle > Math.PI / 2) angle -= Math.PI; else if (angle < -Math.PI / 2) angle += Math.PI;
      spots.push({ x: b.x, y: b.y, angle, text: String(dam) });
    }
  }
  return spots;
}
