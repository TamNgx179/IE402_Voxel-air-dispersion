"""Offline tests for the Week-1 OpenAQ station inventory."""

from __future__ import annotations

import sys

from pathlib import Path

import numpy as np

import pytest


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


from openaq import (  # noqa: E402
    OpenAQClient,
    build_inventory_summary,
    haversine_distance_m,
    locations_to_dataframe,
)


def _location(
    location_id: int,
    *,
    name: str,
    latitude: float,
    longitude: float,
    pm25: bool,
    monitor: bool,
) -> dict:
    """Build one fake OpenAQ v3 location."""

    sensors = []

    if pm25:
        sensors.append(
            {
                "id":
                    location_id
                    * 10,

                "name":
                    "PM2.5 sensor",

                "parameter": {
                    "id":
                        2,

                    "name":
                        "pm25",

                    "units":
                        "µg/m³",
                },
            }
        )

    return {
        "id":
            location_id,

        "name":
            name,

        "locality":
            "Ho Chi Minh City",

        "timezone":
            "Asia/Ho_Chi_Minh",

        "country": {
            "id":
                56,

            "code":
                "VN",

            "name":
                "Vietnam",
        },

        "owner": {
            "id":
                1,

            "name":
                "Example owner",
        },

        "provider": {
            "id":
                2,

            "name":
                "Example provider",
        },

        "isMobile":
            False,

        "isMonitor":
            monitor,

        "instruments":
            [],

        "sensors":
            sensors,

        "coordinates": {
            "latitude":
                latitude,

            "longitude":
                longitude,
        },

        "licenses":
            [],

        "bounds": [
            longitude,
            latitude,
            longitude,
            latitude,
        ],

        "datetimeFirst": {
            "utc":
                "2024-01-01T00:00:00Z",

            "local":
                "2024-01-01T07:00:00+07:00",
        },

        "datetimeLast": {
            "utc":
                "2025-12-31T00:00:00Z",

            "local":
                "2025-12-31T07:00:00+07:00",
        },
    }


def test_haversine_zero_distance():

    assert (
        haversine_distance_m(
            10.7746,
            106.7035,
            10.7746,
            106.7035,
        )
        == pytest.approx(
            0.0
        )
    )


def test_haversine_one_degree_latitude_is_about_111_km():

    distance = (
        haversine_distance_m(
            10.0,
            106.0,
            11.0,
            106.0,
        )
    )

    assert (
        110_000
        < distance
        < 112_000
    )


def test_location_flattening_detects_pm25_and_sorts_by_distance():

    locations = [
        _location(
            2,

            name=
            "Far PM25",

            latitude=
            10.90,

            longitude=
            106.80,

            pm25=
            True,

            monitor=
            False,
        ),

        _location(
            1,

            name=
            "Near PM25",

            latitude=
            10.775,

            longitude=
            106.704,

            pm25=
            True,

            monitor=
            True,
        ),
    ]

    frame = (
        locations_to_dataframe(
            locations,

            study_latitude=
            10.7746,

            study_longitude=
            106.7035,
        )
    )

    assert (
        frame[
            "location_id"
        ].tolist()
        ==
        [
            1,
            2,
        ]
    )

    assert (
        frame[
            "has_pm25"
        ].tolist()
        ==
        [
            True,
            True,
        ]
    )

    assert (
        frame.iloc[
            0
        ][
            "is_monitor"
        ]
        == np.bool_(
            True
        )
    )

    assert (
        "pm25"
        in frame.iloc[
            0
        ][
            "parameters"
        ]
    )


def test_inventory_summary_reports_nearby_pm25_and_reference_monitor():

    all_locations = [
        _location(
            1,

            name=
            "Near PM25",

            latitude=
            10.775,

            longitude=
            106.704,

            pm25=
            True,

            monitor=
            True,
        ),

        _location(
            2,

            name=
            "Far PM25",

            latitude=
            11.5,

            longitude=
            107.0,

            pm25=
            True,

            monitor=
            False,
        ),

        _location(
            3,

            name=
            "Other pollutant",

            latitude=
            10.80,

            longitude=
            106.72,

            pm25=
            False,

            monitor=
            True,
        ),
    ]

    all_frame = (
        locations_to_dataframe(
            all_locations,

            study_latitude=
            10.7746,

            study_longitude=
            106.7035,
        )
    )

    pm25_frame = (
        all_frame[
            all_frame[
                "has_pm25"
            ]
        ].copy()
    )

    summary = (
        build_inventory_summary(
            all_frame,

            pm25_frame,

            api_all_count=
            3,

            api_pm25_count=
            2,

            nearby_radius_m=
            25_000,
        )
    )

    row = summary.iloc[
        0
    ]

    assert (
        row[
            "vietnam_locations_api_count"
        ]
        == 3
    )

    assert (
        row[
            "vietnam_pm25_locations_api_count"
        ]
        == 2
    )

    assert (
        row[
            "pm25_locations_within_radius"
        ]
        == 1
    )

    assert (
        row[
            "pm25_reference_monitors_within_radius"
        ]
        == 1
    )

    assert (
        row[
            "nearest_pm25_location_id"
        ]
        == 1
    )

    assert bool(
        row[
            "tier3_qualitative_comparison_possible"
        ]
    )


