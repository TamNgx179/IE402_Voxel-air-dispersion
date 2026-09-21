"""Core Gaussian-plume mathematics and synthetic source utilities."""

from __future__ import annotations

from typing import Iterable

import numpy as np


def normalize_stability(value: str) -> str:
    """Validate a Pasquill stability class."""

    stability = value.strip().upper()

    if stability not in {"A", "B", "C", "D", "E", "F"}:
        raise ValueError("stability must be one of A, B, C, D, E, F")

    return stability


def briggs_urban_sigma(
    x_m: np.ndarray,
    stability: str,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Briggs urban dispersion coefficients.

    Parameters
    ----------
    x_m:
        Positive downwind distance in metres.

    stability:
        Pasquill stability class A-F.
    """

    stability = normalize_stability(stability)

    x = np.asarray(x_m, dtype=np.float64)

    if np.any(x <= 0.0):
        raise ValueError(
            "Briggs sigma requires positive downwind distance."
        )

    y_common = np.power(
        1.0 + 0.0004 * x,
        -0.5,
    )

    if stability in {"A", "B"}:
        sigma_y = 0.32 * x * y_common

        sigma_z = (
            0.24
            * x
            * np.power(
                1.0 + 0.0010 * x,
                0.5,
            )
        )

    elif stability == "C":
        sigma_y = 0.22 * x * y_common
        sigma_z = 0.20 * x

    elif stability == "D":
        sigma_y = 0.16 * x * y_common

        sigma_z = (
            0.14
            * x
            * np.power(
                1.0 + 0.0003 * x,
                -0.5,
            )
        )

    else:
        sigma_y = 0.11 * x * y_common

        sigma_z = (
            0.08
            * x
            * np.power(
                1.0 + 0.0015 * x,
                -0.5,
            )
        )

    return sigma_y, sigma_z


def urban_power_exponent(
    stability: str,
) -> float:
    """Return urban power-law wind exponent."""

    stability = normalize_stability(stability)

    if stability in {"A", "B"}:
        return 0.15

    if stability == "C":
        return 0.20

    if stability == "D":
        return 0.25

    return 0.30


def wind_speed_at_height(
    z_m: float,
    reference_speed_m_s: float,
    reference_height_m: float,
    stability: str,
) -> float:
    """
    Calculate wind speed using a power-law profile.

    u(z) = u_ref * (z / z_ref)^p
    """

    if reference_speed_m_s <= 0.0:
        raise ValueError(
            "reference wind speed must be positive"
        )

    if reference_height_m <= 0.0:
        raise ValueError(
            "reference wind height must be positive"
        )

    exponent = urban_power_exponent(stability)

    height = max(
        float(z_m),
        0.5,
    )

    return float(
        reference_speed_m_s
        * (height / reference_height_m) ** exponent
    )


def wind_basis(
    wind_from_deg: float,
) -> tuple[float, float, float, float]:
    """
    Convert meteorological wind direction to model unit vectors.

    Convention
    ----------
    0°   = FROM north
    90°  = FROM east
    180° = FROM south
    270° = FROM west
    """

    angle = np.deg2rad(
        float(wind_from_deg) % 360.0
    )

    down_x = -float(np.sin(angle))
    down_y = -float(np.cos(angle))

    cross_x = -down_y
    cross_y = down_x

    return (
        down_x,
        down_y,
        cross_x,
        cross_y,
    )


def cardinal_direction(
    degrees: float,
) -> str:
    """Convert an azimuth to an 8-point compass label."""

    labels = (
        "N",
        "NE",
        "E",
        "SE",
        "S",
        "SW",
        "W",
        "NW",
    )

    index = int(
        np.floor(
            ((degrees % 360.0) + 22.5)
            / 45.0
        )
    ) % 8

    return labels[index]


def wind_label(
    wind_from_deg: float,
) -> str:
    """Return compact wind FROM -> TO label."""

    wind_from_deg = float(
        wind_from_deg
    ) % 360.0

    wind_to_deg = (
        wind_from_deg + 180.0
    ) % 360.0

    return (
        f"{cardinal_direction(wind_from_deg)}"
        " → "
        f"{cardinal_direction(wind_to_deg)}"
    )


def gaussian_point_source(
    x: np.ndarray,
    y: np.ndarray,
    z: np.ndarray,
    source_x: float,
    source_y: float,
    source_z: float,
    emission_rate_g_s: float,
    wind_from_deg: float,
    reference_wind_speed_m_s: float,
    reference_wind_height_m: float,
    stability: str,
) -> np.ndarray:
    """
    Evaluate one steady Gaussian point source.

    Returns
    -------
    concentration:
        Array ordered as (z, y, x), unit g/m^3.

    Ground reflection is included using
    the standard image-source formulation.
    """

    if emission_rate_g_s < 0.0:
        raise ValueError(
            "emission_rate_g_s must be non-negative"
        )

    (
        down_x,
        down_y,
        cross_x,
        cross_y,
    ) = wind_basis(wind_from_deg)

    xx, yy = np.meshgrid(
        x,
        y,
        indexing="xy",
    )

    dx = xx - source_x
    dy = yy - source_y

    downwind = (
        dx * down_x
        + dy * down_y
    )

    crosswind = (
        dx * cross_x
        + dy * cross_y
    )

    valid = downwind > 0.0

    safe_x = np.where(
        valid,
        downwind,
        1.0,
    )

    sigma_y, sigma_z = (
        briggs_urban_sigma(
            safe_x,
            stability,
        )
    )

    source_wind = wind_speed_at_height(
        z_m=source_z,
        reference_speed_m_s=reference_wind_speed_m_s,
        reference_height_m=reference_wind_height_m,
        stability=stability,
    )

    horizontal = np.exp(
        -0.5
        * (crosswind / sigma_y) ** 2
    )

    zz = z[:, None, None]

    sigma_z_3d = (
        sigma_z[None, :, :]
    )

    vertical_direct = np.exp(
        -0.5
        * (
            (zz - source_z)
            / sigma_z_3d
        ) ** 2
    )

    vertical_reflected = np.exp(
        -0.5
        * (
            (zz + source_z)
            / sigma_z_3d
        ) ** 2
    )

    coefficient = (
        emission_rate_g_s
        / (
            2.0
            * np.pi
            * source_wind
            * sigma_y
            * sigma_z
        )
    )

    concentration = (
        coefficient[None, :, :]
        * horizontal[None, :, :]
        * (
            vertical_direct
            + vertical_reflected
        )
    )

    concentration = np.where(
        valid[None, :, :],
        concentration,
        0.0,
    )

    return concentration


def build_demo_line_sources(
    center_x: float,
    center_y: float,
    wind_from_deg: float,
    source_height_m: float,
    total_emission_rate_g_s: float,
    line_length_m: float,
    spacing_m: float,
) -> list[
    tuple[
        float,
        float,
        float,
        float,
    ]
]:
    """
    Approximate one line source using
    multiple Gaussian point sources.
    """

    if line_length_m <= 0.0:
        raise ValueError(
            "line_length_m must be positive"
        )

    if spacing_m <= 0.0:
        raise ValueError(
            "spacing_m must be positive"
        )

    if total_emission_rate_g_s < 0.0:
        raise ValueError(
            "total emission rate must be non-negative"
        )

    _, _, cross_x, cross_y = (
        wind_basis(wind_from_deg)
    )

    source_count = max(
        2,
        int(
            np.floor(
                line_length_m
                / spacing_m
            )
        )
        + 1,
    )

    offsets = np.linspace(
        -line_length_m / 2.0,
        line_length_m / 2.0,
        source_count,
    )

    emission_each = (
        total_emission_rate_g_s
        / source_count
    )

    sources = []

    for offset in offsets:
        source_x = (
            center_x
            + offset * cross_x
        )

        source_y = (
            center_y
            + offset * cross_y
        )

        sources.append(
            (
                source_x,
                source_y,
                source_height_m,
                emission_each,
            )
        )

    return sources


def nearest_index(
    values: np.ndarray,
    coordinate: float,
) -> int:
    """Return nearest grid-cell-center index."""

    return int(
        np.argmin(
            np.abs(
                values - coordinate
            )
        )
    )


def source_overlap_count(
    sources: Iterable[
        tuple[
            float,
            float,
            float,
            float,
        ]
    ],
    x: np.ndarray,
    y: np.ndarray,
    building_layer: np.ndarray,
) -> int:
    """
    Count source points whose nearest
    horizontal cell lies inside a building.
    """

    overlap = 0

    for source_x, source_y, _, _ in sources:
        ix = nearest_index(
            x,
            source_x,
        )

        iy = nearest_index(
            y,
            source_y,
        )

        overlap += int(
            bool(
                building_layer[
                    iy,
                    ix,
                ]
            )
        )

    return overlap


def choose_demo_line_center(
    x: np.ndarray,
    y: np.ndarray,
    building_mask: np.ndarray,
    z: np.ndarray,
    source_height_m: float,
    wind_from_deg: float,
    total_emission_rate_g_s: float,
    line_length_m: float,
    spacing_m: float,
) -> tuple[float, float, int]:
    """
    Find a clear synthetic source position.

    Priorities
    ----------
    1. Avoid buildings.
    2. Place source near the upwind 30% of domain.
    3. Keep source near crosswind center.
    """

    z_index = nearest_index(
        z,
        source_height_m,
    )

    building_layer = np.asarray(
        building_mask[z_index],
        dtype=bool,
    )

    (
        down_x,
        down_y,
        cross_x,
        cross_y,
    ) = wind_basis(
        wind_from_deg
    )

    corners = np.asarray(
        [
            [x[0], y[0]],
            [x[0], y[-1]],
            [x[-1], y[0]],
            [x[-1], y[-1]],
        ],
        dtype=np.float64,
    )

    down_projection = (
        corners[:, 0] * down_x
        + corners[:, 1] * down_y
    )

    cross_projection = (
        corners[:, 0] * cross_x
        + corners[:, 1] * cross_y
    )

    target_down = float(
        down_projection.min()
        + 0.30
        * (
            down_projection.max()
            - down_projection.min()
        )
    )

    target_cross = float(
        0.5
        * (
            cross_projection.min()
            + cross_projection.max()
        )
    )

    x_candidates = (
        x[4:-4:2]
        if len(x) > 10
        else x
    )

    y_candidates = (
        y[4:-4:2]
        if len(y) > 10
        else y
    )

    best = None

    for candidate_y in y_candidates:
        for candidate_x in x_candidates:
            sources = build_demo_line_sources(
                center_x=float(candidate_x),
                center_y=float(candidate_y),
                wind_from_deg=wind_from_deg,
                source_height_m=source_height_m,
                total_emission_rate_g_s=(
                    total_emission_rate_g_s
                ),
                line_length_m=line_length_m,
                spacing_m=spacing_m,
            )

            outside = any(
                source_x < x[0]
                or source_x > x[-1]
                or source_y < y[0]
                or source_y > y[-1]
                for source_x, source_y, _, _ in sources
            )

            if outside:
                continue

            overlap = source_overlap_count(
                sources,
                x,
                y,
                building_layer,
            )

            down = (
                candidate_x * down_x
                + candidate_y * down_y
            )

            cross = (
                candidate_x * cross_x
                + candidate_y * cross_y
            )

            down_error = abs(
                down - target_down
            )

            cross_error = abs(
                cross - target_cross
            )

            score = (
                overlap * 1_000_000.0
                + down_error
                + 0.25 * cross_error
            )

            if (
                best is None
                or score < best[3]
            ):
                best = (
                    float(candidate_x),
                    float(candidate_y),
                    overlap,
                    float(score),
                )

    if best is None:
        raise RuntimeError(
            "Could not place synthetic line source."
        )

    return (
        best[0],
        best[1],
        best[2],
    )