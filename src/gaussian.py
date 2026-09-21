"""Gaussian plume baseline on the voxel grid created by 01_voxelize.py."""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import xarray as xr

from project_config import (
    REPO_ROOT,
    load_project_config,
    resolve_repo_path,
)


LOGGER = logging.getLogger(__name__)


def normalize_stability(
    value: str,
) -> str:
    """
    Validate a Pasquill stability class.

    Supported classes
    -----------------
    A, B, C, D, E, F
    """

    stability = (
        value
        .strip()
        .upper()
    )

    if stability not in {
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
    }:
        raise ValueError(
            "stability must be one of "
            "A, B, C, D, E, F"
        )

    return stability


def briggs_urban_sigma(
    x_m: np.ndarray,
    stability: str,
) -> tuple[
    np.ndarray,
    np.ndarray,
]:
    """
    Calculate Briggs urban dispersion coefficients.

    Parameters
    ----------
    x_m:
        Positive downwind distance in metres.

    stability:
        Pasquill stability class A-F.

    Returns
    -------
    sigma_y, sigma_z:
        Horizontal and vertical dispersion
        coefficients in metres.

    Notes
    -----
    These are the Briggs / McElroy-Pooler
    URBAN equations documented in the
    project research notes.

    x must be in metres.
    """

    stability = normalize_stability(
        stability
    )

    x = np.asarray(
        x_m,
        dtype=np.float64,
    )

    if np.any(
        x <= 0.0
    ):
        raise ValueError(
            "Briggs sigma requires "
            "positive downwind distance."
        )

    y_common = np.power(
        1.0
        + 0.0004 * x,
        -0.5,
    )

    if stability in {
        "A",
        "B",
    }:

        sigma_y = (
            0.32
            * x
            * y_common
        )

        sigma_z = (
            0.24
            * x
            * np.power(
                1.0
                + 0.0010 * x,
                0.5,
            )
        )

    elif stability == "C":

        sigma_y = (
            0.22
            * x
            * y_common
        )

        sigma_z = (
            0.20
            * x
        )

    elif stability == "D":

        sigma_y = (
            0.16
            * x
            * y_common
        )

        sigma_z = (
            0.14
            * x
            * np.power(
                1.0
                + 0.0003 * x,
                -0.5,
            )
        )

    else:

        sigma_y = (
            0.11
            * x
            * y_common
        )

        sigma_z = (
            0.08
            * x
            * np.power(
                1.0
                + 0.0015 * x,
                -0.5,
            )
        )

    return (
        sigma_y,
        sigma_z,
    )


def urban_power_exponent(
    stability: str,
) -> float:
    """
    Return the ISC3 urban power-law
    exponent for wind speed.
    """

    stability = normalize_stability(
        stability
    )

    if stability in {
        "A",
        "B",
    }:
        return 0.15

    if stability == "C":
        return 0.20

    if stability == "D":
        return 0.25

    return 0.30


def wind_speed_at_height(
    z_m: float,
    reference_speed_m_s: float,
    reference_height_m: float,
    stability: str,
) -> float:
    """
    Calculate wind speed using the
    urban power-law profile.

    u(z) = u_ref * (z / z_ref)^p
    """

    if (
        reference_speed_m_s
        <= 0.0
    ):
        raise ValueError(
            "reference wind speed "
            "must be positive."
        )

    if (
        reference_height_m
        <= 0.0
    ):
        raise ValueError(
            "reference wind height "
            "must be positive."
        )

    exponent = (
        urban_power_exponent(
            stability
        )
    )

    # Avoid evaluating exactly at z = 0.
    height = max(
        float(
            z_m
        ),
        0.5,
    )

    speed = (
        reference_speed_m_s
        * (
            height
            / reference_height_m
        )
        ** exponent
    )

    return float(
        speed
    )


