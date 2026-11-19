"""P-GATE (W2-01, MET-1; Josh points 8 and 16): a late optional product must never block or break a publish.

Guards DESIGN-SPEC 13.1 rules 1-8 and AUDIT-MET (e): run 44482208617 built every field but failed validation with
`requested field z500sd is missing from the build`, because all ensemble files were still 404 at 07:46 UTC.
The network is a function; the live build runs against the fake open-data server (grib_helpers.Store)."""
import datetime as dt
import json

import pytest

from grib_helpers import publish_run
from pipeline import build, runs, validate as val
from pipeline.encode import ManifestWriter
from test_fetch import LAT, LON
from test_manifest import HEAD, SMALL, STEPS, field
from test_steps import clim_file

UTC = dt.timezone.utc
RUN = dt.datetime(2026, 11, 18, 0, tzinfo=UTC)
FIELDS_JOSH = "z500,z500a,tp6,z500sd,t850a,ws250"  # run 44482208617's request


def head_ens(ens_status, now_ok=True):
    """oper files all 200; enfo-ep index files answer `ens_status` (a dict end-hour -> code, or one code)."""
    def head(url):
        if "-oper-fc" in url:
            return 200
        end = 240 if "-240h-" in url else 360
        return ens_status[end] if isinstance(ens_status, dict) else ens_status
    return head


def live_main(work, store, fields, steps, es_steps=None, skip=(), max_step=168):
    publish_run(store, RUN, steps, lat=LAT, lon=LON, es_steps=es_steps, skip=skip)
    out = work / "o"
    rc = build.main(["--run", "2026111800", "--source", store.url, "--out", str(out), "--clim", clim_file(work),
                     "--workdir", str(work / "raw"), "--max-step", str(max_step), "--fields", fields, "--workers", "3"])
    return rc, out


# ---- rules 4 and 6: what publishes, what still fails ---------------------------------------------------

def test_replay_of_run_44482208617_publishes_without_spread(work, store, capsys):
    """Every spread request was a 404 (es_steps=[]): the build now publishes, with z500sd listed as missing."""
    rc, out = live_main(work, store, FIELDS_JOSH, list(range(0, 169, 6)), es_steps=[])
    assert rc == 0, capsys.readouterr().err
    m = json.load(open(out / "manifest.json"))
    assert "z500sd" not in m["fields"] and [x["field"] for x in m["missing"]] == ["z500sd"]
    assert {"z500", "z500a", "tp6", "t850a", "ws250"} <= set(m["fields"])
    assert m["missing"][0]["reason"]


def test_spread_with_a_gap_at_steps_60_to_84_is_dropped_not_fatal(work, store, capsys):
    steps = list(range(0, 169, 6))
    rc, out = live_main(work, store, "z500,z500a,z500sd", steps, es_steps=[s for s in steps if s not in (66, 72, 78)])
    assert rc == 0, capsys.readouterr().err
    m = json.load(open(out / "manifest.json"))
    assert "z500sd" not in m["fields"] and "gap" in m["missing"][0]["reason"]
    # the dropped field's files and probes are gone, and the result still validates standalone
    assert not list(out.glob("z500sd.*"))
    assert not [p for p in m["probes"] if p["field"] == "z500sd"]
    val.validate(str(out), require_z500a_hours=168)


def test_a_complete_build_lists_nothing_missing(work, store):
    rc, out = live_main(work, store, "z500,z500a,z500sd", list(range(0, 169, 6)))
    assert rc == 0
    assert "missing" not in json.load(open(out / "manifest.json"))


def test_a_build_without_z500a_to_168_still_fails(work, store, capsys):
    rc, _ = live_main(work, store, "z500,z500a,z500sd", list(range(0, 121, 6)))
    assert rc == 2 and "z500a reaches 120 h, need 168 h" in capsys.readouterr().err


def test_a_required_field_with_a_gap_is_still_fatal(work, store, capsys):
    steps = [s for s in range(0, 169, 6) if s not in (60, 66)]
    rc, _ = live_main(work, store, "z500,z500a", steps)
    assert rc == 2 and "gap" in capsys.readouterr().err


# ---- rule 6: drop_optional itself ----------------------------------------------------------------------

def _two_fields(work, z500sd_steps):
    w = ManifestWriter(work, SMALL)
    w.add_field("z500a", STEPS, {d: field(STEPS, 0.0, 80.0, d) for d in SMALL})
    w.add_field("z500sd", z500sd_steps, {d: field(z500sd_steps, 8.0, 3.0, d) for d in SMALL})
    w.write(HEAD)


