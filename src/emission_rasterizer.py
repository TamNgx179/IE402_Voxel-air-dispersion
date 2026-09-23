"""Rasterise road-emission allocation onto the canonical voxel grid (A3.3).

This stage consumes the per-edge relative allocation produced by A3.2 and
maps it onto the voxel layer nearest the configured source height.

Important
---------
A3.3 does not invent an absolute emission rate.

Until A3.4 supplies the EDGAR normalisation:

    S[z, y, x]

is a dimensionless spatial allocation whose valid air voxels sum to one.

S_proxy stores the corresponding pre-normalisation edge proxy that survives:

- horizontal-domain clipping;
- road-to-cell rasterisation;
- rejection of source cells inside buildings.

Every project-specific setting is required from config/project.yaml.
There are no silent model-parameter defaults in this module.
"""

from __future__ import annotations

import argparse
import logging

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import geopandas as gpd
import numpy as np
import xarray as xr

from pyproj import CRS
from shapely.geometry import box

from project_config import (
    ConfigError,
    get_required,
    load_project_config,
    resolve_repo_path,
)


LOGGER = logging.getLogger(
    "emission_rasterizer"
)


class EmissionRasterizationError(
    ValueError
):
    """Raised when A3.3 cannot build a valid voxel emission field."""


@dataclass(
    frozen=True
)
class RasterizationSettings:
    """Validated A3.3 settings read from project YAML."""

    source_height_m: float

    geometry_length_relative_tolerance: float

    output_dtype: str

    netcdf_engine: str

    compression_level: int


@dataclass(
    frozen=True
)
class RasterizationDiagnostics:
    """Auditable totals produced while constructing the A3.3 field."""

    source_z_index: int

    source_z_m: float

    road_edges_total: int

    road_edges_intersecting_domain: int

    input_proxy_total: float

    proxy_inside_domain: float

    proxy_rejected_by_solids: float

    proxy_retained: float


    @property
    def rejected_fraction_of_inside(
        self,
    ) -> float:

        if (
            self.proxy_inside_domain
            <= 0.0
        ):
            return 0.0

        return (
            self.proxy_rejected_by_solids
            /
            self.proxy_inside_domain
        )


def read_rasterization_settings(
    config: dict[
        str,
        Any,
    ],
) -> RasterizationSettings:
    """
    Read every A3.3 project parameter from YAML.

    No project-specific fallback values are permitted.
    """

    source_height_m = (
        _required_nonnegative_float(
            config,
            "emissions.rasterization.source_height_m",
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
            "emissions.rasterization.output_dtype",
        )
    ).strip()

    if not output_dtype_raw:
        raise ConfigError(
            "emissions.rasterization.output_dtype "
            "cannot be empty."
        )

    try:

        output_dtype = np.dtype(
            output_dtype_raw
        )

    except TypeError as exc:

        raise ConfigError(
            "Invalid emissions.rasterization.output_dtype: "
            f"{output_dtype_raw!r}"
        ) from exc

    if not np.issubdtype(
        output_dtype,
        np.floating,
    ):
        raise ConfigError(
            "emissions.rasterization.output_dtype "
            "must be a floating dtype."
        )

    netcdf_engine = str(
        get_required(
            config,
            "emissions.rasterization.netcdf_engine",
        )
    ).strip()

    if not netcdf_engine:
        raise ConfigError(
            "emissions.rasterization.netcdf_engine "
            "cannot be empty."
        )

    compression_raw = get_required(
        config,
        "emissions.rasterization.compression_level",
    )

    if isinstance(
        compression_raw,
        bool,
    ):
        raise ConfigError(
            "emissions.rasterization.compression_level "
            "must be an integer."
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
            "emissions.rasterization.compression_level "
            "must be an integer."
        ) from exc

    if not (
        0
        <= compression_level
        <= 9
    ):
        raise ConfigError(
            "emissions.rasterization.compression_level "
            "must be between 0 and 9."
        )

    return RasterizationSettings(
        source_height_m=source_height_m,
        geometry_length_relative_tolerance=relative_tolerance,
        output_dtype=output_dtype.name,
        netcdf_engine=netcdf_engine,
        compression_level=compression_level,
    )


