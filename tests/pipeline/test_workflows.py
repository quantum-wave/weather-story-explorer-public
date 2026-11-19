"""P-WORKFLOW: the data and clim workflows are consistent with the code they call, cost little, and their shell
steps behave (run for real in a scratch git repo with a stubbed python3; the Actions runner itself is not here)."""
import os
import pathlib
import re
import stat
import subprocess

import pytest
import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
WF = ROOT / ".github" / "workflows"


def load(name):
    d = yaml.safe_load((WF / name).read_text())
    d["on"] = d.get("on", d.get(True))  # PyYAML reads the key `on` as boolean True
    return d


def steps(wf):
    return next(iter(wf["jobs"].values()))["steps"]


def step(wf, prefix):
    return next(s for s in steps(wf) if s.get("name", "").startswith(prefix))


def all_runs(wf):
    return [s["run"] for s in steps(wf) if "run" in s]


def test_data_workflow_schedule_limits_and_permissions():
    d = load("data.yml")
    assert [c["cron"] for c in d["on"]["schedule"]] == ["30 9,10,11,21,22,23 * * *"]  # SPEC section 10
    assert "workflow_dispatch" in d["on"]
    job = d["jobs"]["data"]
    assert job["timeout-minutes"] == 30
    assert d["permissions"] == {"contents": "write"}
    assert d["concurrency"]["cancel-in-progress"] is False


def test_clim_workflow_is_manual_only_and_writes_the_clim_branch():
    c = load("clim.yml")
    assert "schedule" not in c["on"] and "workflow_dispatch" in c["on"]
    assert c["jobs"]["clim"]["timeout-minutes"] == 30 and c["permissions"] == {"contents": "write"}
    pub = step(c, "Publish")["run"]
    assert "--branch clim" in pub and "--dest harmonics.npz" in pub


def test_the_idle_path_installs_nothing_and_nothing_polls():
    d = load("data.yml")
    names = [s.get("name", s.get("uses")) for s in steps(d)]
    decide = names.index("Is there anything new?")
    setup = next(i for i, s in enumerate(steps(d)) if str(s.get("uses", "")).startswith("actions/setup-python"))
    assert decide < setup
    body = step(d, "Is there anything new?")["run"]
    assert not re.search(r"\bpip\b", body) and "python3 -I pipeline/run.py runs" in body
    for s in steps(d)[setup:]:
        assert s["if"] == "steps.decide.outputs.build == 'true'"  # every later step is skipped when idle
    for r in all_runs(d) + all_runs(load("clim.yml")):
        assert not re.search(r"\b(sleep|until|while)\b", r), r  # no in-job polling (SPEC section 10)


def test_no_workflow_input_is_interpolated_into_a_shell_script():
    for name in ("data.yml", "clim.yml"):
        for r in all_runs(load(name)):
            assert "${{" not in r, f"{name}: pass `${{{{ }}}}` values through env, not into the script: {r[:80]}"


def test_commands_and_flags_exist_in_the_code():
    sys_path = str(ROOT)
    import sys
    sys.path.insert(0, sys_path)
    from pipeline.run import COMMANDS
    for name in ("data.yml", "clim.yml"):
        for r in all_runs(load(name)):
            for m in re.finditer(r"pipeline/run\.py (\w+)([^|\n]*(?:\\\n[^|\n]*)*)", r):
                cmd, rest = m.group(1), m.group(2)
                assert cmd in COMMANDS, cmd
                src = (ROOT / (COMMANDS[cmd].replace(".", "/") + ".py")).read_text()
                for flag in re.findall(r"(--[a-z0-9-]+)", rest):
                    assert f'"{flag}"' in src, f"{name}: {cmd} has no {flag}"


def test_both_workflows_agree_on_the_branch_and_file_names():
    d = (WF / "data.yml").read_text()
    assert "FETCH_HEAD:harmonics.npz" in d and "origin clim" in d and "--branch data" in d
    assert "latest" in d and "--keep-other" in d  # the aifs directory sits beside latest/
    assert "--require-z500a-hours 168" in d