def test_drop_optional_removes_files_entry_probes_and_records_why(work):
    _two_fields(work, STEPS)
    val.drop_optional(str(work), "z500sd", "test reason")
    m = json.load(open(work / "manifest.json"))
    assert list(m["fields"]) == ["z500a"] and m["missing"] == [{"field": "z500sd", "reason": "test reason"}]
    assert not list(work.glob("z500sd.*")) and not [p for p in m["probes"] if p["field"] == "z500sd"]
    val.validate(str(work))


def test_drop_optional_refuses_a_required_field(work):
    _two_fields(work, STEPS)
    with pytest.raises(val.ValidationError, match="required"):
        val.drop_optional(str(work), "z500a", "x")


def test_required_is_one_constant_shared_by_build_and_validate():
    assert val.REQUIRED == ("z500", "z500a") and build.REQUIRED is val.REQUIRED


def test_an_optional_field_out_of_range_is_dropped_by_the_driver(work):
    w = ManifestWriter(work, SMALL)
    w.add_field("z500a", STEPS, {d: field(STEPS, 0.0, 80.0, d) for d in SMALL})
    w.add_field("z500sd", STEPS, {d: field(STEPS, 900.0, 3.0, d) for d in SMALL})  # a unit slip: 0-250 allowed
    w.write(HEAD)
    res = val.validate_dropping_optional(str(work), require_z500a_hours=168, require_fields=["z500a", "z500sd"], max_step=360)
    assert res["fields"] == ["z500a"] and res["missing"] == ["z500sd"]


def test_an_optional_all_no_data_frame_is_dropped_but_a_required_one_is_fatal(work):
    import numpy as np
    for fid, fatal in (("z500sd", False), ("z500a", True)):
        d = work / fid
        d.mkdir()
        w = ManifestWriter(d, SMALL)
        good = {k: field(STEPS, 0.0, 80.0, k) for k in SMALL}
        bad = {k: np.where(np.arange(len(STEPS))[:, None, None] == 3, np.nan, field(STEPS, 8.0, 3.0, k)) for k in SMALL}
        if fid == "z500sd":
            w.add_field("z500a", STEPS, good)
            w.add_field("z500sd", STEPS, bad)
        else:
            w.add_field("z500a", STEPS, bad)
        w.write(HEAD)
        if fatal:
            with pytest.raises(val.ValidationError, match="no-data"):
                val.validate_dropping_optional(str(d), require_z500a_hours=168, max_step=360)
        else:
            r = val.validate_dropping_optional(str(d), require_z500a_hours=168, max_step=360)
            assert r["missing"] == ["z500sd"]


# ---- rule 7: every id has a range --------------------------------------------------------------------

@pytest.mark.parametrize("fid,rng", [("z500em", (4500, 6200)), ("pr1", (0, 100)), ("pr10", (0, 100)), ("t2m", (180, 335))])
def test_ranges_have_a_row_for_every_new_id(fid, rng):
    assert val.RANGES[fid] == rng


def test_every_field_the_contract_knows_has_a_range():
    from pipeline.encode import FIELD_META
    assert set(FIELD_META) <= set(val.RANGES)


def test_an_id_without_a_range_is_a_validation_error_not_a_key_error(work, monkeypatch):
    _two_fields(work, STEPS)
    monkeypatch.delitem(val.RANGES, "z500sd")
    with pytest.raises(val.ValidationError, match="z500sd.*range"):
        val.validate(str(work))


# ---- rules 1-4: decide -------------------------------------------------------------------------------

def at(hours_after):
    return RUN + dt.timedelta(hours=hours_after)


def test_ensemble_index_urls_are_the_enfo_ep_index_files():
    assert runs.ens_index_url("ecmwf", RUN, 240) == "https://data.ecmwf.int/forecasts/20261118/00z/ifs/0p25/enfo/20261118000000-240h-enfo-ep.index"
    assert runs.ens_index_url("aws", RUN, 360).endswith("/enfo/20261118000000-360h-enfo-ep.index")


def test_rule1_a_missing_360h_index_waits_while_the_run_is_young():
    h = head_ens({240: 200, 360: 404})
    d = runs.decide(at(7.8), h, None, fields=FIELDS_JOSH.split(","))
    assert d["build"] is False and "ensemble" in d["reason"]


