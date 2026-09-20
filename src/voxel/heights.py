from __future__ import annotations

import logging
import math
import re
from collections import Counter
from typing import Any

import geopandas as gpd
import numpy as np
import pandas as pd

from project_config import (
    ConfigError,
    get_required,
)

from voxel.models import (
    HeightSettings,
)


LOGGER = logging.getLogger(
    __name__
)


SUPPORTED_FALLBACK_MODES = {
    "error",
    "fixed",
}


# Accept:
#
# 12
# 12.5
# 12,5
# +12
# -12
#
# Unit handling is performed separately.
NUMBER_PATTERN = re.compile(
    r"[-+]?\d+(?:[.,]\d+)?"
)


# Explicit non-metre units that must not be silently interpreted
# as metres.
NON_METRE_UNIT_PATTERN = re.compile(
    r"""
    (?:
        \bft\b
        |
        \bfeet\b
        |
        \bfoot\b
        |
        '
    )
    """,
    flags=re.IGNORECASE | re.VERBOSE,
)


def read_height_settings(
    config: dict[str, Any],
) -> HeightSettings:
    """
    Read and validate all building-height rules from project config.

    No modelling parameter is defined in this module.

    The configuration controls:

    - which fields contain direct height;
    - which fields contain building levels;
    - metres per level;
    - minimum/maximum accepted model height;
    - missing-height fallback policy.
    """

    direct_fields = _read_nonempty_string_list(
        config=config,
        key="voxelization.height.direct_fields",
    )

    levels_fields = _read_nonempty_string_list(
        config=config,
        key="voxelization.height.levels_fields",
    )

    meters_per_level = _read_positive_float(
        config=config,
        key="voxelization.height.meters_per_level",
    )

    minimum_height_m = _read_nonnegative_float(
        config=config,
        key="voxelization.height.minimum_height_m",
    )

    maximum_raw = get_required(
        config,
        "voxelization.height.maximum_height_m",
    )

    if maximum_raw is None:
        maximum_height_m = None

    else:
        maximum_height_m = _coerce_positive_float(
            raw_value=maximum_raw,
            key="voxelization.height.maximum_height_m",
        )

    if (
        maximum_height_m is not None
        and maximum_height_m < minimum_height_m
    ):
        raise ConfigError(
            "voxelization.height.maximum_height_m "
            "cannot be smaller than "
            "voxelization.height.minimum_height_m."
        )

    fallback_mode = str(
        get_required(
            config,
            "voxelization.height.fallback.mode",
        )
    ).strip().lower()

    if (
        fallback_mode
        not in SUPPORTED_FALLBACK_MODES
    ):
        raise ConfigError(
            "voxelization.height.fallback.mode "
            "must be one of: "
            f"{sorted(SUPPORTED_FALLBACK_MODES)}. "
            f"Got: {fallback_mode!r}"
        )

    fallback_height_raw = get_required(
        config,
        "voxelization.height.fallback.height_m",
    )

    if fallback_mode == "fixed":

        if fallback_height_raw is None:
            raise ConfigError(
                "voxelization.height.fallback.height_m "
                "must be configured when "
                "fallback.mode='fixed'."
            )

        fallback_height_m = _coerce_positive_float(
            raw_value=fallback_height_raw,
            key="voxelization.height.fallback.height_m",
        )

    else:

        fallback_height_m = None

    overlapping_fields = (
        set(
            direct_fields
        )
        & set(
            levels_fields
        )
    )

    if overlapping_fields:
        raise ConfigError(
            "The same GIS attribute cannot be configured "
            "as both a direct-height field and a levels field. "
            f"Overlapping fields: {sorted(overlapping_fields)}"
        )

    return HeightSettings(
        direct_fields=direct_fields,
        levels_fields=levels_fields,
        meters_per_level=meters_per_level,
        fallback_mode=fallback_mode,
        fallback_height_m=fallback_height_m,
        minimum_height_m=minimum_height_m,
        maximum_height_m=maximum_height_m,
    )


