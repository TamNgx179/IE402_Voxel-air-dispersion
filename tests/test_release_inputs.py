from __future__ import annotations

import json

import numpy as np

from src.release_inputs import build_release_datasets


def test_frozen_scene_rebuilds_voxel_and_normalized_road_source() -> None:
    voxel, source, diagnostics = build_release_datasets(
        "db/seeds/scene", emission_factor_g_per_vehicle_km=0.053
    )

    assert voxel["B"].shape == (50, 100, 100)
    assert json.loads(voxel.attrs["height_source_counts_json"])["gob:building_height"] > 0
    assert source["S"].dims == ("z", "y", "x")
    assert source["S"].attrs["units"] == "1"
    np.testing.assert_allclose(float(source["S"].sum()), 1.0, rtol=2e-6, atol=2e-6)
    assert not np.any(source["S"].values[voxel["B"].values])
    assert diagnostics.road_features == 67
    assert diagnostics.source_cells > 0
    assert diagnostics.proxy_retained > 0.0
