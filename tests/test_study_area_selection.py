"""
Study-area selection and the derived-height policy.

One test per row of .harness/tasks/a-w1-study-area/test-case-matrix.md.

The real-data test at the end is skipped unless data/processed/ has been
built, because it asserts against an actual Overpass download rather
than a fixture.
"""

from __future__ import annotations

import importlib.util
import logging
import math
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd
import pytest
from shapely.geometry import Polygon

REPO_ROOT = Path(__file__).resolve().parents[1]

# The scripts run with src/ as the script directory, so `voxel` is importable
# there. Reproduce that here rather than reaching into the package by path.
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


def _load_module():
    """Load 00_prepare_osm_data.py, whose name is not an identifier."""
    path = REPO_ROOT / "src" / "00_prepare_osm_data.py"
    spec = importlib.util.spec_from_file_location("prepare_osm_data", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


prep = _load_module()


def _square(x0: float, y0: float, side: float) -> Polygon:
    return Polygon(
        [
            (x0, y0),
            (x0 + side, y0),
            (x0 + side, y0 + side),
            (x0, y0 + side),
        ]
    )


def _buildings(rows: list[dict]) -> gpd.GeoDataFrame:
    """
    Build a GeoDataFrame in a metric CRS near the real study area.

    Coordinates are UTM 48N metres so footprint areas are exact and a
    test can state the voxel span it expects.
    """
    records = []
    geometries = []

    for position, row in enumerate(rows):
        side = math.sqrt(row.get("area_m2", 400.0))
        geometries.append(_square(690000.0 + position * 200.0, 1190000.0, side))
        records.append(
            {
                "height": row.get("height"),
                "building:levels": row.get("levels"),
                "building": row.get("building", "yes"),
            }
        )

    return gpd.GeoDataFrame(records, geometry=geometries, crs="EPSG:32648")


# ----------------------------------------------------------------------
# AC-2 / AC-3 — the derived value, and that it does not overwrite data
# ----------------------------------------------------------------------

def test_untagged_building_gets_derived_median():
    buildings = _buildings(
        [
            {"height": 10.0},
            {"height": 20.0},
            {"height": 60.0},
            {},
            {},
        ]
    )

    prepared = prep.prepare_building_output(
        buildings,
        meters_per_level=3.0,
        open_buildings_year=None,
        candidate_name="Fixture",
    )

    derived = prepared[prepared["prepared_height_source"] == "derived:median"]

    assert len(derived) == 2
    # median of [10, 20, 60] is 20, not the mean 30 and not a constant
    assert set(derived["height"]) == {20.0}


def test_tagged_buildings_keep_their_own_height():
    buildings = _buildings(
        [
            {"height": 12.0},
            {"levels": 5},
            {},
        ]
    )

    prepared = prep.prepare_building_output(
        buildings,
        meters_per_level=3.0,
        open_buildings_year=None,
        candidate_name="Fixture",
    )

    by_source = dict(
        zip(prepared["prepared_height_source"], prepared["height"])
    )

    assert by_source["osm:height"] == 12.0
    assert by_source["osm:building:levels"] == 15.0
    # the derived value must not have leaked into either of the above
    assert by_source["derived:median"] == 13.5


# ----------------------------------------------------------------------
# AC-4 — refuse rather than invent
# ----------------------------------------------------------------------

def test_no_resolvable_height_refuses():
    buildings = _buildings([{}, {}, {}])

    with pytest.raises(ValueError) as excinfo:
        prep.prepare_building_output(
            buildings,
            meters_per_level=3.0,
            open_buildings_year=None,
        candidate_name="Nowhere",
        )

    message = str(excinfo.value)
    assert "Nowhere" in message
    assert "BR-11" in message


# ----------------------------------------------------------------------
# EC-2 — one resolved height is a constant in all but name
# ----------------------------------------------------------------------

def test_single_resolved_height_warns(caplog):
    buildings = _buildings([{"height": 42.0}, {}, {}])

    with caplog.at_level(logging.WARNING, logger="prepare_osm_data"):
        prepared = prep.prepare_building_output(
            buildings,
            meters_per_level=3.0,
            open_buildings_year=None,
        candidate_name="Thin",
        )

    assert set(prepared["height"]) == {42.0}
    assert any("exactly one height" in r.message for r in caplog.records)


# ----------------------------------------------------------------------
# EC-3 — OSM tag noise is not a crash
# ----------------------------------------------------------------------

@pytest.mark.parametrize("bad", ["2;3", "ground", "", "approx", None])
def test_unparseable_tags_count_as_unresolved(bad):
    buildings = _buildings(
        [
            {"height": 30.0},
            {"levels": bad},
        ]
    )

    prepared = prep.prepare_building_output(
        buildings,
        meters_per_level=3.0,
        open_buildings_year=None,
        candidate_name="Noisy",
    )

    sources = list(prepared["prepared_height_source"])
    assert sources == ["osm:height", "derived:median"]


def test_feet_height_is_not_read_as_metres():
    buildings = _buildings([{"height": 30.0}, {"height": "40 ft"}])

    prepared = prep.prepare_building_output(
        buildings,
        meters_per_level=3.0,
        open_buildings_year=None,
        candidate_name="Imperial",
    )

    assert list(prepared["prepared_height_source"]) == [
        "osm:height",
        "derived:median",
    ]
    assert list(prepared["height"]) == [30.0, 30.0]


# ----------------------------------------------------------------------
# EC-5 — the distribution is visible next to the median
# ----------------------------------------------------------------------

def test_distribution_is_logged_with_median(caplog):
    resolved = [
        (6.0, "osm:height"),
        (30.0, "osm:height"),
        (186.0, "osm:height"),
        None,
    ]

    with caplog.at_level(logging.INFO, logger="prepare_osm_data"):
        value = prep.derived_height_for(resolved, candidate_name="Skewed")

    assert value == 30.0

    logged = " ".join(r.getMessage() for r in caplog.records)
    for marker in ("min", "p25", "median", "p75", "max"):
        assert marker in logged
    # the extremes must be visible, not just the middle
    assert "6.0" in logged and "186.0" in logged


# ----------------------------------------------------------------------
# EC-4 — a building over the domain edge belongs to step 01, not step 00
# ----------------------------------------------------------------------

def test_building_crossing_boundary_is_kept():
    buildings = _buildings([{"height": 20.0, "area_m2": 1_000_000.0}, {}])

    prepared = prep.prepare_building_output(
        buildings,
        meters_per_level=3.0,
        open_buildings_year=None,
        candidate_name="Overhang",
    )

    assert len(prepared) == 2


# ----------------------------------------------------------------------
# AC-1 / SEL-1 — morphology, and what it is used for
# ----------------------------------------------------------------------

def test_morphology_reports_voxel_span():
    # one 400 m2 footprint: 20 m on a side, four voxels at 5 m
    buildings = _buildings([{"area_m2": 400.0}])

    morphology = prep.measure_morphology(
        buildings,
        area_size_m=500.0,
        grid_spacing_m=5.0,
    )

    assert morphology["median_voxels_per_side"] == pytest.approx(4.0)
    assert morphology["lambda_P"] == pytest.approx(400.0 / 250000.0)


def test_morphology_of_empty_candidate_is_zero_not_nan():
    empty = _buildings([]).iloc[0:0]

    morphology = prep.measure_morphology(
        empty,
        area_size_m=500.0,
        grid_spacing_m=5.0,
    )

    assert morphology["median_voxels_per_side"] == 0.0
    assert not math.isnan(morphology["lambda_P"])


def test_resolvability_beats_coverage_percent():
    """
    SEL-1. The regression this whole task exists to prevent.

    'Tubes' wins on coverage by a hair and loses on resolution.
    The old criterion picked it; the new one must not.
    """
    report = pd.DataFrame(
        [
            {
                "candidate": "Tubes",
                "coverage_percent": 33.871,
                "resolved_from_osm": 52,
                "total_buildings": 154,
                "median_voxels_per_side": 2.0,
                "status": "ok",
            },
            {
                "candidate": "Blocks",
                "coverage_percent": 33.766,
                "resolved_from_osm": 21,
                "total_buildings": 62,
                "median_voxels_per_side": 4.8,
                "status": "ok",
            },
        ]
    )

    resolvable = report[report["median_voxels_per_side"] >= 4.0]

    assert len(resolvable) == 1
    assert resolvable.iloc[0]["candidate"] == "Blocks"
    # and the loser genuinely had the higher coverage
    assert report.sort_values("coverage_percent", ascending=False).iloc[0][
        "candidate"
    ] == "Tubes"


# ----------------------------------------------------------------------
# NEG-1 — the flat fallback is gone, not merely unused
# ----------------------------------------------------------------------

def test_no_constant_fallback_remains():
    source = (REPO_ROOT / "src" / "00_prepare_osm_data.py").read_text()

    assert "fallback_height_m" not in source
    assert "temporary_fallback" not in source
    assert "--fallback-height-m" not in source


# ----------------------------------------------------------------------
# AC-1 / AC-5 / AC-6 — against the real download, when one exists
# ----------------------------------------------------------------------

REPORT_PATH = REPO_ROOT / "data" / "raw" / "study_area_candidates.csv"
PROCESSED_PATH = (
    REPO_ROOT / "data" / "processed" / "buildings_with_height.geojson"
)

needs_real_data = pytest.mark.skipif(
    not REPORT_PATH.exists() or not PROCESSED_PATH.exists(),
    reason=(
        "run src/00_prepare_osm_data.py then src/01_voxelize.py first; "
        "this test asserts against a real Overpass download"
    ),
)


@needs_real_data
def test_candidate_report_has_morphology_columns():
    report = pd.read_csv(REPORT_PATH)

    assert len(report) == 3
    for column in (
        "coverage_percent",
        "lambda_P",
        "median_area_m2",
        "median_voxels_per_side",
        "osm_unresolved_count",
        "osm_unresolved_percent",
        "final_gob_count",
        "final_derived_median_count",
    ):
        assert column in report.columns

    # every candidate stays in the table, including the rejected ones
    assert set(report["candidate"]) == {
        "Ben Thanh",
        "Nguyen Hue",
        "Landmark 81",
    }


@needs_real_data
def test_derived_counts_match_between_report_and_output():
    """AC-5. The CSV and the produced dataset must not disagree."""
    report = pd.read_csv(REPORT_PATH)
    prepared = gpd.read_file(PROCESSED_PATH)

    counts = prepared["prepared_height_source"].value_counts()
    derived = int(counts.get("derived:median", 0))
    gob = int(counts.get("gob:building_height", 0))

    winner = report[report["final_gob_count"].notna()]
    assert len(winner) == 1, "exactly one candidate is prepared"

    assert int(winner.iloc[0]["final_gob_count"]) == gob
    assert int(winner.iloc[0]["final_derived_median_count"]) == derived
    assert winner.iloc[0]["final_derived_median_percent"] == pytest.approx(
        100.0 * derived / len(prepared), abs=0.01
    )


@needs_real_data
def test_open_buildings_supplies_the_heights():
    """
    docs/DECISION.md §5: Google Open Buildings 2.5D is the height source for
    Vietnam, with the OSM tags as a cross-check. If this regresses, the run
    has silently fallen back to guessing from OSM alone.
    """
    prepared = gpd.read_file(PROCESSED_PATH)
    counts = prepared["prepared_height_source"].value_counts()

    assert int(counts.get("gob:building_height", 0)) > 0
    # nothing may be left to the local-median fallback while the product covers it
    assert int(counts.get("derived:median", 0)) == 0


@needs_real_data
def test_no_height_exceeds_the_products_ceiling():
    """
    The 100 m cap is a property of the product, so a value above it would
    mean the reader picked up the wrong band.
    """
    prepared = gpd.read_file(PROCESSED_PATH)
    gob = prepared[prepared["prepared_height_source"] == "gob:building_height"]

    assert (gob["resolved_height_m"] <= 100.0).all()
    assert (gob["resolved_height_m"] > 0.0).all()


@needs_real_data
def test_real_tier0_output_is_resolvable():
    prepared = gpd.read_file(PROCESSED_PATH)

    assert len(prepared) > 0
    assert (prepared["resolved_height_m"] > 0).all()

    utm = prepared.estimate_utm_crs()
    median_area = prepared.to_crs(utm).geometry.area.median()

    assert math.sqrt(median_area) / 5.0 >= 4.0
