"""Week-1 OpenAQ station inventory for Vietnam.

ROADMAP question
----------------
"OpenAQ — count the real number of stations in Vietnam."

This script intentionally stops at station availability.

It does NOT yet pull PM2.5 measurement time series.
That belongs to the later optional Tier-3 qualitative comparison.

Secret handling
---------------
Set OPENAQ_API_KEY in the current shell.

Never commit the API key into the repository.
"""

from __future__ import annotations

import sys

from pathlib import Path


SRC_DIR = (
    Path(
        __file__
    )
    .resolve()
    .parent
)

ROOT_DIR = (
    SRC_DIR.parent
)


if str(
    SRC_DIR
) not in sys.path:
    sys.path.insert(
        0,
        str(
            SRC_DIR
        ),
    )


from openaq import (  # noqa: E402
    PM25_PARAMETER_ID,
    VIETNAM_ISO,
    OpenAQClient,
    build_inventory_summary,
    locations_to_dataframe,
)


STUDY_NAME = (
    "Nguyen Hue, HCMC"
)

STUDY_LATITUDE = (
    10.7746
)

STUDY_LONGITUDE = (
    106.7035
)

# OpenAQ location queries support at most 25 km.
# We use the same distance as the local availability criterion.
NEARBY_RADIUS_M = (
    25_000
)


def _print_nearest_pm25(
    pm25_frame,
) -> None:
    """Print the nearest available PM2.5 location."""

    if pm25_frame.empty:
        print(
            "      nearest PM2.5     : "
            "NONE IN OPENAQ"
        )

        return

    valid = pm25_frame[
        pm25_frame[
            "distance_to_nguyen_hue_m"
        ].notna()
    ]

    if valid.empty:
        print(
            "      nearest PM2.5     : "
            "distance unavailable"
        )

        return

    nearest = valid.iloc[
        0
    ]

    print(
        "      nearest PM2.5     : "
        f"ID {nearest['location_id']} | "
        f"{nearest['name']} | "
        f"{nearest['distance_to_nguyen_hue_m'] / 1000.0:.2f} km"
    )

    print(
        "      monitor flag       : "
        f"{bool(nearest['is_monitor'])}"
    )

    print(
        "      provider           : "
        f"{nearest['provider_name']}"
    )


