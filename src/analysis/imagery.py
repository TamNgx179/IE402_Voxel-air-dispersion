"""
Satellite basemap for the A2.4 visual check: Esri World Imagery tiles.

Tiles are fetched once into data/raw/imagery/ (gitignored) and reused; the
mosaic is then warped onto the model's UTM grid so the voxel mask can be laid
over it without any on-the-fly reprojection in the plot.

Attribution, required on every figure that shows the tiles:
"Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community".
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import requests
from PIL import Image
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject

TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
ATTRIBUTION = "Ảnh nền: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
TILE_SIZE = 256
WEB_MERCATOR_HALF = 20037508.342789244


def lonlat_to_tile(lon: float, lat: float, zoom: int) -> tuple[float, float]:
    """Fractional XYZ tile coordinates (x to the east, y to the south)."""

    n = 2**zoom
    x = (lon + 180.0) / 360.0 * n
    lat_rad = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n
    return x, y


def tile_bounds_3857(x: int, y: int, zoom: int) -> tuple[float, float, float, float]:
    """(west, south, east, north) of tile (x, y) in EPSG:3857 metres."""

    size = 2 * WEB_MERCATOR_HALF / 2**zoom
    west = -WEB_MERCATOR_HALF + x * size
    north = WEB_MERCATOR_HALF - y * size
    return west, north - size, west + size, north


def fetch_tiles(bbox_lonlat: tuple[float, float, float, float], zoom: int, cache_dir: Path) -> tuple[np.ndarray, tuple]:
    """
    Mosaic covering (west, south, east, north); returns (RGB array, bounds in 3857).

    Only tiles not already cached are requested.
    """

    west, south, east, north = bbox_lonlat
    x0, y0 = lonlat_to_tile(west, north, zoom)
    x1, y1 = lonlat_to_tile(east, south, zoom)
    xs = range(int(math.floor(x0)), int(math.floor(x1)) + 1)
    ys = range(int(math.floor(y0)), int(math.floor(y1)) + 1)

    cache_dir.mkdir(parents=True, exist_ok=True)
    mosaic = np.zeros((len(ys) * TILE_SIZE, len(xs) * TILE_SIZE, 3), dtype=np.uint8)

    for row, ty in enumerate(ys):
        for col, tx in enumerate(xs):
            path = cache_dir / f"{zoom}_{ty}_{tx}.jpg"
            if not path.exists():
                response = requests.get(TILE_URL.format(z=zoom, y=ty, x=tx), timeout=30,
                                        headers={"User-Agent": "IE402-voxel-air-dispersion (coursework)"})
                response.raise_for_status()
                path.write_bytes(response.content)
            tile = np.asarray(Image.open(path).convert("RGB"))
            mosaic[row * TILE_SIZE:(row + 1) * TILE_SIZE, col * TILE_SIZE:(col + 1) * TILE_SIZE] = tile

    west3857 = tile_bounds_3857(xs[0], ys[0], zoom)[0]
    north3857 = tile_bounds_3857(xs[0], ys[0], zoom)[3]
    east3857 = tile_bounds_3857(xs[-1], ys[-1], zoom)[2]
    south3857 = tile_bounds_3857(xs[-1], ys[-1], zoom)[1]

    return mosaic, (west3857, south3857, east3857, north3857)


def warp_to_grid(
    mosaic: np.ndarray, bounds_3857: tuple, target_crs: str, extent_m: tuple[float, float, float, float], resolution_m: float
) -> np.ndarray:
    """Resample the 3857 mosaic onto a north-up grid in the model CRS; returns RGB [row, col]."""

    west, south, east, north = extent_m
    width = int(round((east - west) / resolution_m))
    height = int(round((north - south) / resolution_m))
    src_transform = from_bounds(*bounds_3857, mosaic.shape[1], mosaic.shape[0])
    dst_transform = from_bounds(west, south, east, north, width, height)

    out = np.zeros((3, height, width), dtype=np.uint8)
    for band in range(3):
        reproject(
            source=mosaic[..., band],
            destination=out[band],
            src_transform=src_transform,
            src_crs="EPSG:3857",
            dst_transform=dst_transform,
            dst_crs=target_crs,
            resampling=Resampling.bilinear,
        )
    return np.moveaxis(out, 0, -1)
