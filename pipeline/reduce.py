"""Turn native-grid GRIB messages into the contract's fields on the output domains.

Nonlinear fields (wind speed, IVT) are computed on the native grid and only then coarsened; linear ones (height,
temperature, accumulated precipitation) are coarsened directly (SPEC section 9, review M6).
"""
from __future__ import annotations

import datetime as dt

import numpy as np

from .grids import DOMAINS, resample
from .gribio import pick, read_messages

G = 9.80665


def wind_speed(u, v):
    return np.hypot(np.asarray(u, np.float64), np.asarray(v, np.float64))


def ivt(q, u, v, levels_hpa, sp_pa=None):
    """Integrated vapour transport, kg m-1 s-1, on the input grid.

    q, u, v: (nlev, ny, nx) with q in kg/kg and winds in m/s; levels_hpa: (nlev,), any order; sp_pa: surface
    pressure in Pa or None. q*u and q*v are integrated separately, (1/g) * integral of x dp with the trapezoid
    rule, then the vector magnitude is taken (never the integral of the speed). A layer counts only when both of
    its levels are above ground (p <= sp); the sliver between the lowest valid level and the surface is left out.
    """
    lev = np.asarray(levels_hpa, float)
    order = np.argsort(lev)
    lev = lev[order] * 100.0  # Pa, ascending (top of atmosphere first)
    q, u, v = (np.asarray(a, np.float64)[order] for a in (q, u, v))
    qu, qv = q * u, q * v
    dp = np.diff(lev)[:, None, None]
    layer_u = 0.5 * (qu[1:] + qu[:-1]) * dp
    layer_v = 0.5 * (qv[1:] + qv[:-1]) * dp
    if sp_pa is not None:
        above = lev[:, None, None] <= np.asarray(sp_pa, np.float64)[None]
        both = above[1:] & above[:-1]
        layer_u = np.where(both, layer_u, 0.0)
        layer_v = np.where(both, layer_v, 0.0)
    return np.hypot(layer_u.sum(axis=0), layer_v.sum(axis=0)) / G


def tp6_from_cumulative(cum):
    """cum: {step: {domain: tp accumulated since step 0, in mm}} -> (steps, {domain: (n, ny, nx) mm per 6 h}).

    A step is listed when it and the step 6 h before are present; the accumulation starts at 0 by definition, so step
    0 may be absent (the open-data step-0 files carry no `tp`) and step 6 is then its own total. Negative differences
    (packing noise) go to 0; there is no step 0 in the result."""
    steps = [s for s in sorted(cum) if s >= 6 and ((s - 6) in cum or s == 6)]
    doms = {d for s in steps for d in cum[s]}

    def before(s, d):
        return cum[s - 6][d] if (s - 6) in cum else np.zeros_like(cum[s][d])

    out = {d: np.stack([np.maximum(cum[s][d] - before(s, d), 0.0) for s in steps]) for d in doms} if steps else {}
    return steps, out


SP_MIN_PA = 87000.0  # below 870 hPa surface pressure the 850 hPa level is under the ground (SPEC MET-8)


def below_ground_mask(sp_pa):
    """True where the surface pressure is under 870 hPa: 850 hPa lies below ground there, so a temperature at that
    level is an extrapolation (Denver, Lake Tahoe)."""
    return np.asarray(sp_pa, np.float64) < SP_MIN_PA


def apply_mask(a, mask):
    """A copy of `a` (float32) with NaN, the no-data value, where `mask` is True."""
    return np.where(mask, np.nan, np.asarray(a, np.float32)).astype(np.float32)


def terrain_masks(sp_pa, grid, domains=("g1", "np05")):
    """{domain: below-ground mask} from one surface-pressure field on its native grid."""
    return {d: below_ground_mask(r) for d, r in to_domains(sp_pa, grid, domains).items()}


def to_domains(a, grid, domains=("g1", "np05")):
    return {d: resample(a, grid, DOMAINS[d]) for d in domains}


