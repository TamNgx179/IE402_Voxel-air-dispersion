"""
Spatial-analysis operators on a voxel concentration field.

Every function takes plain numpy arrays in the project order [z, y, x], so it
works on any model's output - Gaussian baseline or finite-volume - and can be
tested against a field whose answer is known in closed form.

"Exceedance volume" and "facade exposure" have no standard definition in the
GIS literature; they are this project's own operators, anchored to QCVN/WHO
thresholds and to the voxel spacing (docs/RESEARCH.md §13.2).

Convention for missing values: a solid (building) voxel holds no air, so it is
NaN in every derived field. Zero is a real concentration and is never used to
mean "no data".
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage


def _air_values(concentration: np.ndarray, solid: np.ndarray | None) -> np.ndarray:
    """Concentration with solid voxels (and any NaN already present) as NaN."""

    values = np.array(concentration, dtype=float, copy=True)

    if solid is not None:
        if solid.shape != values.shape:
            raise ValueError("solid mask must match the concentration shape")
        values[np.asarray(solid, dtype=bool)] = np.nan

    return values


def layer_at_height(
    concentration: np.ndarray,
    z_centres_m: np.ndarray,
    height_m: float,
    solid: np.ndarray | None = None,
) -> np.ndarray:
    """
    Horizontal slice [y, x] at an arbitrary height, linear in z.

    Between two cell centres the value is interpolated linearly. Below the
    lowest centre the lowest cell is used, because that cell's value already
    represents the air from the ground up to its top face. A height above the
    highest centre, or below the ground, is refused rather than extrapolated
    (EC-1). A column whose bracketing cells are both solid is NaN (EC-2); when
    only one is solid, the air cell's value is used.
    """

    z = np.asarray(z_centres_m, dtype=float)
    values = _air_values(concentration, solid)

    if values.ndim != 3 or values.shape[0] != z.size:
        raise ValueError("concentration must be [z, y, x] with one z centre per layer")

    if np.any(np.diff(z) <= 0.0):
        raise ValueError("z centres must be strictly increasing")

    height = float(height_m)

    if not np.isfinite(height) or height < 0.0:
        raise ValueError(f"height {height_m!r} m is below the ground")

    if height > z[-1]:
        raise ValueError(
            f"height {height:g} m is above the highest cell centre ({z[-1]:g} m); "
            "refusing to extrapolate"
        )

    if height <= z[0]:
        return values[0].copy()

    upper = int(np.searchsorted(z, height, side="left"))
    lower = upper - 1

    if np.isclose(z[upper], height):
        return values[upper].copy()

    weight = (height - z[lower]) / (z[upper] - z[lower])
    below, above = values[lower], values[upper]

    blended = (1.0 - weight) * below + weight * above

    # One side solid: the air side is the only air there is.
    blended = np.where(np.isnan(below) & ~np.isnan(above), above, blended)
    blended = np.where(np.isnan(above) & ~np.isnan(below), below, blended)

    return blended


def horizontal_slices(
    concentration: np.ndarray,
    z_centres_m: np.ndarray,
    heights_m: list[float],
    solid: np.ndarray | None = None,
) -> dict[float, np.ndarray]:
    """`layer_at_height` for several heights, keyed by height."""

    return {
        float(h): layer_at_height(concentration, z_centres_m, h, solid)
        for h in heights_m
    }


def cell_index(coords_m: np.ndarray, value_m: float, spacing_m: float) -> int:
    """Index of the cell whose extent [centre - s/2, centre + s/2) holds value."""

    coords = np.asarray(coords_m, dtype=float)
    lower_edge = coords[0] - 0.5 * spacing_m
    index = int(np.floor((float(value_m) - lower_edge) / spacing_m))

    if index < 0 or index >= coords.size:
        raise ValueError(
            f"coordinate {value_m!r} lies outside the grid "
            f"[{lower_edge:g}, {lower_edge + coords.size * spacing_m:g})"
        )

    return index


def vertical_profile(
    concentration: np.ndarray,
    x_centres_m: np.ndarray,
    y_centres_m: np.ndarray,
    x_m: float,
    y_m: float,
    solid: np.ndarray | None = None,
) -> np.ndarray:
    """Column C[:, j, i] of the cell containing (x, y)."""

    spacing_x = float(x_centres_m[1] - x_centres_m[0])
    spacing_y = float(y_centres_m[1] - y_centres_m[0])

    i = cell_index(x_centres_m, x_m, spacing_x)
    j = cell_index(y_centres_m, y_m, spacing_y)

    return _air_values(concentration, solid)[:, j, i]


def vertical_section(
    concentration: np.ndarray,
    axis: str,
    index: int,
    solid: np.ndarray | None = None,
) -> np.ndarray:
    """
    Vertical plane [z, s]: `axis="x"` fixes x = index (a y-z plane), `axis="y"`
    fixes y = index (an x-z plane).
    """

    values = _air_values(concentration, solid)

    if axis == "x":
        return values[:, :, index]

    if axis == "y":
        return values[:, index, :]

    raise ValueError("axis must be 'x' or 'y'")


def layer_means(
    concentration: np.ndarray,
    solid: np.ndarray | None = None,
) -> np.ndarray:
    """Mean over the air cells of each layer; NaN for a layer with no air."""

    values = _air_values(concentration, solid)
    count = np.sum(~np.isnan(values), axis=(1, 2))
    total = np.nansum(values, axis=(1, 2))

    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(count > 0, total / np.maximum(count, 1), np.nan)


def exceedance_volume_by_layer(
    concentration: np.ndarray,
    solid: np.ndarray | None,
    threshold: float,
    dx_m: float,
    dy_m: float,
    dz_m: float,
) -> np.ndarray:
    """V_k(theta) = #{air cells in layer k : C > theta} * dx*dy*dz, in m^3."""

    values = _air_values(concentration, solid)

    with np.errstate(invalid="ignore"):
        above = values > float(threshold)

    return above.sum(axis=(1, 2)) * float(dx_m * dy_m * dz_m)


