from __future__ import annotations

import argparse
import logging
import math
import re
from pathlib import Path
from typing import Any

import geopandas as gpd
import numpy as np
import osmnx as ox
import pandas as pd

from shapely.geometry import Point, box

from voxel.gob_heights import HEIGHT_CAP_M


LOGGER = logging.getLogger(
    "prepare_osm_data"
)


# File này nằm trong:
#
# repo/
# └── src/
#     └── 00_prepare_osm_data.py
#
# Vì vậy parents[1] chính là root repo.
REPO_ROOT = (
    Path(__file__)
    .resolve()
    .parents[1]
)


# ============================================================
# STUDY-AREA CANDIDATES
# ============================================================
#
# Theo roadmap:
# - thử một số địa bàn ứng viên;
# - kiểm tra mật độ tag chiều cao OSM;
# - chọn khu có dữ liệu chiều cao tốt hơn.
#
# Ba khu vực dưới đây đều là khu đô thị TP.HCM và được dùng
# cho bước bootstrap M1.
#
# Sau khi pipeline chạy ổn định, địa bàn cuối cùng vẫn có thể
# được đánh giá kỹ hơn theo:
# - trạm quan trắc;
# - traffic;
# - street canyon;
# - chất lượng chiều cao;
# - khả năng kiểm định.

CANDIDATES = [
    {
        "name": "Ben Thanh",
        "lat": 10.772516,
        "lon": 106.698020,
    },
    {
        "name": "Nguyen Hue",
        "lat": 10.774600,
        "lon": 106.703500,
    },
    {
        "name": "Landmark 81",
        "lat": 10.794985,
        "lon": 106.721966,
    },
]


# ============================================================
# SIMPLE NUMERIC PARSING
# ============================================================

NUMBER_PATTERN = re.compile(
    r"[-+]?\d+(?:[.,]\d+)?"
)

NON_METRE_PATTERN = re.compile(
    r"(?:\bft\b|\bfeet\b|\bfoot\b|')",
    re.IGNORECASE,
)


def parse_args() -> argparse.Namespace:
    """
    Parse command-line arguments.
    """

    parser = argparse.ArgumentParser(
        description=(
            "Compare three HCMC OSM candidates, "
            "select the area whose buildings are "
            "resolvable at the model grid spacing, "
            "and prepare the GeoJSON inputs "
            "required by 01_voxelize.py."
        )
    )

    parser.add_argument(
        "--area-size-m",
        type=float,
        default=500.0,
        help=(
            "Width and height of each square "
            "candidate study area in metres."
        ),
    )

    parser.add_argument(
        "--meters-per-level",
        type=float,
        default=3.0,
        help=(
            "Temporary conversion from "
            "building:levels to metres."
        ),
    )

    parser.add_argument(
        "--open-buildings-year",
        type=int,
        default=2023,
        help=(
            "Google Open Buildings 2.5D vintage "
            "to read heights from (2016-2023)."
        ),
    )

    parser.add_argument(
        "--no-open-buildings",
        action="store_true",
        help=(
            "Skip the Open Buildings download and "
            "use OSM tags alone. Offline fallback; "
            "leaves far more heights derived."
        ),
    )

    parser.add_argument(
        "--grid-spacing-m",
        type=float,
        default=5.0,
        help=(
            "Horizontal voxel size the study "
            "area must be resolvable at. Must "
            "match config/project.yaml."
        ),
    )

    parser.add_argument(
        "--min-voxels-per-side",
        type=float,
        default=4.0,
        help=(
            "A candidate is resolvable when its "
            "median footprint spans at least this "
            "many voxels per horizontal side."
        ),
    )

    return parser.parse_args()


