"""P-FETCH: the real ecmwf-opendata client against a local server that serves the open-data layout.

The index files and URL layout are constructed from the client's source (a live host is unreachable from here), so
this proves our requests select the right bytes through the real client; the first live Actions run is the test of
the remote side."""
import datetime as dt
import os

import numpy as np
import pytest

from grib_helpers import publish_run, write_grib
from pipeline import fetch
from pipeline.gribio import pick, read_messages

UTC = dt.timezone.utc
RUN = dt.datetime(2026, 11, 18, 0, tzinfo=UTC)
LAT = np.linspace(90, -90, 91)    # 2 degree test grid: plumbing, not resolution
LON = np.arange(0, 360, 2.0)


def client_factory(model="ifs"):
    from ecmwf.opendata import Client
    fetch.quiet_downloads()

    def make(source):
        return Client(source=source, model={"ifs": "ifs", "aifs": "aifs-single"}[model], resol="0p25",
                      maximum_retries=1, retry_after=0, use_server_retry_after=False,
                      source_accept_ranges=True, source_accept_multiple_ranges=False)
    return make


def retriever(work, store, model="ifs", extra_sources=()):
    return fetch.Retriever(work / "raw", model, [store.url, *extra_sources], client_factory(model))


def shorts(path):
    return sorted((m.short, m.level) for m in read_messages(path))


def test_needs_follow_the_requested_fields():
    assert fetch.needs_for(["z500", "z500a", "tp6", "z500sd", "t850a", "ws250"]) == ["gh500", "tp", "es", "t850", "wind250"]
    assert fetch.needs_for(["ivt"]) == ["ivt_pl", "ivt_sp"]


def test_needs_for_the_w3_10_fields():
    assert fetch.needs_for(["z500em", "pr1", "pr10", "msl"]) == ["em", "tpg", "msl"]  # pr1 and pr10 share one request
    assert fetch.needs_for(["t850a"]) == ["t850"]  # surface pressure is read once per run, not per step


def test_the_new_request_dicts():
    assert fetch.request_for("em", "ifs", RUN, 150) == dict(date="20261118", time=0, step=150, model="ifs", stream="enfo",
                                                           type="em", levtype="pl", param="gh", levelist=500)
    assert fetch.request_for("tpg", "aifs", RUN, 252) == dict(date="20261118", time=0, step="228-252", model="ifs",
                                                              stream="enfo", type="ep", levtype="sfc", param=["tpg1", "tpg10"])
    assert fetch.request_for("sp", "ifs", RUN, 0) == dict(date="20261118", time=0, step=0, model="ifs", stream="oper",
                                                         type="fc", levtype="sfc", param="sp")


def test_request_dicts():
    r = fetch.request_for("wind250", "ifs", RUN, 6)
    assert r == dict(date="20261118", time=0, step=6, model="ifs", stream="oper", type="fc", levtype="pl", param=["u", "v"], levelist=250)
    assert fetch.request_for("gh500", "aifs", RUN, 0)["param"] == "z"
    assert fetch.request_for("gh500", "aifs", RUN, 0)["model"] == "aifs-single"
    es = fetch.request_for("es", "aifs", RUN, 12)
    assert (es["model"], es["stream"], es["type"], es["param"]) == ("ifs", "enfo", "es", "gh")  # spread is always IFS ENS
    assert fetch.request_for("ivt_pl", "ifs", RUN, 0)["levelist"] == fetch.IVT_LEVELS


@pytest.mark.parametrize("need,expect", [
    ("gh500", [("gh", 500)]),
    ("wind250", [("u", 250), ("v", 250)]),
    ("t850", [("t", 850)]),
    ("tp", [("tp", 0)]),
    ("msl", [("msl", 0)]),
    ("es", [("gh", 500)]),
    ("em", [("gh", 500)]),
    ("sp", [("sp", 0)]),
])
def test_each_need_downloads_exactly_its_messages_and_no_decoys(work, store, need, expect):
    publish_run(store, RUN, [12], lat=LAT, lon=LON)
    p = retriever(work, store).get(RUN, 12, need)
    assert p and shorts(p) == sorted(expect)  # decoys (other levels, other params) stay on the server


