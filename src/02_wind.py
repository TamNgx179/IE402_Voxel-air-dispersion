"""Wind-field preparation and mass-consistent pressure correction."""

from __future__ import annotations

import numpy as np


def divergence(u: np.ndarray, v: np.ndarray, w: np.ndarray, spacing: float = 1.0) -> np.ndarray:
    """Compute cell-centered divergence for a Cartesian velocity field."""
    gradients = [np.gradient(component, spacing, edge_order=1) for component in (u, v, w)]
    return gradients[0][2] + gradients[1][1] + gradients[2][0]


def sor_poisson(rhs: np.ndarray, omega: float = 1.7, tolerance: float = 1e-6, max_iter: int = 10000) -> np.ndarray:
    """Solve a 3D Poisson problem with a simple SOR iteration."""
    raise NotImplementedError("Implement boundary conditions for the selected voxel domain")
