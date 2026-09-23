from __future__ import annotations

import argparse
import json
import logging
import shutil
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import requests
import xarray as xr
from pyproj import CRS, Transformer
from shapely.geometry import Polygon, box
from shapely.ops import transform as shapely_transform

from project_config import ConfigError, get_required, load_project_config, resolve_repo_path

LOGGER = logging.getLogger("edgar_normalizer")


class EdgarNormalizationError(ValueError):
    pass


@dataclass(frozen=True)
class EdgarSettings:
    method: str
    spatial_proxy_pollutant: str
    target_pollutant: str
    release: str
    year: int
    sector_code: str
    sector_description: str
    product: str
    archive_url: str
    download_if_missing: bool
    download_timeout_s: float
    member_name: str | None
    variable_name: str
    latitude_coordinate: str
    longitude_coordinate: str
    expected_units: str
    area_coverage_relative_tolerance: float
    output_dtype: str
    netcdf_engine: str
    compression_level: int
    attribution: str


@dataclass(frozen=True)
class EdgarCellContribution:
    latitude: float
    longitude: float
    flux_kg_m2_s: float
    overlap_area_m2: float
    emission_kg_s: float


@dataclass(frozen=True)
class NormalizationDiagnostics:
    domain_area_m2: float
    covered_area_m2: float
    target_total_kg_s: float
    area_weighted_flux_kg_m2_s: float
    voxel_volume_m3: float
    persisted_relative_source_sum: float
    normalized_relative_source_sum: float
    integrated_transport_source_kg_s: float
    proxy_retained: float
    normalization_factor_kg_s_per_proxy_unit: float
    contributions: tuple[EdgarCellContribution, ...]

    @property
    def relative_source_sum(self) -> float:
        return self.normalized_relative_source_sum


def read_edgar_settings(config: dict[str, Any]) -> EdgarSettings:
    p = "emissions.normalization"

    member = get_required(
        config,
        f"{p}.member_name",
    )

    if member is not None and (
        not isinstance(
            member,
            str,
        )
        or not member.strip()
    ):
        raise ConfigError(
            f"Configuration key '{p}.member_name' "
            "must be null or non-empty text."
        )

    dtype_text = _text(
        config,
        f"{p}.output_dtype",
    )

    try:
        dtype = np.dtype(
            dtype_text
        )
    except TypeError as exc:
        raise ConfigError(
            f"Invalid {p}.output_dtype: {dtype_text!r}"
        ) from exc

    if not np.issubdtype(
        dtype,
        np.floating,
    ):
        raise ConfigError(
            f"{p}.output_dtype must be floating."
        )

    compression = _integer(
        config,
        f"{p}.compression_level",
        0,
    )

    if compression > 9:
        raise ConfigError(
            f"{p}.compression_level must be between 0 and 9."
        )

    return EdgarSettings(
        method=_text(
            config,
            f"{p}.method",
        ),

        spatial_proxy_pollutant=_text(
            config,
            "emissions.pollutant",
        ),

        target_pollutant=_text(
            config,
            f"{p}.target_pollutant",
        ),

        release=_text(
            config,
            f"{p}.source_release",
        ),

        year=_integer(
            config,
            f"{p}.source_year",
            1,
        ),

        sector_code=_text(
            config,
            f"{p}.source_sector_code",
        ),

        sector_description=_text(
            config,
            f"{p}.source_sector_description",
        ),

        product=_text(
            config,
            f"{p}.source_product",
        ),

        archive_url=_text(
            config,
            f"{p}.archive_url",
        ),

        download_if_missing=_boolean(
            config,
            f"{p}.download_if_missing",
        ),

        download_timeout_s=_positive(
            config,
            f"{p}.download_timeout_s",
        ),

        member_name=(
            None
            if member is None
            else member.strip()
        ),

        variable_name=_text(
            config,
            f"{p}.variable_name",
        ),

        latitude_coordinate=_text(
            config,
            f"{p}.latitude_coordinate",
        ),

        longitude_coordinate=_text(
            config,
            f"{p}.longitude_coordinate",
        ),

        expected_units=_text(
            config,
            f"{p}.expected_units",
        ),

        area_coverage_relative_tolerance=_nonnegative(
            config,
            f"{p}.area_coverage_relative_tolerance",
        ),

        output_dtype=dtype.name,

        netcdf_engine=_text(
            config,
            f"{p}.netcdf_engine",
        ),

        compression_level=compression,

        attribution=_text(
            config,
            f"{p}.attribution",
        ),
    )


