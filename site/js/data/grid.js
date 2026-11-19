// Pure grid geometry shared by the data and render modules.

/** Longitude/latitude -> fractional grid coordinates [gi, gj] in domain d, or null outside it. Longitudes compare modulo 360. */
export function toGrid(d, lon, lat) {
  let l = (lon - d.lon0) % 360;
  if (l < 0) l += 360;
  if (l > (d.nx - 1) * d.dlon + 1e-9) return null;
  const gj = (lat - d.lat0) / d.dlat;
  if (gj < -1e-9 || gj > d.ny - 1 + 1e-9) return null;
  return [l / d.dlon, gj];
}

/** Longitude (-180..180) and latitude of node (i, j). */
export function nodeLonLat(d, i, j) {
  let lon = d.lon0 + i * d.dlon;
  lon = ((lon + 180) % 360 + 360) % 360 - 180;
  return [lon, d.lat0 + j * d.dlat];
}

/** Bilinear value at fractional (gi, gj) from an Int16 or Float32 frame; `nodata` (or NaN) marks no data.
 *  Falls back to the nearest node when a corner is missing; returns NaN when that is missing too. */
export function bilinear(frame, d, gi, gj, nodata = -32768) {
  const nx = d.nx;
  let i0 = Math.floor(gi), j0 = Math.floor(gj);
  if (i0 > nx - 2) i0 = nx - 2;
  if (j0 > d.ny - 2) j0 = d.ny - 2;
  if (i0 < 0) i0 = 0;
  if (j0 < 0) j0 = 0;
  const fx = gi - i0, fy = gj - j0;
  const k = j0 * nx + i0;
  const a = frame[k], b = frame[k + 1], c = frame[k + nx], e = frame[k + nx + 1];
  const bad = (v) => v === nodata || v !== v;
  if (bad(a) || bad(b) || bad(c) || bad(e)) {
    const v = fx < 0.5 ? (fy < 0.5 ? a : c) : (fy < 0.5 ? b : e);
    return bad(v) ? NaN : v;
  }
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
}
