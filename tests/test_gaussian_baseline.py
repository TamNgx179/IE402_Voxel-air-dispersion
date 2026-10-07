"""B2.2: both labelled wind scenarios use the same absolute road source."""

from __future__ import annotations

import numpy as np
import xarray as xr
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from analysis.baseline import gaussian_road_baseline
from analysis.fields import ConcentrationField


def test_two_gaussian_scenarios_change_plume_direction(tmp_path) -> None:
    x = np.arange(20, dtype=float) * 5.0 + 2.5
    y = np.arange(20, dtype=float) * 5.0 + 2.5
    z = np.arange(6, dtype=float) * 2.0 + 1.0
    source = np.zeros((6, 20, 20), dtype=float)
    source[0, 10, 10] = 1e-10
    source_path = tmp_path / "source.nc"
    xr.Dataset(
        {"S": (("z", "y", "x"), source, {"units": "kg m-3 s-1"})},
        coords={"z": z, "y": y, "x": x},
    ).to_netcdf(source_path)
    grid = ConcentrationField(
        concentration=np.zeros_like(source), solid=np.zeros_like(source, dtype=bool),
        z=z, y=y, x=x, crs="EPSG:32648",
    )
    dry = gaussian_road_baseline(
        str(source_path), grid, wind_from_deg=112.0, wind_speed_m_s=1.62,
        reference_height_m=10.0, stability="D",
    )
    wet = gaussian_road_baseline(
        str(source_path), grid, wind_from_deg=227.0, wind_speed_m_s=1.84,
        reference_height_m=10.0, stability="D",
    )
    assert np.nanmax(dry) > 0.0
    assert np.nanmax(wet) > 0.0
    assert not np.allclose(dry, wet)
