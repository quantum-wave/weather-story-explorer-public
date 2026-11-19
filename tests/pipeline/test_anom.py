"""P-ANOM: harmonic climatology fit, evaluation at the valid time, regridding, and anomaly = field - climatology."""
import datetime as dt

import numpy as np
import pytest

from pipeline import anomaly
from pipeline.anomaly import Climatology, design, eval_harmonics, fit_harmonics, t_days
from pipeline.grids import DOMAINS, axes


def make_clim(work, mean=5500.0, amp=60.0, nlat=61, nlon=120):
    """A 3 degree climatology whose z500 has an annual cycle and a north-south slope; t850 constant 270."""
    lat = np.linspace(90, -90, nlat)
    lon = np.arange(nlon) * 360.0 / nlon
    days = np.arange(0, 365)
    th = 2 * np.pi * days / anomaly.YEAR_DAYS
    z = mean + 0.5 * lat[None, :, None] + amp * np.cos(th)[:, None, None] * np.ones((1, nlat, nlon)) \
        + 20 * np.sin(2 * th)[:, None, None]
    planes = {"z500": fit_harmonics(days, z), "t850": fit_harmonics(days, np.full((365, nlat, nlon), 270.0))}
    path = work / "h.npz"
    anomaly.save(path, lat, lon, planes, {"label": "test baseline", "source": "unit test", "method": "annual mean + 3 harmonics"})
    return path, lat, lon, z


def test_fit_recovers_known_harmonics():
    days = np.arange(365)
    th = 2 * np.pi * days / anomaly.YEAR_DAYS
    v = (100 + 7 * np.cos(th) - 3 * np.sin(th) + 2 * np.cos(2 * th) + 1.5 * np.sin(3 * th))[:, None, None]
    c = fit_harmonics(days, v)
    assert c[:, 0, 0] == pytest.approx([100, 7, -3, 2, 0, 0, 1.5], abs=1e-3)
    assert eval_harmonics(c, 100.25)[0, 0] == pytest.approx(
        100 + 7 * np.cos(2 * np.pi * 100.25 / 365.25) - 3 * np.sin(2 * np.pi * 100.25 / 365.25)
        + 2 * np.cos(4 * np.pi * 100.25 / 365.25) + 1.5 * np.sin(6 * np.pi * 100.25 / 365.25), abs=1e-3)


def test_valid_time_is_days_since_new_year_in_utc():
    assert t_days(dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)) == 0
    assert t_days(dt.datetime(2026, 11, 18, 12, tzinfo=dt.timezone.utc)) == pytest.approx(321.5)
    assert t_days(dt.datetime(2028, 3, 1, tzinfo=dt.timezone.utc)) == 60  # leap year: 31 + 29


def test_anomaly_is_field_minus_climatology_at_the_valid_day(work):
    path, lat, lon, z = make_clim(work)
    c = Climatology.load(path)
    valid = dt.datetime(2026, 7, 2, 18, tzinfo=dt.timezone.utc)
    td = t_days(valid)
    expect_clim = 5500 + 0.5 * 37.0 + 60 * np.cos(2 * np.pi * td / 365.25) + 20 * np.sin(4 * np.pi * td / 365.25)
    lon_d, lat_d = axes(DOMAINS["np05"])
    j = int(np.argmin(np.abs(lat_d - 37.0)))
    i = int(np.argmin(np.abs(lon_d - 210.0)))
    clim_here = c.at("z500", "np05", valid)[j, i]
    assert clim_here == pytest.approx(expect_clim + 0.5 * (lat_d[j] - 37.0), abs=0.05)
    field = np.full((131, 321), 5600.0, np.float32)
    a = c.anomaly("z500", "np05", valid, field)
    assert a[j, i] == pytest.approx(5600.0 - clim_here, abs=1e-3)
    assert a.shape == (131, 321) and a.dtype == np.float32


def test_climatology_changes_through_the_year_and_across_domains(work):
    path, *_ = make_clim(work)
    c = Climatology.load(path)
    jan = c.at("z500", "g1", dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc))
    jul = c.at("z500", "g1", dt.datetime(2026, 7, 2, tzinfo=dt.timezone.utc))
    assert jan.shape == (181, 361)
    assert jan[60, 100] - jul[60, 100] == pytest.approx(120 + 0, abs=3)  # amplitude 60 cos: +60 in Jan, -60 in Jul
    assert np.array_equal(jan[:, 0], jan[:, 360])  # g1 wrap column
    assert c.at("t850", "np05", dt.datetime(2026, 3, 3, tzinfo=dt.timezone.utc)) == pytest.approx(270.0, abs=1e-3)


def test_metadata_round_trips_to_the_manifest_block(work):
    path, *_ = make_clim(work)
    assert Climatology.load(path).description == {"label": "test baseline", "source": "unit test",
                                                  "method": "annual mean + 3 harmonics"}


def test_design_matrix_has_seven_columns():
    assert design([0, 100]).shape == (2, 7)