def wind_basis(
    wind_from_deg: float,
) -> tuple[
    float,
    float,
    float,
    float,
]:
    """
    Convert meteorological wind direction
    into projected x/y unit vectors.

    Meteorological convention
    --------------------------
    0°:
        wind FROM north

    90°:
        wind FROM east

    180°:
        wind FROM south

    270°:
        wind FROM west

    Returns
    -------
    down_x, down_y, cross_x, cross_y
    """

    angle = np.deg2rad(
        float(
            wind_from_deg
        )
        % 360.0
    )

    down_x = -float(
        np.sin(
            angle
        )
    )

    down_y = -float(
        np.cos(
            angle
        )
    )

    # Unit vector perpendicular
    # to the downwind direction.
    cross_x = -down_y
    cross_y = down_x

    return (
        down_x,
        down_y,
        cross_x,
        cross_y,
    )


def gaussian_point_source(
    x: np.ndarray,
    y: np.ndarray,
    z: np.ndarray,
    source_x: float,
    source_y: float,
    source_z: float,
    emission_rate_g_s: float,
    wind_from_deg: float,
    reference_wind_speed_m_s: float,
    reference_wind_height_m: float,
    stability: str,
) -> np.ndarray:
    """
    Evaluate one steady Gaussian point source.

    Output array order
    ------------------
    (z, y, x)

    Output units
    ------------
    g/m^3

    Ground reflection is included using
    the standard image-source term.
    """

    if (
        emission_rate_g_s
        < 0.0
    ):
        raise ValueError(
            "emission_rate_g_s "
            "must be non-negative."
        )

    (
        down_x,
        down_y,
        cross_x,
        cross_y,
    ) = wind_basis(
        wind_from_deg
    )

    xx, yy = np.meshgrid(
        x,
        y,
        indexing="xy",
    )

    dx = (
        xx
        - source_x
    )

    dy = (
        yy
        - source_y
    )

    # Coordinate in the wind direction.
    downwind = (
        dx * down_x
        + dy * down_y
    )

    # Coordinate perpendicular
    # to the wind direction.
    crosswind = (
        dx * cross_x
        + dy * cross_y
    )

    # Gaussian plume is only defined
    # downwind of the source.
    valid = (
        downwind
        > 0.0
    )

    # Temporary positive value used only
    # to prevent division by zero while
    # calculating sigma.
    safe_x = np.where(
        valid,
        downwind,
        1.0,
    )

    (
        sigma_y,
        sigma_z,
    ) = briggs_urban_sigma(
        safe_x,
        stability,
    )

    source_wind = (
        wind_speed_at_height(
            z_m=source_z,
            reference_speed_m_s=(
                reference_wind_speed_m_s
            ),
            reference_height_m=(
                reference_wind_height_m
            ),
            stability=stability,
        )
    )

    horizontal = np.exp(
        -0.5
        * (
            crosswind
            / sigma_y
        )
        ** 2
    )

    zz = (
        z[
            :,
            None,
            None,
        ]
    )

    sigma_z_3d = (
        sigma_z[
            None,
            :,
            :,
        ]
    )

    # Direct plume.
    vertical_direct = np.exp(
        -0.5
        * (
            (
                zz
                - source_z
            )
            / sigma_z_3d
        )
        ** 2
    )

    # Ground-reflected image source.
    vertical_reflected = np.exp(
        -0.5
        * (
            (
                zz
                + source_z
            )
            / sigma_z_3d
        )
        ** 2
    )

    coefficient = (
        emission_rate_g_s
        / (
            2.0
            * np.pi
            * source_wind
            * sigma_y
            * sigma_z
        )
    )

    concentration = (
        coefficient[
            None,
            :,
            :,
        ]
        * horizontal[
            None,
            :,
            :,
        ]
        * (
            vertical_direct
            + vertical_reflected
        )
    )

    # No concentration upwind.
    concentration[
        :,
        ~valid,
    ] = 0.0

    return concentration


