"""W3-10: z500em, the ensemble mean of 500 hPa height, 144-360 h, from the `enfo-ep` files (type em)."""
import json

import numpy as np
import pytest

from grib_helpers import publish_run
from pipeline import build, fetch
from pipeline.validate import validate
from test_fetch import LAT, LON, client_factory
from test_prob import index, matches
from test_steps import RUN, at, decoded

EM_STEPS = list(range(144, 361, 6))


def test_z500em_needs_the_em_request_and_starts_at_144():
    assert fetch.needs_for(["z500em"]) == ["em"]
    assert not fetch.need_applies("em", 138) and fetch.need_applies("em", 144) and fetch.need_applies("em", 360)
    assert fetch.need_applies("gh500", 0) and not fetch.need_applies("tp", 0) and fetch.need_applies("tp", 6)


@pytest.mark.parametrize("step", EM_STEPS)
def test_each_em_step_matches_one_line_of_the_right_excerpt(step):
    req = fetch.request_for("em", "ifs", RUN, step)
    right, other = ("ep240", "ep360") if step <= 240 else ("ep360", "ep240")
    assert len([l for l in index(right) if matches(req, l)]) == 1
    assert not [l for l in index(other) if matches(req, l)]


def test_decode_and_probe_z500em(work, store):
    steps = list(range(138, 253, 6))
    publish_run(store, RUN, steps, lat=LAT, lon=LON)
    r = fetch.Retriever(work / "raw", "ifs", [store.url], client_factory())
    m = build.build_live(RUN, "ifs", ["z500", "z500em"], str(work / "out"), None, r, workers=2, max_step=252,
                         generated="2026-11-18T09:50Z")
    f = m["fields"]["z500em"]
    assert f["steps"] == list(range(144, 253, 6)) and f["units"] == "gpm" and f["domains"] == ["g1", "np05"]
    for s in (144, 252):
        assert at(decoded(work, m, "z500em", "g1", s), "g1", 37.77, -122.42) == pytest.approx(5500 + s, abs=0.51)
        assert at(decoded(work, m, "z500em", "np05", s), "np05", 37.77, -122.42) == pytest.approx(5500 + s, abs=0.51)
    assert any(p["field"] == "z500em" and p["step"] == 252 and p["value"] == 5752.0 for p in m["probes"])
    validate(str(work / "out"), require_fields=["z500em"], max_step=252)  # coverage is judged from 144 h


def test_a_run_shorter_than_144_has_no_z500em_and_says_so(work, store):
    publish_run(store, RUN, [0, 6, 12], lat=LAT, lon=LON)
    r = fetch.Retriever(work / "raw", "ifs", [store.url], client_factory())
    m = build.build_live(RUN, "ifs", ["z500", "z500em"], str(work / "out"), None, r, workers=2, max_step=12,
                         generated="2026-11-18T09:50Z")
    assert "z500em" not in m["fields"] and m["missing"][0]["field"] == "z500em"
