"""Quantize, filter, chunk, compress, hash and describe: the frozen byte format (site/js/contract.js) and the manifest.

A chunk file is gzip( frame_0 ++ frame_1 ++ ... ), each frame ny*nx Int16 little-endian, north to south, filtered:
"dx-shuffle" = per row the difference to the previous column (first column raw, wrapping mod 65536), then for the
whole frame all low bytes followed by all high bytes. value = int16 * scale + offset; -32768 is no data.
"""
from __future__ import annotations

import datetime as dt
import gzip
import hashlib
import json
import os

import numpy as np

from .grids import DOMAINS, nearest_index

NODATA = -32768
MiB = 1024 * 1024

# field id -> (units, scale, offset)   (SPEC section 9)
FIELD_META = {
    "z500": ("gpm", 1, 0), "z500a": ("gpm", 1, 0), "z500sd": ("gpm", 0.1, 0),
    "ws250": ("m/s", 0.1, 0), "tp6": ("mm", 0.1, 0), "t850a": ("K", 0.1, 0),
    "msl": ("Pa", 10, 101325), "ivt": ("kg/m/s", 1, 0), "t2a": ("K", 0.1, 0),
    # contract rows for the fields W3-10 builds; same numbers as tools/make_fixtures.py
    "z500em": ("gpm", 1, 0), "pr1": ("%", 1, 0), "pr10": ("%", 1, 0), "t2m": ("K", 0.1, 0),
}
CHUNK_HOURS = {"a": (0, 120), "b": (126, 240), "c": (246, 360)}

# Budgets (SPEC section 9, asserted by the pipeline).
MAX_FILE_BYTES = 8 * MiB
MAX_DATA_BYTES = 48 * MiB
MAX_DATA_FILES = 160

PROBE_CITIES = [("San Francisco", 37.77, -122.42), ("Seattle", 47.61, -122.33), ("Denver", 39.74, -104.99),
                ("Honolulu", 21.31, -157.86), ("New York", 40.71, -74.01), ("London", 51.51, -0.13)]


class BudgetError(RuntimeError):
    pass


def quantize(a, scale, offset):
    """float array -> int16: round((a - offset) / scale), saturate at +-32767, NaN or inf -> NODATA."""
    a = np.asarray(a, np.float64)
    with np.errstate(invalid="ignore", over="ignore"):
        q = np.rint((a - offset) / scale)
    bad = ~np.isfinite(q)
    q = np.clip(np.where(bad, 0, q), -32767, 32767)
    return np.where(bad, NODATA, q).astype(np.int16)


def dequantize(q, scale, offset):
    """int16 -> float32 with NaN where NODATA."""
    q = np.asarray(q)
    out = q.astype(np.float64) * scale + offset
    return np.where(q == NODATA, np.nan, out).astype(np.float32)


def dx_shuffle(frame):
    """One (ny, nx) int16 frame -> bytes."""
    d = frame.astype(np.int32)
    diff = d.copy()
    diff[:, 1:] = d[:, 1:] - d[:, :-1]
    u = (diff & 0xFFFF).astype(np.uint16)
    return (u & 0xFF).astype(np.uint8).ravel().tobytes() + (u >> 8).astype(np.uint8).ravel().tobytes()


def encode_chunk(frames, filt="dx-shuffle"):
    """(n, ny, nx) int16 -> gzip bytes. mtime 0 keeps the output byte-stable."""
    if filt == "dx-shuffle":
        raw = b"".join(dx_shuffle(f) for f in frames)
    elif filt == "none":
        raw = b"".join(np.ascontiguousarray(f, "<i2").tobytes() for f in frames)
    else:
        raise ValueError(f"unknown filter {filt!r}")
    return gzip.compress(raw, 9, mtime=0)


def decode_chunk(blob, ny, nx, nframes, filt="dx-shuffle"):
    """Reference decoder (the browser's job, mirrored here so the pipeline can validate its own output)."""
    if blob[:2] != b"\x1f\x8b":
        raise ValueError("not gzip")
    raw = gzip.decompress(blob)
    n = ny * nx
    if len(raw) != nframes * n * 2:
        raise ValueError(f"expected {nframes * n * 2} bytes after inflate, got {len(raw)}")
    out = []
    for f in range(nframes):
        seg = raw[f * n * 2:(f + 1) * n * 2]
        if filt == "dx-shuffle":
            lo = np.frombuffer(seg[:n], np.uint8).astype(np.uint32)
            hi = np.frombuffer(seg[n:], np.uint8).astype(np.uint32)
            u = ((hi << 8) | lo).reshape(ny, nx)
            u = np.cumsum(u, axis=1, dtype=np.uint64) & 0xFFFF
            out.append(u.astype(np.uint16).view(np.int16))
        else:
            out.append(np.frombuffer(seg, "<i2").reshape(ny, nx))
    return np.stack(out)