def build_demo_line_sources(
    center_x: float,
    center_y: float,
    wind_from_deg: float,
    source_height_m: float,
    total_emission_rate_g_s: float,
    line_length_m: float,
    spacing_m: float,
) -> list[
    tuple[
        float,
        float,
        float,
        float,
    ]
]:
    """
    Approximate one short road segment
    using multiple Gaussian point sources.

    This is only the M1 demo source.

    Real OSM traffic emissions will later
    be implemented in emissions.py.
    """

    if (
        line_length_m
        <= 0.0
    ):
        raise ValueError(
            "line_length_m "
            "must be positive."
        )

    if (
        spacing_m
        <= 0.0
    ):
        raise ValueError(
            "spacing_m "
            "must be positive."
        )

    if (
        total_emission_rate_g_s
        < 0.0
    ):
        raise ValueError(
            "total emission rate "
            "must be non-negative."
        )

    (
        _,
        _,
        cross_x,
        cross_y,
    ) = wind_basis(
        wind_from_deg
    )

    source_count = max(
        2,
        int(
            np.floor(
                line_length_m
                / spacing_m
            )
        )
        + 1,
    )

    offsets = np.linspace(
        -line_length_m
        / 2.0,
        line_length_m
        / 2.0,
        source_count,
    )

    emission_each = (
        total_emission_rate_g_s
        / source_count
    )

    sources = []

    for offset in offsets:

        source_x = (
            center_x
            + offset
            * cross_x
        )

        source_y = (
            center_y
            + offset
            * cross_y
        )

        sources.append(
            (
                source_x,
                source_y,
                source_height_m,
                emission_each,
            )
        )

    return sources


def resolve_output_path(
    raw_path: str,
) -> Path:
    """
    Resolve an output path relative
    to the repository root.
    """

    path = Path(
        raw_path
    ).expanduser()

    if not path.is_absolute():

        path = (
            REPO_ROOT
            / path
        )

    return path.resolve()


def save_qa_plot(
    dataset: xr.Dataset,
    path: Path,
    requested_z_m: float,
) -> None:
    """
    Save a horizontal concentration
    slice for quick visual QA.
    """

    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    z_values = np.asarray(
        dataset[
            "z"
        ].values,
        dtype=float,
    )

    z_index = int(
        np.argmin(
            np.abs(
                z_values
                - requested_z_m
            )
        )
    )

    actual_z = float(
        z_values[
            z_index
        ]
    )

    field = (
        dataset[
            "C_gaussian_ug_m3"
        ]
        .isel(
            z=z_index
        )
        .values
    )

    x = (
        dataset[
            "x"
        ].values
    )

    y = (
        dataset[
            "y"
        ].values
    )

    figure, axis = (
        plt.subplots(
            figsize=(
                8,
                7,
            )
        )
    )

    image = axis.imshow(
        field,
        origin="lower",
        extent=(
            float(
                x[
                    0
                ]
            ),
            float(
                x[
                    -1
                ]
            ),
            float(
                y[
                    0
                ]
            ),
            float(
                y[
                    -1
                ]
            ),
        ),
        aspect="equal",
    )

    figure.colorbar(
        image,
        ax=axis,
        label=(
            "Concentration "
            "(µg/m³)"
        ),
    )

    axis.set_title(
        "Gaussian baseline "
        f"at z = {actual_z:.1f} m"
    )

    axis.set_xlabel(
        "Projected x (m)"
    )

    axis.set_ylabel(
        "Projected y (m)"
    )

    figure.tight_layout()

    figure.savefig(
        path,
        dpi=160,
    )

    plt.close(
        figure
    )