def ensure_edgar_archive(
    path: str | Path,
    settings: EdgarSettings,
) -> Path:

    archive = (
        Path(
            path
        )
        .expanduser()
        .resolve()
    )

    if archive.exists():

        if not zipfile.is_zipfile(
            archive
        ):
            raise EdgarNormalizationError(
                "Configured EDGAR archive is not "
                f"a valid ZIP: {archive}"
            )

        return archive

    if not settings.download_if_missing:

        raise FileNotFoundError(
            "EDGAR archive is missing and automatic "
            "download is disabled: "
            f"{archive}\n"
            f"Source: {settings.archive_url}"
        )

    archive.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temporary = archive.with_name(
        archive.name
        +
        ".part"
    )

    if temporary.exists():
        temporary.unlink()

    LOGGER.info(
        "Downloading EDGAR archive: %s",
        settings.archive_url,
    )

    try:

        with requests.get(
            settings.archive_url,
            stream=True,
            timeout=settings.download_timeout_s,
        ) as response:

            response.raise_for_status()

            with temporary.open(
                "wb"
            ) as handle:

                for chunk in response.iter_content(
                    chunk_size=1024 * 1024
                ):

                    if chunk:
                        handle.write(
                            chunk
                        )

        if not zipfile.is_zipfile(
            temporary
        ):
            raise EdgarNormalizationError(
                "Downloaded EDGAR response is not "
                f"a valid ZIP: {settings.archive_url}"
            )

        temporary.replace(
            archive
        )

    except Exception:

        if temporary.exists():
            temporary.unlink()

        raise

    return archive


def extract_edgar_netcdf(
    archive_path: str | Path,
    extract_dir: str | Path,
    settings: EdgarSettings,
) -> Path:

    archive = (
        Path(
            archive_path
        )
        .expanduser()
        .resolve()
    )

    destination = (
        Path(
            extract_dir
        )
        .expanduser()
        .resolve()
    )

    destination.mkdir(
        parents=True,
        exist_ok=True,
    )

    with zipfile.ZipFile(
        archive,
        "r",
    ) as bundle:

        members = [
            name
            for name in bundle.namelist()
            if (
                name.lower().endswith(
                    ".nc"
                )
                and
                not name.endswith(
                    "/"
                )
            )
        ]

        if settings.member_name is None:

            if len(
                members
            ) != 1:

                raise EdgarNormalizationError(
                    "EDGAR archive must contain exactly "
                    "one .nc file when member_name is null. "
                    f"Found: {', '.join(members)}"
                )

            selected = members[
                0
            ]

        else:

            if (
                settings.member_name
                not in bundle.namelist()
            ):
                raise EdgarNormalizationError(
                    "Configured EDGAR member_name was "
                    "not found: "
                    f"{settings.member_name}"
                )

            selected = (
                settings.member_name
            )

        output = (
            destination
            /
            Path(
                selected
            ).name
        )

        if not output.exists():

            with bundle.open(
                selected
            ) as source:

                with output.open(
                    "wb"
                ) as target:

                    shutil.copyfileobj(
                        source,
                        target,
                    )

    return output.resolve()


