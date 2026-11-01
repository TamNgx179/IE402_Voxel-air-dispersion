"""B8.1 - independent checks of region statistics and run comparison.

Part 1 checks the reference itself against hand calculations and shapely.
Part 2 recomputes the values A asserts in app/test/spatial-analysis.e2e-spec.ts
from the raw fixture inputs and compares them numerically.
"""

from __future__ import annotations

import json
import math
import random
from pathlib import Path

import numpy as np
import pytest

from src.analysis.region_reference import (
    Grid,
    IncompatibleRunsError,
    RunField,
    check_compatible,
    columns_to_field,
    compare_layer,
    polygon_area,
    polygon_rect_area,
    rect,
    region_stats,
    solid_from_ranges,
    z_overlap,
)

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "b8_1_a8_e2e_fixture.json").read_text("utf-8"))

# Small synthetic grid used in part 1: 3 x 2 columns of 10 m x 10 m, 3 layers of 2 m.
G = Grid(0.0, 0.0, 10.0, 10.0, 2.0, nx=3, ny=2, nz=3)


def make_run(values, solid=None, run_id="r", **meta) -> RunField:
    values = np.asarray(values, dtype=float)
    solid = np.zeros(values.shape, bool) if solid is None else np.asarray(solid, bool)
    return RunField(run_id, G, values, solid, **meta)


def uniform(c: float) -> np.ndarray:
    return np.full((G.nz, G.ny, G.nx), c)


# --------------------------------------------------------------------------
# Part 1 - geometry
# --------------------------------------------------------------------------

def test_rect_clip_full_partial_and_disjoint():
    assert polygon_rect_area([rect(-5, -5, 50, 50)], 0, 0, 10, 10) == pytest.approx(100.0)
    assert polygon_rect_area([rect(5, 2, 15, 6)], 0, 0, 10, 10) == pytest.approx(20.0)
    assert polygon_rect_area([rect(20, 20, 30, 30)], 0, 0, 10, 10) == 0.0
    # Touching an edge only contributes zero area.
    assert polygon_rect_area([rect(10, 0, 20, 10)], 0, 0, 10, 10) == pytest.approx(0.0)


def test_clip_handles_triangle_and_hole():
    tri = [(0, 0), (10, 0), (0, 10), (0, 0)]
    assert polygon_rect_area([tri], 0, 0, 10, 10) == pytest.approx(50.0)
    assert polygon_rect_area([tri], 0, 0, 5, 5) == pytest.approx(25.0)
    with_hole = [rect(0, 0, 10, 10), rect(2, 2, 4, 4)]
    assert polygon_area(with_hole) == pytest.approx(96.0)
    assert polygon_rect_area(with_hole, 0, 0, 3, 3) == pytest.approx(9.0 - 1.0)


def test_clip_matches_shapely_on_random_nonconvex_polygons():
    shapely = pytest.importorskip("shapely")
    from shapely.geometry import Polygon, box

    rng = random.Random(402)
    checked = 0
    for _ in range(300):
        n = rng.randint(3, 12)
        angles = sorted(rng.uniform(0, 2 * math.pi) for _ in range(n))
        ring = [(15 + rng.uniform(2, 14) * math.cos(a), 10 + rng.uniform(2, 14) * math.sin(a)) for a in angles]
        ring.append(ring[0])
        poly = Polygon(ring)
        if not poly.is_valid:
            continue
        for j in range(G.ny):
            for i in range(G.nx):
                b = G.cell_bounds(i, j)
                assert polygon_rect_area([ring], *b) == pytest.approx(poly.intersection(box(*b)).area, abs=1e-9)
        checked += 1
    assert checked > 200
    assert shapely.__version__


def test_z_overlap_half_open_layers():
    assert z_overlap(0, 2.0, 0.0, 2.0) == 2.0
    assert z_overlap(1, 2.0, 0.0, 2.0) == 0.0  # 2 m belongs to layer 1 but adds no thickness
    assert z_overlap(0, 2.0, 1.0, 3.0) == 1.0
    assert z_overlap(1, 2.0, 1.0, 3.0) == 1.0
    assert z_overlap(1, 2.0, 2.5, 3.0) == 0.5
    assert G.layer_of(2.0) == 1 and G.layer_of(1.999) == 0
    with pytest.raises(ValueError):
        G.layer_of(G.nz * G.dz_m)  # top of domain is outside (half-open)