def test_inventory_summary_can_report_tier3_not_available():

    far = _location(
        9,

        name=
        "Very far PM25",

        latitude=
        21.0,

        longitude=
        105.8,

        pm25=
        True,

        monitor=
        True,
    )

    pm25_frame = (
        locations_to_dataframe(
            [
                far
            ],

            study_latitude=
            10.7746,

            study_longitude=
            106.7035,
        )
    )

    summary = (
        build_inventory_summary(
            pm25_frame,

            pm25_frame,

            api_all_count=
            1,

            api_pm25_count=
            1,

            nearby_radius_m=
            25_000,
        )
    )

    row = summary.iloc[
        0
    ]

    assert (
        row[
            "pm25_locations_within_radius"
        ]
        == 0
    )

    assert not bool(
        row[
            "tier3_qualitative_comparison_possible"
        ]
    )


class _FakeResponse:
    """Tiny fake requests.Response for offline client tests."""

    def __init__(
        self,
        payload: dict,
        status_code: int = 200,
    ):
        self._payload = payload

        self.status_code = (
            status_code
        )

        self.headers = {}

        self.text = "fake"

    def raise_for_status(
        self,
    ):
        if (
            self.status_code
            >= 400
        ):
            raise RuntimeError(
                "fake HTTP error"
            )

    def json(
        self,
    ):
        return self._payload


class _FakeSession:
    """Fake requests session supporting paginated responses."""

    def __init__(
        self,
        pages: dict[
            int,
            dict,
        ],
    ):
        self.pages = pages

        self.calls: list[
            dict
        ] = []

    def get(
        self,
        url,
        *,
        params,
        headers,
        timeout,
    ):
        self.calls.append(
            {
                "url":
                    url,

                "params":
                    dict(
                        params
                    ),

                "headers":
                    dict(
                        headers
                    ),

                "timeout":
                    timeout,
            }
        )

        page = int(
            params[
                "page"
            ]
        )

        return _FakeResponse(
            self.pages[
                page
            ]
        )


def test_client_pagination_and_api_key_header():

    pages = {
        1: {
            "meta": {
                "page":
                    1,

                "limit":
                    1000,

                "found":
                    2,
            },

            "results": [
                {
                    "id":
                        1
                },
            ],
        },

        2: {
            "meta": {
                "page":
                    2,

                "limit":
                    1000,

                "found":
                    2,
            },

            "results": [
                {
                    "id":
                        2
                },
            ],
        },
    }

    session = (
        _FakeSession(
            pages
        )
    )

    client = OpenAQClient(
        api_key=
        "secret-test-key",

        session=
        session,
    )

    results = (
        client.list_all_locations(
            iso=
            "VN",

            parameters_id=
            2,
        )
    )

    assert (
        [
            item[
                "id"
            ]
            for item
            in results
        ]
        ==
        [
            1,
            2,
        ]
    )

    assert (
        len(
            session.calls
        )
        == 2
    )

    assert (
        session.calls[
            0
        ][
            "headers"
        ][
            "X-API-Key"
        ]
        ==
        "secret-test-key"
    )

    assert (
        session.calls[
            0
        ][
            "params"
        ][
            "iso"
        ]
        ==
        "VN"
    )

    assert (
        session.calls[
            0
        ][
            "params"
        ][
            "parameters_id"
        ]
        == 2
    )


def test_missing_api_key_is_rejected(
    monkeypatch,
):

    monkeypatch.delenv(
        "OPENAQ_API_KEY",

        raising=False,
    )

    with pytest.raises(
        RuntimeError,

        match=
        "OPENAQ_API_KEY",
    ):
        OpenAQClient(
            api_key=None
        )