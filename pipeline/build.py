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
from .anomaly import area_weighted_means
from .encode import ManifestWriter, iso_minute
from .gribio import pick, read_messages
from .grids import DOMAINS
from .validate import REQUIRED, ValidationError, validate_dropping_optional

LOG = logging.getLogger("pipeline.build")

# SPEC 13.2: the first live run's six fields plus the ensemble mean, the two rain probabilities and sea-level pressure.
# Only z500 and z500a are required (validate.REQUIRED). t2m (to 168 h, g1) is in the default set. ivt is not: data.yml adds it on the scheduled 00Z run only, to 168 h (0.83 GB of range requests; MET-10).
DEFAULT_FIELDS = ["z500", "z500a", "tp6", "z500sd", "z500em", "pr1", "pr10", "t850a", "ws250", "msl", "t2m"]
ALL_FIELDS = DEFAULT_FIELDS + ["ivt"]
FIELD_DOMAINS = {"z500": ("g1", "np05"), "z500a": ("g1", "np05"), "z500sd": ("g1", "np05"),
                 "z500em": ("g1", "np05"), "pr1": ("g1",), "pr10": ("g1",),
                 "ws250": ("g1", "np05"), "tp6": ("g1",), "t850a": ("g1",), "msl": ("g1", "np05"), "t2m": ("g1",),
                 "ivt": ("g1", "np05")}
MODEL_LABEL = {"ifs": "ECMWF IFS HRES", "aifs": "ECMWF AIFS Single"}
DATASET = {
    "z500": "gh 500 hPa", "z500a": "gh 500 hPa minus climatology", "z500sd": "IFS ENS gh 500 hPa spread (es)",
    "ws250": "wind speed from u, v 250 hPa on the native grid", "tp6": "tp, 6 h difference of the accumulation",
    "t850a": "t 850 hPa minus climatology, no-data where surface pressure is under 870 hPa",
    "msl": "msl", "t2m": "2t, 2 m temperature", "ivt": "IVT from q, u, v 1000-300 hPa and sp",
    "z500em": "IFS ENS gh 500 hPa ensemble mean (em)",
    "pr1": "IFS ENS probability of 24 h precipitation >= 1 mm (tpg1), stored at the window's end hour",
    "pr10": "IFS ENS probability of 24 h precipitation >= 10 mm (tpg10), stored at the window's end hour",
}
MIN_Z500A_HOURS = 168
TERRAIN_STEPS = (0, 6, 12)  # surface pressure is read once per run, from the first of these that arrived


def load_terrain(retriever, run):
    """{domain: below-ground mask} from the run's surface pressure, or None when no file could be read. Terrain does
    not move, so one step serves the whole run (step 0, else 6, else 12)."""
    for step in TERRAIN_STEPS:
        path = retriever.get(run, step, "sp")
        if not path:
            continue
        try:
            m = pick(read_messages(path), "sp")
            return reduce.terrain_masks(m.data, m.grid)
        finally:
            try:
                os.remove(path)
            except OSError:
                pass
    return None


def build_live(run, model, fields, out, clim_path=None, retriever=None, workers=4, max_step=360,
               generated=None, workdir="out/raw", steps=None):
    """Fetch, reduce and write. `retriever` is injectable (tests); returns the manifest dict. `steps` (the nightly smoke
    test) limits the run to those lead hours."""
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
    missing = []

    def skipped(fid, why):
        LOG.warning("%s: %s, skipped", fid, why)
        if fid not in REQUIRED:
            missing.append({"field": fid, "reason": why})

    terrain = None
    if "t850a" in fields:
        terrain = load_terrain(retriever, run)
        if terrain is None:  # never publish an unmasked, below-ground temperature anomaly
            fields = [f for f in fields if f != "t850a"]
            skipped("t850a", "surface pressure unavailable, cannot mask below-ground 850 hPa temperature")
    needs = fetch.needs_for(fields)
    if any(f in fields for f in ("z500sd", "z500em", "pr1", "pr10")) and model != "ifs":
        LOG.info("%s has no ensemble products of its own; z500sd, z500em, pr1 and pr10 come from the IFS ENS", model)
    steps = [s for s in fetch.STEPS if s <= max_step and (steps is None or s in steps)]
    reducer = reduce.StepReducer(run, model, fields, clim, terrain=terrain)
    LOG.info("fetching %d steps x %d needs for %s %s", len(steps), len(needs), model, run)
    res = fetch.fetch_steps(retriever, run, steps, needs, reducer, workers)
    if not res:
        raise RuntimeError("no step could be fetched: is the run posted, and is the source reachable?")
    w = ManifestWriter(out)
    first_step = {"z500em": fetch.EM_FIRST_STEP, "pr1": fetch.PR_WINDOW_H, "pr10": fetch.PR_WINDOW_H}
    z500a_g1 = None
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
                if fid in first_step and max_step < first_step[fid]:
                    skipped(fid, f"the run stops at {max_step} h, before this field's first step ({first_step[fid]} h)")
                else:
                    skipped(fid, "ensemble files not yet published" if fid in runs.ENSEMBLE_FIELDS
                            else "no step arrived")
                continue
            grids = {d: np.stack([res[s][fid][d] for s in st]) for d in FIELD_DOMAINS[fid]}
            if fid == "z500a":
                z500a_g1 = (st[0], grids["g1"][0])
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
    if z500a_g1 is not None:
        means = area_weighted_means(z500a_g1[1], DOMAINS["g1"])
        if all(v is not None for v in means.values()):
            head["checks"] = {"mean_anomaly_gpm": means}
            print(f"mean z500a vs the fixed baseline at step {z500a_g1[0]} h (area-weighted, gpm): "
                  f"global {means['global']:+.1f}, 20-90N {means['nh']:+.1f}, tropics {means['tropics']:+.1f}")
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
    ap.add_argument("--steps", help="comma list of lead hours (the nightly smoke build, e.g. 6,144): only those steps are "
                                    "fetched and the 168 h publish gate is waived, every other check still runs")
    ap.add_argument("--strict", action="store_true", help="fail when any requested field is missing from the build "
                                                          "(the nightly real-download test: nothing may be dropped)")
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
    smoke = [int(x) for x in a.steps.split(",") if x.strip()] if a.steps else None
    if smoke:
        max_step = max(smoke)
    try:
        build_live(run, a.model, fields, a.out, a.clim, retriever, a.workers, max_step, steps=smoke)  # prints the mean anomaly
        if smoke:  # two steps cannot satisfy the coverage and 168 h rules; schema, ranges, hashes and budgets still run
            res = validate_dropping_optional(a.out)
        else:
            res = validate_dropping_optional(a.out, require_z500a_hours=MIN_Z500A_HOURS if "z500a" in fields else None,
                                             require_fields=fields, max_step=max_step)
        if a.strict:
            absent = [f for f in fields if f not in res["fields"]]
            if absent:
                raise ValidationError(f"strict: requested field(s) missing from the build: {', '.join(absent)}")
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
