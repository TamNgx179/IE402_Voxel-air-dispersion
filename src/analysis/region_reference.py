"""B8.1 independent reference for region statistics and run comparison.

Written by B from the definitions in ``docs/spec.md`` (BR-44, BR-45, BR-48,
BR-49), *not* ported from the SQL in ``app/``. It is deliberately slow and
explicit: one loop over voxels, exact geometry, float64 accumulation.

Definitions
-----------
Grid cell (i, j, k) occupies the half-open box
``[x0+i*dx, x0+(i+1)*dx) x [y0+j*dy, y0+(j+1)*dy) x [k*dz, (k+1)*dz)``.

Region weight of a voxel for polygon P and height band [z_min, z_max]::

    w = area(P intersect cell_xy) * max(0, min(z_max, (k+1)dz) - max(z_min, k dz))

A voxel enters the statistics only if it is air (not solid) **and** has a
finite stored value. ``0`` is a valid value. Solid voxels and air voxels with
no data (NaN/None) are excluded from numerator and denominator and reported
separately, so "no data" is never confused with ``0``.

    V    = sum(w)                       (air volume, m3)
    mean = sum(w * c) / V               (None when V == 0)
    max  = max(c | w > 0)               (None when V == 0)
    Vexc = sum(w | c > threshold)       (0 when V == 0; strict ">")

Totals are accumulated directly from voxel weights; they are never formed by
averaging layer means with unequal weights.

Comparison: ``delta = comparison - baseline`` at layer ``k = floor(z/dz)``.
It is allowed only when study area, CRS, grid (origin, spacing, shape), scene
geometry version, model and solid mask are identical; otherwise
:class:`IncompatibleRunsError` is raised before anything is computed.
Concentrations are stored as float32 (BR-49); the subtraction is done after
widening the stored float32 values to float64.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterable, Sequence

import numpy as np

Point = tuple[float, float]
Ring = Sequence[Point]


# --------------------------------------------------------------------------
# Exact geometry: polygon (with holes) intersected with an axis-aligned cell
# --------------------------------------------------------------------------

def _shoelace(ring: Sequence[Point]) -> float:
    """Signed area of a ring (closing vertex optional)."""
    n = len(ring)
    if n < 3:
        return 0.0
    s = 0.0
    for a in range(n):
        x1, y1 = ring[a]
        x2, y2 = ring[(a + 1) % n]
        s += x1 * y2 - x2 * y1
    return 0.5 * s


def _clip_ring(ring: Sequence[Point], xmin: float, ymin: float, xmax: float, ymax: float) -> list[Point]:
    """Sutherland-Hodgman clip of a (possibly non-convex) ring by a rectangle.

    The clip window is convex, so the area of the output is exactly the area of
    ring intersect rectangle even when the output has degenerate bridge edges.
    """
    pts = list(ring)
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]

    def clip(points: list[Point], inside, cross) -> list[Point]:
        out: list[Point] = []
        n = len(points)
        for a in range(n):
            cur, prev = points[a], points[a - 1]
            if inside(cur):
                if not inside(prev):
                    out.append(cross(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(cross(prev, cur))
        return out

    def at_x(x: float):
        return lambda p, q: (x, p[1] + (q[1] - p[1]) * (x - p[0]) / (q[0] - p[0]))

    def at_y(y: float):
        return lambda p, q: (p[0] + (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1]), y)

    for inside, cross in (
        (lambda p: p[0] >= xmin, at_x(xmin)),
        (lambda p: p[0] <= xmax, at_x(xmax)),
        (lambda p: p[1] >= ymin, at_y(ymin)),
        (lambda p: p[1] <= ymax, at_y(ymax)),
    ):
        if not pts:
            break
        pts = clip(pts, inside, cross)
    return pts


def _shift(ring: Sequence[Point], x0: float, y0: float) -> list[Point]:
    """Translate a ring so the shoelace products stay small.

    With UTM coordinates (~7e5, ~1e6) the raw products x*y are ~1e12 and the
    float64 cancellation error reaches ~1e-4 m2; working relative to a local
    origin keeps the area exact to ~1e-10 m2.
    """
    return [(x - x0, y - y0) for x, y in ring]


def polygon_area(rings: Sequence[Ring]) -> float:
    """Area of a polygon given as [outer, hole, hole, ...]."""
    if not rings:
        return 0.0
    x0, y0 = rings[0][0]
    return abs(_shoelace(_shift(rings[0], x0, y0))) - sum(abs(_shoelace(_shift(h, x0, y0))) for h in rings[1:])


def polygon_rect_area(rings: Sequence[Ring], xmin: float, ymin: float, xmax: float, ymax: float) -> float:
    """Exact area of polygon (outer + holes) intersected with a rectangle.

    Holes are assumed to lie inside the outer ring and not to overlap (valid
    OGC polygon), so the clipped hole areas can simply be subtracted.
    """
    if not rings:
        return 0.0
    w, h = xmax - xmin, ymax - ymin

    def clipped(ring: Ring) -> float:
        return abs(_shoelace(_clip_ring(_shift(ring, xmin, ymin), 0.0, 0.0, w, h)))

    outer = clipped(rings[0])
    holes = sum(clipped(r) for r in rings[1:])
    return max(0.0, outer - holes)


def z_overlap(k: int, dz: float, z_min: float, z_max: float) -> float:
    """Thickness of [z_min, z_max] inside layer k = [k dz, (k+1) dz)."""
    return max(0.0, min(z_max, (k + 1) * dz) - max(z_min, k * dz))


# --------------------------------------------------------------------------
# Data model
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Grid:
    origin_x_m: float
    origin_y_m: float
    dx_m: float
    dy_m: float
    dz_m: float
    nx: int
    ny: int
    nz: int

    def cell_bounds(self, i: int, j: int) -> tuple[float, float, float, float]:
        x0 = self.origin_x_m + i * self.dx_m
        y0 = self.origin_y_m + j * self.dy_m
        return x0, y0, x0 + self.dx_m, y0 + self.dy_m

    def layer_of(self, z_m: float) -> int:
        """Half-open layer index (BR-48); raises outside [0, nz*dz)."""
        if not math.isfinite(z_m):
            raise ValueError("z must be finite")
        k = math.floor(z_m / self.dz_m)
        if k < 0 or k >= self.nz:
            raise ValueError(f"z={z_m} outside grid")
        return k


@dataclass
class RunField:
    """One run on a grid.

    ``concentration`` has shape (nz, ny, nx); NaN means no stored value.
    ``solid`` has the same shape and comes from the scene, not from NaN/0.
    """

    run_id: str
    grid: Grid
    concentration: np.ndarray
    solid: np.ndarray
    study_area_id: str = "area"
    crs: str = "EPSG:32648"
    scene_version: str = "scene"
    model: str = "fv"

    def __post_init__(self) -> None:
        shape = (self.grid.nz, self.grid.ny, self.grid.nx)
        # BR-49: values are float32 in storage; analysis widens them to float64.
        self.concentration = np.asarray(self.concentration, dtype=np.float32).astype(np.float64)
        self.solid = np.asarray(self.solid, dtype=bool)
        if self.concentration.shape != shape or self.solid.shape != shape:
            raise ValueError(f"arrays must have shape {shape}")

    @property
    def no_data(self) -> np.ndarray:
        return ~self.solid & ~np.isfinite(self.concentration)

    def solid_with_value(self) -> np.ndarray:
        """Voxels the scene marks solid but which carry a stored value."""
        return self.solid & np.isfinite(self.concentration)


# --------------------------------------------------------------------------
# Region statistics (BR-44)
# --------------------------------------------------------------------------

@dataclass
class LayerStats:
    k: int
    z_center_m: float
    air_voxels: int
    air_volume_m3: float
    mean_ug_m3: float | None
    max_ug_m3: float | None
    exceedance_volume_m3: float
    solid_volume_m3: float
    no_data_volume_m3: float


@dataclass
class RegionStats:
    area_m2: float
    air_volume_m3: float
    air_voxels: int
    mean_ug_m3: float | None
    max_ug_m3: float | None
    exceedance_volume_m3: float
    solid_volume_m3: float
    no_data_volume_m3: float
    layers: list[LayerStats] = field(default_factory=list)


def region_stats(
    run: RunField,
    polygon: Sequence[Ring],
    z_min_m: float,
    z_max_m: float,
    threshold_ug_m3: float = 15.0,
) -> RegionStats:
    g = run.grid
    if not (0 <= z_min_m < z_max_m <= g.nz * g.dz_m):
        raise ValueError("require 0 <= z_min < z_max <= domain height")
    if polygon_area(polygon) <= 0:
        raise ValueError("polygon must have positive area")

    areas = np.zeros((g.ny, g.nx))
    for j in range(g.ny):
        for i in range(g.nx):
            areas[j, i] = polygon_rect_area(polygon, *g.cell_bounds(i, j))

    layers: list[LayerStats] = []
    tot_v = tot_wc = tot_exc = tot_solid = tot_nodata = 0.0
    tot_n = 0
    tot_max: float | None = None
    for k in range(g.nz):
        t = z_overlap(k, g.dz_m, z_min_m, z_max_m)
        if t <= 0:
            continue
        v = wc = exc = solid_v = nodata_v = 0.0
        n = 0
        cmax: float | None = None
        for j in range(g.ny):
            for i in range(g.nx):
                w = areas[j, i] * t
                if w <= 0:
                    continue
                if run.solid[k, j, i]:
                    solid_v += w
                    continue
                c = run.concentration[k, j, i]
                if not math.isfinite(c):
                    nodata_v += w
                    continue
                n += 1
                v += w
                wc += w * c
                if c > threshold_ug_m3:
                    exc += w
                cmax = c if cmax is None else max(cmax, c)
        tot_v += v
        tot_wc += wc
        tot_exc += exc
        tot_solid += solid_v
        tot_nodata += nodata_v
        tot_n += n
        if cmax is not None:
            tot_max = cmax if tot_max is None else max(tot_max, cmax)
        layers.append(
            LayerStats(
                k=k,
                z_center_m=(k + 0.5) * g.dz_m,
                air_voxels=n,
                air_volume_m3=v,
                mean_ug_m3=wc / v if v > 0 else None,
                max_ug_m3=cmax,
                exceedance_volume_m3=exc,
                solid_volume_m3=solid_v,
                no_data_volume_m3=nodata_v,
            )
        )
    return RegionStats(
        area_m2=polygon_area(polygon),
        air_volume_m3=tot_v,
        air_voxels=tot_n,
        mean_ug_m3=tot_wc / tot_v if tot_v > 0 else None,
        max_ug_m3=tot_max,
        exceedance_volume_m3=tot_exc,
        solid_volume_m3=tot_solid,
        no_data_volume_m3=tot_nodata,
        layers=layers,
    )


# --------------------------------------------------------------------------
# Comparison (BR-45)
# --------------------------------------------------------------------------

class IncompatibleRunsError(ValueError):
    """Raised when two runs must not be compared (maps to HTTP 409)."""


def check_compatible(base: RunField, other: RunField, *, require_same_no_data: bool = True) -> None:
    reasons: list[str] = []
    for name in ("study_area_id", "crs", "scene_version", "model"):
        if getattr(base, name) != getattr(other, name):
            reasons.append(name)
    if base.grid != other.grid:
        reasons.append("grid")
    elif not np.array_equal(base.solid, other.solid):
        reasons.append("solid_mask")
    elif require_same_no_data and not np.array_equal(base.no_data, other.no_data):
        reasons.append("no_data_mask")
    if reasons:
        raise IncompatibleRunsError("incompatible runs: " + ", ".join(reasons))


@dataclass
class ComparisonCell:
    i: int
    j: int
    baseline_ug_m3: float
    comparison_ug_m3: float
    delta_ug_m3: float


@dataclass
class ComparisonResult:
    k: int
    requested_z_m: float
    z_center_m: float
    cells: list[ComparisonCell]
    air_cells: int
    delta_mean_ug_m3: float | None
    delta_min_ug_m3: float | None
    delta_max_ug_m3: float | None
    baseline_mean_ug_m3: float | None
    comparison_mean_ug_m3: float | None


def _mean(values: Iterable[float]) -> float | None:
    values = list(values)
    return sum(values) / len(values) if values else None


def compare_layer(base: RunField, other: RunField, z_m: float) -> ComparisonResult:
    """Cell-wise delta = comparison - baseline at the layer containing z_m.

    Within one layer every cell has the same volume dx*dy*dz, so the plain
    cell mean is already the air-volume-weighted mean.
    """
    check_compatible(base, other)
    g = base.grid
    k = g.layer_of(z_m)
    cells: list[ComparisonCell] = []
    for j in range(g.ny):          # ordered by (j, i), as a row-major map
        for i in range(g.nx):
            if base.solid[k, j, i]:
                continue
            a = base.concentration[k, j, i]
            b = other.concentration[k, j, i]
            if not (math.isfinite(a) and math.isfinite(b)):
                continue
            cells.append(ComparisonCell(i, j, a, b, b - a))
    d = [c.delta_ug_m3 for c in cells]
    return ComparisonResult(
        k=k,
        requested_z_m=z_m,
        z_center_m=(k + 0.5) * g.dz_m,
        cells=cells,
        air_cells=len(cells),
        delta_mean_ug_m3=_mean(d),
        delta_min_ug_m3=min(d) if d else None,
        delta_max_ug_m3=max(d) if d else None,
        baseline_mean_ug_m3=_mean(c.baseline_ug_m3 for c in cells),
        comparison_mean_ug_m3=_mean(c.comparison_ug_m3 for c in cells),
    )


# --------------------------------------------------------------------------
# Helpers for fixtures
# --------------------------------------------------------------------------

def rect(x1: float, y1: float, x2: float, y2: float) -> list[Point]:
    return [(x1, y1), (x2, y1), (x2, y2), (x1, y2), (x1, y1)]


def columns_to_field(grid: Grid, columns: dict[tuple[int, int], Sequence[float | None]]) -> np.ndarray:
    """Build a (nz, ny, nx) array from {(i, j): [c_k0, c_k1, ...]}; None -> NaN."""
    out = np.full((grid.nz, grid.ny, grid.nx), np.nan)
    for (i, j), col in columns.items():
        if len(col) != grid.nz:
            raise ValueError("column length must equal nz")
        for k, v in enumerate(col):
            out[k, j, i] = np.nan if v is None else v
    return out


def solid_from_ranges(grid: Grid, ranges: dict[tuple[int, int], tuple[int, int] | None]) -> np.ndarray:
    """Scene mask from grid_cells solid_from_k..solid_to_k (inclusive)."""
    out = np.zeros((grid.nz, grid.ny, grid.nx), dtype=bool)
    for (i, j), r in ranges.items():
        if r is not None:
            out[r[0] : r[1] + 1, j, i] = True
    return out