def load_voxel_dataset(
    voxel_path: str | Path,
) -> xr.Dataset:
    """
    Load the canonical voxel dataset fully into memory.
    """

    path = (
        Path(
            voxel_path
        )
        .expanduser()
        .resolve()
    )

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
    """
    Load A3.2 output and validate fields required by A3.3.
    """

    path = (
        Path(
            road_path
        )
        .expanduser()
        .resolve()
    )

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

    missing = (
        required
        .difference(
            roads.columns
        )
    )

    if missing:

        raise EmissionRasterizationError(
            "A3.2 road-emission layer is missing "
            "required columns: "
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
            length_m
            <= 0.0
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
            emission_proxy
            <= 0.0
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
            "Every A3.2 road edge must have "
            "a non-empty geometry."
        )

    return roads


def rasterize_relative_source(
    *,
    voxel_dataset: xr.Dataset,
    road_emissions: gpd.GeoDataFrame,
    settings: RasterizationSettings,
) -> tuple[
    xr.Dataset,
    RasterizationDiagnostics,
]:
    """
    Rasterise A3.2 edge proxies into the near-ground voxel layer.

    Workflow
    --------
    road_emissions.geojson
        ↓
    project into model CRS
        ↓
    check length_m consistency
        ↓
    clip roads to voxel domain
        ↓
    intersect road line with horizontal cells
        ↓
    distribute proxy by line length
        ↓
    place on configured z layer
        ↓
    reject building voxels
        ↓
    renormalise valid source cells
        ↓
    S[z,y,x]

    At A3.3:

        sum(S) = 1

    S is not yet kg/m3/s.
    """

    _validate_voxel_dataset(
        voxel_dataset
    )

    x = np.asarray(
        voxel_dataset[
            "x"
        ].values,
        dtype=float,
    )

    y = np.asarray(
        voxel_dataset[
            "y"
        ].values,
        dtype=float,
    )

    z = np.asarray(
        voxel_dataset[
            "z"
        ].values,
        dtype=float,
    )

    building_mask = np.asarray(
        voxel_dataset[
            "B"
        ].values,
        dtype=bool,
    )

    dx = _uniform_spacing(
        x,
        "x",
    )

    dy = _uniform_spacing(
        y,
        "y",
    )

    x_edges = _cell_edges(
        x,
        dx,
    )

    y_edges = _cell_edges(
        y,
        dy,
    )

    source_z_index = (
        _nearest_coordinate_index(
            z,
            settings.source_height_m,
            coordinate_name="z",
        )
    )

    source_z_m = float(
        z[
            source_z_index
        ]
    )

    model_crs = _read_model_crs(
        voxel_dataset
    )

    roads_projected = (
        road_emissions
        .to_crs(
            model_crs
        )
    )

    _validate_projected_road_lengths(
        roads_projected,
        relative_tolerance=(
            settings
            .geometry_length_relative_tolerance
        ),
    )

    domain = box(
        float(
            x_edges[
                0
            ]
        ),
        float(
            y_edges[
                0
            ]
        ),
        float(
            x_edges[
                -1
            ]
        ),
        float(
            y_edges[
                -1
            ]
        ),
    )

    proxy_2d = np.zeros(
        (
            y.size,
            x.size,
        ),
        dtype=np.float64,
    )

    input_proxy_total = float(
        np.asarray(
            roads_projected[
                "emission_proxy"
            ],
            dtype=float,
        ).sum()
    )

    inside_proxy_total = 0.0

    intersecting_edges = 0


    for (
        _,
        row,
    ) in roads_projected.iterrows():

        geometry = (
            row.geometry
        )

        clipped = (
            geometry
            .intersection(
                domain
            )
        )

        if (
            clipped.is_empty
            or
            clipped.length
            <= 0.0
        ):
            continue


        intersecting_edges += 1


        edge_length_m = float(
            row[
                "length_m"
            ]
        )

        edge_proxy = float(
            row[
                "emission_proxy"
            ]
        )

        proxy_per_m = (
            edge_proxy
            /
            edge_length_m
        )


        expected_inside_proxy = (
            proxy_per_m
            *
            float(
                clipped.length
            )
        )


        local_contributions: list[
            tuple[
                int,
                int,
                float,
            ]
        ] = []


        raw_assigned_proxy = 0.0


        (
            min_x,
            min_y,
            max_x,
            max_y,
        ) = map(
            float,
            clipped.bounds,
        )


        col_start = min(
            x.size - 1,
            max(
                0,
                int(
                    np.floor(
                        (
                            min_x
                            -
                            x_edges[
                                0
                            ]
                        )
                        /
                        dx
                    )
                ),
            ),
        )


        col_stop = min(
            x.size - 1,
            max(
                0,
                int(
                    np.floor(
                        (
                            max_x
                            -
                            x_edges[
                                0
                            ]
                        )
                        /
                        dx
                    )
                ),
            ),
        )


        row_start = min(
            y.size - 1,
            max(
                0,
                int(
                    np.floor(
                        (
                            min_y
                            -
                            y_edges[
                                0
                            ]
                        )
                        /
                        dy
                    )
                ),
            ),
        )


        row_stop = min(
            y.size - 1,
            max(
                0,
                int(
                    np.floor(
                        (
                            max_y
                            -
                            y_edges[
                                0
                            ]
                        )
                        /
                        dy
                    )
                ),
            ),
        )


        for row_index in range(
            row_start,
            row_stop + 1,
        ):

            for col_index in range(
                col_start,
                col_stop + 1,
            ):

                cell = box(
                    float(
                        x_edges[
                            col_index
                        ]
                    ),
                    float(
                        y_edges[
                            row_index
                        ]
                    ),
                    float(
                        x_edges[
                            col_index + 1
                        ]
                    ),
                    float(
                        y_edges[
                            row_index + 1
                        ]
                    ),
                )


                intersection_length = float(
                    clipped
                    .intersection(
                        cell
                    )
                    .length
                )


                if (
                    intersection_length
                    <= 0.0
                ):
                    continue


                contribution = (
                    proxy_per_m
                    *
                    intersection_length
                )


                local_contributions.append(
                    (
                        row_index,
                        col_index,
                        contribution,
                    )
                )


                raw_assigned_proxy += (
                    contribution
                )


        if (
            expected_inside_proxy
            > 0.0
            and
            raw_assigned_proxy
            <= 0.0
        ):

            raise EmissionRasterizationError(
                "A clipped road edge has positive length "
                "but did not map to any horizontal grid cell."
            )


        # ----------------------------------------------------
        # CONSERVATION CORRECTION
        # ----------------------------------------------------
        #
        # A road exactly on a cell border can be counted
        # geometrically by both neighbouring cell polygons.
        #
        # We therefore rescale the pieces of THIS edge so that
        # their sum equals the exact clipped edge proxy.
        # ----------------------------------------------------

        correction = (
            expected_inside_proxy
            /
            raw_assigned_proxy
            if raw_assigned_proxy
            > 0.0
            else 0.0
        )


        for (
            row_index,
            col_index,
            contribution,
        ) in local_contributions:

            proxy_2d[
                row_index,
                col_index,
            ] += (
                contribution
                *
                correction
            )


        inside_proxy_total += (
            expected_inside_proxy
        )


    if (
        intersecting_edges
        == 0
        or
        inside_proxy_total
        <= 0.0
    ):

        raise EmissionRasterizationError(
            "No A3.2 road-emission geometry "
            "intersects the voxel domain."
        )


    raster_total = float(
        proxy_2d.sum()
    )


    if not np.isclose(
        raster_total,
        inside_proxy_total,
        rtol=1e-10,
        atol=1e-12,
    ):

        raise EmissionRasterizationError(
            "Horizontal road rasterisation did not "
            "conserve the clipped A3.2 emission proxy."
        )


    # ========================================================
    # BUILDING REJECTION
    # ========================================================

    solid_at_source = (
        building_mask[
            source_z_index
        ]
    )


    rejected_proxy = float(
        proxy_2d[
            solid_at_source
        ].sum()
    )


    proxy_2d = np.where(
        solid_at_source,
        0.0,
        proxy_2d,
    )


    retained_proxy = float(
        proxy_2d.sum()
    )


    if (
        retained_proxy
        <= 0.0
    ):

        raise EmissionRasterizationError(
            "All rasterised road emissions fall "
            "inside solid building voxels."
        )


    # ========================================================
    # NORMALISE SPATIAL ALLOCATION
    # ========================================================

    relative_2d = (
        proxy_2d
        /
        retained_proxy
    )


    shape = (
        building_mask.shape
    )


    source_relative = np.zeros(
        shape,
        dtype=np.float64,
    )


    source_proxy = np.zeros(
        shape,
        dtype=np.float64,
    )


    source_relative[
        source_z_index
    ] = (
        relative_2d
    )


    source_proxy[
        source_z_index
    ] = (
        proxy_2d
    )


    if np.any(
        source_relative[
            building_mask
        ]
        != 0.0
    ):

        raise EmissionRasterizationError(
            "A3.3 produced a non-zero source "
            "inside a building voxel."
        )


    relative_sum = float(
        source_relative.sum()
    )


    if not np.isclose(
        relative_sum,
        1.0,
        rtol=0.0,
        atol=1e-12,
    ):

        raise EmissionRasterizationError(
            "A3.3 relative source does not sum "
            "to one after normalisation."
        )


    diagnostics = (
        RasterizationDiagnostics(
            source_z_index=source_z_index,
            source_z_m=source_z_m,
            road_edges_total=int(
                len(
                    roads_projected
                )
            ),
            road_edges_intersecting_domain=(
                intersecting_edges
            ),
            input_proxy_total=input_proxy_total,
            proxy_inside_domain=inside_proxy_total,
            proxy_rejected_by_solids=rejected_proxy,
            proxy_retained=retained_proxy,
        )
    )


    result = _build_output_dataset(
        voxel_dataset=voxel_dataset,
        source_relative=source_relative,
        source_proxy=source_proxy,
        settings=settings,
        diagnostics=diagnostics,
    )


    return (
        result,
        diagnostics,
    )


