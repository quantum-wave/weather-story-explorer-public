"""W4-08 (Josh point 8, MET-12, design 13.3): tools/compare_grib.py checks the decoded z500 in a data build against the raw
ECMWF GRIB at five fixed points, applying its own copy of the 0.25 -> 1 degree kernel (published values are kernel averages,
not node values). Tolerance scale/2 + 0.5 gpm. Warns and exits 0 on fail: it does not block a publish (default 33).
Known-positive: a x0.98 unit slip must fail; a sharp trough must still pass (no false alarm); the sharp trough is
what makes a missing or wrong kernel visible."""
import importlib.util
import json
import pathlib

import jsonschema
import numpy as np
import pytest

from grib_helpers import write_grib
from pipeline import reduce
from pipeline.encode import ManifestWriter
from pipeline.gribio import read_messages

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("compare_grib", ROOT / "tools" / "compare_grib.py")
cg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cg)

LAT = np.linspace(90, -90, 721)
LON = np.arange(0, 360, 0.25)
LA, LO = np.meshgrid(LAT, LON, indexing="ij")
HEAD = {"schema": 1, "sample": False, "model": "ECMWF IFS HRES", "run": "2026-11-18T00:00Z", "generated": "2026-11-18T09:50Z",
        "attribution": "ECMWF open data CC-BY-4.0", "climatology": {"label": "none", "source": "none", "method": "none"}}
SCHEMA = json.load(open(ROOT / "tests" / "pipeline" / "manifest.schema.json"))


def smooth():
    return 5500 + 150 * np.sin(np.radians(LA) * 2) + 40 * np.cos(np.radians(LO) * 3)


def trough():
    """A sharp 0.6 degree wide trough centred on a check point (Denver) on a smooth background: the raw node value
    differs from the 1 degree kernel average by tens of gpm, so only a correct kernel passes."""
    d2 = (LA - 39.0) ** 2 + (((LO - 255.0) + 180) % 360 - 180) ** 2
    return smooth() - 320 * np.exp(-d2 / (2 * 0.6 ** 2))


def build(work, field, name="grib"):
    """-> (grib path, data dir): a raw 0.25 degree GRIB of `field` (the 500 hPa height, step 0) and a data build whose z500
    is what pipeline.reduce makes from `field`, then multiplied by `slip`."""
    g = work / f"{name}.grib2"
    write_grib(g, [dict(short="gh", level=500, data=field, lat=LAT, lon=LON)])
    return g


def data_dir(work, field, slip=1.0, step=0):
    m = read_messages(str(work / "grib.grib2"))[0]
    z = reduce.to_domains(m.data, m.grid, ("g1",))["g1"] * slip
    w = ManifestWriter(work / "out")
    w.add_field("z500", [step], {"g1": z[None]})
    w.write(HEAD)
    return str(work / "out")


def manifest(work):
    return json.load(open(work / "out" / "manifest.json"))


def test_identical_data_passes_and_is_recorded_in_the_manifest(work):
    g = build(work, smooth())
    d = data_dir(work, None)
    r = cg.compare(str(g), d)
    assert r["status"] == "pass" and r["points"] == 5 and r["tolerance_gpm"] == pytest.approx(1.0)
    assert r["max_abs_gpm"] <= 0.5
    assert cg.main([str(g), d]) == 0
    c = manifest(work)["checks"]["grib_compare"]
    assert c == {"status": "pass", "max_abs_gpm": c["max_abs_gpm"], "points": 5, "tolerance_gpm": 1.0}
    jsonschema.validate(manifest(work), SCHEMA)


def test_a_098_unit_slip_reports_fail_warns_and_still_exits_zero(work, capsys):
    g = build(work, smooth())
    d = data_dir(work, None, slip=0.98)
    assert cg.main([str(g), d]) == 0  # non-blocking
    out = capsys.readouterr().out
    assert "::warning::" in out and "fail" in out
    c = manifest(work)["checks"]["grib_compare"]
    assert c["status"] == "fail" and c["max_abs_gpm"] > 90  # 2% of about 5500 gpm is about 110
    jsonschema.validate(manifest(work), SCHEMA)


def test_a_sharp_trough_still_passes_because_the_kernel_is_applied(work):
    field = trough()
    g = build(work, field)
    d = data_dir(work, None)
    r = cg.compare(str(g), d)
    assert r["status"] == "pass", r
    # the point of the test: at Denver the raw node and the kernel average differ by far more than the tolerance
    j, i = int(round((90 - 39.0) / 0.25)), int(round(255.0 / 0.25))
    raw_node = float(np.float32(field[j, i]))
    pts = {p["name"]: p for p in r["detail"]}
    assert abs(raw_node - pts["Denver"]["published"]) > 10 * r["tolerance_gpm"]
    assert abs(pts["Denver"]["kernel"] - pts["Denver"]["published"]) <= r["tolerance_gpm"]


def test_the_kernel_is_not_the_pipelines_function_and_weights_sum_to_one():
    assert not hasattr(cg, "coarsen_centred") and cg.WEIGHTS == [1 / 8, 1 / 4, 1 / 4, 1 / 4, 1 / 8]
    assert sum(cg.WEIGHTS) == pytest.approx(1.0)


def test_tolerance_follows_the_manifests_scale():
    assert cg.tolerance_gpm(1) == 1.0 and cg.tolerance_gpm(0.1) == pytest.approx(0.55)


def test_a_step_the_manifest_does_not_hold_is_skipped_with_a_warning_and_exit_zero(work, capsys):
    g = build(work, smooth())
    d = data_dir(work, None, step=12)  # the GRIB says step 0; the build holds 12 only
    assert cg.main([str(g), d]) == 0
    assert "::warning::" in capsys.readouterr().out
    assert "checks" not in manifest(work)


def test_an_unreadable_grib_never_blocks(work, capsys):
    g = build(work, smooth())
    d = data_dir(work, None)
    bad = work / "bad.grib2"
    bad.write_bytes(b"not a grib")
    assert cg.main([str(bad), d]) == 0
    assert "::warning::" in capsys.readouterr().out
