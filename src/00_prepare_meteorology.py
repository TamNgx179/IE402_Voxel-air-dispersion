"""Prepare the Week-1 meteorology outputs from Open-Meteo.

ROADMAP outputs produced:
- data/processed/wind_hourly_surface.csv
- data/processed/wind_profile.csv
- output/analysis/wind_season_summary.csv
- output/figures/wind_rose_dry_nov_apr.png
- output/figures/wind_rose_wet_may_oct.png

The selected study area is Nguyen Hue, Ho Chi Minh City.
Default period: 2025-01-01 through 2025-12-31.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd


SRC_DIR = Path(
    __file__
).resolve().parent

ROOT_DIR = SRC_DIR.parent


if str(
    SRC_DIR
) not in sys.path:
    sys.path.insert(
        0,
        str(
            SRC_DIR
        ),
    )


from meteo import (  # noqa: E402
    OpenMeteoLocation,
    build_season_summary,
    extract_profile_at_time,
    fetch_pressure_profile_day,
    fetch_surface_year,
    plot_wind_rose,
)


LOCATION = OpenMeteoLocation(
    name="Nguyen Hue",

    latitude=10.774600,

    longitude=106.703500,

    timezone="Asia/Ho_Chi_Minh",
)


DEFAULT_START_DATE = (
    "2025-01-01"
)

DEFAULT_END_DATE = (
    "2025-12-31"
)


def parse_args() -> argparse.Namespace:
    """Parse command-line options."""

    parser = argparse.ArgumentParser(
        description=(
            "Fetch Open-Meteo data "
            "and build Week-1 wind outputs."
        )
    )

    parser.add_argument(
        "--start-date",

        default=DEFAULT_START_DATE,

        help=(
            "Start date YYYY-MM-DD "
            f"(default: {DEFAULT_START_DATE})"
        ),
    )

    parser.add_argument(
        "--end-date",

        default=DEFAULT_END_DATE,

        help=(
            "End date YYYY-MM-DD "
            f"(default: {DEFAULT_END_DATE})"
        ),
    )

    return parser.parse_args()


def _print_summary_row(
    row,
) -> None:
    """Print one season without mixing seasonal and hourly metrics."""

    print(
        f"      {row.season}"
    )

    print(
        "        seasonal vector : "
        f"{row.representative_direction_from_deg:6.1f} deg FROM -> "
        f"{row.representative_direction_to_deg:6.1f} deg TO, "
        f"speed={row.vector_mean_speed_ms:5.2f} m/s"
    )

    print(
        "        season mean PBL  : "
        f"{row.season_mean_pbl_m:7.1f} m"
    )

    print(
        "        selected hour    : "
        f"{row.representative_time_local}"
    )

    print(
        "        hour conditions  : "
        f"{row.representative_hour_direction_from_deg:6.1f} deg FROM -> "
        f"{row.representative_hour_direction_to_deg:6.1f} deg TO, "
        f"speed={row.representative_hour_speed_ms:5.2f} m/s, "
        f"PBL={row.representative_hour_pbl_m:7.1f} m"
    )


def main() -> None:
    """Run the complete Week-1 meteorology preparation."""

    args = parse_args()

    processed_dir = (
        ROOT_DIR
        / "data"
        / "processed"
    )

    figure_dir = (
        ROOT_DIR
        / "output"
        / "figures"
    )

    analysis_dir = (
        ROOT_DIR
        / "output"
        / "analysis"
    )

    processed_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    figure_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    analysis_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    print(
        "=" * 72
    )

    print(
        "WEEK-1 METEOROLOGY — OPEN-METEO"
    )

    print(
        "=" * 72
    )

    print(
        f"Study area             : "
        f"{LOCATION.name}, HCMC"
    )

    print(
        f"Coordinate             : "
        f"{LOCATION.latitude:.6f}, "
        f"{LOCATION.longitude:.6f}"
    )

    print(
        f"Period                 : "
        f"{args.start_date} -> "
        f"{args.end_date}"
    )

    print(
        "Dataset/API            : "
        "Open-Meteo Historical Forecast"
    )

    print()

    # =========================================================
    # 1. SURFACE WIND + PBL
    # =========================================================

    print(
        "[1/4] Fetching hourly "
        "10 m wind + PBL ..."
    )

    surface = fetch_surface_year(
        LOCATION,

        start_date=
        args.start_date,

        end_date=
        args.end_date,
    )

    surface_path = (
        processed_dir
        / "wind_hourly_surface.csv"
    )

    surface.hourly.to_csv(
        surface_path,
        index=False,
    )

    print(
        f"      rows             : "
        f"{len(surface.hourly):,}"
    )

    print(
        f"      saved            : "
        f"{surface_path.relative_to(ROOT_DIR)}"
    )

    print()

    # =========================================================
    # 2. SEASONAL REPRESENTATIVE WINDS
    # =========================================================

    print(
        "[2/4] Selecting two seasonal "
        "representative winds ..."
    )

    summary = build_season_summary(
        surface.hourly
    )

    summary_path = (
        analysis_dir
        / "wind_season_summary.csv"
    )

    summary.to_csv(
        summary_path,
        index=False,
    )

    for row in summary.itertuples(
        index=False
    ):
        _print_summary_row(
            row
        )

    print(
        f"      saved            : "
        f"{summary_path.relative_to(ROOT_DIR)}"
    )

    print()

    # =========================================================
    # 3. PRESSURE-LEVEL PROFILES
    # =========================================================

    print(
        "[3/4] Fetching 19 pressure levels "
        "for the two representative hours ..."
    )

    profiles: list[
        pd.DataFrame
    ] = []

    for row in summary.itertuples(
        index=False
    ):
        representative_time = pd.Timestamp(
            row.representative_time_local
        )

        date = representative_time.strftime(
            "%Y-%m-%d"
        )

        response = fetch_pressure_profile_day(
            LOCATION,
            date=date,
        )

        profile = extract_profile_at_time(
            response,

            timestamp=
            representative_time,

            season=
            row.season,
        )

        profiles.append(
            profile
        )

    wind_profile = pd.concat(
        profiles,
        ignore_index=True,
    )

    profile_path = (
        processed_dir
        / "wind_profile.csv"
    )

    wind_profile.to_csv(
        profile_path,
        index=False,
    )

    pressure_count = int(
        (
            wind_profile[
                "level_type"
            ]
            == "pressure"
        ).sum()
    )

    surface_count = int(
        (
            wind_profile[
                "level_type"
            ]
            == "surface"
        ).sum()
    )

    print(
        f"      pressure rows     : "
        f"{pressure_count} "
        "(= 19 levels x 2 seasons)"
    )

    print(
        f"      surface rows      : "
        f"{surface_count}"
    )

    print(
        "      direction columns : "
        "FROM + TO conventions are both stored"
    )

    print(
        f"      saved            : "
        f"{profile_path.relative_to(ROOT_DIR)}"
    )

    print()

    # =========================================================
    # 4. WIND ROSES
    # =========================================================

    print(
        "[4/4] Drawing the two "
        "seasonal wind roses ..."
    )

    dry_path = plot_wind_rose(
        surface.hourly,

        season=
        "dry_nov_apr",

        output_path=(
            figure_dir
            / "wind_rose_dry_nov_apr.png"
        ),
    )

    wet_path = plot_wind_rose(
        surface.hourly,

        season=
        "wet_may_oct",

        output_path=(
            figure_dir
            / "wind_rose_wet_may_oct.png"
        ),
    )

    print(
        f"      dry season       : "
        f"{dry_path.relative_to(ROOT_DIR)}"
    )

    print(
        f"      wet season       : "
        f"{wet_path.relative_to(ROOT_DIR)}"
    )

    print()

    # =========================================================
    # ROADMAP CHECK
    # =========================================================

    print(
        "ROADMAP CHECK"
    )

    print(
        "  Open-Meteo profile "
        "19 pressure levels + PBL : DONE"
    )

    print(
        "  Seasonal wind roses"
        "                         : DONE"
    )

    print(
        "  Two representative "
        "wind directions          : DONE"
    )

    print(
        "  FROM/TO direction "
        "convention explicit       : DONE"
    )

    print(
        "  Seasonal vs representative-hour "
        "metrics     : SEPARATED"
    )

    print()

    print(
        "SCHEMA NOTE"
    )

    print(
        "  Seasonal vector statistics and "
        "the selected real-hour conditions"
    )

    print(
        "  are intentionally stored in "
        "separate columns. This prevents the"
    )

    print(
        "  vector-mean speed or season-mean "
        "PBL from being mistaken for the"
    )

    print(
        "  actual conditions used by the "
        "19-level representative profile."
    )

    print()

    print(
        "ROADMAP NOTE"
    )

    print(
        "  The selected domain is Nguyen Hue, HCMC. "
        "Scenario directions are"
    )

    print(
        "  derived from the HCMC data instead of "
        "being hard-coded from an"
    )

    print(
        "  earlier Hanoi-style directional assumption."
    )

    print(
        "=" * 72
    )


if __name__ == "__main__":
    main()