def save_emission_source_dataset(
    dataset: xr.Dataset,
    output_path: str | Path,
    settings: RasterizationSettings,
) -> Path:
    """
    Atomically save the A3.3 netCDF.
    """

    path = (
        Path(
            output_path
        )
        .expanduser()
        .resolve()
    )

    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )


    temporary = (
        path.with_name(
            path.name
            +
            ".tmp"
        )
    )


    if temporary.exists():

        temporary.unlink()


    encoding: dict[
        str,
        dict[
            str,
            Any,
        ],
    ] = {

        "S": {

            "dtype":
                settings.output_dtype,

        },

        "S_proxy": {

            "dtype":
                settings.output_dtype,

        },

    }


    if (
        settings
        .netcdf_engine
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
                    "zlib":
                        True,

                    "complevel":
                        settings.compression_level,

                    "shuffle":
                        True,
                }
            )


    try:

        dataset.to_netcdf(
            temporary,
            engine=settings.netcdf_engine,
            encoding=encoding,
        )


        temporary.replace(
            path
        )


    finally:

        if temporary.exists():

            temporary.unlink()


    return path


def run(
    config_path: str | Path,
) -> tuple[
    Path,
    RasterizationDiagnostics,
]:
    """
    Execute A3.3 from configured input files.
    """

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


    if (
        output_path
        ==
        voxel_path
    ):

        raise ConfigError(
            "paths.emission_source_netcdf must not "
            "overwrite paths.voxel_netcdf."
        )


    voxel_dataset = (
        load_voxel_dataset(
            voxel_path
        )
    )


    road_emissions = (
        load_road_emissions(
            road_path
        )
    )


    (
        result,
        diagnostics,
    ) = (
        rasterize_relative_source(
            voxel_dataset=voxel_dataset,
            road_emissions=road_emissions,
            settings=settings,
        )
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


def parse_args() -> argparse.Namespace:
    """
    Parse command-line arguments.
    """

    parser = argparse.ArgumentParser(
        description=(
            "A3.3: rasterise A3.2 road-emission allocation "
            "into the near-ground voxel layer and write "
            "S[z,y,x] to netCDF."
        )
    )


    parser.add_argument(
        "--config",
        required=True,
        help=(
            "Project YAML path. Required so A3.3 "
            "never guesses project parameters."
        ),
    )


    return parser.parse_args()


def main() -> None:
    """
    Command-line A3.3 runner.
    """

    args = parse_args()


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
        format="%(levelname)s: %(message)s",
    )


    (
        saved,
        diagnostics,
    ) = run(
        args.config
    )


    print(
        "\nA3.3 - Road emissions -> voxel source field"
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
        f"{100.0 * diagnostics.rejected_fraction_of_inside:.4f}%"
        " of inside)"
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
        "Do not pass it to transport until A3.4 "
        "applies EDGAR and converts the source "
        "to kg/m^3/s."
    )


