"""W2-09: tools/make_sample.py thins a live build into the recorded forecast the product ships by default.

Round trip on a small synthetic build (made here, tiny grids, never shipped): steps, domains, keys, sizes, the drop
order, the probes, and the refusals. The real recording is checked by tests/site and tests/scripts, not here.
"""
import datetime as dt
import importlib.util
import json
import os
import pathlib
import subprocess
import sys

import numpy as np
import pytest

from pipeline.encode import FIELD_META, ManifestWriter, decode_chunk, dequantize
from pipeline.grids import nearest_index
from pipeline.validate import validate

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("make_sample", ROOT / "tools" / "make_sample.py")
ms = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ms)

DOMS = {"g1": dict(lon0=-180.0, lat0=90.0, dlon=10.0, dlat=-10.0, nx=37, ny=19),
        "np05": dict(lon0=150.0, lat0=75.0, dlon=5.0, dlat=-5.0, nx=33, ny=14)}
BASE = {"z500": 5500.0, "z500a": 0.0, "z500sd": 40.0, "ws250": 30.0, "t850a": 0.0, "msl": 101000.0}
SPAN = {"z500": 150.0, "z500a": 120.0, "z500sd": 20.0, "ws250": 25.0, "t850a": 8.0, "msl": 800.0}
STEPS = list(range(0, 361, 6))


def make_live(out, run="2026-11-19T00:00Z", steps=STEPS, fields=None, noise=0.0):
    """A live-shaped build: sample false, 6-hourly to 360 h, g1 for every field, np05 for z500 / z500a / ws250."""
    rng = np.random.default_rng(7)
    w = ManifestWriter(str(out), domains=DOMS)
    for fid in fields or BASE:
        grids = {}
        for dom in (["g1", "np05"] if fid in ("z500", "z500a", "ws250") else ["g1"]):
            d = DOMS[dom]
            yy, xx = np.mgrid[0:d["ny"], 0:d["nx"]]
            arr = np.stack([BASE[fid] + SPAN[fid] * np.sin(0.3 * xx + 0.2 * yy + 0.05 * i) for i in range(len(steps))])
            if noise:
                arr = arr + noise * rng.standard_normal(arr.shape)
            grids[dom] = arr
        w.add_field(fid, steps, grids, source={"dataset": f"live {fid}", "valid": None})
    head = {"schema": 1, "sample": False, "model": "ECMWF IFS HRES", "run": run, "generated": "2026-11-19T08:09Z",
            "attribution": "ECMWF open data CC-BY-4.0",
            "climatology": {"label": "ERA5 1990-2019", "source": "WeatherBench2", "method": "annual mean + 3 harmonics"}}
    return w.write(head)


def frame(outdir, m, fid, dom, step):
    f = m["fields"][fid]
    idx = f["steps"].index(step)
    ch = next(c for c in f["chunks"] if c["steps"][0] <= idx < c["steps"][1])
    d = m["domains"][dom]
    blob = open(os.path.join(outdir, ch["files"][dom]["path"]), "rb").read()
    q = decode_chunk(blob, d["ny"], d["nx"], ch["steps"][1] - ch["steps"][0])[idx - ch["steps"][0]]
    return q


@pytest.fixture
def src(work):
    d = work / "live"
    make_live(d)
    return d


def test_thins_steps_keeps_keys_and_flags_the_recording(src, work):
    out = work / "rec"
    res = ms.make_sample(str(src), str(out))
    m = json.load(open(out / "manifest.json"))
    want = [s for s in STEPS if (s <= 168 and s % 6 == 0) or (s > 168 and s % 12 == 0)]
    assert m["sample"] is True and "cases" not in m
    assert m["sample_label"] == "Recorded forecast · ECMWF run 19 Nov 2026 00 UTC"
    assert "synthetic" not in json.dumps(m).lower()  # assemble.sh refuses that word
    assert m["run"] == "2026-11-19T00:00Z" and m["model"] == "ECMWF IFS HRES"
    assert set(m["fields"]) == set(BASE)
    for fid, f in m["fields"].items():
        assert f["steps"] == want, fid
        assert f["source"]["dataset"] == f"live {fid}"
    assert m["fields"]["z500"]["domains"] == ["g1", "np05"] and m["fields"]["z500a"]["domains"] == ["g1", "np05"]
    assert all(m["fields"][f]["domains"] == ["g1"] for f in ("z500sd", "ws250", "t850a", "msl"))
    assert validate(str(out))["fields"] == sorted(BASE)
    assert res["dropped"] == [] and res["local_days"]["z500a_last_step"] == 360


