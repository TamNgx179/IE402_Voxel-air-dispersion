"""Water/green layers for the scene: filtering and clipping, no network."""

from __future__ import annotations

import geopandas as gpd
import pytest
from shapely.geometry import LineString, Point, box

from src.scene.landcover import GREEN_TAGS, WATER_TAGS, prepare_layer

STUDY = gpd.GeoDataFrame(geometry=[box(0.0, 0.0, 1.0, 1.0)], crs="EPSG:4326")


def _features(rows):
    index = [("way", n) for n in range(len(rows))]
    return gpd.GeoDataFrame(rows, index=index, geometry="geometry", crs="EPSG:4326")


def test_area_is_clipped_to_the_study_area_and_keeps_its_osm_id() -> None:
    layer = prepare_layer(
        _features([{"leisure": "park", "geometry": box(0.5, 0.5, 2.0, 2.0)}]),
        STUDY,
        GREEN_TAGS,
    )

    assert list(layer["source_feature_id"]) == ["way/0"]
    assert list(layer["kind"]) == ["park"]
    assert layer.geometry.iloc[0].equals(box(0.5, 0.5, 1.0, 1.0))


def test_wrong_geometry_kinds_are_dropped_not_guessed() -> None:
    layer = prepare_layer(
        _features(
            [
                {"leisure": "park", "geometry": Point(0.5, 0.5)},
                {"natural": "water", "geometry": LineString([(0.1, 0.1), (0.9, 0.9)])},
                {"waterway": "canal", "geometry": LineString([(0.1, 0.1), (0.9, 0.9)])},
            ]
        ),
        STUDY,
        {**GREEN_TAGS, **WATER_TAGS},
    )

    assert list(layer["kind"]) == ["canal"]


def test_untagged_and_outside_features_are_ignored() -> None:
    layer = prepare_layer(
        _features(
            [
                {"leisure": "stadium", "geometry": box(0.1, 0.1, 0.2, 0.2)},
                {"leisure": "park", "geometry": box(5.0, 5.0, 6.0, 6.0)},
            ]
        ),
        STUDY,
        GREEN_TAGS,
    )

    assert layer.empty


def test_empty_answer_is_an_empty_layer_with_the_contract_columns() -> None:
    layer = prepare_layer(gpd.GeoDataFrame(geometry=[], crs="EPSG:4326"), STUDY, WATER_TAGS)

    assert layer.empty
    assert list(layer.columns) == ["source_feature_id", "kind", "geometry"]


@pytest.mark.parametrize("tags", [WATER_TAGS, GREEN_TAGS])
def test_tag_sets_do_not_overlap(tags) -> None:
    """A feature must not be both water and green in the scene."""

    other = GREEN_TAGS if tags is WATER_TAGS else WATER_TAGS
    for key, values in tags.items():
        assert not set(values) & set(other.get(key, []))  # type: ignore[arg-type]