def run(
    args: argparse.Namespace,
) -> None:
    """
    Run the complete M1 Gaussian baseline.

    voxel_grid.nc
        ↓
    read x/y/z/B
        ↓
    demo line source
        ↓
    Briggs urban Gaussian
        ↓
    C_gaussian[z,y,x]
        ↓
    netCDF + QA PNG
    """

    config = (
        load_project_config(
            args.config
        )
    )

    voxel_path = (
        resolve_repo_path(
            config,
            "paths.voxel_netcdf",
        )
    )

    output_path = (
        resolve_output_path(
            args.output
        )
    )

    plot_path = (
        resolve_output_path(
            args.plot
        )
    )

    if not voxel_path.exists():

        raise FileNotFoundError(
            f"{voxel_path} does not exist. "
            "Run 01_voxelize.py first."
        )

    LOGGER.info(
        "Reading voxel grid: %s",
        voxel_path,
    )

    with xr.open_dataset(
        voxel_path
    ) as opened:

        dataset = (
            opened.load()
        )

    for name in (
        "x",
        "y",
        "z",
        "B",
    ):

        if name not in dataset:

            raise ValueError(
                "voxel netCDF is "
                "missing required "
                f"variable {name!r}"
            )

    x = np.asarray(
        dataset[
            "x"
        ].values,
        dtype=np.float64,
    )

    y = np.asarray(
        dataset[
            "y"
        ].values,
        dtype=np.float64,
    )

    z = np.asarray(
        dataset[
            "z"
        ].values,
        dtype=np.float64,
    )

    building_mask = (
        np.asarray(
            dataset[
                "B"
            ].values
        )
        .astype(
            bool
        )
    )

    expected_shape = (
        len(
            z
        ),
        len(
            y
        ),
        len(
            x
        ),
    )

    if (
        building_mask.shape
        != expected_shape
    ):
        raise ValueError(
            "B must use canonical "
            "(z,y,x) order. "
            f"Expected {expected_shape}, "
            f"got {building_mask.shape}."
        )

    center_x = float(
        (
            x[
                0
            ]
            + x[
                -1
            ]
        )
        / 2.0
    )

    center_y = float(
        (
            y[
                0
            ]
            + y[
                -1
            ]
        )
        / 2.0
    )

    sources = (
        build_demo_line_sources(
            center_x=center_x,
            center_y=center_y,
            wind_from_deg=(
                args.wind_from
            ),
            source_height_m=(
                args.source_height
            ),
            total_emission_rate_g_s=(
                args.emission_rate
            ),
            line_length_m=(
                args.line_length
            ),
            spacing_m=(
                args.source_spacing
            ),
        )
    )

    LOGGER.info(
        "Gaussian settings: "
        "stability=%s, "
        "wind from=%.1f deg, "
        "u_ref=%.2f m/s at %.1f m",
        args.stability,
        args.wind_from,
        args.wind_speed,
        args.wind_height,
    )

    LOGGER.info(
        "Demo line source: "
        "%d point sources, "
        "total Q=%.4f g/s",
        len(
            sources
        ),
        args.emission_rate,
    )

    total_g_m3 = np.zeros(
        expected_shape,
        dtype=np.float64,
    )

    for (
        source_x,
        source_y,
        source_z,
        source_q,
    ) in sources:

        total_g_m3 += (
            gaussian_point_source(
                x=x,
                y=y,
                z=z,
                source_x=source_x,
                source_y=source_y,
                source_z=source_z,
                emission_rate_g_s=(
                    source_q
                ),
                wind_from_deg=(
                    args.wind_from
                ),
                reference_wind_speed_m_s=(
                    args.wind_speed
                ),
                reference_wind_height_m=(
                    args.wind_height
                ),
                stability=(
                    args.stability
                ),
            )
        )

    # g/m3 -> µg/m3
    total_ug_m3 = (
        total_g_m3
        * 1_000_000.0
    )

    # Gaussian itself does not resolve
    # buildings.
    #
    # We mask solid voxels only so they
    # are not visualised as polluted air.
    if not (
        args.keep_building_values
    ):

        total_ug_m3 = np.where(
            building_mask,
            np.nan,
            total_ug_m3,
        )

    dataset[
        "C_gaussian_ug_m3"
    ] = (
        (
            "z",
            "y",
            "x",
        ),
        total_ug_m3.astype(
            np.float32
        ),
    )

    dataset[
        "C_gaussian_ug_m3"
    ].attrs.update(
        {
            "long_name":
                (
                    "steady Gaussian "
                    "plume concentration "
                    "baseline"
                ),

            "units":
                "ug m-3",

            "grid_mapping":
                "crs",

            "stability_class":
                normalize_stability(
                    args.stability
                ),

            "wind_from_degrees":
                float(
                    args.wind_from
                )
                % 360.0,

            "reference_wind_speed_m_s":
                float(
                    args.wind_speed
                ),

            "reference_wind_height_m":
                float(
                    args.wind_height
                ),

            "source_height_m":
                float(
                    args.source_height
                ),

            "total_emission_rate_g_s":
                float(
                    args.emission_rate
                ),

            "source_representation":
                (
                    "line source "
                    "approximated by "
                    "point-source "
                    "superposition"
                ),

            "building_treatment":
                (
                    "solid voxels masked "
                    "after analytical "
                    "Gaussian calculation"
                ),
        }
    )

    dataset.attrs[
        "gaussian_baseline"
    ] = (
        "Briggs urban steady "
        "Gaussian plume with "
        "ground reflection"
    )

    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    LOGGER.info(
        "Writing Gaussian netCDF: %s",
        output_path,
    )

    dataset.to_netcdf(
        output_path,
        engine="netcdf4",
        encoding={
            "C_gaussian_ug_m3": {
                "zlib":
                    True,

                "complevel":
                    4,

                "dtype":
                    "float32",
            }
        },
    )

    save_qa_plot(
        dataset=dataset,
        path=plot_path,
        requested_z_m=(
            args.plot_height
        ),
    )

    finite = total_ug_m3[
        np.isfinite(
            total_ug_m3
        )
    ]

    positive = finite[
        finite
        > 0.0
    ]

    LOGGER.info(
        "Gaussian baseline complete."
    )

    LOGGER.info(
        "Output netCDF: %s",
        output_path,
    )

    LOGGER.info(
        "QA plot: %s",
        plot_path,
    )

    LOGGER.info(
        "Grid shape (z,y,x): %s",
        total_ug_m3.shape,
    )

    LOGGER.info(
        "Source points: %d",
        len(
            sources
        ),
    )

    if positive.size:

        LOGGER.info(
            "Positive concentration "
            "range: %.6g .. %.6g ug/m3",
            float(
                positive.min()
            ),
            float(
                positive.max()
            ),
        )

    else:

        LOGGER.warning(
            "No positive concentration "
            "values were produced."
        )


