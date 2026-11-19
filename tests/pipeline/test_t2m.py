"""W4-08 (Josh points 15, 16; design 13.2): `t2m`, 2 m temperature on g1 to 168 h on every run, for the card highs and
lows of a trip. Optional: a run without it publishes, listing it in `missing`. Decode and probe are proved against
the fake open-data server (values predictable by construction, grib_helpers.publish_run: 280 + step/10 + ramp)."""
import json

import pytest

from grib_helpers import publish_run
from pipeline import build, fetch
from pipeline.encode import FIELD_META
from pipeline.validate import validate
from test_fetch import LAT, LON, client_factory
from test_steps import RUN, at, decoded

SF = (37.77, -122.42)
RAMP = ((-122.42) % 360) / 360


def test_t2m_is_one_surface_request_for_param_2t():
    assert fetch.needs_for(["t2m"]) == ["t2m"]
    assert fetch.request_for("t2m", "ifs", RUN, 24) == dict(date="20261118", time=0, step=24, model="ifs", stream="oper",
                                                           type="fc", levtype="sfc", param="2t")


def test_t2m_stops_at_168_h_and_is_on_by_default():
    assert fetch.need_applies("t2m", 0) and fetch.need_applies("t2m", 168) and not fetch.need_applies("t2m", 174)
    assert "t2m" in build.DEFAULT_FIELDS and build.FIELD_DOMAINS["t2m"] == ("g1",)
    assert FIELD_META["t2m"] == ("K", 0.1, 0)


def build_t2m(work, store, steps, max_step, fields=("z500", "t2m"), **kw):
    publish_run(store, RUN, steps, lat=LAT, lon=LON, **kw)
    r = fetch.Retriever(work / "raw", "ifs", [store.url], client_factory())
    return build.build_live(RUN, "ifs", list(fields), str(work / "out"), None, r, workers=3, max_step=max_step,
                            generated="2026-11-18T09:50Z")


def test_t2m_decodes_in_kelvin_on_g1_only_and_has_probes(work, store):
    steps = list(range(0, 25, 6))
    m = build_t2m(work, store, steps, 24)
    f = m["fields"]["t2m"]
    assert f["units"] == "K" and f["scale"] == 0.1 and f["domains"] == ["g1"] and f["steps"] == steps
    for s in steps:
        assert at(decoded(work, m, "t2m", "g1", s), "g1", *SF) == pytest.approx(280 + s / 10 + RAMP, abs=0.06)
    p = [x for x in m["probes"] if x["field"] == "t2m" and x["name"] == "San Francisco"]
    assert {x["step"] for x in p} == {0, 24}
    assert next(x for x in p if x["step"] == 24)["value"] == pytest.approx(282.4 + RAMP, abs=0.06)
    validate(str(work / "out"), require_fields=["z500", "t2m"], max_step=24)


def test_t2m_ends_at_168_in_a_longer_run_and_the_live_gate_does_not_drop_it(work, store):
    steps = list(range(0, 181, 6))
    asked = []
    real = fetch.Retriever.get

    def spy(self, run, step, need):
        asked.append((step, need))
        return real(self, run, step, need)

    fetch.Retriever.get = spy
    try:
        m = build_t2m(work, store, steps, 180)
    finally:
        fetch.Retriever.get = real
    assert m["fields"]["t2m"]["steps"] == list(range(0, 169, 6)) and m["fields"]["z500"]["steps"] == steps
    assert not [1 for s, n in asked if n == "t2m" and s > 168]
    # a 360 h run asks the gate for t2m: only 29 steps (0-168 h) are expected of it, not 61
    validate(str(work / "out"), require_fields=["t2m"], max_step=360)


def test_a_run_without_2t_publishes_and_lists_t2m_as_missing(work, store):
    m = build_t2m(work, store, [0, 6, 12], 12, skip={("t2m", 0), ("t2m", 6), ("t2m", 12)})
    assert "t2m" not in m["fields"] and {x["field"] for x in m["missing"]} == {"t2m"}
    assert json.load(open(work / "out" / "manifest.json"))["fields"]["z500"]
