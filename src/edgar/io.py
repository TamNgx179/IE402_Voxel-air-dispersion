from __future__ import annotations

import json
import logging
import shutil
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
import requests
import xarray as xr
from pyproj import CRS

from edgar.config import (
    EdgarNormalizationError,
    EdgarSettings,
    NormalizationDiagnostics,
)

LOGGER = logging.getLogger("edgar_normalizer")


def ensure_edgar_archive(
    path: str | Path,
    settings: EdgarSettings,
) -> Path:
    archive = Path(path).expanduser().resolve()

    if archive.exists():
        if not zipfile.is_zipfile(archive):
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
        archive.name + ".part"
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

            with temporary.open("wb") as handle:
                for chunk in response.iter_content(
                    chunk_size=1024 * 1024
                ):
                    if chunk:
                        handle.write(chunk)

        if not zipfile.is_zipfile(temporary):
            raise EdgarNormalizationError(
                "Downloaded EDGAR response is not "
                f"a valid ZIP: {settings.archive_url}"
            )

        temporary.replace(archive)

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
    archive = Path(
        archive_path
    ).expanduser().resolve()

    destination = Path(
        extract_dir
    ).expanduser().resolve()

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
            if name.lower().endswith(".nc")
            and not name.endswith("/")
        ]

        if settings.member_name is None:
            if len(members) != 1:
                raise EdgarNormalizationError(
                    "EDGAR archive must contain exactly "
                    "one .nc file when member_name is null. "
                    f"Found: {', '.join(members)}"
                )

            selected = members[0]

        else:
            if settings.member_name not in bundle.namelist():
                raise EdgarNormalizationError(
                    "Configured EDGAR member_name was "
                    f"not found: {settings.member_name}"
                )

            selected = settings.member_name

        output = (
            destination
            / Path(selected).name
        )

        if not output.exists():
            with bundle.open(selected) as source:
                with output.open("wb") as target:
                    shutil.copyfileobj(
                        source,
                        target,
                    )

    return output.resolve()


def load_relative_source(
    path: str | Path,
) -> xr.Dataset:
    source_path = Path(
        path
    ).expanduser().resolve()

    if not source_path.exists():
        raise FileNotFoundError(
            f"A3.3 source netCDF not found: {source_path}"
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
                "A3.3 dataset is missing "
                f"coordinate {coord!r}."
            )

    if (
        "S" not in dataset
        or tuple(dataset["S"].dims)
        != ("z", "y", "x")
    ):
        raise EdgarNormalizationError(
            "A3.3 S must exist with dimensions "
            "('z','y','x')."
        )

    if (
        str(
            dataset["S"].attrs.get(
                "units",
                "",
            )
        ).strip()
        != "1"
    ):
        raise EdgarNormalizationError(
            "A3.3 S must be dimensionless "
            "before EDGAR normalization."
        )

    _validated_relative_source(
        dataset["S"].values
    )

    _read_model_crs(
        dataset
    )

    return dataset


def load_edgar_flux(
    path: str | Path,
    settings: EdgarSettings,
) -> xr.DataArray:
    nc_path = Path(
        path
    ).expanduser().resolve()

    if not nc_path.exists():
        raise FileNotFoundError(
            "Extracted EDGAR NetCDF "
            f"not found: {nc_path}"
        )

    with xr.open_dataset(
        nc_path
    ) as opened:
        if settings.variable_name not in opened:
            raise EdgarNormalizationError(
                f"EDGAR variable "
                f"{settings.variable_name!r} not found. "
                f"Available: {', '.join(opened.data_vars)}"
            )

        if (
            settings.latitude_coordinate
            not in opened.coords
            or settings.longitude_coordinate
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
            .squeeze(drop=True)
            .load()
        )

    if set(data.dims) != {
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
        _units(units)
        != _units(settings.expected_units)
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
        np.isinf(values)
    ):
        raise EdgarNormalizationError(
            "EDGAR flux contains infinite values."
        )

    return data


