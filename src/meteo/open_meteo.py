"""Open-Meteo client for the Week-1 meteorology task.

The ROADMAP requires:
- an hourly seasonal wind dataset,
- a representative vertical wind profile using 19 pressure levels,
- boundary-layer height (PBL),
- no API key.

The Historical Forecast endpoint is used because it exposes the same
pressure-level variables as the forecast API while providing past data.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Iterable

import pandas as pd
import requests


HISTORICAL_FORECAST_URL = (
    "https://historical-forecast-api.open-meteo.com/v1/forecast"
)


PRESSURE_LEVELS_HPA: tuple[int, ...] = (
    1000,
    975,
    950,
    925,
    900,
    850,
    800,
    700,
    600,
    500,
    400,
    300,
    250,
    200,
    150,
    100,
    70,
    50,
    30,
)


@dataclass(frozen=True)
class OpenMeteoLocation:
    """Location used by the meteorology pipeline."""

    name: str
    latitude: float
    longitude: float
    timezone: str = "Asia/Ho_Chi_Minh"


@dataclass(frozen=True)
class OpenMeteoResponse:
    """Parsed Open-Meteo response."""

    hourly: pd.DataFrame

    latitude: float
    longitude: float
    elevation_m: float

    timezone: str


def pressure_level_variables(
    levels_hpa: Iterable[int] = PRESSURE_LEVELS_HPA,
) -> list[str]:
    """Return wind and height variables for pressure levels."""

    variables: list[str] = []

    for level in levels_hpa:
        variables.extend(
            [
                f"wind_speed_{level}hPa",
                f"wind_direction_{level}hPa",
                f"geopotential_height_{level}hPa",
            ]
        )

    return variables


def _validate_date(
    value: str,
) -> str:
    """Validate YYYY-MM-DD."""

    try:
        datetime.strptime(
            value,
            "%Y-%m-%d",
        )

    except ValueError as exc:
        raise ValueError(
            f"invalid date {value!r}; "
            "expected YYYY-MM-DD"
        ) from exc

    return value


def fetch_hourly(
    location: OpenMeteoLocation,
    *,
    start_date: str,
    end_date: str,
    hourly_variables: Iterable[str],
    timeout_s: float = 90.0,
    session: requests.Session | None = None,
) -> OpenMeteoResponse:
    """Fetch hourly Historical Forecast data.

    Wind speed is requested directly in m/s.

    Timestamps are returned using the local timezone
    configured in OpenMeteoLocation.
    """

    start_date = _validate_date(
        start_date
    )

    end_date = _validate_date(
        end_date
    )

    if start_date > end_date:
        raise ValueError(
            "start_date must be <= end_date"
        )

    variables = list(
        dict.fromkeys(
            hourly_variables
        )
    )

    if not variables:
        raise ValueError(
            "hourly_variables must not be empty"
        )

    params = {
        "latitude": location.latitude,
        "longitude": location.longitude,
        "start_date": start_date,
        "end_date": end_date,
        "hourly": ",".join(
            variables
        ),
        "wind_speed_unit": "ms",
        "timezone": location.timezone,
    }

    client = (
        session
        if session is not None
        else requests.Session()
    )

    try:
        response = client.get(
            HISTORICAL_FORECAST_URL,
            params=params,
            timeout=timeout_s,
        )

        response.raise_for_status()

        payload = response.json()

    except requests.RequestException as exc:
        raise RuntimeError(
            "Open-Meteo request failed. "
            "Check internet connection and retry."
        ) from exc

    except ValueError as exc:
        raise RuntimeError(
            "Open-Meteo returned a non-JSON response."
        ) from exc

    if "error" in payload:
        raise RuntimeError(
            "Open-Meteo error: "
            + str(
                payload.get(
                    "reason",
                    payload["error"],
                )
            )
        )

    hourly = payload.get(
        "hourly"
    )

    if (
        not isinstance(
            hourly,
            dict,
        )
        or "time" not in hourly
    ):
        raise RuntimeError(
            "Open-Meteo response has no "
            "hourly time series"
        )

    frame = pd.DataFrame(
        hourly
    )

    if frame.empty:
        raise RuntimeError(
            "Open-Meteo returned an "
            "empty hourly time series"
        )

    frame["time"] = pd.to_datetime(
        frame["time"],
        errors="raise",
    )

    missing = [
        variable
        for variable in variables
        if variable
        not in frame.columns
    ]

    if missing:
        raise RuntimeError(
            "Open-Meteo response is missing "
            "requested variables: "
            + ", ".join(
                missing
            )
        )

    return OpenMeteoResponse(
        hourly=frame,

        latitude=float(
            payload.get(
                "latitude",
                location.latitude,
            )
        ),

        longitude=float(
            payload.get(
                "longitude",
                location.longitude,
            )
        ),

        elevation_m=float(
            payload.get(
                "elevation",
                0.0,
            )
        ),

        timezone=str(
            payload.get(
                "timezone",
                location.timezone,
            )
        ),
    )


def fetch_surface_year(
    location: OpenMeteoLocation,
    *,
    start_date: str,
    end_date: str,
    session: requests.Session | None = None,
) -> OpenMeteoResponse:
    """Fetch 10 m wind and PBL for seasonal analysis."""

    return fetch_hourly(
        location,

        start_date=start_date,
        end_date=end_date,

        hourly_variables=(
            "wind_speed_10m",
            "wind_direction_10m",
            "boundary_layer_height",
        ),

        session=session,
    )


def fetch_pressure_profile_day(
    location: OpenMeteoLocation,
    *,
    date: str,
    session: requests.Session | None = None,
) -> OpenMeteoResponse:
    """Fetch the complete 19-level pressure profile for one day."""

    variables = [
        "wind_speed_10m",
        "wind_direction_10m",
        "boundary_layer_height",
        *pressure_level_variables(),
    ]

    return fetch_hourly(
        location,

        start_date=date,
        end_date=date,

        hourly_variables=variables,

        session=session,
    )