def test_decoded_probes_equal_the_source_at_five_points_and_three_steps(src, work):
    out = work / "rec"
    ms.make_sample(str(src), str(out))
    ms_, mo = json.load(open(src / "manifest.json")), json.load(open(out / "manifest.json"))
    pts = [("SF", 37.77, -122.42), ("Seattle", 47.61, -122.33), ("Denver", 39.74, -104.99),
           ("Honolulu", 21.31, -157.86), ("London", 51.51, -0.13)]
    n = 0
    for fid in ("z500", "z500a", "ws250", "msl"):
        for step in (0, 120, 360):
            for _, lat, lon in pts:
                a = frame(src, ms_, fid, "g1", step)
                b = frame(out, mo, fid, "g1", step)
                ij = nearest_index(mo["domains"]["g1"], lat, lon)
                assert int(a[ij]) == int(b[ij])
                n += 1
    assert n == 60
    assert np.array_equal(frame(src, ms_, "z500a", "np05", 168), frame(out, mo, "z500a", "np05", 168))
    # the tool's own check agrees, and a changed byte is caught
    cmp = ms.compare_probes(str(src), str(out))
    assert cmp["mismatches"] == 0
    inside = {dom: sum(nearest_index(mo["domains"][dom], lat, lon) is not None for _, lat, lon in pts) for dom in DOMS}
    assert inside["g1"] == 5 and inside["np05"] >= 3
    want = sum(3 * inside[dom] for f in mo["fields"].values() for dom in f["domains"])
    assert cmp["checked"] == want, (cmp, want)
    b = (out / "z500a.g1.a.bin")
    b.write_bytes(b.read_bytes()[:-9] + b"\x00" * 9)  # corrupt: the compare must not pass silently
    with pytest.raises(Exception):
        ms.compare_probes(str(src), str(out))


def decimal(n):
    """Expected print of a byte count: decimal kB / MB (1 MB = 1,000,000 bytes), written here independently."""
    return f"{n / 1_000_000:.2f} MB" if n >= 1_000_000 else f"{n / 1000:.1f} kB"


def printed(text, label):
    """The size printed on the line that starts with `label`, as text like '123.4 kB'."""
    ln = next(ln for ln in text.splitlines() if ln.split()[:1] == [label])
    return " ".join(ln.split()[1:3])


def test_prints_size_per_field(src, work, capsys):
    out = work / "rec"
    ms.make_sample(str(src), str(out))
    text = capsys.readouterr().out
    m = json.load(open(out / "manifest.json"))
    on_disk = {fid: sum(os.path.getsize(out / meta["path"]) for c in f["chunks"] for meta in c["files"].values())
               for fid, f in m["fields"].items()}
    for fid in BASE:
        assert printed(text, fid) == decimal(on_disk[fid]), fid
    assert printed(text, "manifest") == decimal(os.path.getsize(out / "manifest.json"))
    assert printed(text, "total") == decimal(folder_bytes(out))  # chunks plus manifest.json
    assert "z500a reaches 360 h" in text


def test_sizes_print_in_decimal_megabytes():
    assert ms.mib(1_500_000) == "1.50 MB" and ms.mib(14_000_000) == "14.00 MB" and ms.mib(999_999) == "1000.0 kB"


