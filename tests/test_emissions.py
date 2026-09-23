"""Tests for A3.1-A3.2 traffic-emission preparation."""

from __future__ import annotations

import sys
from pathlib import Path

import geopandas as gpd
import pytest
from shapely.geometry import LineString


REPO_ROOT = (
    Path(__file__)
    .resolve()
    .parents[1]
)

SRC_DIR = (
    REPO_ROOT
    / "src"
)

if str(SRC_DIR) not in sys.path:
    sys.path.insert(
        0,
        str(SRC_DIR),
    )


import emissions
from project_config import ConfigError


def _roads() -> gpd.GeoDataFrame:

    return gpd.GeoDataFrame(
        {
            "highway": [
                "primary",
                "residential",
                "residential",
                "tertiary",
            ],

            "length_m": [
                400.0,
                100.0,
                150.0,
                250.0,
            ],

            # Contradictory on purpose:
            # A3.2 must not use maxspeed.
            "maxspeed": [
                "20",
                "100",
                None,
                "10",
            ],
        },

        geometry=[
            LineString(
                [
                    (106.7000, 10.7700),
                    (106.7010, 10.7700),
                ]
            ),

            LineString(
                [
                    (106.7010, 10.7710),
                    (106.7020, 10.7710),
                ]
            ),

            LineString(
                [
                    (106.7020, 10.7720),
                    (106.7030, 10.7720),
                ]
            ),

            LineString(
                [
                    (106.7030, 10.7730),
                    (106.7040, 10.7730),
                ]
            ),
        ],

        crs="EPSG:4326",
    )


def _config(
    *,
    ef: float = 0.053,
    primary: float = 1.0,
    residential: float = 0.25,
    tertiary: float = 0.5,
) -> dict:

    return {
        "emissions": {
            "pollutant": "PM",

            "emission_factor": {
                "value_g_per_vehicle_km": ef,
                "source": "synthetic test source",
                "doi": "synthetic-test-doi",
            },

            "allocation": {
                "basis": "osm_highway_class",

                "road_class_weights": {
                    "primary": primary,
                    "residential": residential,
                    "tertiary": tertiary,
                },
            },
        }
    }


def test_a31_groups_and_preserves_totals():

    roads = _roads()

    summary = emissions.summarise_road_classes(
        roads
    )

    assert summary[
        "highway"
    ].tolist() == [
        "primary",
        "residential",
        "tertiary",
    ]

    residential = (
        summary.loc[
            summary["highway"]
            == "residential"
        ]
        .iloc[0]
    )

    assert residential[
        "edges"
    ] == 2

    assert residential[
        "length_m"
    ] == pytest.approx(
        250.0
    )

    assert int(
        summary["edges"].sum()
    ) == len(
        roads
    )

    assert (
        summary["length_m"].sum()
        ==
        pytest.approx(
            roads["length_m"].sum()
        )
    )

    assert (
        summary["share_percent"].sum()
        ==
        pytest.approx(
            100.0,
            abs=0.02,
        )
    )


def test_load_roads_rejects_missing_highway(
    tmp_path: Path,
):

    roads = _roads()

    roads.loc[
        1,
        "highway",
    ] = None

    path = (
        tmp_path
        / "roads.geojson"
    )

    roads.to_file(
        path,
        driver="GeoJSON",
    )

    with pytest.raises(
        emissions.EmissionInputError,
        match="highway",
    ):
        emissions.load_roads(
            path
        )


def test_load_roads_rejects_non_positive_length(
    tmp_path: Path,
):

    roads = _roads()

    roads.loc[
        0,
        "length_m",
    ] = 0.0

    path = (
        tmp_path
        / "roads.geojson"
    )

    roads.to_file(
        path,
        driver="GeoJSON",
    )

    with pytest.raises(
        emissions.EmissionInputError,
        match="length_m",
    ):
        emissions.load_roads(
            path
        )


