"""Build the site's data directory.

  python -m pipeline.build --fixture "$WSE_FIXTURES" --out site/data                  sample mode (SPEC section 11)
  python -m pipeline.build --run latest --out out/data --clim clim/harmonics.npz       a live ECMWF open-data run
  python -m pipeline.build --run 2026111800 --fields z500,z500a,tp6 --model aifs ...

Live runs fetch one step at a time (missing steps are dropped), reduce on the native grid, subtract the climatology,
quantize and write the chunk files, then validate. Exit 2 means "do not publish" (a REQUIRED field failed, or z500a does
not reach 168 h); an optional field that is absent or fails a check is dropped and listed in `missing`.
"""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import os
import shutil
import sys

import numpy as np

from . import fetch, reduce, runs
from .anomaly import Climatology
from .encode import ManifestWriter, iso_minute
from .validate import REQUIRED, ValidationError, validate_dropping_optional

LOG = logging.getLogger("pipeline.build")

# First live run (SPEC section 10); msl and ivt are opt-in (IVT is about 1.9 GB of range requests per run).
DEFAULT_FIELDS = ["z500", "z500a", "tp6", "z500sd", "t850a", "ws250"]
ALL_FIELDS = DEFAULT_FIELDS + ["msl", "ivt"]
FIELD_DOMAINS = {"z500": ("g1", "np05"), "z500a": ("g1", "np05"), "z500sd": ("g1", "np05"),
                 "ws250": ("g1", "np05"), "tp6": ("g1",), "t850a": ("g1",), "msl": ("g1", "np05"),
                 "ivt": ("g1", "np05")}
MODEL_LABEL = {"ifs": "ECMWF IFS HRES", "aifs": "ECMWF AIFS Single"}
DATASET = {
    "z500": "gh 500 hPa", "z500a": "gh 500 hPa minus climatology", "z500sd": "IFS ENS gh 500 hPa spread (es)",
    "ws250": "wind speed from u, v 250 hPa on the native grid", "tp6": "tp, 6 h difference of the accumulation",
    "t850a": "t 850 hPa minus climatology", "msl": "msl", "ivt": "IVT from q, u, v 1000-300 hPa and sp",
}
MIN_Z500A_HOURS = 168