def _validate_voxel_dataset(
    dataset: xr.Dataset,
) -> None:
    """
    Validate the canonical A2 voxel-grid contract.
    """

    for coordinate in (
        "x",
        "y",
        "z",
    ):

        if coordinate not in dataset.coords:

            raise EmissionRasterizationError(
                "Voxel dataset is missing coordinate "
                f"{coordinate!r}."
            )


    if "B" not in dataset.data_vars:

        raise EmissionRasterizationError(
            "Voxel dataset is missing "
            "building mask variable 'B'."
        )


    if tuple(
        dataset[
            "B"
        ].dims
    ) != (
        "z",
        "y",
        "x",
    ):

        raise EmissionRasterizationError(
            "Voxel building mask B must have dimensions "
            "('z', 'y', 'x')."
        )


    x = np.asarray(
        dataset[
            "x"
        ].values,
        dtype=float,
    )


    y = np.asarray(
        dataset[
            "y"
        ].values,
        dtype=float,
    )


    z = np.asarray(
        dataset[
            "z"
        ].values,
        dtype=float,
    )


    _uniform_spacing(
        x,
        "x",
    )


    _uniform_spacing(
        y,
        "y",
    )


    _uniform_spacing(
        z,
        "z",
    )


    building = np.asarray(
        dataset[
            "B"
        ].values
    )


    if (
        building.shape
        !=
        (
            z.size,
            y.size,
            x.size,
        )
    ):

        raise EmissionRasterizationError(
            "Voxel building mask shape does not "
            "match z/y/x coordinates."
        )


    unique = set(
        np.unique(
            building
        ).tolist()
    )


    if not unique.issubset(
        {
            0,
            1,
            False,
            True,
        }
    ):

        raise EmissionRasterizationError(
            "Voxel building mask B must contain "
            "only 0=air and 1=solid."
        )


    _read_model_crs(
        dataset
    )


