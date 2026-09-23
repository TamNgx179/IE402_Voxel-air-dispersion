from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import Any

import numpy as np
import xarray as xr
from pyproj import CRS, Transformer
from shapely.geometry import Polygon, box
from shapely.ops import transform as shapely_transform

from project_config import (
    ConfigError,
    load_project_config,
    resolve_repo_path,
)

from edgar.config import (
    EdgarCellContribution,
    EdgarNormalizationError,
    EdgarSettings,
    NormalizationDiagnostics,
    _text,
    read_edgar_settings,
)

from edgar.io import (
    _read_model_crs,
    _validated_relative_source,
    ensure_edgar_archive,
    extract_edgar_netcdf,
    load_edgar_flux,
    load_relative_source,
    save_transport_source,
    write_normalization_report,
)

LOGGER = logging.getLogger(
    "edgar_normalizer"
)


def normalize_with_edgar(
    *,
    relative_dataset: xr.Dataset,
    edgar_flux: xr.DataArray,
    settings: EdgarSettings,
) -> tuple[
    xr.Dataset,
    NormalizationDiagnostics,
]:
    (
        persisted_sum,
        relative,
    ) = _validated_relative_source(
        relative_dataset["S"].values
    )

    normalized_sum = float(
        np.sum(
            relative,
            dtype=np.float64,
        )
    )

    x = np.asarray(
        relative_dataset["x"].values,
        dtype=np.float64,
    )

    y = np.asarray(
        relative_dataset["y"].values,
        dtype=np.float64,
    )

    z = np.asarray(
        relative_dataset["z"].values,
        dtype=np.float64,
    )

    dx = _spacing(
        x,
        "x",
    )

    dy = _spacing(
        y,
        "y",
    )

    dz = _spacing(
        z,
        "z",
    )

    xe = _edges(
        x,
        dx,
    )

    ye = _edges(
        y,
        dy,
    )

    model_crs = _read_model_crs(
        relative_dataset
    )

    domain = box(
        float(
            min(
                xe[0],
                xe[-1],
            )
        ),
        float(
            min(
                ye[0],
                ye[-1],
            )
        ),
        float(
            max(
                xe[0],
                xe[-1],
            )
        ),
        float(
            max(
                ye[0],
                ye[-1],
            )
        ),
    )

    domain_area = float(
        domain.area
    )

    if (
        not np.isfinite(
            domain_area
        )
        or domain_area <= 0
    ):
        raise EdgarNormalizationError(
            "Model domain area is non-positive."
        )

    lat_name = (
        settings.latitude_coordinate
    )

    lon_name = (
        settings.longitude_coordinate
    )

    lat = np.asarray(
        edgar_flux[
            lat_name
        ].values,
        dtype=np.float64,
    )

    lon = np.asarray(
        edgar_flux[
            lon_name
        ].values,
        dtype=np.float64,
    )

    late = _edges(
        lat,
        _spacing(
            lat,
            lat_name,
        ),
    )

    lone = _edges(
        lon,
        _spacing(
            lon,
            lon_name,
        ),
    )

    wgs84 = CRS.from_epsg(
        4326
    )

    to_wgs84 = Transformer.from_crs(
        model_crs,
        wgs84,
        always_xy=True,
    )

    from_wgs84 = Transformer.from_crs(
        wgs84,
        model_crs,
        always_xy=True,
    )

    bounds = shapely_transform(
        to_wgs84.transform,
        domain,
    ).bounds

    (
        min_lon,
        min_lat,
        max_lon,
        max_lat,
    ) = map(
        float,
        bounds,
    )

    lat_indices = _overlaps(
        late,
        min_lat,
        max_lat,
    )

    lon_indices = _overlaps(
        lone,
        min_lon,
        max_lon,
    )

    if (
        not lat_indices
        or not lon_indices
    ):
        raise EdgarNormalizationError(
            "Model domain does not overlap "
            "the configured EDGAR grid."
        )

    contributions: list[
        EdgarCellContribution
    ] = []

    covered_area = 0.0
    target = 0.0

    for i in lat_indices:
        for j in lon_indices:
            flux = float(
                edgar_flux.isel(
                    {
                        lat_name: i,
                        lon_name: j,
                    }
                ).values
            )

            if not np.isfinite(
                flux
            ):
                raise EdgarNormalizationError(
                    "EDGAR contains a non-finite flux "
                    "over the model domain."
                )

            if flux < 0:
                raise EdgarNormalizationError(
                    "EDGAR flux must be non-negative."
                )

            (
                lon0,
                lon1,
            ) = sorted(
                (
                    float(
                        lone[j]
                    ),
                    float(
                        lone[j + 1]
                    ),
                )
            )

            (
                lat0,
                lat1,
            ) = sorted(
                (
                    float(
                        late[i]
                    ),
                    float(
                        late[i + 1]
                    ),
                )
            )

            geographic_cell = Polygon(
                [
                    (
                        lon0,
                        lat0,
                    ),
                    (
                        lon1,
                        lat0,
                    ),
                    (
                        lon1,
                        lat1,
                    ),
                    (
                        lon0,
                        lat1,
                    ),
                ]
            )

            model_cell = shapely_transform(
                from_wgs84.transform,
                geographic_cell,
            )

            overlap = float(
                domain
                .intersection(
                    model_cell
                )
                .area
            )

            if overlap <= 0:
                continue

            emission = (
                flux
                *
                overlap
            )

            contributions.append(
                EdgarCellContribution(
                    latitude=float(
                        lat[i]
                    ),
                    longitude=float(
                        lon[j]
                    ),
                    flux_kg_m2_s=flux,
                    overlap_area_m2=overlap,
                    emission_kg_s=emission,
                )
            )

            covered_area += overlap
            target += emission

    area_error = (
        abs(
            covered_area
            -
            domain_area
        )
        /
        domain_area
    )

    if (
        area_error
        >
        settings
        .area_coverage_relative_tolerance
    ):
        raise EdgarNormalizationError(
            "EDGAR cells do not cover the model "
            "domain within configured tolerance; "
            f"relative error={area_error:.6g}."
        )

    if (
        not np.isfinite(
            target
        )
        or target <= 0
    ):
        raise EdgarNormalizationError(
            "EDGAR-derived road-transport "
            "emission must be > 0 kg/s."
        )

    voxel_volume = (
        dx
        *
        dy
        *
        dz
    )

    source = (
        relative
        *
        target
        /
        voxel_volume
    )

    integrated = float(
        np.sum(
            source,
            dtype=np.float64,
        )
        *
        voxel_volume
    )

    allowed_mass_error = (
        _sum_bound64(
            source
        )
        *
        voxel_volume
        +
        np.finfo(
            np.float64
        ).eps
        *
        max(
            abs(target),
            abs(integrated),
            np.finfo(
                np.float64
            ).tiny,
        )
    )

    if (
        abs(
            integrated
            -
            target
        )
        >
        allowed_mass_error
    ):
        raise EdgarNormalizationError(
            "Volumetric source does not conserve "
            "the EDGAR target after float64 "
            "renormalization: "
            f"target={target:.17g}, "
            f"integrated={integrated:.17g}."
        )

    proxy = _positive_attr(
        relative_dataset.attrs,
        "proxy_retained",
    )

    factor = (
        target
        /
        proxy
    )

    weighted_flux = (
        target
        /
        domain_area
    )

    output = (
        relative_dataset
        .copy(
            deep=True
        )
        .rename(
            {
                "S": "S_relative",
            }
        )
    )

    output[
        "S_relative"
    ] = (
        (
            "z",
            "y",
            "x",
        ),
        relative,
    )

    output[
        "S"
    ] = (
        (
            "z",
            "y",
            "x",
        ),
        source,
    )

    output[
        "S"
    ].attrs.update(
        {
            "long_name": (
                f"transport-ready "
                f"{settings.target_pollutant} "
                "traffic emission source"
            ),
            "units": "kg m-3 s-1",
            "grid_mapping": "crs",
            "normalization_status": (
                "EDGAR_normalized"
            ),
            "transport_ready": "true",
            "target_pollutant": (
                settings.target_pollutant
            ),
            "spatial_proxy_pollutant": (
                settings
                .spatial_proxy_pollutant
            ),
        }
    )

    output[
        "S_relative"
    ].attrs.update(
        {
            "long_name": (
                "A3.3 spatial emission allocation "
                "renormalized in float64"
            ),
            "units": "1",
            "transport_ready": "false",
            "persisted_input_sum": (
                persisted_sum
            ),
            "normalized_sum": (
                normalized_sum
            ),
        }
    )

    output.attrs.update(
        {
            "stage": "A3.4",
            "normalization_status": (
                "EDGAR_normalized"
            ),
            "transport_ready": "true",
            "target_pollutant": (
                settings.target_pollutant
            ),
            "spatial_proxy_pollutant": (
                settings
                .spatial_proxy_pollutant
            ),
            "spatial_proxy_role": (
                "relative_allocation_only"
            ),
            "normalization_method": (
                settings.method
            ),
            "edgar_release": (
                settings.release
            ),
            "edgar_year": (
                settings.year
            ),
            "edgar_sector_code": (
                settings.sector_code
            ),
            "edgar_sector_description": (
                settings
                .sector_description
            ),
            "edgar_product": (
                settings.product
            ),
            "edgar_archive_url": (
                settings.archive_url
            ),
            "edgar_expected_units": (
                settings.expected_units
            ),
            "domain_area_m2": (
                domain_area
            ),
            "edgar_covered_area_m2": (
                covered_area
            ),
            "edgar_target_total_kg_s": (
                target
            ),
            "edgar_area_weighted_flux_kg_m2_s": (
                weighted_flux
            ),
            "voxel_volume_m3": (
                voxel_volume
            ),
            "a33_persisted_relative_source_sum": (
                persisted_sum
            ),
            "a34_normalized_relative_source_sum": (
                normalized_sum
            ),
            "normalization_factor_kg_s_per_proxy_unit": (
                factor
            ),
            "integrated_transport_source_kg_s": (
                integrated
            ),
            "attribution": (
                settings.attribution
            ),
        }
    )

    diagnostics = (
        NormalizationDiagnostics(
            domain_area_m2=domain_area,
            covered_area_m2=covered_area,
            target_total_kg_s=target,
            area_weighted_flux_kg_m2_s=(
                weighted_flux
            ),
            voxel_volume_m3=(
                voxel_volume
            ),
            persisted_relative_source_sum=(
                persisted_sum
            ),
            normalized_relative_source_sum=(
                normalized_sum
            ),
            integrated_transport_source_kg_s=(
                integrated
            ),
            proxy_retained=proxy,
            normalization_factor_kg_s_per_proxy_unit=(
                factor
            ),
            contributions=tuple(
                contributions
            ),
        )
    )

    return (
        output,
        diagnostics,
    )


