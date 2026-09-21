"""
Google Open Buildings 2.5D reader.

Offline. Every network call is replaced by a fixture, because a test that
needs Overpass or a 1.5 GB tile to be reachable tells you about the network,
not about the code.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
from affine import Affine
from shapely.geometry import box

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from voxel import gob_heights  # noqa: E402


def _source(translate_x, translate_y, size=25000, scale=0.5):
    return {
        "uris": ["754_2023_06_30/tile_ABC.tif"],
        "affineTransform": {
            "scaleX": scale,
            "translateX": translate_x,
            "scaleY": -scale,
            "translateY": translate_y,
        },
        "dimensions": {"width": size, "height": size},
    }


def test_tile_bounds_follow_the_affine_transform():
    left, bottom, right, top = gob_heights._tile_bounds(
        _source(679124.0, 1196280.0)
    )

    assert (left, top) == (679124.0, 1196280.0)
    # 25000 px at 0.5 m is 12.5 km, and scaleY is negative so the tile
    # extends DOWNWARD from translateY
    assert right == pytest.approx(691624.0)
    assert bottom == pytest.approx(1183780.0)


def test_tile_url_concatenates_prefix_and_uri_without_a_separator(monkeypatch):
    """
    The quirk that silently produces a 404 if you 'fix' it with a slash:
    uriPrefix ends '.../geotiffs/31' and the uri starts '754_2023_06_30/',
    so the real directory is '31754_2023_06_30'.
    """
    manifest = {
        "uriPrefix": f"gs://{gob_heights.BUCKET}/v1/geotiffs/31",
        "tilesets": [{"sources": [_source(679124.0, 1196280.0)]}],
    }

    monkeypatch.setattr(
        gob_heights, "manifest_names", lambda *a, **k: ["v1/manifests/x.json"]
    )
    monkeypatch.setattr(gob_heights, "load_manifest", lambda *a, **k: manifest)

    url = gob_heights.find_tile_url(
        686262.5, 1191574.8, epsg_code=32648, year=2023
    )

    assert url.endswith("/v1/geotiffs/31754_2023_06_30/tile_ABC.tif")
    assert "/31/754" not in url


def test_point_outside_every_tile_is_refused(monkeypatch):
    manifest = {
        "uriPrefix": f"gs://{gob_heights.BUCKET}/v1/geotiffs/31",
        "tilesets": [{"sources": [_source(679124.0, 1196280.0)]}],
    }
    monkeypatch.setattr(
        gob_heights, "manifest_names", lambda *a, **k: ["v1/manifests/x.json"]
    )
    monkeypatch.setattr(gob_heights, "load_manifest", lambda *a, **k: manifest)

    with pytest.raises(RuntimeError, match="falls in no"):
        gob_heights.find_tile_url(0.0, 0.0, epsg_code=32648, year=2023)


def test_missing_manifest_is_refused(monkeypatch):
    monkeypatch.setattr(gob_heights, "manifest_names", lambda *a, **k: [])

    with pytest.raises(RuntimeError, match="No Open Buildings manifest"):
        gob_heights.find_tile_url(1.0, 1.0, epsg_code=32648, year=1999)


# ----------------------------------------------------------------------
# Zonal statistic
# ----------------------------------------------------------------------

def _grid(values):
    """A 4x4 raster at 1 m, origin (0, 4), so pixel (r, c) covers (c, 3-r)."""
    return np.array(values, dtype="float32"), Affine(1.0, 0, 0.0, 0, -1.0, 4.0)


def test_zonal_median_uses_only_pixels_inside_the_footprint():
    height, transform = _grid(
        [
            [10.0, 10.0, 99.0, 99.0],
            [20.0, 30.0, 99.0, 99.0],
            [99.0, 99.0, 99.0, 99.0],
            [99.0, 99.0, 99.0, 99.0],
        ]
    )

    # the top-left 2x2 block only
    result = gob_heights.zonal_median_height([box(0, 2, 2, 4)], height, transform)

    assert result == [pytest.approx(15.0)]  # median of 10, 10, 20, 30


def test_nodata_and_zero_are_excluded():
    height, transform = _grid(
        [
            [gob_heights.NODATA, 0.0, 0.0, 0.0],
            [40.0, 60.0, 0.0, 0.0],
            [0.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 0.0, 0.0],
        ]
    )

    result = gob_heights.zonal_median_height([box(0, 2, 2, 4)], height, transform)

    # -99 must not drag the median down, and 0 means "no building here"
    assert result == [pytest.approx(50.0)]


def test_footprint_with_no_valid_pixel_returns_none():
    height, transform = _grid([[0.0] * 4 for _ in range(4)])

    assert gob_heights.zonal_median_height(
        [box(0, 2, 2, 4)], height, transform
    ) == [None]


# ----------------------------------------------------------------------
# The 100 m ceiling
# ----------------------------------------------------------------------

def test_cap_count_flags_heights_at_the_ceiling():
    # the product caps at 100 m, so anything at the ceiling is a floor value
    assert gob_heights.count_at_cap([99.5, 100.0, 91.0, None, 30.0]) == 2


def test_band_index_is_the_documented_height_band():
    """
    building_height is tilesetBandIndex 1 in the manifest, which is band 2
    for rasterio's 1-based indexing. Getting this wrong silently returns
    building_presence (0-1) and every building becomes a metre tall.
    """
    assert gob_heights.HEIGHT_BAND == 2
    assert gob_heights.NODATA == -99.0
    assert gob_heights.HEIGHT_CAP_M == 100.0