def resolve_building_heights(
    buildings: gpd.GeoDataFrame,
    settings: HeightSettings,
) -> gpd.GeoDataFrame:
    """
    Resolve one model height for every building feature.

    Resolution priority
    -------------------
    1. First valid configured direct-height field.
    2. First valid configured level-count field multiplied by
       meters_per_level.
    3. Configured fallback policy.

    New columns
    -----------
    resolved_height_m:
        Final building height used by voxelization.

    height_source:
        Provenance of the resolved value.

        Examples:
            direct:height
            levels:building:levels
            fallback:fixed

    height_raw_value:
        Original GIS value from which the height was derived.

    Height provenance is intentionally retained so the dataset can
    later be audited in QGIS or during model validation.

    Parameters
    ----------
    buildings:
        Building polygons and attributes.

    settings:
        Validated project height settings.

    Returns
    -------
    geopandas.GeoDataFrame
        Copy of the input buildings with resolved height columns.

    Raises
    ------
    ValueError
        If any building cannot be assigned a valid height under
        fallback.mode='error'.
    """

    if buildings.empty:
        raise ValueError(
            "Cannot resolve heights for an empty "
            "building dataset."
        )

    result = buildings.copy()

    resolved_heights: list[float] = []

    height_sources: list[str] = []

    raw_values: list[str | None] = []

    unresolved_rows: list[Any] = []

    unresolved_reasons: list[str] = []

    for row_index, row in result.iterrows():

        resolution = _resolve_single_building(
            row=row,
            settings=settings,
        )

        if resolution is None:

            unresolved_rows.append(
                row_index
            )

            unresolved_reasons.append(
                _describe_available_height_values(
                    row=row,
                    settings=settings,
                )
            )

            resolved_heights.append(
                np.nan
            )

            height_sources.append(
                "unresolved"
            )

            raw_values.append(
                None
            )

            continue

        (
            height_m,
            source,
            raw_value,
        ) = resolution

        final_height = _apply_height_limits(
            height_m=height_m,
            settings=settings,
        )

        resolved_heights.append(
            final_height
        )

        height_sources.append(
            source
        )

        raw_values.append(
            (
                None
                if raw_value is None
                else str(
                    raw_value
                )
            )
        )

    result[
        "resolved_height_m"
    ] = np.asarray(
        resolved_heights,
        dtype=np.float64,
    )

    result[
        "height_source"
    ] = height_sources

    result[
        "height_raw_value"
    ] = raw_values

    if unresolved_rows:

        if (
            settings.fallback_mode
            == "error"
        ):
            raise ValueError(
                _build_unresolved_height_error(
                    unresolved_rows=unresolved_rows,
                    unresolved_reasons=unresolved_reasons,
                    settings=settings,
                )
            )

        raise RuntimeError(
            "Internal height-resolution error: "
            "unresolved buildings remain despite "
            "a configured fallback."
        )

    _validate_resolved_heights(
        result
    )

    _log_height_summary(
        result
    )

    return result


def parse_direct_height(
    value: Any,
) -> float | None:
    """
    Parse one direct building-height attribute.

    Accepted examples
    -----------------
    12
    12.5
    "12"
    "12.5"
    "12,5"
    "12 m"
    "12m"

    Rejected examples
    -----------------
    None
    ""
    "unknown"
    "10-12"
    "12;15"
    "40 ft"
    "12'"

    Why reject ambiguous values?
    ----------------------------
    The voxel model must not silently guess which number represents
    the intended physical building height.

    Non-metre units are also rejected rather than accidentally being
    interpreted as metres.
    """

    return _parse_single_numeric_value(
        value=value,
        allow_metre_suffix=True,
    )


