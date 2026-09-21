"""Visualization utilities for the Gaussian verification baseline."""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import xarray as xr

from matplotlib.colors import (
    ListedColormap,
    LogNorm,
)

from .gaussian_model import (
    nearest_index,
    normalize_stability,
    wind_basis,
    wind_label,
)


def cell_spacing(
    values: np.ndarray,
) -> float:
    """Return absolute median grid spacing."""

    if len(values) < 2:
        return 1.0

    return float(
        abs(
            np.median(
                np.diff(values)
            )
        )
    )


def significant_log_limits(
    field: np.ndarray,
) -> tuple[float, float]:
    """
    Select useful log-scale limits.

    Extremely tiny floating-point tails
    are ignored for visualization only.
    """

    positive = field[
        np.isfinite(field)
        & (field > 0.0)
    ]

    if positive.size == 0:
        raise ValueError(
            "No positive concentration "
            "values available for log plot."
        )

    vmax = float(
        np.max(positive)
    )

    floor_from_peak = (
        vmax * 1.0e-4
    )

    percentile_floor = float(
        np.percentile(
            positive,
            2.0,
        )
    )

    vmin = max(
        floor_from_peak,
        percentile_floor,
    )

    if (
        not np.isfinite(vmin)
        or vmin <= 0.0
        or vmin >= vmax
    ):
        vmin = max(
            vmax * 1.0e-4,
            np.finfo(
                np.float64
            ).tiny,
        )

    return vmin, vmax