def iso_minute(t):
    """datetime -> 'YYYY-MM-DDTHH:MMZ' (the manifest's run and generated format)."""
    return t.strftime("%Y-%m-%dT%H:%MZ")


class ManifestWriter:
    """Collects fields, writes chunk files into `outdir`, and emits manifest.json.

    add_field(fid, steps, grids): grids = {domain: array (nsteps, ny, nx) of physical values, NaN = no data}.
    """

    def __init__(self, outdir, domains=None):
        self.out = str(outdir)
        self.domains = dict(domains or DOMAINS)
        self.fields = {}
        self.decoded = {}  # (field, domain) -> {step: int16 frame}
        os.makedirs(self.out, exist_ok=True)
        for f in os.listdir(self.out):
            if f.endswith(".bin") or f == "manifest.json":
                os.remove(os.path.join(self.out, f))

    def add_field(self, fid, steps, grids, case=None, source=None):
        units, scale, offset = FIELD_META[fid]
        steps = [int(s) for s in steps]
        if steps != sorted(set(steps)):
            raise ValueError(f"{fid}: steps must be strictly increasing, got {steps}")
        entry = {"units": units, "scale": scale, "offset": offset, "nodata": NODATA, "filter": "dx-shuffle",
                 "steps": steps, "domains": list(grids), "chunks": []}
        if case:
            entry["case"] = case
        if source:
            entry["source"] = source
        for cid, (lo, hi) in CHUNK_HOURS.items():
            idx = [i for i, s in enumerate(steps) if lo <= s <= hi]
            if not idx:
                continue
            files = {}
            for dom, arr in grids.items():
                d = self.domains[dom]
                arr = np.asarray(arr)
                if arr.shape != (len(steps), d["ny"], d["nx"]):
                    raise ValueError(f"{fid}/{dom}: shape {arr.shape}, expected {(len(steps), d['ny'], d['nx'])}")
                q = quantize(arr[idx[0]:idx[-1] + 1], scale, offset)
                for i, frame in zip(idx, q):
                    self.decoded.setdefault((fid, dom), {})[steps[i]] = frame
                blob = encode_chunk(q)
                name = f"{fid}.{dom}.{cid}.bin"
                with open(os.path.join(self.out, name), "wb") as fh:
                    fh.write(blob)
                files[dom] = {"path": name, "bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest()}
            entry["chunks"].append({"id": cid, "steps": [idx[0], idx[-1] + 1], "files": files})
        self.fields[fid] = entry

    def probe(self, name, lat, lon, fid, dom, step):
        """Dequantized value at the node nearest to (lat, lon); None if outside the domain or no data."""
        ij = nearest_index(self.domains[dom], lat, lon)
        if ij is None:
            return None
        q = int(self.decoded[(fid, dom)][step][ij])
        if q == NODATA:
            return None
        _, scale, offset = FIELD_META[fid]
        return {"name": name, "lat": lat, "lon": lon, "field": fid, "domain": dom, "step": int(step),
                "value": round(q * scale + offset, 6)}

    def probes(self):
        """The six cities at the first and last step of every field and domain."""
        out = []
        for fid, f in self.fields.items():
            for dom in f["domains"]:
                for step in sorted({f["steps"][0], f["steps"][-1]}):
                    for name, lat, lon in PROBE_CITIES:
                        p = self.probe(name, lat, lon, fid, dom, step)
                        if p:
                            out.append(p)
        return out

    def write(self, head):
        """head: schema/sample/model/run/generated/attribution/climatology (+ sample_note, cases)."""
        m = dict(head)
        m["domains"] = {k: self.domains[k] for k in sorted({d for f in self.fields.values() for d in f["domains"]})}
        m["fields"] = self.fields
        m["probes"] = self.probes()
        with open(os.path.join(self.out, "manifest.json"), "w") as fh:
            json.dump(m, fh, indent=1)
            fh.write("\n")
        check_budgets(self.out)
        return m


def check_budgets(outdir):
    """Raise BudgetError when a data file exceeds 8 MiB, the data files exceed 48 MiB, or there are over 160."""
    bins = [f for f in os.listdir(outdir) if f.endswith(".bin")]
    sizes = {f: os.path.getsize(os.path.join(outdir, f)) for f in bins}
    for f, n in sizes.items():
        if n > MAX_FILE_BYTES:
            raise BudgetError(f"{f} is {n} bytes, over the {MAX_FILE_BYTES} file budget")
    total = sum(sizes.values())
    if total > MAX_DATA_BYTES:
        raise BudgetError(f"data files total {total} bytes, over the {MAX_DATA_BYTES} budget")
    if len(bins) > MAX_DATA_FILES:
        raise BudgetError(f"{len(bins)} data files, over the {MAX_DATA_FILES} budget")
    return {"files": len(bins), "bytes": total}


def utcnow_minute():
    return dt.datetime.now(dt.timezone.utc).replace(second=0, microsecond=0)
