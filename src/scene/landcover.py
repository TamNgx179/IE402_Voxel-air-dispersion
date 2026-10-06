"""
Water and green layers for the 3D city scene (spec BR-33, ROADMAP B2.4).

Neither layer enters the model: water and parks are not obstacles and emit
nothing. They exist so the web scene matches the basemap, so they come from
the same OSM snapshot and study area as the buildings, and every feature
keeps its OSM id. An empty layer is a legitimate result and is written as an
empty file, never skipped (docs/DATABASE.md §6).
"""

from __future__ import annotations

import logging
import time
from typing import Callable

import geopandas as gpd
import pandas as pd

LOGGER = logging.getLogger("scene.landcover")

# Same public instances, same order, as src/00_prepare_osm_data.py.
OVERPASS_ENDPOINTS = (
    "https://overpass-api.de/api",
    "https://maps.mail.ru/osm/tools/overpass/api",
)

WATER_TAGS: dict[str, object] = {
    "natural": ["water"],
    "waterway": ["riverbank", "river", "canal", "stream", "dock"],
    "landuse": ["reservoir", "basin"],
}

GREEN_TAGS: dict[str, object] = {
    "leisure": ["park", "garden", "playground", "pitch"],
    "landuse": ["grass", "recreation_ground", "forest", "village_green", "meadow"],
    "natural": ["wood", "scrub", "grassland"],
}

# A waterway line is drawn as a line; every other kind must be an area.
LINE_KINDS = {"river", "canal", "stream"}

OUTPUT_COLUMNS = ["source_feature_id", "kind", "geometry"]


def _kind(row: pd.Series, tags: dict[str, object]) -> str | None:
    """The first tag value that put this feature in the layer, e.g. 'park'."""

    for key, values in tags.items():
        value = row.get(key)
        if isinstance(value, str) and value in values:  # type: ignore[operator]
            return value
    return None


def _feature_id(index: object) -> str:
    """OSMnx indexes features by (element, id); keep it as 'way/123'."""

    if isinstance(index, tuple) and len(index) == 2:
        return f"{index[0]}/{index[1]}"
    return str(index)


def prepare_layer(
    features: gpd.GeoDataFrame,
    study_area: gpd.GeoDataFrame,
    tags: dict[str, object],
) -> gpd.GeoDataFrame:
    """
    Keep features that match `tags`, clip them to the study area, and reduce
    them to (source_feature_id, kind, geometry) in EPSG:4326.

    Areas must stay areas and only waterway centrelines may be lines: a park
    returned as a stray node or a riverbank as a line is dropped, not guessed.
    """

    empty = gpd.GeoDataFrame(columns=OUTPUT_COLUMNS, geometry="geometry", crs="EPSG:4326")

    if features.empty:
        return empty

    features = features.to_crs("EPSG:4326") if features.crs else features.set_crs("EPSG:4326")
    area = study_area.to_crs("EPSG:4326").geometry.union_all()

    rows = []
    for index, row in features.iterrows():
        kind = _kind(row, tags)
        geometry = row.geometry

        if kind is None or geometry is None or geometry.is_empty:
            continue

        allowed = ("LineString", "MultiLineString") if kind in LINE_KINDS else ("Polygon", "MultiPolygon")
        if geometry.geom_type not in allowed:
            continue

        clipped = geometry.intersection(area)
        if clipped.is_empty or clipped.geom_type not in allowed + ("GeometryCollection",):
            continue

        if clipped.geom_type == "GeometryCollection":
            parts = [part for part in clipped.geoms if part.geom_type in allowed]
            if not parts:
                continue
            clipped = gpd.GeoSeries(parts).union_all()

        rows.append({"source_feature_id": _feature_id(index), "kind": kind, "geometry": clipped})

    if not rows:
        return empty

    layer = gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")
    return layer.sort_values("source_feature_id").reset_index(drop=True)


def download_features(
    study_area: gpd.GeoDataFrame,
    tags: dict[str, object],
    fetch: Callable[..., gpd.GeoDataFrame] | None = None,
) -> gpd.GeoDataFrame:
    """
    Query OSM for `tags` inside the study area, trying each Overpass instance.

    OSMnx raises InsufficientResponseError when nothing matches; that is an
    answer (zero features), not a failure, so it becomes an empty frame.
    """

    import osmnx as ox

    fetch = fetch or ox.features_from_polygon
    polygon = study_area.to_crs("EPSG:4326").geometry.union_all()
    failures: list[str] = []

    for endpoint in OVERPASS_ENDPOINTS:
        ox.settings.overpass_url = endpoint
        try:
            return fetch(polygon, tags=tags)
        except ox._errors.InsufficientResponseError:
            return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
        except Exception as exc:  # network trouble: try the next instance
            failures.append(f"{endpoint}: {type(exc).__name__}: {exc}")
            LOGGER.warning("Overpass failed via %s: %s", endpoint, exc)
            time.sleep(2.0)

    raise RuntimeError("Every Overpass endpoint failed:\n" + "\n".join(failures))
