"""Command-line workflows for traffic-emission preparation and rasterisation."""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import Any

import geopandas as gpd
import numpy as np
import pandas as pd
import xarray as xr

from project_config import (
    ConfigError,
    get_required,
    load_project_config,
    resolve_repo_path,
)

from emission.roads import (
    _required_text,
    assign_edge_emission_proxies,
    load_emission_settings,
    load_roads,
    summarise_edge_emissions,
    summarise_road_classes,
    write_road_class_summary,
    write_road_emissions,
)

from emission.rasterizer import (
    EmissionRasterizationError,
    RasterizationDiagnostics,
    RasterizationSettings,
    _required_nonnegative_float,
    _validate_voxel_dataset,
    rasterize_relative_source,
)

LOGGER = logging.getLogger(
    "emissions"
)


def read_rasterization_settings(
    config: dict[str, Any],
) -> RasterizationSettings:
    """Read every A3.3 project parameter from YAML."""

    source_height_m = (
        _required_nonnegative_float(
            config,
            (
                "emissions.rasterization."
                "source_height_m"
            ),
        )
    )

    relative_tolerance = (
        _required_nonnegative_float(
            config,
            (
                "emissions.rasterization."
                "geometry_length_relative_tolerance"
            ),
        )
    )

    output_dtype_raw = str(
        get_required(
            config,
            (
                "emissions.rasterization."
                "output_dtype"
            ),
        )
    ).strip()

    if not output_dtype_raw:
        raise ConfigError(
            "emissions.rasterization."
            "output_dtype cannot be empty."
        )

    try:
        output_dtype = np.dtype(
            output_dtype_raw
        )

    except TypeError as exc:
        raise ConfigError(
            "Invalid emissions.rasterization."
            f"output_dtype: {output_dtype_raw!r}"
        ) from exc

    if not np.issubdtype(
        output_dtype,
        np.floating,
    ):
        raise ConfigError(
            "emissions.rasterization."
            "output_dtype must be a floating dtype."
        )

    netcdf_engine = str(
        get_required(
            config,
            (
                "emissions.rasterization."
                "netcdf_engine"
            ),
        )
    ).strip()

    if not netcdf_engine:
        raise ConfigError(
            "emissions.rasterization."
            "netcdf_engine cannot be empty."
        )

    compression_raw = get_required(
        config,
        (
            "emissions.rasterization."
            "compression_level"
        ),
    )

    if isinstance(
        compression_raw,
        bool,
    ):
        raise ConfigError(
            "emissions.rasterization."
            "compression_level must be an integer."
        )

    try:
        compression_level = int(
            compression_raw
        )

    except (
        TypeError,
        ValueError,
    ) as exc:
        raise ConfigError(
            "emissions.rasterization."
            "compression_level must be an integer."
        ) from exc

    if not (
        0
        <= compression_level
        <= 9
    ):
        raise ConfigError(
            "emissions.rasterization."
            "compression_level must be "
            "between 0 and 9."
        )

    return RasterizationSettings(
        source_height_m=(
            source_height_m
        ),
        geometry_length_relative_tolerance=(
            relative_tolerance
        ),
        output_dtype=(
            output_dtype.name
        ),
        netcdf_engine=(
            netcdf_engine
        ),
        compression_level=(
            compression_level
        ),
    )


def load_voxel_dataset(
    voxel_path: str | Path,
) -> xr.Dataset:
    """Load the canonical voxel dataset fully into memory."""

    path = Path(
        voxel_path
    ).expanduser().resolve()

    if not path.exists():
        raise FileNotFoundError(
            "Voxel grid not found. "
            "Run src/01_voxelize.py first: "
            f"{path}"
        )

    with xr.open_dataset(
        path
    ) as opened:
        dataset = opened.load()

    _validate_voxel_dataset(
        dataset
    )

    return dataset


def load_road_emissions(
    road_path: str | Path,
) -> gpd.GeoDataFrame:
    """Load A3.2 output and validate fields required by A3.3."""

    path = Path(
        road_path
    ).expanduser().resolve()

    if not path.exists():
        raise FileNotFoundError(
            "A3.2 road-emission layer not found. "
            "Run src/emissions.py first: "
            f"{path}"
        )

    roads = gpd.read_file(
        path
    )

    if roads.empty:
        raise EmissionRasterizationError(
            "A3.2 road-emission layer "
            f"is empty: {path}"
        )

    required = {
        "length_m",
        "emission_proxy",
        "geometry",
    }

    missing = required.difference(
        roads.columns
    )

    if missing:
        raise EmissionRasterizationError(
            "A3.2 road-emission layer is "
            "missing required columns: "
            +
            ", ".join(
                sorted(
                    missing
                )
            )
        )

    if roads.crs is None:
        raise EmissionRasterizationError(
            "A3.2 road-emission layer "
            "has no CRS metadata."
        )

    length_m = np.asarray(
        roads[
            "length_m"
        ],
        dtype=float,
    )

    emission_proxy = np.asarray(
        roads[
            "emission_proxy"
        ],
        dtype=float,
    )

    if (
        np.any(
            ~np.isfinite(
                length_m
            )
        )
        or
        np.any(
            length_m <= 0.0
        )
    ):
        raise EmissionRasterizationError(
            "Every A3.2 road edge must have "
            "finite positive length_m."
        )

    if (
        np.any(
            ~np.isfinite(
                emission_proxy
            )
        )
        or
        np.any(
            emission_proxy <= 0.0
        )
    ):
        raise EmissionRasterizationError(
            "Every A3.2 road edge must have "
            "finite positive emission_proxy."
        )

    invalid_geometry = (
        roads.geometry.isna()
        |
        roads.geometry.is_empty
    )

    if bool(
        invalid_geometry.any()
    ):
        raise EmissionRasterizationError(
            "Every A3.2 road edge must "
            "have a non-empty geometry."
        )

    return roads