def save_qa_plot(
    dataset: xr.Dataset,
    path: Path,
    requested_z_m: float,
    sources: list[
        tuple[
            float,
            float,
            float,
            float,
        ]
    ],
    wind_from_deg: float,
    reference_wind_speed_m_s: float,
    stability: str,
    total_emission_rate_g_s: float,
    scale: str,
) -> None:
    """Save one publication-style Gaussian QA plot."""

    if scale not in {
        "linear",
        "log",
    }:
        raise ValueError(
            "scale must be 'linear' or 'log'"
        )

    path.parent.mkdir(
        parents=True,
        exist_ok=True,
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

    z_index = nearest_index(
        z,
        requested_z_m,
    )

    actual_z = float(
        z[z_index]
    )

    field = np.asarray(
        dataset[
            "C_gaussian_ug_m3"
        ]
        .isel(z=z_index)
        .values,
        dtype=np.float64,
    )

    building_layer = np.asarray(
        dataset["B"]
        .isel(z=z_index)
        .values,
        dtype=bool,
    )

    dx = cell_spacing(x)
    dy = cell_spacing(y)

    x_origin = float(
        x[0] - dx / 2.0
    )

    y_origin = float(
        y[0] - dy / 2.0
    )

    width = float(
        len(x) * dx
    )

    height = float(
        len(y) * dy
    )

    extent = (
        0.0,
        width,
        0.0,
        height,
    )

    figure, axis = plt.subplots(
        figsize=(10.5, 8.5)
    )

    # ========================================================
    # CONCENTRATION FIELD
    # ========================================================

    if scale == "linear":
        finite_field = np.where(
            np.isfinite(field),
            field,
            0.0,
        )

        vmax = float(
            np.max(finite_field)
        )

        if vmax <= 0.0:
            vmax = 1.0

        image = axis.imshow(
            finite_field,
            origin="lower",
            extent=extent,
            aspect="equal",
            interpolation="nearest",
            cmap="viridis",
            vmin=0.0,
            vmax=vmax,
        )

        scale_note = "Linear scale"

    else:
        vmin, vmax = (
            significant_log_limits(
                field
            )
        )

        # LogNorm cannot represent zero.
        #
        # Render zero/invalid concentration slightly below
        # the visible lower limit instead of masking it.
        # This avoids misleading white regions in the plot.
        display_floor = (
            vmin * 0.5
        )

        display_field = np.where(
            np.isfinite(field)
            & (field > 0.0),
            field,
            display_floor,
        )

        image = axis.imshow(
            display_field,
            origin="lower",
            extent=extent,
            aspect="equal",
            interpolation="nearest",
            cmap="viridis",
            norm=LogNorm(
                vmin=vmin,
                vmax=vmax,
                clip=False,
            ),
        )

        scale_note = (
            "Log scale "
            f"({vmin:.2g}-{vmax:.2g} "
            "\u00b5g/m\u00b3)\n"
            "Zero shown with under-range color"
        )

    # ========================================================
    # BUILDING OVERLAY
    # ========================================================

    building_overlay = (
        np.ma.masked_where(
            ~building_layer,
            np.ones_like(
                building_layer,
                dtype=np.float64,
            ),
        )
    )

    axis.imshow(
        building_overlay,
        origin="lower",
        extent=extent,
        aspect="equal",
        interpolation="nearest",
        cmap=ListedColormap(
            ["#666666"]
        ),
        alpha=0.95,
        vmin=0.0,
        vmax=1.0,
        zorder=4,
    )

    # ========================================================
    # SYNTHETIC LINE SOURCE
    # ========================================================

    source_x = np.asarray(
        [
            item[0] - x_origin
            for item in sources
        ],
        dtype=float,
    )

    source_y = np.asarray(
        [
            item[1] - y_origin
            for item in sources
        ],
        dtype=float,
    )

    axis.plot(
        source_x,
        source_y,
        color="#d62728",
        linewidth=3.2,
        solid_capstyle="round",
        label="Synthetic line source",
        zorder=7,
    )

    # ========================================================
    # WIND ARROW
    # ========================================================

    down_x, down_y, _, _ = (
        wind_basis(
            wind_from_deg
        )
    )

    arrow_length = 65.0

    arrow_center_x = (
        0.50 * width
    )

    arrow_center_y = (
        0.92 * height
    )

    arrow_start_x = (
        arrow_center_x
        - 0.5
        * arrow_length
        * down_x
    )

    arrow_start_y = (
        arrow_center_y
        - 0.5
        * arrow_length
        * down_y
    )

    axis.quiver(
        arrow_start_x,
        arrow_start_y,
        down_x * arrow_length,
        down_y * arrow_length,
        angles="xy",
        scale_units="xy",
        scale=1.0,
        width=0.006,
        color="black",
        zorder=8,
    )

    axis.text(
        arrow_center_x,
        min(
            height - 8.0,
            arrow_center_y + 22.0,
        ),
        (
            f"Wind "
            f"{wind_label(wind_from_deg)} "
            f"{reference_wind_speed_m_s:.1f} m/s"
        ),
        ha="center",
        va="center",
        fontsize=10,
        color="black",
        zorder=8,
    )

    # ========================================================
    # COLORBAR
    # ========================================================

    colorbar = figure.colorbar(
        image,
        ax=axis,
        pad=0.025,
    )

    colorbar.set_label(
        "Concentration (\u00b5g/m\u00b3)"
    )

    # ========================================================
    # TITLE / AXES
    # ========================================================

    axis.set_title(
        (
            "Gaussian baseline "
            "\u2014 synthetic verification case\n"
            f"nearest voxel center z = {actual_z:.1f} m "
            f"(requested {requested_z_m:.1f} m)"
            " | "
            f"Stability {normalize_stability(stability)}"
            " | "
            f"Q = {total_emission_rate_g_s:.2f} g/s"
        ),
        fontsize=14,
        pad=12,
    )

    axis.set_xlabel(
        "Local x (m)"
    )

    axis.set_ylabel(
        "Local y (m)"
    )

    axis.set_xlim(
        0.0,
        width,
    )

    axis.set_ylim(
        0.0,
        height,
    )

    axis.set_aspect(
        "equal"
    )

    axis.grid(
        alpha=0.14,
        linewidth=0.6,
    )

    axis.legend(
        loc="lower right",
        frameon=True,
    )

    axis.text(
        0.015,
        0.015,
        (
            f"{scale_note}\n"
            "Buildings shown in gray"
        ),
        transform=axis.transAxes,
        ha="left",
        va="bottom",
        fontsize=9,
        bbox={
            "boxstyle": "round,pad=0.35",
            "facecolor": "white",
            "edgecolor": "0.65",
            "alpha": 0.88,
        },
        zorder=9,
    )

    figure.tight_layout()

    figure.savefig(
        path,
        dpi=180,
        bbox_inches="tight",
    )

    plt.close(
        figure
    )