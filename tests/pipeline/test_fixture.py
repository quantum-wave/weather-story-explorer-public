"""P-FIXTURE: sample mode from the real fixture files (SPEC section 11): cases A-E, real valid times, rebased run."""
import datetime as dt
import json
import os

import numpy as np
import pytest

from pipeline.encode import decode_chunk, dequantize
from pipeline.fixtures import build_fixture
from pipeline.validate import validate


@pytest.fixture(scope="module")
def built(fixtures_dir):
    from conftest import WORK
    out = WORK / "fixture-module"
    out.mkdir(parents=True, exist_ok=True)
    m = build_fixture(fixtures_dir, str(out), today=dt.date(2026, 11, 18), generated="2026-11-18T01:00Z")
    yield str(out), m
    import shutil
    shutil.rmtree(out, ignore_errors=True)
    try:
        WORK.rmdir()
    except OSError:
        pass


def frames(out, m, fid, dom, step):
    f = m["fields"][fid]
    idx = f["steps"].index(step)
    ch = next(c for c in f["chunks"] if c["steps"][0] <= idx < c["steps"][1])
    d = m["domains"][dom]
    blob = open(os.path.join(out, ch["files"][dom]["path"]), "rb").read()
    fr = decode_chunk(blob, d["ny"], d["nx"], ch["steps"][1] - ch["steps"][0])
    return dequantize(fr[idx - ch["steps"][0]], f["scale"], f["offset"])


def test_manifest_is_a_valid_sample_with_five_cases(built):
    out, m = built
    assert validate(out)["fields"] == ["ivt", "msl", "t2a", "ws250", "z500", "z500a", "z500sd"]
    assert m["sample"] is True and "not a forecast" in m["sample_note"]
    assert sorted(m["cases"]) == ["A", "B", "C", "D", "E"]
    assert m["run"] == "2026-11-18T00:00Z"  # step 0 rebased to today 00Z
    assert m["climatology"]["label"].startswith("ERA-Interim January mean")


def test_case_steps_and_real_valid_times(built):
    _, m = built
    f = m["fields"]
    assert (f["z500a"]["steps"], f["z500a"]["case"]) == ([0, 12, 24, 36], "A")
    assert f["z500a"]["source"]["valid"] == ["2017-01-01T00:00Z", "2017-01-01T12:00Z", "2017-01-02T00:00Z", "2017-01-02T12:00Z"]
    assert f["ws250"]["steps"] == [0, 6, 12, 18, 24] and f["ws250"]["domains"] == ["np05"]
    assert f["ws250"]["source"]["valid"][0] == "2017-09-05T12:00Z"
    assert f["t2a"]["steps"] == list(range(0, 361, 6)) and f["t2a"]["source"]["valid"][0] == "2013-01-01T00:00Z"
    assert [c["id"] for c in f["t2a"]["chunks"]] == ["a", "b", "c"]
    assert f["msl"]["steps"] == [0] == f["ivt"]["steps"]
    assert m["cases"]["C"]["label"] == "Motion demo: 15 days of surface temperature, 2013"
    assert m["cases"]["A"]["fields"] == ["z500", "z500a", "z500sd"]


def test_real_values_not_synthetic(built):
    out, m = built
    z = frames(out, m, "z500", "g1", 0)
    assert 4500 < np.nanmin(z) and np.nanmax(z) < 6000
    # Phase 0's real-data fixture gave the same San Francisco anomaly: 116 gpm below the ERA-Interim January mean
    sf = next(p for p in m["probes"] if (p["name"], p["field"], p["domain"], p["step"]) == ("San Francisco", "z500a", "g1", 0))
    assert sf["value"] == -116
    sd = frames(out, m, "z500sd", "np05", 0)
    assert 0 < np.nanmean(sd) < 4  # ERA5 EDA spread is small ("always reads high")


def test_ws250_covers_only_the_irma_region(built):
    out, m = built
    w = frames(out, m, "ws250", "np05", 0)
    frac = np.isnan(w).mean()
    assert 0.5 < frac < 0.9  # 110W-45W, 10-50N of a 160 x 65 degree domain
    ok = np.argwhere(np.isfinite(w))
    lon = 150 + 0.5 * ok[:, 1]
    lat = 75 - 0.5 * ok[:, 0]
    assert lon.min() >= 250 and lon.max() <= 315 and lat.min() >= 10 and lat.max() <= 50


def test_ivt_is_computed_natively_then_interpolated(built):
    out, m = built
    v = frames(out, m, "ivt", "np05", 0)
    assert 500 <= np.nanmax(v) <= 535  # native max 533 (P-IVT); interpolation to 0.5 degrees can only lower it a little
    assert np.isnan(v).mean() > 0.4


def test_msl_in_pascals_from_gfs(built):
    out, m = built
    p = frames(out, m, "msl", "np05", 0)
    assert 95000 < np.nanmin(p) and np.nanmax(p) < 104000


def test_case_c_is_an_anomaly_about_zero(built):
    out, m = built
    t = frames(out, m, "t2a", "np05", 0)
    assert -40 < np.nanmin(t) and np.nanmax(t) < 30


def test_cli_leaves_validated_output(fixtures_dir, work):
    from pipeline import build
    assert build.main(["--fixture", fixtures_dir, "--out", str(work / "o"), "--today", "2026-11-18"]) == 0
    assert json.load(open(work / "o" / "manifest.json"))["run"] == "2026-11-18T00:00Z"
