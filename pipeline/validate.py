"""Check a built data directory against the contract before anything is published.

Checks: manifest against the JSON schema; every chunk file present, sized and hashed as listed, inflating to the
right number of frames; chunks covering each field's steps exactly once, inside their hour windows; every probe
equal to the decoded node; physical ranges (a unit slip must not reach the site); no frame that is all no-data;
the file budgets; and, for a live run, that z500a reaches the minimum lead time.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

import numpy as np

from .encode import CHUNK_HOURS, FIELD_META, NODATA, check_budgets, decode_chunk, dequantize
from .grids import nearest_index

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA_PATH = os.path.join(ROOT, "tests", "pipeline", "manifest.schema.json")

# Physical bounds of decoded values (a wrong unit or level fails here).
RANGES = {"z500": (4500, 6200), "z500a": (-700, 700), "z500sd": (0, 250), "z500em": (4500, 6200),
          "ws250": (0, 180), "tp6": (0, 400), "t850a": (-70, 70), "msl": (85000, 109000), "ivt": (0, 3000),
          "t2a": (-80, 80), "pr1": (0, 100), "pr10": (0, 100), "t2m": (180, 335)}

# The only fields whose absence or damage stops a publish. Every other field is optional: a problem with it drops
# that field (drop_optional) and lists it in the manifest's `missing`, the build still publishes (SPEC 13.1).
# build.py imports this very object.
REQUIRED = ("z500", "z500a")


class ValidationError(RuntimeError):
    """`field` names the field a failure belongs to (None: the whole build), so an optional one can be dropped."""

    def __init__(self, msg, field=None):
        super().__init__(msg)
        self.field = field


def _fail(msg, field=None):
    raise ValidationError(msg, field)


MAX_GAP_H = 12          # the client blends across a gap, so a live run may not have a longer one
MIN_COVERAGE = 0.9      # share of the 6-hourly grid a live field must have
SPREAD_COVERAGE = 0.45  # z500sd comes from the ensemble and may be 12-hourly


def _live_gate(m, require_fields, require_z500a_hours, max_step):
    """A live run is complete enough to replace the published one: every REQUIRED field asked for present, no gap
    over MAX_GAP_H, z500a gapless up to the minimum lead time (one missing step allowed), enough steps per field.
    A failure in an optional field carries its name, so the caller can drop that field instead of failing."""
    top = max_step if max_step is not None else (require_z500a_hours or 0)
    expected = len(range(0, top + 1, 6))
    asked = list(require_fields or [])
    needed = list(dict.fromkeys(asked + (["z500a"] if require_z500a_hours is not None else [])))
    for fid in needed:
        if fid in REQUIRED and fid not in m["fields"]:
            _fail(f"requested field {fid} is missing from the build", fid)
    for fid, f in m["fields"].items():
        st = f["steps"]
        for a, b in zip(st, st[1:]):
            if b - a > MAX_GAP_H:
                _fail(f"{fid}: gap of {b - a} h between steps {a} and {b} (limit {MAX_GAP_H} h)", fid)
        if fid in needed and expected:
            share = SPREAD_COVERAGE if fid == "z500sd" else MIN_COVERAGE
            if len(st) < share * expected:
                _fail(f"{fid}: only {len(st)} steps of about {expected} expected (need {share:.0%})", fid)


def drop_optional(outdir, field, reason):
    """Remove an optional field from a built directory: its chunk files, its manifest entry, its probes and any
    domain no other field uses; append {field, reason} to `missing`. A REQUIRED field is refused."""
    if field in REQUIRED:
        raise ValidationError(f"{field} is required and cannot be dropped", field)
    path = os.path.join(outdir, "manifest.json")
    with open(path) as fh:
        m = json.load(fh)
    f = m["fields"].pop(field, None)
    if f is not None:
        for ch in f["chunks"]:
            for meta in ch["files"].values():
                try:
                    os.remove(os.path.join(outdir, meta["path"]))
                except FileNotFoundError:
                    pass
    m["probes"] = [p for p in m["probes"] if p["field"] != field]
    used = {d for fl in m["fields"].values() for d in fl["domains"]}
    m["domains"] = {k: v for k, v in m["domains"].items() if k in used}
    miss = [x for x in m.get("missing", []) if x["field"] != field]
    miss.append({"field": field, "reason": reason})
    m["missing"] = miss
    with open(path, "w") as fh:
        json.dump(m, fh, indent=1)
        fh.write("\n")


def validate_dropping_optional(outdir, **kw):
    """validate(); when the failure belongs to an optional field, drop that field (recording why) and validate
    again. Anything else, a required field included, is raised unchanged."""
    for _ in range(len(RANGES) + 1):
        try:
            return validate(outdir, **kw)
        except ValidationError as e:
            if not e.field or e.field in REQUIRED:
                raise
            drop_optional(outdir, e.field, str(e))
    raise ValidationError("too many optional fields were dropped")


def validate(outdir, require_z500a_hours=None, schema_path=SCHEMA_PATH, require_fields=None, max_step=None):
    """Raise ValidationError on the first problem; return a small summary dict."""
    import jsonschema
    with open(os.path.join(outdir, "manifest.json")) as fh:
        m = json.load(fh)
    with open(schema_path) as fh:
        schema = json.load(fh)
    try:
        jsonschema.validate(m, schema)
    except jsonschema.ValidationError as e:
        _fail(f"manifest schema: {e.message} at {'/'.join(str(p) for p in e.absolute_path)}")
    frames = {}
    for fid, f in m["fields"].items():
        if fid not in FIELD_META:
            _fail(f"unknown field id {fid}")
        units, scale, offset = FIELD_META[fid]
        if (f["units"], f["scale"], f["offset"]) != (units, scale, offset):
            _fail(f"{fid}: units/scale/offset differ from the contract")
        seen = []
        for ch in f["chunks"]:
            lo, hi = ch["steps"]
            if not 0 <= lo < hi <= len(f["steps"]):
                _fail(f"{fid} chunk {ch['id']}: index range {ch['steps']} outside {len(f['steps'])} steps")
            win = CHUNK_HOURS[ch["id"]]
            for i in range(lo, hi):
                if not win[0] <= f["steps"][i] <= win[1]:
                    _fail(f"{fid} chunk {ch['id']}: step {f['steps'][i]} h is outside {win}")
            seen += list(range(lo, hi))
            for dom, meta in ch["files"].items():
                if dom not in f["domains"]:
                    _fail(f"{fid} chunk {ch['id']}: file for domain {dom} not in the field's domains")
                p = os.path.join(outdir, meta["path"])
                if not os.path.exists(p):
                    _fail(f"missing file {meta['path']}")
                blob = open(p, "rb").read()
                if len(blob) != meta["bytes"]:
                    _fail(f"{meta['path']}: {len(blob)} bytes, manifest says {meta['bytes']}")
                if hashlib.sha256(blob).hexdigest() != meta["sha256"]:
                    _fail(f"{meta['path']}: sha256 differs from the manifest")
                d = m["domains"][dom]
                try:
                    fr = decode_chunk(blob, d["ny"], d["nx"], hi - lo, f["filter"])
                except Exception as e:  # noqa: BLE001
                    _fail(f"{meta['path']}: does not decode: {e}")
                for k in range(hi - lo):
                    q = fr[k]
                    valid = q != NODATA
                    if not valid.any():
                        _fail(f"{meta['path']}: frame {k} (step {f['steps'][lo + k]} h) is all no-data", fid)
                    v = dequantize(q, scale, offset)[valid]
                    if fid not in RANGES:
                        _fail(f"{fid}: no physical range is defined for this field id", fid)
                    rlo, rhi = RANGES[fid]
                    if v.min() < rlo or v.max() > rhi:
                        _fail(f"{fid}/{dom} step {f['steps'][lo + k]} h: values {v.min():.1f}..{v.max():.1f} "
                              f"outside {rlo}..{rhi}", fid)
                    frames[(fid, dom, f["steps"][lo + k])] = q
        if sorted(seen) != list(range(len(f["steps"]))):
            _fail(f"{fid}: chunks do not cover every step exactly once")
        if f["steps"] != sorted(set(f["steps"])):
            _fail(f"{fid}: steps not strictly increasing")
    for p in m["probes"]:
        key = (p["field"], p["domain"], p["step"])
        if key not in frames:
            _fail(f"probe for {key} has no frame")
        ij = nearest_index(m["domains"][p["domain"]], p["lat"], p["lon"])
        if ij is None:
            _fail(f"probe {p['name']} outside domain {p['domain']}")
        q = int(frames[key][ij])
        _, scale, offset = FIELD_META[p["field"]]
        if q == NODATA or abs(q * scale + offset - p["value"]) > scale / 2 + 1e-9:
            _fail(f"probe {p['name']} {key}: file holds {q * scale + offset}, manifest says {p['value']}")
    if require_z500a_hours is not None:
        top = max(m["fields"].get("z500a", {}).get("steps", [0]))
        if "z500a" not in m["fields"] or top < require_z500a_hours:
            _fail(f"z500a reaches {top if 'z500a' in m['fields'] else 'nothing'} h, need {require_z500a_hours} h")
    if require_z500a_hours is not None or require_fields is not None:
        _live_gate(m, require_fields, require_z500a_hours, max_step)
    b = check_budgets(outdir)
    return {"fields": sorted(m["fields"]), "files": b["files"], "bytes": b["bytes"], "probes": len(m["probes"]),
            "missing": [x["field"] for x in m.get("missing", [])]}


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--require-z500a-hours", type=int)
    ap.add_argument("--fields", help="comma-separated fields the build was asked for; each must be present")
    ap.add_argument("--max-step", type=int, help="the build's last step (coverage is judged against it)")
    a = ap.parse_args(argv)
    try:
        req = [f for f in a.fields.split(",") if f] if a.fields else None
        print(json.dumps(validate_dropping_optional(a.dir, require_z500a_hours=a.require_z500a_hours, require_fields=req,
                                                    max_step=a.max_step)))
    except ValidationError as e:
        print(f"VALIDATION FAILED: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
