"""Convert GIS/building inputs into a regular voxel grid."""

from pathlib import Path
from typing import Any


def voxelize(input_path: str | Path, output_path: str | Path, resolution: float = 5.0) -> Any:
    """Create a voxel dataset from GIS input.

    The concrete GIS reader is intentionally left configurable for the case study.
    """
    raise NotImplementedError("Connect a GIS reader and voxel writer for the study area")


if __name__ == "__main__":
    print("Voxelization module ready. Provide GIS input and output paths.")