def test_ensemble_spread_and_mean_are_told_apart_by_type(work, store):
    publish_run(store, RUN, [12], lat=LAT, lon=LON)
    r = retriever(work, store)
    es = pick(read_messages(r.get(RUN, 12, "es")), "gh", 500)
    em = pick(read_messages(r.get(RUN, 12, "em")), "gh", 500)
    assert es.data[0, 0] == pytest.approx(5.0 + 12 / 2, abs=1e-3)
    assert em.data[0, 0] == pytest.approx(5500.0 + 12, abs=1e-3)


def test_steps_beyond_240_come_from_the_360h_ensemble_file(work, store):
    publish_run(store, RUN, [246], lat=LAT, lon=LON)
    p = retriever(work, store).get(RUN, 246, "es")
    assert pick(read_messages(p), "gh", 500).data[0, 0] == pytest.approx(5.0 + 123, abs=1e-3)
    assert any("360h-enfo-ep" in path for _, path, _ in store.requests)


def test_a_rain_window_download_holds_only_tpg1_and_tpg10_not_the_tpg5_decoy(work, store):
    publish_run(store, RUN, [252], lat=LAT, lon=LON)
    p = retriever(work, store).get(RUN, 252, "tpg")
    assert shorts(p) == [("tpg1", 0), ("tpg10", 0)] or sorted(s for s, _ in shorts(p)) == ["tpg1", "tpg10"]
    assert any("360h-enfo-ep" in path for _, path, _ in store.requests)


def test_a_step_the_server_lacks_returns_none_without_leaving_files(work, store):
    publish_run(store, RUN, [0, 6], skip={("gh500", 6)}, lat=LAT, lon=LON)
    r = retriever(work, store)
    assert r.get(RUN, 6, "gh500") is None
    assert not [f for f in os.listdir(work / "raw") if "gh500.006" in f]
    assert r.get(RUN, 0, "gh500")


def test_a_second_source_is_tried_when_the_first_fails(work, store):
    from grib_helpers import Store
    publish_run(store, RUN, [0], lat=LAT, lon=LON)
    dead = Store()  # serves nothing: every path is 404
    try:
        r = fetch.Retriever(work / "raw", "ifs", [dead.url, store.url], client_factory())
        assert r.get(RUN, 0, "gh500")
        assert any(p for _, p, _ in dead.requests) and any(p for _, p, _ in store.requests)
    finally:
        dead.close()


def test_a_cached_file_is_not_downloaded_again(work, store):
    publish_run(store, RUN, [0], lat=LAT, lon=LON)
    r = retriever(work, store)
    r.get(RUN, 0, "gh500")
    n = len(store.requests)
    r.get(RUN, 0, "gh500")
    assert len(store.requests) == n


def test_downloads_use_byte_ranges_not_whole_files(work, store):
    publish_run(store, RUN, [0], lat=LAT, lon=LON)
    retriever(work, store).get(RUN, 0, "gh500")
    assert any(rng and rng.startswith("bytes=") for _, p, rng in store.requests if p.endswith(".grib2"))


def test_aifs_uses_its_own_directory_and_z(work, store):
    publish_run(store, RUN, [0], model="aifs", lat=LAT, lon=LON)
    r = retriever(work, store, "aifs")
    p = r.get(RUN, 0, "gh500")
    assert shorts(p) == [("z", 500)]
    assert any("/aifs-single/0p25/oper/" in path for _, path, _ in store.requests)


def test_fetch_steps_collects_reductions_and_always_deletes_raw_files(work, store):
    publish_run(store, RUN, [0, 6, 12], skip={("gh500", 6)}, lat=LAT, lon=LON)
    r = retriever(work, store)
    seen = {}

    def reducer(step, paths):
        seen[step] = sorted(paths)
        return {"n": len(paths)}

    out = fetch.fetch_steps(r, RUN, [0, 6, 12], ["gh500", "t850"], reducer, workers=2)
    assert out == {0: {"n": 2}, 6: {"n": 1}, 12: {"n": 2}}
    assert seen[6] == ["t850"]
    assert os.listdir(work / "raw") == []


def test_a_step_with_no_needs_at_all_is_dropped(work, store):
    publish_run(store, RUN, [0], lat=LAT, lon=LON)
    out = fetch.fetch_steps(retriever(work, store), RUN, [0, 6], ["gh500"], lambda s, p: {"ok": 1})
    assert list(out) == [0]


def test_parse_run():
    assert fetch.parse_run("2026111812") == dt.datetime(2026, 11, 18, 12, tzinfo=UTC)
