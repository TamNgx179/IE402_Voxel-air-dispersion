"""Report figures for voxel concentration fields."""

from pathlib import Path

import numpy as np


def save_midplane(concentration: np.ndarray, output_path: str | Path, axis: int = 0) -> None:
    """Save a mid-plane image using matplotlib."""
    import matplotlib.pyplot as plt

    plane = np.take(concentration, concentration.shape[axis] // 2, axis=axis)
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    plt.imsave(output_path, plane, cmap="magma")