# --------------------------------------------------------------------------
# Part 1 - region statistics (BR-44)
# --------------------------------------------------------------------------

def test_full_cells_volume_and_mean():
    c = uniform(0.0)
    c[0, 0, 0], c[0, 0, 1] = 4.0, 8.0
    r = region_stats(make_run(c), [rect(0, 0, 20, 10)], 0.0, 2.0)
    assert r.air_volume_m3 == pytest.approx(400.0)
    assert r.mean_ug_m3 == pytest.approx(6.0)
    assert r.max_ug_m3 == 8.0
    assert r.air_voxels == 2


def test_partial_xy_cell_weighted_by_intersection_area():
    c = uniform(0.0)
    c[0, 0, 0], c[0, 0, 1] = 4.0, 8.0
    # 100 m2 of cell (0,0) and 25 m2 of cell (1,0).
    r = region_stats(make_run(c), [rect(0, 0, 12.5, 10)], 0.0, 2.0)
    assert r.air_volume_m3 == pytest.approx(250.0)
    assert r.mean_ug_m3 == pytest.approx((4 * 200 + 8 * 50) / 250)
    # The unweighted cell mean (6.0) would be wrong.
    assert r.mean_ug_m3 != pytest.approx(6.0)


def test_partial_z_overlap_weighting_and_totals_not_mean_of_means():
    c = uniform(0.0)
    c[0, 0, 0], c[1, 0, 0], c[2, 0, 0] = 10.0, 4.0, 1.0
    # z in [1.5, 4.5]: thickness 0.5 in k0, 2 in k1, 0.5 in k2.
    r = region_stats(make_run(c), [rect(0, 0, 10, 10)], 1.5, 4.5)
    assert [l.air_volume_m3 for l in r.layers] == pytest.approx([50.0, 200.0, 50.0])
    assert r.mean_ug_m3 == pytest.approx((10 * 50 + 4 * 200 + 1 * 50) / 300)
    mean_of_means = sum(l.mean_ug_m3 for l in r.layers) / 3
    assert r.mean_ug_m3 != pytest.approx(mean_of_means)


def test_solid_cells_excluded_from_numerator_and_denominator():
    c = uniform(1.0)
    solid = np.zeros_like(c, bool)
    solid[0, 0, 0] = True
    c[0, 0, 0] = 999.0  # a value under a solid voxel must not leak in
    r = region_stats(make_run(c, solid), [rect(0, 0, 20, 10)], 0.0, 2.0)
    assert r.air_volume_m3 == pytest.approx(200.0)
    assert r.solid_volume_m3 == pytest.approx(200.0)
    assert r.mean_ug_m3 == pytest.approx(1.0)
    assert r.max_ug_m3 == 1.0


def test_no_data_excluded_but_zero_is_valid_air():
    c = uniform(0.0)
    c[0, 0, 0] = np.nan
    c[0, 0, 1] = 6.0
    r = region_stats(make_run(c), [rect(0, 0, 30, 10)], 0.0, 2.0)
    # Cells: NaN (excluded), 6, 0 (kept).
    assert r.no_data_volume_m3 == pytest.approx(200.0)
    assert r.air_volume_m3 == pytest.approx(400.0)
    assert r.mean_ug_m3 == pytest.approx(3.0)
    zero = region_stats(make_run(uniform(0.0)), [rect(0, 0, 30, 10)], 0.0, 2.0)
    assert zero.mean_ug_m3 == 0.0 and zero.max_ug_m3 == 0.0 and zero.air_volume_m3 > 0


def test_all_solid_region_has_null_mean_max_and_zero_exceedance():
    c = uniform(50.0)
    r = region_stats(make_run(c, np.ones_like(c, bool)), [rect(0, 0, 30, 20)], 0.0, 6.0, threshold_ug_m3=1.0)
    assert r.air_volume_m3 == 0.0
    assert r.mean_ug_m3 is None and r.max_ug_m3 is None
    assert r.exceedance_volume_m3 == 0.0
    assert all(l.mean_ug_m3 is None for l in r.layers)


