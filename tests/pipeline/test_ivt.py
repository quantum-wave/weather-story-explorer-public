"""P-IVT: integrated vapour transport on the native grid, vector magnitude after integration, ground mask."""
import numpy as np
import pytest

from pipeline.reduce import G, ivt, wind_speed

LEV = [1000, 925, 850, 700, 600, 500, 400, 300]


def col(v):
    return np.full((len(LEV), 1, 1), v, np.float64)


def test_constant_column_matches_hand_calculation():
    # q 0.01, u 10 m/s, v 0, 1000-300 hPa: (1/g) * 0.01 * 10 * 70000 Pa
    out = ivt(col(0.01), col(10.0), col(0.0), LEV)
    assert out[0, 0] == pytest.approx(0.01 * 10 * 70000 / G, rel=1e-9)


def test_levels_in_any_order_give_the_same_answer():
    rng = np.random.default_rng(3)
    q, u, v = (rng.uniform(0, 0.01, (8, 2, 2)), rng.uniform(-20, 20, (8, 2, 2)), rng.uniform(-20, 20, (8, 2, 2)))
    a = ivt(q, u, v, LEV)
    b = ivt(q[::-1], u[::-1], v[::-1], LEV[::-1])
    assert np.allclose(a, b)


def test_vector_is_integrated_before_the_magnitude():
    # wind +10 below 700 hPa and -10 above: the transports cancel, while integrating speed would not
    u = np.array([10, 10, 10, 10, -10, -10, -10, -10], float)[:, None, None]
    q = col(0.01)
    cancel = ivt(q, u, col(0.0), LEV)[0, 0]
    speed_integral = ivt(q, np.abs(u), col(0.0), LEV)[0, 0]
    assert cancel < 0.2 * speed_integral
    assert ivt(col(0.01), col(3.0), col(4.0), LEV)[0, 0] == pytest.approx(5 * 0.01 * 70000 / G)  # |(3, 4)| = 5


def test_levels_below_ground_are_masked():
    q, u, v = col(0.01), col(10.0), col(0.0)
    sp = np.array([[85000.0]])  # 1000 and 925 hPa are underground; 850 is the lowest valid level
    out = ivt(q, u, v, LEV, sp_pa=sp)
    assert out[0, 0] == pytest.approx(0.01 * 10 * (85000 - 30000) / G, rel=1e-9)
    # a sea-level column (sp 101325) keeps everything
    assert ivt(q, u, v, LEV, sp_pa=np.array([[101325.0]]))[0, 0] == pytest.approx(0.01 * 10 * 70000 / G)


def test_wind_speed():
    assert wind_speed(3.0, 4.0) == pytest.approx(5.0)


def test_narr_native_grid_reference(fixtures_dir):
    """The 1987-04-04 NARR case on its native Lambert grid, 1000-300 hPa: max 533 kg/m/s, 95th percentile 303
    (spike smoke test, research/data-feasibility-2026-11-17.md section 2)."""
    import os
    import xarray as xr
    ds = xr.open_dataset(os.path.join(fixtures_dir, "narr_example.nc")).isel(time=0)
    keep = np.where(ds["isobaric"].values >= 300)[0]
    sel = ds.isel(isobaric=keep)
    out = ivt(sel["Specific_humidity"].values, sel["u_wind"].values, sel["v_wind"].values, ds["isobaric"].values[keep])
    assert out.shape == (118, 292)  # native grid: nothing was regridded
    assert out.max() == pytest.approx(533, abs=2)
    assert np.percentile(out, 95) == pytest.approx(303, abs=3)


# ---- W4-08 (Josh points 8, 15; MET-10): IVT is built to 168 h, from the scheduled 00Z run's field list --------------

def test_ivt_requests_stop_at_168_h():
    from pipeline import fetch
    for need in ("ivt_pl", "ivt_sp"):
        assert fetch.need_applies(need, 0) and fetch.need_applies(need, 168) and not fetch.need_applies(need, 174)


def test_a_live_build_makes_ivt_to_168_h_and_decodes_the_hand_value(work, store):
    import datetime as dt
    import numpy as np
    from grib_helpers import publish_run
    from pipeline import build, fetch
    from pipeline.validate import validate
    from test_fetch import LAT, LON, client_factory
    from test_steps import RUN, at, decoded
    steps = list(range(0, 181, 6))
    publish_run(store, RUN, steps, lat=LAT, lon=LON, ivt=True)
    asked = []
    real = fetch.Retriever.get

    def spy(self, run, step, need):
        asked.append((step, need))
        return real(self, run, step, need)

    fetch.Retriever.get = spy
    try:
        r = fetch.Retriever(work / "raw", "ifs", [store.url], client_factory())
        m = build.build_live(RUN, "ifs", ["z500", "ivt"], str(work / "out"), None, r, workers=3, max_step=180,
                             generated="2026-11-18T09:50Z")
    finally:
        fetch.Retriever.get = real
    f = m["fields"]["ivt"]
    assert f["steps"] == list(range(0, 169, 6)) and f["domains"] == ["g1", "np05"] and f["units"] == "kg/m/s"
    assert not [1 for s, n in asked if n in ("ivt_pl", "ivt_sp") and s > 168]
    want = 0.01 * 10 * 70000 / G  # q 0.01, u 10 m/s, v 0, 1000-300 hPa, surface pressure 1000 hPa
    for dom in ("g1", "np05"):
        assert at(decoded(work, m, "ivt", dom, 48), dom, 37.77, -122.42) == pytest.approx(want, abs=1.0)
    validate(str(work / "out"), require_fields=["z500", "ivt"], max_step=180)
    validate(str(work / "out"), require_fields=["ivt"], max_step=360)  # only 0-168 h is expected of it
