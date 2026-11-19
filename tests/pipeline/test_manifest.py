"""P-MANIFEST: what the writer emits is what the schema, the reference decoder and validate() accept; and
validate() refuses every kind of damage."""
import hashlib
import json
import os

import numpy as np
import pytest

from pipeline.encode import ManifestWriter, decode_chunk, dequantize
from pipeline.validate import ValidationError, validate

SMALL = {"g1": dict(lon0=-180.0, lat0=90.0, dlon=360 / 35, dlat=-10.0, nx=36, ny=19),
         "np05": dict(lon0=150.0, lat0=75.0, dlon=160 / 35, dlat=-65 / 18, nx=36, ny=19)}
HEAD = {"schema": 1, "sample": False, "model": "test", "run": "2026-11-18T00:00Z", "generated": "2026-11-18T09:50Z",
        "attribution": "test", "climatology": {"label": "l", "source": "s", "method": "m"}}
STEPS = list(range(0, 361, 6))


def field(steps, base, amp, dom="g1", seed=0):
    rng = np.random.default_rng(seed)
    d = SMALL[dom]
    yy, xx = np.mgrid[0:d["ny"], 0:d["nx"]]
    return np.stack([base + amp * np.sin(xx / 5.0 + s / 40.0) * np.cos(yy / 4.0) + rng.normal(0, 0.2, (d["ny"], d["nx"]))
                     for s in steps])


def build(out, fields=("z500a",), steps=STEPS):
    w = ManifestWriter(out, SMALL)
    for fid in fields:
        base = {"z500": 5500.0, "z500a": 0.0, "z500sd": 8.0, "ws250": 30.0, "tp6": 1.0, "t850a": 0.0}[fid]
        amp = {"z500": 150.0, "z500a": 80.0, "z500sd": 3.0, "ws250": 20.0, "tp6": 0.9, "t850a": 4.0}[fid]
        w.add_field(fid, steps, {d: field(steps, base, amp, d) for d in SMALL})
    return w.write(HEAD)


def read(out):
    return json.load(open(os.path.join(out, "manifest.json")))


def test_61_steps_split_into_three_chunks_by_hour(work):
    m = build(work)
    f = m["fields"]["z500a"]
    assert f["steps"] == STEPS and f["filter"] == "dx-shuffle" and f["nodata"] == -32768
    assert [(c["id"], c["steps"]) for c in f["chunks"]] == [("a", [0, 21]), ("b", [21, 41]), ("c", [41, 61])]
    assert set(f["chunks"][0]["files"]) == {"g1", "np05"}


def test_files_hash_size_and_decode_match_the_manifest(work):
    m = build(work, ("z500a", "z500sd"))
    for fid, f in m["fields"].items():
        for ch in f["chunks"]:
            for dom, meta in ch["files"].items():
                blob = open(os.path.join(work, meta["path"]), "rb").read()
                assert len(blob) == meta["bytes"] and hashlib.sha256(blob).hexdigest() == meta["sha256"]
                d = m["domains"][dom]
                fr = decode_chunk(blob, d["ny"], d["nx"], ch["steps"][1] - ch["steps"][0])
                assert fr.shape[0] == ch["steps"][1] - ch["steps"][0]


def test_six_cities_are_probed_and_probes_equal_the_decoded_node(work):
    m = build(work)
    names = {p["name"] for p in m["probes"]}
    assert {"San Francisco", "Seattle", "Denver", "Honolulu", "New York"} <= names  # London is outside np05, in g1
    assert {p["name"] for p in m["probes"] if p["domain"] == "g1"} == names | {"London"}
    assert {p["step"] for p in m["probes"]} == {0, 360}
    assert validate(str(work))["probes"] == len(m["probes"])


def test_tp6_has_no_step_zero_and_a_g1_only_field_lists_only_g1(work):
    w = ManifestWriter(work, SMALL)
    st = STEPS[1:]
    w.add_field("tp6", st, {"g1": field(st, 1.0, 0.9)})
    m = w.write(HEAD)
    assert m["fields"]["tp6"]["steps"][0] == 6 and m["fields"]["tp6"]["domains"] == ["g1"]
    assert set(m["domains"]) == {"g1"}
    assert m["fields"]["tp6"]["chunks"][0]["steps"] == [0, 20]  # steps 6..120 -> 20 frames in chunk a


def test_missing_steps_keep_their_own_index_ranges(work):
    st = [0, 6, 12, 24, 120, 126, 300]
    m = build(work, steps=st)
    assert [(c["id"], c["steps"]) for c in m["fields"]["z500a"]["chunks"]] == [("a", [0, 5]), ("b", [5, 6]), ("c", [6, 7])]
    validate(str(work))


def test_manifest_validates_and_writer_rejects_bad_input(work):
    build(work)
    assert validate(str(work))["files"] == 6
    w = ManifestWriter(work, SMALL)
    with pytest.raises(ValueError, match="strictly increasing"):
        w.add_field("z500a", [6, 0], {"g1": field([6, 0], 0, 1)})
    with pytest.raises(ValueError, match="shape"):
        w.add_field("z500a", [0, 6], {"g1": field([0], 0, 1)})


