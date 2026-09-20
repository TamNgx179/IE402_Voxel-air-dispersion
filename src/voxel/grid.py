from __future__ import annotations

import math
from typing import Any

import geopandas as gpd

from project_config import (
    ConfigError,
    get_required,
)

from voxel.models import (
    GridDefinition,
)


SUPPORTED_HORIZONTAL_MODES = {
    "fixed_size_centered_on_study_area",
    "study_area_bounds",
}


def build_grid_definition(
    config: dict[str, Any],
    study_area_projected: gpd.GeoDataFrame,
) -> GridDefinition:
    """
    Build the complete computational grid from project configuration
    and a projected study-area geometry.

    Parameters
    ----------
    config:
        Parsed project configuration.

    study_area_projected:
        Study-area geometry already transformed into a projected
        coordinate system whose horizontal units are metres.

    Returns
    -------
    GridDefinition
        Validated computational grid.

    Supported horizontal domain modes
    ---------------------------------

    fixed_size_centered_on_study_area
        Creates a fixed physical domain centred on the centroid of
        the configured study area.

    study_area_bounds
        Uses the complete study-area bounds and expands the domain
        outward to align with whole grid cells.
    """

    _validate_study_area(
        study_area_projected
    )

    _validate_projected_crs(
        study_area_projected
    )

    dx_m = _read_positive_float(
        config,
        "grid.dx_m",
    )

    dy_m = _read_positive_float(
        config,
        "grid.dy_m",
    )

    dz_m = _read_positive_float(
        config,
        "grid.dz_m",
    )

    z_min_m = _read_finite_float(
        config,
        "domain.vertical.min_m",
    )

    z_max_m = _read_finite_float(
        config,
        "domain.vertical.max_m",
    )

    if (
        z_max_m
        <= z_min_m
    ):
        raise ConfigError(
            "domain.vertical.max_m must be "
            "greater than domain.vertical.min_m."
        )

    horizontal_mode = str(
        get_required(
            config,
            "domain.horizontal.mode",
        )
    ).strip().lower()

    if (
        horizontal_mode
        not in SUPPORTED_HORIZONTAL_MODES
    ):
        raise ConfigError(
            "Unsupported horizontal domain mode: "
            f"'{horizontal_mode}'. "
            "Supported modes are: "
            f"{sorted(SUPPORTED_HORIZONTAL_MODES)}"
        )

    study_geometry = (
        study_area_projected
        .geometry
        .union_all()
    )

    if study_geometry.is_empty:
        raise ValueError(
            "Study-area geometry is empty."
        )

    if (
        horizontal_mode
        == "fixed_size_centered_on_study_area"
    ):
        bounds = (
            _build_fixed_size_bounds(
                config=config,
                study_geometry=study_geometry,
            )
        )

    else:
        bounds = (
            _build_study_area_bounds(
                config=config,
                study_geometry=study_geometry,
                dx_m=dx_m,
                dy_m=dy_m,
            )
        )

    (
        min_x,
        min_y,
        max_x,
        max_y,
    ) = bounds

    grid = GridDefinition(
        min_x=min_x,
        min_y=min_y,
        max_x=max_x,
        max_y=max_y,
        z_min_m=z_min_m,
        z_max_m=z_max_m,
        dx_m=dx_m,
        dy_m=dy_m,
        dz_m=dz_m,
    )

    # Accessing these properties intentionally performs the exact
    # divisibility checks implemented by GridDefinition.
    _ = grid.nx
    _ = grid.ny
    _ = grid.nz

    return grid


def _build_fixed_size_bounds(
    config: dict[str, Any],
    study_geometry,
) -> tuple[
    float,
    float,
    float,
    float,
]:
    """
    Build a fixed-size domain around the study-area centroid.
    """

    width_m = _read_positive_float(
        config,
        "domain.horizontal.width_m",
    )

    height_m = _read_positive_float(
        config,
        "domain.horizontal.height_m",
    )

    center = (
        study_geometry.centroid
    )

    if center.is_empty:
        raise ValueError(
            "Could not determine study-area centroid."
        )

    center_x = float(
        center.x
    )

    center_y = float(
        center.y
    )

    half_width = (
        width_m
        / 2.0
    )

    half_height = (
        height_m
        / 2.0
    )

    return (
        center_x - half_width,
        center_y - half_height,
        center_x + half_width,
        center_y + half_height,
    )


