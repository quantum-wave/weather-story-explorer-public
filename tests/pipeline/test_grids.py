"""P-GRID: the centred kernels, bilinear refinement, longitude wrap, orientation."""
import numpy as np
import pytest

from pipeline.grids import DOMAINS, Grid, axes, bilinear, coarsen_centred, nearest_index, orient, resample

NATIVE = Grid(lat0=90.0, dlat=-0.25, lon0=0.0, dlon=0.25, ny=721, nx=1440)


def native_field(fn):
    lon = NATIVE.lons[None, :]
    lat = NATIVE.lats[:, None]
    return fn(lat, lon).astype(np.float64)


def test_domain_geometry_matches_the_contract():
    assert DOMAINS["g1"] == dict(lon0=-180.0, lat0=90.0, dlon=1.0, dlat=-1.0, nx=361, ny=181)
    assert DOMAINS["np05"] == dict(lon0=150.0, lat0=75.0, dlon=0.5, dlat=-0.5, nx=321, ny=131)
    lon, lat = axes(DOMAINS["np05"])
    assert (lon[0], lon[-1], lat[0], lat[-1]) == (150.0, 310.0, 75.0, 10.0)


def test_one_degree_kernel_is_1_8_1_4_1_4_1_4_1_8_in_both_directions():
    a = np.zeros((721, 1440))
    a[200, 600] = 1.0  # native node (lat 40, lon 150): the centre of g1 node (lat 40, lon 150)
    out = resample(a, NATIVE, DOMAINS["g1"])
    j, i = nearest_index(DOMAINS["g1"], 40, 150)
    assert out[j, i] == pytest.approx(0.25 * 0.25)
    # a spike one native node east/north of centre lands in the same g1 node with weight (1/4)*(1/4)
    a2 = np.zeros((721, 1440))
    a2[200 + 1, 600 + 1] = 1.0
    assert resample(a2, NATIVE, DOMAINS["g1"])[j, i] == pytest.approx(0.0625)
    # two nodes out: weight 1/8 along each axis; the node sits in the neighbouring g1 cell too
    a3 = np.zeros((721, 1440))
    a3[200 + 2, 600] = 1.0
    out3 = resample(a3, NATIVE, DOMAINS["g1"])
    assert out3[j, i] == pytest.approx(0.125 * 0.25)
    assert out3[j + 1, i] == pytest.approx(0.125 * 0.25)  # 1/8 weight to the next g1 row (offset -2 from it)


def test_half_degree_kernel_is_1_4_1_2_1_4():
    a = np.zeros((721, 1440))
    a[100, 640] = 1.0  # lat 65, lon 160
    out = resample(a, NATIVE, DOMAINS["np05"])
    j, i = nearest_index(DOMAINS["np05"], 65, 160)
    assert out[j, i] == pytest.approx(0.5 * 0.5)
    a = np.zeros((721, 1440))
    a[100, 641] = 1.0
    assert resample(a, NATIVE, DOMAINS["np05"])[j, i] == pytest.approx(0.5 * 0.25)


def test_kernels_conserve_a_constant_and_a_linear_ramp():
    c = np.full((721, 1440), 7.5)
    for d in DOMAINS.values():
        assert np.allclose(resample(c, NATIVE, d), 7.5)
    ramp = native_field(lambda lat, lon: lat * np.ones_like(lon))
    out = resample(ramp, NATIVE, DOMAINS["g1"])
    lon, lat = axes(DOMAINS["g1"])
    assert np.allclose(out[1:-1], lat[1:-1, None], atol=1e-5)  # away from the poles a symmetric kernel is exact on a ramp


def test_poles_truncate_and_renormalise_not_nan():
    out = resample(np.full((721, 1440), 3.0), NATIVE, DOMAINS["g1"])
    assert np.isfinite(out).all() and np.allclose(out[0], 3.0) and np.allclose(out[-1], 3.0)


def test_longitude_wraps_and_g1_has_a_wrap_column():
    a = np.zeros((721, 1440))
    a[:, 1439] = 1.0  # lon 359.75, one native node west of lon 0
    out = resample(a, NATIVE, DOMAINS["g1"])
    j, _ = nearest_index(DOMAINS["g1"], 0.0, 0.0)
    i0 = int(round((0 - -180) / 1))
    assert out[j, i0] == pytest.approx(0.25, abs=1e-6)  # lon 0's window holds native lon 359.75 at weight 1/4
    assert np.array_equal(out[:, 0], out[:, 360])  # lon -180 and +180 are the same meridian


def test_np05_picks_150e_to_50w():
    a = native_field(lambda lat, lon: lon * np.ones_like(lat))
    out = resample(a, NATIVE, DOMAINS["np05"])
    lon, _ = axes(DOMAINS["np05"])
    assert np.allclose(out[10], lon, atol=1e-4)  # values equal east longitude 150..310


def test_coarsen_returns_none_when_nodes_do_not_line_up():
    g = Grid(90, -0.75, -180, 0.75, 241, 480)
    lon, lat = axes(DOMAINS["g1"])
    assert coarsen_centred(np.zeros((241, 480)), g, lon, lat) is None


def test_bilinear_refines_a_coarse_grid_and_leaves_gaps_outside_a_regional_source():
    coarse = Grid(60, -10, 200, 10, 7, 9)  # lat 60..0, lon 200..280
    a = np.add.outer(np.arange(7) * 100.0, np.arange(9) * 1.0)
    out = resample(a, coarse, DOMAINS["np05"])
    lon, lat = axes(DOMAINS["np05"])
    j, i = nearest_index(DOMAINS["np05"], 45, 245)
    assert out[j, i] == pytest.approx(1.5 * 100 + 4.5)  # lat 45 is 1.5 rows down, lon 245 is 4.5 columns across
    assert np.isnan(out[0, 0])  # 75N, 150E: outside
    assert np.isnan(out[:, -1]).all()  # 310E: outside lon 200-280


def test_bilinear_wraps_on_a_global_source():
    g = Grid(90, -30, 0, 60, 7, 6)  # lon 0..300, period 6 columns
    a = np.tile(np.arange(6.0), (7, 1))
    out = bilinear(a, g, np.array([330.0]), np.array([0.0]))
    assert out[0, 0] == pytest.approx(2.5)  # halfway between lon 300 (5) and 360 = 0 (0)


def test_orient_flips_south_north_and_east_west_axes():
    a = np.arange(6.0).reshape(2, 3)
    out, g = orient(a, [10, 20], [0, 1, 2])
    assert g.lat0 == 20 and g.dlat == -10 and np.array_equal(out, a[::-1])
    out, g = orient(a, [20, 10], [2, 1, 0])
    assert g.lon0 == 0 and np.array_equal(out, a[:, ::-1])


def test_nearest_index_handles_negative_longitudes_and_edges():
    assert nearest_index(DOMAINS["np05"], 37.77, -157.86) == (74, 104)  # 202.14E is 52.14 degrees past 150E
    assert nearest_index(DOMAINS["np05"], 51.5, -0.13) is None  # London is outside np05
    assert nearest_index(DOMAINS["g1"], 51.51, -0.13) == (38, 180)