def test_rule1_it_builds_without_them_once_the_run_is_over_ten_hours_old():
    h = head_ens({240: 200, 360: 404})
    d = runs.decide(at(10.5), h, None, fields=FIELDS_JOSH.split(","))
    assert d["build"] is True and "ensemble" in d["reason"] and d.get("warning")


def test_rule1_exactly_ten_hours_is_the_boundary():
    h = head_ens({240: 200, 360: 404})
    assert runs.decide(at(9.99), h, None, fields=["z500sd"])["build"] is False
    assert runs.decide(at(10), h, None, fields=["z500sd"])["build"] is True


def test_rule1_a_503_is_no_answer_and_is_retried_by_the_next_slot():
    h = head_ens({240: 200, 360: 503})
    d = runs.decide(at(8), h, None, fields=["z500sd"])
    assert d["build"] is False and "ensemble" in d["reason"]
    assert runs.decide(at(8), head_ens({240: 0, 360: 200}), None, fields=["z500sd"])["build"] is False  # a timeout too


def test_the_360h_index_is_asked_only_when_the_run_reaches_beyond_240():
    asked = []

    def h(url):
        asked.append(url)
        return 200
    runs.decide(at(8), h, None, fields=["z500sd"])
    assert any("-360h-enfo-ep.index" in u for u in asked)
    asked.clear()

    def h240(url):
        asked.append(url)
        return 200 if "oper" in url and "-240h-" in url or "-168h-" in url or "enfo" in url else 404
    runs.decide(at(8), h240, None, fields=["z500sd"])
    assert not any("-360h-enfo-ep.index" in u for u in asked) and any("-240h-enfo-ep.index" in u for u in asked)


def test_no_ensemble_field_requested_means_no_ensemble_probe():
    asked = []

    def h(url):
        asked.append(url)
        return 200
    d = runs.decide(at(8), h, None, fields=["z500", "z500a", "tp6"])
    assert d["build"] is True and not any("enfo" in u for u in asked)


def test_all_ensemble_files_posted_builds_at_once():
    d = runs.decide(at(7.8), head_ens(200), None, fields=FIELDS_JOSH.split(","))
    assert d["build"] is True and not d.get("warning")


def test_replay_run_44482208617_at_dispatch_time_waits_then_builds_when_posted():
    """HRES posted 07:34, ensemble 08:01, dispatch 07:46: the 07:46 slot waits instead of failing."""
    f = FIELDS_JOSH.split(",")
    assert runs.decide(at(7.77), head_ens(404), None, fields=f)["build"] is False
    assert runs.decide(at(8.1), head_ens(200), None, fields=f)["build"] is True


def pub(missing=None, top=360, run=RUN):
    m = {"run": run.strftime("%Y-%m-%dT%H:%MZ"), "fields": {"z500a": {"steps": list(range(0, top + 1, 6))}}}
    if missing is not None:
        m["missing"] = missing
    return json.dumps(m)


def test_rule2_a_run_published_without_spread_is_repaired_when_the_index_appears():
    p = pub([{"field": "z500sd", "reason": "ensemble files not yet published"}])
    d = runs.decide(at(11), head_ens(200), p, fields=FIELDS_JOSH.split(","))
    assert d["build"] is True and d["reason"] == "missing optional field now posted"


def test_rule2_but_not_while_the_index_is_still_404_or_unanswered():
    p = pub([{"field": "z500sd", "reason": "x"}])
    for code in (404, 503, 0):
        d = runs.decide(at(11), head_ens(code), p, fields=["z500sd"])
        assert d["build"] is False and "already published" in d["reason"], code


def test_rule2_a_missing_non_ensemble_field_does_not_trigger_a_rebuild():
    p = pub([{"field": "tp6", "reason": "x"}])
    assert runs.decide(at(11), head_ens(200), p, fields=FIELDS_JOSH.split(","))["build"] is False


def test_rule2_a_field_not_requested_this_time_is_not_repaired():
    p = pub([{"field": "z500sd", "reason": "x"}])
    assert runs.decide(at(11), head_ens(200), p, fields=["z500", "z500a"])["build"] is False


def test_published_info_returns_the_missing_fields():
    r, top, miss = runs.published_info(pub([{"field": "z500sd", "reason": "x"}]))
    assert (r, top, miss) == (RUN, 360, ["z500sd"])
    assert runs.published_info(pub())[2] == []
    assert runs.published_info("{bad") is None