def _read_model_crs(
    dataset: xr.Dataset,
) -> CRS:
    """
    Read projected CRS from the A2 voxel netCDF.
    """

    crs_text: str | None = None


    if "crs" in dataset.data_vars:

        for key in (
            "crs_wkt",
            "spatial_ref",
        ):

            raw = (
                dataset[
                    "crs"
                ]
                .attrs
                .get(
                    key
                )
            )


            if raw:

                crs_text = str(
                    raw
                )

                break


    if (
        crs_text is None
        and
        dataset.attrs.get(
            "model_crs"
        )
    ):

        crs_text = str(
            dataset.attrs[
                "model_crs"
            ]
        )


    if not crs_text:

        raise EmissionRasterizationError(
            "Voxel dataset does not contain "
            "model CRS metadata."
        )


    try:

        crs = CRS.from_user_input(
            crs_text
        )


    except Exception as exc:

        raise EmissionRasterizationError(
            "Voxel dataset contains invalid "
            "model CRS metadata."
        ) from exc


    if not crs.is_projected:

        raise EmissionRasterizationError(
            "A3.3 requires a projected model CRS "
            "with metre-scale coordinates."
        )


    return crs


def _validate_projected_road_lengths(
    roads_projected: gpd.GeoDataFrame,
    *,
    relative_tolerance: float,
) -> None:
    """
    Verify the projected geometry still matches A3.1 length_m.
    """

    measured = np.asarray(
        roads_projected
        .geometry
        .length,
        dtype=float,
    )


    recorded = np.asarray(
        roads_projected[
            "length_m"
        ],
        dtype=float,
    )


    relative_error = (
        np.abs(
            measured
            -
            recorded
        )
        /
        recorded
    )


    bad = (
        relative_error
        >
        relative_tolerance
    )


    if np.any(
        bad
    ):

        worst = int(
            np.argmax(
                relative_error
            )
        )


        raise EmissionRasterizationError(
            "Projected road geometry is inconsistent "
            "with A3.1 length_m. "
            "Worst relative error="
            f"{relative_error[worst]:.6f}, "
            "configured tolerance="
            f"{relative_tolerance:.6f}."
        )


