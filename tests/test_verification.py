"""Verification tests for numerical building blocks."""

import numpy as np

from src.emissions import build_source_term
from src.gaussian import gaussian_plume


def test_source_term_places_rate_in_requested_voxel() -> None:
    source = build_source_term((2, 3, 4), [{"index": (1, 2, 3), "rate": 7.5}])
    assert source[1, 2, 3] == 7.5
    assert np.count_nonzero(source) == 1


def test_gaussian_plume_is_finite_downwind() -> None:
    concentration = gaussian_plume(
        np.array([10.0]), np.array([0.0]), np.array([0.0]), 1.0, 2.0, 1.0, 1.0
    )
    assert np.isfinite(concentration).all()
    assert concentration[0] > 0