def parse_level_count(
    value: Any,
) -> float | None:
    """
    Parse one building-level count.

    Accepted examples
    -----------------
    3
    "3"
    3.5

    Fractional levels are preserved because some GIS datasets may
    represent mezzanine or partial-level information numerically.

    Values must be strictly positive.
    """

    return _parse_single_numeric_value(
        value=value,
        allow_metre_suffix=False,
    )


def summarize_height_sources(
    buildings: gpd.GeoDataFrame,
) -> dict[str, int]:
    """
    Return counts of the provenance used for resolved heights.

    Example
    -------
    {
        "direct:height": 82,
        "levels:building:levels": 14,
        "fallback:fixed": 4
    }
    """

    if (
        "height_source"
        not in buildings.columns
    ):
        raise ValueError(
            "Dataset does not contain "
            "'height_source'. "
            "Run resolve_building_heights() first."
        )

    counts = Counter(
        str(
            value
        )
        for value in buildings[
            "height_source"
        ]
    )

    return dict(
        sorted(
            counts.items()
        )
    )


def _resolve_single_building(
    row: pd.Series,
    settings: HeightSettings,
) -> (
    tuple[
        float,
        str,
        Any,
    ]
    | None
):
    """
    Resolve the height of one building feature.
    """

    direct_result = _first_valid_value(
        row=row,
        field_names=settings.direct_fields,
        parser=parse_direct_height,
    )

    if direct_result is not None:

        (
            height_m,
            field_name,
            raw_value,
        ) = direct_result

        return (
            height_m,
            f"direct:{field_name}",
            raw_value,
        )

    levels_result = _first_valid_value(
        row=row,
        field_names=settings.levels_fields,
        parser=parse_level_count,
    )

    if levels_result is not None:

        (
            level_count,
            field_name,
            raw_value,
        ) = levels_result

        height_m = (
            level_count
            * settings.meters_per_level
        )

        if (
            not math.isfinite(
                height_m
            )
            or height_m <= 0
        ):
            return None

        return (
            float(
                height_m
            ),
            f"levels:{field_name}",
            raw_value,
        )

    if (
        settings.fallback_mode
        == "fixed"
        and settings.fallback_height_m
        is not None
    ):

        return (
            float(
                settings.fallback_height_m
            ),
            "fallback:fixed",
            None,
        )

    return None


def _first_valid_value(
    row: pd.Series,
    field_names: tuple[str, ...],
    parser,
) -> (
    tuple[
        float,
        str,
        Any,
    ]
    | None
):
    """
    Search configured fields in priority order.

    The first usable value wins.
    """

    for field_name in field_names:

        if field_name not in row.index:
            continue

        raw_value = row[
            field_name
        ]

        parsed_value = parser(
            raw_value
        )

        if parsed_value is None:
            continue

        if parsed_value <= 0:
            continue

        return (
            float(
                parsed_value
            ),
            field_name,
            raw_value,
        )

    return None


def _parse_single_numeric_value(
    value: Any,
    *,
    allow_metre_suffix: bool,
) -> float | None:
    """
    Conservatively parse exactly one positive numeric quantity.

    Multiple numeric tokens are treated as ambiguous and rejected.
    """

    if _is_missing(
        value
    ):
        return None

    if isinstance(
        value,
        (
            int,
            float,
            np.integer,
            np.floating,
        ),
    ):

        parsed = float(
            value
        )

        if (
            math.isfinite(
                parsed
            )
            and parsed > 0
        ):
            return parsed

        return None

    text = str(
        value
    ).strip()

    if not text:
        return None

    if NON_METRE_UNIT_PATTERN.search(
        text
    ):
        return None

    matches = NUMBER_PATTERN.findall(
        text
    )

    if len(matches) != 1:
        return None

    numeric_text = (
        matches[0]
        .replace(
            ",",
            ".",
        )
    )

    try:
        parsed = float(
            numeric_text
        )

    except ValueError:
        return None

    if (
        not math.isfinite(
            parsed
        )
        or parsed <= 0
    ):
        return None

    remaining_text = (
        NUMBER_PATTERN.sub(
            "",
            text,
            count=1,
        )
        .strip()
        .lower()
    )

    remaining_text = (
        remaining_text
        .replace(
            " ",
            "",
        )
    )

    if allow_metre_suffix:

        allowed_suffixes = {
            "",
            "m",
            "meter",
            "meters",
            "metre",
            "metres",
        }

    else:

        allowed_suffixes = {
            "",
        }

    if (
        remaining_text
        not in allowed_suffixes
    ):
        return None

    return parsed


