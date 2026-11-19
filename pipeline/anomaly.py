"""Climatology as annual mean plus three harmonics, and anomalies against it.

`harmonics.npz` (built by clim.py, stored on the `clim` branch):
  lat (ny,) north to south, lon (nx,) ascending from 0, z500 and t850 (7, ny, nx) float32 holding
  [mean, cos1, sin1, cos2, sin2, cos3, sin3] with phase 2*pi*t/365.25, t = days since 1 Jan 00Z of the valid year,
  meta_json (a JSON string: label, source, method, baseline, built).
The coefficient planes are interpolated to an output domain once (bilinear commutes with the linear fit), then
evaluated at each valid time. Anomaly = field - climatology at the valid time (SPEC section 9).
"""
from __future__ import annotations

import datetime as dt
import json

import numpy as np

from .grids import DOMAINS, Grid, bilinear, axes

NHARM = 3
YEAR_DAYS = 365.25
VARS = ("z500", "t850")


def design(t_days, nharm=NHARM):
    """(n,) days -> (n, 1 + 2*nharm) design matrix [1, cos k, sin k ...]."""
    th = 2.0 * np.pi * np.asarray(t_days, float) / YEAR_DAYS
    cols = [np.ones_like(th)]
    for k in range(1, nharm + 1):
        cols += [np.cos(k * th), np.sin(k * th)]
    return np.stack(cols, axis=1)


def fit_harmonics(t_days, values, nharm=NHARM):
    """Least-squares fit. values (n, ny, nx) -> coefficients (1 + 2*nharm, ny, nx) float32."""
    v = np.asarray(values, np.float64)
    n = v.shape[0]
    coef, *_ = np.linalg.lstsq(design(t_days, nharm), v.reshape(n, -1), rcond=None)
    return coef.reshape((coef.shape[0],) + v.shape[1:]).astype(np.float32)


def eval_harmonics(coef, t_days):
    """coef (7, ny, nx), scalar days -> (ny, nx) float32."""
    w = design([t_days])[0]
    return np.tensordot(w, np.asarray(coef, np.float64), axes=1).astype(np.float32)


def t_days(valid):
    """Days since 1 Jan 00Z of the valid time's year."""
    start = dt.datetime(valid.year, 1, 1, tzinfo=dt.timezone.utc)
    return (valid - start).total_seconds() / 86400.0


def save(path, lat, lon, planes, meta):
    np.savez_compressed(path, lat=np.asarray(lat, np.float32), lon=np.asarray(lon, np.float32),
                        meta_json=np.array(json.dumps(meta)), **{k: np.asarray(v, np.float32) for k, v in planes.items()})


class Climatology:
    def __init__(self, lat, lon, planes, meta):
        self.lat = np.asarray(lat, float)
        self.lon = np.asarray(lon, float)
        self.planes = planes
        self.meta = meta
        self.grid = Grid(float(self.lat[0]), float((self.lat[-1] - self.lat[0]) / (len(self.lat) - 1)),
                         float(self.lon[0]), float((self.lon[-1] - self.lon[0]) / (len(self.lon) - 1)),
                         len(self.lat), len(self.lon))
        self._cache = {}

    @classmethod
    def load(cls, path):
        z = np.load(path, allow_pickle=False)
        meta = json.loads(str(z["meta_json"]))
        return cls(z["lat"], z["lon"], {v: z[v] for v in VARS if v in z.files}, meta)

    def coef_on(self, var, dom):
        key = (var, dom if isinstance(dom, str) else json.dumps(dom, sort_keys=True))
        if key not in self._cache:
            d = DOMAINS[dom] if isinstance(dom, str) else dom
            lon, lat = axes(d)
            self._cache[key] = np.stack([bilinear(p, self.grid, lon, lat) for p in self.planes[var]])
        return self._cache[key]

    def at(self, var, dom, valid):
        """Climatological value of `var` on domain `dom` at the aware datetime `valid`."""
        return eval_harmonics(self.coef_on(var, dom), t_days(valid))

    def anomaly(self, var, dom, valid, field):
        return (np.asarray(field, np.float32) - self.at(var, dom, valid)).astype(np.float32)

    @property
    def description(self):
        """The manifest's `climatology` block."""
        m = self.meta
        return {"label": m["label"], "source": m["source"], "method": m["method"]}
