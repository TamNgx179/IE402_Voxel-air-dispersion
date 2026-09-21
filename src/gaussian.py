"""Run the Gaussian plume verification baseline."""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

import numpy as np
import xarray as xr

from dispersion.gaussian_model import (
    build_demo_line_sources,
    choose_demo_line_center,
    gaussian_point_source,
    normalize_stability,
)

from dispersion.gaussian_viz import (
    save_qa_plot,
)

from project_config import (
    REPO_ROOT,
    load_project_config,
    resolve_repo_path,
)


LOGGER = logging.getLogger(
    "gaussian"
)


def resolve_output_path(
    raw_path: str,
) -> Path:
    """Resolve an output path relative to repo root."""

    path = Path(
        raw_path
    ).expanduser()

    if not path.is_absolute():
        path = (
            REPO_ROOT
            / path
        )

    return path.resolve()


def validate_voxel_dataset(
    dataset: xr.Dataset,
) -> tuple[
    np.ndarray,
    np.ndarray,
    np.ndarray,
    np.ndarray,
]:
    """Validate and extract required voxel-grid arrays."""

    for name in (
        "x",
        "y",
        "z",
        "B",
    ):
        if name not in dataset:
            raise ValueError(
                "voxel netCDF is missing "
                f"required variable {name!r}"
            )

    x = np.asarray(
        dataset["x"].values,
        dtype=np.float64,
    )

    y = np.asarray(
        dataset["y"].values,
        dtype=np.float64,
    )

    z = np.asarray(
        dataset["z"].values,
        dtype=np.float64,
    )

    building_mask = np.asarray(
        dataset["B"].values,
        dtype=bool,
    )

    expected_shape = (
        len(z),
        len(y),
        len(x),
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

    return (
        x,
        y,
        z,
        building_mask,
    )


def calculate_gaussian_field(
    x: np.ndarray,
    y: np.ndarray,
    z: np.ndarray,
    sources: list[
        tuple[
            float,
            float,
            float,
            float,
        ]
    ],
    args: argparse.Namespace,
) -> np.ndarray:
    """Superpose all Gaussian point sources."""

    total_g_m3 = np.zeros(
        (
            len(z),
            len(y),
            len(x),
        ),
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
                emission_rate_g_s=source_q,
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

    # g/m3 -> microgram/m3
    return (
        total_g_m3
        * 1_000_000.0
    )


def attach_gaussian_result(
    dataset: xr.Dataset,
    concentration_ug_m3: np.ndarray,
    sources: list[
        tuple[
            float,
            float,
            float,
            float,
        ]
    ],
    args: argparse.Namespace,
) -> xr.Dataset:
    """
    Add Gaussian result and source metadata
    to a copy of the voxel dataset.
    """

    dataset[
        "C_gaussian_ug_m3"
    ] = (
        (
            "z",
            "y",
            "x",
        ),
        concentration_ug_m3.astype(
            np.float32
        ),
    )

    dataset[
        "C_gaussian_ug_m3"
    ].attrs.update(
        {
            "long_name": (
                "steady Gaussian plume "
                "concentration baseline"
            ),
            "units": "ug m-3",
            "grid_mapping": "crs",
            "stability_class": (
                normalize_stability(
                    args.stability
                )
            ),
            "wind_from_degrees": (
                float(
                    args.wind_from
                )
                % 360.0
            ),
            "reference_wind_speed_m_s": (
                float(
                    args.wind_speed
                )
            ),
            "reference_wind_height_m": (
                float(
                    args.wind_height
                )
            ),
            "source_height_m": (
                float(
                    args.source_height
                )
            ),
            "total_emission_rate_g_s": (
                float(
                    args.emission_rate
                )
            ),
            "source_representation": (
                "synthetic line source "
                "approximated by point-source "
                "superposition"
            ),
            "building_treatment": (
                "solid voxels masked after "
                "analytical Gaussian calculation"
            ),
        }
    )

    dataset = dataset.assign_coords(
        source=np.arange(
            len(sources),
            dtype=np.int32,
        )
    )

    dataset["source_x"] = (
        "source",
        np.asarray(
            [
                source[0]
                for source in sources
            ],
            dtype=np.float64,
        ),
    )

    dataset["source_y"] = (
        "source",
        np.asarray(
            [
                source[1]
                for source in sources
            ],
            dtype=np.float64,
        ),
    )

    dataset["source_z"] = (
        "source",
        np.asarray(
            [
                source[2]
                for source in sources
            ],
            dtype=np.float64,
        ),
    )

    dataset["source_q_g_s"] = (
        "source",
        np.asarray(
            [
                source[3]
                for source in sources
            ],
            dtype=np.float64,
        ),
    )

    dataset[
        "source_x"
    ].attrs["units"] = "m"

    dataset[
        "source_y"
    ].attrs["units"] = "m"

    dataset[
        "source_z"
    ].attrs["units"] = "m"

    dataset[
        "source_q_g_s"
    ].attrs["units"] = "g s-1"

    dataset.attrs[
        "gaussian_baseline"
    ] = (
        "Briggs urban steady Gaussian "
        "plume with ground reflection"
    )

    dataset.attrs[
        "verification_case"
    ] = (
        "synthetic source for solver "
        "verification; not a calibrated "
        "traffic inventory"
    )

    return dataset


def save_dataset(
    dataset: xr.Dataset,
    output_path: Path,
) -> None:
    """Write Gaussian baseline NetCDF."""

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
                "zlib": True,
                "complevel": 4,
                "dtype": "float32",
            }
        },
    )