def test_nan_becomes_no_data_and_a_probe_there_is_dropped(work):
    w = ManifestWriter(work, SMALL)
    a = field([0], 30.0, 5.0)
    a[:, :, :] = a
    a[0, :, :18] = np.nan  # the western half of g1 has no data
    w.add_field("ws250", [0], {"g1": a})
    m = w.write(HEAD)
    d = m["domains"]["g1"]
    blob = open(os.path.join(work, m["fields"]["ws250"]["chunks"][0]["files"]["g1"]["path"]), "rb").read()
    fr = dequantize(decode_chunk(blob, d["ny"], d["nx"], 1), 0.1, 0)
    assert np.isnan(fr[0, :, :18]).all() and np.isfinite(fr[0, :, 18:]).all()
    assert all(p["name"] != "San Francisco" for p in m["probes"])  # SF at -122 lies in the empty half


# ---- validate() refuses damage -------------------------------------------------------------------------

def _tamper(work, fn):
    build(work)
    fn(work)
    with pytest.raises(ValidationError) as e:
        validate(str(work))
    return str(e.value)


def test_validate_catches_a_flipped_byte(work):
    def flip(w):
        p = os.path.join(w, "z500a.g1.a.bin")
        b = bytearray(open(p, "rb").read())
        b[len(b) // 2] ^= 0xFF
        open(p, "wb").write(bytes(b))
    assert "sha256" in _tamper(work, flip)


def test_validate_catches_a_missing_file(work):
    assert "missing file" in _tamper(work, lambda w: os.remove(os.path.join(w, "z500a.np05.c.bin")))


def test_validate_catches_a_wrong_probe(work):
    def bad(w):
        p = os.path.join(w, "manifest.json")
        m = json.load(open(p))
        m["probes"][0]["value"] += 25
        json.dump(m, open(p, "w"))
    assert "probe" in _tamper(work, bad)


def test_validate_catches_schema_violations(work):
    def bad(w):
        p = os.path.join(w, "manifest.json")
        m = json.load(open(p))
        m["fields"]["z500a"]["nodata"] = 0
        json.dump(m, open(p, "w"))
    assert "schema" in _tamper(work, bad)


def test_validate_catches_a_unit_slip(work):
    w = ManifestWriter(work, SMALL)
    w.add_field("z500", [0], {"g1": field([0], 5500.0 * 9.80665, 100.0)})  # geopotential, not height
    w.write(HEAD)
    with pytest.raises(ValidationError, match="outside"):
        validate(str(work))


def test_validate_catches_an_all_no_data_frame(work):
    w = ManifestWriter(work, SMALL)
    w.add_field("ws250", [0, 6], {"g1": np.stack([field([0], 30, 5)[0], np.full((19, 36), np.nan)])})
    w.write(HEAD)
    with pytest.raises(ValidationError, match="all no-data"):
        validate(str(work))


def test_validate_requires_z500a_to_reach_the_minimum_lead(work):
    build(work, steps=list(range(0, 121, 6)))
    validate(str(work))
    with pytest.raises(ValidationError, match="reaches 120 h, need 168"):
        validate(str(work), require_z500a_hours=168)
    build(work, steps=list(range(0, 175, 6)))
    validate(str(work), require_z500a_hours=168)
    build(work, ("z500",), steps=list(range(0, 361, 6)))
    with pytest.raises(ValidationError, match="z500a reaches nothing"):
        validate(str(work), require_z500a_hours=168)


# ---- the live-run completeness gate: a thin or gappy run must not replace a good one ---------------------

LIVE = dict(require_z500a_hours=168, max_step=360)


def _gate(work, steps_by_field):
    w = ManifestWriter(work, SMALL)
    base = {"z500": 5500.0, "z500a": 0.0, "z500sd": 8.0, "tp6": 1.0}
    amp = {"z500": 150.0, "z500a": 80.0, "z500sd": 3.0, "tp6": 0.9}
    for fid, st in steps_by_field.items():
        w.add_field(fid, st, {d: field(st, base[fid], amp[fid], d) for d in SMALL})
    w.write(HEAD)
    return work


def test_gate_accepts_a_complete_run(work):
    _gate(work, {"z500a": STEPS, "z500": STEPS})
    validate(str(work), require_fields=["z500a", "z500"], **LIVE)


def test_gate_refuses_a_run_with_a_168_h_gap(work):
    _gate(work, {"z500a": [0, 6, 168]})
    with pytest.raises(ValidationError, match="gap"):
        validate(str(work), **LIVE)


def test_gate_refuses_a_missing_requested_field(work):
    _gate(work, {"z500a": STEPS})
    with pytest.raises(ValidationError, match="z500.*missing|missing.*z500"):
        validate(str(work), require_fields=["z500a", "z500"], **LIVE)


def test_gate_allows_one_missing_step_but_not_two_in_a_row(work):
    one = [s for s in STEPS if s != 60]
    _gate(work, {"z500a": one})
    validate(str(work), **LIVE)
    two = [s for s in STEPS if s not in (60, 66)]
    w2 = work / "two"
    w2.mkdir()
    _gate(w2, {"z500a": two})
    with pytest.raises(ValidationError, match="gap"):
        validate(str(w2), **LIVE)


def test_gate_refuses_a_thin_field(work):
    thin = sorted({s for s in STEPS if s % 12 == 0} | {6})
    _gate(work, {"z500a": STEPS, "z500": thin})
    with pytest.raises(ValidationError, match="steps"):
        validate(str(work), require_fields=["z500a", "z500"], **LIVE)


def test_gate_lets_the_ensemble_spread_be_12_hourly(work):
    _gate(work, {"z500a": STEPS, "z500sd": [s for s in STEPS if s % 12 == 0]})
    validate(str(work), require_fields=["z500a", "z500sd"], **LIVE)


def test_validate_without_the_gate_still_takes_partial_data(work):
    _gate(work, {"z500a": [0, 6, 168]})
    validate(str(work))