def test_drop_order_names_what_it_drops(src, work, capsys):
    """Over the cap: np05 first, then msl, then t850a; each named in the output and the result."""
    full = ms.make_sample(str(src), str(work / "full"))["bytes"]
    # caps just under the size left after each stage
    r1 = ms.make_sample(str(src), str(work / "r1"), cap_bytes=full - 1)
    assert len(r1["dropped"]) == 1 and r1["dropped"][0].startswith("np05 ")
    m1 = json.load(open(work / "r1" / "manifest.json"))
    assert "msl" in m1["fields"]
    for fid in ("z500", "z500a"):  # np05 goes whole: no field lists it, no chunk has it
        assert m1["fields"][fid]["domains"] == ["g1"], fid
        assert all(list(c["files"]) == ["g1"] for c in m1["fields"][fid]["chunks"]), fid
        assert max(m1["fields"][fid]["steps"]) == 360
    assert not any(p["domain"] == "np05" for p in m1["probes"])
    assert m1["fields"]["ws250"]["domains"] == ["g1"]  # np05 is kept for z500 and z500a only
    out = capsys.readouterr().out
    assert "dropped: np05 (" in out
    after_np = r1["bytes"]
    r2 = ms.make_sample(str(src), str(work / "r2"), cap_bytes=after_np - 1)
    assert r2["dropped"][-1] == "msl" and "msl" not in json.load(open(work / "r2" / "manifest.json"))["fields"]
    r3 = ms.make_sample(str(src), str(work / "r3"), cap_bytes=r2["bytes"] - 1)
    assert r3["dropped"][-1].startswith("t850a") and "t850a" not in json.load(open(work / "r3" / "manifest.json"))["fields"]
    assert validate(str(work / "r3"))["fields"]
    summary = [ln for ln in capsys.readouterr().out.splitlines() if ln.startswith("dropped: ")]
    assert summary == ["dropped: " + "; ".join(ms.DROP_ORDER[:2]), "dropped: " + "; ".join(ms.DROP_ORDER)], summary


def folder_bytes(d):
    return sum(os.path.getsize(os.path.join(d, f)) for f in os.listdir(d))


def test_the_cap_counts_manifest_json_and_is_decimal_mb():
    assert ms.CAP_BYTES == 14_000_000 and ms.TARGET_BYTES == 12_000_000


def test_the_total_is_the_whole_folder_manifest_included(src, work):
    r = ms.make_sample(str(src), str(work / "full"))
    assert r["bytes"] == folder_bytes(work / "full")
    assert r["bytes"] > sum(r["per_field"].values())


def test_chunks_fit_but_chunks_plus_manifest_do_not(src, work, capsys):
    full = ms.make_sample(str(src), str(work / "full"))
    chunks = sum(full["per_field"].values())
    assert chunks < full["bytes"]
    cap = full["bytes"] - 1  # the chunks alone are under it, the folder is not
    assert chunks <= cap
    capsys.readouterr()
    r = ms.make_sample(str(src), str(work / "r"), cap_bytes=cap)
    assert r["dropped"] and r["dropped"][0].startswith("np05 ")  # counted by the folder, so a stage is dropped
    assert r["bytes"] <= cap and r["bytes"] == folder_bytes(work / "r")
    assert "within the cap" not in capsys.readouterr().out  # under the target here, no note


def test_note_only_when_between_target_and_cap(src, work, capsys):
    full = ms.make_sample(str(src), str(work / "full"))["bytes"]
    capsys.readouterr()
    ms.make_sample(str(src), str(work / "a"), cap_bytes=full + 10, target_bytes=full - 1)
    assert "within the cap" in capsys.readouterr().out
    ms.make_sample(str(src), str(work / "b"), cap_bytes=full + 10, target_bytes=full + 5)
    assert "within the cap" not in capsys.readouterr().out