def run(
    config_path: str | Path,
) -> tuple[
    Path,
    Path,
    Path,
    NormalizationDiagnostics,
]:
    config = load_project_config(
        config_path
    )

    settings = read_edgar_settings(
        config
    )

    relative_path = resolve_repo_path(
        config,
        "paths.emission_source_netcdf",
    )

    archive_path = resolve_repo_path(
        config,
        "paths.edgar_archive",
    )

    extract_dir = resolve_repo_path(
        config,
        "paths.edgar_extract_dir",
    )

    output_path = resolve_repo_path(
        config,
        "paths.emission_source_transport_netcdf",
    )

    report_path = resolve_repo_path(
        config,
        "paths.edgar_normalization_report",
    )

    if output_path == relative_path:
        raise ConfigError(
            "A3.4 output must not overwrite "
            "A3.3 source."
        )

    relative = load_relative_source(
        relative_path
    )

    archive = ensure_edgar_archive(
        archive_path,
        settings,
    )

    edgar_nc = extract_edgar_netcdf(
        archive,
        extract_dir,
        settings,
    )

    flux = load_edgar_flux(
        edgar_nc,
        settings,
    )

    (
        output,
        diagnostics,
    ) = normalize_with_edgar(
        relative_dataset=relative,
        edgar_flux=flux,
        settings=settings,
    )

    saved = save_transport_source(
        output,
        output_path,
        settings,
    )

    report = write_normalization_report(
        report_path,
        settings,
        diagnostics,
        edgar_netcdf=edgar_nc,
        source_netcdf=relative_path,
        output_netcdf=saved,
    )

    return (
        saved,
        report,
        edgar_nc,
        diagnostics,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "A3.4 EDGAR normalization"
        )
    )

    parser.add_argument(
        "--config",
        required=True,
    )

    args = parser.parse_args()

    config = load_project_config(
        args.config
    )

    level_name = _text(
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
        report,
        edgar_nc,
        diagnostics,
    ) = run(
        args.config
    )

    print(
        "\nA3.4 - EDGAR normalization"
    )

    print(
        "=" * 78
    )

    print(
        f"EDGAR netCDF: {edgar_nc}"
    )

    print(
        "EDGAR cells overlapping "
        "model domain: "
        f"{len(diagnostics.contributions)}"
    )

    print(
        "Model-domain area: "
        f"{diagnostics.domain_area_m2:.3f} m^2"
    )

    print(
        "EDGAR-covered area: "
        f"{diagnostics.covered_area_m2:.3f} m^2"
    )

    print(
        "Area-weighted EDGAR flux: "
        f"{diagnostics.area_weighted_flux_kg_m2_s:.12g} "
        "kg/m^2/s"
    )

    print(
        "Target road-transport emission: "
        f"{diagnostics.target_total_kg_s:.12g} "
        "kg/s"
    )

    print(
        "Voxel volume: "
        f"{diagnostics.voxel_volume_m3:.3f} "
        "m^3"
    )

    print(
        "A3.3 persisted S sum: "
        f"{diagnostics.persisted_relative_source_sum:.17g}"
    )

    print(
        "A3.4 normalized S_relative sum: "
        f"{diagnostics.normalized_relative_source_sum:.17g}"
    )

    print(
        "A3.3 proxy retained: "
        f"{diagnostics.proxy_retained:.12g}"
    )

    print(
        "Normalization factor: "
        f"{diagnostics.normalization_factor_kg_s_per_proxy_unit:.12g} "
        "kg/s per proxy-unit"
    )

    print(
        "Integrated final S: "
        f"{diagnostics.integrated_transport_source_kg_s:.12g} "
        "kg/s"
    )

    print(
        "Saved transport-ready source: "
        f"{saved}"
    )

    print(
        "Saved normalization report: "
        f"{report}"
    )

    print(
        "A3.4 transport source units: "
        "kg/m^3/s"
    )


