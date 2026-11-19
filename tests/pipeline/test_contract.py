"""Phase 0 contract tests: the schema, the two committed site fixtures, and the byte format.

The decoder here is an independent reference for the frozen chunk format (site/js/contract.js); WP1 adds
P-CODEC and the rest beside it."""
import gzip
import hashlib
import json
import pathlib

import jsonschema
import numpy as np
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / "tests/pipeline/manifest.schema.json").read_text())
FIXTURES = ["synthetic", "sample-min"]


def fixture_dir(name):
    return ROOT / "tests/site/fixtures" / name


def decode_chunk(blob, ny, nx, nframes, filt):
    assert blob[:2] == b"\x1f\x8b"
    raw = gzip.decompress(blob)
    n = ny * nx
    assert len(raw) == nframes * n * 2
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


def load(name):
    return json.loads((fixture_dir(name) / "manifest.json").read_text())


def test_schema_is_valid():
    jsonschema.Draft202012Validator.check_schema(SCHEMA)


@pytest.mark.parametrize("name", FIXTURES)
def test_fixture_manifest_validates(name):
    jsonschema.validate(load(name), SCHEMA)


@pytest.mark.parametrize("name", FIXTURES)
def test_fixture_files_match_manifest(name):
    m = load(name)
    for fid, f in m["fields"].items():
        for ch in f["chunks"]:
            for dom, meta in ch["files"].items():
                blob = (fixture_dir(name) / meta["path"]).read_bytes()
                assert len(blob) == meta["bytes"]
                assert hashlib.sha256(blob).hexdigest() == meta["sha256"]
                d = m["domains"][dom]
                lo, hi = ch["steps"]
                frames = decode_chunk(blob, d["ny"], d["nx"], hi - lo, f["filter"])
                assert frames.shape == (hi - lo, d["ny"], d["nx"])


@pytest.mark.parametrize("name", FIXTURES)
def test_probes_match_decoded_values(name):
    m = load(name)
    assert m["probes"], "fixture lists probes"
    for p in m["probes"]:
        f = m["fields"][p["field"]]
        d = m["domains"][p["domain"]]
        idx = f["steps"].index(p["step"])
        ch = next(c for c in f["chunks"] if c["steps"][0] <= idx < c["steps"][1])
        blob = (fixture_dir(name) / ch["files"][p["domain"]]["path"]).read_bytes()
        frames = decode_chunk(blob, d["ny"], d["nx"], ch["steps"][1] - ch["steps"][0], f["filter"])
        i = round(((p["lon"] - d["lon0"]) % 360) / d["dlon"]) if p["domain"] != "g1" else round((p["lon"] - d["lon0"]) / d["dlon"])
        j = round((p["lat"] - d["lat0"]) / d["dlat"])
        q = int(frames[idx - ch["steps"][0], j, i])
        assert q != -32768
        assert q * f["scale"] + f["offset"] == pytest.approx(p["value"], abs=f["scale"] / 2)


def test_sample_min_is_real_data_not_synthetic():
    m = load("sample-min")
    assert m["sample"] is True and "synthetic" not in m["sample_note"]
    for f in m["fields"].values():
        assert f["source"]["file"].endswith((".grib", ".nc"))
        assert f["source"]["valid"]


def test_synthetic_is_marked():
    m = load("synthetic")
    assert m["sample"] is True and m["sample_note"] == "synthetic test data"
    for d in m["domains"].values():
        assert (d["nx"], d["ny"]) == (36, 19)
    assert {len(f["steps"]) for k, f in m["fields"].items() if k != "tp6"} == {9}


def test_schema_rejects_breakage():
    m = load("synthetic")
    m["fields"]["z500"]["nodata"] = 0
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(m, SCHEMA)
    m = load("synthetic")
    del m["cases"]
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(m, SCHEMA)
