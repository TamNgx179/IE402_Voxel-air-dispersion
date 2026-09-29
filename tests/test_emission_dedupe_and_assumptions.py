"""
Two-way streets counted once (F6), and the generated A3.5 assumptions record.
"""

from __future__ import annotations

import sys
from pathlib import Path

import geopandas as gpd
import pytest
from shapely.geometry import LineString

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from emission.assumptions import build_assumptions_markdown, implied_vehicle_flow  # noqa: E402
from emission.roads import drop_reverse_duplicates, load_roads  # noqa: E402
from project_config import load_project_config  # noqa: E402

ROADS_PATH = REPO_ROOT / "data" / "raw" / "roads.geojson"
CONFIG_PATH = REPO_ROOT / "config" / "project.yaml"


def _roads(rows):
    return gpd.GeoDataFrame(
        [{"highway": h, "length_m": LineString(c).length} for h, c in rows],
        geometry=[LineString(c) for _, c in rows],
        crs="EPSG:32648",
    )


def test_reverse_twin_is_dropped_and_one_way_streets_kept():
    a = [(0, 0), (100, 0)]
    roads = _roads([("primary", a), ("primary", a[::-1]), ("residential", [(0, 10), (50, 10)])])

    kept = drop_reverse_duplicates(roads)

    assert len(kept) == 2
    assert kept["length_m"].sum() == pytest.approx(150.0)
    assert kept.attrs["reverse_duplicates_dropped"] == 1


def test_ec7_reverse_edges_with_different_class_are_both_kept():
    a = [(0, 0), (100, 0)]

    kept = drop_reverse_duplicates(_roads([("primary", a), ("secondary", a[::-1])]))

    assert len(kept) == 2


def test_parallel_but_distinct_carriageways_are_kept():
    kept = drop_reverse_duplicates(_roads([("primary", [(0, 0), (100, 0)]), ("primary", [(100, 3), (0, 3)])]))

    assert len(kept) == 2


@pytest.mark.skipif(not ROADS_PATH.exists(), reason="run src/00_prepare_osm_data.py first")
def test_ac5_real_network_after_dedupe():
    roads = load_roads(ROADS_PATH)

    assert len(roads) == 67
    assert roads["length_m"].sum() == pytest.approx(6395.5, abs=0.5)
    # 24 copies dropped at load for a pre-fix download, 0 for a fresh one that
    # step 00 already de-duplicated; either way none may remain.
    assert roads.attrs["reverse_duplicates_dropped"] in (0, 24)
    assert len(drop_reverse_duplicates(roads)) == len(roads)  # idempotent


# --- A3.5 ------------------------------------------------------------------

def test_implied_flow_known_answer():
    # 1 g/s from 0.1 g/veh of proxy -> 10 veh/s on a weight-1 road = 36 000 veh/h
    flow = implied_vehicle_flow(1e-3, 0.1, {"primary": 1.0, "residential": 0.25})

    assert flow.per_unit_weight_veh_h == pytest.approx(36_000.0)
    assert flow.by_class_veh_h["residential"] == pytest.approx(9_000.0)


def test_implied_flow_refuses_a_zero_proxy():
    with pytest.raises(ValueError):
        implied_vehicle_flow(1e-3, 0.0, {"primary": 1.0})


def test_ac6_assumptions_record_names_every_required_assumption():
    config = load_project_config(CONFIG_PATH)

    text = build_assumptions_markdown(config)

    for required in (
        "cấp đường",           # class weights
        "0.053",               # emission factor
        "voxel rắn",           # solid-voxel policy
        "PM2.5",               # PM -> PM2.5 label
        "Lệch năm",            # EDGAR year vs meteorology year
        "EDGAR ngụ ý",         # the implied-flow check
    ):
        assert required in text, required
    assert ("`computed`" in text) or ("`not-run`" in text)
