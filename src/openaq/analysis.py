"""Analysis helpers for the Week-1 OpenAQ station inventory."""

from __future__ import annotations

import math

from typing import (
    Any,
    Iterable,
)

import pandas as pd


EARTH_RADIUS_M = (
    6_371_008.8
)


def haversine_distance_m(
    latitude1: float,
    longitude1: float,
    latitude2: float,
    longitude2: float,
) -> float:
    """Great-circle distance between two WGS84 coordinates."""

    lat1 = math.radians(
        float(
            latitude1
        )
    )

    lon1 = math.radians(
        float(
            longitude1
        )
    )

    lat2 = math.radians(
        float(
            latitude2
        )
    )

    lon2 = math.radians(
        float(
            longitude2
        )
    )

    dlat = (
        lat2
        - lat1
    )

    dlon = (
        lon2
        - lon1
    )

    a = (
        math.sin(
            dlat / 2.0
        )
        ** 2

        + math.cos(
            lat1
        )
        * math.cos(
            lat2
        )
        * math.sin(
            dlon / 2.0
        )
        ** 2
    )

    c = (
        2.0
        * math.atan2(
            math.sqrt(
                a
            ),

            math.sqrt(
                1.0 - a
            ),
        )
    )

    return (
        EARTH_RADIUS_M
        * c
    )


def _nested_name(
    value: Any,
) -> str | None:
    """Read name from a nested OpenAQ entity."""

    if not isinstance(
        value,
        dict,
    ):
        return None

    name = value.get(
        "name"
    )

    return (
        str(
            name
        )
        if name is not None
        else None
    )


def _nested_id(
    value: Any,
) -> int | None:
    """Read integer ID from a nested OpenAQ entity."""

    if not isinstance(
        value,
        dict,
    ):
        return None

    raw = value.get(
        "id"
    )

    try:
        return (
            int(
                raw
            )
            if raw is not None
            else None
        )

    except (
        TypeError,
        ValueError,
    ):
        return None


def _datetime_utc(
    value: Any,
) -> str | None:
    """Extract UTC datetime from OpenAQ datetime object."""

    if not isinstance(
        value,
        dict,
    ):
        return None

    raw = value.get(
        "utc"
    )

    return (
        str(
            raw
        )
        if raw is not None
        else None
    )


def _parameter_names(
    location: dict[
        str,
        Any,
    ],
) -> list[str]:
    """Return unique pollutant names measured by a location."""

    names: set[
        str
    ] = set()

    sensors = location.get(
        "sensors",
        [],
    )

    if not isinstance(
        sensors,
        list,
    ):
        return []

    for sensor in sensors:

        if not isinstance(
            sensor,
            dict,
        ):
            continue

        parameter = sensor.get(
            "parameter"
        )

        if not isinstance(
            parameter,
            dict,
        ):
            continue

        name = parameter.get(
            "name"
        )

        if name is not None:
            names.add(
                str(
                    name
                )
            )

    return sorted(
        names
    )


