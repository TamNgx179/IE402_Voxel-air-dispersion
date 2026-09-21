"""
Building heights from Google Open Buildings 2.5D Temporal.

The source chosen in docs/DECISION.md §5. Reached over plain HTTPS with no
credentials: Google's own download notebook authenticates with
AnonymousCredentials, and the GeoTIFFs are Cloud-Optimised, so a 500 m window
is a range read of a few hundred kB rather than a 1.5 GB download.

  bucket    open-buildings-temporal-data
  manifests v1/manifests/<s2token>_EPSG_<code>_<year>_06_30.json
  tiles     v1/geotiffs/<s2token><uri>          (plain string concatenation)
  band 2    building_height, metres above terrain, nodata -99, CAPPED AT 100 m

The cap is not a rounding detail. Every building taller than 100 m comes back
wrong, and the study area has three. Read the accuracy caveat in
docs/RESEARCH.md §1002 before quoting the 1.5 m MAE: it was measured in North
America, Europe and Japan, not in Vietnam.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import numpy as np
import requests

LOGGER = logging.getLogger("voxel.gob_heights")

BUCKET = "open-buildings-temporal-data"
LIST_API = f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o"
OBJECT_BASE = f"https://storage.googleapis.com/{BUCKET}"

HEIGHT_BAND = 2
NODATA = -99.0
HEIGHT_CAP_M = 100.0


def manifest_names(
    epsg_code: int,
    year: int,
    *,
    timeout_s: float = 60.0,
) -> list[str]:
    """List the manifests covering one UTM zone and year."""

    response = requests.get(
        LIST_API,
        params={
            "matchGlob": f"v1/manifests/*EPSG_{epsg_code}_{year}*",
            "maxResults": 200,
        },
        timeout=timeout_s,
    )
    response.raise_for_status()

    return [item["name"] for item in response.json().get("items", [])]


def load_manifest(
    name: str,
    *,
    cache_dir: Path | None = None,
    timeout_s: float = 300.0,
) -> dict[str, Any]:
    """Fetch one manifest, caching it because each is several megabytes."""

    cached = None if cache_dir is None else cache_dir / Path(name).name

    if cached is not None and cached.exists():
        return json.loads(cached.read_text())

    response = requests.get(f"{OBJECT_BASE}/{name}", timeout=timeout_s)
    response.raise_for_status()
    payload = response.json()

    if cached is not None:
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_text(json.dumps(payload))

    return payload


def _tile_bounds(source: dict[str, Any]) -> tuple[float, float, float, float]:
    transform = source["affineTransform"]
    dimensions = source["dimensions"]

    left = float(transform["translateX"])
    top = float(transform["translateY"])
    right = left + float(transform["scaleX"]) * int(dimensions["width"])
    bottom = top + float(transform["scaleY"]) * int(dimensions["height"])

    return left, bottom, right, top


def find_tile_url(
    x: float,
    y: float,
    *,
    epsg_code: int,
    year: int,
    cache_dir: Path | None = None,
) -> str:
    """
    The HTTPS url of the tile containing one projected point.

    Looked up rather than hard-coded, so moving the study area does not
    silently keep reading the old city's tile.
    """

    names = manifest_names(epsg_code, year)

    if not names:
        raise RuntimeError(
            f"No Open Buildings manifest for EPSG:{epsg_code} in {year}. "
            "Check the zone and year; coverage runs 2016-2023."
        )

    for name in names:
        manifest = load_manifest(name, cache_dir=cache_dir)
        prefix = manifest["uriPrefix"].replace(f"gs://{BUCKET}/", "")

        for tileset in manifest.get("tilesets", []):
            for source in tileset.get("sources", []):
                left, bottom, right, top = _tile_bounds(source)

                if left <= x <= right and bottom <= y <= top:
                    # uriPrefix and uri concatenate with no separator:
                    # ".../geotiffs/31" + "754_2023_06_30/..." is one directory.
                    return f"{OBJECT_BASE}/{prefix}{source['uris'][0]}"

    raise RuntimeError(
        f"Point ({x:.1f}, {y:.1f}) in EPSG:{epsg_code} falls in no "
        f"Open Buildings tile for {year}."
    )


def read_height_window(
    tile_url: str,
    bounds: tuple[float, float, float, float],
    *,
    buffer_m: float = 20.0,
) -> tuple[np.ndarray, Any]:
    """Range-read the height band over one bounding box."""

    import rasterio
    from rasterio.windows import from_bounds

    minx, miny, maxx, maxy = bounds

    with rasterio.open(f"/vsicurl/{tile_url}") as src:
        if not src.is_tiled:
            LOGGER.warning(
                "Tile is not internally tiled; a windowed read will fetch the "
                "whole file. Expect this to be slow."
            )

        window = from_bounds(
            minx - buffer_m,
            miny - buffer_m,
            maxx + buffer_m,
            maxy + buffer_m,
            src.transform,
        )

        return src.read(HEIGHT_BAND, window=window), src.window_transform(window)


def zonal_median_height(
    geometries: list[Any],
    height: np.ndarray,
    transform: Any,
) -> list[float | None]:
    """
    One height per footprint: the median of its own valid pixels.

    Median rather than mean because a footprint straddling a taller
    neighbour picks up its pixels at the edges.
    """

    from rasterio.features import geometry_mask

    heights: list[float | None] = []

    for geometry in geometries:
        inside = geometry_mask(
            [geometry],
            out_shape=height.shape,
            transform=transform,
            invert=True,
        )

        values = height[inside]
        values = values[(values > 0.0) & (values != NODATA)]

        heights.append(None if values.size == 0 else float(np.median(values)))

    return heights


def count_at_cap(heights: list[float | None]) -> int:
    """How many footprints sit at the 100 m ceiling, and are therefore wrong."""

    return sum(
        1
        for height in heights
        if height is not None and height >= HEIGHT_CAP_M - 1.0
    )