def test_rule3_a_newer_run_still_waits_for_the_ensemble_even_when_an_older_run_is_published():
    prev = RUN - dt.timedelta(hours=12)
    d = runs.decide(at(3), head_ens(404), pub(run=prev), fields=["z500sd"])
    assert d["build"] is False and "ensemble" in d["reason"]


# ---- rule 4 (decide side): force and --run probe too and warn ------------------------------------------

def test_force_still_builds_when_ensemble_files_are_missing_and_warns():
    d = runs.decide(at(2), head_ens(404), pub(), fields=["z500sd"], force=True)
    assert d["build"] is True and d["reason"].startswith("forced") and "ensemble" in d["warning"]
    assert "warning" not in runs.decide(at(2), head_ens(200), pub(), fields=["z500sd"], force=True)


def test_cli_force_prints_a_github_warning_but_not_into_the_output_file(work, monkeypatch, capsys):
    out = work / "gho"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    rc = runs.main(["--force", "--fields", FIELDS_JOSH], head=head_ens({240: 200, 360: 404}), now=at(2))
    o = capsys.readouterr().out
    assert rc == 0 and "build=true" in o and "::warning::" in o and "ensemble" in o
    assert "::warning::" not in out.read_text() and "warning=" not in out.read_text()


def test_cli_run_probes_builds_and_warns(capsys):
    rc = runs.main(["--run", "2026111800", "--fields", "z500sd"], head=head_ens(404), now=at(2))
    o = capsys.readouterr().out
    assert rc == 0 and "build=true" in o and "::warning::" in o
    rc = runs.main(["--run", "2026111800", "--fields", "z500sd"], head=head_ens(200), now=at(2))
    assert rc == 0 and "::warning::" not in capsys.readouterr().out


def test_cli_waits_through_main_with_fields(capsys):
    assert runs.main(["--fields", FIELDS_JOSH], head=head_ens(404), now=at(7.8)) == 0
    assert "build=false" in capsys.readouterr().out


# ---- the CLI data.yml runs: `pipeline/run.py validate` (validate.main), the real production failure point -------

import subprocess
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_VALIDATE_ARGS = ["--require-z500a-hours", "168", "--fields", FIELDS_JOSH, "--max-step", "168"]


def run_validate_cli(out):
    return subprocess.run([sys.executable, str(_ROOT / "pipeline" / "run.py"), "validate", str(out), *_VALIDATE_ARGS],
                          capture_output=True, text=True, cwd=str(_ROOT), timeout=120)


def test_cli_validate_passes_a_replay_without_spread_and_lists_it_missing(work, store):
    """(a) the build's output with z500sd absent: the Validate step of data.yml exits 0 and reports it missing."""
    rc, out = live_main(work, store, FIELDS_JOSH, list(range(0, 169, 6)), es_steps=[])
    assert rc == 0
    r = run_validate_cli(out)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout)["missing"] == ["z500sd"] and '"missing": ["z500sd"]' in r.stdout


def _six_fields(work, z500sd_steps, z500a_steps=None):
    steps = list(range(0, 169, 6))
    w = ManifestWriter(work, SMALL)
    for fid, base, amp, st in (("z500", 5500.0, 100.0, steps), ("z500a", 0.0, 80.0, z500a_steps or steps),
                               ("tp6", 2.0, 1.0, steps), ("z500sd", 8.0, 3.0, z500sd_steps),
                               ("t850a", 0.0, 5.0, steps), ("ws250", 40.0, 10.0, steps)):
        w.add_field(fid, st, {d: field(st, base, amp, d) for d in SMALL})
    w.write(HEAD)
    return work


def test_cli_validate_passes_when_z500sd_has_a_gap_and_reports_it_missing(work):
    """(b) z500sd present but with a gap at 60-84: validate drops it (rc 0), never fails the publish."""
    gapped = [s for s in range(0, 169, 6) if s not in (66, 72, 78)]
    r = run_validate_cli(_six_fields(work, gapped))
    assert r.returncode == 0, r.stderr
    res = json.loads(r.stdout)
    assert res["missing"] == ["z500sd"] and "z500sd" not in res["fields"] and '"missing": ["z500sd"]' in r.stdout


def test_cli_validate_still_fails_exit_2_when_z500a_is_short_of_168_hours(work):
    """(c) a required field short of 168 h fails the publish: exit 2 with the reason on stderr."""
    full = list(range(0, 169, 6))
    r = run_validate_cli(_six_fields(work, full, z500a_steps=list(range(0, 121, 6))))
    assert r.returncode == 2 and "z500a reaches 120 h, need 168 h" in r.stderr
