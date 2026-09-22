"""Seasonal wind analysis and Week-1 ROADMAP outputs."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from .open_meteo import PRESSURE_LEVELS_HPA, OpenMeteoResponse


# Nguyen Hue / central HCMC has a tropical monsoon regime.
# For scenario selection we split the year into two practical seasons:
# dry: November-April, wet: May-October.
DRY_MONTHS = frozenset((11, 12, 1, 2, 3, 4))
WET_MONTHS = frozenset((5, 6, 7, 8, 9, 10))


@dataclass(frozen=True)
class SeasonalWind:
    """Representative seasonal wind plus the real hour chosen for profiling.

    Two concepts are deliberately kept separate:

    1. Seasonal representative vector
       - direction_from / direction_to
       - vector_mean_speed_ms
       - season_mean_pbl_m

    2. Real representative hour used to fetch the coherent 19-level profile
       - timestamp
       - actual 10 m speed/direction at that hour
       - actual PBL at that hour
    """

    season: str

    representative_direction_from_deg: float
    representative_direction_to_deg: float
    vector_mean_speed_ms: float
    season_mean_pbl_m: float

    representative_time: pd.Timestamp
    representative_hour_speed_ms: float
    representative_hour_direction_from_deg: float
    representative_hour_direction_to_deg: float
    representative_hour_pbl_m: float

    sample_count: int

    # Backward-compatible aliases for code written before the schema cleanup.
    @property
    def representative_direction_deg(self) -> float:
        return self.representative_direction_from_deg

    @property
    def representative_speed_ms(self) -> float:
        return self.vector_mean_speed_ms

    @property
    def mean_pbl_height_m(self) -> float:
        return self.season_mean_pbl_m


def direction_from_to_deg(direction_from_deg):
    """Convert meteorological FROM direction to vector TO direction."""

    direction = np.asarray(
        direction_from_deg,
        dtype=float,
    )

    return (
        direction
        + 180.0
    ) % 360.0


def add_hcmc_season(
    frame: pd.DataFrame,
) -> pd.DataFrame:
    """Add dry/wet season labels to an hourly HCMC dataframe."""

    if "time" not in frame.columns:
        raise ValueError(
            "frame must contain a 'time' column"
        )

    result = frame.copy()

    months = pd.to_datetime(
        result["time"]
    ).dt.month

    result["season"] = np.where(
        months.isin(
            DRY_MONTHS
        ),
        "dry_nov_apr",
        "wet_may_oct",
    )

    return result


def meteorological_to_uv(
    speed_ms,
    direction_from_deg,
) -> tuple[
    np.ndarray,
    np.ndarray,
]:
    """Convert meteorological FROM direction to eastward/northward u,v.

    Meteorological direction states where the wind comes FROM.
    The returned (u, v) vector points where the air actually travels TO.
    """

    speed = np.asarray(
        speed_ms,
        dtype=float,
    )

    direction = np.deg2rad(
        np.asarray(
            direction_from_deg,
            dtype=float,
        )
    )

    u = (
        -speed
        * np.sin(
            direction
        )
    )

    v = (
        -speed
        * np.cos(
            direction
        )
    )

    return (
        u,
        v,
    )


def uv_to_meteorological(
    u,
    v,
) -> tuple[
    np.ndarray,
    np.ndarray,
]:
    """Convert eastward/northward u,v to speed and meteorological FROM dir."""

    u_arr = np.asarray(
        u,
        dtype=float,
    )

    v_arr = np.asarray(
        v,
        dtype=float,
    )

    speed = np.hypot(
        u_arr,
        v_arr,
    )

    direction = (
        np.degrees(
            np.arctan2(
                -u_arr,
                -v_arr,
            )
        )
        + 360.0
    ) % 360.0

    return (
        speed,
        direction,
    )


def circular_difference_deg(
    a,
    b,
):
    """Smallest absolute angular difference in degrees."""

    a_arr = np.asarray(
        a,
        dtype=float,
    )

    b_arr = np.asarray(
        b,
        dtype=float,
    )

    return np.abs(
        (
            (
                a_arr
                - b_arr
                + 180.0
            )
            % 360.0
        )
        - 180.0
    )


def _valid_surface_rows(
    frame: pd.DataFrame,
) -> pd.DataFrame:
    """Return valid rows needed by the seasonal surface analysis."""

    required = (
        "time",
        "wind_speed_10m",
        "wind_direction_10m",
        "boundary_layer_height",
    )

    missing = [
        name
        for name in required
        if name not in frame.columns
    ]

    if missing:
        raise ValueError(
            "surface dataframe is missing columns: "
            + ", ".join(
                missing
            )
        )

    result = frame.loc[
        :,
        required,
    ].copy()

    result["time"] = pd.to_datetime(
        result["time"],
        errors="raise",
    )

    for column in required[1:]:
        result[column] = pd.to_numeric(
            result[column],
            errors="coerce",
        )

    result = result.dropna(
        subset=required
    )

    if result.empty:
        raise ValueError(
            "surface dataframe has no valid rows"
        )

    return result


def summarize_season(
    frame: pd.DataFrame,
    season: str,
) -> SeasonalWind:
    """Calculate the seasonal vector mean and choose one real matching hour.

    The representative seasonal direction is a vector mean, not an ordinary
    arithmetic mean of angles.

    Then one real model hour is selected near that direction and near the
    seasonal median speed.

    That real hour is used later to fetch all 19 pressure levels coherently
    from one timestamp.
    """

    surface = add_hcmc_season(
        _valid_surface_rows(
            frame
        )
    )

    group = surface[
        surface["season"]
        == season
    ].copy()

    if group.empty:
        raise ValueError(
            f"no rows found for season {season!r}"
        )

    u, v = meteorological_to_uv(
        group[
            "wind_speed_10m"
        ].to_numpy(),

        group[
            "wind_direction_10m"
        ].to_numpy(),
    )

    mean_u = float(
        np.mean(
            u
        )
    )

    mean_v = float(
        np.mean(
            v
        )
    )

    (
        rep_speed_arr,
        rep_dir_arr,
    ) = uv_to_meteorological(
        mean_u,
        mean_v,
    )

    rep_speed = float(
        rep_speed_arr
    )

    rep_direction_from = float(
        rep_dir_arr
    )

    rep_direction_to = float(
        direction_from_to_deg(
            rep_direction_from
        )
    )

    # Choose an actual hour close to the vector-mean direction
    # and a typical seasonal speed.
    #
    # The selected hour is intentionally separate from the
    # seasonal vector mean and seasonal mean PBL.

    typical_speed = float(
        group[
            "wind_speed_10m"
        ].median()
    )

    angle_error = (
        circular_difference_deg(
            group[
                "wind_direction_10m"
            ].to_numpy(),

            rep_direction_from,
        )
        / 180.0
    )

    speed_scale = max(
        typical_speed,
        0.5,
    )

    speed_error = (
        np.abs(
            group[
                "wind_speed_10m"
            ].to_numpy()
            - typical_speed
        )
        / speed_scale
    )

    score = (
        angle_error
        + 0.35
        * speed_error
    )

    best_index = int(
        np.argmin(
            score
        )
    )

    representative_row = group.iloc[
        best_index
    ]

    hour_direction_from = float(
        representative_row[
            "wind_direction_10m"
        ]
    )

    hour_direction_to = float(
        direction_from_to_deg(
            hour_direction_from
        )
    )

    return SeasonalWind(
        season=season,

        representative_direction_from_deg=
        rep_direction_from,

        representative_direction_to_deg=
        rep_direction_to,

        vector_mean_speed_ms=
        rep_speed,

        season_mean_pbl_m=float(
            group[
                "boundary_layer_height"
            ].mean()
        ),

        representative_time=pd.Timestamp(
            representative_row[
                "time"
            ]
        ),

        representative_hour_speed_ms=float(
            representative_row[
                "wind_speed_10m"
            ]
        ),

        representative_hour_direction_from_deg=
        hour_direction_from,

        representative_hour_direction_to_deg=
        hour_direction_to,

        representative_hour_pbl_m=float(
            representative_row[
                "boundary_layer_height"
            ]
        ),

        sample_count=int(
            len(
                group
            )
        ),
    )


def build_season_summary(
    frame: pd.DataFrame,
) -> pd.DataFrame:
    """Build the two clean seasonal scenario rows required by the ROADMAP."""

    rows = []

    for season in (
        "dry_nov_apr",
        "wet_may_oct",
    ):
        summary = summarize_season(
            frame,
            season,
        )

        rows.append(
            {
                "season":
                    summary.season,

                "representative_direction_from_deg":
                    round(
                        summary.representative_direction_from_deg,
                        3,
                    ),

                "representative_direction_to_deg":
                    round(
                        summary.representative_direction_to_deg,
                        3,
                    ),

                "vector_mean_speed_ms":
                    round(
                        summary.vector_mean_speed_ms,
                        4,
                    ),

                "representative_time_local":
                    summary.representative_time.isoformat(),

                "representative_hour_speed_ms":
                    round(
                        summary.representative_hour_speed_ms,
                        4,
                    ),

                "representative_hour_direction_from_deg":
                    round(
                        summary.representative_hour_direction_from_deg,
                        3,
                    ),

                "representative_hour_direction_to_deg":
                    round(
                        summary.representative_hour_direction_to_deg,
                        3,
                    ),

                "representative_hour_pbl_m":
                    round(
                        summary.representative_hour_pbl_m,
                        3,
                    ),

                "season_mean_pbl_m":
                    round(
                        summary.season_mean_pbl_m,
                        3,
                    ),

                "sample_count":
                    summary.sample_count,
            }
        )

    return pd.DataFrame(
        rows
    )


def extract_profile_at_time(
    response: OpenMeteoResponse,
    *,
    timestamp: pd.Timestamp,
    season: str,
) -> pd.DataFrame:
    """Flatten one API timestamp into a 10 m row plus 19 pressure levels."""

    frame = response.hourly.copy()

    target = pd.Timestamp(
        timestamp
    )

    exact = frame[
        pd.to_datetime(
            frame["time"]
        )
        == target
    ]

    if exact.empty:
        raise ValueError(
            f"timestamp {target.isoformat()} "
            "not found in pressure-profile response"
        )

    row = exact.iloc[
        0
    ]

    pbl_height = float(
        row[
            "boundary_layer_height"
        ]
    )

    output_rows = [
        {
            "season":
                season,

            "representative_time_local":
                target.isoformat(),

            "level_type":
                "surface",

            "pressure_hpa":
                np.nan,

            "height_asl_m":
                response.elevation_m
                + 10.0,

            "height_agl_m":
                10.0,

            "wind_speed_ms":
                float(
                    row[
                        "wind_speed_10m"
                    ]
                ),

            "wind_direction_deg_from":
                float(
                    row[
                        "wind_direction_10m"
                    ]
                ),

            "wind_direction_deg_to":
                float(
                    direction_from_to_deg(
                        row[
                            "wind_direction_10m"
                        ]
                    )
                ),

            "pbl_height_m":
                pbl_height,
        }
    ]

    for level in PRESSURE_LEVELS_HPA:
        speed_key = (
            f"wind_speed_{level}hPa"
        )

        direction_key = (
            f"wind_direction_{level}hPa"
        )

        height_key = (
            f"geopotential_height_{level}hPa"
        )

        height_asl = float(
            row[
                height_key
            ]
        )

        direction_from = float(
            row[
                direction_key
            ]
        )

        output_rows.append(
            {
                "season":
                    season,

                "representative_time_local":
                    target.isoformat(),

                "level_type":
                    "pressure",

                "pressure_hpa":
                    float(
                        level
                    ),

                "height_asl_m":
                    height_asl,

                "height_agl_m":
                    (
                        height_asl
                        - response.elevation_m
                    ),

                "wind_speed_ms":
                    float(
                        row[
                            speed_key
                        ]
                    ),

                "wind_direction_deg_from":
                    direction_from,

                "wind_direction_deg_to":
                    float(
                        direction_from_to_deg(
                            direction_from
                        )
                    ),

                "pbl_height_m":
                    pbl_height,
            }
        )

    return pd.DataFrame(
        output_rows
    )


def plot_wind_rose(
    frame: pd.DataFrame,
    *,
    season: str,
    output_path: Path,
) -> Path:
    """Create a stacked seasonal wind rose using only matplotlib."""

    surface = add_hcmc_season(
        _valid_surface_rows(
            frame
        )
    )

    subset = surface[
        surface["season"]
        == season
    ].copy()

    if subset.empty:
        raise ValueError(
            f"no rows available for season {season!r}"
        )

    direction = (
        subset[
            "wind_direction_10m"
        ].to_numpy(
            dtype=float
        )
        % 360.0
    )

    speed = subset[
        "wind_speed_10m"
    ].to_numpy(
        dtype=float
    )

    n_sectors = 16

    sector_width_deg = (
        360.0
        / n_sectors
    )

    sector_centers_deg = np.arange(
        0.0,
        360.0,
        sector_width_deg,
    )

    # Shift by half a sector so north is centred around 0 degrees.
    sector_index = np.floor(
        (
            (
                direction
                + sector_width_deg
                / 2.0
            )
            % 360.0
        )
        / sector_width_deg
    ).astype(
        int
    )

    speed_edges = np.array(
        [
            0.0,
            1.0,
            2.0,
            3.0,
            5.0,
            8.0,
            np.inf,
        ]
    )

    speed_labels = (
        "0-1",
        "1-2",
        "2-3",
        "3-5",
        "5-8",
        ">=8",
    )

    counts = np.zeros(
        (
            n_sectors,
            len(
                speed_labels
            ),
        ),
        dtype=float,
    )

    speed_bin = np.digitize(
        speed,
        speed_edges[
            1:-1
        ],
        right=False,
    )

    for (
        sector,
        bin_index,
    ) in zip(
        sector_index,
        speed_bin,
        strict=True,
    ):
        counts[
            sector,
            bin_index,
        ] += 1.0

    frequencies = (
        counts
        / len(
            subset
        )
        * 100.0
    )

    fig = plt.figure(
        figsize=(
            8,
            8,
        )
    )

    ax = fig.add_subplot(
        111,
        projection="polar",
    )

    theta = np.deg2rad(
        sector_centers_deg
    )

    width = np.deg2rad(
        sector_width_deg
        * 0.88
    )

    bottom = np.zeros(
        n_sectors,
        dtype=float,
    )

    for (
        bin_index,
        label,
    ) in enumerate(
        speed_labels
    ):
        values = frequencies[
            :,
            bin_index,
        ]

        ax.bar(
            theta,
            values,
            width=width,
            bottom=bottom,
            label=f"{label} m/s",
            align="center",
        )

        bottom += values

    ax.set_theta_zero_location(
        "N"
    )

    ax.set_theta_direction(
        -1
    )

    ax.set_thetagrids(
        np.arange(
            0,
            360,
            45,
        ),

        labels=(
            "N",
            "NE",
            "E",
            "SE",
            "S",
            "SW",
            "W",
            "NW",
        ),
    )

    ax.set_title(
        f"Wind rose — "
        f"{season.replace('_', ' ')}\n"
        "Nguyen Hue, HCMC"
    )

    ax.set_ylabel(
        "Frequency (%)"
    )

    ax.legend(
        loc="lower left",

        bbox_to_anchor=(
            1.05,
            0.0,
        ),

        title="10 m wind",
    )

    output_path = Path(
        output_path
    )

    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    fig.tight_layout()

    fig.savefig(
        output_path,
        dpi=180,
        bbox_inches="tight",
    )

    plt.close(
        fig
    )

    return output_path