from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import geopandas as gpd
import numpy as np
import xarray as xr

from pyproj import CRS

from project_config import (
    ConfigError,
    get_required,
    resolve_repo_path,
)

from voxel.heights import (
    summarize_height_sources,
)

from voxel.models import (
    GridDefinition,
    OutputSettings,
)


LOGGER = logging.getLogger(
    __name__
)


def read_output_settings(
    config: dict[str, Any],
) -> OutputSettings:
    """
    Read and validate voxel-output settings from project YAML.
    """

    save_processed_buildings = get_required(
        config,
        "voxelization.output.save_processed_buildings",
    )

    if not isinstance(
        save_processed_buildings,
        bool,
    ):
        raise ConfigError(
            "voxelization.output.save_processed_buildings "
            "must be true or false."
        )

    processed_buildings_crs = str(
        get_required(
            config,
            "voxelization.output.processed_buildings_crs",
        )
    ).strip()

    if not processed_buildings_crs:
        raise ConfigError(
            "voxelization.output.processed_buildings_crs "
            "cannot be empty."
        )

    try:
        CRS.from_user_input(
            processed_buildings_crs
        )

    except Exception as exc:
        raise ConfigError(
            "Invalid processed-building output CRS: "
            f"{processed_buildings_crs!r}"
        ) from exc

    netcdf_engine = str(
        get_required(
            config,
            "voxelization.output.netcdf_engine",
        )
    ).strip()

    if not netcdf_engine:
        raise ConfigError(
            "voxelization.output.netcdf_engine "
            "cannot be empty."
        )

    compression_level = _read_compression_level(
        config
    )

    height_dtype = _read_dtype(
        config=config,
        key="voxelization.output.height_dtype",
        require_floating=True,
    )

    mask_dtype = _read_dtype(
        config=config,
        key="voxelization.output.mask_dtype",
        require_integer=True,
    )

    processed_buildings_path: Path | None

    if save_processed_buildings:

        processed_buildings_path = resolve_repo_path(
            config,
            "paths.processed_buildings",
        )

    else:

        processed_buildings_path = None

    return OutputSettings(
        netcdf_path=resolve_repo_path(
            config,
            "paths.voxel_netcdf",
        ),
        processed_buildings_path=processed_buildings_path,
        save_processed_buildings=save_processed_buildings,
        processed_buildings_crs=processed_buildings_crs,
        netcdf_engine=netcdf_engine,
        compression_level=compression_level,
        height_dtype=height_dtype,
        mask_dtype=mask_dtype,
    )


