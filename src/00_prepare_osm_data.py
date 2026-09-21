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
            "select the area with the best "
            "building-height tag coverage, "
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
        "--fallback-height-m",
        type=float,
        default=9.0,
        help=(
            "Temporary M1 height assigned to "
            "buildings without OSM height/levels."
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


def prepare_building_output(
    buildings: gpd.GeoDataFrame,
    *,
    meters_per_level: float,
    fallback_height_m: float,
) -> gpd.GeoDataFrame:
    """
    Prepare buildings for 01_voxelize.py.

    Height priority
    ---------------
    1. OSM height
    2. OSM building:levels × 3 m
    3. temporary M1 fallback

    Important
    ---------
    The fallback is explicitly stored in
    prepared_height_source so it remains
    auditable.

    This is only for completing and testing
    the M1 pipeline. It is not intended as
    the final building-height dataset.
    """

    records: list[
        dict[
            str,
            Any,
        ]
    ] = []

    for (
        index,
        row,
    ) in buildings.iterrows():

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

        direct_height = (
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

        if (
            direct_height
            is not None
        ):

            height_m = (
                direct_height
            )

            source = (
                "osm:height"
            )

        elif (
            level_count
            is not None
        ):

            height_m = (
                level_count
                * meters_per_level
            )

            source = (
                "osm:building:levels"
            )

        else:

            height_m = (
                fallback_height_m
            )

            source = (
                "temporary_fallback"
            )

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
        args.fallback_height_m
        <= 0.0
    ):
        raise ValueError(
            "--fallback-height-m "
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

                    "status":
                        (
                            "failed: "
                            f"{exc}"
                        ),
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

        LOGGER.info(
            "%s: %d buildings, "
            "%.1f%% have OSM "
            "height/levels",
            name,
            coverage[
                "total_buildings"
            ],
            coverage[
                "coverage_percent"
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

    # Prefer:
    #
    # 1. highest percentage with OSM height data;
    # 2. highest absolute resolved count;
    # 3. highest building count.

    successful = (
        successful
        .sort_values(
            by=[
                "coverage_percent",
                "resolved_from_osm",
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
        successful
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
            fallback_height_m=float(
                args.fallback_height_m
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

    fallback_count = int(
        (
            prepared_buildings[
                "prepared_height_source"
            ]
            == "temporary_fallback"
        )
        .sum()
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

    print(
        "Temporary fallback "
        f"({args.fallback_height_m:.1f} m) "
        f"count: {fallback_count}"
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