def test_requirements_are_pinned_and_cover_the_imports():
    lines = [l.split("#")[0].strip() for l in (ROOT / "requirements.txt").read_text().splitlines()]
    lines = [l for l in lines if l]
    assert all("==" in l for l in lines), lines
    names = {l.split("==")[0] for l in lines}
    assert {"numpy", "eccodes", "eccodeslib", "ecmwf-opendata", "jsonschema", "requests"} <= names
    dev = (ROOT / "requirements-dev.txt").read_text()
    assert "-r requirements.txt" in dev and "pytest==" in dev


# ---- the shell steps, run for real ---------------------------------------------------------------------

def sh(cwd, *args, env=None):
    r = subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", *args], cwd=cwd, capture_output=True,
                       text=True, env=env)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


@pytest.fixture
def scratch(work):
    """A checkout whose origin may hold `data` and `clim` branches, plus a stub python3 that records its arguments."""
    bare = work / "remote.git"
    sh(work, "init", "-q", "--bare", "-b", "main", str(bare))
    co = work / "co"
    co.mkdir()
    sh(co, "init", "-q", "-b", "main")
    (co / "f").write_text("x")
    sh(co, "add", ".")
    sh(co, "commit", "-q", "-m", "m")
    sh(co, "remote", "add", "origin", str(bare))
    sh(co, "push", "-q", "origin", "main")
    bindir = work / "bin"
    bindir.mkdir()
    for name in ("python3", "python"):
        shim = bindir / name
        shim.write_text('#!/bin/bash\necho "$@" >> "$SHIM_LOG"\ncat "$SHIM_OUT"\n')
        shim.chmod(shim.stat().st_mode | stat.S_IEXEC)
    return co, bare, bindir


def branch(co, bare, name, files):
    w = co.parent / f"w-{name}"
    w.mkdir()
    sh(w, "init", "-q", "-b", name)
    for k, v in files.items():
        p = w / k
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(v)
    sh(w, "add", ".")
    sh(w, "commit", "-q", "-m", name)
    sh(w, "push", "-q", str(bare), f"{name}:{name}")


def run_step(co, bindir, script, env, out):
    e = dict(os.environ, PATH=f"{bindir}:{os.environ['PATH']}", GITHUB_OUTPUT=str(out), GITHUB_STEP_SUMMARY=str(out) + ".sum",
             GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@x", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@x", **env)
    return subprocess.run(["bash", "-c", script], cwd=co, capture_output=True, text=True, env=e)


def decide(scratch, work, canned, env=None, published=None):
    co, bare, bindir = scratch
    if published is not None:
        branch(co, bare, "data", {"latest/manifest.json": published, "latest-aifs/manifest.json": "AIFS"})
    (work / "out.txt").write_text(canned)
    script = step(load("data.yml"), "Is there anything new?")["run"]
    e = {"MODEL": "ifs", "FIELDS": "z500,z500a,tp6,z500sd,t850a,ws250", "INPUT_RUN": "", "INPUT_FORCE": "false", "SHIM_LOG": str(work / "log"), "SHIM_OUT": str(work / "out.txt")}
    e.update(env or {})
    r = run_step(co, bindir, script, e, work / "gho")
    log = (work / "log").read_text() if (work / "log").exists() else ""
    return r, log, (work / "gho").read_text() if (work / "gho").exists() else ""


def test_decide_passes_the_published_manifest_when_the_data_branch_has_one(scratch, work):
    r, log, gho = decide(scratch, work, "build=true\nrun=2026111800\nsource=ecmwf\nmax_step=360\nreason=x\n", published='{"run": "x"}')
    assert r.returncode == 0, r.stderr
    assert "--published out/published.json" in log and "--model ifs" in log
    assert (scratch[0] / "out" / "published.json").read_text() == '{"run": "x"}'
    assert "dir=latest" in gho.splitlines()