def build_live(run, model, fields, out, clim_path=None, retriever=None, workers=4, max_step=360,
               generated=None, workdir="out/raw"):
    """Fetch, reduce and write. `retriever` is injectable (tests); returns the manifest dict."""
    fields = [f for f in ALL_FIELDS if f in set(fields)]
    need_clim = {"z500a", "t850a"} & set(fields)
    clim = None
    if need_clim:
        if not clim_path or not os.path.exists(clim_path):
            raise FileNotFoundError(
                f"{sorted(need_clim)} need the climatology file but {clim_path!r} does not exist. "
                "Run the `clim` workflow first (it publishes harmonics.npz to the `clim` branch).")
        clim = Climatology.load(clim_path)
    if retriever is None:
        retriever = fetch.Retriever(workdir, model)
    needs = fetch.needs_for(fields)
    if "z500sd" in fields and model != "ifs":
        LOG.info("%s has no ensemble spread of its own; z500sd comes from the IFS ENS", model)
    steps = [s for s in fetch.STEPS if s <= max_step]
    reducer = reduce.StepReducer(run, model, fields, clim)
    LOG.info("fetching %d steps x %d needs for %s %s", len(steps), len(needs), model, run)
    res = fetch.fetch_steps(retriever, run, steps, needs, reducer, workers)
    if not res:
        raise RuntimeError("no step could be fetched: is the run posted, and is the source reachable?")
    w = ManifestWriter(out)
    missing = []

    def skipped(fid, why):
        LOG.warning("%s: %s, skipped", fid, why)
        if fid not in REQUIRED:
            missing.append({"field": fid, "reason": why})

    for fid in fields:
        if fid == "tp6":
            cum = {s: v["tp_cum"] for s, v in res.items() if "tp_cum" in v}
            st, grids = reduce.tp6_from_cumulative(cum)
            if not st:
                skipped(fid, "no consecutive 6-hourly steps arrived")
                continue
            grids = {d: grids[d] for d in FIELD_DOMAINS[fid] if d in grids}
        else:
            st = sorted(s for s, v in res.items() if fid in v)
            if not st:
                skipped(fid, "ensemble files not yet published" if fid in runs.ENSEMBLE_FIELDS
                        else "no step arrived")
                continue
            grids = {d: np.stack([res[s][fid][d] for s in st]) for d in FIELD_DOMAINS[fid]}
        w.add_field(fid, st, grids, source={"dataset": f"{MODEL_LABEL[model]} 0.25 deg open data: {DATASET[fid]}",
                                             "valid": None})
    head = {
        "schema": 1, "sample": False, "model": MODEL_LABEL[model], "run": iso_minute(run),
        "generated": generated or iso_minute(dt.datetime.now(dt.timezone.utc)),
        "attribution": "ECMWF open data CC-BY-4.0",
        "climatology": clim.description if clim else {"label": "none", "source": "none", "method": "none"},
    }
    if missing:
        head["missing"] = missing
    return w.write(head)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--fixture", metavar="DIR", help="build sample data from the real fixture files in DIR")
    ap.add_argument("--today", help="fixture mode: rebase step 0 to this date (YYYY-MM-DD); default today UTC")
    ap.add_argument("--run", help="latest or YYYYMMDDHH")
    ap.add_argument("--fields", default=",".join(DEFAULT_FIELDS))
    ap.add_argument("--model", default="ifs", choices=sorted(MODEL_LABEL))
    ap.add_argument("--source", help="ecmwf, aws, google or a base URL (default: the first that has the run)")
    ap.add_argument("--clim", default="clim/harmonics.npz")
    ap.add_argument("--max-step", type=int, default=360)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--workdir", default="out/raw")
    ap.add_argument("--keep-raw", action="store_true")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if bool(a.fixture) == bool(a.run):
        ap.error("give exactly one of --fixture and --run")
    if a.fixture:
        from .fixtures import build_fixture
        today = dt.date.fromisoformat(a.today) if a.today else None
        build_fixture(a.fixture, a.out, today)
        res = validate(a.out)
        print(f"fixture build ok: {res['files']} files, {res['bytes']} bytes, fields {res['fields']}")
        return 0
    fields = [f.strip() for f in a.fields.split(",") if f.strip()]
    bad = [f for f in fields if f not in ALL_FIELDS]
    if bad:
        ap.error(f"unknown field(s) {bad}; choose from {ALL_FIELDS}")
    now = dt.datetime.now(dt.timezone.utc)
    if a.run == "latest":
        found = runs.newest_run(now, runs.http_head, a.model)
        if not found:
            print("no run with 168 h posted yet", file=sys.stderr)
            return 3
        run, src, top = found
        max_step = min(a.max_step, top if top < 360 else 360)
    else:
        run, src, max_step = fetch.parse_run(a.run), a.source or "ecmwf", a.max_step
    first = a.source or src
    # a custom URL (tests, a private mirror) is used alone; the named sources back each other up per step
    sources = [first] if first.startswith("http") else [first] + [s for s in runs.SOURCES if s != first]
    retriever = fetch.Retriever(a.workdir, a.model, sources)
    try:
        build_live(run, a.model, fields, a.out, a.clim, retriever, a.workers, max_step)
        res = validate_dropping_optional(a.out, require_z500a_hours=MIN_Z500A_HOURS if "z500a" in fields else None,
                                         require_fields=fields, max_step=max_step)
    except (ValidationError, FileNotFoundError, RuntimeError) as e:
        print(f"BUILD FAILED, nothing to publish: {e}", file=sys.stderr)
        return 2
    finally:
        if not a.keep_raw:
            shutil.rmtree(a.workdir, ignore_errors=True)
    print(f"live build ok: run {run:%Y%m%d%H}, {res['files']} files, {res['bytes']} bytes, fields {res['fields']}")
    if res["missing"]:
        print(f"::warning::published without optional field(s): {', '.join(res['missing'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