def build_voxel_dataset(
    *,
    height_field: np.ndarray,
    building_mask: np.ndarray,
    grid: GridDefinition,
    target_crs: CRS,
    buildings: gpd.GeoDataFrame,
    config: dict[str, Any],
) -> xr.Dataset:
    """
    Build the canonical xarray dataset for the voxel geometry.

    Canonical variables
    -------------------
    H[y,x]
        Building height in metres.

    B[z,y,x]
        Building occupancy mask.

        0 = air
        1 = solid building

    Canonical coordinate order
    --------------------------
    z, y, x

    This order must remain consistent throughout later modules:
    wind, transport, analysis, and web export.
    """

    _validate_array_shapes(
        height_field=height_field,
        building_mask=building_mask,
        grid=grid,
    )

    x = grid.x_centers()

    y = grid.y_centers()

    z = grid.z_centers()

    dataset = xr.Dataset(
        data_vars={
            "H": (
                (
                    "y",
                    "x",
                ),
                height_field,
            ),
            "B": (
                (
                    "z",
                    "y",
                    "x",
                ),
                building_mask,
            ),
            "crs": xr.DataArray(
                np.int32(
                    0
                )
            ),
        },
        coords={
            "x": x,
            "y": y,
            "z": z,
        },
    )

    dataset[
        "x"
    ].attrs.update(
        {
            "standard_name":
                "projection_x_coordinate",
            "long_name":
                "x coordinate of voxel centre",
            "units":
                "m",
            "axis":
                "X",
        }
    )

    dataset[
        "y"
    ].attrs.update(
        {
            "standard_name":
                "projection_y_coordinate",
            "long_name":
                "y coordinate of voxel centre",
            "units":
                "m",
            "axis":
                "Y",
        }
    )

    dataset[
        "z"
    ].attrs.update(
        {
            "standard_name":
                "height",
            "long_name":
                "height of voxel centre above domain base",
            "units":
                "m",
            "positive":
                "up",
            "axis":
                "Z",
        }
    )

    dataset[
        "H"
    ].attrs.update(
        {
            "long_name":
                "rasterized building height",
            "units":
                "m",
            "grid_mapping":
                "crs",
        }
    )

    dataset[
        "B"
    ].attrs.update(
        {
            "long_name":
                "building occupancy mask",
            "grid_mapping":
                "crs",
            "flag_values":
                np.asarray(
                    [
                        0,
                        1,
                    ],
                    dtype=building_mask.dtype,
                ),
            "flag_meanings":
                "air solid_building",
        }
    )

    crs_attributes = (
        target_crs.to_cf()
    )

    crs_attributes[
        "spatial_ref"
    ] = target_crs.to_wkt()

    crs_attributes[
        "crs_wkt"
    ] = target_crs.to_wkt()

    dataset[
        "crs"
    ].attrs.update(
        crs_attributes
    )

    configured_metadata = get_required(
        config,
        "metadata",
    )

    if not isinstance(
        configured_metadata,
        dict,
    ):
        raise ConfigError(
            "Configuration key 'metadata' "
            "must contain a YAML mapping."
        )

    for (
        key,
        value,
    ) in configured_metadata.items():

        dataset.attrs[
            str(
                key
            )
        ] = str(
            value
        )

    source_counts = summarize_height_sources(
        buildings
    )

    dataset.attrs.update(
        {
            "grid_order":
                "z,y,x",

            "nx":
                grid.nx,

            "ny":
                grid.ny,

            "nz":
                grid.nz,

            "total_voxels":
                grid.total_voxels,

            "dx_m":
                grid.dx_m,

            "dy_m":
                grid.dy_m,

            "dz_m":
                grid.dz_m,

            "cell_volume_m3":
                grid.cell_volume_m3,

            "domain_min_x_m":
                grid.min_x,

            "domain_max_x_m":
                grid.max_x,

            "domain_min_y_m":
                grid.min_y,

            "domain_max_y_m":
                grid.max_y,

            "domain_z_min_m":
                grid.z_min_m,

            "domain_z_max_m":
                grid.z_max_m,

            "model_crs":
                target_crs.to_string(),

            "building_count":
                int(
                    len(
                        buildings
                    )
                ),

            "building_raster_cell_count":
                int(
                    np.count_nonzero(
                        height_field
                        > 0
                    )
                ),

            "solid_voxel_count":
                int(
                    np.count_nonzero(
                        building_mask
                    )
                ),

            "height_source_counts_json":
                json.dumps(
                    source_counts,
                    ensure_ascii=False,
                    sort_keys=True,
                ),
        }
    )

    config_meta = config.get(
        "_meta",
        {}
    )

    if isinstance(
        config_meta,
        dict,
    ):

        config_path = config_meta.get(
            "config_path"
        )

        if config_path:

            dataset.attrs[
                "config_file"
            ] = str(
                config_path
            )

    return dataset


def save_voxel_dataset(
    dataset: xr.Dataset,
    settings: OutputSettings,
) -> None:
    """
    Save the voxel dataset to netCDF.

    Atomic-write strategy
    ---------------------
    1. Write to a temporary file.
    2. Only after a successful write, replace the final output.

    This reduces the chance of leaving a partially written model
    dataset if the process fails during serialization.
    """

    output_path = (
        settings.netcdf_path
    )

    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temporary_path = (
        output_path.with_name(
            output_path.name
            + ".tmp"
        )
    )

    if temporary_path.exists():
        temporary_path.unlink()

    encoding = _build_netcdf_encoding(
        settings
    )

    LOGGER.info(
        "Writing voxel netCDF: %s",
        output_path,
    )

    try:

        dataset.to_netcdf(
            temporary_path,
            engine=settings.netcdf_engine,
            encoding=encoding,
        )

        temporary_path.replace(
            output_path
        )

    finally:

        if temporary_path.exists():
            temporary_path.unlink()

    LOGGER.info(
        "Voxel netCDF saved successfully."
    )


