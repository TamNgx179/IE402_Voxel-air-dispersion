"""Finite-volume advection-diffusion transport on a voxel grid."""

from __future__ import annotations

import numpy as np


def transport_step(
    concentration: np.ndarray,
    velocity: tuple[np.ndarray, np.ndarray, np.ndarray],
    source: np.ndarray,
    diffusivity: float,
    dt: float,
    spacing: float = 1.0,
) -> np.ndarray:
    """Advance concentration by one explicit finite-volume time step."""
    if concentration.shape != source.shape:
        raise ValueError("concentration and source must have the same shape")
    gradients = np.gradient(concentration, spacing, edge_order=1)
    laplacian = sum(np.gradient(gradient, spacing, axis=axis, edge_order=1) for axis, gradient in enumerate(gradients))
    advection = sum(component * gradient for component, gradient in zip(velocity, gradients))
    return concentration + dt * (diffusivity * laplacian - advection + source)
