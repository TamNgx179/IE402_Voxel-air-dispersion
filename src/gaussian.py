"""Gaussian plume baseline used for verification and comparison."""

from __future__ import annotations

import numpy as np


def gaussian_plume(
    x: np.ndarray,
    y: np.ndarray,
    z: np.ndarray,
    emission_rate: float,
    wind_speed: float,
    sigma_y: float,
    sigma_z: float,
    height: float = 0.0,
) -> np.ndarray:
    """Evaluate a steady Gaussian plume concentration field."""
    downwind = np.maximum(np.asarray(x, dtype=float), 1e-12)
    crosswind = np.asarray(y, dtype=float)
    altitude = np.asarray(z, dtype=float)
    return (
        emission_rate
        / (2.0 * np.pi * wind_speed * sigma_y * sigma_z)
        * np.exp(-(crosswind**2) / (2.0 * sigma_y**2))
        * (
            np.exp(-((altitude - height) ** 2) / (2.0 * sigma_z**2))
            + np.exp(-((altitude + height) ** 2) / (2.0 * sigma_z**2))
        )
        / downwind
    )
