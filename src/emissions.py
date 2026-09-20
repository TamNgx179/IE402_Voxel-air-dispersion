"""Emission source terms on a voxel grid."""

from __future__ import annotations

import numpy as np


def build_source_term(shape: tuple[int, int, int], sources: list[dict]) -> np.ndarray:
    """Return S[z, y, x] assembled from point or voxel source records."""
    source = np.zeros(shape, dtype=float)
    for item in sources:
        z, y, x = (int(value) for value in item["index"])
        source[z, y, x] += float(item["rate"])
    return source
