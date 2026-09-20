from __future__ import annotations

import logging
from typing import Any

import geopandas as gpd
import numpy as np

from rasterio.features import rasterize
from rasterio.transform import from_origin

from project_config import (
    ConfigError,
    get_required,
)

from voxel.models import (
    GridDefinition,
    RasterSettings,
)


LOGGER = logging.getLogger(
    __name__
)


SUPPORTED_OVERLAP_RULES = {
    "maximum_height",
}


def read_raster_settings(
    config: dict[str, Any],
) -> RasterSettings:
    """
    Read and validate building-rasterization settings.

    All behaviour is controlled by project configuration.

    No project-specific rasterization parameter is defined
    directly in this module.
    """

    all_touched = get_required(
        config,
        "voxelization.rasterization.all_touched",
    )

    if not isinstance(
        all_touched,
        bool,
    ):
        raise ConfigError(
            "voxelization.rasterization.all_touched "
            "must be true or false."
        )

    overlap_rule = str(
        get_required(
            config,
            "voxelization.rasterization.overlap_rule",
        )
    ).strip().lower()

    if (
        overlap_rule
        not in SUPPORTED_OVERLAP_RULES
    ):
        raise ConfigError(
            "Unsupported rasterization overlap rule: "
            f"{overlap_rule!r}. "
            "Supported rules are: "
            f"{sorted(SUPPORTED_OVERLAP_RULES)}"
        )

    return RasterSettings(
        all_touched=all_touched,
        overlap_rule=overlap_rule,
    )


def rasterize_height_field(
    buildings: gpd.GeoDataFrame,
    grid: GridDefinition,
    settings: RasterSettings,
    *,
    dtype: str,
) -> np.ndarray:
    """
    Convert building polygons into the 2D building-height field H.

    Output convention
    -----------------
    H[y, x]

    Shape
    -----
    (ny, nx)

    Coordinate convention
    ---------------------
    Array index y increases from south to north.

    This convention is intentionally different from the internal
    north-to-south row convention normally used by raster files.

    Overlapping buildings
    ---------------------
    When overlap_rule == "maximum_height", polygons are rasterized
    from shortest to tallest.

    Rasterio's replacement behaviour therefore leaves the tallest
    value in any overlapping cell.

    Parameters
    ----------
    buildings:
        Building polygons containing the column:

            resolved_height_m

    grid:
        Computational grid.

    settings:
        Rasterization configuration.

    dtype:
        NumPy/raster output dtype.

    Returns
    -------
    numpy.ndarray
        Building-height field with shape:

            (ny, nx)
    """

    _validate_buildings(
        buildings
    )

    height_dtype = _validate_height_dtype(
        dtype
    )

    if (
        settings.overlap_rule
        == "maximum_height"
    ):
        ordered = buildings.sort_values(
            by="resolved_height_m",
            ascending=True,
        )

    else:
        raise ValueError(
            "Unsupported overlap rule: "
            f"{settings.overlap_rule}"
        )

    shapes = [
        (
            geometry,
            float(
                height
            ),
        )
        for (
            geometry,
            height,
        ) in zip(
            ordered.geometry,
            ordered[
                "resolved_height_m"
            ],
            strict=True,
        )
    ]

    if not shapes:
        raise ValueError(
            "No building geometry is available "
            "for rasterization."
        )

    # Rasterio uses the conventional image/raster orientation:
    #
    # row 0 = northern edge
    #
    # while our numerical model uses:
    #
    # y index 0 = southern edge
    #
    # We therefore rasterize north-up first, then flip the
    # resulting array vertically.
    transform = from_origin(
        grid.min_x,
        grid.max_y,
        grid.dx_m,
        grid.dy_m,
    )

    north_up_height = rasterize(
        shapes=shapes,
        out_shape=grid.shape_yx,
        fill=0.0,
        transform=transform,
        all_touched=settings.all_touched,
        dtype=height_dtype.name,
    )

    height_field = np.flipud(
        north_up_height
    ).copy()

    _validate_height_field(
        height_field=height_field,
        grid=grid,
    )

    LOGGER.info(
        "Height raster created: shape=%s",
        height_field.shape,
    )

    LOGGER.info(
        "Raster cells containing buildings: %s",
        f"{int(np.count_nonzero(height_field > 0)):,}",
    )

    if np.any(
        height_field
        > grid.z_max_m
    ):
        affected_cells = int(
            np.count_nonzero(
                height_field
                > grid.z_max_m
            )
        )

        LOGGER.warning(
            "%s raster cell(s) contain building heights "
            "above the configured vertical model domain "
            "(z_max=%.2f m). "
            "Those buildings will be vertically truncated "
            "when the 3D mask is created.",
            f"{affected_cells:,}",
            grid.z_max_m,
        )

    return height_field