def test_still_over_after_every_drop_exits_non_zero(src, work, capsys):
    """Over the cap with every stage dropped, and over the target too: the run fails, names all three drops, and
    never prints the 'over the target, within the cap' note (the build is genuinely past both thresholds here)."""
    cap, target = 1000, 500
    with pytest.raises(ms.SampleError, match="over the cap after every drop") as e:
        ms.make_sample(str(src), str(work / "rec"), cap_bytes=cap, target_bytes=target)
    out = capsys.readouterr().out
    total = next(int(round(float(ln.split()[1]) * (1e6 if ln.split()[2] == "MB" else 1e3)))
                 for ln in out.splitlines() if ln.strip().startswith("total "))
    assert total > cap > target  # the case the note condition has to get right: over both
    assert "within the cap" not in out and "note:" not in out
    summary = [ln for ln in out.splitlines() if ln.startswith("dropped: ")]
    assert summary == ["dropped: " + "; ".join(ms.DROP_ORDER)], summary
    assert [d.split()[0] for d in ms.DROP_ORDER] == ["np05", "msl", "t850a"]
    assert "np05" in str(e.value) and "msl" in str(e.value) and "t850a" in str(e.value)
    assert not (work / "rec").exists()
    py = sys.executable
    p = subprocess.run([py, "-I", str(ROOT / "tools" / "make_sample.py"), str(src), str(work / "rec2"),
                        "--cap-bytes", str(cap), "--target-bytes", str(target)], capture_output=True, text=True, cwd=ROOT)
    assert p.returncode == 1 and "over the cap after every drop" in p.stderr
    assert "note:" not in p.stdout and "t850a" in p.stdout
    assert not (work / "rec2").exists()


def test_a_cap_equal_to_the_size_drops_nothing(src, work):
    full = ms.make_sample(str(src), str(work / "full"))["bytes"]
    r = ms.make_sample(str(src), str(work / "eq"), cap_bytes=full, target_bytes=full)
    assert r["dropped"] == [] and r["bytes"] == full


def test_cli_success_and_label(src, work):
    p = subprocess.run([sys.executable, "-I", str(ROOT / "tools" / "make_sample.py"), str(src), str(work / "rec")],
                       capture_output=True, text=True, cwd=ROOT)
    assert p.returncode == 0, p.stderr
    assert "run 2026-11-19T00:00Z" in p.stdout and "San Francisco local days" in p.stdout


@pytest.mark.parametrize("change", ["sample", "cases", "synthetic"])
def test_refuses_each_kind_of_non_live_source_on_its_own(work, change):
    """Each of the three marks of a non-live source is refused alone, not only when they come together."""
    d = work / "src"
    make_live(d)
    m = json.load(open(d / "manifest.json"))
    if change == "sample":
        m["sample"] = True
    elif change == "cases":
        m["cases"] = {"A": {"label": "a", "fields": ["z500"]}}
    else:
        m["attribution"] = "Synthetic test data"
    json.dump(m, open(d / "manifest.json", "w"))
    with pytest.raises(ms.SampleError, match="not a live build"):
        ms.make_sample(str(d), str(work / "rec"))
    assert not (work / "rec").exists()


def test_refuses_what_is_not_a_live_build(work):
    syn = work / "syn"
    make_live(syn)
    m = json.load(open(syn / "manifest.json"))
    m["sample"] = True
    m["sample_label"] = "x"
    m["cases"] = {"A": {"label": "a", "fields": ["z500"]}}
    for f in m["fields"].values():
        f["case"] = "A"
    json.dump(m, open(syn / "manifest.json", "w"))
    with pytest.raises(ms.SampleError, match="live build"):
        ms.make_sample(str(syn), str(work / "rec"))
    with pytest.raises(ms.SampleError, match="manifest"):
        ms.make_sample(str(work / "nothing"), str(work / "rec"))
    short = work / "short"
    make_live(short, steps=list(range(0, 49, 6)))
    r = ms.make_sample(str(short), str(work / "rec3"))
    assert r["local_days"]["z500a_last_step"] == 48 and r["point1_demonstrable"] is False
    out = work / "same"
    with pytest.raises(ms.SampleError, match="same folder"):
        ms.make_sample(str(short), str(short))


@pytest.mark.parametrize("last,demo", [(168, True), (162, False)])
def test_point_1_needs_z500a_to_reach_168_h_and_says_so_first(work, capsys, last, demo):
    d = work / f"to{last}"
    make_live(d, steps=list(range(0, last + 1, 6)))
    capsys.readouterr()
    r = ms.make_sample(str(d), str(work / f"rec{last}"))
    lines = capsys.readouterr().out.splitlines()
    assert r["point1_demonstrable"] is demo and r["local_days"]["z500a_last_step"] == last
    if demo:
        assert not any("not demonstrable" in ln for ln in lines)
    else:
        assert lines[0].startswith("point 1 not demonstrable"), lines[:2]
        assert sum("not demonstrable" in ln for ln in lines) == 1
    p = subprocess.run([sys.executable, "-I", str(ROOT / "tools" / "make_sample.py"), str(d), str(work / f"cli{last}")],
                       capture_output=True, text=True, cwd=ROOT)
    assert p.returncode == 0, p.stderr
    assert p.stdout.splitlines()[0].startswith("point 1 not demonstrable") is (not demo)


