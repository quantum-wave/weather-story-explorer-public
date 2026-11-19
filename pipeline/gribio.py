"""Read regular lat/lon GRIB messages (ECMWF open data, 0.25 degree) with eccodes.

Every message is returned oriented north to south, west to east, with its Grid. Selection is by short name and
level only: the fetch layer puts one request per file, so a file never holds two steps or two types of one field.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .grids import Grid


@dataclass
class Message:
    short: str
    level: int | None
    data: np.ndarray  # float32 (ny, nx), north to south, west to east
    grid: Grid


def read_messages(path):
    import eccodes as ec
    out = []
    with open(path, "rb") as fh:
        while True:
            h = ec.codes_grib_new_from_file(fh)
            if h is None:
                break
            try:
                if ec.codes_get(h, "gridType") != "regular_ll":
                    raise ValueError(f"{path}: gridType {ec.codes_get(h, 'gridType')!r}, expected regular_ll")
                ni, nj = ec.codes_get(h, "Ni"), ec.codes_get(h, "Nj")
                vals = np.asarray(ec.codes_get_values(h), np.float64).reshape(nj, ni)
                lat1 = ec.codes_get(h, "latitudeOfFirstGridPointInDegrees")
                lon1 = ec.codes_get(h, "longitudeOfFirstGridPointInDegrees")
                di = ec.codes_get(h, "iDirectionIncrementInDegrees")
                dj = ec.codes_get(h, "jDirectionIncrementInDegrees")
                i_neg = bool(ec.codes_get(h, "iScansNegatively"))
                j_pos = bool(ec.codes_get(h, "jScansPositively"))
                lats = lat1 + (dj if j_pos else -dj) * np.arange(nj)
                lons = lon1 + (-di if i_neg else di) * np.arange(ni)
                if j_pos:
                    vals, lats = vals[::-1], lats[::-1]
                if i_neg:
                    vals, lons = vals[:, ::-1], lons[::-1]
                try:
                    level = int(ec.codes_get(h, "level"))
                except Exception:
                    level = None
                grid = Grid(float(lats[0]), float(-dj), float(lons[0]), float(di), nj, ni)
                out.append(Message(ec.codes_get(h, "shortName"), level, vals.astype(np.float32), grid))
            finally:
                ec.codes_release(h)
    return out


def pick(messages, short, level=None):
    """The one message with this short name (and level, when given)."""
    hits = [m for m in messages if m.short == short and (level is None or m.level == level)]
    if len(hits) != 1:
        raise KeyError(f"{len(hits)} messages for {short} level {level}")
    return hits[0]