def test_decide_without_a_data_branch_asks_with_nothing_published(scratch, work):
    r, log, gho = decide(scratch, work, "build=true\nrun=2026111800\nsource=ecmwf\nmax_step=360\nreason=x\n")
    assert r.returncode == 0, r.stderr
    assert "--published" not in log and "no published latest/manifest.json yet" in r.stdout


def test_decide_aifs_reads_its_own_directory_and_forwards_dispatch_inputs(scratch, work):
    r, log, gho = decide(scratch, work, "build=true\nrun=2026111812\nsource=aws\nmax_step=168\nreason=x\n",
                         env={"MODEL": "aifs", "INPUT_RUN": "2026111812", "INPUT_FORCE": "true"}, published='{"run": "x"}')
    assert r.returncode == 0, r.stderr
    assert "--model aifs" in log and "--run 2026111812" in log and "--force" in log
    assert (scratch[0] / "out" / "published.json").read_text() == "AIFS"
    assert "dir=latest-aifs" in gho.splitlines()


def test_decide_says_so_and_stops_cleanly_when_nothing_is_new(scratch, work):
    r, log, gho = decide(scratch, work, "build=false\nrun=2026111800\nsource=ecmwf\nmax_step=360\nreason=already published 2026111800 to 360 h\n")
    assert r.returncode == 0
    assert "::notice::nothing to build: already published 2026111800 to 360 h" in r.stdout
    assert "build=false" in r.stdout


def test_clim_fetch_step_fails_with_a_clear_message_when_the_branch_is_missing(scratch, work):
    co, bare, bindir = scratch
    script = step(load("data.yml"), "Fetch the climatology")["run"]
    r = run_step(co, bindir, script, {}, work / "gho")
    assert r.returncode == 1
    assert "::error::The 'clim' branch (harmonics.npz) does not exist. Run the 'clim' workflow once" in r.stdout


def test_clim_fetch_step_extracts_harmonics_when_present(scratch, work):
    co, bare, bindir = scratch
    branch(co, bare, "clim", {"harmonics.npz": "NPZ"})
    r = run_step(co, bindir, step(load("data.yml"), "Fetch the climatology")["run"], {}, work / "gho")
    assert r.returncode == 0, r.stdout + r.stderr
    assert (co / "clim" / "harmonics.npz").read_text() == "NPZ"


@pytest.mark.parametrize("fields", ["z500,z500a,tp6", "z500,ws250"])
def test_validate_step_always_gates_a_live_run(scratch, work, fields):
    """Whatever fields were asked for, a live run is gated: z500a to 168 h, every requested field present, no gaps."""
    co, bare, bindir = scratch
    (co / "out").mkdir()
    (work / "out.txt").write_text('{"fields": []}\n')
    env = {"FIELDS": fields, "RUN": "2026111800", "MODEL": "ifs", "MAX_STEP": "360", "SHIM_LOG": str(work / "log"), "SHIM_OUT": str(work / "out.txt")}
    r = run_step(co, bindir, step(load("data.yml"), "Validate")["run"], env, work / "gho")
    assert r.returncode == 0, r.stderr
    log = (work / "log").read_text()
    assert "validate out/data" in log and "--require-z500a-hours 168" in log
    assert f"--fields {fields}" in log and "--max-step 360" in log
    assert "built run 2026111800 (ifs)" in (work / "gho.sum").read_text()


# ---- W2-01 (Josh points 8, 16): the decide step knows the fields; missing optional fields are reported ----------

def test_decide_step_passes_the_fields_to_the_decide_command(scratch, work):
    r, log, gho = decide(scratch, work, "build=true\nrun=2026111800\nsource=ecmwf\nmax_step=360\nreason=x\n",
                         env={"FIELDS": "z500,z500a,z500sd"}, published='{"run": "x"}')
    assert r.returncode == 0, r.stderr
    assert "--fields z500,z500a,z500sd" in log and "--model ifs" in log