def positive_number(
    value: Any,
    *,
    reject_non_metre_units: bool = False,
) -> float | None:
    """
    Extract the first positive numeric value.

    Examples
    --------
    12
    12.5
    "12 m"
    "12,5"

    For direct building height, explicit feet values
    are rejected instead of silently treating them
    as metres.
    """

    if value is None:
        return None

    try:
        if pd.isna(value):
            return None
    except (
        TypeError,
        ValueError,
    ):
        pass

    if isinstance(
        value,
        (
            int,
            float,
            np.integer,
            np.floating,
        ),
    ):
        number = float(
            value
        )

        if (
            math.isfinite(
                number
            )
            and number > 0.0
        ):
            return number

        return None

    text = str(
        value
    ).strip()

    if not text:
        return None

    if (
        reject_non_metre_units
        and NON_METRE_PATTERN.search(
            text
        )
    ):
        return None

    match = NUMBER_PATTERN.search(
        text
    )

    if match is None:
        return None

    try:
        number = float(
            match
            .group(0)
            .replace(
                ",",
                ".",
            )
        )

    except ValueError:
        return None

    if (
        not math.isfinite(
            number
        )
        or number <= 0.0
    ):
        return None

    return number


# ============================================================
# STUDY AREA
# ============================================================

def build_square_study_area(
    *,
    name: str,
    lat: float,
    lon: float,
    area_size_m: float,
) -> gpd.GeoDataFrame:
    """
    Create an exact square area in metres.

    Workflow
    --------
    WGS84 point
        ↓
    local UTM
        ↓
    500 m × 500 m square
        ↓
    EPSG:4326 GeoJSON
    """

    center = gpd.GeoDataFrame(
        {
            "candidate": [
                name
            ]
        },
        geometry=[
            Point(
                lon,
                lat,
            )
        ],
        crs="EPSG:4326",
    )

    utm_crs = (
        center
        .estimate_utm_crs()
    )

    if utm_crs is None:
        raise RuntimeError(
            "Could not estimate "
            f"UTM CRS for {name}."
        )

    projected = (
        center
        .to_crs(
            utm_crs
        )
    )

    point = (
        projected
        .geometry
        .iloc[0]
    )

    half = (
        area_size_m
        / 2.0
    )

    square = box(
        point.x - half,
        point.y - half,
        point.x + half,
        point.y + half,
    )

    study_area = (
        gpd.GeoDataFrame(
            {
                "candidate": [
                    name
                ],

                "center_lat": [
                    lat
                ],

                "center_lon": [
                    lon
                ],

                "size_m": [
                    area_size_m
                ],
            },
            geometry=[
                square
            ],
            crs=utm_crs,
        )
        .to_crs(
            "EPSG:4326"
        )
    )

    return study_area


# ============================================================
# OPENSTREETMAP
# ============================================================

def download_buildings(
    study_area: gpd.GeoDataFrame,
) -> gpd.GeoDataFrame:
    """
    Download OSM buildings inside a study polygon.
    """

    polygon = (
        study_area
        .geometry
        .iloc[0]
    )

    LOGGER.info(
        "Requesting OSM buildings "
        "from Overpass..."
    )

    buildings = (
        ox.features_from_polygon(
            polygon,
            tags={
                "building": True
            },
        )
    )

    if buildings.empty:
        raise RuntimeError(
            "OSM returned no "
            "building features."
        )

    # Buildings should be polygonal.
    buildings = buildings[
        buildings
        .geometry
        .geom_type
        .isin(
            [
                "Polygon",
                "MultiPolygon",
            ]
        )
    ].copy()

    # Remove invalid empty geometry rows.
    buildings = buildings[
        buildings.geometry.notna()
        & ~buildings.geometry.is_empty
    ].copy()

    if buildings.empty:
        raise RuntimeError(
            "OSM returned no polygon "
            "building features."
        )

    if buildings.crs is None:

        buildings = (
            buildings
            .set_crs(
                "EPSG:4326"
            )
        )

    else:

        buildings = (
            buildings
            .to_crs(
                "EPSG:4326"
            )
        )

    return buildings


# ============================================================
# HEIGHT COVERAGE
# ============================================================