class StepReducer:
    """Callable for fetch.fetch_steps: reduce(step, {need: path}) -> {field: {domain: array}}.

    Output keys: z500, z500a, z500sd, z500em, pr1, pr10, ws250, t850a, t2m, msl, ivt, and `tp_cum` (tp in mm accumulated since step 0,
    turned into tp6 across steps by tp6_from_cumulative). Fields whose needs did not arrive are simply absent.
    """

    def __init__(self, run, model, fields, clim=None, domains=("g1", "np05"), terrain=None):
        """terrain: {domain: below-ground mask} (terrain_masks); t850a is only produced when it is given."""
        self.terrain = terrain
        self.run = run
        self.model = model
        self.fields = set(fields)
        self.clim = clim
        self.domains = domains

    def __call__(self, step, paths):
        f = self.fields
        out = {}
        valid = self.run + dt.timedelta(hours=step)
        doms = self.domains
        if "gh500" in paths and ({"z500", "z500a"} & f):
            m = pick(read_messages(paths["gh500"]), "z" if self.model == "aifs" else "gh", 500)
            h = m.data / G if self.model == "aifs" else m.data
            z = to_domains(h, m.grid, doms)
            if "z500" in f:
                out["z500"] = z
            if "z500a" in f:
                out["z500a"] = {d: self.clim.anomaly("z500", d, valid, z[d]) for d in doms}
        if "es" in paths and "z500sd" in f:
            m = pick(read_messages(paths["es"]), "gh", 500)
            out["z500sd"] = to_domains(m.data, m.grid, doms)
        if "wind250" in paths and "ws250" in f:
            msgs = read_messages(paths["wind250"])
            u, v = pick(msgs, "u", 250), pick(msgs, "v", 250)
            out["ws250"] = to_domains(wind_speed(u.data, v.data), u.grid, doms)
        if "t850" in paths and "t850a" in f and self.terrain is not None:
            m = pick(read_messages(paths["t850"]), "t", 850)
            t = to_domains(m.data, m.grid, doms)
            out["t850a"] = {d: apply_mask(self.clim.anomaly("t850", d, valid, t[d]), self.terrain[d]) for d in doms}
        if "tp" in paths and "tp6" in f:
            m = pick(read_messages(paths["tp"]), "tp")
            out["tp_cum"] = to_domains(m.data * 1000.0, m.grid, doms)
        if "em" in paths and "z500em" in f:
            m = pick(read_messages(paths["em"]), "gh", 500)
            out["z500em"] = to_domains(m.data, m.grid, doms)
        if "tpg" in paths and ({"pr1", "pr10"} & f):  # percent, already a probability; g1 only
            msgs = read_messages(paths["tpg"])
            for fid, short in (("pr1", "tpg1"), ("pr10", "tpg10")):
                if fid in f:
                    m = pick(msgs, short)
                    out[fid] = to_domains(m.data, m.grid, ("g1",))
        if "t2m" in paths and "t2m" in f:  # kelvin, linear, g1 only (card highs and lows)
            m = pick(read_messages(paths["t2m"]), "2t")
            out["t2m"] = to_domains(m.data, m.grid, ("g1",))
        if "msl" in paths and "msl" in f:
            m = pick(read_messages(paths["msl"]), "msl")
            out["msl"] = to_domains(m.data, m.grid, doms)
        if "ivt_pl" in paths and "ivt_sp" in paths and "ivt" in f:
            msgs = read_messages(paths["ivt_pl"])
            levels = sorted({m.level for m in msgs if m.short == "q"})
            q = np.stack([pick(msgs, "q", lv).data for lv in levels])
            u = np.stack([pick(msgs, "u", lv).data for lv in levels])
            v = np.stack([pick(msgs, "v", lv).data for lv in levels])
            sp = pick(read_messages(paths["ivt_sp"]), "sp")
            out["ivt"] = to_domains(ivt(q, u, v, levels, sp.data), sp.grid, doms)
        return out
