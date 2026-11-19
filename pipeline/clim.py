"""Build the climatology (`harmonics.npz`) for z500 and t850.

Primary: WeatherBench2 ERA5 hourly climatology 1990-2019 (1.5 degree, `geopotential` / g and `temperature` at
500 and 850 hPa, the four `hour` slices averaged). Anonymous bucket access is unverified from the build
workspace, so a failure falls back automatically to NOAA PSL NCEP/NCAR Reanalysis 1 long-term means 1991-2020,
daily and then monthly. The baseline that was actually used is written into the file (`meta.baseline`) and from
there into the manifest, so the footer never claims a baseline the anomaly was not computed against.

`wb2_dataset`, `fetch_file` and the data readers are injectable for tests; nothing here runs on every data run.
"""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import os
import sys

import numpy as np

from . import anomaly

LOG = logging.getLogger("pipeline.clim")

G = 9.80665
WB2_URL = ("gs://weatherbench2/datasets/era5-hourly-climatology/"
           "1990-2019_6h_240x121_equiangular_with_poles_conservative.zarr")
PSL_BASE = "https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis.derived/pressure/"
MONTH_MID_DOY = [15.5, 45.0, 74.5, 105.0, 135.5, 166.0, 196.5, 227.5, 258.0, 288.5, 319.0, 349.5]

# Plausible area-mean ranges used to catch a unit slip before it reaches every anomaly.
SANITY = {"z500": (5000.0, 5900.0), "t850": (240.0, 300.0)}


def open_wb2():
    import xarray as xr
    return xr.open_zarr(WB2_URL, storage_options={"token": "anon"}, consolidated=True)


def _descending(lat, lon, arr):
    """Orient (..., lat, lon) so latitude runs north to south and longitude is 0..360 ascending."""
    lat = np.asarray(lat, float)
    lon = np.mod(np.asarray(lon, float), 360.0)
    if lat[0] < lat[-1]:
        lat, arr = lat[::-1], arr[..., ::-1, :]
    order = np.argsort(lon)
    return lat, lon[order], arr[..., order]


def from_wb2(ds):
    """WB2 climatology dataset -> (lat, lon, {var: coefficients}, meta). Dims: hour, dayofyear, level, lat, lon."""
    lat_n = "latitude" if "latitude" in ds.coords else "lat"
    lon_n = "longitude" if "longitude" in ds.coords else "lon"
    planes = {}
    for var, name, lev, div in (("z500", "geopotential", 500, G), ("t850", "temperature", 850, 1.0)):
        da = ds[name].sel(level=lev)
        if "hour" in da.dims:
            da = da.mean("hour")
        da = da.transpose("dayofyear", lat_n, lon_n)
        doy = np.asarray(da["dayofyear"].values, float)
        lat, lon, arr = _descending(da[lat_n].values, da[lon_n].values, np.asarray(da.values, np.float64) / div)
        # four hourly slices (0, 6, 12, 18) average to a mean valid hour of 9
        planes[var] = anomaly.fit_harmonics(doy - 1.0 + 9.0 / 24.0, arr)
    meta = {"label": "ERA5 1990-2019", "source": "WeatherBench2",
            "method": "annual mean + 3 harmonics",
            "baseline": "ERA5 hourly climatology 1990-2019, WeatherBench2 240x121 conservative"}
    return lat, lon, planes, meta


def _is_celsius(units, arr):
    u = str(units).lower().replace(" ", "")
    if u in ("degc", "celsius", "c", "degreec", "degrees_c", "degree_c", "degreesc"):
        return True
    if u in ("k", "degk", "kelvin", "degreek"):
        return False
    return float(np.nanmean(arr)) < 100.0  # units attribute missing or odd: judge by size