def inspect_height_coverage(
    buildings: gpd.GeoDataFrame,
    *,
    meters_per_level: float,
) -> dict[str, Any]:
    """
    Measure how many OSM buildings have:

    1. direct height;
    2. building:levels;
    3. neither.
    """

    direct = 0
    levels = 0
    unresolved = 0

    for _, row in buildings.iterrows():

        raw_height = (
            row.get(
                "height"
            )
        )

        raw_levels = (
            row.get(
                "building:levels"
            )
        )

        height = (
            positive_number(
                raw_height,
                reject_non_metre_units=True,
            )
        )

        level_count = (
            positive_number(
                raw_levels
            )
        )

        if height is not None:

            direct += 1

        elif level_count is not None:

            levels += 1

        else:

            unresolved += 1

    total = len(
        buildings
    )

    resolved = (
        direct
        + levels
    )

    coverage = (
        resolved / total
        if total
        else 0.0
    )

    return {
        "total_buildings":
            total,

        "direct_height":
            direct,

        "levels_only":
            levels,

        "resolved_from_osm":
            resolved,

        "unresolved":
            unresolved,

        "coverage_ratio":
            coverage,

        "coverage_percent":
            coverage * 100.0,

        "meters_per_level":
            meters_per_level,
    }


# ============================================================
# MORPHOLOGY
# ============================================================

def measure_morphology(
    buildings: gpd.GeoDataFrame,
    *,
    area_size_m: float,
    grid_spacing_m: float,
) -> dict[str, Any]:
    """
    Measure how large the buildings are relative to one voxel.

    Coverage of the height tag says nothing about whether a
    building can be represented at all. A footprint two voxels
    wide is not an obstacle the solver can resolve, so this is
    the primary selection criterion and coverage is secondary.

    lambda_P is the plan area index: footprint area over domain
    area. Dense urban fabric sits around 0.3-0.5.
    """

    if len(buildings) == 0:
        return {
            "lambda_P": 0.0,
            "mean_area_m2": 0.0,
            "median_area_m2": 0.0,
            "median_voxels_per_side": 0.0,
        }

    utm = buildings.estimate_utm_crs()
    area = buildings.to_crs(utm).geometry.area

    median_area = float(area.median())

    return {
        "lambda_P": float(area.sum() / (area_size_m * area_size_m)),
        "mean_area_m2": float(area.mean()),
        "median_area_m2": median_area,
        "median_voxels_per_side": math.sqrt(median_area) / grid_spacing_m,
    }


# ============================================================
# OUTPUT PREPARATION
# ============================================================

def index_values(
    index: Any,
) -> tuple[
    str | None,
    str | None,
]:
    """
    Extract OSM element type and id
    from the OSMnx GeoDataFrame index.
    """

    if isinstance(
        index,
        tuple,
    ):

        if len(
            index
        ) >= 2:

            return (
                str(
                    index[0]
                ),
                str(
                    index[-1]
                ),
            )

        if len(
            index
        ) == 1:

            return (
                None,
                str(
                    index[0]
                ),
            )

    return (
        None,
        str(
            index
        ),
    )


def has_conflicting_values(
    value: Any,
) -> bool:
    """
    True when an OSM tag carries more than one value.

    OSM writes a disputed tag as "2;3". positive_number would
    read that as 2, which is a guess dressed up as a reading.
    Treat it as absent instead: a derived height is honest,
    a silently picked one is not.
    """

    return isinstance(value, str) and ";" in value


def resolve_heights_from_osm(
    buildings: gpd.GeoDataFrame,
    *,
    meters_per_level: float,
) -> list[tuple[float, str] | None]:
    """
    Read one height per building from OSM, or None if absent.

    Priority: a direct `height` tag, then `building:levels`
    times meters_per_level. An unparseable, disputed or
    non-metric tag counts as absent rather than raising,
    because that is ordinary OSM noise.
    """

    resolved: list[tuple[float, str] | None] = []

    for _, row in buildings.iterrows():

        raw_height = row.get("height")
        raw_levels = row.get("building:levels")

        direct_height = (
            None
            if has_conflicting_values(raw_height)
            else positive_number(
                raw_height,
                reject_non_metre_units=True,
            )
        )

        if direct_height is not None:
            resolved.append((direct_height, "osm:height"))
            continue

        level_count = (
            None
            if has_conflicting_values(raw_levels)
            else positive_number(raw_levels)
        )

        if level_count is not None:
            resolved.append(
                (
                    level_count * meters_per_level,
                    "osm:building:levels",
                )
            )
            continue

        resolved.append(None)

    return resolved


