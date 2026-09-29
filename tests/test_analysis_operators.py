"""
Tier 3 spatial-analysis operators, each against an answer known in closed form.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from analysis import operators as ops  # noqa: E402

DZ, DY, DX = 2.0, 5.0, 5.0
Z = np.arange(1.0, 100.0, DZ)  # 1, 3, ..., 99: the project's cell centres


def linear_in_z(a: float = 3.0, b: float = 0.5, shape=(50, 4, 6)) -> np.ndarray:
    """C = a + b*z, identical in every column."""

    return (a + b * Z)[:, None, None] * np.ones(shape)


# --- AC-1: slice at an arbitrary height ------------------------------------

@pytest.mark.parametrize("height", [1.5, 6.0, 15.0, 30.0, 98.2])
def test_ac1_slice_between_centres_matches_the_linear_field(height):
    plane = ops.layer_at_height(linear_in_z(), Z, height)

    assert plane.shape == (4, 6)
    np.testing.assert_allclose(plane, 3.0 + 0.5 * height, atol=1e-6)


def test_ac1_slice_on_a_centre_returns_that_layer_exactly():
    c = np.random.default_rng(0).random((50, 3, 3))

    np.testing.assert_array_equal(ops.layer_at_height(c, Z, 15.0), c[7])


def test_ac1_below_the_lowest_centre_uses_the_lowest_cell():
    c = linear_in_z()

    np.testing.assert_array_equal(ops.layer_at_height(c, Z, 0.4), c[0])


def test_ac1_one_solid_side_takes_the_air_side():
    c = linear_in_z()
    solid = np.zeros(c.shape, dtype=bool)
    solid[7, 0, 0] = True  # z = 15 m solid in column (0, 0)

    plane = ops.layer_at_height(c, Z, 14.0, solid)

    assert plane[0, 0] == pytest.approx(3.0 + 0.5 * 13.0)  # the air cell below
    assert plane[1, 1] == pytest.approx(3.0 + 0.5 * 14.0)  # untouched column


# --- EC-1 / EC-2 ------------------------------------------------------------

@pytest.mark.parametrize("height", [99.5, 150.0, -1.0, float("nan")])
def test_ec1_heights_outside_the_grid_are_refused_not_extrapolated(height):
    with pytest.raises(ValueError):
        ops.layer_at_height(linear_in_z(), Z, height)


def test_ec2_both_bracketing_cells_solid_is_nan_not_zero():
    c = linear_in_z()
    solid = np.zeros(c.shape, dtype=bool)
    solid[:10, 2, 3] = True  # a building 20 m tall on cell (2, 3)

    plane = ops.layer_at_height(c, Z, 6.0, solid)

    assert np.isnan(plane[2, 3])
    assert np.isfinite(np.delete(plane.ravel(), 2 * 6 + 3)).all()


# --- AC-2 / EC-4: exceedance volume ----------------------------------------

def test_ac2_exceedance_volume_of_a_known_cube():
    c = np.zeros((10, 10, 10))
    c[2:5, 3:6, 4:7] = 100.0  # 3 x 3 x 3 cells above the threshold

    assert ops.exceedance_volume(c, None, 45.0, DX, DY, DZ) == pytest.approx(27 * DX * DY * DZ)


def test_ac2_solid_cells_inside_the_cube_are_never_counted():
    c = np.zeros((10, 10, 10))
    c[2:5, 3:6, 4:7] = 100.0
    solid = np.zeros(c.shape, dtype=bool)
    solid[3, 4, 5] = True  # the cube's centre is a building

    assert ops.exceedance_volume(c, solid, 45.0, DX, DY, DZ) == pytest.approx(26 * DX * DY * DZ)


def test_ac2_by_layer_sums_to_the_total_and_sits_in_the_right_layers():
    c = np.zeros((10, 10, 10))
    c[2:5, 3:6, 4:7] = 100.0

    per_layer = ops.exceedance_volume_by_layer(c, None, 45.0, DX, DY, DZ)

    assert per_layer.sum() == pytest.approx(ops.exceedance_volume(c, None, 45.0, DX, DY, DZ))
    assert np.nonzero(per_layer)[0].tolist() == [2, 3, 4]


def test_ec4_threshold_above_the_maximum_gives_zero():
    c = np.full((5, 5, 5), 10.0)

    assert ops.exceedance_volume(c, None, 1e9, DX, DY, DZ) == 0.0


def test_exceedance_is_strictly_greater_than():
    c = np.full((2, 2, 2), 45.0)

    assert ops.exceedance_volume(c, None, 45.0, DX, DY, DZ) == 0.0


# --- AC-3: facade exposure by floor ---------------------------------------

def test_ac3_single_box_building_facade_and_floors():
    nz, ny, nx = 50, 12, 12
    solid = np.zeros((nz, ny, nx), dtype=bool)
    # 4 x 3 footprint, 9 m tall: centres 1, 3, 5, 7 < 9 are solid
    solid[Z < 9.0, 4:7, 3:7] = True
    c = np.broadcast_to(Z[:, None, None], (nz, ny, nx)).copy()

    exposure = ops.facade_exposure_by_floor(c, solid, Z, 3.0)

    perimeter = 2 * 4 + 2 * 3  # 4-neighbour ring around a 4 x 3 block, no corners
    solid_layers = int((Z < 9.0).sum())
    assert exposure.cells.sum() == perimeter * solid_layers
    # floors: z = 1 -> 0, 3 and 5 -> 1, 7 -> 2
    assert exposure.floor.tolist() == [0, 1, 2]
    assert exposure.cells.tolist() == [perimeter, 2 * perimeter, perimeter]
    np.testing.assert_allclose(exposure.mean, [1.0, 4.0, 7.0])


def test_ac3_air_above_a_roof_is_not_facade():
    solid = np.zeros((4, 5, 5), dtype=bool)
    solid[0, 2, 2] = True

    facade = ops.facade_mask(solid)

    assert not facade[1, 2, 2]
    assert facade[0].sum() == 4


# --- AC-4: vertical profile ------------------------------------------------

def test_ac4_profile_returns_the_column_of_the_containing_cell():
    rng = np.random.default_rng(1)
    c = rng.random((50, 4, 6))
    x = 1000.0 + DX * (np.arange(6) + 0.5)
    y = 2000.0 + DY * (np.arange(4) + 0.5)

    column = ops.vertical_profile(c, x, y, x_m=x[4] + 2.0, y_m=y[1] - 2.4)

    np.testing.assert_array_equal(column, c[:, 1, 4])


def test_ac4_profile_outside_the_grid_is_refused():
    x = np.arange(6) * DX + DX / 2
    y = np.arange(4) * DY + DY / 2

    with pytest.raises(ValueError):
        ops.vertical_profile(np.zeros((50, 4, 6)), x, y, x_m=-1.0, y_m=5.0)


# --- layer means / difference ---------------------------------------------

def test_layer_means_ignore_solids_and_report_nan_for_all_solid_layers():
    c = np.ones((3, 2, 2))
    c[0, 0, 0] = 9.0
    solid = np.zeros(c.shape, dtype=bool)
    solid[0, 0, 0] = True
    solid[2] = True

    means = ops.layer_means(c, solid)

    assert means[0] == pytest.approx(1.0)
    assert means[1] == pytest.approx(1.0)
    assert np.isnan(means[2])


def test_difference_map_propagates_nan():
    a = np.array([[[1.0, np.nan]]])
    b = np.array([[[0.5, 2.0]]])

    diff = ops.difference_map(a, b)

    assert diff[0, 0, 0] == 0.5 and np.isnan(diff[0, 0, 1])