def save_transport_source(
    dataset: xr.Dataset,
    output_path: str | Path,
    settings: EdgarSettings,
) -> Path:
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
    ] = {}

    for name in (
        "S",
        "S_relative",
        "S_proxy",
    ):
        if name in dataset:
            encoding[name] = {
                "dtype": settings.output_dtype,
            }

            if (
                settings.netcdf_engine.lower()
                in {
                    "netcdf4",
                    "h5netcdf",
                }
            ):
                encoding[name].update(
                    {
                        "zlib": True,
                        "complevel": (
                            settings.compression_level
                        ),
                        "shuffle": True,
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
    report = Path(
        path
    ).expanduser().resolve()

    report.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    payload = {
        "stage": "A3.4",
        "status": "COMPLETED",
        "method": settings.method,
        "spatial_proxy_pollutant": (
            settings.spatial_proxy_pollutant
        ),
        "target_pollutant": (
            settings.target_pollutant
        ),
        "spatial_proxy_role": (
            "relative_allocation_only"
        ),
        "edgar": {
            "release": settings.release,
            "year": settings.year,
            "sector_code": (
                settings.sector_code
            ),
            "sector_description": (
                settings.sector_description
            ),
            "product": settings.product,
            "archive_url": (
                settings.archive_url
            ),
            "netcdf": str(
                Path(
                    edgar_netcdf
                ).resolve()
            ),
            "variable": (
                settings.variable_name
            ),
            "units": (
                settings.expected_units
            ),
            "attribution": (
                settings.attribution
            ),
        },
        "inputs": {
            "relative_source_netcdf": str(
                Path(
                    source_netcdf
                ).resolve()
            ),
            "persisted_relative_source_sum": (
                diagnostics
                .persisted_relative_source_sum
            ),
        },
        "output": {
            "transport_source_netcdf": str(
                Path(
                    output_netcdf
                ).resolve()
            ),
            "S_units": "kg m-3 s-1",
            "transport_ready": True,
        },
        "normalization": {
            "domain_area_m2": (
                diagnostics.domain_area_m2
            ),
            "covered_area_m2": (
                diagnostics.covered_area_m2
            ),
            "target_total_kg_s": (
                diagnostics.target_total_kg_s
            ),
            "area_weighted_flux_kg_m2_s": (
                diagnostics
                .area_weighted_flux_kg_m2_s
            ),
            "voxel_volume_m3": (
                diagnostics.voxel_volume_m3
            ),
            "normalized_relative_source_sum": (
                diagnostics
                .normalized_relative_source_sum
            ),
            "integrated_transport_source_kg_s": (
                diagnostics
                .integrated_transport_source_kg_s
            ),
            "proxy_retained": (
                diagnostics.proxy_retained
            ),
            "factor_kg_s_per_proxy_unit": (
                diagnostics
                .normalization_factor_kg_s_per_proxy_unit
            ),
        },
        "edgar_cells": [
            item.__dict__
            for item
            in diagnostics.contributions
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
            "A3.3 S must use a floating "
            "storage dtype."
        )

    source = np.asarray(
        array,
        dtype=np.float64,
    )

    if (
        np.any(~np.isfinite(source))
        or np.any(source < 0)
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

    if abs(total - 1.0) > allowed:
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
            normalized > 0
        )

        if positive.size == 0:
            raise EdgarNormalizationError(
                "A3.3 S contains no positive source cell."
            )

        flat = normalized.reshape(
            -1
        )

        index = int(
            positive[-1]
        )

        if (
            flat[index]
            + residual
            < 0
        ):
            raise EdgarNormalizationError(
                "Float64 normalization residual "
                "would make a source cell negative."
            )

        flat[index] += residual

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

    ne = count * eps

    if ne >= 1:
        raise EdgarNormalizationError(
            "A3.3 source is too large for stable "
            f"normalization in dtype {array.dtype}."
        )

    return (
        ne
        /
        (1.0 - ne)
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
            ].attrs.get(key):
                text = str(
                    dataset[
                        "crs"
                    ].attrs[key]
                )
                break

    if (
        text is None
        and dataset.attrs.get(
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


def _units(
    value: str,
) -> str:
    return "".join(
        value
        .lower()
        .replace("**", "")
        .replace("^", "")
        .split()
    )