def sample_open_buildings(
    buildings: gpd.GeoDataFrame,
    *,
    year: int,
    candidate_name: str,
) -> list[float | None]:
    """
    One Google Open Buildings 2.5D height per footprint, or None.

    The primary height source, per docs/DECISION.md §5 and
    docs/RESEARCH.md §1007: OSM footprints carry the geometry, this carries
    the height. Needs no credentials.
    """

    from voxel.gob_heights import find_tile_url, read_height_window, zonal_median_height

    utm = buildings.estimate_utm_crs()
    projected = buildings.to_crs(utm)
    centre = projected.geometry.union_all().centroid

    tile_url = find_tile_url(
        centre.x,
        centre.y,
        epsg_code=int(utm.to_epsg()),
        year=year,
        cache_dir=REPO_ROOT / "cache",
    )

    LOGGER.info(
        "%s: reading Open Buildings 2.5D (%d) from %s",
        candidate_name,
        year,
        tile_url.rsplit("/", 1)[-1],
    )

    height, transform = read_height_window(
        tile_url,
        tuple(projected.total_bounds),
    )

    return zonal_median_height(list(projected.geometry), height, transform)


def cross_check_heights(
    osm: list[tuple[float, str] | None],
    gob: list[float | None],
    *,
    candidate_name: str,
) -> dict[str, Any]:
    """
    Compare the two height fields where both speak.

    The `building:levels × 3 m` cross-check docs/RESEARCH.md §1007 requires.
    It is reported, never used to silently pick a winner.
    """

    pairs = [
        (entry[0], value)
        for entry, value in zip(osm, gob)
        if entry is not None and value is not None
    ]

    if not pairs:
        return {"pairs": 0}

    osm_values = np.array([p[0] for p in pairs])
    gob_values = np.array([p[1] for p in pairs])
    difference = gob_values - osm_values

    at_cap = int((gob_values >= HEIGHT_CAP_M - 1.0).sum())
    over_cap_in_osm = int((osm_values > HEIGHT_CAP_M).sum())

    result = {
        "pairs": len(pairs),
        "mae_m": float(np.abs(difference).mean()),
        "median_abs_m": float(np.median(np.abs(difference))),
        "bias_m": float(difference.mean()),
        "correlation": (
            float(np.corrcoef(osm_values, gob_values)[0, 1])
            if len(pairs) > 1
            else float("nan")
        ),
        "gob_at_cap": at_cap,
        "osm_above_cap": over_cap_in_osm,
    }

    LOGGER.info(
        "%s: cross-check on %d buildings - MAE %.1f m, median |diff| %.1f m, "
        "bias %+.1f m, r = %.3f",
        candidate_name,
        result["pairs"],
        result["mae_m"],
        result["median_abs_m"],
        result["bias_m"],
        result["correlation"],
    )

    if over_cap_in_osm:
        LOGGER.warning(
            "%s: %d building(s) exceed the product's %.0f m ceiling, so their "
            "Open Buildings height is a floor, not a measurement. The model "
            "domain is also %.0f m tall, so the voxeliser truncates them "
            "either way.",
            candidate_name,
            over_cap_in_osm,
            HEIGHT_CAP_M,
            HEIGHT_CAP_M,
        )

    return result


def derived_height_for(
    resolved: list[tuple[float, str] | None],
    *,
    candidate_name: str,
) -> float:
    """
    The height given to buildings OSM does not describe.

    It is the median of the heights this candidate's own OSM
    data did resolve - never a written-in constant, because a
    constant is a number nobody measured. With nothing resolved
    there is nothing to derive from, and refusing is correct:
    see BR-11 in docs/spec.md.
    """

    observed = [
        entry[0]
        for entry in resolved
        if entry is not None
    ]

    if not observed:
        raise ValueError(
            f"Candidate '{candidate_name}' has no building whose "
            "height could be resolved from OSM, so no height can "
            "be derived. Refusing to write a default height "
            "(docs/spec.md BR-11)."
        )

    if len(observed) == 1:
        LOGGER.warning(
            "Candidate %s resolved exactly one height (%.1f m). "
            "The median is that single value, which is a constant "
            "in all but name.",
            candidate_name,
            observed[0],
        )

    series = pd.Series(observed)

    LOGGER.info(
        "%s: %d resolved heights, min %.1f / p25 %.1f / median %.1f "
        "/ p75 %.1f / max %.1f m",
        candidate_name,
        len(observed),
        series.min(),
        series.quantile(0.25),
        series.median(),
        series.quantile(0.75),
        series.max(),
    )

    return float(series.median())