def log_summary(
    concentration_ug_m3: np.ndarray,
    sources: list,
    output_path: Path,
    linear_plot_path: Path,
    log_plot_path: Path,
) -> None:
    """Log run summary."""

    finite = concentration_ug_m3[
        np.isfinite(
            concentration_ug_m3
        )
    ]

    positive = finite[
        finite > 0.0
    ]

    LOGGER.info(
        "Gaussian baseline complete."
    )

    LOGGER.info(
        "Output netCDF: %s",
        output_path,
    )

    LOGGER.info(
        "Linear QA plot: %s",
        linear_plot_path,
    )

    LOGGER.info(
        "Log QA plot: %s",
        log_plot_path,
    )

    LOGGER.info(
        "Grid shape (z,y,x): %s",
        concentration_ug_m3.shape,
    )

    LOGGER.info(
        "Source points: %d",
        len(sources),
    )

    if positive.size == 0:
        LOGGER.warning(
            "No positive concentration "
            "values were produced."
        )

        return

    peak = float(
        np.max(positive)
    )

    LOGGER.info(
        "Peak concentration: "
        "%.6g ug/m3",
        peak,
    )

    meaningful_floor = (
        peak * 1.0e-12
    )

    meaningful = positive[
        positive
        >= meaningful_floor
    ]

    if meaningful.size:
        LOGGER.info(
            "Meaningful positive range: "
            "%.6g .. %.6g ug/m3",
            float(
                np.min(
                    meaningful
                )
            ),
            float(
                np.max(
                    meaningful
                )
            ),
        )


def run(
    args: argparse.Namespace,
) -> None:
    """Run the complete Gaussian baseline workflow."""

    config = load_project_config(
        args.config
    )

    voxel_path = resolve_repo_path(
        config,
        "paths.voxel_netcdf",
    )

    output_path = resolve_output_path(
        args.output
    )

    linear_plot_path = resolve_output_path(
        args.plot_linear
    )

    log_plot_path = resolve_output_path(
        args.plot_log
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
        dataset = opened.load()

    (
        x,
        y,
        z,
        building_mask,
    ) = validate_voxel_dataset(
        dataset
    )

    # ========================================================
    # SYNTHETIC SOURCE
    # ========================================================

    (
        center_x,
        center_y,
        overlap_count,
    ) = choose_demo_line_center(
        x=x,
        y=y,
        building_mask=building_mask,
        z=z,
        source_height_m=(
            args.source_height
        ),
        wind_from_deg=(
            args.wind_from
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

    sources = build_demo_line_sources(
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
        "Synthetic line source: "
        "%d point sources, "
        "spacing=%.2f m, "
        "total Q=%.4f g/s, "
        "center=(%.2f, %.2f)",
        len(sources),
        args.source_spacing,
        args.emission_rate,
        center_x,
        center_y,
    )

    LOGGER.info(
        "Source/building overlap "
        "count at source height: %d",
        overlap_count,
    )

    # ========================================================
    # CALCULATE
    # ========================================================

    concentration = (
        calculate_gaussian_field(
            x=x,
            y=y,
            z=z,
            sources=sources,
            args=args,
        )
    )

    if not args.keep_building_values:
        concentration = np.where(
            building_mask,
            np.nan,
            concentration,
        )

    # ========================================================
    # SAVE DATA
    # ========================================================

    dataset = attach_gaussian_result(
        dataset=dataset,
        concentration_ug_m3=concentration,
        sources=sources,
        args=args,
    )

    save_dataset(
        dataset,
        output_path,
    )

    # ========================================================
    # VISUALIZATION
    # ========================================================

    save_qa_plot(
        dataset=dataset,
        path=linear_plot_path,
        requested_z_m=(
            args.plot_height
        ),
        sources=sources,
        wind_from_deg=(
            args.wind_from
        ),
        reference_wind_speed_m_s=(
            args.wind_speed
        ),
        stability=(
            args.stability
        ),
        total_emission_rate_g_s=(
            args.emission_rate
        ),
        scale="linear",
    )

    save_qa_plot(
        dataset=dataset,
        path=log_plot_path,
        requested_z_m=(
            args.plot_height
        ),
        sources=sources,
        wind_from_deg=(
            args.wind_from
        ),
        reference_wind_speed_m_s=(
            args.wind_speed
        ),
        stability=(
            args.stability
        ),
        total_emission_rate_g_s=(
            args.emission_rate
        ),
        scale="log",
    )

    log_summary(
        concentration_ug_m3=(
            concentration
        ),
        sources=sources,
        output_path=output_path,
        linear_plot_path=(
            linear_plot_path
        ),
        log_plot_path=(
            log_plot_path
        ),
    )


def build_parser() -> argparse.ArgumentParser:
    """Build command-line arguments."""

    parser = argparse.ArgumentParser(
        description=(
            "Run Gaussian baseline "
            "on voxel_grid.nc"
        )
    )

    parser.add_argument(
        "--config",
        default=(
            "config/project.yaml"
        ),
    )

    parser.add_argument(
        "--output",
        default=(
            "data/processed/"
            "gaussian_baseline.nc"
        ),
    )

    parser.add_argument(
        "--plot-linear",
        default=(
            "outputs/"
            "gaussian_baseline_linear.png"
        ),
    )

    parser.add_argument(
        "--plot-log",
        default=(
            "outputs/"
            "gaussian_baseline_log.png"
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
            "Synthetic line-source "
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
        default=5.0,
        help=(
            "Spacing between synthetic "
            "Gaussian point sources."
        ),
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
    """CLI entry point."""

    logging.basicConfig(
        level=logging.INFO,
        format=(
            "%(levelname)s | "
            "%(message)s"
        ),
    )

    parser = build_parser()
    args = parser.parse_args()

    run(args)


if __name__ == "__main__":
    main()