def test_decide_step_fields_flag_is_forwarded_for_every_dispatch_shape(scratch, work):
    r, log, _ = decide(scratch, work, "build=true\nrun=2026111812\nsource=aws\nmax_step=168\nreason=x\n",
                       env={"FIELDS": "z500,z500a", "INPUT_RUN": "2026111812", "INPUT_FORCE": "true"})
    assert "--fields z500,z500a" in log and "--run 2026111812" in log and "--force" in log


def _validate_step(scratch, work, validate_json):
    co, bare, bindir = scratch
    (co / "out").mkdir(exist_ok=True)
    (work / "out.txt").write_text(validate_json)
    env = {"FIELDS": "z500,z500a,z500sd", "RUN": "2026111800", "MODEL": "ifs", "MAX_STEP": "360",
           "SHIM_LOG": str(work / "log"), "SHIM_OUT": str(work / "out.txt")}
    return run_step(co, bindir, step(load("data.yml"), "Validate")["run"], env, work / "gho")


def test_validate_step_warns_and_summarises_missing_optional_fields(scratch, work):
    r = _validate_step(scratch, work, '{"fields": ["z500", "z500a"], "files": 4, "bytes": 9, "probes": 2, "missing": ["z500sd"]}\n')
    assert r.returncode == 0, r.stderr
    assert "::warning::published without optional field(s): z500sd" in r.stdout
    summary = (work / "gho.sum").read_text()
    assert "Published without optional field(s): **z500sd**" in summary and "built run 2026111800 (ifs)" in summary


def test_validate_step_is_quiet_when_nothing_is_missing(scratch, work):
    r = _validate_step(scratch, work, '{"fields": ["z500", "z500a", "z500sd"], "files": 4, "bytes": 9, "probes": 2, "missing": []}\n')
    assert r.returncode == 0, r.stderr
    assert "::warning::" not in r.stdout and "Published without" not in (work / "gho.sum").read_text()


# ---- W4-08 (Josh points 8, 15, 16; MET-10, MET-12, TEST-9): IVT on the scheduled 00Z run only, the raw-GRIB check, nightly ----

GUARD = "github.repository == 'quantum-wave/weather-story-explorer-public'"


def _fields_passed(scratch, work, name, event, run, model="ifs"):
    """Run the Build or Validate step for real against a stub python and return its --fields argument."""
    co, bare, bindir = scratch
    (co / "out").mkdir(exist_ok=True)
    (work / "out.txt").write_text('{"fields": []}\n')
    env = {"FIELDS": "z500,z500a,t2m", "RUN": run, "MODEL": model, "MAX_STEP": "360", "SOURCE": "ecmwf", "EVENT_NAME": event,
           "SHIM_LOG": str(work / "log"), "SHIM_OUT": str(work / "out.txt")}
    r = run_step(co, bindir, step(load("data.yml"), name)["run"], env, work / "gho")
    assert r.returncode == 0, r.stderr
    log = (work / "log").read_text()
    return re.search(r"--fields (\S+)", log).group(1)


@pytest.mark.parametrize("name", ["Build", "Validate"])
@pytest.mark.parametrize("event,run,model,ivt", [
    ("schedule", "2026111900", "ifs", True),            # the scheduled 00Z run
    ("schedule", "2026111912", "ifs", False),           # 12Z: never
    ("workflow_dispatch", "2026111900", "ifs", False),  # a manual run says what it wants in `fields`
    ("schedule", "2026111900", "aifs", False),
    ("schedule", "2026111800", "ifs", True),
])
def test_ivt_is_added_on_the_scheduled_00z_run_only(scratch, work, name, event, run, model, ivt):
    got = _fields_passed(scratch, work, name, event, run, model)
    assert got == ("z500,z500a,t2m,ivt" if ivt else "z500,z500a,t2m")


def test_the_data_default_fields_carry_t2m_but_not_ivt():
    d = load("data.yml")
    env = d["jobs"]["data"]["env"]["FIELDS"]
    assert ",t2m'" in env and "ivt" not in env
    assert "t2m" in d["on"]["workflow_dispatch"]["inputs"]["fields"]["default"].split(",")


