"""Freeze a live build as the recorded forecast the product ships by default (DESIGN-SPEC section 9, W2-09).

  python -I tools/make_sample.py <live build dir> <out dir> [--cap-bytes N] [--target-bytes N]

<live build dir> is a pipeline build (manifest.json plus chunk files, sample false, no cases). The tool thins it,
re-encodes it with pipeline/encode.py (the frozen byte format) and writes a manifest with sample true, a sample_label
and no cases:

  steps    6-hourly up to 168 h, 12-hourly after (a step the source lacks is not invented)
  domains  g1 for every field; np05 only for z500 and z500a
  size     target 12 MB, hard cap 14 MB (MB = 1,000,000 bytes, the strict reading), measured on the whole folder
           (chunk files plus manifest.json) and printed per field. Over the cap it
           drops, in this order and by name in the output: np05 (z500 and z500a lose the regional domain entirely),
           then msl, then t850a. Still over after all three: exit 1.

np05 is dropped whole, never beyond 168 h only: a manifest field's `domains` is what the client reads to pick a
domain (story, compose, the regional view), and a field that lists np05 while chunks b and c have no np05 file
stops loading at 120 h. Without np05 in `domains` the client uses g1 for every step, so the week survives and only
the 0.5 degree regional detail is lost.

The output folder is only replaced when everything passed: the recording is built in a sibling temporary folder,
checked there (size cap, schema and byte validation, decoded probes), and swapped into <out> last. A failed run
leaves the earlier recording as it was.

It never makes up data: a source that is synthetic, a sample, or has cases is refused. It then checks its own
output (schema and byte validation, decoded probes equal to the source at five points and three steps) and prints
the run id and the number of local days at San Francisco, with the verdict on whether "Your week" is a week.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import sys
from zoneinfo import ZoneInfo

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO not in sys.path:  # this file is the repo's own code; `python -I` drops the current directory
    sys.path.insert(0, REPO)

import numpy as np  # noqa: E402

from pipeline.encode import NODATA, ManifestWriter, decode_chunk, dequantize  # noqa: E402
from pipeline.grids import nearest_index  # noqa: E402
from pipeline.validate import ValidationError, validate  # noqa: E402

TARGET_BYTES = 12_000_000  # decimal MB: the strict reading of DESIGN-SPEC section 9, so MiB readers are inside it too
CAP_BYTES = 14_000_000
DENSE_TO_H = 168          # 6-hourly up to here, 12-hourly after
NP05_FIELDS = ("z500", "z500a")
WEEK_HOURS = 168
PROBE_POINTS = [("San Francisco", 37.77, -122.42), ("Seattle", 47.61, -122.33), ("Denver", 39.74, -104.99),
                ("Honolulu", 21.31, -157.86), ("London", 51.51, -0.13)]
SF = ZoneInfo("America/Los_Angeles")

# The stated drop order. Each stage is (name printed, what to do).
DROP_ORDER = ["np05 (z500, z500a: regional domain, the regional view falls back to g1)", "msl", "t850a"]


class SampleError(RuntimeError):
    pass


def mib(n):
    return f"{n / 1e6:.2f} MB" if n >= 1_000_000 else f"{n / 1000:.1f} kB"


def keep_step(s):
    return s % 6 == 0 if s <= DENSE_TO_H else s % 12 == 0


def parse_run(run):
    return dt.datetime.strptime(run, "%Y-%m-%dT%H:%MZ").replace(tzinfo=dt.timezone.utc)


def sf_local_days(run, last_step):
    """Local days at San Francisco covered by a forecast from `run` (UTC) to run + last_step hours.
    dates: calendar dates touched; full_days: dates whose whole 00:00-24:00 lies inside the range."""
    t0 = parse_run(run).astimezone(SF)
    t1 = (parse_run(run) + dt.timedelta(hours=last_step)).astimezone(SF)
    dates = (t1.date() - t0.date()).days + 1
    first_full = t0.date() if (t0.hour, t0.minute) == (0, 0) else t0.date() + dt.timedelta(days=1)
    full = 0
    d = first_full
    while dt.datetime.combine(d + dt.timedelta(days=1), dt.time(), SF) <= t1:
        full += 1
        d += dt.timedelta(days=1)
    return {"first": t0.date().isoformat(), "last": t1.date().isoformat(), "dates": dates, "full_days": full}


def read_source(src):
    """Decode a live build: manifest and {(field, domain): {step: int16 frame}}."""
    mp = os.path.join(src, "manifest.json")
    if not os.path.isfile(mp):
        raise SampleError(f"no manifest.json in {src}: this is not a build folder")
    m = json.load(open(mp))
    if m.get("sample") or m.get("cases") or "synthetic" in json.dumps(m).lower():
        raise SampleError("the source is not a live build (sample, cases or synthetic): only a real run is recorded")
    frames = {}
    for fid, f in m["fields"].items():
        for ch in f["chunks"]:
            lo, hi = ch["steps"]
            for dom, meta in ch["files"].items():
                d = m["domains"][dom]
                blob = open(os.path.join(src, meta["path"]), "rb").read()
                fr = decode_chunk(blob, d["ny"], d["nx"], hi - lo, f["filter"])
                for k in range(hi - lo):
                    frames.setdefault((fid, dom), {})[f["steps"][lo + k]] = fr[k]
    return m, frames


def build(m, frames, out, drop):
    """Write the thinned build with the first `drop` stages of DROP_ORDER applied; return (manifest, writer)."""
    skip = set()
    no_np05 = drop >= 1
    if drop >= 2:
        skip.add("msl")
    if drop >= 3:
        skip.add("t850a")
    w = ManifestWriter(out, domains=m["domains"])
    for fid, f in m["fields"].items():
        if fid in skip:
            continue
        steps = [s for s in f["steps"] if keep_step(s)]
        if not steps:
            continue
        scale, offset = f["scale"], f["offset"]  # the source's own encoding: a build made before a contract change keeps its values
        grids = {}
        for dom in f["domains"]:
            if dom == "np05" and (no_np05 or fid not in NP05_FIELDS):
                continue
            fr = frames[(fid, dom)]
            grids[dom] = np.stack([dequantize(fr[s], scale, offset) for s in steps]).astype(np.float64)
        if not grids:
            raise SampleError(f"{fid} has no domain to keep")
        w.add_field(fid, steps, grids, source=f.get("source") or {"dataset": "ECMWF open data", "valid": None})
    head = {"schema": 1, "sample": True, "model": m["model"], "run": m["run"], "generated": m["generated"],
            "attribution": m["attribution"], "climatology": m["climatology"],
            "sample_label": sample_label(m["run"]),
            "sample_note": "one real forecast run, recorded; not live"}
    for k in ("missing", "checks"):
        if k in m:
            head[k] = m[k]
    out_m = w.write(head)
    return out_m, w


def sample_label(run):
    t = parse_run(run)
    return f"Recorded forecast · ECMWF run {t.day} {t.strftime('%b %Y %H')} UTC"


def sizes(out, m):
    per = {fid: 0 for fid in m["fields"]}
    for fid, f in m["fields"].items():
        for ch in f["chunks"]:
            for meta in ch["files"].values():
                per[fid] += os.path.getsize(os.path.join(out, meta["path"]))
    return per


def manifest_bytes(out):
    return os.path.getsize(os.path.join(out, "manifest.json"))


def compare_probes(src, out, points=PROBE_POINTS, n_steps=3):
    """Decoded values of the thinned build equal the source's at `points` and n_steps steps of every shared
    (field, domain). Raises SampleError on the first difference; returns the counts."""
    ms_, fs = read_source(src)
    mo, fo = read_source_any(out)
    checked = mismatches = 0

    def same(key, a, b):
        """Equal values: the same int16 when the encodings agree, else equal decoded values (the recording may re-encode
        a field at a finer contract scale, e.g. tp6 0.1 -> 0.01 mm; every source value is still exactly representable)."""
        fa, fb = mo["fields"][key[0]], ms_["fields"][key[0]]
        if (fa["scale"], fa["offset"]) == (fb["scale"], fb["offset"]):
            return np.array_equal(a, b)
        da = np.where(a == NODATA, np.nan, a * fa["scale"] + fa["offset"])
        db = np.where(b == NODATA, np.nan, b * fb["scale"] + fb["offset"])
        return bool(np.allclose(da, db, rtol=0, atol=min(fa["scale"], fb["scale"]) / 2, equal_nan=True))

    for key, frs in fo.items():
        if key not in fs:
            raise SampleError(f"{key} is in the recording but not in the source")
        steps = sorted(frs)
        pick = sorted({steps[0], steps[len(steps) // 2], steps[-1]})[:max(n_steps, 3)]
        dom = mo["domains"][key[1]]
        for step in pick:
            for name, lat, lon in points:
                ij = nearest_index(dom, lat, lon)
                if ij is None:
                    continue
                checked += 1
                if not same(key, np.array([frs[step][ij]]), np.array([fs[key][step][ij]])):
                    mismatches += 1
        for step in steps:  # whole frames too: the recording is the source's bytes, only thinned
            if not same(key, frs[step], fs[key][step]):
                raise SampleError(f"{key} step {step} h: decoded frame differs from the source")
    if mismatches:
        raise SampleError(f"{mismatches} of {checked} probe values differ from the source")
    return {"checked": checked, "mismatches": mismatches}


def read_source_any(out):
    """Decode the recording (same layout as a build, but sample true)."""
    m = json.load(open(os.path.join(out, "manifest.json")))
    frames = {}
    for fid, f in m["fields"].items():
        for ch in f["chunks"]:
            lo, hi = ch["steps"]
            for dom, meta in ch["files"].items():
                d = m["domains"][dom]
                fr = decode_chunk(open(os.path.join(out, meta["path"]), "rb").read(), d["ny"], d["nx"], hi - lo, f["filter"])
                for k in range(hi - lo):
                    frames.setdefault((fid, dom), {})[f["steps"][lo + k]] = fr[k]
    return m, frames


def swap_in(tmp, final):
    """Put the checked recording at `final`; the earlier one is set aside first and removed only after the swap."""
    old = None
    if os.path.lexists(final):
        old = f"{tmp}.old"
        shutil.rmtree(old, ignore_errors=True)
        os.rename(final, old)
    try:
        os.rename(tmp, final)
    except OSError:
        if old:
            os.rename(old, final)
        raise
    if old:
        shutil.rmtree(old, ignore_errors=True)


def make_sample(src, out, cap_bytes=CAP_BYTES, target_bytes=TARGET_BYTES, say=print):
    src, out = os.path.abspath(src), os.path.abspath(out)
    if src == out:
        raise SampleError("the source and the output are the same folder")
    m, frames = read_source(src)
    if os.path.lexists(out):
        if not os.path.isdir(out) or any(not (f.endswith(".bin") or f == "manifest.json") for f in os.listdir(out)):
            raise SampleError(f"{out} exists and is not a recording folder (only manifest.json and *.bin): not replacing it")
    final = out
    tmp = os.path.join(os.path.dirname(final), f".{os.path.basename(final)}.tmp-{os.getpid()}")
    shutil.rmtree(tmp, ignore_errors=True)
    try:
        return _make_sample(src, tmp, final, m, frames, cap_bytes, target_bytes, say)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _make_sample(src, out, final, m, frames, cap_bytes, target_bytes, say):
    lines = []
    dropped = []
    stage = 0
    while True:
        out_m, _ = build(m, frames, out, stage)
        per = sizes(out, out_m)
        total = sum(per.values()) + manifest_bytes(out)  # what ships: every chunk plus manifest.json
        if total <= cap_bytes or stage >= len(DROP_ORDER):
            break
        dropped.append(DROP_ORDER[stage])
        lines.append(f"over the cap ({mib(total)} > {mib(cap_bytes)}); dropped: {DROP_ORDER[stage]}")
        stage += 1
    z = out_m["fields"].get("z500a")
    last = max(z["steps"]) if z else None
    days = sf_local_days(m["run"], last) if last is not None else None
    demo = last is not None and last >= WEEK_HOURS
    head = []
    if not demo:
        head.append(f"point 1 not demonstrable: z500a reaches {last if last is not None else 'nothing'} h, a week needs {WEEK_HOURS} h")
    lines.insert(0, f"source run {m['run']} ({src})")
    lines.append(f"recording: {out_m['sample_label']} -> {final}")
    for fid, n in sorted(per.items()):
        lines.append(f"  {fid:<8} {mib(n):>11}  steps {len(out_m['fields'][fid]['steps'])} to {max(out_m['fields'][fid]['steps'])} h  "
                     f"domains {'+'.join(out_m['fields'][fid]['domains'])}")
    lines.append(f"  manifest {mib(manifest_bytes(out)):>11}")
    lines.append(f"  total    {mib(total):>11}  (chunks + manifest; target {mib(target_bytes)}, cap {mib(cap_bytes)})")
    if target_bytes < total <= cap_bytes:
        lines.append(f"note: over the {mib(target_bytes)} target, within the cap")
    if dropped:
        lines.append("dropped: " + "; ".join(dropped))
    if days:
        lines.append(f"z500a reaches {last} h; San Francisco local days: {days['full_days']} full, {days['dates']} dates "
                     f"touched ({days['first']} to {days['last']})")
    for ln in head + lines:
        say(ln)
    if total > cap_bytes:
        raise SampleError(f"over the cap after every drop ({mib(total)} > {mib(cap_bytes)}); dropped: " + "; ".join(dropped))
    try:
        validate(out)
    except ValidationError as e:
        raise SampleError(f"the recording does not validate: {e}") from e
    cmp = compare_probes(src, out)
    say(f"verified: schema and bytes valid; {cmp['checked']} decoded probe values and every kept frame equal the source")
    swap_in(out, final)
    return {"bytes": total, "per_field": per, "dropped": dropped, "run": m["run"], "label": out_m["sample_label"],
            "local_days": {**(days or {}), "z500a_last_step": last}, "point1_demonstrable": demo}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--cap-bytes", type=int, default=CAP_BYTES)
    ap.add_argument("--target-bytes", type=int, default=TARGET_BYTES)
    a = ap.parse_args(argv)
    try:
        make_sample(a.src, a.out, a.cap_bytes, a.target_bytes)
    except SampleError as e:
        print(f"make_sample: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