def _build_study_area_bounds(
    config: dict[str, Any],
    study_geometry,
    dx_m: float,
    dy_m: float,
) -> tuple[
    float,
    float,
    float,
    float,
]:
    """
    Build a domain from study-area bounds.

    Bounds are expanded rather than rounded inward.

    This guarantees that the computational domain still contains
    the complete requested study area.
    """

    padding_m = _read_nonnegative_float(
        config,
        "domain.horizontal.padding_m",
    )

    (
        raw_min_x,
        raw_min_y,
        raw_max_x,
        raw_max_y,
    ) = map(
        float,
        study_geometry.bounds,
    )

    requested_min_x = (
        raw_min_x
        - padding_m
    )

    requested_min_y = (
        raw_min_y
        - padding_m
    )

    requested_max_x = (
        raw_max_x
        + padding_m
    )

    requested_max_y = (
        raw_max_y
        + padding_m
    )

    min_x = (
        math.floor(
            requested_min_x
            / dx_m
        )
        * dx_m
    )

    min_y = (
        math.floor(
            requested_min_y
            / dy_m
        )
        * dy_m
    )

    max_x = (
        math.ceil(
            requested_max_x
            / dx_m
        )
        * dx_m
    )

    max_y = (
        math.ceil(
            requested_max_y
            / dy_m
        )
        * dy_m
    )

    return (
        min_x,
        min_y,
        max_x,
        max_y,
    )


def _validate_study_area(
    study_area: gpd.GeoDataFrame,
) -> None:
    """
    Validate that a usable study area has been supplied.
    """

    if study_area.empty:
        raise ValueError(
            "Study-area dataset is empty."
        )

    if (
        "geometry"
        not in study_area
    ):
        raise ValueError(
            "Study-area dataset has no geometry column."
        )

    usable_geometry = (
        study_area.geometry.notna()
        & ~study_area.geometry.is_empty
    )

    if not usable_geometry.any():
        raise ValueError(
            "Study-area dataset contains no usable geometry."
        )


def _validate_projected_crs(
    frame: gpd.GeoDataFrame,
) -> None:
    """
    Ensure grid construction is being performed in a projected CRS.

    Geographic longitude/latitude coordinates must not be used to
    construct metre-based voxel dimensions.
    """

    if frame.crs is None:
        raise ValueError(
            "Study-area CRS is missing."
        )

    crs = frame.crs

    if not crs.is_projected:
        raise ValueError(
            "Study-area geometry must be projected "
            "before grid construction. "
            f"Received CRS: {crs}"
        )


def _read_finite_float(
    config: dict[str, Any],
    key: str,
) -> float:
    """
    Read one finite numeric configuration value.
    """

    raw_value = get_required(
        config,
        key,
    )

    try:
        value = float(
            raw_value
        )

    except (
        TypeError,
        ValueError,
    ) as exc:
        raise ConfigError(
            f"Configuration key '{key}' "
            f"must be numeric. Got: {raw_value!r}"
        ) from exc

    if not math.isfinite(
        value
    ):
        raise ConfigError(
            f"Configuration key '{key}' "
            "must be finite."
        )

    return value


def _read_positive_float(
    config: dict[str, Any],
    key: str,
) -> float:
    """
    Read one positive finite configuration value.
    """

    value = _read_finite_float(
        config,
        key,
    )

    if value <= 0:
        raise ConfigError(
            f"Configuration key '{key}' "
            f"must be > 0. Got: {value}"
        )

    return value


def _read_nonnegative_float(
    config: dict[str, Any],
    key: str,
) -> float:
    """
    Read one non-negative finite configuration value.
    """

    value = _read_finite_float(
        config,
        key,
    )

    if value < 0:
        raise ConfigError(
            f"Configuration key '{key}' "
            f"must be >= 0. Got: {value}"
        )

    return value