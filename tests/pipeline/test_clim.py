"""P-CLIM: the harmonic climatology builders, with WeatherBench2 and PSL stood in by constructed datasets that
mimic their layouts (anonymous bucket access and the real files are exercised by the first `clim.yml` run)."""
import datetime as dt
import os

import numpy as np
import pytest
import xarray as xr

from pipeline import anomaly, clim

G = 9.80665
DAYS = np.arange(1, 367)


def wb2_dataset(z_scale=G, lat_ascending=True, t_offset=0.0):
    """Layout of the WB2 hourly climatology: dims hour, dayofyear, level, latitude (ascending), longitude 0..358.5."""
    lat = np.linspace(-90, 90, 13)
    lon = np.arange(0, 360, 30.0)
    level = np.array([50, 500, 850, 1000])
    hour = np.array([0, 6, 12, 18])
    th = 2 * np.pi * (DAYS - 1 + 9 / 24) / anomaly.YEAR_DAYS
    seasonal = np.cos(th)[None, :, None, None, None]
    z = (5500 + 0.4 * lat[None, None, None, :, None] + 80 * seasonal + 0 * hour[:, None, None, None, None]) * z_scale
    z = np.broadcast_to(z, (4, 366, 1, 13, 12)).copy()
    z = np.concatenate([z * 0 + 1.0, z, z * 0 + 2.0, z * 0 + 3.0], axis=2)  # decoy levels carry other numbers
    t = np.broadcast_to(270.0 + 5 * seasonal + t_offset, (4, 366, 4, 13, 12)).copy()
    if not lat_ascending:
        lat, z, t = lat[::-1], z[..., ::-1, :], t[..., ::-1, :]
    dims = ("hour", "dayofyear", "level", "latitude", "longitude")
    return xr.Dataset({"geopotential": (dims, z), "temperature": (dims, t)},
                      coords={"hour": hour, "dayofyear": DAYS, "level": level, "latitude": lat, "longitude": lon})


def test_wb2_geopotential_is_divided_by_g_levels_are_selected_and_lat_runs_north_to_south():
    lat, lon, planes, meta = clim.from_wb2(wb2_dataset())
    assert lat[0] == 90 and lat[-1] == -90 and lon[0] == 0
    z = planes["z500"]  # coefficients (7, 13, 12)
    assert z[0, 0, 0] == pytest.approx(5500 + 0.4 * 90, abs=0.05)  # mean at the north pole row, not the decoys 1.0/2.0/3.0
    assert z[1, 6, 0] == pytest.approx(80, abs=0.1) and abs(z[2, 6, 0]) < 0.1  # cos term only
    assert planes["t850"][0, 3, 3] == pytest.approx(270.0, abs=0.01) and planes["t850"][1, 3, 3] == pytest.approx(5.0, abs=0.01)
    assert meta["label"] == "ERA5 1990-2019" and meta["source"] == "WeatherBench2" and "3 harmonics" in meta["method"]


def test_wb2_orientation_does_not_matter():
    a = clim.from_wb2(wb2_dataset(lat_ascending=True))
    b = clim.from_wb2(wb2_dataset(lat_ascending=False))
    assert np.allclose(a[0], b[0]) and np.allclose(a[2]["z500"], b[2]["z500"], atol=1e-3)


def write_psl(path, var, values, units, nt=365):
    lat = np.linspace(90, -90, 13)
    lon = np.arange(0, 360, 30.0)
    level = np.array([1000, 850, 500, 300])[::1]
    arr = np.broadcast_to(values[:nt, None, None, None], (nt, 4, 13, 12)).copy()
    arr[:, [0, 1, 3]] = -999.0  # decoy levels
    ds = xr.Dataset({var: (("time", "level", "lat", "lon"), arr.astype(np.float32), {"units": units})},
                    coords={"time": np.arange(nt, dtype=float), "level": level.astype(float), "lat": lat, "lon": lon})
    ds.to_netcdf(path)


def psl_files(work, celsius=True, monthly=False):
    n = 12 if monthly else 365
    t = (np.array(clim.MONTH_MID_DOY) if monthly else np.arange(n) + 0.5)
    th = 2 * np.pi * t / anomaly.YEAR_DAYS
    # PSL: hgt in metres at 500 hPa (level index 2), air in degC at 850 hPa -> but decoys elsewhere
    hgt = 5500 + 60 * np.cos(th)
    air = (-3.0 + 4 * np.cos(th)) if celsius else (270.15 + 4 * np.cos(th))
    kind = "mon" if monthly else "day"
    hp, ap = work / f"hgt.{kind}.nc", work / f"air.{kind}.nc"
    write_psl(hp, "hgt", hgt, "m", n)
    # air: the 850 hPa level is index 1 here, so write it onto that level and decoy the rest
    lat = np.linspace(90, -90, 13)
    lon = np.arange(0, 360, 30.0)
    arr = np.full((n, 4, 13, 12), -999.0, np.float32)
    arr[:, 1] = air[:, None, None]
    xr.Dataset({"air": (("time", "level", "lat", "lon"), arr, {"units": "degC" if celsius else "K"})},
               coords={"time": np.arange(n, dtype=float), "level": [1000.0, 850.0, 500.0, 300.0], "lat": lat, "lon": lon}).to_netcdf(ap)
    return str(hp), str(ap)


