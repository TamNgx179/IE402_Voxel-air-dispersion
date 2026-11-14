import numpy as np
import pytest
import xarray as xr

from src.analysis.technical_bundle import compare


def test_vertical_comparison_uses_shared_air_cells_and_baseline_elevations():
    baseline = xr.DataArray([[[0., 8., np.nan]]], dims=('z', 'y', 'x'),
                            coords={'z': [1], 'y': [2], 'x': [3, 4, 5]})
    alternate = xr.DataArray([[[2., np.nan, 5.]], [[90., 90., 90.]]],
                             dims=baseline.dims, coords={'z': [1, 3], 'y': [2], 'x': [3, 4, 5]})
    assert compare(baseline, alternate) == [dict(
        height_m=1, air_cells=1, baseline_mean=0, alternative_mean=2, mean_delta=2, mae=2)]
    with pytest.raises(ValueError, match='exact'):
        compare(baseline, alternate.assign_coords(x=[4, 5, 6]))