def _apply_height_limits(
    height_m: float,
    settings: HeightSettings,
) -> float:
    """
    Apply configured lower and upper limits.

    These limits are explicit modelling choices and come from YAML.
    """

    if (
        not math.isfinite(
            height_m
        )
        or height_m <= 0
    ):
        raise ValueError(
            f"Resolved building height must be "
            f"positive and finite. Got {height_m}."
        )

    final_height = max(
        height_m,
        settings.minimum_height_m,
    )

    if (
        settings.maximum_height_m
        is not None
    ):
        final_height = min(
            final_height,
            settings.maximum_height_m,
        )

    return float(
        final_height
    )


def _validate_resolved_heights(
    buildings: gpd.GeoDataFrame,
) -> None:
    """
    Final defensive validation before rasterization.
    """

    required_columns = {
        "resolved_height_m",
        "height_source",
    }

    missing_columns = (
        required_columns
        - set(
            buildings.columns
        )
    )

    if missing_columns:
        raise RuntimeError(
            "Height resolution did not create required columns: "
            f"{sorted(missing_columns)}"
        )

    heights = pd.to_numeric(
        buildings[
            "resolved_height_m"
        ],
        errors="coerce",
    )

    invalid_mask = (
        heights.isna()
        | ~np.isfinite(
            heights
        )
        | (
            heights <= 0
        )
    )

    invalid_count = int(
        invalid_mask.sum()
    )

    if invalid_count:
        raise ValueError(
            f"{invalid_count} building(s) contain "
            "invalid resolved heights."
        )


def _log_height_summary(
    buildings: gpd.GeoDataFrame,
) -> None:
    """
    Log compact height-resolution statistics.
    """

    heights = buildings[
        "resolved_height_m"
    ].astype(
        float
    )

    source_counts = (
        summarize_height_sources(
            buildings
        )
    )

    LOGGER.info(
        "Building height resolution complete."
    )

    LOGGER.info(
        "Resolved building count: %s",
        f"{len(buildings):,}",
    )

    LOGGER.info(
        "Building height range: %.2f m - %.2f m",
        float(
            heights.min()
        ),
        float(
            heights.max()
        ),
    )

    LOGGER.info(
        "Mean building height: %.2f m",
        float(
            heights.mean()
        ),
    )

    for (
        source,
        count,
    ) in source_counts.items():

        LOGGER.info(
            "Height source %-30s %s",
            source,
            f"{count:,}",
        )


def _describe_available_height_values(
    row: pd.Series,
    settings: HeightSettings,
) -> str:
    """
    Build a compact diagnostic string for an unresolved building.
    """

    parts: list[str] = []

    checked_fields = (
        settings.direct_fields
        + settings.levels_fields
    )

    for field_name in checked_fields:

        if field_name not in row.index:

            parts.append(
                f"{field_name}=<column missing>"
            )

            continue

        value = row[
            field_name
        ]

        if _is_missing(
            value
        ):

            parts.append(
                f"{field_name}=<missing>"
            )

        else:

            parts.append(
                f"{field_name}={value!r}"
            )

    return ", ".join(
        parts
    )


