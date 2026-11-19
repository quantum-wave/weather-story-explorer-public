"""P-RUNS: which run is newest, and should this scheduled run build? The network is a dict, never a socket."""
import datetime as dt
import json

from pipeline import runs

UTC = dt.timezone.utc
NOW = dt.datetime(2026, 11, 18, 9, 30, tzinfo=UTC)
R00 = dt.datetime(2026, 11, 18, 0, tzinfo=UTC)
R12_PREV = dt.datetime(2026, 11, 17, 12, tzinfo=UTC)


def head_for(posted):
    """posted: {(source, run, step): True}; everything else is a 404."""
    def head(url):
        for (src, run, step) in posted:
            if url == runs.oper_url(src, run, step):
                return 200
        return 404
    return head


def manifest(run, top):
    return json.dumps({"run": run.strftime("%Y-%m-%dT%H:%MZ"), "fields": {"z500a": {"steps": list(range(0, top + 1, 6))}}})


def test_urls_follow_the_client_layout():
    assert runs.oper_url("ecmwf", R00, 168) == "https://data.ecmwf.int/forecasts/20261118/00z/ifs/0p25/oper/20261118000000-168h-oper-fc.grib2"
    assert runs.oper_url("aws", R00, 6, "aifs") == ("https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/20261118/00z/aifs-single/0p25/oper/"
                                                  "20261118000000-6h-oper-fc.grib2")
    assert runs.ens_url("google", R12_PREV, 246).endswith("/20261117/12z/ifs/0p25/enfo/20261117120000-360h-enfo-ep.grib2")
    assert runs.ens_url("google", R12_PREV, 240).endswith("-240h-enfo-ep.grib2")


def test_candidate_runs_are_newest_first_and_never_in_the_future():
    c = runs.candidate_runs(dt.datetime(2026, 11, 18, 5, tzinfo=UTC))
    assert c[0] == dt.datetime(2026, 11, 18, 0, tzinfo=UTC) and c[1] == R12_PREV
    assert c == sorted(c, reverse=True) and all(r <= dt.datetime(2026, 11, 18, 5, tzinfo=UTC) for r in c)


def test_newest_run_needs_168_hours_posted():
    # 00Z has only steps up to 120 (not yet at 168): fall back to the previous 12Z, which is complete
    posted = {("ecmwf", R12_PREV, 360): True, ("ecmwf", R12_PREV, 240): True, ("ecmwf", R12_PREV, 168): True}
    assert runs.newest_run(NOW, head_for(posted)) == (R12_PREV, "ecmwf", 360)
    posted[("ecmwf", R00, 168)] = True
    assert runs.newest_run(NOW, head_for(posted)) == (R00, "ecmwf", 168)
    posted[("ecmwf", R00, 360)] = True
    assert runs.newest_run(NOW, head_for(posted)) == (R00, "ecmwf", 360)


def test_nothing_posted_returns_none():
    assert runs.newest_run(NOW, head_for({})) is None


def test_an_unreachable_source_is_dropped_and_the_next_is_used():
    calls = []

    def head(url):
        calls.append(url)
        if url.startswith(runs.ROOTS["ecmwf"]):
            return 0  # blocked or down
        return 200 if url == runs.oper_url("aws", R00, 360) else 404
    assert runs.newest_run(NOW, head) == (R00, "aws", 360)
    assert sum(u.startswith(runs.ROOTS["ecmwf"]) for u in calls) == 1  # asked once, then skipped


def test_decide_builds_when_nothing_is_published():
    d = runs.decide(NOW, head_for({("ecmwf", R00, 360): True}), None)
    assert d["build"] is True and d["run"] == "2026111800" and d["source"] == "ecmwf" and d["max_step"] == 360


def test_decide_skips_when_the_published_run_is_current_and_complete():
    d = runs.decide(NOW, head_for({("ecmwf", R00, 360): True}), manifest(R00, 360))
    assert d["build"] is False and "already published" in d["reason"]


def test_decide_builds_a_newer_run():
    d = runs.decide(NOW, head_for({("ecmwf", R00, 360): True}), manifest(R12_PREV, 360))
    assert d["build"] is True and "newer run" in d["reason"]


def test_decide_rebuilds_the_same_run_when_more_steps_have_since_posted():
    d = runs.decide(NOW, head_for({("ecmwf", R00, 360): True}), manifest(R00, 168))
    assert d["build"] is True and "now reaches 360" in d["reason"]


def test_decide_does_not_go_backwards_to_an_older_run():
    d = runs.decide(NOW, head_for({("ecmwf", R12_PREV, 360): True}), manifest(R00, 360))
    assert d["build"] is False


def test_decide_force_and_unreadable_manifest():
    posted = head_for({("ecmwf", R00, 360): True})
    assert runs.decide(NOW, posted, manifest(R00, 360), force=True)["build"] is True
    assert runs.decide(NOW, posted, "{not json")["build"] is True
    assert runs.decide(NOW, head_for({}), None)["build"] is False


def test_cli_writes_github_output_and_stdout(work, monkeypatch, capsys):
    out = work / "gho"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    pub = work / "published.json"
    pub.write_text(manifest(R12_PREV, 360))
    rc = runs.main(["--published", str(pub)], head=head_for({("ecmwf", R00, 360): True}), now=NOW)
    assert rc == 0
    text = out.read_text()
    assert "build=true" in text and "run=2026111800" in text and "source=ecmwf" in text
    assert "build=true" in capsys.readouterr().out


def test_cli_requested_run_fails_when_not_posted(capsys):
    assert runs.main(["--run", "2026111800"], head=head_for({}), now=NOW) == 1
    assert runs.main(["--run", "2026111800"], head=head_for({("google", R00, 360): True}), now=NOW) == 0
    assert "source=google" in capsys.readouterr().out


def test_module_imports_nothing_outside_the_standard_library():
    import ast
    import pathlib
    tree = ast.parse(pathlib.Path(runs.__file__).read_text())
    mods = {n.names[0].name.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.Import)}
    mods |= {n.module.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module and n.level == 0}
    import sys
    assert mods <= set(sys.stdlib_module_names) | {"__future__"}, mods
