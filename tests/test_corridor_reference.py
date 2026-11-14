import numpy as np
import pytest
from shapely.geometry import LineString, box

from src.analysis.corridor_reference import integrate


def test_corridor_clips_overlapping_roads_and_keeps_missing_air_separate():
    grid = dict(dx_m=1, dy_m=1, dz_m=2, origin_x_m=0, origin_y_m=0)
    road = LineString([(-2, 0.5), (4, 0.5)])
    field = np.array([[[0, 99]], [[5, 10]], [[np.nan, 5]]])
    solid = np.zeros_like(field, dtype=bool)
    solid[0, 0, 1] = True
    a, b = integrate([road, road], box(0, 0, 2, 1), grid, field, solid, [0.25, 0.5], 1, 5, 5)
    for band in (a, b):
        # Each band covers half of each footprint. Valid values and weights are
        # (0,.5), (5,1), (10,1), (5,.5). Only the value 10 exceeds the threshold.
        assert band == pytest.approx(dict(area_m2=1, air_volume_m3=3.5,
                                         valid_volume_m3=3, coverage=6/7,
                                         mean_ug_m3=17.5/3, exceedance_volume_m3=1))
