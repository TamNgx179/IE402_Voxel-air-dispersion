"""Verified demo fixtures shared by tests, independent of local research caches."""

import pytest

from src.demo_bundle import ROOT, inspect_bundle


@pytest.fixture(scope="session")
def packaged_voxel_path(tmp_path_factory):
    # Verification checks the scene hash, archive members and member digests first.
    _, files = inspect_bundle(ROOT / "deploy/demo-inputs")
    path = tmp_path_factory.mktemp("packaged-voxel") / "voxel_grid.nc"
    path.write_bytes(files["voxel_grid.nc"])
    return path
