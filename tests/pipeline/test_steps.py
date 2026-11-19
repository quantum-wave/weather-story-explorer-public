"""P-STEPS: a whole live build against the fake open-data server: fields, steps, dropped steps, tp6 rule, anomalies,
the 168 h publish gate. Values are predictable by construction (see grib_helpers.publish_run)."""
import datetime as dt
import json
import os

import numpy as np
import pytest

from grib_helpers import publish_run
from pipeline import build, fetch, reduce
from pipeline.anomaly import save
from pipeline.encode import decode_chunk, dequantize
from pipeline.validate import validate
from test_fetch import LAT, LON, client_factory

UTC = dt.timezone.utc
RUN = dt.datetime(2026, 11, 18, 0, tzinfo=UTC)
STEPS = list(range(0, 25, 6))


def clim_file(work, z=5400.0, t=270.0):
    lat = np.linspace(90, -90, 31)
    lon = np.arange(0, 360, 6.0)
    pl = {}
    for k, v in (("z500", z), ("t850", t)):
        c = np.zeros((7, len(lat), len(lon)), np.float32)
        c[0] = v
        pl[k] = c
    p = work / "harmonics.npz"
    save(p, lat, lon, pl, {"label": "test baseline", "source": "unit", "method": "annual mean + 3 harmonics"})
    return str(p)


def live(work, store, fields=None, model="ifs", steps=STEPS, skip=(), clim=True, max_step=24, es_steps=None):
    publish_run(store, RUN, steps, model=model, skip=skip, lat=LAT, lon=LON, es_steps=es_steps)
    r = fetch.Retriever(work / "raw", model, [store.url], client_factory(model))
    return build.build_live(RUN, model, fields or build.DEFAULT_FIELDS, str(work / "out"),
                            clim_file(work) if clim else None, r, workers=3, max_step=max_step,
                            generated="2026-11-18T09:50Z")


def decoded(work, m, fid, dom, step):
    f = m["fields"][fid]
    idx = f["steps"].index(step)
    ch = next(c for c in f["chunks"] if c["steps"][0] <= idx < c["steps"][1])
    d = m["domains"][dom]
    blob = open(work / "out" / ch["files"][dom]["path"], "rb").read()
    fr = decode_chunk(blob, d["ny"], d["nx"], ch["steps"][1] - ch["steps"][0])
    return dequantize(fr[idx - ch["steps"][0]], f["scale"], f["offset"])


def at(arr, dom, lat, lon):
    from pipeline.grids import DOMAINS, nearest_index
    return arr[nearest_index(DOMAINS[dom], lat, lon)]


def test_first_live_field_set_end_to_end(work, store):
    m = live(work, store)
    assert m["sample"] is False and "sample_note" not in m and "cases" not in m
    assert m["model"] == "ECMWF IFS HRES" and m["run"] == "2026-11-18T00:00Z" and m["generated"] == "2026-11-18T09:50Z"
    assert m["attribution"] == "ECMWF open data CC-BY-4.0"
    assert m["climatology"] == {"label": "test baseline", "source": "unit", "method": "annual mean + 3 harmonics"}
    f = m["fields"]
    assert list(f) == ["z500", "z500a", "tp6", "z500sd", "t850a", "ws250"]  # the SPEC's priority order
    assert {k: v["steps"] for k, v in f.items()} == {
        "z500": STEPS, "z500a": STEPS, "z500sd": STEPS, "ws250": STEPS, "t850a": STEPS, "tp6": [6, 12, 18, 24]}
    assert {k: v["domains"] for k, v in f.items()} == {
        "z500": ["g1", "np05"], "z500a": ["g1", "np05"], "z500sd": ["g1", "np05"], "ws250": ["g1", "np05"],
        "tp6": ["g1"], "t850a": ["g1"]}
    assert all("case" not in v for v in f.values())
    validate(str(work / "out"))


def test_file_count_matches_four_both_domain_fields_and_two_g1_fields(work, store):
    live(work, store)
    bins = [x for x in os.listdir(work / "out") if x.endswith(".bin")]
    assert len(bins) == 4 * 2 + 2  # one chunk each: steps 0-24 are all in chunk a


def test_values_are_the_constants_the_fake_server_publishes(work, store):
    m = live(work, store)
    sf = (37.77, -122.42)
    ramp = ((-122.42) % 360) / 360  # the fake grid adds east longitude / 360
    for s in (0, 12, 24):
        assert at(decoded(work, m, "z500", "g1", s), "g1", *sf) == pytest.approx(5500 + s + ramp, abs=0.51)
        assert at(decoded(work, m, "z500a", "g1", s), "g1", *sf) == pytest.approx(100 + s + ramp, abs=0.51)  # minus the 5400 climatology
        assert at(decoded(work, m, "z500a", "np05", s), "np05", *sf) == pytest.approx(100 + s + ramp, abs=0.51)
        assert at(decoded(work, m, "z500sd", "g1", s), "g1", *sf) == pytest.approx(5.0 + s / 2, abs=0.06)
        assert at(decoded(work, m, "t850a", "g1", s), "g1", *sf) == pytest.approx(s / 10 + ramp, abs=0.06)
        assert at(decoded(work, m, "ws250", "np05", s), "np05", *sf) == pytest.approx(np.hypot(30 + ramp, 40 + ramp), abs=0.06)
    for s in (6, 12, 18, 24):  # 0.0005 m per step -> 3.0 mm per 6 h
        assert at(decoded(work, m, "tp6", "g1", s), "g1", *sf) == pytest.approx(3.0, abs=0.06)


