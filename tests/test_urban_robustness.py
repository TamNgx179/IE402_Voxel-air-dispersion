"""Regression checks for the scientific study's remapping and GIS weights."""
import runpy

import numpy as np
from shapely.geometry import LineString, box

from src.analysis.corridor_reference import integrate

study = runpy.run_path("scripts/study-urban-robustness.py")


def test_horizontal_remap_preserves_release_and_uses_shared_air():
    source = np.zeros((2, 4, 4))
    source[0] = 1
    masks = {10: np.zeros((2, 2, 2), bool), 5: np.zeros(source.shape, bool),
             2.5: np.zeros((2, 8, 8), bool)}
    masks[2.5][0, 1, 1] = True
    remapped, retained = study["source_at_grids"](source, masks)
    assert retained == .75
    for h, values in remapped.items():
        assert not np.any(values[masks[h]])
        np.testing.assert_allclose(values.sum() * h**2, source.sum() * 25)


def test_vectorized_road_weights_match_independent_integrator_with_solids():
    grid = dict(origin_x_m=0, origin_y_m=0, dx_m=5, dy_m=5, dz_m=2,
                nx=20, ny=20, nz=16)
    domain = box(0, 0, 100, 100)
    route = [LineString([(30, 50), (70, 50)])]
    weights = study["corridor_weights"](grid, domain, {"sample": route},
                                        [{"road_id": "sample"}])
    solid = np.zeros((16, 20, 20), dtype=bool)
    solid[0:3, 10, 10:15] = True
    concentration = np.arange(solid.size).reshape(solid.shape) * 1e-12
    rows = study["read_statistics"](concentration, solid, weights, "example")
    for low, high in ((1, 15), (15, 31)):
        expected = integrate(route, domain, grid, concentration * 1e9, solid,
                             [10, 25, 50], low, high, .15)
        selected = [row for row in rows if row["z_low_m"] == low]
        for actual, reference in zip(selected, expected, strict=True):
            for name in ("air_volume_m3", "mean_ug_m3"):
                np.testing.assert_allclose(actual[name], reference[name], rtol=1e-12)