def save_emission_source_dataset(
    dataset: xr.Dataset,
    output_path: str | Path,
    settings: RasterizationSettings,
) -> Path:
    """Atomically save the A3.3 netCDF."""

    path = Path(
        output_path
    ).expanduser().resolve()

    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temporary = path.with_name(
        path.name + ".tmp"
    )

    if temporary.exists():
        temporary.unlink()

    encoding: dict[
        str,
        dict[str, Any],
    ] = {
        "S": {
            "dtype": (
                settings.output_dtype
            ),
        },
        "S_proxy": {
            "dtype": (
                settings.output_dtype
            ),
        },
    }

    if (
        settings.netcdf_engine
        .strip()
        .lower()
        in {
            "netcdf4",
            "h5netcdf",
        }
    ):
        for variable in (
            "S",
            "S_proxy",
        ):
            encoding[
                variable
            ].update(
                {
                    "zlib": True,
                    "complevel": (
                        settings
                        .compression_level
                    ),
                    "shuffle": True,
                }
            )

    try:
        dataset.to_netcdf(
            temporary,
            engine=(
                settings.netcdf_engine
            ),
            encoding=encoding,
        )

        temporary.replace(
            path
        )

    finally:
        if temporary.exists():
            temporary.unlink()

    return path


def run_road_workflow(
    config_path: str | Path,
) -> tuple[
    pd.DataFrame,
    gpd.GeoDataFrame,
    Path,
    Path,
]:
    config = load_project_config(
        config_path
    )

    roads_path = resolve_repo_path(
        config,
        "paths.roads",
    )

    summary_path = resolve_repo_path(
        config,
        "paths.road_class_summary",
    )

    emissions_path = resolve_repo_path(
        config,
        "paths.road_emissions",
    )

    if emissions_path == roads_path:
        raise ConfigError(
            "paths.road_emissions must not "
            "overwrite paths.roads."
        )

    roads = load_roads(
        roads_path
    )

    LOGGER.info(
        "Loaded %d road edges from %s "
        "(%.1f m total)",
        len(
            roads
        ),
        roads_path,
        roads[
            "length_m"
        ].sum(),
    )

    road_summary = (
        summarise_road_classes(
            roads
        )
    )

    allocated = (
        assign_edge_emission_proxies(
            roads,
            config,
        )
    )

    write_road_class_summary(
        road_summary,
        summary_path,
    )

    write_road_emissions(
        allocated,
        emissions_path,
    )

    return (
        road_summary,
        allocated,
        summary_path,
        emissions_path,
    )


def parse_road_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "A3.1-A3.2 road summary and "
            "config-driven emission allocation."
        )
    )

    parser.add_argument(
        "--config",
        required=True,
        help=(
            "Project YAML path. Required so "
            "the emission workflow never "
            "guesses model settings."
        ),
    )

    return parser.parse_args()