def main() -> None:
    """Run the complete Week-1 OpenAQ inventory."""

    output_dir = (
        ROOT_DIR
        / "output"
        / "analysis"
    )

    processed_dir = (
        ROOT_DIR
        / "data"
        / "processed"
    )

    output_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    processed_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    print(
        "=" * 72
    )

    print(
        "WEEK-1 OPENAQ — "
        "VIETNAM STATION INVENTORY"
    )

    print(
        "=" * 72
    )

    print(
        f"Study area             : "
        f"{STUDY_NAME}"
    )

    print(
        "Coordinate             : "
        f"{STUDY_LATITUDE:.4f}, "
        f"{STUDY_LONGITUDE:.4f}"
    )

    print(
        "API                    : "
        "OpenAQ v3"
    )

    print(
        "Country filter         : "
        "iso=VN"
    )

    print(
        "PM2.5 parameter ID     : "
        "2"
    )

    print()

    client = OpenAQClient()

    # =========================================================
    # 1. API-SIDE COUNTS
    # =========================================================

    print(
        "[1/4] Counting Vietnam "
        "locations from OpenAQ ..."
    )

    all_count = (
        client.count_locations(
            iso=
            VIETNAM_ISO,
        )
    )

    pm25_count = (
        client.count_locations(
            iso=
            VIETNAM_ISO,

            parameters_id=
            PM25_PARAMETER_ID,
        )
    )

    print(
        f"      all locations     : "
        f"{all_count}"
    )

    print(
        f"      PM2.5 locations   : "
        f"{pm25_count}"
    )

    print()

    # =========================================================
    # 2. LOCATION METADATA
    # =========================================================

    print(
        "[2/4] Downloading Vietnam "
        "location metadata ..."
    )

    all_locations = (
        client.list_all_locations(
            iso=
            VIETNAM_ISO,
        )
    )

    pm25_locations = (
        client.list_all_locations(
            iso=
            VIETNAM_ISO,

            parameters_id=
            PM25_PARAMETER_ID,
        )
    )

    all_frame = (
        locations_to_dataframe(
            all_locations,

            study_latitude=
            STUDY_LATITUDE,

            study_longitude=
            STUDY_LONGITUDE,
        )
    )

    pm25_frame = (
        locations_to_dataframe(
            pm25_locations,

            study_latitude=
            STUDY_LATITUDE,

            study_longitude=
            STUDY_LONGITUDE,
        )
    )

    if (
        len(
            all_frame
        )
        != all_count
    ):
        raise RuntimeError(
            "Downloaded Vietnam location "
            "count does not match "
            "API meta.found: "
            f"{len(all_frame)} "
            f"!= {all_count}"
        )

    if (
        len(
            pm25_frame
        )
        != pm25_count
    ):
        raise RuntimeError(
            "Downloaded Vietnam PM2.5 "
            "count does not match "
            "API meta.found: "
            f"{len(pm25_frame)} "
            f"!= {pm25_count}"
        )

    all_path = (
        processed_dir
        / "openaq_vietnam_locations.csv"
    )

    pm25_path = (
        processed_dir
        / "openaq_vietnam_pm25_locations.csv"
    )

    all_frame.to_csv(
        all_path,
        index=False,
    )

    pm25_frame.to_csv(
        pm25_path,
        index=False,
    )

    print(
        "      saved all         : "
        f"{all_path.relative_to(ROOT_DIR)}"
    )

    print(
        "      saved PM2.5       : "
        f"{pm25_path.relative_to(ROOT_DIR)}"
    )

    print()

    # =========================================================
    # 3. NGUYEN HUE PROXIMITY
    # =========================================================

    print(
        "[3/4] Checking PM2.5 availability "
        f"within {NEARBY_RADIUS_M / 1000:.0f} km "
        "of Nguyen Hue ..."
    )

    nearby = (
        pm25_frame[
            pm25_frame[
                "distance_to_nguyen_hue_m"
            ].notna()

            & (
                pm25_frame[
                    "distance_to_nguyen_hue_m"
                ]
                <= NEARBY_RADIUS_M
            )
        ]
    )

    nearby_reference = (
        nearby[
            nearby[
                "is_monitor"
            ]
        ]
    )

    print(
        "      PM2.5 locations   : "
        f"{len(nearby)}"
    )

    print(
        "      reference monitors: "
        f"{len(nearby_reference)}"
    )

    _print_nearest_pm25(
        pm25_frame
    )

    print()

    # =========================================================
    # 4. ROADMAP DECISION SUMMARY
    # =========================================================

    print(
        "[4/4] Writing ROADMAP "
        "decision summary ..."
    )

    summary = (
        build_inventory_summary(
            all_frame,

            pm25_frame,

            api_all_count=
            all_count,

            api_pm25_count=
            pm25_count,

            nearby_radius_m=
            NEARBY_RADIUS_M,
        )
    )

    summary_path = (
        output_dir
        / "openaq_inventory_summary.csv"
    )

    summary.to_csv(
        summary_path,
        index=False,
    )

    row = summary.iloc[
        0
    ]

    tier3_possible = bool(
        row[
            "tier3_qualitative_comparison_possible"
        ]
    )

    print(
        "      saved            : "
        f"{summary_path.relative_to(ROOT_DIR)}"
    )

    print()

    print(
        "ROADMAP CHECK"
    )

    print(
        "  OpenAQ API key works"
        "                    : DONE"
    )

    print(
        "  Real Vietnam station/location count"
        "      : DONE"
    )

    print(
        "  Real Vietnam PM2.5 location count"
        "        : DONE"
    )

    print(
        "  Nguyen Hue <=25 km PM2.5 availability"
        "   : DONE"
    )

    print(
        "  Tier-3 qualitative comparison feasible"
        "  : "
        f"{'YES' if tier3_possible else 'NO FROM OPENAQ'}"
    )

    print()

    print(
        "IMPORTANT"
    )

    print(
        "  This is an availability inventory only. "
        "OpenAQ is not being called"
    )

    print(
        "  'validation' here. ROADMAP Tier 3 "
        "is only an optional qualitative"
    )

    print(
        "  order-of-magnitude sanity check "
        "to be done later if time permits."
    )

    print(
        "=" * 72
    )


if __name__ == "__main__":
    main()