def test_san_francisco_local_days(src, work):
    d = ms.sf_local_days("2026-11-19T00:00Z", 360)
    assert d["first"] == "2026-11-18" and d["last"] == "2026-12-03"
    assert d["full_days"] == 14 and d["dates"] == 16
    d = ms.sf_local_days("2026-11-19T00:00Z", 168)
    assert (d["first"], d["last"], d["full_days"], d["dates"]) == ("2026-11-18", "2026-11-25", 6, 8)  # 00Z is 16:00 the day before at SF
    assert ms.sf_local_days("2026-11-19T08:00Z", 168)["full_days"] == 7  # 08Z is local midnight
    assert ms.sf_local_days("2026-11-19T00:00Z", 48)["full_days"] == 1


def test_the_source_missing_and_checks_records_are_carried(work):
    """A live build that says which optional fields it lacks keeps saying so in the recording (data.missing())."""
    d = work / "src"
    make_live(d)
    m = json.load(open(d / "manifest.json"))
    missing = [{"field": "z500em", "reason": "ensemble mean not published yet"}]
    checks = {"grib_compare": {"status": "ok", "max_abs_gpm": 0.4, "points": 6, "tolerance_gpm": 1.0}}
    m["missing"], m["checks"] = missing, checks
    json.dump(m, open(d / "manifest.json", "w"))
    ms.make_sample(str(d), str(work / "rec"))
    mo = json.load(open(work / "rec" / "manifest.json"))
    assert mo["missing"] == missing and mo["checks"] == checks


def assert_domains_match_chunks(m):
    """The client picks a domain from the field's `domains` alone, so every chunk must have a file for each."""
    for fid, f in m["fields"].items():
        for dom in f["domains"]:
            for c in f["chunks"]:
                assert dom in c["files"], f"{fid} lists {dom} but chunk {c['id']} has no such file"


def test_after_stage_1_no_field_lists_a_domain_a_chunk_lacks(src, work):
    full = ms.make_sample(str(src), str(work / "full"))["bytes"]
    for cap, name in ((full - 1, "stage 1"), (1, "every stage")):
        out = work / ("r" + name[-1])
        try:
            ms.make_sample(str(src), str(out), cap_bytes=cap)
        except ms.SampleError:
            assert cap == 1
            continue
        m = json.load(open(out / "manifest.json"))
        assert_domains_match_chunks(m)
        assert all("np05" not in f["domains"] for f in m["fields"].values())
        assert max(m["fields"]["z500a"]["steps"]) == 360  # the week is still all there, from g1


def tree_bytes(d):
    return {f.name: f.read_bytes() for f in sorted(pathlib.Path(d).iterdir())}


def test_a_failed_run_leaves_the_earlier_recording_untouched(src, work, monkeypatch):
    prev = work / "prev"
    ms.make_sample(str(src), str(prev))
    before = tree_bytes(prev)
    # 1. over the cap after every drop
    with pytest.raises(ms.SampleError, match="over the cap"):
        ms.make_sample(str(src), str(prev), cap_bytes=1000)
    assert tree_bytes(prev) == before
    assert subprocess.run([sys.executable, "-I", str(ROOT / "tools" / "make_sample.py"), str(src), str(prev), "--cap-bytes", "1000"],
                          capture_output=True, text=True, cwd=ROOT).returncode == 1
    assert tree_bytes(prev) == before
    # 2. validation fails
    def bad_validate(_):
        raise ms.ValidationError("forced")
    monkeypatch.setattr(ms, "validate", bad_validate)
    with pytest.raises(ms.SampleError, match="does not validate"):
        ms.make_sample(str(src), str(prev))
    assert tree_bytes(prev) == before
    monkeypatch.undo()
    # 3. the decoded compare fails
    monkeypatch.setattr(ms, "compare_probes", lambda *a, **k: (_ for _ in ()).throw(ms.SampleError("forced")))
    with pytest.raises(ms.SampleError):
        ms.make_sample(str(src), str(prev))
    assert tree_bytes(prev) == before
    monkeypatch.undo()
    # no temporary folder is left beside it
    assert sorted(p.name for p in work.iterdir() if p.name.startswith(".")) == []
    # and a success does replace it
    ms.make_sample(str(src), str(prev), cap_bytes=ms.CAP_BYTES)
    assert tree_bytes(prev).keys() == before.keys()


