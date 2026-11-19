"""Which model run is the newest, is it complete enough, and does the `data` branch already hold it?

Standard library only: the scheduled workflow runs this before installing any dependency, so a run that finds
nothing new ends in seconds (SPEC section 10). The network is injected as `head(url) -> http status (0 = network
error)`; the default does a real HEAD request with a short timeout.

URL layout (ecmwf-opendata client source, 0.3.35; the host itself is only reachable from Actions):
  {root}/{YYYYMMDD}/{HH}z/{model}/0p25/oper/{YYYYMMDD}{HH}0000-{step}h-oper-fc.grib2
  {root}/{YYYYMMDD}/{HH}z/ifs/0p25/enfo/{YYYYMMDD}{HH}0000-{240|360}h-enfo-ep.grib2   (em, es)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request

ROOTS = {
    "ecmwf": "https://data.ecmwf.int/forecasts",
    "aws": "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com",
    "google": "https://storage.googleapis.com/ecmwf-open-data",
}
SOURCES = ("ecmwf", "aws", "google")
MODELS = {"ifs": "ifs", "aifs": "aifs-single"}
# The newest step a published run is judged by, highest first. 168 h is the floor the app needs (z500a).
PROBE_STEPS = (360, 240, 168)
MIN_STEP = 168
RUN_HOURS = (12, 0)  # the runs that reach 360 h
# Fields read from the ensemble product files (enfo-ep). They are optional (validate.REQUIRED): a build waits for
# them while the run is young, then publishes without them, and a later slot repairs the run (SPEC 13.1).
ENSEMBLE_FIELDS = ("z500sd", "z500em", "pr1", "pr10")
ENSEMBLE_WAIT_H = 10  # a run this old is published without ensemble products that are still not posted


def stamp(run):
    return run.strftime("%Y%m%d%H0000")


def oper_url(source, run, step, model="ifs"):
    m = MODELS[model]
    return f"{ROOTS[source]}/{run:%Y%m%d}/{run:%H}z/{m}/0p25/oper/{stamp(run)}-{step}h-oper-fc.grib2"


def ens_url(source, run, step):
    end = 240 if step <= 240 else 360
    return f"{ROOTS[source]}/{run:%Y%m%d}/{run:%H}z/ifs/0p25/enfo/{stamp(run)}-{end}h-enfo-ep.grib2"


def ens_index_url(source, run, end):
    """The `.index` of an ensemble product file: the fetcher reads it first, so a 404 here is a 404 there."""
    return ens_url(source, run, end).replace(".grib2", ".index")


def ensemble_status(head, source, run, max_step):
    """'posted' when every ensemble index the build will read answers 200 (the 240 h file, and the 360 h file when
    max_step exceeds 240); 'missing' when one is 404 or 403 (not posted); otherwise 'unknown' (a 503, a timeout:
    no answer, retried by the next slot)."""
    ends = (240,) if max_step <= 240 else (240, 360)
    codes = [head(ens_index_url(source, run, e)) for e in ends]
    if all(c == 200 for c in codes):
        return "posted"
    return "missing" if any(c in (404, 403) for c in codes) else "unknown"


def http_head(url, timeout=20, tries=2):
    """Real HEAD request: the status code, or 0 when the network fails."""
    for _ in range(tries):
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "weather-story-explorer-pipeline"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status
        except urllib.error.HTTPError as e:
            if e.code in (404, 403):
                return e.code
        except Exception:
            pass
    return 0


def candidate_runs(now, days=3):
    """Runs at 12Z and 00Z, newest first, no later than `now`."""
    out = []
    for d in range(days + 1):
        day = (now - dt.timedelta(days=d)).replace(hour=0, minute=0, second=0, microsecond=0)
        for h in RUN_HOURS:
            r = day + dt.timedelta(hours=h)
            if r <= now:
                out.append(r)
    return sorted(out, reverse=True)


def max_available_step(head, source, run, model="ifs"):
    """(highest of PROBE_STEPS whose HRES file exists or 0, unreachable). `unreachable` is True when the very
    first probe got no HTTP answer at all (a blocked or down host), so callers stop asking that source."""
    for n, s in enumerate(PROBE_STEPS):
        code = head(oper_url(source, run, s, model))
        if code == 200:
            return s, False
        if code == 0 and n == 0:
            return 0, True
    return 0, False


def newest_run(now, head, model="ifs", sources=SOURCES, days=3):
    """(run, source, max_step) for the newest run with at least MIN_STEP posted, or None. Sources are tried in
    order; one that does not answer at all is skipped for the rest of the search."""
    dead = set()
    for run in candidate_runs(now, days):
        for src in sources:
            if src in dead:
                continue
            top, unreachable = max_available_step(head, src, run, model)
            if unreachable:
                dead.add(src)
            elif top >= MIN_STEP:
                return run, src, top
    return None


def published_info(manifest_text):
    """(run datetime, highest z500a step, missing field ids) from a published manifest.json text; None if
    unreadable or empty."""
    try:
        m = json.loads(manifest_text)
        run = dt.datetime.strptime(m["run"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=dt.timezone.utc)
        steps = m["fields"]["z500a"]["steps"]
        miss = [x["field"] if isinstance(x, dict) else str(x) for x in m.get("missing", [])]
        return run, max(steps), miss
    except Exception:
        return None


def decide(now, head, published_text=None, model="ifs", force=False, sources=SOURCES, fields=None):
    """Should this scheduled run build? -> dict(build, run 'YYYYMMDDHH', source, max_step, reason[, warning]).

    `fields` are the fields the build will be asked for. When any is ensemble-derived the ensemble index files are
    probed: not posted and the run under ENSEMBLE_WAIT_H old -> wait; older -> build without them (warning); a
    published run that lists such a field as missing is rebuilt as soon as the files appear."""
    found = newest_run(now, head, model, sources)
    if found is None:
        return dict(build=False, run="", source="", max_step=0, reason="no run with 168 h posted yet")
    run, src, top = found
    out = dict(run=f"{run:%Y%m%d%H}", source=src, max_step=top)
    ens = [f for f in (fields or []) if f in ENSEMBLE_FIELDS]
    status = ensemble_status(head, src, run, top) if ens else "posted"
    age_h = (now - run).total_seconds() / 3600
    pub = None if force or not published_text else published_info(published_text)
    if pub is not None and (run < pub[0] or (run == pub[0] and top <= pub[1])):
        prun, ptop, pmiss = pub
        if run == prun and status == "posted" and set(pmiss) & set(ens):
            return dict(out, build=True, reason="missing optional field now posted")
        return dict(out, build=False, reason=f"already published {prun:%Y%m%d%H} to {ptop} h")
    if force:
        reason = "forced"
    elif pub is None:
        reason = "nothing published"
    elif run > pub[0]:
        reason = f"newer run {run:%Y%m%d%H} than published {pub[0]:%Y%m%d%H}"
    else:
        reason = f"run {run:%Y%m%d%H} now reaches {top} h, published reaches {pub[1]} h"
    if status == "posted":
        return dict(out, build=True, reason=reason)
    state = "not posted yet" if status == "missing" else "did not answer"
    if force:
        return dict(out, build=True, reason=reason, warning=f"ensemble products {state}; building without {', '.join(ens)}")
    if age_h < ENSEMBLE_WAIT_H:
        return dict(out, build=False,
                    reason=f"ensemble products {state}; run is {age_h:.1f} h old, waiting up to {ENSEMBLE_WAIT_H} h ({reason})")
    return dict(out, build=True, reason=f"{reason}; ensemble products {state} after {age_h:.1f} h, building without them",
                warning=f"ensemble products {state}; building without {', '.join(ens)}")


def _emit(result):
    result = dict(result)
    warning = result.pop("warning", None)
    lines = [f"{k}={str(v).lower() if isinstance(v, bool) else v}" for k, v in result.items()]
    print("\n".join(lines))
    if warning:
        print(f"::warning::{warning}")
    gho = os.environ.get("GITHUB_OUTPUT")
    if gho:
        with open(gho, "a") as fh:
            fh.write("\n".join(lines) + "\n")


def main(argv=None, head=http_head, now=None):
    ap = argparse.ArgumentParser(description="Decide whether the scheduled run should build.")
    ap.add_argument("--published", help="path to the published manifest.json (absent or empty: nothing published)")
    ap.add_argument("--model", default="ifs", choices=sorted(MODELS))
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--fields", help="comma-separated fields the build will be asked for (ensemble ones are probed)")
    ap.add_argument("--run", help="YYYYMMDDHH: skip discovery, build exactly this run")
    ap.add_argument("--source", choices=SOURCES, help="with --run: the source to use")
    a = ap.parse_args(argv)
    now = now or dt.datetime.now(dt.timezone.utc)
    fields = [f.strip() for f in a.fields.split(",") if f.strip()] if a.fields else []
    ens = [f for f in fields if f in ENSEMBLE_FIELDS]
    if a.run:
        run = dt.datetime.strptime(a.run, "%Y%m%d%H").replace(tzinfo=dt.timezone.utc)
        srcs = (a.source,) if a.source else SOURCES
        for s in srcs:
            top, _ = max_available_step(head, s, run, a.model)
            if top >= MIN_STEP:
                res = dict(build=True, run=a.run, source=s, max_step=top, reason="requested run")
                if ens and ensemble_status(head, s, run, top) != "posted":
                    res["warning"] = f"ensemble products not posted for {a.run}; building without {', '.join(ens)}"
                _emit(res)
                return 0
        _emit(dict(build=False, run=a.run, source="", max_step=0, reason="requested run not posted with 168 h"))
        return 1
    text = None
    if a.published and os.path.exists(a.published):
        with open(a.published) as fh:
            text = fh.read()
    res = decide(now, head, text, a.model, a.force, fields=fields)
    _emit(res)
    return 0


if __name__ == "__main__":
    sys.exit(main())
