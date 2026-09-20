from __future__ import annotations

import argparse
import logging
from typing import Any

from project_config import (
    ConfigError,
    get_required,
    load_project_config,
    resolve_repo_path,
)

from voxel.gis import (
    clip_buildings_to_domain,
    determine_target_crs,
    project_to_model_crs,
    read_vector_layer,
    validate_study_area,
)

from voxel.grid import (
    build_grid_definition,
)

from voxel.heights import (
    read_height_settings,
    resolve_building_heights,
)

from voxel.output import (
    build_voxel_dataset,
    read_output_settings,
    save_processed_buildings,
    save_voxel_dataset,
)

from voxel.rasterizer import (
    extrude_building_mask,
    rasterize_height_field,
    read_raster_settings,
)


LOGGER = logging.getLogger(
    "voxelize"
)


def parse_args() -> argparse.Namespace:
    """
    Parse command-line arguments.

    The project configuration is required explicitly so the
    numerical model never relies on an implicit project-specific
    configuration file.
    """

    parser = argparse.ArgumentParser(
        description=(
            "Convert GIS building polygons into "
            "a 3D voxel building mask."
        )
    )

    parser.add_argument(
        "--config",
        required=True,
        help=(
            "Path to project YAML configuration, "
            "relative to repository root or absolute."
        ),
    )

    return parser.parse_args()


def configure_logging(
    config: dict[str, Any],
) -> None:
    """
    Configure Python logging from project YAML.
    """

    level_name = str(
        get_required(
            config,
            "runtime.log_level",
        )
    ).strip().upper()

    level = getattr(
        logging,
        level_name,
        None,
    )

    if not isinstance(
        level,
        int,
    ):
        raise ConfigError(
            "Invalid runtime.log_level: "
            f"{level_name!r}"
        )

    logging.basicConfig(
        level=level,
        format=(
            "%(levelname)s | "
            "%(name)s | "
            "%(message)s"
        ),
    )


def run_voxelization(
    config: dict[str, Any],
) -> None:
    """
    Execute the complete GIS-to-voxel pipeline.

    Pipeline
    --------
    study_area
        ↓
    buildings
        ↓
    CRS validation
        ↓
    projected model CRS
        ↓
    computational grid
        ↓
    spatial clipping
        ↓
    building-height resolution
        ↓
    H[y,x]
        ↓
    B[z,y,x]
        ↓
    netCDF + processed building layer
    """

    configure_logging(
        config
    )

    LOGGER.info(
        "Starting voxelization pipeline."
    )

    buildings_path = resolve_repo_path(
        config,
        "paths.buildings",
    )

    study_area_path = resolve_repo_path(
        config,
        "paths.study_area",
    )

    buildings_missing_crs = _optional_string(
        get_required(
            config,
            "crs.buildings_if_missing",
        )
    )

    study_area_missing_crs = _optional_string(
        get_required(
            config,
            "crs.study_area_if_missing",
        )
    )

    study_area = read_vector_layer(
        study_area_path,
        missing_crs=study_area_missing_crs,
        label="Study area",
        require_polygon_geometry=True,
    )

    validate_study_area(
        study_area
    )

    buildings = read_vector_layer(
        buildings_path,
        missing_crs=buildings_missing_crs,
        label="Buildings",
        require_polygon_geometry=True,
    )

    target_crs = determine_target_crs(
        study_area=study_area,
        target_setting=str(
            get_required(
                config,
                "crs.target",
            )
        ),
    )

    study_area_projected = project_to_model_crs(
        study_area,
        target_crs,
        label="Study area",
    )

    buildings_projected = project_to_model_crs(
        buildings,
        target_crs,
        label="Buildings",
    )

    grid = build_grid_definition(
        config=config,
        study_area_projected=study_area_projected,
    )

    LOGGER.info(
        "Computational grid:"
    )

    LOGGER.info(
        "  nx=%s, ny=%s, nz=%s",
        f"{grid.nx:,}",
        f"{grid.ny:,}",
        f"{grid.nz:,}",
    )

    LOGGER.info(
        "  shape(z,y,x)=%s",
        grid.shape_zyx,
    )

    LOGGER.info(
        "  total voxels=%s",
        f"{grid.total_voxels:,}",
    )

    LOGGER.info(
        "  spacing=(%.3f, %.3f, %.3f) m",
        grid.dx_m,
        grid.dy_m,
        grid.dz_m,
    )

    clip_to_study_area = _read_bool(
        config,
        "voxelization.clip_to_study_area",
    )

    buildings_in_domain = clip_buildings_to_domain(
        buildings=buildings_projected,
        study_area=study_area_projected,
        grid=grid,
        clip_to_study_area=clip_to_study_area,
    )

    height_settings = read_height_settings(
        config
    )

    buildings_with_height = resolve_building_heights(
        buildings=buildings_in_domain,
        settings=height_settings,
    )

    raster_settings = read_raster_settings(
        config
    )

    output_settings = read_output_settings(
        config
    )

    height_field = rasterize_height_field(
        buildings=buildings_with_height,
        grid=grid,
        settings=raster_settings,
        dtype=output_settings.height_dtype,
    )

    building_mask = extrude_building_mask(
        height_field=height_field,
        grid=grid,
        dtype=output_settings.mask_dtype,
    )

    dataset = build_voxel_dataset(
        height_field=height_field,
        building_mask=building_mask,
        grid=grid,
        target_crs=target_crs,
        buildings=buildings_with_height,
        config=config,
    )

    save_voxel_dataset(
        dataset=dataset,
        settings=output_settings,
    )

    save_processed_buildings(
        buildings=buildings_with_height,
        settings=output_settings,
    )

    LOGGER.info(
        "Voxelization completed successfully."
    )

    LOGGER.info(
        "H[y,x] shape: %s",
        height_field.shape,
    )

    LOGGER.info(
        "B[z,y,x] shape: %s",
        building_mask.shape,
    )

    LOGGER.info(
        "Voxel netCDF: %s",
        output_settings.netcdf_path,
    )

    if (
        output_settings.save_processed_buildings
        and output_settings.processed_buildings_path
        is not None
    ):

        LOGGER.info(
            "Processed buildings: %s",
            output_settings.processed_buildings_path,
        )


def _read_bool(
    config: dict[str, Any],
    key: str,
) -> bool:
    """
    Read one strict boolean value from YAML.
    """

    value = get_required(
        config,
        key,
    )

    if not isinstance(
        value,
        bool,
    ):
        raise ConfigError(
            f"Configuration key '{key}' "
            "must be true or false."
        )

    return value


def _optional_string(
    value: Any,
) -> str | None:
    """
    Convert a nullable YAML value into an optional string.
    """

    if value is None:
        return None

    result = str(
        value
    ).strip()

    if not result:
        return None

    return result


def main() -> None:
    """
    Application entry point.
    """

    args = parse_args()

    config = load_project_config(
        args.config
    )

    run_voxelization(
        config
    )


if __name__ == "__main__":
    main()