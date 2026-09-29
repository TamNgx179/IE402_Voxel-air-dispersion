"""
G5 street-canyon H/W against a synthetic canyon, and G2 height provenance.
"""

from __future__ import annotations

import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pytest
from shapely.geometry import LineString, box

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from analysis.morphology import street_canyon_samples, summarise_canyons  # noqa: E402

DX = 5.0
X = DX * (np.arange(40) + 0.5)   # 0 .. 200 m
Y = DX * (np.arange(40) + 0.5)


def canyon(width_cells: int, left_h: float, right_h: float) -> tuple[np.ndarray, float]:
    """Two building rows along y, a street of `width_cells` between them; returns H and street centre x."""

    height = np.zeros((40, 40))
    left_edge = 10
    right_edge = left_edge + 1 + width_cells
    height[:, 4 : left_edge + 1] = left_h
    height[:, right_edge : right_edge + 6] = right_h
    centre = DX * (left_edge + 1 + width_cells / 2)
    return height, centre


@pytest.mark.parametrize("width_cells,h", [(4, 20.0), (8, 20.0), (2, 30.0)])
def test_symmetric_canyon_aspect_is_height_over_width(width_cells, h):
    height, centre = canyon(width_cells, h, h)
    road = LineString([(centre, 20.0), (centre, 180.0)])

    samples = street_canyon_samples(height, X, Y, [road])
    closed = [s for s in samples if s.aspect is not None]

    width = width_cells * DX
    assert closed, "every sample should see both walls"
    for sample in closed:
        assert sample.width_m == pytest.approx(width, abs=1.0)   # march step 0.5 m each side
        assert sample.height_m == pytest.approx(h)
        assert sample.aspect == pytest.approx(h / width, rel=0.1)


def test_off_centre_road_still_measures_facade_to_facade():
    """A centreline 7.5 m off the canyon axis: W must still be the full 40 m."""

    height, centre = canyon(8, 20.0, 20.0)
    road = LineString([(centre - 7.5, 20.0), (centre - 7.5, 180.0)])

    closed = [s for s in street_canyon_samples(height, X, Y, [road]) if s.aspect is not None]

    assert closed
    assert all(s.width_m == pytest.approx(40.0, abs=1.0) for s in closed)


def test_asymmetric_canyon_uses_the_mean_height():
    height, centre = canyon(4, 10.0, 30.0)

    samples = street_canyon_samples(height, X, Y, [LineString([(centre, 20.0), (centre, 180.0)])])

    assert all(s.height_m == pytest.approx(20.0) for s in samples if s.aspect is not None)


def test_one_sided_street_is_open_not_a_canyon():
    height = np.zeros((40, 40))
    height[:, 4:11] = 20.0   # buildings on the west side only

    samples = street_canyon_samples(height, X, Y, [LineString([(80.0, 20.0), (80.0, 180.0)])], max_half_width_m=60.0)

    assert samples and all(s.aspect is None for s in samples)
    summary = summarise_canyons(samples, [None])
    assert summary["two_sided"] == 0 and summary["open_fraction"] == 1.0


def test_centreline_under_a_building_is_skipped():
    height = np.full((40, 40), 15.0)

    assert street_canyon_samples(height, X, Y, [LineString([(100.0, 20.0), (100.0, 180.0)])]) == []


def test_summary_groups_by_street_name():
    height, centre = canyon(4, 20.0, 20.0)
    road = LineString([(centre, 20.0), (centre, 180.0)])

    summary = summarise_canyons(street_canyon_samples(height, X, Y, [road]), ["Phố thử"])

    assert summary["per_street"]["Phố thử"]["median"] == pytest.approx(1.0, rel=0.1)


# --- G2: height provenance ---------------------------------------------------

def test_upstream_provenance_survives_tier0():
    from voxel.heights import resolve_building_heights, summarize_height_sources
    from voxel.models import HeightSettings

    buildings = gpd.GeoDataFrame(
        {
            "height": [30.0, 12.0],
            "building:levels": [None, None],
            "prepared_height_source": ["gob:building_height", "derived:median"],
        },
        geometry=[box(0, 0, 10, 10), box(20, 0, 30, 10)],
        crs="EPSG:32648",
    )
    settings = HeightSettings(
        direct_fields=("height",),
        levels_fields=("building:levels",),
        meters_per_level=3.0,
        fallback_mode="error",
        fallback_height_m=None,
        minimum_height_m=0.0,
        maximum_height_m=None,
    )

    resolved = resolve_building_heights(buildings, settings)

    assert resolved["height_source"].tolist() == ["gob:building_height", "derived:median"]
    assert summarize_height_sources(resolved) == {"derived:median": 1, "gob:building_height": 1}


VOXEL_PATH = REPO_ROOT / "data" / "processed" / "voxel_grid.nc"


@pytest.mark.skipif(not VOXEL_PATH.exists(), reason="run src/01_voxelize.py first")
def test_real_voxel_grid_reports_google_as_the_height_source():
    import json

    import xarray as xr

    with xr.open_dataset(VOXEL_PATH) as voxel:
        counts = json.loads(voxel.attrs["height_source_counts_json"])

    assert "direct:height" not in counts
    assert counts.get("gob:building_height", 0) > 0