def test_a_failed_swap_puts_the_earlier_recording_back(src, work, monkeypatch):
    prev = work / "prev"
    ms.make_sample(str(src), str(prev))
    before = tree_bytes(prev)
    real = os.rename

    def failing(a, b):
        name = os.path.basename(str(a))  # only the new recording's move in fails; putting the old one back works
        if name.startswith(".prev.tmp-") and not name.endswith(".old") and str(b) == str(prev):
            raise OSError("forced: the new recording cannot be moved in")
        return real(a, b)
    monkeypatch.setattr(ms.os, "rename", failing)
    with pytest.raises(OSError, match="forced"):
        ms.make_sample(str(src), str(prev))
    monkeypatch.undo()
    assert tree_bytes(prev) == before


def test_refuses_to_replace_a_folder_that_is_not_a_recording(src, work):
    out = work / "mine"
    out.mkdir()
    (out / "notes.txt").write_text("keep")
    with pytest.raises(ms.SampleError, match="not a recording folder"):
        ms.make_sample(str(src), str(out))
    assert (out / "notes.txt").read_text() == "keep"


def test_the_tool_runs_its_own_validation(src, work, monkeypatch, capsys):
    calls = []
    real = ms.validate
    monkeypatch.setattr(ms, "validate", lambda d: calls.append(d) or real(d))
    assert ms.main([str(src), str(work / "ok")]) == 0
    assert len(calls) == 1
    assert "verified: schema and bytes valid" in capsys.readouterr().out

    def bad(_):
        raise ms.ValidationError("forced failure")
    monkeypatch.setattr(ms, "validate", bad)
    assert ms.main([str(src), str(work / "bad")]) == 1
    cap = capsys.readouterr()
    assert "does not validate" in cap.err and "verified:" not in cap.out
    assert not (work / "bad").exists()


def test_the_tool_fails_when_a_decoded_frame_differs_from_the_source(src, work, monkeypatch, capsys):
    real = ms.read_source
    n = []

    def corrupting(path):
        m, fr = real(path)
        n.append(1)
        if len(n) > 1:  # the second read is the compare's: one frame of the source now differs
            key = ("z500", "g1")
            fr[key][120] = fr[key][120].copy()
            fr[key][120].flat[0] += 1
        return m, fr
    monkeypatch.setattr(ms, "read_source", corrupting)
    assert ms.main([str(src), str(work / "rec")]) == 1
    cap = capsys.readouterr()
    assert "differs from the source" in cap.err and "verified:" not in cap.out
    assert not (work / "rec").exists()


# ---- the committed recording (acceptance 2, 3 and 5 on the real run, not on a synthetic build) -------------------
RECORDED = ROOT / "tests" / "site" / "fixtures" / "recorded"


def recorded_manifest():
    """The committed recording's manifest. Its absence is a failure, not a skip: the product ships it by default."""
    if os.environ.get("WSE_SKIP_RECORDED"):
        pytest.skip("WSE_SKIP_RECORDED is set")
    p = RECORDED / "manifest.json"
    assert p.is_file(), ("tests/site/fixtures/recorded/ is missing: record a real run with "
                         "tools/make_sample.py <live build> tests/site/fixtures/recorded")
    return json.load(open(p))


