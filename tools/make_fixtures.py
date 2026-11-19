"""Build the two small site-test fixtures.

  synthetic   tests/site/fixtures/synthetic/   analytic travelling wave, test-only, never published
  sample-min  tests/site/fixtures/sample-min/  real data from the spike fixtures (SPEC section 11)

Run with the isolated interpreter (the spike venv has numpy, xarray, cfgrib):

  python -I tools/make_fixtures.py synthetic
  python -I tools/make_fixtures.py sample-min --fixtures "$WSE_FIXTURES"

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

    def add(self, fid, steps, grids, case=None, source=None):
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

    def probe(self, name, lat, lon, fid, dom, step):
        d = self.domains[dom]
        units, scale, offset = FIELD_META[fid]
        i = int(round(((lon - d["lon0"]) % 360) / d["dlon"])) if dom != "g1" else int(round((lon - d["lon0"]) / d["dlon"]))
        j = int(round((lat - d["lat0"]) / d["dlat"]))
        if not (0 <= i < d["nx"] and 0 <= j < d["ny"]):
            return None
        q = int(self.decoded[(fid, dom)][step][j, i])
        if q == NODATA:
            return None
        return {"name": name, "lat": lat, "lon": lon, "field": fid, "domain": dom, "step": step,
                "value": round(q * scale + offset, 6)}

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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("which", choices=["synthetic", "sample-min"])
    ap.add_argument("--fixtures", default=os.environ.get("WSE_FIXTURES"))
    ap.add_argument("--out")
    a = ap.parse_args()
    out = a.out or os.path.join(REPO, "tests", "site", "fixtures", a.which)
    if a.which == "synthetic":
        synthetic(out)
    else:
        if not a.fixtures:
            sys.exit("sample-min needs --fixtures or WSE_FIXTURES (the spike fixture directory)")
        sample_min(out, a.fixtures)


if __name__ == "__main__":
    main()