def save_processed_buildings(
    buildings: gpd.GeoDataFrame,
    settings: OutputSettings,
) -> None:
    """
    Save the cleaned building layer used by the model.

    This output is useful for:

    - QGIS visual inspection;
    - building-height QA;
    - checking `height_source`;
    - checking `height_raw_value`;
    - later web visualization.

    The output file format is inferred from the configured path
    extension by GeoPandas/Fiona/Pyogrio.
    """

    if not settings.save_processed_buildings:
        return

    output_path = (
        settings.processed_buildings_path
    )

    if output_path is None:
        raise RuntimeError(
            "save_processed_buildings is enabled "
            "but no output path was configured."
        )

    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    output = buildings.to_crs(
        settings.processed_buildings_crs
    )

    LOGGER.info(
        "Saving processed building layer: %s",
        output_path,
    )

    output.to_file(
        output_path,
    )

    LOGGER.info(
        "Processed building layer saved successfully."
    )


def _build_netcdf_encoding(
    settings: OutputSettings,
) -> dict[
    str,
    dict[str, Any],
]:
    """
    Build variable encoding options for xarray.

    Compression parameters are only supplied to engines that
    support the NetCDF4/HDF5 compression model.
    """

    common_encoding = {
        "H": {
            "dtype":
                settings.height_dtype,
        },
        "B": {
            "dtype":
                settings.mask_dtype,
        },
    }

    engine = (
        settings.netcdf_engine
        .strip()
        .lower()
    )

    if engine in {
        "netcdf4",
        "h5netcdf",
    }:

        for variable in (
            "H",
            "B",
        ):

            common_encoding[
                variable
            ].update(
                {
                    "zlib":
                        True,

                    "complevel":
                        settings.compression_level,

                    "shuffle":
                        True,
                }
            )

    return common_encoding


def _validate_array_shapes(
    *,
    height_field: np.ndarray,
    building_mask: np.ndarray,
    grid: GridDefinition,
) -> None:
    """
    Defensive consistency check before dataset creation.
    """

    if (
        height_field.shape
        != grid.shape_yx
    ):
        raise ValueError(
            "H shape does not match grid. "
            f"Expected {grid.shape_yx}, "
            f"got {height_field.shape}."
        )

    if (
        building_mask.shape
        != grid.shape_zyx
    ):
        raise ValueError(
            "B shape does not match grid. "
            f"Expected {grid.shape_zyx}, "
            f"got {building_mask.shape}."
        )

    if not np.all(
        np.isfinite(
            height_field
        )
    ):
        raise ValueError(
            "H contains non-finite values."
        )

    if np.any(
        height_field < 0
    ):
        raise ValueError(
            "H contains negative building heights."
        )

    unique_mask_values = set(
        np.unique(
            building_mask
        ).tolist()
    )

    if not unique_mask_values.issubset(
        {
            0,
            1,
        }
    ):
        raise ValueError(
            "B must contain only 0 and 1."
        )


def _read_compression_level(
    config: dict[str, Any],
) -> int:
    """
    Validate netCDF compression level.
    """

    raw_value = get_required(
        config,
        "voxelization.output.compression_level",
    )

    try:
        value = int(
            raw_value
        )

    except (
        TypeError,
        ValueError,
    ) as exc:

        raise ConfigError(
            "voxelization.output.compression_level "
            "must be an integer."
        ) from exc

    if not (
        0
        <= value
        <= 9
    ):
        raise ConfigError(
            "voxelization.output.compression_level "
            "must be between 0 and 9."
        )

    return value


def _read_dtype(
    *,
    config: dict[str, Any],
    key: str,
    require_floating: bool = False,
    require_integer: bool = False,
) -> str:
    """
    Read and validate one NumPy storage dtype.
    """

    raw_value = str(
        get_required(
            config,
            key,
        )
    ).strip()

    try:
        dtype = np.dtype(
            raw_value
        )

    except TypeError as exc:
        raise ConfigError(
            f"Invalid dtype configured at '{key}': "
            f"{raw_value!r}"
        ) from exc

    if (
        require_floating
        and not np.issubdtype(
            dtype,
            np.floating,
        )
    ):
        raise ConfigError(
            f"'{key}' must be a floating-point dtype."
        )

    if (
        require_integer
        and not np.issubdtype(
            dtype,
            np.integer,
        )
    ):
        raise ConfigError(
            f"'{key}' must be an integer dtype."
        )

    return dtype.name