def exceedance_volume(
    concentration: np.ndarray,
    solid: np.ndarray | None,
    threshold: float,
    dx_m: float,
    dy_m: float,
    dz_m: float,
) -> float:
    """V(theta) = #{air cells : C > theta} * dx*dy*dz, in m^3. Solids never count."""

    return float(
        exceedance_volume_by_layer(concentration, solid, threshold, dx_m, dy_m, dz_m).sum()
    )


@dataclass(frozen=True)
class FloorExposure:
    """Concentration on building facades, one row per floor."""

    floor: np.ndarray        # floor number, 0 = ground floor
    cells: np.ndarray        # facade air voxels on that floor
    mean: np.ndarray
    maximum: np.ndarray


def facade_mask(solid: np.ndarray) -> np.ndarray:
    """
    Air voxels that share a horizontal face with a solid voxel.

    4-neighbourhood in the horizontal plane only: an air voxel above a roof
    touches the building but is not on its facade (docs/RESEARCH.md §13.3 item 6).
    """

    solid = np.asarray(solid, dtype=bool)
    structure = np.zeros((1, 3, 3), dtype=bool)
    structure[0, 1, :] = True
    structure[0, :, 1] = True

    return ndimage.binary_dilation(solid, structure=structure) & ~solid


def facade_exposure_by_floor(
    concentration: np.ndarray,
    solid: np.ndarray,
    z_centres_m: np.ndarray,
    floor_height_m: float,
) -> FloorExposure:
    """Facade concentration grouped by floor = floor(z_centre / floor height)."""

    if floor_height_m <= 0.0:
        raise ValueError("floor height must be positive")

    facade = facade_mask(solid)
    floors = np.floor(np.asarray(z_centres_m, dtype=float) / float(floor_height_m)).astype(int)
    values = _air_values(concentration, solid)

    floor_ids, cells, means, maxima = [], [], [], []

    for floor in np.unique(floors):
        layers = floors == floor
        sample = values[layers][facade[layers]]
        sample = sample[~np.isnan(sample)]

        if sample.size == 0:
            continue

        floor_ids.append(int(floor))
        cells.append(int(sample.size))
        means.append(float(sample.mean()))
        maxima.append(float(sample.max()))

    return FloorExposure(
        floor=np.asarray(floor_ids, dtype=int),
        cells=np.asarray(cells, dtype=int),
        mean=np.asarray(means, dtype=float),
        maximum=np.asarray(maxima, dtype=float),
    )


def difference_map(first: np.ndarray, second: np.ndarray) -> np.ndarray:
    """first - second, NaN wherever either is NaN."""

    a = np.asarray(first, dtype=float)
    b = np.asarray(second, dtype=float)

    if a.shape != b.shape:
        raise ValueError("fields must have the same shape")

    return a - b
