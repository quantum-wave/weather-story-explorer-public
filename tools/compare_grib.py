#!/usr/bin/env python3
"""Cross-check the published 500 hPa height against the raw ECMWF GRIB (design 13.3, MET-12; Josh point 8).

  python -I tools/compare_grib.py <raw.grib2> <data-dir>                      one raw step against the build
  python -I tools/compare_grib.py --download 2026111900 --step 24 <data-dir>   fetch that step's gh 500 first

Published values are not raw node values: they are a centred-kernel average of the 0.25 degree source, quantised.
This tool therefore applies ITS OWN copy of that kernel (written here, not imported from pipeline/grids.py, so a bug
in one is not hidden by sharing it) to the raw GRIB and compares the result with the decoded `z500` of the `g1` domain
at five fixed points. Tolerance: scale / 2 + 0.5 gpm (half a quantisation step, plus half a metre of float and packing
noise). The result is written to the manifest as `checks.grib_compare = {status, max_abs_gpm, points, tolerance_gpm}`.

It never blocks a publish: on `fail` it prints a `::warning::` and exits 0, and so does any error of its own
(default 33: the tolerance is an expectation until a week of runs has measured it). Make it exit non-zero on `fail`
when that week has passed. Known-positive: a x0.98 unit slip in the data must report `fail` (tests/pipeline/test_compare.py).
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 0.25 -> 1 degree: five source nodes per axis around the target node, the outer two at half weight (sums to one).
WEIGHTS = [1 / 8, 1 / 4, 1 / 4, 1 / 4, 1 / 8]
OFFSETS = [-2, -1, 0, 1, 2]
POINTS = [("San Francisco", 37.0, -122.0), ("Seattle", 47.0, -122.0), ("Denver", 39.0, -105.0),
          ("London", 51.0, 0.0), ("Honolulu", 21.0, -158.0)]  # whole-degree nodes of g1, away from the poles and the seam
G = 9.80665


def tolerance_gpm(scale):
    return scale / 2 + 0.5


def read_height(path):
    """(values (ny, nx) in gpm, lats (ny,), lons (nx,), step) of the first 500 hPa `gh` (or `z`, divided by g) message,
    straight from eccodes, rows as stored."""
    import eccodes as ec
    with open(path, "rb") as fh:
        while True:
            h = ec.codes_grib_new_from_file(fh)
            if h is None:
                raise ValueError(f"{path}: no 500 hPa gh or z message")
            try:
                short, level = ec.codes_get(h, "shortName"), int(ec.codes_get(h, "level"))
                if short not in ("gh", "z") or level != 500:
                    continue
                ni, nj = ec.codes_get(h, "Ni"), ec.codes_get(h, "Nj")
                v = np.asarray(ec.codes_get_values(h), np.float64).reshape(nj, ni)
                if short == "z":
                    v = v / G
                lat0 = ec.codes_get(h, "latitudeOfFirstGridPointInDegrees")
                lon0 = ec.codes_get(h, "longitudeOfFirstGridPointInDegrees")
                di, dj = ec.codes_get(h, "iDirectionIncrementInDegrees"), ec.codes_get(h, "jDirectionIncrementInDegrees")
                dj = dj if ec.codes_get(h, "jScansPositively") else -dj
                di = -di if ec.codes_get(h, "iScansNegatively") else di
                lats = lat0 + dj * np.arange(nj)
                lons = lon0 + di * np.arange(ni)
                step = int(ec.codes_get(h, "endStep")) if ec.codes_is_defined(h, "endStep") else 0
                return v, lats, lons, step
            finally:
                ec.codes_release(h)


def kernel_value(vals, lats, lons, lat, lon):
    """The 1 degree centred-kernel average at (lat, lon): a 5 x 5 weighted sum of source nodes, longitude wrapping,
    latitude windows truncated and renormalised at an edge."""
    dlat, dlon = float(lats[1] - lats[0]), float(lons[1] - lons[0])
    j0 = int(round((lat - lats[0]) / dlat))
    i0 = int(round(((lon - lons[0]) % 360.0) / dlon))
    nj, ni = vals.shape
    acc = wsum = 0.0
    for oj, wj in zip(OFFSETS, WEIGHTS):
        j = j0 + oj
        if not 0 <= j < nj:
            continue
        for oi, wi in zip(OFFSETS, WEIGHTS):
            acc += wj * wi * vals[j, (i0 + oi) % ni]
            wsum += wj * wi
    return acc / wsum


def published_z500(data_dir, manifest, step):
    """Decoded `z500` of g1 at `step`: (2-D float array, the field's manifest entry, the domain)."""
    sys.path.insert(0, ROOT)
    from pipeline.encode import decode_chunk, dequantize
    f = manifest["fields"]["z500"]
    if "g1" not in f["domains"] or step not in f["steps"]:
        raise KeyError(f"z500/g1 holds no step {step} h")
    idx = f["steps"].index(step)
    ch = next(c for c in f["chunks"] if c["steps"][0] <= idx < c["steps"][1])
    d = manifest["domains"]["g1"]
    with open(os.path.join(data_dir, ch["files"]["g1"]["path"]), "rb") as fh:
        frames = decode_chunk(fh.read(), d["ny"], d["nx"], ch["steps"][1] - ch["steps"][0], f["filter"])
    return dequantize(frames[idx - ch["steps"][0]], f["scale"], f["offset"]), f, d


def compare(grib, data_dir, step=None):
    """Compare and return {status, max_abs_gpm, points, tolerance_gpm, detail}. Raises on anything unreadable."""
    with open(os.path.join(data_dir, "manifest.json")) as fh:
        manifest = json.load(fh)
    vals, lats, lons, grib_step = read_height(grib)
    step = grib_step if step is None else step
    pub, f, d = published_z500(data_dir, manifest, step)
    tol = tolerance_gpm(f["scale"])
    detail = []
    for name, lat, lon in POINTS:
        j = int(round((lat - d["lat0"]) / d["dlat"]))
        i = int(round((lon - d["lon0"]) / d["dlon"]))
        p, k = float(pub[j, i]), kernel_value(vals, lats, lons, lat, lon)
        detail.append({"name": name, "lat": lat, "lon": lon, "published": p, "kernel": k, "abs_gpm": abs(p - k)})
    worst = max(x["abs_gpm"] for x in detail)
    status = "pass" if worst <= tol else "fail"
    return {"status": status, "max_abs_gpm": round(worst, 3), "points": len(detail), "tolerance_gpm": tol,
            "detail": detail, "step": step}


def record(data_dir, result):
    path = os.path.join(data_dir, "manifest.json")
    with open(path) as fh:
        m = json.load(fh)
    m.setdefault("checks", {})["grib_compare"] = {k: result[k] for k in ("status", "max_abs_gpm", "points", "tolerance_gpm")}
    with open(path, "w") as fh:
        json.dump(m, fh, indent=1)
        fh.write("\n")


def download(run_text, step, model, source, workdir):
    sys.path.insert(0, ROOT)
    from pipeline import fetch
    r = fetch.Retriever(workdir, model, [source] if source else ["ecmwf", "aws", "google"])
    path = r.get(fetch.parse_run(run_text), step, "gh500")
    if not path:
        raise RuntimeError(f"could not download the 500 hPa height for {run_text} step {step}")
    return path


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("grib", nargs="?", help="raw GRIB file with the 500 hPa height (omit with --download)")
    ap.add_argument("data", help="the built data directory (holds manifest.json)")
    ap.add_argument("--download", metavar="YYYYMMDDHH", help="fetch the raw gh 500 of this run first")
    ap.add_argument("--step", type=int, help="lead hour to compare (default: the GRIB's own step; 24 with --download)")
    ap.add_argument("--model", default="ifs", choices=["ifs", "aifs"])
    ap.add_argument("--source", help="ecmwf, aws, google or a base URL (default: all three)")
    ap.add_argument("--workdir", default="out/raw-compare")
    a = ap.parse_args(argv)
    try:
        grib = a.grib
        step = a.step
        if a.download:
            step = 24 if step is None else step
            grib = download(a.download, step, a.model, a.source, a.workdir)
        if not grib:
            raise ValueError("give a GRIB file or --download")
        res = compare(grib, a.data, step)
        record(a.data, res)
    except Exception as e:  # noqa: BLE001 - this check never blocks a publish
        print(f"::warning::GRIB cross-check skipped: {type(e).__name__}: {str(e)[:200]}")
        return 0
    finally:
        if a.download:
            import shutil
            shutil.rmtree(a.workdir, ignore_errors=True)
    for x in res["detail"]:
        print(f"  {x['name']:<14} published {x['published']:9.2f}  raw kernel {x['kernel']:9.2f}  diff {x['abs_gpm']:.2f} gpm")
    line = (f"GRIB cross-check z500 step {res['step']} h: {res['status']}, max {res['max_abs_gpm']} gpm over "
            f"{res['points']} points (tolerance {res['tolerance_gpm']} gpm)")
    print(("::warning::" + line + ": the published height disagrees with ECMWF's raw file") if res["status"] == "fail" else line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