def test_the_committed_recording_is_one_real_run_thinned_as_specified():
    m = recorded_manifest()
    assert validate(str(RECORDED))["fields"] == sorted(m["fields"])
    assert m["sample"] is True and "cases" not in m and "synthetic" not in json.dumps(m).lower()
    assert m["sample_label"] == ms.sample_label(m["run"])
    run = ms.parse_run(m["run"])
    assert run.hour in (0, 6, 12, 18) and run.minute == 0, "an ECMWF run starts at 00, 06, 12 or 18 UTC"
    assert dt.datetime.strptime(m["generated"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=dt.timezone.utc) > run
    assert "ECMWF" in m["model"] and "ECMWF" in m["attribution"]
    assert all(f.get("case") is None for f in m["fields"].values())
    for fid, f in m["fields"].items():
        assert all(ms.keep_step(s) for s in f["steps"]), (fid, [s for s in f["steps"] if not ms.keep_step(s)])
        assert f["domains"][0] == "g1" and set(f["domains"]) <= ({"g1", "np05"} if fid in ms.NP05_FIELDS else {"g1"}), fid
    files = sorted(os.listdir(RECORDED))
    ref = {meta["path"] for f in m["fields"].values() for c in f["chunks"] for meta in c["files"].values()}
    assert set(files) == ref | {"manifest.json"}
    assert sum(os.path.getsize(RECORDED / f) for f in files) <= ms.CAP_BYTES


def test_the_committed_recording_makes_your_week_a_week():
    """Acceptance 3: z500a reaches 168 h and San Francisco gets at least 7 whole local days (point 1)."""
    m = recorded_manifest()
    assert "z500a" in m["fields"]
    last = m["fields"]["z500a"]["steps"][-1]
    days = ms.sf_local_days(m["run"], last)
    assert last >= ms.WEEK_HOURS, f"z500a reaches {last} h: point 1 not demonstrable"
    assert days["full_days"] >= 7, f"San Francisco local days {days}: point 1 not demonstrable"
    gaps = [b - a for a, b in zip(m["fields"]["z500a"]["steps"], m["fields"]["z500a"]["steps"][1:])]
    assert max(gaps) <= 12, gaps


def test_the_committed_recording_looks_like_the_atmosphere():
    """A real 500 hPa field, not a pattern: plausible global heights, anomalies of both signs, decoded from the files."""
    m = recorded_manifest()
    f, d = m["fields"]["z500"], m["domains"]["g1"]
    ch = f["chunks"][0]
    q = decode_chunk(open(RECORDED / ch["files"]["g1"]["path"], "rb").read(), d["ny"], d["nx"],
                     ch["steps"][1] - ch["steps"][0], f["filter"])[0]
    z = dequantize(q, f["scale"], f["offset"])
    assert 4600 < np.nanmin(z) < 5300 and 5750 < np.nanmax(z) < 6050, (np.nanmin(z), np.nanmax(z))
    lat = d["lat0"] + d["dlat"] * np.arange(d["ny"])
    assert np.nanmean(z[np.abs(lat) < 20]) > np.nanmean(z[lat > 60]) + 200  # tropics higher than the Arctic
    fa = m["fields"]["z500a"]
    cha = fa["chunks"][0]
    qa = decode_chunk(open(RECORDED / cha["files"]["g1"]["path"], "rb").read(), d["ny"], d["nx"],
                      cha["steps"][1] - cha["steps"][0], fa["filter"])[0]
    za = dequantize(qa, fa["scale"], fa["offset"])
    assert np.nanmin(za) < -150 and np.nanmax(za) > 150 and abs(np.nanmean(za)) < 60, (np.nanmin(za), np.nanmax(za), np.nanmean(za))


def test_the_committed_recording_equals_its_source_build():
    """Acceptance 5 against the real source: WSE_RECORDED_SOURCE names the live build the recording was made from
    (it is too large for git, so this runs where that build is; elsewhere it says so and skips)."""
    m = recorded_manifest()
    srcdir = os.environ.get("WSE_RECORDED_SOURCE")
    if not srcdir:
        pytest.skip("WSE_RECORDED_SOURCE is not set (the live build the recording came from is outside git)")
    src = json.load(open(os.path.join(srcdir, "manifest.json")))
    assert src["run"] == m["run"] and src["sample"] is False
    cmp = ms.compare_probes(srcdir, str(RECORDED))
    assert cmp["mismatches"] == 0 and cmp["checked"] >= 5 * 3 * len(m["fields"]), cmp
