"""Rasterise relative road emissions onto the canonical voxel grid (A3.3)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import geopandas as gpd
import numpy as np
import xarray as xr
from pyproj import CRS
from shapely.geometry import box

from project_config import (
    ConfigError,
    get_required,
)


class EmissionRasterizationError(
    ValueError
):
    """Raised when A3.3 cannot build a valid voxel emission field."""


@dataclass(frozen=True)
class RasterizationSettings:
    """Validated A3.3 settings read from project YAML."""

    source_height_m: float

    geometry_length_relative_tolerance: float

    output_dtype: str

    netcdf_engine: str

    compression_level: int


@dataclass(frozen=True)
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

    At A3.3, sum(S) = 1.

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
            x_edges[0]
        ),
        float(
            y_edges[0]
        ),
        float(
            x_edges[-1]
        ),
        float(
            y_edges[-1]
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
        geometry = row.geometry

        clipped = geometry.intersection(
            domain
        )

        if (
            clipped.is_empty
            or clipped.length <= 0.0
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
                            x_edges[0]
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
                            x_edges[0]
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
                            y_edges[0]
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
                            y_edges[0]
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
                    clipped.intersection(
                        cell
                    ).length
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
            expected_inside_proxy > 0.0
            and
            raw_assigned_proxy <= 0.0
        ):
            raise EmissionRasterizationError(
                "A clipped road edge has positive "
                "length but did not map to any "
                "horizontal grid cell."
            )

        correction = (
            expected_inside_proxy
            /
            raw_assigned_proxy
            if raw_assigned_proxy > 0.0
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
        intersecting_edges == 0
        or
        inside_proxy_total <= 0.0
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
            "Horizontal road rasterisation "
            "did not conserve the clipped "
            "A3.2 emission proxy."
        )

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

    if retained_proxy <= 0.0:
        raise EmissionRasterizationError(
            "All rasterised road emissions "
            "fall inside solid building voxels."
        )

    relative_2d = (
        proxy_2d
        /
        retained_proxy
    )

    shape = building_mask.shape

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
    ] = relative_2d

    source_proxy[
        source_z_index
    ] = proxy_2d

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
            "A3.3 relative source does not "
            "sum to one after normalisation."
        )

    diagnostics = (
        RasterizationDiagnostics(
            source_z_index=(
                source_z_index
            ),
            source_z_m=(
                source_z_m
            ),
            road_edges_total=int(
                len(
                    roads_projected
                )
            ),
            road_edges_intersecting_domain=(
                intersecting_edges
            ),
            input_proxy_total=(
                input_proxy_total
            ),
            proxy_inside_domain=(
                inside_proxy_total
            ),
            proxy_rejected_by_solids=(
                rejected_proxy
            ),
            proxy_retained=(
                retained_proxy
            ),
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


def _validate_voxel_dataset(
    dataset: xr.Dataset,
) -> None:
    """Validate the canonical A2 voxel-grid contract."""

    for coordinate in (
        "x",
        "y",
        "z",
    ):
        if coordinate not in dataset.coords:
            raise EmissionRasterizationError(
                "Voxel dataset is missing "
                f"coordinate {coordinate!r}."
            )

    if "B" not in dataset.data_vars:
        raise EmissionRasterizationError(
            "Voxel dataset is missing building "
            "mask variable 'B'."
        )

    if (
        tuple(
            dataset[
                "B"
            ].dims
        )
        !=
        (
            "z",
            "y",
            "x",
        )
    ):
        raise EmissionRasterizationError(
            "Voxel building mask B must have "
            "dimensions ('z', 'y', 'x')."
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

    if building.shape != (
        z.size,
        y.size,
        x.size,
    ):
        raise EmissionRasterizationError(
            "Voxel building mask shape "
            "does not match z/y/x coordinates."
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
            "Voxel building mask B must "
            "contain only 0=air and 1=solid."
        )

    _read_model_crs(
        dataset
    )


def _read_model_crs(
    dataset: xr.Dataset,
) -> CRS:
    """Read projected CRS from the A2 voxel netCDF."""

    crs_text: str | None = None

    if "crs" in dataset.data_vars:
        for key in (
            "crs_wkt",
            "spatial_ref",
        ):
            raw = dataset[
                "crs"
            ].attrs.get(
                key
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
            "A3.3 requires a projected model "
            "CRS with metre-scale coordinates."
        )

    return crs


def _validate_projected_road_lengths(
    roads_projected: gpd.GeoDataFrame,
    *,
    relative_tolerance: float,
) -> None:
    """Verify the projected geometry still matches A3.1 length_m."""

    measured = np.asarray(
        roads_projected.geometry.length,
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
    """Build the A3.3 CF-style emission dataset."""

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
        ] = voxel_dataset[
            name
        ].copy(
            deep=True
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
                ].copy(
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
            "long_name": (
                "relative traffic-emission "
                "spatial allocation pending "
                "EDGAR normalisation"
            ),
            "units": "1",
            "grid_mapping": "crs",
            "normalization_status": (
                "pending_A3.4_EDGAR"
            ),
            "transport_ready": "false",
            "source_height_requested_m": (
                settings.source_height_m
            ),
            "source_height_voxel_center_m": (
                diagnostics.source_z_m
            ),
        }
    )

    output[
        "S_proxy"
    ].attrs.update(
        {
            "long_name": (
                "A3.2 emission proxy raster "
                "retained in valid source voxels"
            ),
            "units": "g vehicle-1",
            "grid_mapping": "crs",
            "normalization_status": (
                "pending_A3.4_EDGAR"
            ),
        }
    )

    output.attrs.update(
        {
            "stage": "A3.3",
            "grid_order": "z,y,x",
            "source_z_index": (
                diagnostics.source_z_index
            ),
            "source_z_m": (
                diagnostics.source_z_m
            ),
            "road_edges_total": (
                diagnostics.road_edges_total
            ),
            "road_edges_intersecting_domain": (
                diagnostics
                .road_edges_intersecting_domain
            ),
            "input_proxy_total": (
                diagnostics.input_proxy_total
            ),
            "proxy_inside_domain": (
                diagnostics.proxy_inside_domain
            ),
            "proxy_rejected_by_solids": (
                diagnostics
                .proxy_rejected_by_solids
            ),
            "proxy_rejected_fraction_of_inside": (
                diagnostics
                .rejected_fraction_of_inside
            ),
            "proxy_retained": (
                diagnostics.proxy_retained
            ),
            "relative_source_sum": float(
                source_relative.sum()
            ),
            "normalization_status": (
                "pending_A3.4_EDGAR"
            ),
            "transport_ready": "false",
        }
    )

    return output


def _uniform_spacing(
    values: np.ndarray,
    name: str,
) -> float:
    """Validate one uniformly spaced coordinate."""

    if (
        values.ndim != 1
        or values.size < 2
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
        differences <= 0.0
    ):
        raise EmissionRasterizationError(
            f"Coordinate {name!r} must "
            "increase strictly."
        )

    if not np.allclose(
        differences,
        differences[0],
        rtol=1e-10,
        atol=1e-12,
    ):
        raise EmissionRasterizationError(
            f"Coordinate {name!r} must "
            "be uniformly spaced."
        )

    return float(
        differences[0]
    )


def _cell_edges(
    centres: np.ndarray,
    spacing: float,
) -> np.ndarray:
    """Convert cell-centre coordinates to cell boundaries."""

    edges = np.empty(
        centres.size + 1,
        dtype=float,
    )

    edges[0] = (
        centres[0]
        -
        0.5
        *
        spacing
    )

    edges[1:] = (
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
    """Select the coordinate centre nearest the configured value."""

    spacing = _uniform_spacing(
        values,
        coordinate_name,
    )

    lower_edge = float(
        values[0]
        -
        0.5
        *
        spacing
    )

    upper_edge = float(
        values[-1]
        +
        0.5
        *
        spacing
    )

    if (
        requested < lower_edge
        or
        requested > upper_edge
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
    config: dict[str, Any],
    key: str,
) -> float:
    """Read one finite non-negative floating configuration value."""

    raw = get_required(
        config,
        key,
    )

    if isinstance(
        raw,
        bool,
    ):
        raise ConfigError(
            "Configuration key "
            f"'{key}' must be a non-negative number."
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
            "Configuration key "
            f"'{key}' must be a non-negative number."
        ) from exc

    if (
        not np.isfinite(
            value
        )
        or value < 0.0
    ):
        raise ConfigError(
            "Configuration key "
            f"'{key}' must be finite and >= 0."
        )

    return value