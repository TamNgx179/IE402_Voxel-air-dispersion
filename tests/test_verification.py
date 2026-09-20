from __future__ import annotations

import sys
from pathlib import Path

import geopandas as gpd
import numpy as np

from shapely.geometry import box


REPO_ROOT = (
    Path(__file__)
    .resolve()
    .parents[1]
)

SRC_DIR = (
    REPO_ROOT
    / "src"
)

if str(
    SRC_DIR
) not in sys.path:

    sys.path.insert(
        0,
        str(
            SRC_DIR
        ),
    )


from voxel.heights import (  # noqa: E402
    parse_direct_height,
    parse_level_count,
    resolve_building_heights,
)

from voxel.models import (  # noqa: E402
    GridDefinition,
    HeightSettings,
    RasterSettings,
)

from voxel.rasterizer import (  # noqa: E402
    extrude_building_mask,
    rasterize_height_field,
)


def test_grid_definition_uses_zyx_order() -> None:
    """
    Verify the project's canonical dimension order.
    """

    grid = GridDefinition(
        min_x=0.0,
        min_y=0.0,
        max_x=20.0,
        max_y=15.0,
        z_min_m=0.0,
        z_max_m=10.0,
        dx_m=5.0,
        dy_m=5.0,
        dz_m=2.0,
    )

    assert grid.nx == 4

    assert grid.ny == 3

    assert grid.nz == 5

    assert grid.shape_yx == (
        3,
        4,
    )

    assert grid.shape_zyx == (
        5,
        3,
        4,
    )

    assert grid.total_voxels == 60


def test_grid_cell_centres_are_correct() -> None:
    """
    Cell coordinates must represent voxel centres,
    not voxel boundaries.
    """

    grid = GridDefinition(
        min_x=100.0,
        min_y=200.0,
        max_x=120.0,
        max_y=220.0,
        z_min_m=0.0,
        z_max_m=8.0,
        dx_m=5.0,
        dy_m=5.0,
        dz_m=2.0,
    )

    np.testing.assert_allclose(
        grid.x_centers(),
        [
            102.5,
            107.5,
            112.5,
            117.5,
        ],
    )

    np.testing.assert_allclose(
        grid.y_centers(),
        [
            202.5,
            207.5,
            212.5,
            217.5,
        ],
    )

    np.testing.assert_allclose(
        grid.z_centers(),
        [
            1.0,
            3.0,
            5.0,
            7.0,
        ],
    )


def test_grid_rejects_non_divisible_domain() -> None:
    """
    GridDefinition must not silently round the number of cells.
    """

    grid = GridDefinition(
        min_x=0.0,
        min_y=0.0,
        max_x=21.0,
        max_y=20.0,
        z_min_m=0.0,
        z_max_m=10.0,
        dx_m=5.0,
        dy_m=5.0,
        dz_m=2.0,
    )

    try:

        _ = grid.nx

    except ValueError:

        return

    raise AssertionError(
        "GridDefinition should reject a domain "
        "that is not divisible by grid spacing."
    )


def test_direct_height_parser() -> None:
    """
    Direct-height parser should accept unambiguous metre values.
    """

    assert (
        parse_direct_height(
            12
        )
        == 12.0
    )

    assert (
        parse_direct_height(
            "12.5"
        )
        == 12.5
    )

    assert (
        parse_direct_height(
            "12,5 m"
        )
        == 12.5
    )


def test_direct_height_parser_rejects_ambiguous_values() -> None:
    """
    Ambiguous or non-metre values must not be guessed.
    """

    assert (
        parse_direct_height(
            "10-12"
        )
        is None
    )

    assert (
        parse_direct_height(
            "12;15"
        )
        is None
    )

    assert (
        parse_direct_height(
            "40 ft"
        )
        is None
    )

    assert (
        parse_direct_height(
            "unknown"
        )
        is None
    )