def test_data_cross_checks_one_raw_step_after_validate_and_never_blocks_the_publish():
    d = load("data.yml")
    names = [s.get("name", "") for s in steps(d)]
    i = names.index("Cross-check against the raw GRIB")
    assert names.index("Validate") < i < names.index("Publish to the data branch")
    s = steps(d)[i]
    assert s["continue-on-error"] is True and s["if"] == "steps.decide.outputs.build == 'true'"
    src = (ROOT / "tools" / "compare_grib.py").read_text()
    assert "--step 24" in s["run"]  # one step
    for flag in re.findall(r"(--[a-z0-9-]+)", s["run"]):
        assert f'"{flag}"' in src, flag
    assert "exit 1" not in s["run"]


def test_nightly_every_job_carries_the_repository_guard_and_nothing_publishes():
    n = load("nightly.yml")
    assert n["jobs"] and all(GUARD in j.get("if", "") for j in n["jobs"].values())
    assert n["permissions"] == {"contents": "read"} and "schedule" in n["on"] and "workflow_dispatch" in n["on"]
    text = (WF / "nightly.yml").read_text()
    assert not re.search(r"pipeline/run\.py publish|git push|gh workflow|gh run", text)


def test_nightly_builds_two_real_steps_with_every_field_including_the_ensemble_files():
    import sys
    sys.path.insert(0, str(ROOT))
    from pipeline import build, fetch
    n = load("nightly.yml")
    job = next(iter(n["jobs"].values()))
    fields = job["env"]["FIELDS"].split(",")
    assert fields == build.ALL_FIELDS  # every field: the ensemble ones, t2m and ivt included
    ens = {"z500sd", "z500em", "pr1", "pr10"}
    assert ens <= set(fields) and {"ivt", "t2m"} <= set(fields)
    b = step(n, "Build")["run"]
    assert "--run latest" in b and "--strict" in b and '--fields "$FIELDS"' in b
    two = [int(x) for x in re.search(r"--steps (\S+)", b).group(1).split(",")]
    assert len(two) == 2 and max(two) >= fetch.EM_FIRST_STEP and max(two) <= fetch.LOW_LEVEL_LAST_STEP  # em and rain windows, ivt, t2m
    assert fetch.need_applies("em", max(two)) and fetch.need_applies("tpg", max(two)) and fetch.need_applies("ivt_pl", max(two))
    assert 6 in two  # tp6 needs the 6 h step
    for need in ("es", "em", "tpg"):  # the ensemble product files are what these requests read
        assert fetch.request_for(need, "ifs", fetch.parse_run("2026111900"), max(two))["stream"] == "enfo"
    src = (ROOT / "pipeline" / "build.py").read_text() + (ROOT / "tools" / "compare_grib.py").read_text()
    for flag in re.findall(r"(--[a-z0-9-]+)", b + step(n, "Cross-check")["run"]):
        assert f'"{flag}"' in src, flag


def test_nightly_states_the_build_time_budget_and_caps_the_step():
    text = (WF / "nightly.yml").read_text()
    assert "Time budget" in text and "estimate" in text
    assert step(load("nightly.yml"), "Build")["timeout-minutes"] <= 15


def test_nightly_workflow_inputs_are_not_interpolated_into_scripts():
    for r in all_runs(load("nightly.yml")):
        assert "${{" not in r, r[:80]


def test_nightly_fails_the_job_when_a_field_is_missing_strict_build_and_the_guard_script():
    """The failure that the first live run had (a requested field absent from the build) must fail nightly."""
    import sys
    sys.path.insert(0, str(ROOT))
    from pipeline import build
    src = (ROOT / "pipeline" / "build.py").read_text()
    assert "strict: requested field(s) missing" in src and "ap.add_argument(\"--strict\"" in src
    assert 'assert not gone' in step(load("nightly.yml"), "Validate")["run"]