def extrude_building_mask(
    height_field: np.ndarray,
    grid: GridDefinition,
    *,
    dtype: str,
) -> np.ndarray:
    """
    Extrude H[y,x] into the three-dimensional solid mask B[z,y,x].

    Definition
    ----------
    B[z,y,x] = 1
        solid building voxel

    B[z,y,x] = 0
        air voxel

    Cell-centre rule
    ----------------
    A voxel is classified as solid when the centre of that voxel
    lies below the rasterized building height.

    Example
    -------
    If:

        dz = 2 m
        building height = 10 m

    vertical cell centres are:

        1, 3, 5, 7, 9, 11, ...

    therefore:

        1, 3, 5, 7, 9
            -> solid

        11 and above
            -> air

    Parameters
    ----------
    height_field:
        H[y,x].

    grid:
        Computational grid.

    dtype:
        Integer dtype for the occupancy mask.

    Returns
    -------
    numpy.ndarray
        B[z,y,x].
    """

    _validate_height_field(
        height_field=height_field,
        grid=grid,
    )

    mask_dtype = _validate_mask_dtype(
        dtype
    )

    z_centers = grid.z_centers()

    building_mask = (
        z_centers[
            :,
            None,
            None,
        ]
        <
        height_field[
            None,
            :,
            :,
        ]
    )

    building_mask = (
        building_mask.astype(
            mask_dtype,
            copy=False,
        )
    )

    if (
        building_mask.shape
        != grid.shape_zyx
    ):
        raise RuntimeError(
            "Internal voxel-grid inconsistency. "
            f"Expected B shape {grid.shape_zyx}, "
            f"got {building_mask.shape}."
        )

    unique_values = set(
        np.unique(
            building_mask
        ).tolist()
    )

    if not unique_values.issubset(
        {
            0,
            1,
        }
    ):
        raise RuntimeError(
            "Building occupancy mask must contain "
            "only 0 and 1."
        )

    solid_voxels = int(
        np.count_nonzero(
            building_mask
        )
    )

    solid_fraction = (
        solid_voxels
        / grid.total_voxels
    )

    LOGGER.info(
        "3D building mask created: shape=%s",
        building_mask.shape,
    )

    LOGGER.info(
        "Solid building voxels: %s",
        f"{solid_voxels:,}",
    )

    LOGGER.info(
        "Solid fraction of computational domain: %.4f%%",
        solid_fraction * 100.0,
    )

    return building_mask


def _validate_buildings(
    buildings: gpd.GeoDataFrame,
) -> None:
    """
    Validate input building data before rasterization.
    """

    if buildings.empty:
        raise ValueError(
            "Building dataset is empty."
        )

    if (
        "resolved_height_m"
        not in buildings.columns
    ):
        raise ValueError(
            "Building dataset does not contain "
            "'resolved_height_m'. "
            "Run resolve_building_heights() "
            "before rasterization."
        )

    if "geometry" not in buildings.columns:
        raise ValueError(
            "Building dataset has no geometry column."
        )

    heights = np.asarray(
        buildings[
            "resolved_height_m"
        ],
        dtype=np.float64,
    )

    if not np.all(
        np.isfinite(
            heights
        )
    ):
        raise ValueError(
            "Building dataset contains non-finite "
            "resolved heights."
        )

    if np.any(
        heights <= 0
    ):
        raise ValueError(
            "Building dataset contains resolved "
            "heights <= 0."
        )

    valid_geometry = (
        buildings.geometry.notna()
        & ~buildings.geometry.is_empty
    )

    if not bool(
        valid_geometry.all()
    ):
        raise ValueError(
            "Building dataset contains null or "
            "empty geometry before rasterization."
        )


def _validate_height_field(
    *,
    height_field: np.ndarray,
    grid: GridDefinition,
) -> None:
    """
    Validate H[y,x].
    """

    if (
        height_field.ndim
        != 2
    ):
        raise ValueError(
            "Building-height field must be 2D. "
            f"Got {height_field.ndim} dimensions."
        )

    if (
        height_field.shape
        != grid.shape_yx
    ):
        raise ValueError(
            "Building-height field shape does not "
            "match computational grid. "
            f"Expected {grid.shape_yx}, "
            f"got {height_field.shape}."
        )

    if not np.all(
        np.isfinite(
            height_field
        )
    ):
        raise ValueError(
            "Building-height field contains "
            "non-finite values."
        )

    if np.any(
        height_field < 0
    ):
        raise ValueError(
            "Building-height field contains "
            "negative values."
        )


def _validate_height_dtype(
    dtype: str,
) -> np.dtype:
    """
    Ensure H uses a floating-point storage type.
    """

    try:
        result = np.dtype(
            dtype
        )

    except TypeError as exc:
        raise ValueError(
            f"Invalid height dtype: {dtype!r}"
        ) from exc

    if not np.issubdtype(
        result,
        np.floating,
    ):
        raise ValueError(
            "Height raster dtype must be "
            "floating point. "
            f"Got: {dtype}"
        )

    return result


def _validate_mask_dtype(
    dtype: str,
) -> np.dtype:
    """
    Ensure B uses an integer storage type.
    """

    try:
        result = np.dtype(
            dtype
        )

    except TypeError as exc:
        raise ValueError(
            f"Invalid building-mask dtype: {dtype!r}"
        ) from exc

    if not np.issubdtype(
        result,
        np.integer,
    ):
        raise ValueError(
            "Building-mask dtype must be integer. "
            f"Got: {dtype}"
        )

    return result