def test_level_parser() -> None:
    """
    Level count parser should only accept plain numeric quantities.
    """

    assert (
        parse_level_count(
            3
        )
        == 3.0
    )

    assert (
        parse_level_count(
            "4"
        )
        == 4.0
    )

    assert (
        parse_level_count(
            "3 levels"
        )
        is None
    )


def test_height_resolution_priority() -> None:
    """
    Direct height must take priority over level-derived height.
    """

    buildings = gpd.GeoDataFrame(
        {
            "height": [
                "12 m",
                None,
            ],
            "building:levels": [
                "9",
                "4",
            ],
        },
        geometry=[
            box(
                0,
                0,
                5,
                5,
            ),
            box(
                5,
                0,
                10,
                5,
            ),
        ],
        crs="EPSG:32648",
    )

    settings = HeightSettings(
        direct_fields=(
            "height",
        ),
        levels_fields=(
            "building:levels",
        ),
        meters_per_level=3.0,
        fallback_mode="error",
        fallback_height_m=None,
        minimum_height_m=0.0,
        maximum_height_m=None,
    )

    resolved = resolve_building_heights(
        buildings=buildings,
        settings=settings,
    )

    np.testing.assert_allclose(
        resolved[
            "resolved_height_m"
        ],
        [
            12.0,
            12.0,
        ],
    )

    assert (
        resolved.loc[
            0,
            "height_source",
        ]
        == "direct:height"
    )

    assert (
        resolved.loc[
            1,
            "height_source",
        ]
        == "levels:building:levels"
    )


def test_rasterization_and_extrusion() -> None:
    """
    Verify the complete polygon -> H -> B conversion
    on a tiny synthetic domain.

    Domain
    ------
    20 m x 20 m

    Horizontal resolution
    ---------------------
    5 m

    Therefore H is 4 x 4.

    One 10 m x 10 m building occupies exactly four
    horizontal cells.

    Building height
    ---------------
    6 m

    With dz=2 m, vertical centres are:

        1, 3, 5, 7, 9

    Therefore the building occupies exactly three vertical layers.
    """

    grid = GridDefinition(
        min_x=0.0,
        min_y=0.0,
        max_x=20.0,
        max_y=20.0,
        z_min_m=0.0,
        z_max_m=10.0,
        dx_m=5.0,
        dy_m=5.0,
        dz_m=2.0,
    )

    buildings = gpd.GeoDataFrame(
        {
            "resolved_height_m": [
                6.0,
            ],
        },
        geometry=[
            box(
                5.0,
                5.0,
                15.0,
                15.0,
            ),
        ],
        crs="EPSG:32648",
    )

    raster_settings = RasterSettings(
        all_touched=False,
        overlap_rule="maximum_height",
    )

    height_field = rasterize_height_field(
        buildings=buildings,
        grid=grid,
        settings=raster_settings,
        dtype="float32",
    )

    assert height_field.shape == (
        4,
        4,
    )

    assert int(
        np.count_nonzero(
            height_field
        )
    ) == 4

    np.testing.assert_allclose(
        height_field[
            1:3,
            1:3,
        ],
        6.0,
    )

    building_mask = extrude_building_mask(
        height_field=height_field,
        grid=grid,
        dtype="uint8",
    )

    assert building_mask.shape == (
        5,
        4,
        4,
    )

    assert set(
        np.unique(
            building_mask
        )
    ) == {
        0,
        1,
    }

    # Four horizontal cells × three vertical levels.
    assert int(
        building_mask.sum()
    ) == 12

    np.testing.assert_array_equal(
        building_mask[
            0:3,
            1:3,
            1:3,
        ],
        np.ones(
            (
                3,
                2,
                2,
            ),
            dtype=np.uint8,
        ),
    )

    np.testing.assert_array_equal(
        building_mask[
            3:,
            1:3,
            1:3,
        ],
        np.zeros(
            (
                2,
                2,
                2,
            ),
            dtype=np.uint8,
        ),
    )