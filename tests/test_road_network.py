"""
Road network preparation.

One test per row of .harness/tasks/a-w1-road-network/test-case-matrix.md.

Offline except where a row is marked e2e; those skip unless the real
download has been run.
"""

from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

import geopandas as gpd
import pytest
from shapely.geometry import LineString

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


def _load_module():
    path = REPO_ROOT / "src" / "00_prepare_osm_data.py"
    spec = importlib.util.spec_from_file_location("prepare_osm_data", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


prep = _load_module()

ROADS_PATH = REPO_ROOT / "data" / "raw" / "roads.geojson"
CONFIG_PATH = REPO_ROOT / "config" / "project.yaml"

needs_real_data = pytest.mark.skipif(
    not ROADS_PATH.exists(),
    reason="run src/00_prepare_osm_data.py first; this asserts on a real download",
)


def _edges(rows: list[dict]) -> gpd.GeoDataFrame:
    """
    Fake osmnx output: WGS84 geometry with a (u, v, key) MultiIndex,
    which is the shape graph_to_gdfs returns.
    """
    import pandas as pd

    records, geometries, index = [], [], []

    for position, row in enumerate(rows):
        lon0 = 106.7035 + position * 0.002
        lat0 = 10.7746
        # a line of the requested length, laid out in degrees
        span = row.get("span_deg", 0.001)
        geometries.append(LineString([(lon0, lat0), (lon0 + span, lat0)]))
        records.append(
            {
                "highway": row.get("highway", "residential"),
                "name": row.get("name"),
                "oneway": row.get("oneway", False),
                "lanes": row.get("lanes"),
                "maxspeed": row.get("maxspeed"),
            }
        )
        index.append((position, position + 1, 0))

    return gpd.GeoDataFrame(
        records,
        geometry=geometries,
        crs="EPSG:4326",
        index=pd.MultiIndex.from_tuples(index, names=["u", "v", "key"]),
    )


# ----------------------------------------------------------------------
# AC-1 — every edge is usable by the emission step
# ----------------------------------------------------------------------

def test_every_edge_has_a_class_and_a_positive_length():
    roads = prep.prepare_road_output(
        _edges([{"highway": "primary"}, {"highway": "residential"}]),
        candidate_name="Fixture",
    )

    assert len(roads) == 2
    assert roads["highway"].notna().all()
    assert (roads["length_m"] > 0).all()


# ----------------------------------------------------------------------
# AC-2 / ROAD-2 — metres, not degrees
# ----------------------------------------------------------------------

def test_length_is_measured_in_metres_not_degrees():
    edges = _edges([{"span_deg": 0.001}])
    roads = prep.prepare_road_output(edges, candidate_name="Fixture")

    utm = edges.estimate_utm_crs()
    expected = edges.to_crs(utm).geometry.iloc[0].length

    assert roads["length_m"].iloc[0] == pytest.approx(expected, rel=0.01)


def test_length_is_not_computed_in_degrees():
    """
    ROAD-2. prepare_road_output holds both frames at once: it reprojects to
    UTM for the measurement but keeps WGS84 in the output. Taking .length
    from the wrong frame yields ~1e-5 of the truth — still a positive float,
    so AC-1 would not catch it.
    """
    edges = _edges([{"span_deg": 0.001}])
    roads = prep.prepare_road_output(edges, candidate_name="Fixture")

    degree_length = edges.geometry.iloc[0].length  # ~0.001
    metric_length = roads["length_m"].iloc[0]  # ~109

    assert metric_length > 10.0
    assert metric_length / degree_length > 1000.0


# ----------------------------------------------------------------------
# AC-3 — an empty network is an error
# ----------------------------------------------------------------------

def test_empty_network_refuses():
    with pytest.raises(ValueError) as excinfo:
        prep.prepare_road_output(_edges([]), candidate_name="Nowhere")

    message = str(excinfo.value)
    assert "Nowhere" in message
    assert "no road edges" in message


# ----------------------------------------------------------------------
# AC-4 — the allocator table
# ----------------------------------------------------------------------

def test_summary_groups_length_by_class():
    roads = prep.prepare_road_output(
        _edges(
            [
                {"highway": "primary", "span_deg": 0.004},
                {"highway": "residential", "span_deg": 0.001},
                {"highway": "residential", "span_deg": 0.001},
            ]
        ),
        candidate_name="Fixture",
    )

    summary = prep.summarise_roads(roads)

    assert set(summary.index) == {"primary", "residential"}
    assert summary.loc["residential", "edges"] == 2
    # summarise_roads rounds to 0.1 m for display, so compare at that scale
    assert summary["length_m"].sum() == pytest.approx(
        roads["length_m"].sum(), abs=0.1 * len(summary)
    )
    # sorted by total length: primary's single 0.004 edge beats
    # residential's two 0.001 ones
    assert summary.index[0] == "primary"


# ----------------------------------------------------------------------
# AC-5 — the path contract
# ----------------------------------------------------------------------

def test_config_declares_the_roads_path():
    import yaml

    config = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))

    assert config["paths"]["roads"] == "data/raw/roads.geojson"