def _build_output_dataset(
    *,
    voxel_dataset: xr.Dataset,
    source_relative: np.ndarray,
    source_proxy: np.ndarray,
    settings: RasterizationSettings,
    diagnostics: RasterizationDiagnostics,
) -> xr.Dataset:
    """
    Build the A3.3 CF-style emission dataset.
    """

    coordinates: dict[
        str,
        xr.DataArray,
    ] = {}


    for name in (
        "x",
        "y",
        "z",
    ):

        coordinates[
            name
        ] = (
            voxel_dataset[
                name
            ]
            .copy(
                deep=True
            )
        )


    output = xr.Dataset(

        data_vars={

            "S": (
                (
                    "z",
                    "y",
                    "x",
                ),
                source_relative,
            ),

            "S_proxy": (
                (
                    "z",
                    "y",
                    "x",
                ),
                source_proxy,
            ),

            "crs": (
                voxel_dataset[
                    "crs"
                ]
                .copy(
                    deep=True
                )
            ),

        },

        coords=coordinates,

    )


    output[
        "S"
    ].attrs.update(
        {
            "long_name":
                (
                    "relative traffic-emission spatial allocation "
                    "pending EDGAR normalisation"
                ),

            "units":
                "1",

            "grid_mapping":
                "crs",

            "normalization_status":
                "pending_A3.4_EDGAR",

            "transport_ready":
                "false",

            "source_height_requested_m":
                settings.source_height_m,

            "source_height_voxel_center_m":
                diagnostics.source_z_m,
        }
    )


    output[
        "S_proxy"
    ].attrs.update(
        {
            "long_name":
                (
                    "A3.2 emission proxy raster retained "
                    "in valid source voxels"
                ),

            "units":
                "g vehicle-1",

            "grid_mapping":
                "crs",

            "normalization_status":
                "pending_A3.4_EDGAR",
        }
    )


    output.attrs.update(
        {
            "stage":
                "A3.3",

            "grid_order":
                "z,y,x",

            "source_z_index":
                diagnostics.source_z_index,

            "source_z_m":
                diagnostics.source_z_m,

            "road_edges_total":
                diagnostics.road_edges_total,

            "road_edges_intersecting_domain":
                (
                    diagnostics
                    .road_edges_intersecting_domain
                ),

            "input_proxy_total":
                diagnostics.input_proxy_total,

            "proxy_inside_domain":
                diagnostics.proxy_inside_domain,

            "proxy_rejected_by_solids":
                diagnostics.proxy_rejected_by_solids,

            "proxy_rejected_fraction_of_inside":
                (
                    diagnostics
                    .rejected_fraction_of_inside
                ),

            "proxy_retained":
                diagnostics.proxy_retained,

            "relative_source_sum":
                float(
                    source_relative.sum()
                ),

            "normalization_status":
                "pending_A3.4_EDGAR",

            "transport_ready":
                "false",
        }
    )


    return output


