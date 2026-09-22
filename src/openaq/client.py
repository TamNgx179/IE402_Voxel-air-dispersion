"""Small OpenAQ v3 client for the Week-1 station inventory task.

Authentication
--------------
OpenAQ v3 requires an API key in the ``X-API-Key`` header.

The project reads the key from the ``OPENAQ_API_KEY`` environment
variable so the secret never needs to be stored in source control.
"""

from __future__ import annotations

from dataclasses import dataclass

import os

from typing import Any

import requests


OPENAQ_BASE_URL = (
    "https://api.openaq.org/v3"
)

VIETNAM_ISO = "VN"

PM25_PARAMETER_ID = 2

MAX_PAGE_LIMIT = 1000


@dataclass(frozen=True)
class OpenAQPage:
    """One parsed OpenAQ paginated response."""

    results: list[dict[str, Any]]

    page: int

    limit: int

    found: int | str | None


class OpenAQClient:
    """Minimal requests-based OpenAQ v3 client."""

    def __init__(
        self,
        api_key: str | None = None,
        *,
        timeout_s: float = 45.0,
        session: requests.Session | None = None,
    ) -> None:

        key = (
            api_key
            if api_key is not None
            else os.getenv(
                "OPENAQ_API_KEY"
            )
        )

        if (
            key is None
            or not key.strip()
        ):
            raise RuntimeError(
                "OPENAQ_API_KEY is not set. "
                "Create an OpenAQ API key, then set it "
                "in the current PowerShell session with: "
                '$env:OPENAQ_API_KEY="YOUR_KEY"'
            )

        self.api_key = key.strip()

        self.timeout_s = float(
            timeout_s
        )

        self.session = (
            session
            or requests.Session()
        )

    def _get(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Perform one authenticated OpenAQ GET request."""

        url = (
            OPENAQ_BASE_URL
            + "/"
            + path.lstrip("/")
        )

        headers = {
            "X-API-Key":
                self.api_key,

            "Accept":
                "application/json",
        }

        try:
            response = self.session.get(
                url,

                params=params,

                headers=headers,

                timeout=
                self.timeout_s,
            )

        except requests.RequestException as exc:
            raise RuntimeError(
                "OpenAQ request failed. "
                "Check internet connection and retry."
            ) from exc

        if (
            response.status_code
            == 401
        ):
            raise RuntimeError(
                "OpenAQ returned 401 Unauthorized. "
                "Check OPENAQ_API_KEY."
            )

        if (
            response.status_code
            == 429
        ):
            reset = response.headers.get(
                "x-ratelimit-reset",
                "unknown",
            )

            raise RuntimeError(
                "OpenAQ rate limit exceeded "
                "(HTTP 429). "
                "Retry after the rate-limit reset "
                f"({reset})."
            )

        try:
            response.raise_for_status()

        except requests.HTTPError as exc:

            body = response.text[
                :500
            ]

            raise RuntimeError(
                f"OpenAQ HTTP "
                f"{response.status_code}: "
                f"{body}"
            ) from exc

        try:
            payload = response.json()

        except ValueError as exc:
            raise RuntimeError(
                "OpenAQ returned a "
                "non-JSON response."
            ) from exc

        if not isinstance(
            payload,
            dict,
        ):
            raise RuntimeError(
                "OpenAQ returned an "
                "unexpected JSON structure."
            )

        return payload

    @staticmethod
    def _parse_page(
        payload: dict[str, Any],
    ) -> OpenAQPage:
        """Validate and parse OpenAQ pagination metadata."""

        meta = payload.get(
            "meta"
        )

        results = payload.get(
            "results"
        )

        if not isinstance(
            meta,
            dict,
        ):
            raise RuntimeError(
                "OpenAQ response has no "
                "valid meta object."
            )

        if not isinstance(
            results,
            list,
        ):
            raise RuntimeError(
                "OpenAQ response has no "
                "valid results array."
            )

        try:
            page = int(
                meta.get(
                    "page",
                    1,
                )
            )

            limit = int(
                meta.get(
                    "limit",
                    len(results)
                    or 1,
                )
            )

        except (
            TypeError,
            ValueError,
        ) as exc:
            raise RuntimeError(
                "OpenAQ pagination "
                "metadata is invalid."
            ) from exc

        raw_found = (
            meta["found"]
            if "found" in meta
            else len(results)
        )

        if raw_found is None:
            found: int | str | None = None

        elif (
            isinstance(
                raw_found,
                int,
            )
            and not isinstance(
                raw_found,
                bool,
            )
        ):
            if raw_found < 0:
                raise RuntimeError(
                    "OpenAQ pagination "
                    "metadata is invalid."
                )

            found = raw_found

        elif isinstance(
            raw_found,
            str,
        ):
            found_text = raw_found.strip()

            if found_text.isdigit():
                found = int(
                    found_text
                )

            elif (
                found_text.startswith(
                    ">"
                )
                and found_text[1:].isdigit()
            ):
                # OpenAQ may return lower-bound strings such as
                # ">1" or ">1000" when an exact count would be
                # expensive. Preserve the marker and paginate
                # until the result set is exhausted.
                found = found_text

            else:
                raise RuntimeError(
                    "OpenAQ pagination "
                    "metadata is invalid."
                )

        else:
            raise RuntimeError(
                "OpenAQ pagination "
                "metadata is invalid."
            )

        return OpenAQPage(
            results=results,

            page=page,

            limit=limit,

            found=found,
        )

    def list_locations_page(
        self,
        *,
        iso: str | None = None,
        parameters_id: int | None = None,
        coordinates: tuple[
            float,
            float,
        ]
        | None = None,
        radius_m: int | None = None,
        monitor: bool | None = None,
        mobile: bool | None = None,
        limit: int = MAX_PAGE_LIMIT,
        page: int = 1,
    ) -> OpenAQPage:
        """Request one page from GET /v3/locations."""

        if not (
            1
            <= int(limit)
            <= MAX_PAGE_LIMIT
        ):
            raise ValueError(
                "limit must be between "
                f"1 and {MAX_PAGE_LIMIT}"
            )

        if int(page) < 1:
            raise ValueError(
                "page must be >= 1"
            )

        if radius_m is not None:

            if coordinates is None:
                raise ValueError(
                    "coordinates are required "
                    "when radius_m is supplied"
                )

            if not (
                1
                <= int(radius_m)
                <= 25_000
            ):
                raise ValueError(
                    "OpenAQ location radius "
                    "must be between "
                    "1 and 25,000 m"
                )

        params: dict[
            str,
            Any,
        ] = {
            "limit":
                int(limit),

            "page":
                int(page),

            "order_by":
                "id",

            "sort_order":
                "asc",
        }

        if iso is not None:
            params[
                "iso"
            ] = iso.upper()

        if (
            parameters_id
            is not None
        ):
            params[
                "parameters_id"
            ] = int(
                parameters_id
            )

        if coordinates is not None:

            (
                latitude,
                longitude,
            ) = coordinates

            params[
                "coordinates"
            ] = (
                f"{float(latitude):.4f},"
                f"{float(longitude):.4f}"
            )

        if radius_m is not None:
            params[
                "radius"
            ] = int(
                radius_m
            )

        if monitor is not None:
            params[
                "monitor"
            ] = str(
                bool(
                    monitor
                )
            ).lower()

        if mobile is not None:
            params[
                "mobile"
            ] = str(
                bool(
                    mobile
                )
            ).lower()

        payload = self._get(
            "locations",

            params=params,
        )

        return self._parse_page(
            payload
        )

    def list_all_locations(
        self,
        **filters: Any,
    ) -> list[
        dict[str, Any]
    ]:
        """Fetch every location matching the supplied filters.

        OpenAQ's ``meta.found`` may be an exact integer, ``None``, or a
        lower-bound string such as ``">1000"``. When the total is not
        exact, pagination continues until OpenAQ returns a short or empty
        page instead of trying to do arithmetic with ``meta.found``.
        """

        page_number = 1

        results: list[
            dict[str, Any]
        ] = []

        expected_found: (
            int
            | None
        ) = None

        while True:

            page = (
                self.list_locations_page(
                    **filters,

                    limit=
                    MAX_PAGE_LIMIT,

                    page=
                    page_number,
                )
            )

            if (
                expected_found
                is None
                and isinstance(
                    page.found,
                    int,
                )
            ):
                expected_found = (
                    page.found
                )

            results.extend(
                page.results
            )

            if not page.results:
                break

            if (
                isinstance(
                    page.found,
                    int,
                )
                and len(results)
                >= page.found
            ):
                break

            if (
                not isinstance(
                    page.found,
                    int,
                )
                and len(
                    page.results
                )
                < page.limit
            ):
                break

            page_number += 1

        if (
            expected_found
            is not None
            and len(results)
            != expected_found
        ):
            raise RuntimeError(
                "OpenAQ pagination returned "
                "an incomplete location set: "
                f"expected {expected_found}, "
                f"received {len(results)}"
            )

        return results

    def count_locations(
        self,
        **filters: Any,
    ) -> int:
        """Return an exact count of matching locations.

        OpenAQ may return ``meta.found`` as a lower-bound string such as
        ``">1"`` or ``">1000"``. If that happens, enumerate the
        matching location pages and count the downloaded records instead.
        """

        page = (
            self.list_locations_page(
                **filters,

                limit=
                MAX_PAGE_LIMIT,

                page=1,
            )
        )

        if isinstance(
            page.found,
            int,
        ):
            return page.found

        return len(
            self.list_all_locations(
                **filters
            )
        )
