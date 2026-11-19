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


def stamp(run):
    return run.strftime("%Y%m%d%H0000")


def oper_url(source, run, step, model="ifs"):
    m = MODELS[model]
    return f"{ROOTS[source]}/{run:%Y%m%d}/{run:%H}z/{m}/0p25/oper/{stamp(run)}-{step}h-oper-fc.grib2"


def ens_url(source, run, step):
    end = 240 if step <= 240 else 360
    return f"{ROOTS[source]}/{run:%Y%m%d}/{run:%H}z/ifs/0p25/enfo/{stamp(run)}-{end}h-enfo-ep.grib2"


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
    """(run datetime, highest z500a step) from a published manifest.json text; None if unreadable or empty."""
    try:
        m = json.loads(manifest_text)
        run = dt.datetime.strptime(m["run"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=dt.timezone.utc)
        steps = m["fields"]["z500a"]["steps"]
        return run, max(steps)
    except Exception:
        return None


def decide(now, head, published_text=None, model="ifs", force=False, sources=SOURCES):
    """Should this scheduled run build? -> dict(build, run 'YYYYMMDDHH', source, max_step, reason)."""
    found = newest_run(now, head, model, sources)
    if found is None:
        return dict(build=False, run="", source="", max_step=0, reason="no run with 168 h posted yet")
    run, src, top = found
    out = dict(run=f"{run:%Y%m%d%H}", source=src, max_step=top)
    if force:
        return dict(out, build=True, reason="forced")
    pub = published_info(published_text) if published_text else None
    if pub is None:
        return dict(out, build=True, reason="nothing published")
    prun, ptop = pub
    if run > prun:
        return dict(out, build=True, reason=f"newer run {run:%Y%m%d%H} than published {prun:%Y%m%d%H}")
    if run == prun and top > ptop:
        return dict(out, build=True, reason=f"run {run:%Y%m%d%H} now reaches {top} h, published reaches {ptop} h")
    return dict(out, build=False, reason=f"already published {prun:%Y%m%d%H} to {ptop} h")


def _emit(result):
    lines = [f"{k}={str(v).lower() if isinstance(v, bool) else v}" for k, v in result.items()]
    print("\n".join(lines))
    gho = os.environ.get("GITHUB_OUTPUT")
    if gho:
        with open(gho, "a") as fh:
            fh.write("\n".join(lines) + "\n")


def main(argv=None, head=http_head, now=None):
    ap = argparse.ArgumentParser(description="Decide whether the scheduled run should build.")
    ap.add_argument("--published", help="path to the published manifest.json (absent or empty: nothing published)")
    ap.add_argument("--model", default="ifs", choices=sorted(MODELS))
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--run", help="YYYYMMDDHH: skip discovery, build exactly this run")
    ap.add_argument("--source", choices=SOURCES, help="with --run: the source to use")
    a = ap.parse_args(argv)
    now = now or dt.datetime.now(dt.timezone.utc)
    if a.run:
        run = dt.datetime.strptime(a.run, "%Y%m%d%H").replace(tzinfo=dt.timezone.utc)
        srcs = (a.source,) if a.source else SOURCES
        for s in srcs:
            top, _ = max_available_step(head, s, run, a.model)
            if top >= MIN_STEP:
                _emit(dict(build=True, run=a.run, source=s, max_step=top, reason="requested run"))
                return 0
        _emit(dict(build=False, run=a.run, source="", max_step=0, reason="requested run not posted with 168 h"))
        return 1
    text = None
    if a.published and os.path.exists(a.published):
        with open(a.published) as fh:
            text = fh.read()
    res = decide(now, head, text, a.model, a.force)
    _emit(res)
    return 0


if __name__ == "__main__":
    sys.exit(main())