def _sum_bound64(
    array: np.ndarray,
) -> float:
    count = max(
        int(
            np.count_nonzero(
                array
            )
        ),
        1,
    )

    eps = float(
        np.finfo(
            np.float64
        ).eps
    )

    ne = (
        count
        *
        eps
    )

    return (
        ne
        /
        (1.0 - ne)
        *
        float(
            np.sum(
                np.abs(
                    array
                ),
                dtype=np.float64,
            )
        )
    )


def _spacing(
    values: np.ndarray,
    name: str,
) -> float:
    if (
        values.ndim != 1
        or values.size < 2
        or np.any(
            ~np.isfinite(
                values
            )
        )
    ):
        raise EdgarNormalizationError(
            f"Coordinate {name!r} is invalid."
        )

    diff = np.diff(
        values
    )

    if not (
        np.all(diff > 0)
        or np.all(diff < 0)
    ):
        raise EdgarNormalizationError(
            f"Coordinate {name!r} must be "
            "strictly monotonic."
        )

    spacing = abs(
        float(
            diff[0]
        )
    )

    if not np.allclose(
        np.abs(
            diff
        ),
        spacing,
        rtol=(
            np.finfo(
                np.float64
            ).eps
            *
            values.size
        ),
        atol=(
            np.finfo(
                np.float64
            ).eps
            *
            max(
                spacing,
                1.0,
            )
        ),
    ):
        raise EdgarNormalizationError(
            f"Coordinate {name!r} must be "
            "uniformly spaced."
        )

    return spacing