def load_relative_source(
    path: str | Path,
) -> xr.Dataset:

    source_path = (
        Path(
            path
        )
        .expanduser()
        .resolve()
    )

    if not source_path.exists():

        raise FileNotFoundError(
            "A3.3 source netCDF not found: "
            f"{source_path}"
        )

    with xr.open_dataset(
        source_path
    ) as opened:

        dataset = opened.load()

    for coord in (
        "x",
        "y",
        "z",
    ):

        if coord not in dataset.coords:

            raise EdgarNormalizationError(
                "A3.3 dataset is missing coordinate "
                f"{coord!r}."
            )

    if (
        "S" not in dataset
        or
        tuple(
            dataset[
                "S"
            ].dims
        )
        !=
        (
            "z",
            "y",
            "x",
        )
    ):

        raise EdgarNormalizationError(
            "A3.3 S must exist with dimensions "
            "('z','y','x')."
        )

    if str(
        dataset[
            "S"
        ].attrs.get(
            "units",
            "",
        )
    ).strip() != "1":

        raise EdgarNormalizationError(
            "A3.3 S must be dimensionless "
            "before EDGAR normalization."
        )

    _validated_relative_source(
        dataset[
            "S"
        ].values
    )

    _read_model_crs(
        dataset
    )

    return dataset


