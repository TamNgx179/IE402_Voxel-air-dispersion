"""
Gaussian baseline driven by the REAL road source and the REAL wind scenarios.

`src/gaussian.py` verifies the plume formula on a synthetic line source. For
comparison against the voxel solver (docs/DECISION.md 7.9, "Gaussian vs voxel")
the baseline must see the same emissions the solver sees, so this superposes
one Briggs-urban point source per non-zero cell of the transport-ready source
field `S[z, y, x]` (kg m-3 s-1, EDGAR-normalised, A3.4).

The plume formula itself is person B's `dispersion.gaussian_model`, used
unchanged. What the baseline cannot know is the city: plumes pass straight
through buildings, and building voxels are then blanked to NaN. That blind
spot is exactly what the comparison is meant to expose.
"""

from __future__ import annotations

import numpy as np
import xarray as xr

from dispersion.gaussian_model import gaussian_point_source

from analysis.fields import ConcentrationField

MICROGRAMS_PER_GRAM = 1.0e6
GRAMS_PER_KILOGRAM = 1.0e3


def road_source_points(
    source_path: str,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """(x, y, z, q_g_s) for every voxel with a positive source."""

    with xr.open_dataset(source_path) as dataset:
        source = dataset["S"].values.astype(float)
        units = str(dataset["S"].attrs.get("units", ""))
        z, y, x = (dataset[name].values.astype(float) for name in ("z", "y", "x"))

    if units.replace(" ", "") not in {"kgm-3s-1", "kg/m^3/s"}:
        raise ValueError(f"S must be kg m-3 s-1 (A3.4 output), got {units!r}")

    cell_volume = float((z[1] - z[0]) * (y[1] - y[0]) * (x[1] - x[0]))
    k, j, i = np.nonzero(source > 0.0)
    q_g_s = source[k, j, i] * cell_volume * GRAMS_PER_KILOGRAM

    return x[i], y[j], z[k], q_g_s


def gaussian_road_baseline(
    source_path: str,
    grid: ConcentrationField,
    *,
    wind_from_deg: float,
    wind_speed_m_s: float,
    reference_height_m: float,
    stability: str,
) -> np.ndarray:
    """Superposed plume concentration [z, y, x] in ug m-3, NaN in buildings."""

    sx, sy, sz, q = road_source_points(source_path)

    total = np.zeros((grid.z.size, grid.y.size, grid.x.size), dtype=float)

    for x0, y0, z0, rate in zip(sx, sy, sz, q):
        total += gaussian_point_source(
            grid.x,
            grid.y,
            grid.z,
            source_x=float(x0),
            source_y=float(y0),
            source_z=float(z0),
            emission_rate_g_s=float(rate),
            wind_from_deg=wind_from_deg,
            reference_wind_speed_m_s=wind_speed_m_s,
            reference_wind_height_m=reference_height_m,
            stability=stability,
        )

    concentration = total * MICROGRAMS_PER_GRAM
    concentration[grid.solid] = np.nan

    return concentration
