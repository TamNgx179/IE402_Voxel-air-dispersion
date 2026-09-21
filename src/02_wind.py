"""
Wind-field preparation and mass-consistent pressure correction.

CONVENTION WARNING, unresolved. This module orders its components
(u, v, w) = (x, y, z), while 03_transport.py takes (w, v, u) to match the
[z, y, x] array order. Whoever implements sor_poisson should settle on one
and change the other, before the two are ever wired together.
"""

from __future__ import annotations

import numpy as np


def divergence(u: np.ndarray, v: np.ndarray, w: np.ndarray, spacing: float = 1.0) -> np.ndarray:
    """
    Cell-centred divergence of a Cartesian velocity field.

    Arrays are [z, y, x]; u, v, w are the x, y, z components in that order.
    An axis one cell thick contributes nothing, which is what makes a 2D
    x-z slice work.
    """
    total = np.zeros(u.shape, dtype=float)

    for component, axis in ((u, 2), (v, 1), (w, 0)):
        if component.shape[axis] >= 2:
            total = total + np.gradient(component, spacing, axis=axis, edge_order=1)

    return total


def sor_poisson(rhs: np.ndarray, omega: float = 1.7, tolerance: float = 1e-6, max_iter: int = 10000) -> np.ndarray:
    """Solve a 3D Poisson problem with a simple SOR iteration."""
    raise NotImplementedError("Implement boundary conditions for the selected voxel domain")
