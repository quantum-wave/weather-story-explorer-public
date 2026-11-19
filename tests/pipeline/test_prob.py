"""W3-10: rain probability (pr1, pr10) from the ECMWF `tpg1`/`tpg10` products, which are 24 h windows written as
range steps. The manifest step is the window's END hour (24, 36 ... 360: 29 windows); the file is chosen by end hour.

The request-shape tests read only the two excerpt index files in tests/pipeline/data/ (trimmed copies of the
2026-11-19 00Z listings: ECMWF metadata, nothing personal)."""
import datetime as dt
import json
import pathlib

import numpy as np
import pytest

from grib_helpers import publish_run
from pipeline import build, fetch
from pipeline.validate import validate
from test_steps import LAT, LON, RUN, at, decoded
from test_fetch import client_factory

DATA = pathlib.Path(__file__).resolve().parent / "data"
ENDS = list(range(24, 361, 12))


def index(name):
    return [json.loads(l) for l in (DATA / f"{name}.excerpt.index").read_text().splitlines() if l.strip()]


def matches(req, line):
    """The ecmwf-opendata client's matching rule, for the keys we send."""
    for k in ("type", "stream", "levtype", "levelist", "step"):  # date and time differ: the excerpt is run 2026111900
        if k not in req:
            continue
        if str(line.get(k)) != str(req[k]):
            return False
    params = req["param"] if isinstance(req["param"], list) else [req["param"]]
    return line["param"] in [str(p) for p in params]


def test_there_are_29_windows_ending_every_12_h():
    assert [w for w in fetch.pr_windows(360)] == ENDS and len(ENDS) == 29
    assert fetch.pr_windows(24) == [24] and fetch.pr_windows(23) == []


def test_window_string_is_start_dash_end():
    assert fetch.pr_window(252) == "228-252" and fetch.pr_window(24) == "0-24" and fetch.pr_window(360) == "336-360"


def test_the_file_is_chosen_by_end_hour():
    assert fetch.ens_file_hours(240) == 240 and fetch.ens_file_hours(252) == 360
    assert fetch.ens_file_hours(216) == 240 and fetch.ens_file_hours(360) == 360


@pytest.mark.parametrize("end", ENDS)
def test_every_window_request_matches_exactly_the_index_lines_of_the_right_file(end):
    req = fetch.request_for("tpg", "ifs", RUN, end)
    assert (req["type"], req["stream"], req["levtype"], req["step"]) == ("ep", "enfo", "sfc", fetch.pr_window(end))
    assert req["param"] == ["tpg1", "tpg10"]
    right, other = ("ep240", "ep360") if end <= 240 else ("ep360", "ep240")
    hits = [l for l in index(right) if matches(req, l)]
    assert sorted(l["param"] for l in hits) == ["tpg1", "tpg10"], (end, hits)  # the tpg5 decoy is not selected
    assert not [l for l in index(other) if matches(req, l)]


def test_window_228_252_is_stored_at_252_and_read_from_the_360_h_file(work, store):
    steps = [216, 228, 240, 252]
    publish_run(store, RUN, steps, lat=LAT, lon=LON)
    r = fetch.Retriever(work / "raw", "ifs", [store.url], client_factory())
    m = build.build_live(RUN, "ifs", ["z500", "pr1", "pr10"], str(work / "out"), None, r, workers=2, max_step=252,
                         generated="2026-11-18T09:50Z")
    assert m["fields"]["pr1"]["steps"] == [216, 228, 240, 252]  # window end hours
    asked = [p for _, p, _ in store.requests if p.endswith(".grib2") or p.endswith(".index")]
    assert any("360h-enfo-ep" in p for p in asked)
    assert any("240h-enfo-ep" in p for p in asked)
    # the 252 value is the one the fake server wrote into window 228-252: tpg1 = 20 + 252/12
    assert at(decoded(work, m, "pr1", "g1", 252), "g1", 37.77, -122.42) == pytest.approx(20 + 252 / 12, abs=0.51)
    assert at(decoded(work, m, "pr10", "g1", 252), "g1", 37.77, -122.42) == pytest.approx(252 / 12, abs=0.51)


def test_pr_fields_are_g1_only_in_percent_with_probes_and_validate(work, store):
    steps = list(range(0, 61, 6))
    publish_run(store, RUN, steps, lat=LAT, lon=LON)
    r = fetch.Retriever(work / "raw", "ifs", [store.url], client_factory())
    m = build.build_live(RUN, "ifs", ["z500", "pr1", "pr10"], str(work / "out"), None, r, workers=2, max_step=60,
                         generated="2026-11-18T09:50Z")
    for fid in ("pr1", "pr10"):
        f = m["fields"][fid]
        assert f["units"] == "%" and f["domains"] == ["g1"] and f["steps"] == [24, 36, 48, 60]
    assert any(p["field"] == "pr1" and p["step"] == 24 and p["value"] == 22.0 for p in m["probes"])
    assert any(p["field"] == "pr10" and p["step"] == 60 and p["value"] == 5.0 for p in m["probes"])
    for s in (24, 36, 48, 60):
        assert at(decoded(work, m, "pr1", "g1", s), "g1", 51.51, -0.13) == pytest.approx(20 + s / 12, abs=0.51)
    validate(str(work / "out"), require_fields=["z500", "pr1", "pr10"], max_step=60)  # live coverage rule must not drop them


def test_no_window_is_requested_for_a_step_that_is_not_a_window_end(work, store, monkeypatch):
    publish_run(store, RUN, [18, 24, 30, 36], lat=LAT, lon=LON)
    asked = []
    real_get = fetch.Retriever.get

    def spy(self, run, step, need):
        asked.append((step, need))
        return real_get(self, run, step, need)

    monkeypatch.setattr(fetch.Retriever, "get", spy)
    r = fetch.Retriever(work / "raw", "ifs", [store.url], client_factory())
    build.build_live(RUN, "ifs", ["pr1"], str(work / "out"), None, r, workers=2, max_step=36,
                     generated="2026-11-18T09:50Z")
    f = json.load(open(work / "out" / "manifest.json"))["fields"]["pr1"]
    assert f["steps"] == [24, 36]  # 18 and 30 are not window ends
    tpg_steps = sorted(s for s, n in asked if n == "tpg")
    assert tpg_steps == fetch.pr_windows(36) == [24, 36]  # never asked for window 6-30 or 12-18
    assert not [1 for _, p, _ in store.requests if fetch.pr_window(18) in p or fetch.pr_window(30) in p]


def test_pr_without_the_ensemble_files_is_listed_as_missing_not_fatal(work, store):
    publish_run(store, RUN, [0, 6, 12], lat=LAT, lon=LON, es_steps=[])
    r = fetch.Retriever(work / "raw", "ifs", [store.url], client_factory())
    m = build.build_live(RUN, "ifs", ["z500", "pr1", "pr10"], str(work / "out"), None, r, workers=2, max_step=12,
                         generated="2026-11-18T09:50Z")
    assert "pr1" not in m["fields"] and {x["field"] for x in m["missing"]} == {"pr1", "pr10"}