def test_exceedance_volume_uses_fractional_weights_and_strict_threshold():
    c = uniform(15.0)
    c[0, 0, 1] = 16.0
    r = region_stats(make_run(c), [rect(5, 0, 15, 10)], 0.0, 1.0, threshold_ug_m3=15.0)
    assert r.exceedance_volume_m3 == pytest.approx(50.0)  # only (1,0); 15 is not > 15


def test_float32_storage_is_respected():
    v = 0.0230344
    r = region_stats(make_run(uniform(v)), [rect(0, 0, 10, 10)], 0.0, 2.0)
    assert r.mean_ug_m3 == pytest.approx(float(np.float32(v)), rel=0, abs=1e-15)
    assert r.max_ug_m3 == float(np.float32(v))


def test_invalid_inputs_rejected():
    run = make_run(uniform(1.0))
    for lo, hi in [(-1, 2), (3, 3), (4, 2), (0, 6.5)]:
        with pytest.raises(ValueError):
            region_stats(run, [rect(0, 0, 10, 10)], lo, hi)
    with pytest.raises(ValueError):
        region_stats(run, [[(0, 0), (10, 0), (20, 0), (0, 0)]], 0, 2)


# --------------------------------------------------------------------------
# Part 1 - comparison (BR-45)
# --------------------------------------------------------------------------

def test_self_comparison_is_exactly_zero():
    c = np.random.default_rng(1).random((G.nz, G.ny, G.nx)) * 40
    run = make_run(c)
    res = compare_layer(run, run, 1.0)
    assert {cell.delta_ug_m3 for cell in res.cells} == {0.0}
    assert res.delta_mean_ug_m3 == 0.0 and res.delta_min_ug_m3 == 0.0 and res.delta_max_ug_m3 == 0.0


def test_delta_sign_is_comparison_minus_baseline():
    base = make_run(uniform(10.0), run_id="base")
    higher = make_run(uniform(12.0), run_id="cmp")
    assert compare_layer(base, higher, 0.5).delta_mean_ug_m3 == pytest.approx(2.0)
    assert compare_layer(higher, base, 0.5).delta_mean_ug_m3 == pytest.approx(-2.0)


def test_comparison_skips_solid_and_reports_empty_layer_as_null():
    solid = np.zeros((G.nz, G.ny, G.nx), bool)
    solid[0] = True
    a = make_run(uniform(1.0), solid)
    res = compare_layer(a, a, 1.0)
    assert res.air_cells == 0 and res.delta_mean_ug_m3 is None
    assert compare_layer(a, a, 2.0).air_cells == G.nx * G.ny


@pytest.mark.parametrize(
    "change",
    [
        {"study_area_id": "other"},
        {"crs": "EPSG:4326"},
        {"scene_version": "scene-v2"},
        {"model": "gaussian"},
    ],
)
def test_incompatible_metadata_rejected(change):
    base = make_run(uniform(1.0))
    other = make_run(uniform(1.0), **change)
    with pytest.raises(IncompatibleRunsError):
        compare_layer(base, other, 1.0)


def test_incompatible_grid_and_masks_rejected():
    base = make_run(uniform(1.0))
    g2 = Grid(0.0, 0.0, 5.0, 10.0, 2.0, nx=3, ny=2, nz=3)  # same shape, other spacing
    with pytest.raises(IncompatibleRunsError):
        check_compatible(base, RunField("x", g2, uniform(1.0), np.zeros((3, 2, 3), bool)))
    g3 = Grid(1.0, 0.0, 10.0, 10.0, 2.0, nx=3, ny=2, nz=3)  # shifted origin
    with pytest.raises(IncompatibleRunsError):
        check_compatible(base, RunField("x", g3, uniform(1.0), np.zeros((3, 2, 3), bool)))
    solid = np.zeros((3, 2, 3), bool)
    solid[0, 0, 0] = True
    with pytest.raises(IncompatibleRunsError):
        compare_layer(base, make_run(uniform(1.0), solid), 1.0)
    holed = uniform(1.0)
    holed[2, 1, 2] = np.nan
    with pytest.raises(IncompatibleRunsError):
        compare_layer(base, make_run(holed), 1.0)


