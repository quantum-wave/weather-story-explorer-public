"""P-BUDGET: file <= 8 MiB, data <= 48 MiB, <= 160 files, and the first live run's real shape."""
import os

import numpy as np
import pytest

from pipeline.encode import BudgetError, MAX_DATA_BYTES, MAX_DATA_FILES, MAX_FILE_BYTES, ManifestWriter, check_budgets, encode_chunk, quantize


def _bins(d, sizes):
    for i, n in enumerate(sizes):
        with open(os.path.join(d, f"f{i}.g1.a.bin"), "wb") as fh:
            fh.write(b"\0" * n)


def test_within_budget_passes(work):
    _bins(work, [1000, 2000])
    assert check_budgets(str(work)) == {"files": 2, "bytes": 3000}


def test_one_big_file_fails(work):
    _bins(work, [MAX_FILE_BYTES + 1])
    with pytest.raises(BudgetError, match="file budget"):
        check_budgets(str(work))


def test_exactly_at_the_file_limit_passes(work):
    _bins(work, [MAX_FILE_BYTES])
    check_budgets(str(work))


def test_total_over_48_mib_fails(work):
    _bins(work, [MAX_FILE_BYTES - 1] * 7)  # 7 files of just under 8 MiB = 56 MiB
    with pytest.raises(BudgetError, match="data files total"):
        check_budgets(str(work))


def test_more_than_160_files_fails(work):
    _bins(work, [10] * (MAX_DATA_FILES + 1))
    with pytest.raises(BudgetError, match="data files, over"):
        check_budgets(str(work))


def test_writer_enforces_the_budget(work, monkeypatch):
    import pipeline.encode as enc
    monkeypatch.setattr(enc, "MAX_FILE_BYTES", 50)
    w = ManifestWriter(work, {"g1": dict(lon0=-180, lat0=90, dlon=10, dlat=-10, nx=5, ny=4)})
    w.add_field("z500", [0], {"g1": np.random.default_rng(0).normal(5500, 100, (1, 4, 5))})
    with pytest.raises(BudgetError):
        w.write({"schema": 1})


def full_steps(fid, top=360):
    """The step grid a complete field has (SPEC 13.2)."""
    if fid == "tp6":
        return list(range(6, top + 1, 6))
    if fid == "z500em":
        return list(range(144, top + 1, 6))
    if fid in ("pr1", "pr10"):
        return list(range(24, top + 1, 12))
    if fid in ("t2m", "ivt"):  # built to 168 h only (W4-08)
        return list(range(0, min(top, 168) + 1, 6))
    return list(range(0, top + 1, 6))


def estimate_full_bytes(m):
    """Extrapolate a (possibly sparse) manifest to a complete 360 h run: per chunk, bytes per frame times the frames
    the complete field has in that chunk. A pessimistic-to-fair estimate when the sampled steps are typical."""
    from pipeline.encode import CHUNK_HOURS
    total = 0
    for fid, f in m["fields"].items():
        for ch in f["chunks"]:
            n = ch["steps"][1] - ch["steps"][0]
            lo, hi = CHUNK_HOURS[ch["id"]]
            full = len([s for s in full_steps(fid) if lo <= s <= hi])
            total += sum(meta["bytes"] / n * full for meta in ch["files"].values())
    return int(total)


def test_a_complete_default_run_stays_inside_every_budget(work, store, capsys):
    """P-BUDGET with the W3-10 fields on the synthetic GRIB: every step of every default field, 360 h."""
    import datetime as dt
    from grib_helpers import publish_run
    from pipeline import build, fetch
    from test_fetch import LAT, LON, client_factory
    from test_steps import clim_file
    run = dt.datetime(2026, 11, 18, 0, tzinfo=dt.timezone.utc)
    publish_run(store, run, list(range(0, 361, 6)), lat=LAT, lon=LON)
    r = fetch.Retriever(work / "raw", "ifs", [store.url], client_factory())
    m = build.build_live(run, "ifs", build.DEFAULT_FIELDS, str(work / "out"), clim_file(work), r, workers=4,
                         max_step=360, generated="2026-11-18T09:50Z")
    assert "missing" not in m and list(m["fields"]) == build.DEFAULT_FIELDS
    assert {k: len(v["steps"]) for k, v in m["fields"].items()} == {
        "z500": 61, "z500a": 61, "tp6": 60, "z500sd": 61, "z500em": 37, "pr1": 29, "pr10": 29, "t850a": 61,
        "ws250": 61, "msl": 61, "t2m": 29}
    b = check_budgets(str(work / "out"))
    assert b["files"] == 48 <= MAX_DATA_FILES  # 5 fields x 2 domains x 3 chunks + z500em 2 x 2 + 4 g1 fields x 3 + t2m 2 (to 168 h)
    assert b["bytes"] <= MAX_DATA_BYTES
    est = estimate_full_bytes(m)
    assert abs(est - b["bytes"]) / b["bytes"] < 0.02  # uniform synthetic frames: the extrapolation is exact up to chunk framing
    print(f"P-BUDGET synthetic 360 h run: {b['files']} files, {b['bytes']} bytes; estimator says {est}")


def test_first_live_run_shape_and_size(fixtures_dir):
    """46 files for the W3-10 default field set; a pessimistic size bound from one real 1 degree frame stays in budget.

    Bound: every 0.1-unit field is taken to compress like the real 500 hPa height anomaly at 0.1 gpm (61 KB per
    frame, noisier than spread, wind, pressure or rain), the 1-unit fields like the same frame at 1 gpm (33 KB), np05
    at 0.65 of the g1 area. The original six fields measured about 26 MB on test4.grib (2026-11-18); the new fields
    add z500em and pr1/pr10 (1-unit, 37 and 29 frames) and msl (0.1-unit). Measured on live run 2026111900 (steps
    0, 36, 144, 252, extrapolated to a full run by estimate_full_bytes): about 25.6 MB without tp6, about 28 MB with
    it, against the 27-32 MB estimate in the SPEC and the 48 MiB budget."""
    from pipeline.gribio import read_messages
    m = next(x for x in read_messages(os.path.join(fixtures_dir, "test4.grib")) if x.short == "z")
    z = m.data / 9.80665 - 5500
    p1 = len(encode_chunk(quantize(z, 1, 0)[None]))
    p01 = len(encode_chunk(quantize(z, 0.1, 0)[None]))
    files = len(["z500", "z500a", "z500sd", "ws250", "msl"]) * 2 * 3 + 2 * 2 + len(["tp6", "t850a", "pr1", "pr10"]) * 3
    assert files == 46 <= MAX_DATA_FILES
    est = 61 * (2 * p1 + 4 * p01 + 0.65 * (2 * p1 + 2 * p01))                  # the original six fields
    est += 61 * (p01 + 0.65 * p01) + 37 * (p1 + 0.65 * p1) + 2 * 29 * p1      # msl, z500em, pr1 and pr10
    assert 5_000_000 < est < MAX_DATA_BYTES, est
    print(f"estimated live size (fixture bound): {est / 1e6:.1f} MB")
