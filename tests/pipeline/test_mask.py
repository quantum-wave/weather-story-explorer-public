"""W3-10: t850a is no-data where surface pressure is under 870 hPa (the 850 hPa level is then below ground and the
anomaly is extrapolated: Denver, Lake Tahoe), plus the per-run mean-anomaly check."""
import numpy as np
import pytest

from grib_helpers import publish_run
from pipeline import build, fetch, reduce
from pipeline.anomaly import area_weighted_means
from pipeline.encode import NODATA
from pipeline.grids import DOMAINS
from pipeline.validate import validate
from test_fetch import LAT, LON, client_factory
from test_steps import RUN, at, clim_file, decoded


def test_threshold_is_870_hpa_strictly_below():
    sp = np.array([[86999.0, 87000.0, 87001.0, 101325.0]])
    assert reduce.below_ground_mask(sp).tolist() == [[True, False, False, False]]


def test_mask_blanks_only_the_high_ground():
    a = np.full((4, 5), 3.0, np.float32)
    sp = np.full((4, 5), 100000.0)
    sp[1:3, 1:3] = 80000.0  # a plateau
    out = reduce.apply_mask(a, reduce.below_ground_mask(sp))
    assert np.isnan(out[1:3, 1:3]).all() and np.isfinite(out).sum() == 20 - 4 and a[1, 1] == 3.0  # input untouched


def test_t850a_is_nodata_over_a_synthetic_plateau_in_a_live_build(work, store):
    """A plateau of 800 hPa surface pressure between 30-50N, 100-120W (the Rockies, roughly); 1000 hPa elsewhere."""
    lat, lon = np.asarray(LAT), np.asarray(LON)
    sp = np.full((len(lat), len(lon)), 100000.0)
    plateau = (lat[:, None] >= 30) & (lat[:, None] <= 50) & (((lon[None, :] + 180) % 360 - 180) >= -120) & (((lon[None, :] + 180) % 360 - 180) <= -100)
    sp[plateau] = 80000.0
    publish_run(store, RUN, [0, 6, 12], lat=LAT, lon=LON, sp_field=sp)
    r = fetch.Retriever(work / "raw", "ifs", [store.url], client_factory())
    m = build.build_live(RUN, "ifs", ["z500", "z500a", "t850a"], str(work / "out"), clim_file(work), r, workers=2,
                         max_step=12, generated="2026-11-18T09:50Z")
    for s in (0, 6, 12):
        t = decoded(work, m, "t850a", "g1", s)
        denver = at(t, "g1", 39.74, -104.99)
        assert np.isnan(denver), "Denver is above ground level 850: no-data"
        assert np.isfinite(at(t, "g1", 37.77, -122.42)) and np.isfinite(at(t, "g1", 51.51, -0.13))
    assert not [p for p in m["probes"] if p["field"] == "t850a" and p["name"] == "Denver"]
    validate(str(work / "out"))
    # surface pressure is fetched once per run (step 0), not with every step
    assert len([1 for _, p, _ in store.requests if p.endswith("oper-fc.grib2") and "-0h-" in p]) >= 1


def test_t850a_is_dropped_not_left_unmasked_when_surface_pressure_cannot_be_read(work, store):
    publish_run(store, RUN, [0, 6, 12, 18], lat=LAT, lon=LON, skip={("ivt_sp", 0), ("ivt_sp", 6), ("ivt_sp", 12)})  # no surface pressure at 0, 6 or 12 h
    r = fetch.Retriever(work / "raw", "ifs", [store.url], client_factory())
    m = build.build_live(RUN, "ifs", ["z500", "z500a", "t850a"], str(work / "out"), clim_file(work), r, workers=2,
                         max_step=18, generated="2026-11-18T09:50Z")
    assert "t850a" not in m["fields"] and any(x["field"] == "t850a" and "surface pressure" in x["reason"] for x in m["missing"])


def test_area_weighted_means_use_cos_latitude():
    lat = np.linspace(90, -90, 181)
    a = np.zeros((181, 361))
    a[lat >= 20] = 40.0
    out = area_weighted_means(a, DOMAINS["g1"])
    w = np.cos(np.radians(lat))
    trop = np.abs(lat) <= 20
    assert out["nh"] == pytest.approx(40.0, abs=0.06)
    assert out["tropics"] == pytest.approx(40.0 * w[(lat == 20)].sum() / w[trop].sum(), abs=0.06)
    assert out["global"] == pytest.approx(40.0 * w[lat >= 20].sum() / w.sum(), abs=0.06)


def test_area_weighted_means_skip_nodata():
    a = np.full((181, 361), 10.0)
    a[:, 100:200] = np.nan
    assert area_weighted_means(a, DOMAINS["g1"]) == {"global": 10.0, "nh": 10.0, "tropics": 10.0}


def test_build_writes_checks_mean_anomaly_gpm(work, store, capsys):
    publish_run(store, RUN, [0, 6], lat=LAT, lon=LON)
    r = fetch.Retriever(work / "raw", "ifs", [store.url], client_factory())
    m = build.build_live(RUN, "ifs", ["z500", "z500a"], str(work / "out"), clim_file(work), r, workers=2, max_step=6,
                         generated="2026-11-18T09:50Z")
    g = m["checks"]["mean_anomaly_gpm"]
    assert set(g) == {"global", "nh", "tropics"}
    assert g["global"] == pytest.approx(100.0 + 0.5, abs=0.2)  # 5500 + ramp(0..1) minus the 5400 test baseline
    cap = capsys.readouterr()
    out = cap.out + cap.err
    assert "mean z500a" in out
    assert (f"global {g['global']:+.1f}, 20-90N {g['nh']:+.1f}, tropics {g['tropics']:+.1f}") in out
    validate(str(work / "out"))
