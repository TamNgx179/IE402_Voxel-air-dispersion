"""Offline tests for Week-1 meteorology helpers."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = (
    Path(
        __file__
    )
    .resolve()
    .parents[1]
)

SRC = (
    ROOT
    / "src"
)


if str(
    SRC
) not in sys.path:
    sys.path.insert(
        0,
        str(
            SRC
        ),
    )


from meteo.open_meteo import (  # noqa: E402
    PRESSURE_LEVELS_HPA,
    OpenMeteoResponse,
    pressure_level_variables,
)

from meteo.seasonal import (  # noqa: E402
    add_hcmc_season,
    build_season_summary,
    circular_difference_deg,
    direction_from_to_deg,
    extract_profile_at_time,
    meteorological_to_uv,
    summarize_season,
    uv_to_meteorological,
)


def test_pressure_level_list_has_exactly_19_levels():
    assert (
        len(
            PRESSURE_LEVELS_HPA
        )
        == 19
    )

    assert (
        PRESSURE_LEVELS_HPA[0]
        == 1000
    )

    assert (
        PRESSURE_LEVELS_HPA[-1]
        == 30
    )

    variables = pressure_level_variables()

    assert (
        len(
            variables
        )
        == 19 * 3
    )

    assert (
        "wind_speed_1000hPa"
        in variables
    )

    assert (
        "wind_direction_30hPa"
        in variables
    )

    assert (
        "geopotential_height_500hPa"
        in variables
    )


def test_hcmc_season_labels_cross_calendar_year():
    frame = pd.DataFrame(
        {
            "time":
                pd.to_datetime(
                    [
                        "2025-01-15 00:00",
                        "2025-04-15 00:00",
                        "2025-05-15 00:00",
                        "2025-10-15 00:00",
                        "2025-11-15 00:00",
                        "2025-12-15 00:00",
                    ]
                )
        }
    )

    result = add_hcmc_season(
        frame
    )

    assert (
        result[
            "season"
        ].tolist()
        ==
        [
            "dry_nov_apr",
            "dry_nov_apr",
            "wet_may_oct",
            "wet_may_oct",
            "dry_nov_apr",
            "dry_nov_apr",
        ]
    )


def test_direction_conversion_round_trip():
    speed = np.array(
        [
            1.0,
            2.0,
            3.0,
            4.0,
        ]
    )

    direction = np.array(
        [
            0.0,
            90.0,
            180.0,
            270.0,
        ]
    )

    u, v = meteorological_to_uv(
        speed,
        direction,
    )

    speed2, direction2 = uv_to_meteorological(
        u,
        v,
    )

    assert np.allclose(
        speed2,
        speed,
    )

    assert np.all(
        circular_difference_deg(
            direction2,
            direction,
        )
        < 1.0e-10
    )


def test_from_to_direction_is_exactly_opposite():
    from_direction = np.array(
        [
            0.0,
            45.0,
            112.7,
            180.0,
            226.9,
            359.0,
        ]
    )

    to_direction = direction_from_to_deg(
        from_direction
    )

    expected = np.array(
        [
            180.0,
            225.0,
            292.7,
            0.0,
            46.9,
            179.0,
        ]
    )

    assert np.allclose(
        to_direction,
        expected,
    )

    assert np.all(
        circular_difference_deg(
            to_direction,
            (
                from_direction
                + 180.0
            )
            % 360.0,
        )
        < 1.0e-10
    )


def _synthetic_two_season_surface_frame() -> pd.DataFrame:
    dry = pd.DataFrame(
        {
            "time":
                pd.date_range(
                    "2025-01-01",
                    periods=4,
                    freq="h",
                ),

            "wind_speed_10m":
                [
                    2.0,
                    3.0,
                    4.0,
                    3.0,
                ],

            "wind_direction_10m":
                [
                    350.0,
                    10.0,
                    355.0,
                    5.0,
                ],

            "boundary_layer_height":
                [
                    400.0,
                    500.0,
                    600.0,
                    700.0,
                ],
        }
    )

    wet = pd.DataFrame(
        {
            "time":
                pd.date_range(
                    "2025-07-01",
                    periods=4,
                    freq="h",
                ),

            "wind_speed_10m":
                [
                    4.0,
                    5.0,
                    4.0,
                    5.0,
                ],

            "wind_direction_10m":
                [
                    180.0,
                    185.0,
                    175.0,
                    180.0,
                ],

            "boundary_layer_height":
                [
                    300.0,
                    350.0,
                    400.0,
                    450.0,
                ],
        }
    )

    return pd.concat(
        [
            dry,
            wet,
        ],
        ignore_index=True,
    )


def test_vector_mean_handles_north_wraparound():
    summary = build_season_summary(
        _synthetic_two_season_surface_frame()
    )

    dry = summary.loc[
        summary[
            "season"
        ]
        == "dry_nov_apr"
    ].iloc[
        0
    ]

    assert (
        circular_difference_deg(
            dry[
                "representative_direction_from_deg"
            ],
            0.0,
        )
        < 5.0
    )


def test_summary_schema_separates_seasonal_and_hour_metrics():
    frame = (
        _synthetic_two_season_surface_frame()
    )

    summary = build_season_summary(
        frame
    )

    assert (
        summary.columns.tolist()
        ==
        [
            "season",
            "representative_direction_from_deg",
            "representative_direction_to_deg",
            "vector_mean_speed_ms",
            "representative_time_local",
            "representative_hour_speed_ms",
            "representative_hour_direction_from_deg",
            "representative_hour_direction_to_deg",
            "representative_hour_pbl_m",
            "season_mean_pbl_m",
            "sample_count",
        ]
    )

    assert (
        len(
            summary
        )
        == 2
    )

    for row in summary.itertuples(
        index=False
    ):
        assert (
            circular_difference_deg(
                row.representative_direction_to_deg,

                (
                    row.representative_direction_from_deg
                    + 180.0
                )
                % 360.0,
            )
            < 1.0e-6
        )

        assert (
            circular_difference_deg(
                row.representative_hour_direction_to_deg,

                (
                    row.representative_hour_direction_from_deg
                    + 180.0
                )
                % 360.0,
            )
            < 1.0e-6
        )


def test_representative_hour_fields_come_from_one_real_row():
    frame = (
        _synthetic_two_season_surface_frame()
    )

    dry = summarize_season(
        frame,
        "dry_nov_apr",
    )

    source = frame.loc[
        pd.to_datetime(
            frame[
                "time"
            ]
        )
        == dry.representative_time
    ]

    assert (
        len(
            source
        )
        == 1
    )

    row = source.iloc[
        0
    ]

    assert (
        dry.representative_hour_speed_ms
        == float(
            row[
                "wind_speed_10m"
            ]
        )
    )

    assert (
        dry.representative_hour_direction_from_deg
        == float(
            row[
                "wind_direction_10m"
            ]
        )
    )

    assert (
        dry.representative_hour_pbl_m
        == float(
            row[
                "boundary_layer_height"
            ]
        )
    )

    expected_season_mean_pbl = float(
        frame.loc[
            pd.to_datetime(
                frame[
                    "time"
                ]
            ).dt.month.isin(
                [
                    11,
                    12,
                    1,
                    2,
                    3,
                    4,
                ]
            ),

            "boundary_layer_height",
        ].mean()
    )

    assert (
        dry.season_mean_pbl_m
        == expected_season_mean_pbl
    )


def test_extract_profile_contains_surface_plus_19_pressure_levels():
    timestamp = pd.Timestamp(
        "2025-01-01 12:00"
    )

    row: dict[
        str,
        object,
    ] = {
        "time":
            timestamp,

        "wind_speed_10m":
            2.5,

        "wind_direction_10m":
            45.0,

        "boundary_layer_height":
            700.0,
    }

    for (
        index,
        level,
    ) in enumerate(
        PRESSURE_LEVELS_HPA
    ):
        row[
            f"wind_speed_{level}hPa"
        ] = (
            3.0
            + index
        )

        row[
            f"wind_direction_{level}hPa"
        ] = float(
            (
                45
                + index * 5
            )
            % 360
        )

        row[
            f"geopotential_height_{level}hPa"
        ] = (
            100.0
            + index
            * 1000.0
        )

    response = OpenMeteoResponse(
        hourly=pd.DataFrame(
            [
                row
            ]
        ),

        latitude=10.77,

        longitude=106.70,

        elevation_m=5.0,

        timezone="Asia/Ho_Chi_Minh",
    )

    profile = extract_profile_at_time(
        response,

        timestamp=timestamp,

        season="dry_nov_apr",
    )

    assert (
        len(
            profile
        )
        == 20
    )

    assert (
        (
            profile[
                "level_type"
            ]
            == "pressure"
        ).sum()
        == 19
    )

    assert (
        (
            profile[
                "level_type"
            ]
            == "surface"
        ).sum()
        == 1
    )

    assert (
        profile.iloc[
            0
        ][
            "height_agl_m"
        ]
        == 10.0
    )

    assert (
        "wind_direction_deg_from"
        in profile.columns
    )

    assert (
        "wind_direction_deg_to"
        in profile.columns
    )

    surface = profile.iloc[
        0
    ]

    assert (
        surface[
            "wind_direction_deg_from"
        ]
        == 45.0
    )

    assert (
        surface[
            "wind_direction_deg_to"
        ]
        == 225.0
    )

    first_pressure = profile[
        profile[
            "pressure_hpa"
        ]
        == 1000.0
    ].iloc[
        0
    ]

    assert (
        first_pressure[
            "height_agl_m"
        ]
        == 95.0
    )

    assert (
        circular_difference_deg(
            first_pressure[
                "wind_direction_deg_to"
            ],

            (
                first_pressure[
                    "wind_direction_deg_from"
                ]
                + 180.0
            )
            % 360.0,
        )
        < 1.0e-10
    )