def road_main() -> None:
    args = parse_road_args()

    config = load_project_config(
        args.config
    )

    level_name = _required_text(
        config,
        "runtime.log_level",
    ).upper()

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
            f"{level_name}"
        )

    logging.basicConfig(
        level=level,
        format=(
            "%(levelname)s: %(message)s"
        ),
    )

    (
        road_summary,
        allocated,
        summary_path,
        emissions_path,
    ) = run_road_workflow(
        args.config
    )

    settings = load_emission_settings(
        config
    )

    emission_summary = (
        summarise_edge_emissions(
            allocated
        )
    )

    print(
        "\nA3.1 - Road length by "
        "OSM highway class"
    )

    print(
        "=" * 72
    )

    print(
        road_summary.to_string(
            index=False
        )
    )

    print(
        "=" * 72
    )

    print(
        "Total edges: "
        f"{int(road_summary['edges'].sum())}"
    )

    print(
        "Total length: "
        f"{road_summary['length_m'].sum():.1f} m"
    )

    print(
        f"Saved A3.1: {summary_path}"
    )

    print(
        "\nA3.2 - Config-driven relative "
        "edge emission allocation"
    )

    print(
        "=" * 100
    )

    print(
        "Pollutant label: "
        f"{settings['pollutant']}"
    )

    print(
        "EF: "
        f"{settings['ef_g_per_vehicle_km']:.6g} "
        "g/(vehicle km)"
    )

    print(
        "Allocation basis: "
        f"{settings['allocation_basis']}"
    )

    print(
        emission_summary.to_string(
            index=False,
            formatters={
                "length_m": (
                    lambda v: f"{v:.1f}"
                ),
                "class_weight": (
                    lambda v: f"{v:.3f}"
                ),
                "weighted_length_km": (
                    lambda v: f"{v:.6f}"
                ),
                "emission_proxy": (
                    lambda v: f"{v:.8f}"
                ),
                "emission_share_percent": (
                    lambda v: f"{v:.2f}"
                ),
            },
        )
    )

    print(
        "=" * 100
    )

    print(
        "Emission-share sum: "
        f"{allocated['emission_share'].sum():.12f}"
    )

    print(
        f"Saved A3.2: {emissions_path}"
    )

    print(
        "NOTE: A3.2 is a relative allocation "
        "only; A3.4 supplies the EDGAR "
        "normalisation."
    )


def run_raster_workflow(
    config_path: str | Path,
) -> tuple[
    Path,
    RasterizationDiagnostics,
]:
    """Execute A3.3 from configured input files."""

    config = load_project_config(
        config_path
    )

    settings = (
        read_rasterization_settings(
            config
        )
    )

    voxel_path = resolve_repo_path(
        config,
        "paths.voxel_netcdf",
    )

    road_path = resolve_repo_path(
        config,
        "paths.road_emissions",
    )

    output_path = resolve_repo_path(
        config,
        "paths.emission_source_netcdf",
    )

    if output_path == voxel_path:
        raise ConfigError(
            "paths.emission_source_netcdf "
            "must not overwrite "
            "paths.voxel_netcdf."
        )

    voxel_dataset = load_voxel_dataset(
        voxel_path
    )

    road_emissions = load_road_emissions(
        road_path
    )

    (
        result,
        diagnostics,
    ) = rasterize_relative_source(
        voxel_dataset=(
            voxel_dataset
        ),
        road_emissions=(
            road_emissions
        ),
        settings=settings,
    )

    result.attrs[
        "source_voxel_file"
    ] = str(
        voxel_path
    )

    result.attrs[
        "source_road_emission_file"
    ] = str(
        road_path
    )

    config_meta = config.get(
        "_meta",
        {},
    )

    if (
        isinstance(
            config_meta,
            dict,
        )
        and
        config_meta.get(
            "config_path"
        )
    ):
        result.attrs[
            "config_file"
        ] = str(
            config_meta[
                "config_path"
            ]
        )

    saved = (
        save_emission_source_dataset(
            result,
            output_path,
            settings,
        )
    )

    return (
        saved,
        diagnostics,
    )


def parse_raster_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "A3.3: rasterise A3.2 "
            "road-emission allocation into "
            "the near-ground voxel layer "
            "and write S[z,y,x] to netCDF."
        )
    )

    parser.add_argument(
        "--config",
        required=True,
        help=(
            "Project YAML path. Required so "
            "A3.3 never guesses project "
            "parameters."
        ),
    )

    return parser.parse_args()


def raster_main() -> None:
    args = parse_raster_args()

    config = load_project_config(
        args.config
    )

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
            "%(levelname)s: %(message)s"
        ),
    )

    (
        saved,
        diagnostics,
    ) = run_raster_workflow(
        args.config
    )

    print(
        "\nA3.3 - Road emissions "
        "-> voxel source field"
    )

    print(
        "=" * 72
    )

    print(
        "Source layer: "
        f"z index {diagnostics.source_z_index}, "
        f"z = {diagnostics.source_z_m:.3f} m"
    )

    print(
        "Road edges intersecting domain: "
        f"{diagnostics.road_edges_intersecting_domain}/"
        f"{diagnostics.road_edges_total}"
    )

    print(
        "A3.2 proxy inside horizontal domain: "
        f"{diagnostics.proxy_inside_domain:.12g}"
    )

    print(
        "Proxy rejected in solid voxels: "
        f"{diagnostics.proxy_rejected_by_solids:.12g} "
        "("
        f"{100.0 * diagnostics.rejected_fraction_of_inside:.4f}% "
        "of inside)"
    )

    print(
        "Proxy retained in valid air voxels: "
        f"{diagnostics.proxy_retained:.12g}"
    )

    print(
        "S sum after A3.3 normalisation: "
        "1.000000000000"
    )

    print(
        f"Saved: {saved}"
    )

    print(
        "NOTE: S is dimensionless at A3.3. "
        "Do not pass it to transport until "
        "A3.4 applies EDGAR and converts the "
        "source to kg/m^3/s."
    )