from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from project_config import ConfigError, get_required


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

    member = get_required(config, f"{p}.member_name")

    if member is not None and (
        not isinstance(member, str) or not member.strip()
    ):
        raise ConfigError(
            f"Configuration key '{p}.member_name' "
            "must be null or non-empty text."
        )

    dtype_text = _text(config, f"{p}.output_dtype")

    try:
        dtype = np.dtype(dtype_text)
    except TypeError as exc:
        raise ConfigError(
            f"Invalid {p}.output_dtype: {dtype_text!r}"
        ) from exc

    if not np.issubdtype(dtype, np.floating):
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


def _text(
    config: dict[str, Any],
    key: str,
) -> str:
    value = get_required(
        config,
        key,
    )

    if (
        not isinstance(value, str)
        or not value.strip()
    ):
        raise ConfigError(
            f"Configuration key '{key}' "
            "must be non-empty text."
        )

    return value.strip()


def _boolean(
    config: dict[str, Any],
    key: str,
) -> bool:
    value = get_required(
        config,
        key,
    )

    if not isinstance(value, bool):
        raise ConfigError(
            f"Configuration key '{key}' "
            "must be true or false."
        )

    return value


def _integer(
    config: dict[str, Any],
    key: str,
    minimum: int,
) -> int:
    raw = get_required(
        config,
        key,
    )

    if isinstance(raw, bool):
        raise ConfigError(
            f"Configuration key '{key}' "
            "must be an integer."
        )

    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ConfigError(
            f"Configuration key '{key}' "
            "must be an integer."
        ) from exc

    if value < minimum:
        raise ConfigError(
            f"Configuration key '{key}' "
            f"must be >= {minimum}."
        )

    return value


def _positive(
    config: dict[str, Any],
    key: str,
) -> float:
    raw = get_required(
        config,
        key,
    )

    if isinstance(raw, bool):
        raise ConfigError(
            f"Configuration key '{key}' "
            "must be a positive number."
        )

    try:
        value = float(raw)
    except (TypeError, ValueError) as exc:
        raise ConfigError(
            f"Configuration key '{key}' "
            "must be a positive number."
        ) from exc

    if (
        not np.isfinite(value)
        or value <= 0
    ):
        raise ConfigError(
            f"Configuration key '{key}' "
            "must be finite and > 0."
        )

    return value


def _nonnegative(
    config: dict[str, Any],
    key: str,
) -> float:
    raw = get_required(
        config,
        key,
    )

    if isinstance(raw, bool):
        raise ConfigError(
            f"Configuration key '{key}' "
            "must be non-negative."
        )

    try:
        value = float(raw)
    except (TypeError, ValueError) as exc:
        raise ConfigError(
            f"Configuration key '{key}' "
            "must be non-negative."
        ) from exc

    if (
        not np.isfinite(value)
        or value < 0
    ):
        raise ConfigError(
            f"Configuration key '{key}' "
            "must be finite and >= 0."
        )

    return value