def load_edgar_flux(
    path: str | Path,
    settings: EdgarSettings,
) -> xr.DataArray:

    nc_path = (
        Path(
            path
        )
        .expanduser()
        .resolve()
    )

    if not nc_path.exists():

        raise FileNotFoundError(
            "Extracted EDGAR NetCDF not found: "
            f"{nc_path}"
        )

    with xr.open_dataset(
        nc_path
    ) as opened:

        if (
            settings.variable_name
            not in opened
        ):

            raise EdgarNormalizationError(
                "EDGAR variable "
                f"{settings.variable_name!r} "
                "not found. Available: "
                f"{', '.join(opened.data_vars)}"
            )

        if (
            settings.latitude_coordinate
            not in opened.coords
            or
            settings.longitude_coordinate
            not in opened.coords
        ):

            raise EdgarNormalizationError(
                "Configured EDGAR latitude/longitude "
                "coordinates were not found."
            )

        data = (
            opened[
                settings.variable_name
            ]
            .squeeze(
                drop=True
            )
            .load()
        )

    if set(
        data.dims
    ) != {
        settings.latitude_coordinate,
        settings.longitude_coordinate,
    }:

        raise EdgarNormalizationError(
            "EDGAR flux must reduce to lat/lon "
            f"dimensions; got {data.dims}."
        )

    units = str(
        data.attrs.get(
            "units",
            "",
        )
    ).strip()

    if (
        _units(
            units
        )
        !=
        _units(
            settings.expected_units
        )
    ):

        raise EdgarNormalizationError(
            "Unexpected EDGAR flux units "
            f"{units!r}; expected "
            f"{settings.expected_units!r}."
        )

    values = np.asarray(
        data.values,
        dtype=np.float64,
    )

    if np.any(
        np.isinf(
            values
        )
    ):
        raise EdgarNormalizationError(
            "EDGAR flux contains infinite values."
        )

    return data


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
        relative_dataset[
            "S"
        ].values
    )

    normalized_sum = float(
        np.sum(
            relative,
            dtype=np.float64,
        )
    )

    x = np.asarray(
        relative_dataset[
            "x"
        ].values,
        dtype=np.float64,
    )

    y = np.asarray(
        relative_dataset[
            "y"
        ].values,
        dtype=np.float64,
    )

    z = np.asarray(
        relative_dataset[
            "z"
        ].values,
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
                xe[
                    0
                ],
                xe[
                    -1
                ],
            )
        ),
        float(
            min(
                ye[
                    0
                ],
                ye[
                    -1
                ],
            )
        ),
        float(
            max(
                xe[
                    0
                ],
                xe[
                    -1
                ],
            )
        ),
        float(
            max(
                ye[
                    0
                ],
                ye[
                    -1
                ],
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
        or
        domain_area <= 0
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
        or
        not lon_indices
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
                        lat_name:
                            i,

                        lon_name:
                            j,
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
                        lone[
                            j
                        ]
                    ),

                    float(
                        lone[
                            j + 1
                        ]
                    ),
                )
            )

            (
                lat0,
                lat1,
            ) = sorted(
                (
                    float(
                        late[
                            i
                        ]
                    ),

                    float(
                        late[
                            i + 1
                        ]
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
                    float(
                        lat[
                            i
                        ]
                    ),

                    float(
                        lon[
                            j
                        ]
                    ),

                    flux,

                    overlap,

                    emission,
                )
            )

            covered_area += (
                overlap
            )

            target += (
                emission
            )

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
        settings.area_coverage_relative_tolerance
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
        or
        target <= 0
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
            abs(
                target
            ),
            abs(
                integrated
            ),
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
                "S":
                    "S_relative"
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
            "long_name":
                (
                    f"transport-ready "
                    f"{settings.target_pollutant} "
                    "traffic emission source"
                ),

            "units":
                "kg m-3 s-1",

            "grid_mapping":
                "crs",

            "normalization_status":
                "EDGAR_normalized",

            "transport_ready":
                "true",

            "target_pollutant":
                settings.target_pollutant,

            "spatial_proxy_pollutant":
                settings.spatial_proxy_pollutant,
        }
    )

    output[
        "S_relative"
    ].attrs.update(
        {
            "long_name":
                (
                    "A3.3 spatial emission allocation "
                    "renormalized in float64"
                ),

            "units":
                "1",

            "transport_ready":
                "false",

            "persisted_input_sum":
                persisted_sum,

            "normalized_sum":
                normalized_sum,
        }
    )

    output.attrs.update(
        {
            "stage":
                "A3.4",

            "normalization_status":
                "EDGAR_normalized",

            "transport_ready":
                "true",

            "target_pollutant":
                settings.target_pollutant,

            "spatial_proxy_pollutant":
                settings.spatial_proxy_pollutant,

            "spatial_proxy_role":
                "relative_allocation_only",

            "normalization_method":
                settings.method,

            "edgar_release":
                settings.release,

            "edgar_year":
                settings.year,

            "edgar_sector_code":
                settings.sector_code,

            "edgar_sector_description":
                settings.sector_description,

            "edgar_product":
                settings.product,

            "edgar_archive_url":
                settings.archive_url,

            "edgar_expected_units":
                settings.expected_units,

            "domain_area_m2":
                domain_area,

            "edgar_covered_area_m2":
                covered_area,

            "edgar_target_total_kg_s":
                target,

            "edgar_area_weighted_flux_kg_m2_s":
                weighted_flux,

            "voxel_volume_m3":
                voxel_volume,

            "a33_persisted_relative_source_sum":
                persisted_sum,

            "a34_normalized_relative_source_sum":
                normalized_sum,

            "normalization_factor_kg_s_per_proxy_unit":
                factor,

            "integrated_transport_source_kg_s":
                integrated,

            "attribution":
                settings.attribution,
        }
    )

    diagnostics = NormalizationDiagnostics(
        domain_area,
        covered_area,
        target,
        weighted_flux,
        voxel_volume,
        persisted_sum,
        normalized_sum,
        integrated,
        proxy,
        factor,
        tuple(
            contributions
        ),
    )

    return (
        output,
        diagnostics,
    )