def _build_unresolved_height_error(
    unresolved_rows: list[Any],
    unresolved_reasons: list[str],
    settings: HeightSettings,
) -> str:
    """
    Construct an actionable error message for missing heights.

    Only a limited preview is printed so a large GIS dataset does
    not produce an enormous terminal message.
    """

    preview_limit = 10

    preview_lines: list[str] = []

    for (
        row_index,
        reason,
    ) in zip(
        unresolved_rows[
            :preview_limit
        ],
        unresolved_reasons[
            :preview_limit
        ],
        strict=True,
    ):

        preview_lines.append(
            f"  row {row_index}: {reason}"
        )

    remaining_count = (
        len(
            unresolved_rows
        )
        - len(
            preview_lines
        )
    )

    if remaining_count > 0:

        preview_lines.append(
            "  ... "
            f"{remaining_count:,} additional unresolved "
            "building(s)"
        )

    checked_direct = ", ".join(
        settings.direct_fields
    )

    checked_levels = ", ".join(
        settings.levels_fields
    )

    preview = "\n".join(
        preview_lines
    )

    return (
        f"{len(unresolved_rows):,} building(s) could not "
        "be assigned a valid height.\n"
        "\n"
        f"Direct-height fields checked: {checked_direct}\n"
        f"Level-count fields checked: {checked_levels}\n"
        "Configured fallback policy: error\n"
        "\n"
        "Examples:\n"
        f"{preview}\n"
        "\n"
        "Inspect the source data or explicitly configure "
        "a justified fallback policy in project.yaml."
    )


def _is_missing(
    value: Any,
) -> bool:
    """
    Safely determine whether one scalar GIS attribute is missing.
    """

    if value is None:
        return True

    try:
        missing = pd.isna(
            value
        )

    except (
        TypeError,
        ValueError,
    ):
        return False

    if isinstance(
        missing,
        (
            bool,
            np.bool_,
        ),
    ):
        return bool(
            missing
        )

    return False


def _read_nonempty_string_list(
    *,
    config: dict[str, Any],
    key: str,
) -> tuple[str, ...]:
    """
    Read a non-empty YAML list containing unique non-empty strings.
    """

    raw_value = get_required(
        config,
        key,
    )

    if (
        not isinstance(
            raw_value,
            list,
        )
        or not raw_value
    ):
        raise ConfigError(
            f"Configuration key '{key}' must be "
            "a non-empty list."
        )

    values: list[str] = []

    for item in raw_value:

        if (
            not isinstance(
                item,
                str,
            )
            or not item.strip()
        ):
            raise ConfigError(
                f"Configuration key '{key}' must contain "
                "only non-empty strings."
            )

        values.append(
            item.strip()
        )

    if (
        len(
            values
        )
        != len(
            set(
                values
            )
        )
    ):
        raise ConfigError(
            f"Configuration key '{key}' "
            "contains duplicate field names."
        )

    return tuple(
        values
    )


def _read_positive_float(
    *,
    config: dict[str, Any],
    key: str,
) -> float:
    """
    Read a positive finite number from configuration.
    """

    raw_value = get_required(
        config,
        key,
    )

    return _coerce_positive_float(
        raw_value=raw_value,
        key=key,
    )


def _read_nonnegative_float(
    *,
    config: dict[str, Any],
    key: str,
) -> float:
    """
    Read a non-negative finite number from configuration.
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

    if (
        not math.isfinite(
            value
        )
        or value < 0
    ):
        raise ConfigError(
            f"Configuration key '{key}' "
            f"must be a non-negative finite number. "
            f"Got: {raw_value!r}"
        )

    return value


def _coerce_positive_float(
    *,
    raw_value: Any,
    key: str,
) -> float:
    """
    Convert one configuration value into a positive finite float.
    """

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

    if (
        not math.isfinite(
            value
        )
        or value <= 0
    ):
        raise ConfigError(
            f"Configuration key '{key}' "
            f"must be a positive finite number. "
            f"Got: {raw_value!r}"
        )

    return value