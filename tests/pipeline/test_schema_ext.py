"""W1-02: the manifest schema gains every new key and field id once. One manifest per new key validates; an unknown key,
a malformed new key and an unknown field id are rejected; every manifest that validated before still validates."""
import copy
import json
import pathlib

import jsonschema
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / "tests/pipeline/manifest.schema.json").read_text())
FX = ROOT / "tests/site/fixtures"


def load(name):
    return json.loads((FX / name / "manifest.json").read_text())


def errors(m):
    return list(jsonschema.Draft202012Validator(SCHEMA).iter_errors(m))


@pytest.fixture
def base():
    return load("synthetic")


def field_like(m, fid_src="z500a"):
    return copy.deepcopy(m["fields"][fid_src])


def test_schema_is_valid_draft_2020_12():
    jsonschema.Draft202012Validator.check_schema(SCHEMA)


@pytest.mark.parametrize("name", ["synthetic", "sample-min"])
def test_old_manifests_still_validate(name):
    assert errors(load(name)) == []


def test_missing_key_validates(base):
    base["missing"] = [{"field": "z500sd", "reason": "ensemble files not yet published"}]
    assert errors(base) == []


@pytest.mark.parametrize("bad", [[{"field": "z500sd"}], [{"reason": "late"}], {"field": "z500sd"}, [{"field": "z500sd", "reason": "x", "extra": 1}]])
def test_missing_key_rejects_malformed(base, bad):
    base["missing"] = bad
    assert errors(base)


def test_checks_key_validates(base):
    base["checks"] = {
        "grib_compare": {"status": "pass", "max_abs_gpm": 0.4, "points": 120, "tolerance_gpm": 1.0},
        "mean_anomaly_gpm": {"global": 23.0, "nh": 31.0, "tropics": 37.0},
    }
    assert errors(base) == []
    base["checks"] = {"grib_compare": {"status": "pass", "max_abs_gpm": 0.4, "points": 120, "tolerance_gpm": 1.0}}
    assert errors(base) == []


@pytest.mark.parametrize("bad", [
    {"grib_compare": {"status": "pass"}},
    {"grib_compare": {"status": "pass", "max_abs_gpm": "x", "points": 1, "tolerance_gpm": 1}},
    {"mean_anomaly_gpm": {"global": 1, "nh": 2}},
    {"something_else": {}},
])
def test_checks_key_rejects_malformed(base, bad):
    base["checks"] = bad
    assert errors(base)


def test_sample_label_validates_and_is_a_string(base):
    base["sample_label"] = "Recorded run 2026-11-17 00Z"
    assert errors(base) == []
    base["sample_label"] = 3
    assert errors(base)


@pytest.mark.parametrize("fid", ["z500em", "pr1", "pr10", "t2m"])
def test_new_field_ids_validate(base, fid):
    base["fields"][fid] = field_like(base)
    base["cases"]["A"]["fields"].append(fid)
    assert errors(base) == []


def test_unknown_field_id_rejected(base):
    base["fields"]["z500xx"] = field_like(base)
    assert errors(base)


def test_unknown_top_level_key_rejected(base):
    base["surprise"] = 1
    assert errors(base)


def test_recorded_sample_has_label_and_no_cases():
    m = load("synthetic")
    del m["cases"]
    assert errors(m), "a sample with neither cases nor a sample_label is still refused"
    m["sample_label"] = "Recorded run"
    for f in m["fields"].values():
        f.pop("case", None)
    assert errors(m) == []


def test_probe_value_may_be_null_for_a_no_data_point(base):
    p = copy.deepcopy(base["probes"][0])
    p["value"] = None
    base["probes"].append(p)
    assert errors(base) == []
    p["value"] = "x"
    assert errors(base)


@pytest.mark.parametrize("name", ["synthetic-15d", "synthetic-15d-nomean", "synthetic-hires-48h", "synthetic-partial", "recorded-min"])
def test_new_fixture_manifests_validate(name):
    assert errors(load(name)) == []