def save_transport_source(
    dataset: xr.Dataset,
    output_path: str | Path,
    settings: EdgarSettings,
) -> Path:

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

    temporary = path.with_name(
        path.name
        +
        ".tmp"
    )

    if temporary.exists():
        temporary.unlink()

    encoding: dict[
        str,
        dict[
            str,
            Any,
        ],
    ] = {}

    for name in (
        "S",
        "S_relative",
        "S_proxy",
    ):

        if name in dataset:

            encoding[
                name
            ] = {
                "dtype":
                    settings.output_dtype
            }

            if (
                settings
                .netcdf_engine
                .lower()
                in {
                    "netcdf4",
                    "h5netcdf",
                }
            ):

                encoding[
                    name
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


def write_normalization_report(
    path: str | Path,
    settings: EdgarSettings,
    diagnostics: NormalizationDiagnostics,
    *,
    edgar_netcdf: str | Path,
    source_netcdf: str | Path,
    output_netcdf: str | Path,
) -> Path:

    report = (
        Path(
            path
        )
        .expanduser()
        .resolve()
    )

    report.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    payload = {
        "stage":
            "A3.4",

        "status":
            "COMPLETED",

        "method":
            settings.method,

        "spatial_proxy_pollutant":
            settings.spatial_proxy_pollutant,

        "target_pollutant":
            settings.target_pollutant,

        "spatial_proxy_role":
            "relative_allocation_only",

        "edgar": {
            "release":
                settings.release,

            "year":
                settings.year,

            "sector_code":
                settings.sector_code,

            "sector_description":
                settings.sector_description,

            "product":
                settings.product,

            "archive_url":
                settings.archive_url,

            "netcdf":
                str(
                    Path(
                        edgar_netcdf
                    ).resolve()
                ),

            "variable":
                settings.variable_name,

            "units":
                settings.expected_units,

            "attribution":
                settings.attribution,
        },

        "inputs": {
            "relative_source_netcdf":
                str(
                    Path(
                        source_netcdf
                    ).resolve()
                ),

            "persisted_relative_source_sum":
                diagnostics.persisted_relative_source_sum,
        },

        "output": {
            "transport_source_netcdf":
                str(
                    Path(
                        output_netcdf
                    ).resolve()
                ),

            "S_units":
                "kg m-3 s-1",

            "transport_ready":
                True,
        },

        "normalization": {
            "domain_area_m2":
                diagnostics.domain_area_m2,

            "covered_area_m2":
                diagnostics.covered_area_m2,

            "target_total_kg_s":
                diagnostics.target_total_kg_s,

            "area_weighted_flux_kg_m2_s":
                diagnostics.area_weighted_flux_kg_m2_s,

            "voxel_volume_m3":
                diagnostics.voxel_volume_m3,

            "normalized_relative_source_sum":
                diagnostics.normalized_relative_source_sum,

            "integrated_transport_source_kg_s":
                diagnostics.integrated_transport_source_kg_s,

            "proxy_retained":
                diagnostics.proxy_retained,

            "factor_kg_s_per_proxy_unit":
                diagnostics.normalization_factor_kg_s_per_proxy_unit,
        },

        "edgar_cells": [
            item.__dict__
            for item in diagnostics.contributions
        ],
    }

    report.write_text(
        json.dumps(
            payload,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    return report


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

    if (
        output_path
        ==
        relative_path
    ):
        raise ConfigError(
            "A3.4 output must not overwrite A3.3 source."
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
        description="A3.4 EDGAR normalization"
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
            f"Invalid runtime.log_level: {level_name!r}"
        )

    logging.basicConfig(
        level=level,
        format="%(levelname)s: %(message)s",
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
        "EDGAR cells overlapping model domain: "
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
        f"{diagnostics.target_total_kg_s:.12g} kg/s"
    )

    print(
        "Voxel volume: "
        f"{diagnostics.voxel_volume_m3:.3f} m^3"
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
        f"Saved transport-ready source: {saved}"
    )

    print(
        f"Saved normalization report: {report}"
    )

    print(
        "A3.4 transport source units: kg/m^3/s"
    )


def _validated_relative_source(
    stored: np.ndarray,
) -> tuple[
    float,
    np.ndarray,
]:

    array = np.asarray(
        stored
    )

    if not np.issubdtype(
        array.dtype,
        np.floating,
    ):

        raise EdgarNormalizationError(
            "A3.3 S must use a floating storage dtype."
        )

    source = np.asarray(
        array,
        dtype=np.float64,
    )

    if (
        np.any(
            ~np.isfinite(
                source
            )
        )
        or
        np.any(
            source
            <
            0
        )
    ):

        raise EdgarNormalizationError(
            "A3.3 S contains invalid values."
        )

    total = float(
        np.sum(
            source,
            dtype=np.float64,
        )
    )

    if total <= 0:

        raise EdgarNormalizationError(
            "A3.3 S has a non-positive total."
        )

    allowed = _sum_bound_storage(
        array
    )

    if (
        abs(
            total
            -
            1.0
        )
        >
        allowed
    ):

        raise EdgarNormalizationError(
            "A3.3 S is not normalized after "
            "accounting for persisted dtype: "
            f"sum={total:.17g}, "
            f"allowed_abs_error={allowed:.17g}."
        )

    normalized = (
        source
        /
        total
    )

    residual = (
        1.0
        -
        float(
            np.sum(
                normalized,
                dtype=np.float64,
            )
        )
    )

    if residual != 0:

        positive = np.flatnonzero(
            normalized
            >
            0
        )

        if positive.size == 0:

            raise EdgarNormalizationError(
                "A3.3 S contains no positive source cell."
            )

        flat = normalized.reshape(
            -1
        )

        index = int(
            positive[
                -1
            ]
        )

        if (
            flat[
                index
            ]
            +
            residual
            <
            0
        ):

            raise EdgarNormalizationError(
                "Float64 normalization residual would "
                "make a source cell negative."
            )

        flat[
            index
        ] += residual

    return (
        total,
        normalized,
    )


def _sum_bound_storage(
    array: np.ndarray,
) -> float:

    count = int(
        np.count_nonzero(
            array
        )
    )

    if count == 0:
        return 0.0

    eps = float(
        np.finfo(
            array.dtype
        ).eps
    )

    ne = (
        count
        *
        eps
    )

    if ne >= 1:

        raise EdgarNormalizationError(
            "A3.3 source is too large for stable "
            f"normalization in dtype {array.dtype}."
        )

    return (
        ne
        /
        (
            1.0
            -
            ne
        )
        *
        float(
            np.sum(
                np.abs(
                    array.astype(
                        np.float64
                    )
                ),
                dtype=np.float64,
            )
        )
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
        (
            1.0
            -
            ne
        )
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


def _read_model_crs(
    dataset: xr.Dataset,
) -> CRS:

    text = None

    if "crs" in dataset:

        for key in (
            "crs_wkt",
            "spatial_ref",
        ):

            if dataset[
                "crs"
            ].attrs.get(
                key
            ):

                text = str(
                    dataset[
                        "crs"
                    ].attrs[
                        key
                    ]
                )

                break

    if (
        text is None
        and
        dataset.attrs.get(
            "model_crs"
        )
    ):

        text = str(
            dataset.attrs[
                "model_crs"
            ]
        )

    if not text:

        raise EdgarNormalizationError(
            "Source dataset does not contain "
            "model CRS metadata."
        )

    try:

        crs = CRS.from_user_input(
            text
        )

    except Exception as exc:

        raise EdgarNormalizationError(
            "Source dataset contains invalid "
            "CRS metadata."
        ) from exc

    if not crs.is_projected:

        raise EdgarNormalizationError(
            "A3.4 requires a projected model CRS."
        )

    return crs


def _spacing(
    values: np.ndarray,
    name: str,
) -> float:

    if (
        values.ndim != 1
        or
        values.size < 2
        or
        np.any(
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
        np.all(
            diff
            >
            0
        )
        or
        np.all(
            diff
            <
            0
        )
    ):

        raise EdgarNormalizationError(
            f"Coordinate {name!r} must "
            "be strictly monotonic."
        )

    spacing = abs(
        float(
            diff[
                0
            ]
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
            f"Coordinate {name!r} must "
            "be uniformly spaced."
        )

    return spacing


def _edges(
    centres: np.ndarray,
    spacing: float,
) -> np.ndarray:

    if (
        centres[
            0
        ]
        <
        centres[
            -1
        ]
    ):

        return np.concatenate(
            (
                [
                    centres[
                        0
                    ]
                    -
                    spacing
                    /
                    2
                ],

                centres
                +
                spacing
                /
                2,
            )
        )

    return np.concatenate(
        (
            [
                centres[
                    0
                ]
                +
                spacing
                /
                2
            ],

            centres
            -
            spacing
            /
            2,
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
            edges.size
            -
            1
        )

        if (
            max(
                float(
                    edges[
                        index
                    ]
                ),
                float(
                    edges[
                        index + 1
                    ]
                ),
            )
            >
            lower
            and
            min(
                float(
                    edges[
                        index
                    ]
                ),
                float(
                    edges[
                        index + 1
                    ]
                ),
            )
            <
            upper
        )
    ]


def _units(
    value: str,
) -> str:

    return "".join(
        value
        .lower()
        .replace(
            "**",
            "",
        )
        .replace(
            "^",
            "",
        )
        .split()
    )


def _positive_attr(
    attrs: dict[
        str,
        Any,
    ],
    key: str,
) -> float:

    if key not in attrs:

        raise EdgarNormalizationError(
            "A3.3 dataset is missing attribute "
            f"{key!r}."
        )

    try:

        value = float(
            attrs[
                key
            ]
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
        or
        value <= 0
    ):

        raise EdgarNormalizationError(
            "A3.3 attribute "
            f"{key!r} must be finite and > 0."
        )

    return value


def _text(
    config: dict[
        str,
        Any,
    ],
    key: str,
) -> str:

    value = get_required(
        config,
        key,
    )

    if (
        not isinstance(
            value,
            str,
        )
        or
        not value.strip()
    ):

        raise ConfigError(
            "Configuration key "
            f"'{key}' must be non-empty text."
        )

    return value.strip()


def _boolean(
    config: dict[
        str,
        Any,
    ],
    key: str,
) -> bool:

    value = get_required(
        config,
        key,
    )

    if not isinstance(
        value,
        bool,
    ):

        raise ConfigError(
            "Configuration key "
            f"'{key}' must be true or false."
        )

    return value


def _integer(
    config: dict[
        str,
        Any,
    ],
    key: str,
    minimum: int,
) -> int:

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
            f"'{key}' must be an integer."
        )

    try:

        value = int(
            raw
        )

    except (
        TypeError,
        ValueError,
    ) as exc:

        raise ConfigError(
            "Configuration key "
            f"'{key}' must be an integer."
        ) from exc

    if value < minimum:

        raise ConfigError(
            "Configuration key "
            f"'{key}' must be >= {minimum}."
        )

    return value


def _positive(
    config: dict[
        str,
        Any,
    ],
    key: str,
) -> float:

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
            f"'{key}' must be a positive number."
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
            f"'{key}' must be a positive number."
        ) from exc

    if (
        not np.isfinite(
            value
        )
        or
        value <= 0
    ):

        raise ConfigError(
            "Configuration key "
            f"'{key}' must be finite and > 0."
        )

    return value


def _nonnegative(
    config: dict[
        str,
        Any,
    ],
    key: str,
) -> float:

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
            f"'{key}' must be non-negative."
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
            f"'{key}' must be non-negative."
        ) from exc

    if (
        not np.isfinite(
            value
        )
        or
        value < 0
    ):

        raise ConfigError(
            "Configuration key "
            f"'{key}' must be finite and >= 0."
        )

    return value


if __name__ == "__main__":
    main()