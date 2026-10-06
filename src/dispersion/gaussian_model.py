"""Gaussian-plume mathematics (Briggs urban dispersion) for the baseline in src/analysis/baseline.py."""

from __future__ import annotations

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