def _uniform_spacing(
    values: np.ndarray,
    name: str,
) -> float:
    """
    Validate one uniformly spaced coordinate.
    """

    if (
        values.ndim
        != 1
        or
        values.size
        < 2
    ):

        raise EmissionRasterizationError(
            f"Coordinate {name!r} must contain "
            "at least two 1D values."
        )


    if np.any(
        ~np.isfinite(
            values
        )
    ):

        raise EmissionRasterizationError(
            f"Coordinate {name!r} contains "
            "non-finite values."
        )


    differences = np.diff(
        values
    )


    if np.any(
        differences
        <= 0.0
    ):

        raise EmissionRasterizationError(
            f"Coordinate {name!r} must "
            "increase strictly."
        )


    if not np.allclose(
        differences,
        differences[
            0
        ],
        rtol=1e-10,
        atol=1e-12,
    ):

        raise EmissionRasterizationError(
            f"Coordinate {name!r} must "
            "be uniformly spaced."
        )


    return float(
        differences[
            0
        ]
    )


def _cell_edges(
    centres: np.ndarray,
    spacing: float,
) -> np.ndarray:
    """
    Convert cell-centre coordinates to cell boundaries.
    """

    edges = np.empty(
        centres.size + 1,
        dtype=float,
    )


    edges[
        0
    ] = (
        centres[
            0
        ]
        -
        0.5
        *
        spacing
    )


    edges[
        1:
    ] = (
        centres
        +
        0.5
        *
        spacing
    )


    return edges


def _nearest_coordinate_index(
    values: np.ndarray,
    requested: float,
    *,
    coordinate_name: str,
) -> int:
    """
    Select the coordinate centre nearest the configured value.
    """

    spacing = _uniform_spacing(
        values,
        coordinate_name,
    )


    lower_edge = float(
        values[
            0
        ]
        -
        0.5
        *
        spacing
    )


    upper_edge = float(
        values[
            -1
        ]
        +
        0.5
        *
        spacing
    )


    if (
        requested
        <
        lower_edge
        or
        requested
        >
        upper_edge
    ):

        raise ConfigError(
            "Configured source height "
            f"{requested} lies outside the voxel "
            f"{coordinate_name}-domain "
            f"[{lower_edge}, {upper_edge}] m."
        )


    return int(
        np.argmin(
            np.abs(
                values
                -
                requested
            )
        )
    )


def _required_nonnegative_float(
    config: dict[
        str,
        Any,
    ],
    key: str,
) -> float:
    """
    Read one finite non-negative floating configuration value.
    """

    raw = get_required(
        config,
        key,
    )


    if isinstance(
        raw,
        bool,
    ):

        raise ConfigError(
            f"Configuration key '{key}' must be "
            "a non-negative number."
        )


    try:

        value = float(
            raw
        )


    except (
        TypeError,
        ValueError,
    ) as exc:

        raise ConfigError(
            f"Configuration key '{key}' must be "
            "a non-negative number."
        ) from exc


    if (
        not np.isfinite(
            value
        )
        or
        value
        < 0.0
    ):

        raise ConfigError(
            f"Configuration key '{key}' must "
            "be finite and >= 0."
        )


    return value


if __name__ == "__main__":

    main()