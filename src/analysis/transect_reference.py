"""
Independent reference sampler for the vertical cross-section (B9.4).

This module is written by the science/data owner as an *independent*
reference for the API feature A9.3 (``app/src/modules/results``). It does not
import or share code with the TypeScript implementation; it is derived from
spec rules BR-46, BR-47, BR-48 and E-18 and from the voxel conventions in
``src/voxel/models.py`` / ``src/voxel/rasterizer.py``.

Conventions (same as the solver and the scene package)
------------------------------------------------------
* Arrays are ``[z, y, x]``; column ``(i, j)`` covers
  ``[x0 + i*dx, x0 + (i+1)*dx) x [y0 + j*dy, y0 + (j+1)*dy)``.
* Layer ``k`` covers ``[z0 + k*dz, z0 + (k+1)*dz)``; its value sits at the
  cell centre ``z0 + (k + 0.5)*dz``.
* Half-open indexing: an interior face belongs to the cell that starts there
  (2 m -> the layer starting at 2 m); the outermost East/North/top face is
  outside the domain.

Sampling rules
--------------
* Input is a WGS84 LineString (lon, lat) with 2-100 vertices, projected to
  the grid CRS before any length is measured.
* Default spacing is ``min(dx, dy)``; a user spacing must satisfy
  ``0 < step <= min(dx, dy)``.
* ``N = ceil(L / step)`` equal intervals along the projected length (across
  vertices), so the realised spacing ``L / N <= step``; both endpoints are
  samples, giving ``N + 1`` positions.
* No interpolation: every sample returns the value of the containing voxel.
* Status: ``solid`` from the scene mask (never inferred from C = 0),
  ``no_data`` for a missing/non-finite value in an air cell, ``air``
  otherwise. Zero is a valid air value. A finite value inside a solid voxel
  is a scene/result mismatch and is rejected.
* At most 20,000 position x layer samples, checked before any concentration
  is read (E-18).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Sequence

import numpy as np

MAX_VERTICES = 100
MIN_VERTICES = 2
MAX_SAMPLES = 20_000
# Tolerance in *cell units* used only to absorb CRS round-trip noise at a
# face (1e-9 of a 5 m cell = 5 nm). It never moves a point across a face by
# more than that, so a route outside the grid is not clipped into it.
FACE_TOLERANCE_CELLS = 1e-9

Projector = Callable[[np.ndarray, np.ndarray], tuple[np.ndarray, np.ndarray]]


class TransectError(ValueError):
    """Invalid request (HTTP 400 equivalent)."""


class TransectConflict(RuntimeError):
    """Stored result disagrees with the scene (HTTP 409 equivalent)."""


@dataclass(frozen=True)
class TransectGrid:
    origin_x_m: float
    origin_y_m: float
    dx_m: float
    dy_m: float
    dz_m: float
    nx: int
    ny: int
    nz: int
    crs: str = "EPSG:32648"
    z0_m: float = 0.0

    @property
    def top_m(self) -> float:
        return self.z0_m + self.nz * self.dz_m

    @property
    def default_step_m(self) -> float:
        return min(self.dx_m, self.dy_m)

    def z_center(self, k: int) -> float:
        return self.z0_m + (k + 0.5) * self.dz_m


@dataclass(frozen=True)
class Cell:
    k: int
    z_center_m: float
    overlap_min_m: float
    overlap_max_m: float
    status: str
    concentration_ug_m3: float | None


@dataclass(frozen=True)
class Sample:
    distance_m: float
    x_m: float
    y_m: float
    i: int
    j: int
    cell_center_x_m: float
    cell_center_y_m: float
    cells: tuple[Cell, ...]


@dataclass(frozen=True)
class TransectResult:
    length_m: float
    requested_step_m: float
    actual_step_m: float
    z_min_m: float
    z_max_m: float
    layers: tuple[int, ...]
    samples: tuple[Sample, ...] = field(repr=False)

    @property
    def sample_count(self) -> int:
        return len(self.samples) * len(self.layers)


# ---------------------------------------------------------------------------
# Indexing
# ---------------------------------------------------------------------------


def cell_index(value: float, origin: float, spacing: float, count: int) -> int:
    """Half-open index of ``value`` on a regular axis; raises outside."""

    u = (value - origin) / spacing
    nearest = round(u)
    if abs(u - nearest) <= FACE_TOLERANCE_CELLS:
        u = float(nearest)
    k = math.floor(u)
    if k < 0 or k >= count:
        raise TransectError(
            f"coordinate {value!r} is outside [{origin}, {origin + count * spacing})"
        )
    return int(k)


def layer_index(z_m: float, grid: TransectGrid) -> int:
    """Layer that contains a single requested height (BR-48)."""

    if not math.isfinite(z_m):
        raise TransectError("height must be finite")
    return cell_index(z_m, grid.z0_m, grid.dz_m, grid.nz)


def select_layers(
    z_min_m: float, z_max_m: float | None, grid: TransectGrid
) -> list[tuple[int, float, float]]:
    """
    Layers sampled for a requested height or height band.

    * ``z_max_m is None``: one requested height, the layer that contains it
      (top face of the domain is outside).
    * otherwise the band ``[z_min, z_max)`` with ``z_min < z_max <= top``;
      every layer whose ``[z0, z1)`` intersects the band, with its overlap.
    """

    if z_max_m is None:
        k = layer_index(z_min_m, grid)
        return [(k, z_min_m, z_min_m)]
    if not (math.isfinite(z_min_m) and math.isfinite(z_max_m)):
        raise TransectError("height band must be finite")
    if z_min_m < grid.z0_m or z_min_m >= z_max_m or z_max_m > grid.top_m:
        raise TransectError("height band must satisfy z0 <= z_min < z_max <= top")
    first = layer_index(z_min_m, grid)
    # last layer whose bottom is strictly below z_max (z_max exclusive)
    u = (z_max_m - grid.z0_m) / grid.dz_m
    nearest = round(u)
    if abs(u - nearest) <= FACE_TOLERANCE_CELLS:
        u = float(nearest)
    last = math.ceil(u) - 1
    out = []
    for k in range(first, last + 1):
        lo = grid.z0_m + k * grid.dz_m
        hi = lo + grid.dz_m
        out.append((k, max(z_min_m, lo), min(z_max_m, hi)))
    return out


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------


def pyproj_projector(crs: str) -> Projector:
    from pyproj import Transformer

    t = Transformer.from_crs("EPSG:4326", crs, always_xy=True)

    def project(lon: np.ndarray, lat: np.ndarray):
        x, y = t.transform(lon, lat)
        return np.asarray(x, dtype=float), np.asarray(y, dtype=float)

    return project


def validate_line(coordinates: Sequence[Sequence[float]]) -> np.ndarray:
    try:
        pts = np.asarray(coordinates, dtype=float)
    except (TypeError, ValueError) as exc:
        raise TransectError("coordinates must be numeric lon/lat pairs") from exc
    if pts.ndim != 2 or pts.shape[1] != 2:
        raise TransectError("coordinates must be [lon, lat] pairs")
    if not (MIN_VERTICES <= len(pts) <= MAX_VERTICES):
        raise TransectError("LineString needs 2 to 100 vertices")
    if not np.all(np.isfinite(pts)):
        raise TransectError("coordinates must be finite")
    if np.any(np.abs(pts[:, 0]) > 180) or np.any(np.abs(pts[:, 1]) > 90):
        raise TransectError("coordinates must be valid WGS84 lon/lat")
    return pts


def chainage_positions(
    xy: np.ndarray, step_m: float
) -> tuple[np.ndarray, np.ndarray, np.ndarray, float]:
    """
    Equal spacing along the cumulative projected length, endpoints included.

    Returns (distance, x, y, length). Zero-length segments add no length and
    are skipped; a route with zero total length is rejected.
    """

    seg = np.hypot(np.diff(xy[:, 0]), np.diff(xy[:, 1]))
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    length = float(cum[-1])
    if not length > 0:
        raise TransectError("route has zero projected length")
    n = math.ceil(length / step_m)
    d = np.arange(n + 1, dtype=float) * (length / n)
    d[-1] = length  # exact endpoint, no accumulated rounding
    x = np.interp(d, cum, xy[:, 0])
    y = np.interp(d, cum, xy[:, 1])
    # np.interp with repeated cum (zero-length segment) returns the value of
    # one duplicate vertex, which is the same point; nothing else to handle.
    return d, x, y, length


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def sample_transect(
    coordinates_lonlat: Sequence[Sequence[float]],
    grid: TransectGrid,
    concentration: np.ndarray,
    solid: np.ndarray,
    *,
    z_min_m: float,
    z_max_m: float | None,
    step_m: float | None = None,
    projector: Projector | None = None,
    max_samples: int = MAX_SAMPLES,
) -> TransectResult:
    """
    Sample ``concentration[z, y, x]`` along a WGS84 route.

    ``concentration`` holds stored values (NaN = missing); ``solid`` is the
    boolean scene mask with the same shape.
    """

    if concentration.shape != (grid.nz, grid.ny, grid.nx):
        raise ValueError("concentration shape must be (nz, ny, nx)")
    if solid.shape != concentration.shape:
        raise ValueError("solid mask shape must match concentration")

    pts = validate_line(coordinates_lonlat)

    limit = grid.default_step_m
    step = limit if step_m is None else step_m
    if step is None or not isinstance(step, (int, float)) or isinstance(step, bool):
        raise TransectError("step must be a number")
    if not math.isfinite(step) or step <= 0 or step > limit:
        raise TransectError(f"step must satisfy 0 < step <= {limit}")

    layers = select_layers(z_min_m, z_max_m, grid)

    project = projector or pyproj_projector(grid.crs)
    x, y = project(pts[:, 0], pts[:, 1])
    xy = np.column_stack([x, y])
    if not np.all(np.isfinite(xy)):
        raise TransectError("projection failed")
    # Rectangular (convex) domain: vertices inside => every segment inside.
    for vx, vy in xy:
        cell_index(vx, grid.origin_x_m, grid.dx_m, grid.nx)
        cell_index(vy, grid.origin_y_m, grid.dy_m, grid.ny)

    d, sx, sy, length = chainage_positions(xy, step)
    n_positions = len(d)
    if n_positions * len(layers) > max_samples:
        raise TransectError(
            f"{n_positions} positions x {len(layers)} layers exceeds {max_samples}"
        )

    samples = []
    for dist, px, py in zip(d, sx, sy):
        i = cell_index(px, grid.origin_x_m, grid.dx_m, grid.nx)
        j = cell_index(py, grid.origin_y_m, grid.dy_m, grid.ny)
        cells = []
        for k, lo, hi in layers:
            value = float(concentration[k, j, i])
            is_solid = bool(solid[k, j, i])
            if is_solid and math.isfinite(value):
                raise TransectConflict(
                    f"finite concentration inside solid voxel (i={i}, j={j}, k={k})"
                )
            if is_solid:
                status, out = "solid", None
            elif math.isfinite(value):
                status, out = "air", value
            else:
                status, out = "no_data", None
            cells.append(Cell(k, grid.z_center(k), lo, hi, status, out))
        samples.append(
            Sample(
                distance_m=float(dist),
                x_m=float(px),
                y_m=float(py),
                i=i,
                j=j,
                cell_center_x_m=grid.origin_x_m + (i + 0.5) * grid.dx_m,
                cell_center_y_m=grid.origin_y_m + (j + 0.5) * grid.dy_m,
                cells=tuple(cells),
            )
        )

    return TransectResult(
        length_m=length,
        requested_step_m=float(step),
        actual_step_m=length / (n_positions - 1),
        z_min_m=float(z_min_m),
        z_max_m=float(z_min_m if z_max_m is None else z_max_m),
        layers=tuple(k for k, _, _ in layers),
        samples=tuple(samples),
    )


def solid_from_ranges(
    grid: TransectGrid, ranges: dict[tuple[int, int], tuple[int, int]]
) -> np.ndarray:
    """Build a [z,y,x] mask from scene-package ``solid_from_k..solid_to_k``."""

    mask = np.zeros((grid.nz, grid.ny, grid.nx), dtype=bool)
    for (i, j), (k0, k1) in ranges.items():
        mask[k0 : k1 + 1, j, i] = True
    return mask