def prepare_building_output(
    buildings: gpd.GeoDataFrame,
    *,
    meters_per_level: float,
    candidate_name: str,
    open_buildings_year: int | None = 2023,
) -> gpd.GeoDataFrame:
    """
    Prepare buildings for 01_voxelize.py.

    Height priority, as docs/DECISION.md §5 and docs/RESEARCH.md §1007 set it
    for Vietnam: OSM supplies the footprint geometry, Google Open Buildings
    2.5D supplies the height, and the OSM tags cross-check it.

    1. Google Open Buildings 2.5D `building_height`
    2. OSM height
    3. OSM building:levels × meters_per_level
    4. the median of whatever 1-3 resolved here

    Every value carries its provenance in prepared_height_source, so a reader
    can tell a measured height from a derived one. Step 4 is a documented
    limitation, not a hidden default: report the derived fraction wherever
    this data is used.

    Pass open_buildings_year=None to skip the download and fall back to OSM
    alone, which is what the offline tests do.
    """

    osm_resolved = resolve_heights_from_osm(
        buildings,
        meters_per_level=meters_per_level,
    )

    gob_heights: list[float | None] = [None] * len(buildings)

    if open_buildings_year is not None:
        gob_heights = sample_open_buildings(
            buildings,
            year=open_buildings_year,
            candidate_name=candidate_name,
        )
        cross_check_heights(
            osm_resolved,
            gob_heights,
            candidate_name=candidate_name,
        )

    resolved: list[tuple[float, str] | None] = [
        (value, "gob:building_height") if value is not None else entry
        for value, entry in zip(gob_heights, osm_resolved)
    ]

    derived_height_m = derived_height_for(
        resolved,
        candidate_name=candidate_name,
    )

    records: list[
        dict[
            str,
            Any,
        ]
    ] = []

    for position, (
        index,
        row,
    ) in enumerate(buildings.iterrows()):

        (
            osm_type,
            osm_id,
        ) = index_values(
            index
        )

        raw_height = (
            row.get(
                "height"
            )
        )

        raw_levels = (
            row.get(
                "building:levels"
            )
        )

        # Same guards as resolve_heights_from_osm, so the raw
        # columns below never advertise a value the height did
        # not actually come from.
        direct_height = (
            None
            if has_conflicting_values(
                raw_height
            )
            else positive_number(
                raw_height,
                reject_non_metre_units=True,
            )
        )

        level_count = (
            None
            if has_conflicting_values(
                raw_levels
            )
            else positive_number(
                raw_levels
            )
        )

        entry = resolved[
            position
        ]

        if entry is None:

            height_m = (
                derived_height_m
            )

            source = (
                "derived:median"
            )

        else:

            (
                height_m,
                source,
            ) = entry

        building_value = (
            row.get(
                "building"
            )
        )

        try:

            if pd.isna(
                building_value
            ):
                building_value = None

        except (
            TypeError,
            ValueError,
        ):
            pass

        records.append(
            {
                "osm_type":
                    osm_type,

                "osm_id":
                    osm_id,

                "building":
                    (
                        None
                        if building_value
                        is None
                        else str(
                            building_value
                        )
                    ),

                # 01_voxelize.py already
                # expects a direct `height`
                # field first.
                "height":
                    float(
                        height_m
                    ),

                "building:levels":
                    (
                        None
                        if level_count
                        is None
                        else float(
                            level_count
                        )
                    ),

                # Keep provenance explicitly.
                "prepared_height_source":
                    source,

                "osm_height_raw":
                    (
                        None
                        if direct_height
                        is None
                        else str(
                            raw_height
                        )
                    ),

                "osm_levels_raw":
                    (
                        None
                        if level_count
                        is None
                        else str(
                            raw_levels
                        )
                    ),

                "geometry":
                    row.geometry,
            }
        )

    prepared = (
        gpd.GeoDataFrame(
            records,
            geometry="geometry",
            crs=buildings.crs,
        )
        .reset_index(
            drop=True
        )
    )

    return prepared


