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


def test_first_live_run_shape_and_size(fixtures_dir):
    """30 files for the first live field set; a pessimistic size bound from one real 1 degree frame stays in budget.

    Bound: every 0.1-unit field is taken to compress like the real 500 hPa height anomaly at 0.1 gpm (61 KB per
    frame, noisier than spread, wind or rain), the 1-unit fields like the same frame at 1 gpm (33 KB), np05 at 0.65
    of the g1 area. Measured 2026-11-18 on test4.grib: about 26 MB, against the SPEC's 17 MB estimate and the
    48 MiB budget."""
    from pipeline.gribio import read_messages
    m = next(x for x in read_messages(os.path.join(fixtures_dir, "test4.grib")) if x.short == "z")
    z = m.data / 9.80665 - 5500
    p1 = len(encode_chunk(quantize(z, 1, 0)[None]))
    p01 = len(encode_chunk(quantize(z, 0.1, 0)[None]))
    files = len(["z500", "z500a", "z500sd", "ws250"]) * 2 * 3 + len(["tp6", "t850a"]) * 3
    assert files == 30 <= MAX_DATA_FILES
    est = 61 * (2 * p1 + 4 * p01 + 0.65 * (2 * p1 + 2 * p01))
    assert 5_000_000 < est < MAX_DATA_BYTES, est
