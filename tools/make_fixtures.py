"""Build the site-test fixtures.

  synthetic            tests/site/fixtures/synthetic/            analytic travelling wave, test-only, never published
  sample-min           tests/site/fixtures/sample-min/           real data from the spike fixtures (SPEC section 11)
  synthetic-15d        tests/site/fixtures/synthetic-15d/        W1-02: 0-360 h on 2 deg / 1 deg grids, every field, named probes
  synthetic-15d-nomean tests/site/fixtures/synthetic-15d-nomean/ the same without z500em (a run whose ensemble mean is late)
  synthetic-partial    tests/site/fixtures/synthetic-partial/    0-48 h, no z500sd (a partial build)
  recorded-min         tests/site/fixtures/recorded-min/         recorded-shape sample: sample_label, no cases, pattern fields
  synthetic-hires-48h  tests/site/fixtures/synthetic-hires-48h/  the real 1 deg / 0.5 deg grids, one exactly circular anomaly

Run with the isolated interpreter (the spike venv has numpy, xarray, cfgrib):

  python -I tools/make_fixtures.py synthetic
  python -I tools/make_fixtures.py sample-min --fixtures "$WSE_FIXTURES"
  python -I tools/make_fixtures.py synthetic-15d     (and the other W1-02 names; numpy only; add --out DIR to write elsewhere)

Every output is deterministic (gzip mtime 0, no random numbers): regenerating gives the same bytes.

This is the Phase 0 stand-in for pipeline/encode.py and `build.py --fixture` (WP1); the
byte format here is the frozen contract (site/js/contract.js, tests/pipeline/manifest.schema.json).
"""
import argparse
import datetime as dt
import gzip
import hashlib
import json
import math
import os
import sys

import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = 9.80665
NODATA = -32768
RUN = "2026-11-17T00:00Z"  # rebased step 0 of the committed fixtures
GENERATED = "2026-11-17T23:50Z"

# ---------------------------------------------------------------- codec (frozen byte format)


def quantize(a, scale, offset):
    """float array -> int16 with saturation at +-32767; NaN -> NODATA."""
    with np.errstate(invalid="ignore"):
        q = np.rint((a - offset) / scale)
    q = np.where(np.isnan(q), NODATA, np.clip(q, -32767, 32767))
    return q.astype(np.int16)


def dx_shuffle(frame):
    """One frame (ny, nx) int16 -> bytes: per-row column differences (first column raw,
    wrapping mod 2**16), then all low bytes followed by all high bytes."""
    d = frame.astype(np.int32)
    diff = d.copy()
    diff[:, 1:] = d[:, 1:] - d[:, :-1]
    u = (diff & 0xFFFF).astype(np.uint16)
    lo = (u & 0xFF).astype(np.uint8).ravel()
    hi = (u >> 8).astype(np.uint8).ravel()
    return lo.tobytes() + hi.tobytes()


def encode_chunk(frames, filt="dx-shuffle"):
    """frames (n, ny, nx) int16 -> gzip bytes (frames back to back, filtered, then gzip)."""
    if filt == "dx-shuffle":
        raw = b"".join(dx_shuffle(f) for f in frames)
    elif filt == "none":
        raw = b"".join(f.astype("<i2").tobytes() for f in frames)
    else:
        raise ValueError(filt)
    return gzip.compress(raw, 9, mtime=0)


# ---------------------------------------------------------------- domains

def domain(lon0, lat0, dlon, dlat, nx, ny):
    return dict(lon0=lon0, lat0=lat0, dlon=dlon, dlat=dlat, nx=nx, ny=ny)


REAL_DOMAINS = {
    "g1": domain(-180, 90, 1, -1, 361, 181),
    "np05": domain(150, 75, 0.5, -0.5, 321, 131),
}
# Same extents as the real domains, 36 x 19 nodes (wrap column kept on g1).
SYN_DOMAINS = {
    "g1": domain(-180, 90, 360 / 35, -10, 36, 19),
    "np05": domain(150, 75, 160 / 35, -65 / 18, 36, 19),
}


def axes(d):
    lon = d["lon0"] + d["dlon"] * np.arange(d["nx"])
    lat = d["lat0"] + d["dlat"] * np.arange(d["ny"])
    return lon, lat


def bilinear(src, slon0, sdlon, slat0, sdlat, periodic, lon_t, lat_t):
    """src (ny, nx) regular grid -> target (len(lat_t), len(lon_t)); NaN outside a non-periodic grid."""
    ny, nx = src.shape
    X = (lon_t[None, :] - slon0) / sdlon
    if periodic:
        X = np.mod(X, 360.0 / abs(sdlon))
    Y = (lat_t[:, None] - slat0) / sdlat
    X = np.broadcast_to(X, (len(lat_t), len(lon_t)))
    Y = np.broadcast_to(Y, X.shape)
    out_of = (Y < -1e-9) | (Y > ny - 1 + 1e-9)
    if not periodic:
        out_of = out_of | (X < -1e-9) | (X > nx - 1 + 1e-9)
    Yc = np.clip(Y, 0, ny - 1)
    y0 = np.minimum(np.floor(Yc).astype(int), ny - 2)
    fy = Yc - y0
    x0 = np.floor(X).astype(int)
    fx = X - x0
    if periodic:
        x0 %= nx
        x1 = (x0 + 1) % nx
    else:
        x0 = np.clip(x0, 0, nx - 2)
        fx = np.clip(X - x0, 0, 1)
        x1 = x0 + 1
    v = (src[y0, x0] * (1 - fx) * (1 - fy) + src[y0, x1] * fx * (1 - fy)
         + src[y0 + 1, x0] * (1 - fx) * fy + src[y0 + 1, x1] * fx * fy)
    return np.where(out_of, np.nan, v)