# --------------------------------------------------------------------------
# Part 2 - recompute A's e2e expected values
# --------------------------------------------------------------------------

AG = Grid(**FIXTURE["grid"])
EXP = FIXTURE["a_expected"]


def a_columns(name: str):
    return {(n % 2, n // 2): col for n, col in enumerate(FIXTURE["runs"][name]["columns"])}


def scene_solid() -> np.ndarray:
    ranges = {
        tuple(int(v) for v in key.split(",")): (tuple(val) if val else None)
        for key, val in FIXTURE["scene_solid_ranges_inclusive"].items()
        if key != "source"
    }
    return solid_from_ranges(AG, ranges)


def a_run(name: str, mask: str = "null") -> RunField:
    """mask='null': solid := NULL (how A's API decides); mask='scene': grid_cells mask."""
    c = columns_to_field(AG, a_columns(name))
    solid = np.isnan(c) if mask == "null" else scene_solid()
    return RunField(name, AG, c, solid)


def env(x1, y1, x2, y2):
    return [rect(x1, y1, x2, y2)]


def test_a_comparison_values_match_reference():
    res = compare_layer(a_run("baseline"), a_run("comparison"), 1.0)
    e = EXP["comparison_z1"]
    assert (res.k, res.z_center_m) == (e["k"], e["z_center_m"])
    assert [c.delta_ug_m3 for c in res.cells] == e["deltas"]
    assert res.delta_mean_ug_m3 == pytest.approx(e["delta_mean"], abs=1e-10)
    top = compare_layer(a_run("baseline"), a_run("comparison"), 2.1)
    assert (top.k, top.z_center_m) == (EXP["comparison_z2_1"]["k"], EXP["comparison_z2_1"]["z_center_m"])


def test_a_self_zero_and_all_solid_comparisons_match_reference():
    s = compare_layer(a_run("baseline"), a_run("baseline"), 1.0)
    assert (s.delta_mean_ug_m3, s.delta_min_ug_m3, s.delta_max_ug_m3) == (0, 0, 0)
    z = compare_layer(a_run("zero"), a_run("zero"), 1.0)
    assert z.air_cells == EXP["zero_comparison"]["air_cells"] and z.baseline_mean_ug_m3 == 0
    sol = compare_layer(a_run("solid_k0"), a_run("solid_k0"), 1.0)
    assert sol.air_cells == 0 and sol.delta_mean_ug_m3 is None


def test_a_float32_expectation_matches_reference():
    e = EXP["float32_exact"]
    a = RunField("a", AG, np.full((4, 2, 2), e["baseline"]), np.zeros((4, 2, 2), bool))
    b = RunField("b", AG, np.full((4, 2, 2), e["comparison"]), np.zeros((4, 2, 2), bool))
    cell = compare_layer(a, b, 1.0).cells[0]
    assert cell.baseline_ug_m3 == float(np.float32(e["baseline"]))
    assert cell.delta_ug_m3 == float(np.float32(e["comparison"])) - float(np.float32(e["baseline"]))


def test_a_region_partial_cell_values_match_reference():
    e = EXP["region_partial"]
    r = region_stats(a_run("baseline"), env(*e["polygon_utm"]), *e["z"], threshold_ug_m3=e["threshold"])
    assert r.area_m2 == pytest.approx(e["area_m2"], abs=1e-9)
    assert r.air_volume_m3 == pytest.approx(e["air_volume_m3"], abs=1e-9)
    assert r.mean_ug_m3 == pytest.approx(e["mean"], abs=1e-12)
    assert r.max_ug_m3 == e["max"]
    assert r.exceedance_volume_m3 == e["exceedance_volume_m3"]
    assert len(r.layers) == e["n_layers"] and r.layers[0].mean_ug_m3 == e["layer0_mean"]
    r7 = region_stats(a_run("baseline"), env(*e["polygon_utm"]), *e["z"], threshold_ug_m3=EXP["region_threshold7"]["threshold"])
    assert r7.exceedance_volume_m3 == pytest.approx(EXP["region_threshold7"]["exceedance_volume_m3"], abs=1e-9)


def test_a_region_no_air_and_zero_air_match_reference():
    e = EXP["region_no_air"]
    z = EXP["region_partial"]["z"]
    r = region_stats(a_run("baseline"), env(*e["polygon_utm"]), *z)
    assert (r.air_volume_m3, r.mean_ug_m3, r.max_ug_m3, r.exceedance_volume_m3) == (0.0, None, None, 0.0)
    # A returns layers=[] for no air; the reference keeps the k rows with null mean.
    assert all(l.air_volume_m3 == 0 for l in r.layers)
    r0 = region_stats(a_run("zero"), env(*e["polygon_utm"]), *z)
    assert r0.mean_ug_m3 == EXP["region_zero_air"]["mean"]
    assert r0.air_volume_m3 == pytest.approx(EXP["region_zero_air"]["air_volume_m3"], abs=1e-9)


def test_a_region_hole_matches_reference():
    e = EXP["region_hole"]
    poly = [rect(*e["outer_utm"]), rect(*e["hole_utm"])]
    r = region_stats(a_run("baseline"), poly, *e["z"])
    assert r.air_volume_m3 == pytest.approx(e["air_volume_m3"], abs=1e-6)  # 686000.1 is not exact in binary


def test_wgs84_round_trip_of_fixture_polygon_is_within_a_tolerance():
    """A's e2e sends the UTM envelope through EPSG:4326 (15 digits) and back."""
    pyproj = pytest.importorskip("pyproj")
    fwd = pyproj.Transformer.from_crs(32648, 4326, always_xy=True)
    inv = pyproj.Transformer.from_crs(4326, 32648, always_xy=True)
    ring = rect(*EXP["region_partial"]["polygon_utm"])
    back = []
    for x, y in ring:
        lon, lat = fwd.transform(x, y)
        back.append(inv.transform(round(lon, 15), round(lat, 15)))
    r = region_stats(a_run("baseline"), [back], *EXP["region_partial"]["z"])
    assert r.area_m2 == pytest.approx(28.0, abs=1e-5)  # toBeCloseTo(28, 5)
    assert r.mean_ug_m3 == pytest.approx(7.5, abs=1e-5)


# --------------------------------------------------------------------------
# Part 2 - findings about the fixture itself (documented, not hidden)
# --------------------------------------------------------------------------

def test_finding_a_fixture_values_contradict_scene_solid_mask():
    """A's runs store values in voxels the scene marks solid.

    grid_cells.csv says (0,0) is solid for k=0..2 and (1,1) for k=0..3, but the
    baseline run has 5 at (0,0,k=2) and 30/15/8/4 in column (1,1). The API only
    derives "solid" from NULL, so these are treated as air.
    """
    leaked = a_run("baseline", mask="scene").solid_with_value()
    assert sorted(zip(*np.nonzero(leaked))) == [(0, 1, 1), (1, 1, 1), (2, 0, 0), (2, 1, 1), (3, 1, 1)]


def test_finding_scene_mask_changes_two_a_expectations():
    base_scene, cmp_scene = a_run("baseline", "scene"), a_run("comparison", "scene")
    res = compare_layer(base_scene, cmp_scene, 1.0)
    assert [c.delta_ug_m3 for c in res.cells] == [2, -2]  # A expects [2, -2, 3]
    e = EXP["region_hole"]
    hole = region_stats(base_scene, [rect(*e["outer_utm"]), rect(*e["hole_utm"])], *e["z"])
    assert hole.air_volume_m3 == pytest.approx((2 * 4.9 * 4.9 - 9) * 2)  # A expects 126.06
    # The partial-cell case is unaffected because (0,0) k0..1 is solid in both views.
    e = EXP["region_partial"]
    assert region_stats(base_scene, env(*e["polygon_utm"]), *e["z"]).mean_ug_m3 == pytest.approx(7.5)