def _edges(
    centres: np.ndarray,
    spacing: float,
) -> np.ndarray:
    if (
        centres[0]
        <
        centres[-1]
    ):
        return np.concatenate(
            (
                [
                    centres[0]
                    -
                    spacing / 2
                ],
                centres
                +
                spacing / 2,
            )
        )

    return np.concatenate(
        (
            [
                centres[0]
                +
                spacing / 2
            ],
            centres
            -
            spacing / 2,
        )
    )


def _overlaps(
    edges: np.ndarray,
    lower: float,
    upper: float,
) -> list[int]:
    return [
        index
        for index
        in range(
            edges.size - 1
        )
        if (
            max(
                float(
                    edges[index]
                ),
                float(
                    edges[index + 1]
                ),
            )
            >
            lower
            and
            min(
                float(
                    edges[index]
                ),
                float(
                    edges[index + 1]
                ),
            )
            <
            upper
        )
    ]


def _positive_attr(
    attrs: dict[str, Any],
    key: str,
) -> float:
    if key not in attrs:
        raise EdgarNormalizationError(
            "A3.3 dataset is missing "
            f"attribute {key!r}."
        )

    try:
        value = float(
            attrs[key]
        )

    except (
        TypeError,
        ValueError,
    ) as exc:
        raise EdgarNormalizationError(
            "A3.3 attribute "
            f"{key!r} must be numeric."
        ) from exc

    if (
        not np.isfinite(
            value
        )
        or value <= 0
    ):
        raise EdgarNormalizationError(
            "A3.3 attribute "
            f"{key!r} must be finite and > 0."
        )

    return value