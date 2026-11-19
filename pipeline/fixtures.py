"""Sample mode (SPEC section 11): the app's data built from the real fixture files, nothing synthesized.

Each source is a case; the app shows one case at a time. Step 0 of every case is rebased to `today` 00Z for
layout, while `source.valid` keeps the real valid times so the legend and badge can print them.

  A  z500, z500a, z500sd on g1 and np05   ERA5 EDA members (3 deg, bilinear), anomaly vs ERA-Interim January mean
  B  ws250 on np05                        GFS 0.5 deg, Hurricane Irma, 5-6 Sep 2017, 6-hourly
  C  t2a on np05                          NCEP/NCAR 4xdaily air temperature minus its 2013-14 mean, 15 days
  D  msl on np05                          GFS_test.nc, 26 Oct 2010
  E  ivt on np05                          narr_example.nc (native-grid IVT, then interpolated), 4 Apr 1987
"""
from __future__ import annotations

import datetime as dt
import os
import warnings

import numpy as np

from . import reduce
from .encode import ManifestWriter, iso_minute
from .grids import DOMAINS, axes, orient, resample

G = 9.80665
CASE_C_STEPS = 61  # 0-360 h, 6-hourly


def _iso(t):
    return str(np.datetime_as_string(t, unit="m")) + "Z"


def _hours(times):
    return [int((t - times[0]) / np.timedelta64(1, "h")) for t in times]


def _open(path, **kw):
    import xarray as xr
    return xr.open_dataset(path, **kw)


def case_a(fx):
    ds = _open(os.path.join(fx, "era5-levels-members.grib"), engine="cfgrib", backend_kwargs={"indexpath": ""})
    z = ds.z.sel(isobaricInhPa=500).transpose("time", "number", "latitude", "longitude").values / G
    times = ds.valid_time.values
    zmean, zsd = z.mean(axis=1), z.std(axis=1, ddof=1)
    ei = _open(os.path.join(fx, "eraint_uvz.nc"))
    clim = ei.z.sel(month=1, level=500).values / G  # 0.75 deg, lon -180..179.25, lat 90..-90
    clim, cg = orient(clim, ei["latitude"].values, ei["longitude"].values)
    _, sg = orient(zmean[0], ds.latitude.values, ds.longitude.values)
    steps = _hours(times)
    out = {"z500": {}, "z500a": {}, "z500sd": {}}
    for dom in DOMAINS:
        ct = resample(clim, cg, DOMAINS[dom])
        zs = np.stack([resample(orient(zmean[i], ds.latitude.values, ds.longitude.values)[0], sg, DOMAINS[dom]) for i in range(len(steps))])
        sd = np.stack([resample(orient(zsd[i], ds.latitude.values, ds.longitude.values)[0], sg, DOMAINS[dom]) for i in range(len(steps))])
        out["z500"][dom] = zs
        out["z500a"][dom] = zs - ct
        out["z500sd"][dom] = sd
    src = {"dataset": "ERA5 EDA (era5-levels-members.grib), 3 deg, bilinear; anomaly vs ERA-Interim January mean (eraint_uvz.nc)",
           "file": "era5-levels-members.grib", "valid": [_iso(t) for t in times]}
    return steps, out, src


def case_b(fx):
    ir = _open(os.path.join(fx, "irma_gfs_example.nc"))
    u = ir["u-component_of_wind_isobaric"].sel(isobaric3=25000.0).values
    v = ir["v-component_of_wind_isobaric"].sel(isobaric3=25000.0).values
    ws = reduce.wind_speed(u, v)[::2]  # 3-hourly -> 6-hourly, speed on the native grid first
    t1 = ir.time1.values[::2]
    _, g = orient(ws[0], ir.latitude.values, ir.longitude.values)
    grids = np.stack([resample(orient(w, ir.latitude.values, ir.longitude.values)[0], g, DOMAINS["np05"]) for w in ws])
    src = {"dataset": "NOAA GFS 0.5 deg, Hurricane Irma example (irma_gfs_example.nc), covers 110W-45W only",
           "file": "irma_gfs_example.nc", "valid": [_iso(t) for t in t1]}
    return _hours(t1), {"np05": grids}, src


