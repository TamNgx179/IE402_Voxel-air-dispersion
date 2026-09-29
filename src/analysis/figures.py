"""
Report figures, 300 dpi, from contract files and the voxel grid.

Colour follows its job: concentration (magnitude) is ONE hue, light to dark,
on a log scale shared by every panel of a figure; scenarios (identity) take
the first two slots of a CVD-validated categorical order and are always also
direct-labelled; the two thresholds use reserved status colours, always with
a text label, and a dash pattern as secondary encoding.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import geopandas as gpd
import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap, LogNorm  # noqa: E402

from analysis import operators as ops  # noqa: E402
from analysis.fields import ConcentrationField  # noqa: E402

DPI = 300

INK = "#0b0b0b"
INK_2 = "#52514e"
MUTED = "#898781"
GRID = "#e1e0d9"
SURFACE = "#fcfcfb"
BUILDING = "#c3c2b7"

SCENARIO_COLOURS = ["#2a78d6", "#eb6834"]  # validated: scripts/validate_palette.js, light + dark
THRESHOLD_STYLE = {
    "qcvn_24h": {"color": "#d03b3b", "dash": (0, (6, 3))},
    "who_24h": {"color": "#fab219", "dash": (0, (2, 2))},
}

# Single-hue sequential ramp, light (low) to dark (high).
SEQUENTIAL = LinearSegmentedColormap.from_list(
    "blue_seq", ["#cde2fb", "#86b6ef", "#3987e5", "#256abf", "#184f95", "#0d366b"]
)
SEQUENTIAL.set_bad(BUILDING)

SEASON_NAMES = {"dry_nov_apr": "Mùa khô (11–4)", "wet_may_oct": "Mùa mưa (5–10)"}


def scenario_label(field_: ConcentrationField) -> str:
    season = next((name for key, name in SEASON_NAMES.items() if field_.scenario.startswith(key)), field_.scenario)
    return f"{season}, gió từ {field_.attrs['wind_from_deg']:.0f}°, {field_.attrs['wind_speed_m_s']:.2f} m/s"


def _style(ax: plt.Axes) -> None:
    ax.set_facecolor(SURFACE)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(BUILDING)
    ax.tick_params(colors=MUTED, labelsize=7)
    ax.xaxis.label.set_color(INK_2)
    ax.yaxis.label.set_color(INK_2)
    ax.title.set_color(INK)


def _save(fig: plt.Figure, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=DPI, bbox_inches="tight", facecolor=SURFACE)
    plt.close(fig)
    return path


def _extent(field_: ConcentrationField) -> list[float]:
    _, dy, dx = field_.spacing
    return [
        (field_.x[0] - dx / 2 - field_.x[0]),
        (field_.x[-1] + dx / 2 - field_.x[0]),
        (field_.y[0] - dy / 2 - field_.y[0]),
        (field_.y[-1] + dy / 2 - field_.y[0]),
    ]


def _shared_norm(fields: list[ConcentrationField], decades: float) -> LogNorm:
    top = max(float(np.nanmax(f.concentration)) for f in fields)
    return LogNorm(vmin=top / 10**decades, vmax=top)


def voxel_check(field_: ConcentrationField, buildings: gpd.GeoDataFrame, path: Path) -> Path:
    """A2.4: three planes through the occupancy mask, footprints overlaid."""

    fig, axes = plt.subplots(1, 3, figsize=(11, 3.9))
    extent = _extent(field_)
    origin_x, origin_y = field_.x[0], field_.y[0]
    footprints = buildings.to_crs(field_.crs)
    footprints = footprints.set_geometry(footprints.translate(-origin_x, -origin_y))

    for ax, height in zip(axes[:2], (1.0, 15.0)):
        k = int(np.argmin(np.abs(field_.z - height)))
        ax.imshow(field_.solid[k], origin="lower", extent=extent, cmap=LinearSegmentedColormap.from_list("m", [SURFACE, BUILDING]))
        footprints.boundary.plot(ax=ax, color="#256abf", linewidth=0.5)
        ax.set_title(f"Mặt bằng z = {field_.z[k]:g} m · {int(field_.solid[k].sum())} ô đặc", fontsize=8)
        ax.set_xlabel("x (m)")
        ax.set_ylabel("y (m)")
        _style(ax)

    # The row crossing the most building volume shows the most.
    j = int(np.argmax(field_.solid.sum(axis=(0, 2))))
    ax = axes[2]
    _, _, dx = field_.spacing
    ax.imshow(
        field_.solid[:, j, :], origin="lower", aspect="auto",
        extent=[extent[0], extent[1], 0, field_.z[-1] + 1],
        cmap=LinearSegmentedColormap.from_list("m", [SURFACE, BUILDING]),
    )
    ax.set_title(f"Mặt cắt đứng x–z tại y = {field_.y[j] - origin_y:.1f} m", fontsize=8)
    ax.set_xlabel("x (m)")
    ax.set_ylabel("z (m)")
    _style(ax)

    fig.suptitle(
        "A2.4 — kiểm mask voxel: xám = ô đặc, viền xanh = footprint. "
        "Footprint không tô ở z = 1 m là nhà cao < 1 m (dưới tâm ô đầu tiên)",
        fontsize=9, color=INK,
    )
    return _save(fig, path)


def slices(fields: list[ConcentrationField], heights: list[float], decades: float, path: Path) -> Path:
    """Small multiples: one row per scenario, one column per height, one log scale."""

    norm = _shared_norm(fields, decades)
    fig, axes = plt.subplots(len(fields), len(heights), figsize=(2.6 * len(heights), 2.7 * len(fields)), squeeze=False)

    for row, field_ in zip(axes, fields):
        planes = ops.horizontal_slices(field_.concentration, field_.z, heights, field_.solid)
        for ax, height in zip(row, heights):
            image = ax.imshow(
                np.ma.masked_invalid(np.clip(planes[height], norm.vmin, None)),
                origin="lower", extent=_extent(field_), cmap=SEQUENTIAL, norm=norm,
            )
            ax.set_title(f"z = {height:g} m", fontsize=8)
            ax.set_xticks([])
            ax.set_yticks([])
            _style(ax)
        row[0].set_ylabel(scenario_label(field_), fontsize=7)

    bar = fig.colorbar(image, ax=axes, shrink=0.8, pad=0.02)
    bar.set_label("PM2.5 giao thông (µg/m³, log)", fontsize=7, color=INK_2)
    bar.ax.tick_params(labelsize=7, colors=MUTED)
    fig.suptitle("Lát cắt ngang — cùng một thang màu; xám = trong nhà", fontsize=9, color=INK)
    return _save(fig, path)


def layer_means(fields: list[ConcentrationField], path: Path) -> Path:
    """Mean over air of each layer versus height: the 'why 3D' figure."""

    fig, ax = plt.subplots(figsize=(4.2, 4.2))

    for colour, field_ in zip(SCENARIO_COLOURS, fields):
        means = ops.layer_means(field_.concentration, field_.solid)
        ax.plot(means, field_.z, color=colour, linewidth=2)

    ax.set_xscale("log")
    ax.set_xlabel("Nồng độ trung bình tầng (µg/m³, log)")
    ax.set_ylabel("Độ cao (m)")
    ax.grid(True, color=GRID, linewidth=0.5)
    ax.legend([scenario_label(f) for f in fields], fontsize=6, frameon=False, loc="upper right")
    ax.set_title("Trung bình theo tầng — nồng độ đổi theo độ cao", fontsize=8)
    _style(ax)
    return _save(fig, path)


def vertical_sections(field_: ConcentrationField, decades: float, path: Path) -> Path:
    """x-z and y-z planes through the maximum cell."""

    norm = _shared_norm([field_], decades)
    finite = np.where(np.isnan(field_.concentration), -np.inf, field_.concentration)
    _, j, i = np.unravel_index(int(np.argmax(finite)), finite.shape)
    extent = _extent(field_)

    fig, axes = plt.subplots(1, 2, figsize=(9, 3.2))
    for ax, axis, index, span, label in (
        (axes[0], "y", j, extent[:2], "x"),
        (axes[1], "x", i, extent[2:], "y"),
    ):
        plane = ops.vertical_section(field_.concentration, axis, index, field_.solid)
        image = ax.imshow(
            np.ma.masked_invalid(np.clip(plane, norm.vmin, None)), origin="lower", aspect="auto",
            extent=[span[0], span[1], 0, field_.z[-1] + 1], cmap=SEQUENTIAL, norm=norm,
        )
        fixed = field_.y[j] - field_.y[0] if axis == "y" else field_.x[i] - field_.x[0]
        ax.set_title(f"Mặt cắt {label}–z tại {axis} = {fixed:.1f} m (qua ô cực đại)", fontsize=8)
        ax.set_xlabel(f"{label} (m)")
        ax.set_ylabel("z (m)")
        _style(ax)

    bar = fig.colorbar(image, ax=axes, shrink=0.85, pad=0.02)
    bar.set_label("µg/m³ (log)", fontsize=7, color=INK_2)
    bar.ax.tick_params(labelsize=7, colors=MUTED)
    fig.suptitle(scenario_label(field_), fontsize=9, color=INK)
    return _save(fig, path)


def facade_by_floor(fields: list[ConcentrationField], floor_height_m: float, path: Path) -> Path:
    """Grouped bars: mean facade concentration per floor, one bar per scenario."""

    fig, ax = plt.subplots(figsize=(5.2, 3.6))
    exposures = [ops.facade_exposure_by_floor(f.concentration, f.solid, f.z, floor_height_m) for f in fields]
    floors = sorted(set().union(*[set(e.floor.tolist()) for e in exposures]))
    floors = [f for f in floors if f <= 12]
    width = 0.38

    for n, (colour, field_, exposure) in enumerate(zip(SCENARIO_COLOURS, fields, exposures)):
        lookup = dict(zip(exposure.floor.tolist(), exposure.mean.tolist()))
        positions = np.arange(len(floors)) + (n - 0.5) * (width + 0.02)
        ax.bar(positions, [lookup.get(f, np.nan) for f in floors], width=width, color=colour,
               label=scenario_label(field_), edgecolor=SURFACE, linewidth=1)

    ax.set_xticks(np.arange(len(floors)))
    ax.set_xticklabels([str(f + 1) for f in floors])
    ax.set_xlabel(f"Tầng nhà (cao {floor_height_m:g} m mỗi tầng)")
    ax.set_ylabel("Nồng độ TB trên mặt đứng (µg/m³)")
    ax.grid(True, axis="y", color=GRID, linewidth=0.5)
    ax.set_axisbelow(True)
    ax.legend(fontsize=6, frameon=False)
    ax.set_title("Phơi nhiễm mặt đứng toà nhà theo tầng", fontsize=8)
    _style(ax)
    return _save(fig, path)


def exceedance_sensitivity(fields: list[ConcentrationField], limits: dict[str, dict[str, Any]], path: Path) -> Path:
    """
    Exceedance volume versus an emission multiplier k.

    The model is linear in the source with zero background, so C(k) = k*C and
    V(theta; k) = V(theta / k; 1) exactly - one pass over the float field, no rerun.
    """

    multipliers = np.logspace(0, np.log10(300), 60)
    fig, ax = plt.subplots(figsize=(5.2, 3.8))

    for n, (colour, field_) in enumerate(zip(SCENARIO_COLOURS, fields)):
        dz, dy, dx = field_.spacing
        for key, item in limits.items():
            volume = [
                ops.exceedance_volume(field_.concentration, field_.solid, item["value"] / k, dx, dy, dz) / 1e3
                for k in multipliers
            ]
            ax.plot(multipliers, volume, color=colour, linestyle=THRESHOLD_STYLE[key]["dash"], linewidth=2)
            if n == len(fields) - 1:  # one direct label per threshold, not per line
                ax.annotate(f"{item['label'].split(' ·')[0]} {item['value']:g}", (multipliers[-1], volume[-1]),
                            xytext=(4, 0), textcoords="offset points", fontsize=6, color=INK_2, va="center")

    ax.set_xscale("log")
    ax.set_xlabel("Hệ số nhân phát thải k so với EDGAR (log)")
    ax.set_ylabel("Thể tích vượt ngưỡng (nghìn m³)")
    ax.grid(True, color=GRID, linewidth=0.5)
    handles = [plt.Line2D([], [], color=c, linewidth=2) for c in SCENARIO_COLOURS[: len(fields)]]
    handles += [plt.Line2D([], [], color=MUTED, linestyle=s["dash"], linewidth=2) for s in THRESHOLD_STYLE.values()]
    labels = [scenario_label(f).split(",")[0] for f in fields] + [item["label"] for item in limits.values()]
    ax.legend(handles, labels, fontsize=6, frameon=False, loc="upper left", handlelength=4)
    ax.set_title("Độ nhạy: EDGAR (k = 1) không vượt ngưỡng nào", fontsize=8)
    _style(ax)
    return _save(fig, path)


def profiles(fields: list[ConcentrationField], limits: dict[str, dict[str, Any]], path: Path) -> Path:
    """
    Vertical profile through the street-level cell where the first scenario
    peaks; the same column for every scenario so the lines compare.
    """

    fig, ax = plt.subplots(figsize=(4.2, 4.2))
    ground = np.where(np.isnan(fields[0].concentration[0]), -np.inf, fields[0].concentration[0])
    j, i = np.unravel_index(int(np.argmax(ground)), ground.shape)
    x, y = float(fields[0].x[i]), float(fields[0].y[j])

    for colour, field_ in zip(SCENARIO_COLOURS, fields):
        column = ops.vertical_profile(field_.concentration, field_.x, field_.y, x, y, field_.solid)
        ax.plot(np.where(column > 0, column, np.nan), field_.z, color=colour, linewidth=2, label=scenario_label(field_))

    for key, item in limits.items():
        style = THRESHOLD_STYLE[key]
        ax.axvline(item["value"], color=style["color"], linestyle=style["dash"], linewidth=1)
        ax.annotate(item["label"], (item["value"], field_.z[-1]), rotation=90, fontsize=6, color=INK_2,
                    xytext=(-8, -4), textcoords="offset points", ha="right", va="top")

    ax.set_xscale("log")
    ax.set_xlabel("µg/m³ (log)")
    ax.set_ylabel("Độ cao (m)")
    ax.grid(True, color=GRID, linewidth=0.5)
    ax.legend(fontsize=6, frameon=False, loc="lower left")
    ax.set_ylim(0, fields[0].z[-1] + 1)
    ax.set_title(
        f"Profile đứng qua ô mặt phố nồng độ cao nhất (x = {x - fields[0].x[0]:.0f} m, y = {y - fields[0].y[0]:.0f} m)",
        fontsize=7,
    )
    _style(ax)
    return _save(fig, path)


def voxel_check_satellite(
    field_: ConcentrationField,
    buildings: gpd.GeoDataFrame,
    imagery_rgb: np.ndarray,
    heights_m: tuple[float, ...],
    attribution: str,
    path: Path,
) -> Path:
    """
    A2.4 as the roadmap states it: horizontal planes of the occupancy mask laid
    over satellite imagery, with the OSM footprints for reference.
    """

    extent = _extent(field_)
    origin_x, origin_y = field_.x[0], field_.y[0]
    footprints = buildings.to_crs(field_.crs)
    footprints = footprints.set_geometry(footprints.translate(-origin_x, -origin_y))
    mask_colour = LinearSegmentedColormap.from_list("mask", ["#00000000", "#eb6834"])

    fig, axes = plt.subplots(1, len(heights_m), figsize=(4.0 * len(heights_m), 4.3))
    for ax, height in zip(np.atleast_1d(axes), heights_m):
        k = int(np.argmin(np.abs(field_.z - height)))
        ax.imshow(imagery_rgb, extent=extent, origin="upper")
        ax.imshow(np.ma.masked_equal(field_.solid[k].astype(float), 0.0), origin="lower", extent=extent,
                  cmap=mask_colour, alpha=0.55, vmin=0, vmax=1)
        footprints.boundary.plot(ax=ax, color="#ffffff", linewidth=0.4)
        ax.set_title(f"z = {field_.z[k]:g} m · {int(field_.solid[k].sum())} ô đặc", fontsize=8)
        ax.set_xlim(extent[0], extent[1])
        ax.set_ylim(extent[2], extent[3])
        ax.set_xlabel("x (m)")
        ax.set_ylabel("y (m)")
        _style(ax)

    fig.suptitle("A2.4 — mask voxel (cam) và footprint OSM (trắng) chồng lên ảnh vệ tinh", fontsize=9, color=INK)
    fig.text(0.99, 0.01, attribution, ha="right", va="bottom", fontsize=6, color=MUTED)
    return _save(fig, path)