def build_parser() -> argparse.ArgumentParser:
    """
    Build command-line arguments.

    Defaults are intentionally simple
    M1 verification settings, not the
    final real-world scenario.
    """

    parser = argparse.ArgumentParser(
        description=(
            "Run Gaussian baseline "
            "on voxel_grid.nc"
        )
    )

    parser.add_argument(
        "--config",
        default="config/project.yaml",
    )

    parser.add_argument(
        "--output",
        default=(
            "data/processed/"
            "gaussian_baseline.nc"
        ),
    )

    parser.add_argument(
        "--plot",
        default=(
            "outputs/"
            "gaussian_baseline.png"
        ),
    )

    parser.add_argument(
        "--plot-height",
        type=float,
        default=1.5,
    )

    parser.add_argument(
        "--stability",
        choices=list(
            "ABCDEF"
        ),
        default="D",
    )

    parser.add_argument(
        "--wind-from",
        type=float,
        default=270.0,
        help=(
            "Meteorological direction "
            "FROM which wind blows."
        ),
    )

    parser.add_argument(
        "--wind-speed",
        type=float,
        default=2.0,
        help=(
            "Reference wind speed "
            "in m/s."
        ),
    )

    parser.add_argument(
        "--wind-height",
        type=float,
        default=10.0,
        help=(
            "Reference wind height "
            "in metres."
        ),
    )

    parser.add_argument(
        "--source-height",
        type=float,
        default=1.5,
    )

    parser.add_argument(
        "--emission-rate",
        type=float,
        default=1.0,
        help=(
            "Total demo line-source "
            "emission rate in g/s."
        ),
    )

    parser.add_argument(
        "--line-length",
        type=float,
        default=100.0,
    )

    parser.add_argument(
        "--source-spacing",
        type=float,
        default=10.0,
    )

    parser.add_argument(
        "--keep-building-values",
        action="store_true",
        help=(
            "Do not mask Gaussian "
            "concentration inside "
            "building voxels."
        ),
    )

    return parser


def main() -> None:
    """
    Command-line entry point.
    """

    logging.basicConfig(
        level=logging.INFO,
        format=(
            "%(levelname)s | "
            "%(message)s"
        ),
    )

    parser = (
        build_parser()
    )

    args = (
        parser.parse_args()
    )

    run(
        args
    )


if __name__ == "__main__":
    main()