def test_a32_reads_ef_from_config_not_code_literal():

    roads = _roads()

    first = (
        emissions
        .assign_edge_emission_proxies(
            roads,
            _config(
                ef=0.053
            ),
        )
    )

    doubled = (
        emissions
        .assign_edge_emission_proxies(
            roads,
            _config(
                ef=0.106
            ),
        )
    )

    assert (
        doubled[
            "emission_proxy"
        ].to_numpy()
        ==
        pytest.approx(
            2.0
            *
            first[
                "emission_proxy"
            ].to_numpy()
        )
    )

    assert (
        doubled[
            "emission_share"
        ].to_numpy()
        ==
        pytest.approx(
            first[
                "emission_share"
            ].to_numpy()
        )
    )


def test_a32_reads_class_weights_from_config():

    roads = _roads()

    baseline = (
        emissions
        .assign_edge_emission_proxies(
            roads,
            _config(
                primary=1.0
            ),
        )
    )

    changed = (
        emissions
        .assign_edge_emission_proxies(
            roads,
            _config(
                primary=2.0
            ),
        )
    )

    index = int(
        roads.index[
            roads["highway"]
            == "primary"
        ][0]
    )

    assert (
        changed.loc[
            index,
            "emission_proxy",
        ]
        ==
        pytest.approx(
            2.0
            *
            baseline.loc[
                index,
                "emission_proxy",
            ]
        )
    )


def test_a32_ignores_maxspeed():

    roads = _roads()

    first = (
        emissions
        .assign_edge_emission_proxies(
            roads,
            _config(),
        )
    )

    altered = roads.copy()

    altered[
        "maxspeed"
    ] = [
        "999",
        "1",
        "500",
        None,
    ]

    second = (
        emissions
        .assign_edge_emission_proxies(
            altered,
            _config(),
        )
    )

    assert (
        second[
            "emission_proxy"
        ].to_numpy()
        ==
        pytest.approx(
            first[
                "emission_proxy"
            ].to_numpy()
        )
    )

    assert (
        second[
            "emission_share"
        ].to_numpy()
        ==
        pytest.approx(
            first[
                "emission_share"
            ].to_numpy()
        )
    )


def test_a32_missing_class_weight_fails_instead_of_fallback():

    config = _config()

    del config[
        "emissions"
    ][
        "allocation"
    ][
        "road_class_weights"
    ][
        "tertiary"
    ]

    with pytest.raises(
        ConfigError,
        match="tertiary",
    ):
        emissions.assign_edge_emission_proxies(
            _roads(),
            config,
        )


def test_a32_missing_ef_fails_instead_of_fallback():

    config = _config()

    del config[
        "emissions"
    ][
        "emission_factor"
    ][
        "value_g_per_vehicle_km"
    ]

    with pytest.raises(
        ConfigError,
        match="value_g_per_vehicle_km",
    ):
        emissions.assign_edge_emission_proxies(
            _roads(),
            config,
        )


def test_a32_shares_sum_to_one():

    result = (
        emissions
        .assign_edge_emission_proxies(
            _roads(),
            _config(),
        )
    )

    assert (
        result[
            "emission_share"
        ].sum()
        ==
        pytest.approx(
            1.0,
            abs=1e-12,
        )
    )

    assert (
        result[
            "emission_proxy"
        ]
        > 0
    ).all()


def test_a32_geojson_round_trip(
    tmp_path: Path,
):

    result = (
        emissions
        .assign_edge_emission_proxies(
            _roads(),
            _config(),
        )
    )

    path = (
        emissions
        .write_road_emissions(
            result,
            tmp_path
            / "road_emissions.geojson",
        )
    )

    loaded = gpd.read_file(
        path
    )

    assert len(
        loaded
    ) == len(
        result
    )

    assert {
        "road_class_weight",
        "weighted_length_km",
        "ef_g_per_vehicle_km",
        "emission_proxy",
        "emission_share",
    }.issubset(
        loaded.columns
    )