# ============================================================
# MAIN
# ============================================================

def main() -> None:
    """
    Complete preparation workflow.

    3 candidate areas
        ↓
    OSM buildings
        ↓
    inspect height coverage
        ↓
    choose best candidate
        ↓
    prepare building heights
        ↓
    study_area.geojson
    buildings.geojson
    """

    args = parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format=(
            "%(levelname)s | "
            "%(name)s | "
            "%(message)s"
        ),
    )

    if (
        args.area_size_m
        <= 0.0
    ):
        raise ValueError(
            "--area-size-m "
            "must be positive."
        )

    if (
        args.meters_per_level
        <= 0.0
    ):
        raise ValueError(
            "--meters-per-level "
            "must be positive."
        )

    if (
        args.grid_spacing_m
        <= 0.0
    ):
        raise ValueError(
            "--grid-spacing-m "
            "must be positive."
        )

    if (
        args.min_voxels_per_side
        <= 0.0
    ):
        raise ValueError(
            "--min-voxels-per-side "
            "must be positive."
        )

    raw_dir = (
        REPO_ROOT
        / "data"
        / "raw"
    )

    raw_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    candidate_results: list[
        dict[
            str,
            Any,
        ]
    ] = []

    downloaded: dict[
        str,
        tuple[
            gpd.GeoDataFrame,
            gpd.GeoDataFrame,
        ],
    ] = {}

    # --------------------------------------------------------
    # CHECK ALL CANDIDATES
    # --------------------------------------------------------

    for candidate in CANDIDATES:

        name = str(
            candidate[
                "name"
            ]
        )

        LOGGER.info(
            "Checking candidate: %s",
            name,
        )

        study_area = (
            build_square_study_area(
                name=name,
                lat=float(
                    candidate[
                        "lat"
                    ]
                ),
                lon=float(
                    candidate[
                        "lon"
                    ]
                ),
                area_size_m=float(
                    args.area_size_m
                ),
            )
        )

        try:

            buildings = (
                download_buildings(
                    study_area
                )
            )

        except Exception as exc:

            LOGGER.warning(
                "Candidate %s failed: %s",
                name,
                exc,
            )

            candidate_results.append(
                {
                    "candidate":
                        name,

                    "lat":
                        candidate[
                            "lat"
                        ],

                    "lon":
                        candidate[
                            "lon"
                        ],

                    "total_buildings":
                        0,

                    "direct_height":
                        0,

                    "levels_only":
                        0,

                    "resolved_from_osm":
                        0,

                    "unresolved":
                        0,

                    "coverage_percent":
                        0.0,

                    "osm_unresolved_count":
                        0,

                    "osm_unresolved_percent":
                        0.0,

                    "lambda_P":
                        0.0,

                    "median_area_m2":
                        0.0,

                    "median_voxels_per_side":
                        0.0,

                    "status":
                        (
                            "failed: "
                            f"{exc}"
                        ),
                }
            )

            continue

        # An empty candidate is a real outcome, not a crash:
        # the request may have succeeded over a genuinely
        # unbuilt block. Record it and keep going.
        if len(buildings) == 0:

            LOGGER.warning(
                "Candidate %s returned no buildings.",
                name,
            )

            candidate_results.append(
                {
                    "candidate": name,
                    "lat": candidate["lat"],
                    "lon": candidate["lon"],
                    "total_buildings": 0,
                    "direct_height": 0,
                    "levels_only": 0,
                    "resolved_from_osm": 0,
                    "unresolved": 0,
                    "coverage_percent": 0.0,
                    "osm_unresolved_count": 0,
                    "osm_unresolved_percent": 0.0,
                    "lambda_P": 0.0,
                    "median_area_m2": 0.0,
                    "median_voxels_per_side": 0.0,
                    "status": "empty",
                }
            )

            continue

        coverage = (
            inspect_height_coverage(
                buildings,
                meters_per_level=float(
                    args.meters_per_level
                ),
            )
        )

        morphology = (
            measure_morphology(
                buildings,
                area_size_m=float(
                    args.area_size_m
                ),
                grid_spacing_m=float(
                    args.grid_spacing_m
                ),
            )
        )

        LOGGER.info(
            "%s: %d buildings, "
            "%.1f%% have OSM "
            "height/levels, "
            "median footprint spans "
            "%.1f voxels per side",
            name,
            coverage[
                "total_buildings"
            ],
            coverage[
                "coverage_percent"
            ],
            morphology[
                "median_voxels_per_side"
            ],
        )

        candidate_results.append(
            {
                "candidate":
                    name,

                "lat":
                    candidate[
                        "lat"
                    ],

                "lon":
                    candidate[
                        "lon"
                    ],

                "total_buildings":
                    coverage[
                        "total_buildings"
                    ],

                "direct_height":
                    coverage[
                        "direct_height"
                    ],

                "levels_only":
                    coverage[
                        "levels_only"
                    ],

                "resolved_from_osm":
                    coverage[
                        "resolved_from_osm"
                    ],

                "unresolved":
                    coverage[
                        "unresolved"
                    ],

                "coverage_percent":
                    round(
                        coverage[
                            "coverage_percent"
                        ],
                        3,
                    ),

                # Measured before any Open Buildings download, so
                # these describe the OSM tags alone. The final
                # provenance is written for the winner further down.
                "osm_unresolved_count":
                    coverage[
                        "unresolved"
                    ],

                "osm_unresolved_percent":
                    round(
                        100.0
                        - coverage[
                            "coverage_percent"
                        ],
                        3,
                    ),

                "lambda_P":
                    round(
                        morphology[
                            "lambda_P"
                        ],
                        3,
                    ),

                "median_area_m2":
                    round(
                        morphology[
                            "median_area_m2"
                        ],
                        1,
                    ),

                "median_voxels_per_side":
                    round(
                        morphology[
                            "median_voxels_per_side"
                        ],
                        2,
                    ),

                "status":
                    "ok",
            }
        )

        downloaded[
            name
        ] = (
            study_area,
            buildings,
        )

    # --------------------------------------------------------
    # SAVE CANDIDATE REPORT
    # --------------------------------------------------------

    report = pd.DataFrame(
        candidate_results
    )

    report_path = (
        raw_dir
        / "study_area_candidates.csv"
    )

    report.to_csv(
        report_path,
        index=False,
        encoding="utf-8-sig",
    )

    successful = report[
        report[
            "status"
        ]
        == "ok"
    ].copy()

    if successful.empty:

        raise RuntimeError(
            "All OSM candidate downloads "
            "failed. See "
            "data/raw/"
            "study_area_candidates.csv."
        )

    # Selection, in this order and for this reason:
    #
    # 1. the candidate must be RESOLVABLE - its median footprint
    #    must span at least --min-voxels-per-side voxels. A block
    #    two voxels wide is not an obstacle the solver can
    #    represent, so no amount of height data rescues it.
    # 2. among those, most absolute resolved heights.
    # 3. then coverage percent, then building count.
    #
    # Coverage percent is deliberately NOT first. Measured on
    # 2026-09-21 the top two candidates differed by 0.105
    # percentage points on samples of 62 and 154 - noise, not a
    # signal, and it had been deciding the whole study area.

    resolvable = successful[
        successful[
            "median_voxels_per_side"
        ]
        >= float(
            args.min_voxels_per_side
        )
    ].copy()

    if resolvable.empty:

        # Nobody clears the bar. Take the least-bad candidate on
        # resolution alone and say plainly that it is under-resolved.
        LOGGER.warning(
            "No candidate has a median footprint spanning %.1f "
            "voxels at %.1f m spacing. Selecting the best-resolved "
            "candidate anyway; expect building geometry to be "
            "under-resolved.",
            float(
                args.min_voxels_per_side
            ),
            float(
                args.grid_spacing_m
            ),
        )

        resolvable = successful.copy()

        primary_key = (
            "median_voxels_per_side"
        )

    else:

        # Resolution is already satisfied by everyone left, so
        # the tie-break is how much real height data there is.
        primary_key = (
            "resolved_from_osm"
        )

    resolvable = (
        resolvable
        .sort_values(
            by=[
                primary_key,
                "coverage_percent",
                "total_buildings",
            ],
            ascending=[
                False,
                False,
                False,
            ],
        )
    )

    winner_name = str(
        resolvable
        .iloc[0][
            "candidate"
        ]
    )

    (
        study_area,
        buildings,
    ) = downloaded[
        winner_name
    ]

    # --------------------------------------------------------
    # PREPARE BUILDINGS
    # --------------------------------------------------------

    prepared_buildings = (
        prepare_building_output(
            buildings,
            meters_per_level=float(
                args.meters_per_level
            ),
            candidate_name=winner_name,
            open_buildings_year=(
                None
                if args.no_open_buildings
                else int(args.open_buildings_year)
            ),
        )
    )

    study_area_path = (
        raw_dir
        / "study_area.geojson"
    )

    buildings_path = (
        raw_dir
        / "buildings.geojson"
    )

    # --------------------------------------------------------
    # SAVE FILES EXPECTED BY 01_voxelize.py
    # --------------------------------------------------------

    study_area.to_file(
        study_area_path,
        driver="GeoJSON",
    )

    prepared_buildings.to_file(
        buildings_path,
        driver="GeoJSON",
    )

    # The real provenance, after every source has had its turn.
    source_counts = (
        prepared_buildings["prepared_height_source"]
        .value_counts()
        .to_dict()
    )

    total_prepared = len(prepared_buildings)
    derived_count = int(source_counts.get("derived:median", 0))
    derived_percent = (
        100.0 * derived_count / total_prepared if total_prepared else 0.0
    )

    # Write the winner's actual breakdown back into the report, so the CSV and
    # the printed summary cannot disagree. Other candidates were never
    # prepared, so their cells stay empty rather than being guessed at.
    for column, value in (
        ("final_gob_count", int(source_counts.get("gob:building_height", 0))),
        ("final_osm_count", int(
            source_counts.get("osm:height", 0)
            + source_counts.get("osm:building:levels", 0)
        )),
        ("final_derived_median_count", derived_count),
        ("final_derived_median_percent", round(derived_percent, 3)),
    ):
        if column not in report.columns:
            report[column] = pd.NA
        report.loc[report["candidate"] == winner_name, column] = value

    report.to_csv(
        report_path,
        index=False,
        encoding="utf-8-sig",
    )

    # --------------------------------------------------------
    # SUMMARY
    # --------------------------------------------------------

    print()

    print(
        "=== STUDY AREA SELECTION ==="
    )

    print(
        report.to_string(
            index=False
        )
    )

    print()

    print(
        f"Selected candidate: "
        f"{winner_name}"
    )

    print(
        f"Study area: "
        f"{study_area_path}"
    )

    print(
        f"Buildings: "
        f"{buildings_path}"
    )

    print(
        f"Candidate report: "
        f"{report_path}"
    )

    print(
        f"Prepared buildings: "
        f"{len(prepared_buildings)}"
    )

    print()
    print("Height provenance:")

    for source, count in sorted(
        source_counts.items(),
        key=lambda item: -item[1],
    ):
        print(
            f"  {source:<24} {count:>4}  "
            f"({100.0 * count / total_prepared:.1f}%)"
        )

    print(
        f"\nHeights derived from the local median: "
        f"{derived_count} of {total_prepared} "
        f"({derived_percent:.1f}%)"
    )

    print(
        "Report this fraction wherever this dataset is used. "
        "It is a known limitation, not a hidden default."
    )

    print()

    print(
        "Next command:"
    )

    print(
        "python src/01_voxelize.py "
        "--config config/project.yaml"
    )


if __name__ == "__main__":
    main()