def case_c(fx):
    at = _open(os.path.join(fx, "air_temperature.nc"))
    anom = (at.air - at.air.mean("time")).values[:CASE_C_STEPS]
    tt = at.time.values[:CASE_C_STEPS]
    _, g = orient(anom[0], at.lat.values, at.lon.values)
    grids = np.stack([resample(orient(a, at.lat.values, at.lon.values)[0], g, DOMAINS["np05"]) for a in anom])
    src = {"dataset": "NCEP/NCAR reanalysis 4xdaily air temperature at sigma 0.995 (air_temperature.nc), minus its 2013-2014 mean",
           "file": "air_temperature.nc", "valid": [_iso(t) for t in tt]}
    return _hours(tt), {"np05": grids}, src


def case_d(fx):
    ds = _open(os.path.join(fx, "GFS_test.nc"))
    p = ds["Pressure_reduced_to_MSL_msl"].values[0]
    a, g = orient(p, ds.lat.values, ds.lon.values)
    src = {"dataset": "NOAA GFS 1 deg analysis, sea-level pressure (GFS_test.nc)", "file": "GFS_test.nc",
           "valid": [_iso(ds.time.values[0])]}
    return [0], {"np05": resample(a, g, DOMAINS["np05"])[None]}, src


def case_e(fx):
    from scipy.interpolate import griddata
    ds = _open(os.path.join(fx, "narr_example.nc"))
    lev = ds["isobaric"].values
    keep = np.where(lev >= 300)[0]  # 1000 to 300 hPa
    sel = ds.isel(time=0, isobaric=keep)
    ivt = reduce.ivt(sel["Specific_humidity"].values, sel["u_wind"].values, sel["v_wind"].values, lev[keep])
    lon, lat = axes(DOMAINS["np05"])
    pts = np.column_stack([np.mod(ds["lon"].values.ravel(), 360.0), ds["lat"].values.ravel()])
    LON, LAT = np.meshgrid(lon, lat)
    grid = griddata(pts, ivt.ravel(), (LON, LAT), method="linear")  # NaN outside the NARR domain
    src = {"dataset": "NARR (narr_example.nc), IVT from q, u, v on 1000-300 hPa computed on the native Lambert grid, "
                      "then interpolated", "file": "narr_example.nc", "valid": [_iso(ds.time.values[0])]}
    return [0], {"np05": grid.astype(np.float32)[None]}, src


CASES = [
    ("A", "ERA5, 1-2 Jan 2017", [("z500", case_a), ("z500a", None), ("z500sd", None)]),
    ("B", "GFS, Hurricane Irma, 5-6 Sep 2017", [("ws250", case_b)]),
    ("C", "Motion demo: 15 days of surface temperature, 2013", [("t2a", case_c)]),
    ("D", "GFS sea-level pressure, 26 Oct 2010", [("msl", case_d)]),
    ("E", "NARR vapour transport, 4 Apr 1987", [("ivt", case_e)]),
]


def build_fixture(fixtures, out, today=None, generated=None):
    """Write the sample dataset into `out` and return its manifest dict. `today` (date) rebases step 0."""
    warnings.filterwarnings("ignore")
    today = today or dt.datetime.now(dt.timezone.utc).date()
    run = dt.datetime(today.year, today.month, today.day, tzinfo=dt.timezone.utc)
    w = ManifestWriter(out)
    cases = {}
    for cid, label, fields in CASES:
        fn = fields[0][1]
        steps, grids, src = fn(fixtures)
        if cid == "A":
            for fid in ("z500", "z500a", "z500sd"):
                w.add_field(fid, steps, grids[fid], cid, src)
        else:
            fid = fields[0][0]
            w.add_field(fid, steps, grids, cid, src)
        cases[cid] = {"label": label, "fields": [f for f, _ in fields]}
    head = {
        "schema": 1, "sample": True, "sample_note": "real fixture data, rebased to today; not a forecast",
        "model": "Sample data (ERA5, GFS, NCEP/NCAR and NARR fixtures)", "run": iso_minute(run),
        "generated": generated or iso_minute(dt.datetime.now(dt.timezone.utc)),
        "attribution": "ERA5 (Copernicus/ECMWF), NOAA GFS, NCEP/NCAR reanalysis and NARR; xarray-data, MetPy and cfgrib test files",
        "climatology": {"label": "ERA-Interim January mean, period not documented", "source": "eraint_uvz.nc",
                        "method": "monthly mean"},
        "cases": cases,
    }
    return w.write(head)