@pytest.mark.parametrize("monthly", [False, True])
def test_psl_daily_and_monthly_give_the_same_annual_cycle(work, monthly):
    hp, ap = psl_files(work, monthly=monthly)
    lat, lon, planes, meta = clim.from_psl(hp, ap, monthly)
    assert planes["z500"][0, 2, 2] == pytest.approx(5500, abs=0.5) and planes["z500"][1, 2, 2] == pytest.approx(60, abs=0.5)
    assert planes["t850"][0, 2, 2] == pytest.approx(-3.0 + 273.15, abs=0.05)  # degC -> K
    assert ("monthly" if monthly else "daily") in meta["source"] and meta["label"] == "NCEP/NCAR Reanalysis 1 1991-2020"


def test_psl_kelvin_is_left_alone(work):
    hp, ap = psl_files(work, celsius=False)
    assert clim.from_psl(hp, ap)[2]["t850"][0, 2, 2] == pytest.approx(270.15, abs=0.05)


def fake_download(work, **kw):
    """download(url, dest) that copies the locally built PSL file for that variable."""
    src = {"day": psl_files(work), "mon": psl_files(work, monthly=True)}
    calls = []

    def dl(url, dest):
        calls.append(url)
        if kw.get("fail_day") and ".day." in url:
            raise OSError("daily file unreachable")
        kind = "day" if ".day." in url else "mon"
        path = src[kind][0 if "/hgt." in url else 1]
        import shutil
        shutil.copy(path, dest)
        return dest
    dl.calls = calls
    return dl


def boom():
    raise PermissionError("anonymous access refused (403)")


def test_build_uses_wb2_when_it_works_and_records_the_baseline(work):
    out = work / "h.npz"
    meta = clim.build(str(out), str(work), wb2_dataset=wb2_dataset, download=lambda *a: pytest.fail("PSL must not be touched"))
    assert meta["attempt"] == "wb2" and meta["skipped"] == []
    c = anomaly.Climatology.load(out)
    assert c.description["label"] == "ERA5 1990-2019" and "WeatherBench2" in c.meta["baseline"]
    assert c.at("z500", "g1", dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc))[90, 180] == pytest.approx(5500 + 80, abs=2.0)


def test_build_falls_back_to_psl_daily_when_wb2_refuses_and_says_so(work):
    out = work / "h.npz"
    dl = fake_download(work)
    meta = clim.build(str(out), str(work), wb2_dataset=boom, download=dl)
    assert meta["attempt"] == "psl-daily" and meta["skipped"][0].startswith("wb2: PermissionError")
    c = anomaly.Climatology.load(out)
    assert c.description["label"] == "NCEP/NCAR Reanalysis 1 1991-2020"  # the footer will name the baseline actually used
    assert any(".day.ltm.1991-2020.nc" in u for u in dl.calls)
    assert not [f for f in os.listdir(work) if f.endswith(".ltm.nc")]  # big downloads are removed


def test_build_falls_through_to_monthly_when_daily_fails(work):
    meta = clim.build(str(work / "h.npz"), str(work), wb2_dataset=boom, download=fake_download(work, fail_day=True))
    assert meta["attempt"] == "psl-monthly" and len(meta["skipped"]) == 2


def test_build_fails_loudly_when_every_baseline_fails(work):
    def nothing(url, dest):
        raise OSError("offline")
    with pytest.raises(RuntimeError, match="no climatology baseline worked.*wb2.*psl-daily.*psl-monthly"):
        clim.build(str(work / "h.npz"), str(work), wb2_dataset=boom, download=nothing)
    assert not (work / "h.npz").exists()


def test_a_unit_slip_is_caught_and_the_next_baseline_is_used(work):
    meta = clim.build(str(work / "h.npz"), str(work), wb2_dataset=lambda: wb2_dataset(z_scale=1.0),  # forgot nothing: still m2/s2
                      download=fake_download(work))
    assert meta["attempt"] == "psl-daily" and "outside" in meta["skipped"][0]


def test_prefer_psl_skips_wb2(work):
    meta = clim.build(str(work / "h.npz"), str(work), prefer="psl", wb2_dataset=lambda: pytest.fail("not asked for"),
                      download=fake_download(work))
    assert meta["attempt"] == "psl-daily"


def test_cli_reports_the_baseline_it_built(work, monkeypatch, capsys):
    out = work / "o" / "h.npz"

    def fake_build(path, workdir, prefer):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "wb").write(b"0")
        return {"label": "ERA5 1990-2019", "attempt": "wb2"}
    monkeypatch.setattr(clim, "build", fake_build)
    assert clim.main(["--out", str(out), "--workdir", str(work / "w")]) == 0
    assert "climatology: ERA5 1990-2019 (wb2)" in capsys.readouterr().out