def test_the_grid_is_not_shifted_or_flipped(work, store):
    """The fake field grows with east longitude (and is flat in latitude): np05 column 0 must be 150E, g1's 180W."""
    m = live(work, store, ["z500"])
    z = decoded(work, m, "z500", "np05", 0)
    base = 5500
    assert z[0, 0] - base == pytest.approx(150 / 360, abs=0.51) and z[0, -1] - base == pytest.approx(310 / 360, abs=0.51)
    g = decoded(work, m, "z500", "g1", 0)
    assert g[90, 180 + 90] - base == pytest.approx(90 / 360, abs=0.51)  # lat 0, lon +90 E


def test_step_zero_tp_is_never_requested_and_tp6_starts_at_six(work, store):
    m = live(work, store, ["tp6"])
    assert m["fields"]["tp6"]["steps"] == [6, 12, 18, 24]
    assert not [r for r in store.requests if "-0h-oper-fc" in r[1]]  # the only need is tp, and tp has no step 0


def test_a_missing_step_is_dropped_and_tp6_needs_both_ends(work, store):
    m = live(work, store, skip={("gh500", 12), ("tp", 12)})
    f = m["fields"]
    assert f["z500"]["steps"] == [0, 6, 18, 24] and f["z500a"]["steps"] == [0, 6, 18, 24]
    assert f["ws250"]["steps"] == STEPS  # other needs of step 12 still arrived
    assert f["tp6"]["steps"] == [6, 24]  # 12 lacks tp, 18 lacks its predecessor
    validate(str(work / "out"))


def test_no_ensemble_files_means_no_spread_field_but_the_rest_builds(work, store):
    m = live(work, store, es_steps=[])
    assert "z500sd" not in m["fields"] and "z500a" in m["fields"]


def test_anomaly_fields_need_the_climatology_file_and_say_how_to_get_it(work, store):
    with pytest.raises(FileNotFoundError, match="`clim` workflow"):
        live(work, store, clim=False)
    m = live(work, store, ["z500", "ws250"], clim=False)  # fields that do not need it still build
    assert m["climatology"]["label"] == "none"


def test_nothing_fetched_is_an_error(work, store):
    with pytest.raises(RuntimeError, match="no step could be fetched"):
        live(work, store, steps=[], max_step=24)


def test_aifs_geopotential_is_divided_by_g(work, store):
    m = live(work, store, ["z500", "z500a", "ws250", "tp6"], model="aifs")
    assert m["model"] == "ECMWF AIFS Single"
    assert at(decoded(work, m, "z500", "g1", 12), "g1", 37.77, -122.42) == pytest.approx(5512.0, abs=0.51)  # the fake adds its longitude ramp after the factor g


def test_tp6_rule_negative_differences_go_to_zero_and_step_zero_is_absent():
    cum = {0: {"g1": np.zeros((2, 2))}, 6: {"g1": np.full((2, 2), 4.0)}, 12: {"g1": np.full((2, 2), 3.9)},  # packing noise: -0.1
           24: {"g1": np.full((2, 2), 9.0)}}
    steps, out = reduce.tp6_from_cumulative(cum)
    assert steps == [6, 12]  # 24 has no step 18 to subtract
    assert out["g1"][0][0, 0] == 4.0 and out["g1"][1][0, 0] == 0.0
    assert reduce.tp6_from_cumulative({0: {"g1": np.zeros((1, 1))}}) == ([], {})
    # the open-data step-0 file has no tp: the accumulation starts at 0, so step 6 is its own total
    steps, out = reduce.tp6_from_cumulative({6: {"g1": np.full((1, 1), 2.5)}, 12: {"g1": np.full((1, 1), 4.0)}})
    assert steps == [6, 12] and out["g1"][:, 0, 0].tolist() == [2.5, 1.5]
    # ...but only step 6 may lean on that: step 18 without step 12 is dropped
    assert reduce.tp6_from_cumulative({6: {"g1": np.ones((1, 1))}, 18: {"g1": np.ones((1, 1))}})[0] == [6]


def test_main_publishes_gate_passes_with_168_hours(work, store, monkeypatch):
    steps = list(range(0, 169, 6))
    publish_run(store, RUN, steps, lat=LAT, lon=LON)
    out = work / "o"
    rc = build.main(["--run", "2026111800", "--source", store.url, "--out", str(out), "--clim", clim_file(work),
                     "--workdir", str(work / "raw"), "--max-step", "168", "--fields", "z500,z500a,ws250", "--workers", "3"])
    assert rc == 0
    m = json.load(open(out / "manifest.json"))
    assert m["fields"]["z500a"]["steps"][-1] == 168
    assert not (work / "raw").exists()  # raw GRIBs removed


def test_main_refuses_to_publish_when_z500a_stops_short_of_168(work, store, capsys):
    publish_run(store, RUN, list(range(0, 121, 6)), lat=LAT, lon=LON)
    rc = build.main(["--run", "2026111800", "--source", store.url, "--out", str(work / "o"), "--clim", clim_file(work),
                     "--workdir", str(work / "raw"), "--max-step", "168", "--fields", "z500,z500a", "--workers", "3"])
    assert rc == 2
    assert "z500a reaches 120 h, need 168 h" in capsys.readouterr().err