def locations_to_dataframe(
    locations: Iterable[
        dict[str, Any]
    ],
    *,
    study_latitude: float,
    study_longitude: float,
) -> pd.DataFrame:
    """Flatten OpenAQ locations and calculate distance to Nguyen Hue."""

    rows: list[
        dict[str, Any]
    ] = []

    for location in locations:

        coordinates = location.get(
            "coordinates"
        )

        latitude: (
            float
            | None
        ) = None

        longitude: (
            float
            | None
        ) = None

        if isinstance(
            coordinates,
            dict,
        ):
            raw_lat = coordinates.get(
                "latitude"
            )

            raw_lon = coordinates.get(
                "longitude"
            )

            try:
                if raw_lat is not None:
                    latitude = float(
                        raw_lat
                    )

                if raw_lon is not None:
                    longitude = float(
                        raw_lon
                    )

            except (
                TypeError,
                ValueError,
            ):
                latitude = None
                longitude = None

        distance_m: (
            float
            | None
        ) = None

        if (
            latitude is not None
            and longitude is not None
        ):
            distance_m = (
                haversine_distance_m(
                    study_latitude,

                    study_longitude,

                    latitude,

                    longitude,
                )
            )

        country = location.get(
            "country"
        )

        country_code = None

        country_name = None

        if isinstance(
            country,
            dict,
        ):
            if (
                country.get(
                    "code"
                )
                is not None
            ):
                country_code = str(
                    country.get(
                        "code"
                    )
                )

            if (
                country.get(
                    "name"
                )
                is not None
            ):
                country_name = str(
                    country.get(
                        "name"
                    )
                )

        parameter_names = (
            _parameter_names(
                location
            )
        )

        rows.append(
            {
                "location_id":
                    location.get(
                        "id"
                    ),

                "name":
                    location.get(
                        "name"
                    ),

                "locality":
                    location.get(
                        "locality"
                    ),

                "country_code":
                    country_code,

                "country_name":
                    country_name,

                "latitude":
                    latitude,

                "longitude":
                    longitude,

                "distance_to_nguyen_hue_m":
                    distance_m,

                "is_mobile":
                    bool(
                        location.get(
                            "isMobile",
                            False,
                        )
                    ),

                "is_monitor":
                    bool(
                        location.get(
                            "isMonitor",
                            False,
                        )
                    ),

                "owner_id":
                    _nested_id(
                        location.get(
                            "owner"
                        )
                    ),

                "owner_name":
                    _nested_name(
                        location.get(
                            "owner"
                        )
                    ),

                "provider_id":
                    _nested_id(
                        location.get(
                            "provider"
                        )
                    ),

                "provider_name":
                    _nested_name(
                        location.get(
                            "provider"
                        )
                    ),

                "parameters":
                    ",".join(
                        parameter_names
                    ),

                "has_pm25":
                    (
                        "pm25"
                        in parameter_names
                    ),

                "datetime_first_utc":
                    _datetime_utc(
                        location.get(
                            "datetimeFirst"
                        )
                    ),

                "datetime_last_utc":
                    _datetime_utc(
                        location.get(
                            "datetimeLast"
                        )
                    ),
            }
        )

    columns = [
        "location_id",

        "name",

        "locality",

        "country_code",

        "country_name",

        "latitude",

        "longitude",

        "distance_to_nguyen_hue_m",

        "is_mobile",

        "is_monitor",

        "owner_id",

        "owner_name",

        "provider_id",

        "provider_name",

        "parameters",

        "has_pm25",

        "datetime_first_utc",

        "datetime_last_utc",
    ]

    frame = pd.DataFrame(
        rows,
        columns=columns,
    )

    if not frame.empty:
        frame = frame.sort_values(
            by=[
                "distance_to_nguyen_hue_m",
                "location_id",
            ],

            na_position=
            "last",
        ).reset_index(
            drop=True
        )

    return frame


def build_inventory_summary(
    all_vietnam: pd.DataFrame,
    pm25_vietnam: pd.DataFrame,
    *,
    api_all_count: int,
    api_pm25_count: int,
    nearby_radius_m: int,
) -> pd.DataFrame:
    """Create the ROADMAP decision summary.

    This determines whether OpenAQ contains PM2.5 monitoring
    close enough to Nguyen Hue to justify later attempting
    the optional Tier-3 qualitative sanity check.
    """

    nearby_pm25 = (
        pm25_vietnam[
            pm25_vietnam[
                "distance_to_nguyen_hue_m"
            ].notna()

            & (
                pm25_vietnam[
                    "distance_to_nguyen_hue_m"
                ]
                <= float(
                    nearby_radius_m
                )
            )
        ].copy()
    )

    pm25_reference = (
        pm25_vietnam[
            pm25_vietnam[
                "is_monitor"
            ]
        ]
    )

    nearby_reference = (
        nearby_pm25[
            nearby_pm25[
                "is_monitor"
            ]
        ]
    )

    nearest_distance = None

    nearest_id = None

    nearest_name = None

    if not nearby_pm25.empty:

        nearest = (
            nearby_pm25.iloc[
                0
            ]
        )

        nearest_distance = float(
            nearest[
                "distance_to_nguyen_hue_m"
            ]
        )

        nearest_id = nearest[
            "location_id"
        ]

        nearest_name = nearest[
            "name"
        ]

    tier3_possible = (
        len(
            nearby_pm25
        )
        > 0
    )

    row = {
        "vietnam_locations_api_count":
            int(
                api_all_count
            ),

        "vietnam_locations_downloaded":
            int(
                len(
                    all_vietnam
                )
            ),

        "vietnam_pm25_locations_api_count":
            int(
                api_pm25_count
            ),

        "vietnam_pm25_locations_downloaded":
            int(
                len(
                    pm25_vietnam
                )
            ),

        "vietnam_pm25_reference_monitors":
            int(
                len(
                    pm25_reference
                )
            ),

        "nearby_radius_m":
            int(
                nearby_radius_m
            ),

        "pm25_locations_within_radius":
            int(
                len(
                    nearby_pm25
                )
            ),

        "pm25_reference_monitors_within_radius":
            int(
                len(
                    nearby_reference
                )
            ),

        "nearest_pm25_location_id":
            nearest_id,

        "nearest_pm25_location_name":
            nearest_name,

        "nearest_pm25_distance_m":
            nearest_distance,

        "tier3_qualitative_comparison_possible":
            bool(
                tier3_possible
            ),
    }

    return pd.DataFrame(
        [
            row
        ]
    )