# ----------------------------------------------------------------------
# AC-6 — the flat-ground assumption is stated, not silently held
# ----------------------------------------------------------------------

def test_flat_ground_assumption_is_documented():
    """
    Not a behaviour test. Nothing can assert the ground is flat — it was
    never measured. This asserts the project SAYS so, which is the actual
    requirement: an unstated assumption is the failure mode.
    """
    text = " ".join(
        (REPO_ROOT / "docs" / name).read_text(encoding="utf-8").lower()
        for name in ("spec.md", "DECISION.md")
    )

    assert "flat" in text or "đất phẳng" in text
    assert "glo-30" in text


# ----------------------------------------------------------------------
# EC-1 — clipping belongs to a later step
# ----------------------------------------------------------------------

def test_edge_crossing_the_boundary_is_kept():
    roads = prep.prepare_road_output(
        _edges([{"span_deg": 0.5}, {"span_deg": 0.001}]),
        candidate_name="Overhang",
    )

    assert len(roads) == 2


# ----------------------------------------------------------------------
# EC-2 — osmnx returns a list when two OSM ways merge
# ----------------------------------------------------------------------

@pytest.mark.parametrize(
    "raw,expected",
    [
        (["residential", "unclassified"], "residential"),
        (("tertiary", "primary"), "tertiary"),
        ("primary", "primary"),
        ([None, "service"], "service"),
    ],
)
def test_list_valued_highway_becomes_one_class(raw, expected):
    assert prep.normalise_highway_class(raw) == expected


def test_highway_reaches_the_output_as_a_plain_string():
    roads = prep.prepare_road_output(
        _edges([{"highway": ["residential", "unclassified"]}]),
        candidate_name="Fixture",
    )

    value = roads["highway"].iloc[0]
    assert isinstance(value, str)
    assert value == "residential"


# ----------------------------------------------------------------------
# EC-4 — absent optional tags stay absent
# ----------------------------------------------------------------------

def test_missing_optional_tags_are_null_not_nan():
    roads = prep.prepare_road_output(
        _edges([{"lanes": None, "maxspeed": None, "name": None}]),
        candidate_name="Fixture",
    )

    for column in ("lanes", "maxspeed", "name"):
        assert roads[column].iloc[0] is None


# ----------------------------------------------------------------------
# Real download
# ----------------------------------------------------------------------

@needs_real_data
def test_real_roads_file_matches_the_survey():
    """ROAD-1. The file on disk is the one the survey measured."""
    roads = gpd.read_file(ROADS_PATH)

    assert len(roads) > 0
    assert (roads["length_m"] > 0).all()
    assert roads["highway"].notna().all()

    classes = set(roads["highway"])
    assert {"residential", "tertiary", "primary", "secondary"} <= classes

    total = roads["length_m"].sum()
    assert 8000 < total < 9500, f"total length {total:.0f} m is off the survey's 8777 m"


@needs_real_data
def test_real_lengths_agree_with_an_independent_metric_measurement():
    """AC-2 against the real file, recomputed from the geometry."""
    roads = gpd.read_file(ROADS_PATH)
    utm = roads.estimate_utm_crs()
    recomputed = roads.to_crs(utm).geometry.length

    assert math.isclose(
        roads["length_m"].sum(), recomputed.sum(), rel_tol=0.01
    )


@needs_real_data
def test_nguyen_hue_carriageway_is_in_the_network():
    """
    EC-3. The plaza is tagged highway=pedestrian and is deliberately absent
    — no vehicles, no emissions. The carriageway beside it carries traffic
    and must be present, or the emission source misses the main axis.
    """
    roads = gpd.read_file(ROADS_PATH)
    names = roads["name"].astype(str)

    nguyen_hue = roads[names.str.contains("Nguyễn Huệ", na=False)]

    assert len(nguyen_hue) > 0, "the study area's main axis is missing"
    assert "pedestrian" not in set(roads["highway"])
