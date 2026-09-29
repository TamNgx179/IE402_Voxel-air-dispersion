"""
Street-canyon aspect ratio H/W, measured on the model's own geometry.

docs/DECISION.md section 4 asks for "a district with distinct street
canyons", and Nguyen Hue is a wide boulevard, so whether the study area has
canyons at all is a measurable question, not a matter of opinion.

Method, stated so it can be disputed:

- sample every `step_m` along each road centreline (projected CRS);
- from each sample, march perpendicular to the road in both directions until
  the first building cell of the height raster H[y, x] (H > 0);
- W = distance between the two facades, H = mean of the two buildings' heights;
- a sample with a building on one side only (a square, a park, the river) is
  "open", not a canyon, and is counted but not given an H/W.

Measured on the rasterised H, so W is resolved to about one cell (5 m). No
canyon-regime classification is applied: docs/RESEARCH.md 5.1 forbids quoting
the Oke thresholds from a secondary source.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from shapely.geometry import LineString


@dataclass(frozen=True)
class CanyonSample:
    road_index: int
    x_m: float
    y_m: float
    width_m: float | None       # None when open on at least one side
    height_m: float | None
    aspect: float | None        # H / W


def _cell(x_m: float, y_m: float, x0: float, y0: float, dx: float, dy: float, nx: int, ny: int):
    """(j, i) of the cell whose extent holds the point, or None outside the grid."""

    i = int(np.floor((x_m - x0) / dx))
    j = int(np.floor((y_m - y0) / dy))
    if 0 <= i < nx and 0 <= j < ny:
        return j, i
    return None


def _first_building(
    height: np.ndarray, start, direction, x0, y0, dx, dy, max_distance_m, march_m
):
    """Distance and height of the first building cell along a ray, or None."""

    ny, nx = height.shape
    for distance in np.arange(march_m, max_distance_m + march_m, march_m):
        cell = _cell(start[0] + direction[0] * distance, start[1] + direction[1] * distance,
                     x0, y0, dx, dy, nx, ny)
        if cell is None:
            return None  # left the domain: unknown, treat as open
        if height[cell] > 0.0:
            return float(distance), float(height[cell])
    return None


def street_canyon_samples(
    height: np.ndarray,
    x_centres_m: np.ndarray,
    y_centres_m: np.ndarray,
    roads: list[LineString],
    *,
    step_m: float = 5.0,
    max_half_width_m: float = 60.0,
    march_m: float = 0.5,
) -> list[CanyonSample]:
    """H/W samples along every road; see the module docstring for the method."""

    dx = float(x_centres_m[1] - x_centres_m[0])
    dy = float(y_centres_m[1] - y_centres_m[0])
    x0 = float(x_centres_m[0]) - dx / 2
    y0 = float(y_centres_m[0]) - dy / 2
    ny, nx = height.shape
    samples: list[CanyonSample] = []

    for index, line in enumerate(roads):
        if line.length < step_m:
            continue

        for s in np.arange(step_m / 2, line.length, step_m):
            point = line.interpolate(s)
            ahead = line.interpolate(min(s + 0.5, line.length))
            behind = line.interpolate(max(s - 0.5, 0.0))
            tangent = np.array([ahead.x - behind.x, ahead.y - behind.y])
            norm = np.hypot(*tangent)
            if norm == 0.0:
                continue
            tangent /= norm
            normal = np.array([-tangent[1], tangent[0]])

            start = (point.x, point.y)
            cell = _cell(start[0], start[1], x0, y0, dx, dy, nx, ny)
            if cell is None or height[cell] > 0.0:
                continue  # outside the grid, or the centreline runs under a building

            left = _first_building(height, start, normal, x0, y0, dx, dy, max_half_width_m, march_m)
            right = _first_building(height, start, -normal, x0, y0, dx, dy, max_half_width_m, march_m)

            if left is None or right is None:
                samples.append(CanyonSample(index, start[0], start[1], None, None, None))
                continue

            width = left[0] + right[0]
            mean_height = 0.5 * (left[1] + right[1])
            samples.append(CanyonSample(index, start[0], start[1], width, mean_height, mean_height / width))

    return samples


def summarise_canyons(samples: list[CanyonSample], names: list[str | None]) -> dict:
    """Domain and per-street summary of H/W samples."""

    closed = [s for s in samples if s.aspect is not None]
    aspects = np.array([s.aspect for s in closed], dtype=float)

    per_street: dict[str, list[float]] = {}
    for sample in closed:
        name = names[sample.road_index] or "(không tên)"
        per_street.setdefault(name, []).append(sample.aspect)

    def stats(values: np.ndarray) -> dict:
        if values.size == 0:
            return {"n": 0}
        return {
            "n": int(values.size),
            "median": float(np.median(values)),
            "p25": float(np.percentile(values, 25)),
            "p75": float(np.percentile(values, 75)),
            "max": float(values.max()),
        }

    return {
        "samples": len(samples),
        "two_sided": len(closed),
        "open_fraction": float(1.0 - len(closed) / len(samples)) if samples else None,
        "aspect_ratio": stats(aspects),
        "width_m": stats(np.array([s.width_m for s in closed], dtype=float)),
        "height_m": stats(np.array([s.height_m for s in closed], dtype=float)),
        "per_street": {
            name: stats(np.array(values)) for name, values in sorted(per_street.items(), key=lambda kv: -len(kv[1]))
        },
    }