# ---------------------------------------------------------------- manifest assembly

FIELD_META = {
    "z500": ("gpm", 1, 0), "z500a": ("gpm", 1, 0), "z500sd": ("gpm", 0.1, 0),
    "ws250": ("m/s", 0.1, 0), "tp6": ("mm", 0.1, 0), "t850a": ("K", 0.1, 0),
    "msl": ("Pa", 10, 101325), "ivt": ("kg/m/s", 1, 0), "t2a": ("K", 0.1, 0),
    # W1-02 (DESIGN-SPEC 13.2)
    "z500em": ("gpm", 1, 0), "pr1": ("%", 1, 0), "pr10": ("%", 1, 0), "t2m": ("K", 0.1, 0),
}
CHUNK_HOURS = {"a": (0, 120), "b": (126, 240), "c": (246, 360)}


class Builder:
    def __init__(self, outdir, domains):
        self.out = outdir
        self.domains = domains
        self.fields = {}
        self.decoded = {}  # (field, domain) -> {step_hour: int16 frame}
        os.makedirs(outdir, exist_ok=True)
        for f in os.listdir(outdir):
            if f.endswith(".bin") or f == "manifest.json":
                os.remove(os.path.join(outdir, f))

    def add(self, fid, steps, grids, case=None, source=None):  # case=None: a recorded sample has no cases
        """grids: {domain: array (nsteps, ny, nx) of physical values (NaN = no data)}."""
        units, scale, offset = FIELD_META[fid]
        entry = {"units": units, "scale": scale, "offset": offset, "nodata": NODATA,
                 "filter": "dx-shuffle", "steps": list(steps), "domains": list(grids), "chunks": []}
        if case:
            entry["case"] = case
        if source:
            entry["source"] = source
        for cid, (lo, hi) in CHUNK_HOURS.items():
            idx = [i for i, s in enumerate(steps) if lo <= s <= hi]
            if not idx:
                continue
            assert idx == list(range(idx[0], idx[-1] + 1))
            files = {}
            for dom, arr in grids.items():
                q = np.stack([quantize(arr[i], scale, offset) for i in idx])
                for i, frame in zip(idx, q):
                    self.decoded.setdefault((fid, dom), {})[steps[i]] = frame
                blob = encode_chunk(q)
                name = f"{fid}.{dom}.{cid}.bin"
                with open(os.path.join(self.out, name), "wb") as fh:
                    fh.write(blob)
                files[dom] = {"path": name, "bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest()}
            entry["chunks"].append({"id": cid, "steps": [idx[0], idx[-1] + 1], "files": files})
        self.fields[fid] = entry

    def probe(self, name, lat, lon, fid, dom, step, allow_null=False):
        d = self.domains[dom]
        units, scale, offset = FIELD_META[fid]
        i = int(round(((lon - d["lon0"]) % 360) / d["dlon"])) if dom != "g1" else int(round((lon - d["lon0"]) / d["dlon"]))
        j = int(round((lat - d["lat0"]) / d["dlat"]))
        if not (0 <= i < d["nx"] and 0 <= j < d["ny"]):
            return None
        q = int(self.decoded[(fid, dom)][step][j, i])
        if q == NODATA and not allow_null:
            return None
        return {"name": name, "lat": lat, "lon": lon, "field": fid, "domain": dom, "step": step,
                "value": None if q == NODATA else round(q * scale + offset, 6)}

    def write(self, head, probes):
        m = dict(head)
        m["domains"] = self.domains
        m["fields"] = self.fields
        m["probes"] = [p for p in probes if p]
        with open(os.path.join(self.out, "manifest.json"), "w") as fh:
            json.dump(m, fh, indent=1)
            fh.write("\n")
        total = sum(os.path.getsize(os.path.join(self.out, f)) for f in os.listdir(self.out))
        print(f"{self.out}: {len(os.listdir(self.out))} files, {total} bytes")


CITIES = [("San Francisco", 37.77, -122.42), ("Seattle", 47.61, -122.33), ("Denver", 39.74, -104.99),
          ("Honolulu", 21.31, -157.86), ("New York", 40.71, -74.01), ("London", 51.51, -0.13)]


def make_probes(b, fid, step):
    out = []
    for name, lat, lon in CITIES:
        for dom in b.domains:
            if (fid, dom) in b.decoded:
                out.append(b.probe(name, lat, lon, fid, dom, step))
    return out


# ---------------------------------------------------------------- synthetic fixture

def synthetic(outdir):
    steps = list(range(0, 49, 6))
    b = Builder(outdir, SYN_DOMAINS)

    def wave(lon, lat, t):
        lo = np.radians(lon)[None, :]
        la = lat[:, None]
        amp = 90.0 * np.exp(-(((la - 45.0) / 22.0) ** 2))
        return amp * np.cos(3 * lo - np.radians(7.5 * t))

    grids = {k: {} for k in ("z500", "z500a", "z500sd", "ws250", "tp6", "t850a", "t2a")}
    for dom, d in SYN_DOMAINS.items():
        lon, lat = axes(d)
        la = lat[:, None] * np.ones((1, len(lon)))
        clim = 5700.0 - 2.6 * np.abs(la) - 0.0 * la
        for fid in ("z500", "z500a", "z500sd", "ws250"):
            grids[fid][dom] = []
        for t in steps:
            a = wave(lon, lat, t)
            grids["z500a"][dom].append(a)
            grids["z500"][dom].append(clim + a)
            grids["z500sd"][dom].append(8.0 + 0.9 * t + 4.0 * np.cos(np.radians(la)))
            jet = 15 + 40 * np.exp(-(((la - 40.0) / 12.0) ** 2)) * (1 + 0.3 * np.cos(3 * np.radians(lon)[None, :] - np.radians(5.0 * t)))
            grids["ws250"][dom].append(jet)
        if dom == "g1":
            grids["tp6"][dom] = [8 * np.maximum(0, wave(lon, lat, t) / 90.0) ** 2 * np.exp(-(((la - 45.0) / 15.0) ** 2)) for t in steps if t > 0]
            grids["t850a"][dom] = [0.06 * wave(lon, lat, t) for t in steps]
        else:
            grids["t2a"][dom] = [0.05 * wave(lon, lat, t) for t in steps]
    src = {"dataset": "synthetic analytic travelling wave", "valid": None}
    for fid in ("z500", "z500a", "z500sd", "ws250"):
        b.add(fid, steps, {d: np.stack(v) for d, v in grids[fid].items()}, "A", src)
    b.add("tp6", [s for s in steps if s > 0], {"g1": np.stack(grids["tp6"]["g1"])}, "A", src)
    b.add("t850a", steps, {"g1": np.stack(grids["t850a"]["g1"])}, "A", src)
    b.add("t2a", steps, {"np05": np.stack(grids["t2a"]["np05"])}, "C", src)
    head = {
        "schema": 1, "sample": True, "sample_note": "synthetic test data",
        "model": "Synthetic test wave", "run": RUN, "generated": GENERATED,
        "attribution": "synthetic test data, no source",
        "climatology": {"label": "synthetic", "source": "analytic", "method": "analytic"},
        "cases": {"A": {"label": "Synthetic travelling wave", "fields": ["z500", "z500a", "z500sd", "ws250", "tp6", "t850a"]},
                  "C": {"label": "Synthetic motion demo", "fields": ["t2a"]}},
    }
    probes = make_probes(b, "z500a", 0) + make_probes(b, "z500a", 24)
    b.write(head, probes)


# ---------------------------------------------------------------- sample-min fixture (real data)

def iso(t):
    return str(np.datetime_as_string(t, unit="m")) + "Z"


def sample_min(outdir, fixtures):
    import warnings
    import xarray as xr
    warnings.filterwarnings("ignore")
    b = Builder(outdir, REAL_DOMAINS)
    lons = {k: axes(v)[0] for k, v in REAL_DOMAINS.items()}
    lats = {k: axes(v)[1] for k, v in REAL_DOMAINS.items()}

    # Case A: ERA5 EDA members (3 deg, GRIB1): member mean and spread; anomaly vs ERA-Interim January mean.
    ds = xr.open_dataset(os.path.join(fixtures, "era5-levels-members.grib"), engine="cfgrib",
                         backend_kwargs={"indexpath": ""})
    z = ds.z.sel(isobaricInhPa=500).transpose("time", "number", "latitude", "longitude").values / G
    times = ds.valid_time.values
    zmean, zsd = z.mean(axis=1), z.std(axis=1, ddof=1)
    ei = xr.open_dataset(os.path.join(fixtures, "eraint_uvz.nc"))
    clim = ei.z.sel(month=1, level=500).values / G  # 0.75 deg, lon -180..179.25, lat 90..-90
    steps = [int((t - times[0]) / np.timedelta64(1, "h")) for t in times]
    valid = [iso(t) for t in times]
    srcA = {"dataset": "ERA5 EDA (era5-levels-members.grib), 3 deg, bilinear", "file": "era5-levels-members.grib", "valid": valid}
    g = {"z500": {}, "z500a": {}, "z500sd": {}}
    for dom in REAL_DOMAINS:
        ct = bilinear(clim, -180, 0.75, 90, -0.75, True, lons[dom], lats[dom])
        zs = [bilinear(zmean[i], 0, 3, 90, -3, True, lons[dom], lats[dom]) for i in range(len(steps))]
        sds = [bilinear(zsd[i], 0, 3, 90, -3, True, lons[dom], lats[dom]) for i in range(len(steps))]
        g["z500"][dom] = np.stack(zs)
        g["z500a"][dom] = np.stack(zs) - ct
        g["z500sd"][dom] = np.stack(sds)
    for fid in g:
        b.add(fid, steps, g[fid], "A", srcA)

    # Case B: GFS 250 hPa wind speed, Irma example (0.5 deg), 6-hourly 0-24 h, np05 only.
    ir = xr.open_dataset(os.path.join(fixtures, "irma_gfs_example.nc"))
    u = ir["u-component_of_wind_isobaric"].sel(isobaric3=25000.0).values
    v = ir["v-component_of_wind_isobaric"].sel(isobaric3=25000.0).values
    ws = np.hypot(u, v)[::2]
    t1 = ir.time1.values[::2]
    stepsB = [int((t - t1[0]) / np.timedelta64(1, "h")) for t in t1]
    slon, slat = ir.longitude.values, ir.latitude.values
    wsg = np.stack([bilinear(w, slon[0], slon[1] - slon[0], slat[0], slat[1] - slat[0], False, lons["np05"], lats["np05"]) for w in ws])
    b.add("ws250", stepsB, {"np05": wsg}, "B",
          {"dataset": "NOAA GFS 0.5 deg, Hurricane Irma example (irma_gfs_example.nc)", "file": "irma_gfs_example.nc", "valid": [iso(t) for t in t1]})

    # Case C: NCEP/NCAR 2.5 deg 4xdaily sigma-0.995 air temperature minus its 2-year mean, first 5 days of January 2013.
    at = xr.open_dataset(os.path.join(fixtures, "air_temperature.nc"))
    anom = (at.air - at.air.mean("time")).values[:21]
    tt = at.time.values[:21]
    stepsC = [int((t - tt[0]) / np.timedelta64(1, "h")) for t in tt]
    alon, alat = at.lon.values, at.lat.values
    tg = np.stack([bilinear(a, alon[0], alon[1] - alon[0], alat[0], alat[1] - alat[0], False, lons["np05"], lats["np05"]) for a in anom])
    b.add("t2a", stepsC, {"np05": tg}, "C",
          {"dataset": "NCEP/NCAR reanalysis 4xdaily air temperature (air_temperature.nc), minus 2013-2014 mean", "file": "air_temperature.nc", "valid": [iso(t) for t in tt]})

    head = {
        "schema": 1, "sample": True, "sample_note": "real fixture data, rebased; not a forecast",
        "model": "Sample data (ERA5, GFS, NCEP reanalysis fixtures)", "run": RUN, "generated": GENERATED,
        "attribution": "ERA5 (Copernicus/ECMWF), NOAA GFS, NCEP/NCAR reanalysis; xarray-data and cfgrib test files",
        "climatology": {"label": "ERA-Interim January mean, period not documented", "source": "eraint_uvz.nc", "method": "monthly mean"},
        "cases": {
            "A": {"label": "ERA5, 1-2 Jan 2017", "fields": ["z500", "z500a", "z500sd"]},
            "B": {"label": "GFS, Hurricane Irma, 5-6 Sep 2017", "fields": ["ws250"]},
            "C": {"label": "Motion demo: surface temperature, Jan 2013", "fields": ["t2a"]},
        },
    }
    probes = make_probes(b, "z500a", 0) + make_probes(b, "z500a", 24)
    b.write(head, probes)


# ---------------------------------------------------------------- W1-02 fixtures (DESIGN-SPEC 16, W1-02)

# 15-day grids: the real extents at 2 deg (g1, wrap column kept) and 1 deg (np05).
D15 = {
    "g1": domain(-180, 90, 2, -2, 181, 91),
    "np05": domain(150, 75, 1, -1, 161, 66),
}
HOURS = list(range(0, 361, 6))
STEPS_EM = list(range(144, 361, 6))
STEPS_PR = list(range(24, 361, 12))
STEPS_168 = list(range(0, 169, 6))
G1_ONLY = ("tp6", "t850a", "t2m", "pr1", "pr10")


def _dd(a, b):
    """Longitude difference wrapped into -180..180."""
    return (a - b + 540.0) % 360.0 - 180.0


def _dist(lat, lon, clat, clon):
    """Degree distance on the lat/lon plane (the plate carree the flat map draws), longitude wrapped."""
    return np.hypot(lat[:, None] - clat, _dd(lon[None, :], clon))


def _pin_weight(lat, lon, clat, clon, radius):
    """1.0 exactly at the centre node, flat to within a fraction of a percent for a third of the radius, 0 beyond ~1.6 radii."""
    return np.exp(-((_dist(lat, lon, clat, clon) / radius) ** 4))


# Anomaly pins (lat, lon on a node of both grids): name -> (lat, lon, target gpm as f(hour), weight as f(hour)).
# Each pin flattens the field to its target inside a disc (a plateau for the band-colour probes) and fades back to the wave.
PIN_R = 12.0
PINS = {
    "band+6.9dam": (60, -170, lambda t: 69.0, lambda t: math.exp(-t / 72.0)),
    "band-13dam": (36, -150, lambda t: -130.0, lambda t: math.exp(-t / 72.0)),
    "band+1dam": (24, -100, lambda t: 10.0, lambda t: math.exp(-t / 72.0)),
    "band+11dam": (56, -80, lambda t: 110.0, lambda t: 1.0),
    "no-signal": (30, -56, lambda t: 10.0, lambda t: 1.0),  # 1 dam: inside the +-2 dam "near normal" band, spread above 4 dam from 300 h
    "clear-signal": (70, -120, lambda t: 135.0, lambda t: 1.0),
    "sf-day9": (38, -122, lambda t: -60.0, lambda t: math.exp(-(((t - 216.0) / 36.0) ** 2))),
    # hres, the 0.5 blend (204 h) and the ensemble mean fall in three different 2 dam bands: +17, +11, +5 dam
    "blend-bands": (50, 160, lambda t: 170.0, lambda t: 1.0),
}
# The ensemble mean's own anomaly (z500em - clim), 144-360 h: the pattern damped toward zero with lead (MET-14), with its own
# target at each pin where the story needs one. A pin without an entry gets the hres target times the damping.
EM_PIN_TARGET = {
    "band+11dam": lambda t: 60.0,
    "no-signal": lambda t: 5.0,        # 0.5 dam, well under the spread: "No clear signal yet" beats "near normal"
    "clear-signal": lambda t: 125.0,   # the mean itself is clear (|mean anomaly| above the spread)
    "sf-day9": lambda t: -30.0,
    "blend-bands": lambda t: 50.0,
}


def em_damp(t):
    return math.exp(-t / 150.0)
HOME = (48, 0)               # the home rain sequence (pr1), on a g1 node. Longitude 0 so the place's offsetMinutes (longitude rounded to the hour) is 0: local days equal UTC days from the 00Z run
LOW = (50, -140)             # closed low (msl)
LOW_PA = 98505               # 985.05 hPa: a node value (101325 + 10 * -282)
ARROW_LINE = lambda lon: 30.0 + 0.5 * (lon + 150.0)  # IVT filament axis, lat as a function of lon
NODATA_BLOCK = (36, 46, -116, -104)  # t850a: lat range, lon range (nodes, inclusive)


def base_anomaly(lon, lat, t):
    """Wave-3 plus a weak wave-5, reaching about +-30 dam (gpm); no pins."""
    la = lat[:, None]
    lo = np.radians(lon)[None, :]
    amp = 305.0 * np.exp(-(((la - 45.0) / 22.0) ** 2))
    return amp * (np.cos(3 * lo - math.radians(1.2 * t)) + 0.15 * np.cos(5 * lo + 0.7 + math.radians(0.6 * t)))


def anomaly(lon, lat, t, pins=True):
    a = base_anomaly(lon, lat, t)
    if not pins:
        return a
    wsum = np.zeros_like(a)
    tsum = np.zeros_like(a)
    for (clat, clon, target, wf) in PINS.values():
        wm = wf(t) * _pin_weight(lat, lon, clat, clon, PIN_R)
        wsum += wm
        tsum += wm * target(t)
    return a * (1 - wsum) + tsum


def anomaly_em(lon, lat, t):
    """Anomaly of the ensemble mean: the wave damped with lead, pinned to the mean's own targets (so it differs from anomaly())."""
    a = base_anomaly(lon, lat, t) * em_damp(t)
    wsum = np.zeros_like(a)
    tsum = np.zeros_like(a)
    for name, (clat, clon, target, wf) in PINS.items():
        tg = EM_PIN_TARGET[name](t) if name in EM_PIN_TARGET else target(t) * em_damp(t)
        wm = wf(t) * _pin_weight(lat, lon, clat, clon, PIN_R)
        wsum += wm
        tsum += wm * tg
    return a * (1 - wsum) + tsum


def clim500(lat, lon):
    return (5700.0 - 2.6 * np.abs(lat))[:, None] * np.ones((1, len(lon)))


def spread(lon, lat, t):
    """z500sd in gpm: 2 gpm (0.2 dam) everywhere at 0 h, growing to 87 gpm (8.7 dam) at its maximum at 360 h."""
    la = lat[:, None]
    f = 0.6 + 0.4 * np.exp(-(((la - 50.0) / 30.0) ** 2)) * (0.5 + 0.5 * np.cos(np.radians(lon + 30.0))[None, :])
    return 2.0 + 85.0 * (t / 360.0) ** 1.2 * f


def wind250(lon, lat, t):
    la = lat[:, None]
    return 15 + 40 * np.exp(-(((la - 40.0) / 12.0) ** 2)) * (1 + 0.3 * np.cos(3 * np.radians(lon)[None, :] - math.radians(1.2 * t)))


def mslp(lon, lat, t):
    base = 101325.0 + 800.0 * base_anomaly(lon, lat, t) / 305.0
    d = _dist(lat, lon, LOW[0], LOW[1])
    m = np.exp(-((d / 9.0) ** 2))
    return base * (1 - m) + LOW_PA * m


def rain_target(t_end):
    """The home place: dry through day 3, wet from day 4 (end hours 96 and later)."""
    return 3.0 + 72.0 * min(1.0, max(0.0, (t_end - 72.0) / 24.0))


def rain1(lon, lat, t):
    la = lat[:, None]
    base = 45.0 + 40.0 * base_anomaly(lon, lat, t) / 305.0 * np.exp(-(((la - 45.0) / 30.0) ** 2)) * math.cos(math.radians(t / 3.0))
    base = np.clip(base, 0.0, 100.0)
    m = _pin_weight(lat, lon, HOME[0], HOME[1], PIN_R)
    return base * (1 - m) + rain_target(t) * m


def ivt_field(lon, lat, t):
    la = lat[:, None]
    lo = (((lon + 180.0) % 360.0) - 180.0)[None, :]  # np05 runs 150..310 E: wrap to -180..180
    base = 120.0 + 120.0 * np.exp(-(((la - 40.0) / 18.0) ** 2)) * (0.6 + 0.4 * np.cos(3 * np.radians(lo) - math.radians(1.2 * t)))
    d = (la - ARROW_LINE(lo)) / math.sqrt(1.25)
    taper = np.exp(-((np.maximum(0.0, np.abs(lo + 135.0) - 20.0) / 8.0) ** 2))
    amp = 900.0 * (1 + 0.05 * math.sin(2 * math.pi * t / 96.0))
    return base + amp * np.exp(-((d / 3.0) ** 2)) * taper


def t850_anom(lon, lat, t):
    a = 0.04 * base_anomaly(lon, lat, t)
    lat_i, lon_i = lat[:, None] * np.ones((1, len(lon))), lon[None, :] * np.ones((len(lat), 1))
    blk = (lat_i >= NODATA_BLOCK[0]) & (lat_i <= NODATA_BLOCK[1]) & (lon_i >= NODATA_BLOCK[2]) & (lon_i <= NODATA_BLOCK[3])
    return np.where(blk, np.nan, a)


def t2m_field(lon, lat, t):
    la = lat[:, None]
    return 300.0 - 0.55 * np.abs(la) + 0.032 * base_anomaly(lon, lat, t) + 3.0 * math.cos(2 * math.pi * t / 24.0) * np.cos(np.radians(la))


def home_tp6(t_end):
    """Home tp6 per 6 h step, agreeing with pr1: 0.1 mm a step (0.4 mm a day, dry) through day 3, 4 mm a step (16 mm a day) from day 4."""
    return 0.1 if t_end <= 72 else 4.0


def tp6_field(lon, lat, t):
    la = lat[:, None]
    base = 8 * np.maximum(0, base_anomaly(lon, lat, t) / 305.0) ** 2 * np.exp(-(((la - 45.0) / 15.0) ** 2))
    m = _pin_weight(lat, lon, HOME[0], HOME[1], PIN_R)
    return base * (1 - m) + home_tp6(t) * m


def _iso(run, hours):
    r = dt.datetime.strptime(run, "%Y-%m-%dT%H:%MZ")
    return [(r + dt.timedelta(hours=h)).strftime("%Y-%m-%dT%H:%MZ") for h in hours]


def _pt(b, out, name, fid, dom, step, lat, lon, allow_null=False):
    if (fid, dom) in b.decoded and step in b.decoded[(fid, dom)]:
        out.append(b.probe(name, lat, lon, fid, dom, step, allow_null))


def fixture_15d(outdir, variant="full"):
    """variant: full | nomean | partial. All three share every formula, so the same point means the same thing."""
    steps_all = HOURS if variant != "partial" else list(range(0, 49, 6))
    b = Builder(outdir, D15)
    ax = {k: axes(v) for k, v in D15.items()}
    src = {"dataset": "synthetic 15-day fixture (W1-02), analytic", "valid": None}

    def stack(fn, dom, steps):
        lon, lat = ax[dom]
        return np.stack([fn(lon, lat, t) for t in steps])

    def both(fn, steps):
        return {dom: stack(fn, dom, steps) for dom in D15}

    zfun = lambda lon, lat, t: clim500(lat, lon) + anomaly(lon, lat, t)
    b.add("z500", steps_all, both(zfun, steps_all), "A", src)
    b.add("z500a", steps_all, both(lambda lo, la, t: anomaly(lo, la, t), steps_all), "A", src)
    if variant != "partial":
        b.add("z500sd", steps_all, both(spread, steps_all), "A", src)
    if variant == "full":
        b.add("z500em", STEPS_EM, both(lambda lo, la, t: clim500(la, lo) + anomaly_em(lo, la, t), STEPS_EM), "A", src)
    b.add("ws250", steps_all, both(wind250, steps_all), "A", src)
    b.add("msl", steps_all, both(mslp, steps_all), "A", src)
    steps_tp = [s for s in steps_all if s > 0]
    b.add("tp6", steps_tp, {"g1": stack(tp6_field, "g1", steps_tp)}, "A", src)
    fields = ["z500", "z500a", "ws250", "msl", "tp6"]
    if variant != "partial":
        steps_168 = STEPS_168
        b.add("t850a", steps_168, {"g1": stack(t850_anom, "g1", steps_168)}, "A", src)
        b.add("t2m", steps_168, {"g1": stack(t2m_field, "g1", steps_168)}, "A", src)
        lon, lat = ax["g1"]
        r1 = [rain1(lon, lat, t) for t in STEPS_PR]
        b.add("pr1", STEPS_PR, {"g1": np.stack(r1)}, "A", src)
        b.add("pr10", STEPS_PR, {"g1": np.stack([0.4 * np.rint(x) for x in r1])}, "A", src)
        b.add("ivt", steps_168, both(ivt_field, steps_168), "A", src)
        fields = ["z500", "z500a", "z500sd"] + (["z500em"] if variant == "full" else []) + ["ws250", "msl", "tp6", "t850a", "t2m", "pr1", "pr10", "ivt"]
    head = {
        "schema": 1, "sample": True,
        "sample_note": {"full": "synthetic test data: every field, every state; not a forecast",
                        "nomean": "synthetic test data: a 15-day run whose ensemble mean (z500em) is late; not a forecast",
                        "partial": "synthetic test data: a partial 0-48 h build with no spread field; not a forecast"}[variant],
        "model": "Synthetic test fixture (15-day)" if variant == "full" else f"Synthetic test fixture ({variant})",
        "run": RUN, "generated": GENERATED,
        "attribution": "synthetic test data, no source",
        "climatology": {"label": "synthetic", "source": "analytic", "method": "analytic"},
        "cases": {"A": {"label": "Synthetic states", "fields": fields}},
    }
    if variant == "nomean":
        head["missing"] = [{"field": "z500em", "reason": "ensemble mean not in this run (the ensemble files were late)"}]
    if variant == "partial":
        head["missing"] = [{"field": "z500sd", "reason": "ensemble spread not in this build (partial run, 0-48 h only)"}]

    P = []
    for name, (clat, clon, _t, _w) in PINS.items():
        for dom in D15:
            if name == "band+11dam":
                _pt(b, P, name, "z500a", dom, 0, clat, clon)
                _pt(b, P, name, "z500a", dom, 300, clat, clon)
            elif name in ("no-signal", "clear-signal"):
                _pt(b, P, name, "z500a", dom, 300, clat, clon)
                _pt(b, P, name + ".spread", "z500sd", dom, 300, clat, clon)
                _pt(b, P, name + ".mean", "z500em", dom, 300, clat, clon)
                _pt(b, P, name + ".clim", "z500", dom, 300, clat, clon)  # z500 at the node; clim = z500 - z500a
            elif name == "blend-bands":
                for st in (168, 204, 240):
                    _pt(b, P, name, "z500a", dom, st, clat, clon)
                    _pt(b, P, name + ".mean", "z500em", dom, st, clat, clon)
                    _pt(b, P, name + ".z500", "z500", dom, st, clat, clon)
            elif name == "sf-day9":
                _pt(b, P, name, "z500a", dom, 216, clat, clon)
            else:
                _pt(b, P, name, "z500a", dom, 0, clat, clon)
    for d in range(1, 8):
        _pt(b, P, f"home-rain-d{d}", "pr1", "g1", 24 * d, HOME[0], HOME[1])
        _pt(b, P, f"home-rain-d{d}.pr10", "pr10", "g1", 24 * d, HOME[0], HOME[1])
        for k in range(4):  # the four 6 h steps of local day d (HOME is at longitude 0, so local = UTC days): the card sums these (DESIGN-SPEC 7.3, under 1 mm = dry)
            _pt(b, P, f"home-tp6-d{d}", "tp6", "g1", 24 * (d - 1) + 6 * (k + 1), HOME[0], HOME[1])
    for dom in D15:
        for st in (0, 72):
            _pt(b, P, "ivt-filament", "ivt", dom, st, 40, -130)
            _pt(b, P, "closed-low", "msl", dom, st, LOW[0], LOW[1])
    for st in (0, 72):
        _pt(b, P, "t850a-nodata", "t850a", "g1", st, 40, -110, allow_null=True)
        _pt(b, P, "t850a-valid", "t850a", "g1", st, 40, -90)
    b.write(head, P)


def fixture_recorded_min(outdir):
    steps = list(range(0, 241, 12))
    b = Builder(outdir, D15)
    ax = {k: axes(v) for k, v in D15.items()}
    valid = _iso(RUN, steps)
    src = {"dataset": "synthetic recorded-shape fixture (W1-02), analytic", "valid": valid}

    def both(fn):
        return {dom: np.stack([fn(ax[dom][0], ax[dom][1], t) for t in steps]) for dom in D15}

    b.add("z500", steps, both(lambda lo, la, t: clim500(la, lo) + anomaly(lo, la, t)), None, src)
    b.add("z500a", steps, both(lambda lo, la, t: anomaly(lo, la, t)), None, src)
    b.add("z500sd", steps, both(spread), None, src)
    head = {
        "schema": 1, "sample": True,
        "sample_note": "synthetic test data in the shape of one recorded run; not a forecast",
        "sample_label": "Recorded run shape (synthetic stand-in), run 2026-11-17 00Z",
        "model": "Synthetic test fixture (recorded shape)", "run": RUN, "generated": GENERATED,
        "attribution": "synthetic test data, no source",
        "climatology": {"label": "synthetic", "source": "analytic", "method": "analytic"},
    }
    P = make_probes(b, "z500a", 0) + make_probes(b, "z500a", 120) + make_probes(b, "z500sd", 120)
    b.write(head, P)


# Hi-res 48 h: the real grids, one exactly circular Gaussian-profile anomaly: +20 dam at the centre, +10 dam on the
# circle of radius 12 degrees (half-maximum), measured as degree distance on the lat/lon plane.
CIRCLE = (46, -160)
CIRCLE_R = 12.0


def fixture_hires(outdir):
    steps = list(range(0, 49, 6))
    b = Builder(outdir, REAL_DOMAINS)
    ax = {k: axes(v) for k, v in REAL_DOMAINS.items()}
    src = {"dataset": "synthetic hi-res fixture (W1-02), analytic circle", "valid": None}

    def circ(lon, lat, t):
        r = _dist(lat, lon, CIRCLE[0], CIRCLE[1])
        return 200.0 * np.exp(-math.log(2.0) * (r / CIRCLE_R) ** 2)

    def both(fn, st=steps):
        return {dom: np.stack([fn(ax[dom][0], ax[dom][1], t) for t in st]) for dom in REAL_DOMAINS}

    b.add("z500", steps, both(lambda lo, la, t: clim500(la, lo) + circ(lo, la, t)), "A", src)
    b.add("z500a", steps, both(circ), "A", src)
    b.add("z500sd", steps, both(lambda lo, la, t: 20.0 + 0.0 * circ(lo, la, t)), "A", src)
    b.add("ws250", steps, both(lambda lo, la, t: 20.0 + 30.0 * np.exp(-(((la[:, None] - 40.0) / 15.0) ** 2)) * np.ones((1, len(lo)))), "A", src)
    b.add("msl", steps, both(lambda lo, la, t: 101325.0 + 400.0 * np.sin(np.radians(la))[:, None] * np.ones((1, len(lo)))), "A", src)
    stp = [s for s in steps if s > 0]
    b.add("tp6", stp, {"g1": np.stack([0.5 * np.exp(-(((ax["g1"][1][:, None] - 30.0) / 10.0) ** 2)) * np.ones((1, len(ax["g1"][0]))) for _ in stp])}, "A", src)
    head = {
        "schema": 1, "sample": True,
        "sample_note": "synthetic test data: the real grids with one exactly circular anomaly; not a forecast",
        "model": "Synthetic test fixture (hi-res 48 h)", "run": RUN, "generated": GENERATED,
        "attribution": "synthetic test data, no source",
        "climatology": {"label": "synthetic", "source": "analytic", "method": "analytic"},
        "cases": {"A": {"label": "Synthetic circle", "fields": ["z500", "z500a", "z500sd", "ws250", "msl", "tp6"]}},
    }
    P = []
    for dom in REAL_DOMAINS:
        _pt(b, P, "circle-centre", "z500a", dom, 0, CIRCLE[0], CIRCLE[1])
        _pt(b, P, "circle-edge-east", "z500a", dom, 0, CIRCLE[0], CIRCLE[1] + 12)
        _pt(b, P, "circle-edge-north", "z500a", dom, 0, CIRCLE[0] + 12, CIRCLE[1])
        _pt(b, P, "circle-outside", "z500a", dom, 0, CIRCLE[0], CIRCLE[1] + 30)
    b.write(head, P)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("which", choices=["synthetic", "sample-min", "synthetic-15d", "synthetic-15d-nomean",
                                      "synthetic-partial", "recorded-min", "synthetic-hires-48h"])
    ap.add_argument("--fixtures", default=os.environ.get("WSE_FIXTURES"))
    ap.add_argument("--out")
    a = ap.parse_args()
    out = a.out or os.path.join(REPO, "tests", "site", "fixtures", a.which)
    if a.which == "synthetic":
        synthetic(out)
    elif a.which == "synthetic-15d":
        fixture_15d(out, "full")
    elif a.which == "synthetic-15d-nomean":
        fixture_15d(out, "nomean")
    elif a.which == "synthetic-partial":
        fixture_15d(out, "partial")
    elif a.which == "recorded-min":
        fixture_recorded_min(out)
    elif a.which == "synthetic-hires-48h":
        fixture_hires(out)
    else:
        if not a.fixtures:
            sys.exit("sample-min needs --fixtures or WSE_FIXTURES (the spike fixture directory)")
        sample_min(out, a.fixtures)


if __name__ == "__main__":
    main()
