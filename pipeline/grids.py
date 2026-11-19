"""Grid geometry and resampling.

Two output domains (SPEC section 9): `g1` (1 degree global, lon -180..180 with a wrap column, 361 x 181) and
`np05` (0.5 degree, lon 150..310 east, lat 75..10 north, 321 x 131). Rows run north to south.

Resampling follows the SPEC: from a finer regular grid whose nodes line up with the target nodes by an even
factor, a centred kernel in both directions (1 degree from 0.25: 1/8 1/4 1/4 1/4 1/8; 0.5 degree from 0.25:
1/4 1/2 1/4), longitude wrapping on a global source; anywhere else, bilinear. Output is float32 with NaN for
"no data" (outside a regional source, or a window with no valid centre).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

DOMAINS = {
    "g1": dict(lon0=-180.0, lat0=90.0, dlon=1.0, dlat=-1.0, nx=361, ny=181),
    "np05": dict(lon0=150.0, lat0=75.0, dlon=0.5, dlat=-0.5, nx=321, ny=131),
}


def axes(d):
    """(lon, lat) node coordinates of a domain dict."""
    lon = d["lon0"] + d["dlon"] * np.arange(d["nx"])
    lat = d["lat0"] + d["dlat"] * np.arange(d["ny"])
    return lon, lat


@dataclass(frozen=True)
class Grid:
    """A regular lat/lon source grid. Row 0 is `lat0`, rows step by `dlat` (negative: north to south);
    column 0 is `lon0`, columns step by `dlon` (positive)."""
    lat0: float
    dlat: float
    lon0: float
    dlon: float
    ny: int
    nx: int

    @property
    def lons(self):
        return self.lon0 + self.dlon * np.arange(self.nx)

    @property
    def lats(self):
        return self.lat0 + self.dlat * np.arange(self.ny)

    @property
    def period(self):
        """Number of unique columns when the grid spans the globe (with or without a repeated last column),
        else None."""
        if abs(self.nx * self.dlon - 360.0) < 1e-6:
            return self.nx
        if abs((self.nx - 1) * self.dlon - 360.0) < 1e-6:
            return self.nx - 1
        return None


def grid_from_axes(lat, lon):
    """Grid from 1-D axes (any order; the caller must have oriented the data to north-south, west-east)."""
    lat = np.asarray(lat, float)
    lon = np.asarray(lon, float)
    return Grid(float(lat[0]), float((lat[-1] - lat[0]) / (len(lat) - 1)), float(lon[0]),
                float((lon[-1] - lon[0]) / (len(lon) - 1)), len(lat), len(lon))


def _even_factor(ratio):
    """ratio (target spacing / source spacing) -> 1 or an even integer, else None."""
    r = round(ratio)
    if r >= 1 and abs(ratio - r) < 1e-6 and (r == 1 or r % 2 == 0):
        return int(r)
    return None


def _kernel(f):
    """Centred kernel for an even factor f: offsets -f/2..f/2, weights 1/f with half weights on the two ends."""
    if f == 1:
        return [(0, 1.0)]
    h = f // 2
    return [(o, (1.0 / f) * (0.5 if abs(o) == h else 1.0)) for o in range(-h, h + 1)]


def _centres(src0, sd, dst, n):
    """Source index of each destination coordinate, or None unless every one lies on a source node."""
    idx = (np.asarray(dst, float) - src0) / sd
    r = np.rint(idx)
    if np.max(np.abs(idx - r)) > 1e-6:
        return None
    return r.astype(int)


def _gather(a, centres, kernel, n, periodic, axis):
    acc = None
    wsum = None
    shape = [1] * a.ndim
    shape[axis] = len(centres)
    for off, w in kernel:
        idx = centres + off
        if periodic:
            idx = idx % periodic
            ok = np.ones(len(idx), bool)
        else:
            ok = (idx >= 0) & (idx < n)
            idx = np.clip(idx, 0, n - 1)
        take = np.take(a, idx, axis=axis)
        okb = ok.reshape(shape)
        term = np.where(okb, take, 0.0) * w
        wt = okb * w
        acc = term if acc is None else acc + term
        wsum = wt if wsum is None else wsum + wt
    return acc / wsum


def coarsen_centred(a, grid, lon_dst, lat_dst):
    """Centred-kernel resample of `a` (ny, nx) onto the destination axes, or None if the nodes do not line up
    at an even factor. Longitude wraps on a global source; at a pole or a regional edge the window is truncated
    and its weights renormalised; a destination node whose centre is outside the source is NaN."""
    fx = _even_factor(abs((lon_dst[1] - lon_dst[0]) / grid.dlon)) if len(lon_dst) > 1 else 1
    fy = _even_factor(abs((lat_dst[1] - lat_dst[0]) / grid.dlat)) if len(lat_dst) > 1 else 1
    if fx is None or fy is None:
        return None
    per = grid.period
    cx = _centres(grid.lon0, grid.dlon, grid.lon0 + np.mod(lon_dst - grid.lon0, 360.0), grid.nx)
    cy = _centres(grid.lat0, grid.dlat, lat_dst, grid.ny)
    if cx is None or cy is None:
        return None
    a = np.asarray(a, np.float64)
    out_x = np.ones(len(cx), bool)
    if not per:
        out_x = (cx >= 0) & (cx < grid.nx)
    out_y = (cy >= 0) & (cy < grid.ny)
    cxc = cx % per if per else np.clip(cx, 0, grid.nx - 1)
    cyc = np.clip(cy, 0, grid.ny - 1)
    # latitude first on the full-width array, then longitude
    t = _gather(a, cyc, _kernel(fy), grid.ny, 0, 0)
    t = _gather(t, cxc, _kernel(fx), grid.nx, per or 0, 1)
    t = np.where(out_y[:, None] & out_x[None, :], t, np.nan)
    return t.astype(np.float32)


def bilinear(a, grid, lon_dst, lat_dst):
    """Bilinear resample onto the destination axes. NaN outside a regional source."""
    a = np.asarray(a, np.float64)
    ny, nx = a.shape
    per = grid.period
    X = np.mod(np.asarray(lon_dst, float)[None, :] - grid.lon0, 360.0) / grid.dlon
    Y = (np.asarray(lat_dst, float)[:, None] - grid.lat0) / grid.dlat
    X = np.broadcast_to(X, (len(lat_dst), len(lon_dst)))
    Y = np.broadcast_to(Y, X.shape)
    eps = 1e-9
    outside = (Y < -eps) | (Y > ny - 1 + eps)
    if not per:
        outside = outside | (X < -eps) | (X > nx - 1 + eps)
    Yc = np.clip(Y, 0, ny - 1)
    y0 = np.minimum(np.floor(Yc).astype(int), ny - 2)
    fy = Yc - y0
    if per:
        x0 = np.floor(X).astype(int)
        fx = X - x0
        x0 = x0 % per
        x1 = (x0 + 1) % per
        # a source with a repeated wrap column still indexes inside nx
    else:
        Xc = np.clip(X, 0, nx - 1)
        x0 = np.minimum(np.floor(Xc).astype(int), nx - 2)
        fx = Xc - x0
        x1 = x0 + 1
    v = (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x1] * fx * (1 - fy)
         + a[y0 + 1, x0] * (1 - fx) * fy + a[y0 + 1, x1] * fx * fy)
    return np.where(outside, np.nan, v).astype(np.float32)


def resample(a, grid, dom):
    """Resample `a` (ny, nx) on `grid` to the node set of the domain dict `dom`. Centred kernel where the nodes
    line up at an even factor and the source is not coarser than the target, bilinear otherwise."""
    lon_dst, lat_dst = axes(dom)
    if abs(grid.dlon) <= abs(dom["dlon"]) + 1e-9 and abs(grid.dlat) <= abs(dom["dlat"]) + 1e-9:
        out = coarsen_centred(a, grid, lon_dst, lat_dst)
        if out is not None:
            return out
    return bilinear(a, grid, lon_dst, lat_dst)


def nearest_index(dom, lat, lon):
    """(j, i) of the node nearest to (lat, lon), or None if it is outside the domain. Longitudes compare modulo
    360 (np05 runs east 150..310)."""
    j = int(round((lat - dom["lat0"]) / dom["dlat"]))
    i = int(round(((lon - dom["lon0"]) % 360.0) / dom["dlon"]))
    if 0 <= j < dom["ny"] and 0 <= i < dom["nx"]:
        return j, i
    return None


def orient(a, lat, lon):
    """(a, Grid) with rows north to south and columns west to east, from any 1-D lat/lon axes (regular spacing)."""
    lat = np.asarray(lat, float)
    lon = np.asarray(lon, float)
    a = np.asarray(a)
    if lat[0] < lat[-1]:
        lat, a = lat[::-1], a[..., ::-1, :]
    if lon[0] > lon[-1]:
        lon, a = lon[::-1], a[..., ::-1]
    return a, grid_from_axes(lat, lon)