def _psl_plane(ds_path, name, monthly):
    import xarray as xr
    ds = xr.open_dataset(ds_path, decode_times=False)
    level = ds["level"].values
    da = ds[name].isel(level=int(np.argmin(np.abs(level - (500 if name == "hgt" else 850)))))
    arr = np.asarray(da.values, np.float64)
    lat, lon, arr = _descending(ds["lat"].values, ds["lon"].values, arr)
    if name == "air" and _is_celsius(da.attrs.get("units", ""), arr):
        arr = arr + 273.15
    n = arr.shape[0]
    t = np.array(MONTH_MID_DOY[:n]) - 1.0 if monthly else np.arange(n) + 0.5
    ds.close()
    return lat, lon, anomaly.fit_harmonics(t, arr)


def from_psl(hgt_path, air_path, monthly=False):
    lat, lon, z = _psl_plane(hgt_path, "hgt", monthly)
    _, _, t = _psl_plane(air_path, "air", monthly)
    kind = "monthly" if monthly else "daily"
    meta = {"label": "NCEP/NCAR Reanalysis 1 1991-2020", "source": f"NOAA PSL long-term mean ({kind})",
            "method": "annual mean + 3 harmonics",
            "baseline": f"NCEP/NCAR Reanalysis 1 {kind} long-term mean 1991-2020, 2.5 degree"}
    return lat, lon, {"z500": z, "t850": t}, meta


def fetch_file(url, dest, timeout=120):
    """Stream a URL to a file (the PSL daily files are about 250 MB each)."""
    import requests
    with requests.get(url, stream=True, timeout=timeout) as r:
        r.raise_for_status()
        with open(dest, "wb") as fh:
            for chunk in r.iter_content(1 << 20):
                fh.write(chunk)
    return dest


def sanity(lat, lon, planes):
    """Annual-mean 40-60N mean of each variable must sit in a plausible range."""
    sel = (np.asarray(lat) >= 40) & (np.asarray(lat) <= 60)
    for var, (lo, hi) in SANITY.items():
        m = float(np.mean(planes[var][0][sel]))
        if not lo <= m <= hi:
            raise ValueError(f"{var} annual mean over 40-60N is {m:.1f}, outside {lo}-{hi}: wrong units or level?")


def build(out_path, workdir, prefer="wb2", wb2_dataset=open_wb2, download=fetch_file):
    """Try the baselines in order, save the first that passes the sanity check, return its meta dict."""
    attempts = []
    if prefer == "wb2":
        attempts.append(("wb2", lambda: from_wb2(wb2_dataset())))
    attempts.append(("psl-daily", lambda: _psl(workdir, download, False)))
    attempts.append(("psl-monthly", lambda: _psl(workdir, download, True)))
    errors = []
    for name, fn in attempts:
        try:
            lat, lon, planes, meta = fn()
            sanity(lat, lon, planes)
            meta = dict(meta, built=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), attempt=name,
                        skipped=[e for e in errors])
            anomaly.save(out_path, lat, lon, planes, meta)
            LOG.info("climatology built from %s", name)
            return meta
        except Exception as e:  # noqa: BLE001 - any failure moves to the next baseline
            errors.append(f"{name}: {type(e).__name__}: {str(e)[:200]}")
            LOG.warning("baseline %s failed: %s", name, errors[-1])
    raise RuntimeError("no climatology baseline worked: " + " | ".join(errors))


def _psl(workdir, download, monthly):
    kind = "mon" if monthly else "day"
    paths = {}
    try:
        for v in ("hgt", "air"):
            paths[v] = download(f"{PSL_BASE}{v}.{kind}.ltm.1991-2020.nc", os.path.join(workdir, f"{v}.{kind}.ltm.nc"))
        return from_psl(paths["hgt"], paths["air"], monthly)
    finally:
        for p in paths.values():
            try:
                os.remove(p)
            except OSError:
                pass


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build harmonics.npz for z500 and t850.")
    ap.add_argument("--out", default="out/clim/harmonics.npz")
    ap.add_argument("--workdir", default="out/clim/work")
    ap.add_argument("--prefer", choices=["wb2", "psl"], default="wb2")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    os.makedirs(a.workdir, exist_ok=True)
    meta = build(a.out, a.workdir, a.prefer)
    print(f"climatology: {meta['label']} ({meta['attempt']}) -> {a.out} ({os.path.getsize(a.out)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
