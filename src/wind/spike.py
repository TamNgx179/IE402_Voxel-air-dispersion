"""Week-1 ROADMAP wind/SOR spike cases and validation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from .core import (
    WindResult,
    power_law_profile,
    project_mass_consistent,
)


def _seed_field(
    solid: np.ndarray,
    *,
    dz: float,
):
    """Create the Week-1 power-law initial wind field."""

    nz, ny, nx = solid.shape

    z = (
        np.arange(nz)
        + 0.5
    ) * dz

    profile = power_law_profile(
        z,
        u_ref_m_s=3.0,
        z_ref_m=10.0,
        exponent=0.25,
    )

    u0 = np.broadcast_to(
        profile[:, None, None],
        (
            nz,
            ny,
            nx,
        ),
    ).copy()

    v0 = np.zeros_like(u0)
    w0 = np.zeros_like(u0)

    # No velocity inside solid cells.
    u0[solid] = 0.0

    return (
        u0,
        v0,
        w0,
    )


def build_week1_spike_case():
    """Formal ROADMAP case.

    Domain
    ------
    x = 500 m
    z = 100 m

    Grid
    ----
    nx = 100
    nz = 50

    Building
    --------
    Width = 50 m
    Height = 20 m
    Centre = x 250 m

    The object touches the ground because this is the
    formal building case required by the ROADMAP.
    """

    dz = 2.0
    dy = 5.0
    dx = 5.0

    nz = 50
    ny = 1
    nx = 100

    solid = np.zeros(
        (
            nz,
            ny,
            nx,
        ),
        dtype=bool,
    )

    # x = 225 -> 275 m
    # z =   0 ->  20 m
    solid[
        0:10,
        :,
        45:55,
    ] = True

    u0, v0, w0 = _seed_field(
        solid,
        dz=dz,
    )

    return (
        u0,
        v0,
        w0,
        solid,
        dz,
        dy,
        dx,
    )


def _add_rotated_rectangle_xz(
    solid: np.ndarray,
    *,
    center_x_m: float,
    center_z_m: float,
    width_m: float,
    height_m: float,
    angle_deg: float,
    dx: float,
    dz: float,
):
    """Rasterise a rotated rectangle into an x-z obstacle mask."""

    if (
        solid.ndim != 3
        or solid.shape[1] != 1
    ):
        raise ValueError(
            "this helper expects a [z,1,x] mask"
        )

    if (
        width_m <= 0
        or height_m <= 0
    ):
        raise ValueError(
            "width_m and height_m must be > 0"
        )

    nz, _, nx = solid.shape

    x = (
        np.arange(nx)
        + 0.5
    ) * dx

    z = (
        np.arange(nz)
        + 0.5
    ) * dz

    X, Z = np.meshgrid(
        x,
        z,
    )

    theta = np.deg2rad(
        float(angle_deg)
    )

    c = np.cos(theta)
    s = np.sin(theta)

    xr = (
        X
        - center_x_m
    )

    zr = (
        Z
        - center_z_m
    )

    # Transform global coordinates into
    # the local coordinate system of the rectangle.
    x_local = (
        c * xr
        + s * zr
    )

    z_local = (
        -s * xr
        + c * zr
    )

    inside = (
        (
            np.abs(x_local)
            <= width_m / 2.0
        )
        & (
            np.abs(z_local)
            <= height_m / 2.0
        )
    )

    solid[:, 0, :] |= inside


def build_week1_multi_obstacle_case():
    """Supplemental robustness case.

    Three obstacles are deliberately placed away from the ground:

    1. Horizontal obstacle
    2. Vertical obstacle
    3. Rotated +35 degree obstacle

    This verifies that the solver does not only work when
    the obstacle is attached to the bottom boundary.

    This supplemental case does NOT replace the formal
    one-building ROADMAP gate.
    """

    dz = 2.0
    dy = 5.0
    dx = 5.0

    nz = 50
    ny = 1
    nx = 100

    solid = np.zeros(
        (
            nz,
            ny,
            nx,
        ),
        dtype=bool,
    )

    # =========================================================
    # Obstacle 1
    # Horizontal
    # =========================================================

    _add_rotated_rectangle_xz(
        solid,
        center_x_m=125.0,
        center_z_m=52.0,
        width_m=90.0,
        height_m=14.0,
        angle_deg=0.0,
        dx=dx,
        dz=dz,
    )

    # =========================================================
    # Obstacle 2
    # Vertical
    # =========================================================

    _add_rotated_rectangle_xz(
        solid,
        center_x_m=255.0,
        center_z_m=50.0,
        width_m=28.0,
        height_m=58.0,
        angle_deg=0.0,
        dx=dx,
        dz=dz,
    )

    # =========================================================
    # Obstacle 3
    # Rotated +35 degrees
    # =========================================================

    _add_rotated_rectangle_xz(
        solid,
        center_x_m=390.0,
        center_z_m=48.0,
        width_m=82.0,
        height_m=16.0,
        angle_deg=35.0,
        dx=dx,
        dz=dz,
    )

    u0, v0, w0 = _seed_field(
        solid,
        dz=dz,
    )

    return (
        u0,
        v0,
        w0,
        solid,
        dz,
        dy,
        dx,
    )


def save_week1_plot(
    result: WindResult,
    solid: np.ndarray,
    *,
    dx: float,
    dz: float,
    path,
    title: str,
):
    """Save the x-z wind-vector visualisation."""

    import matplotlib.pyplot as plt

    path = Path(path)

    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    nz, _, nx = solid.shape

    x = (
        np.arange(nx)
        + 0.5
    ) * dx

    z = (
        np.arange(nz)
        + 0.5
    ) * dz

    X, Z = np.meshgrid(
        x,
        z,
    )

    fig, ax = plt.subplots(
        figsize=(
            12,
            5,
        )
    )

    ax.quiver(
        X[::2, ::3],
        Z[::2, ::3],
        result.u[::2, 0, ::3],
        result.w[::2, 0, ::3],
        angles="xy",
        scale_units="xy",
        scale=1.0,
        width=0.0022,
    )

    ax.contourf(
        X,
        Z,
        solid[:, 0, :].astype(float),
        levels=[
            0.5,
            1.5,
        ],
        colors=[
            "0.70",
        ],
    )

    ax.set(
        xlim=(
            0,
            nx * dx,
        ),
        ylim=(
            0,
            nz * dz,
        ),
        xlabel="x (m)",
        ylabel="z (m)",
        title=title,
    )

    ax.grid(
        alpha=0.2
    )

    fig.tight_layout()

    fig.savefig(
        path,
        dpi=180,
    )

    plt.close(fig)

    return path


def save_week1_result_json(
    report: dict[str, Any],
    path,
) -> Path:
    """Persist the Week-1 spike evidence as tracked, machine-readable JSON."""

    path = Path(path)

    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    path.write_text(
        json.dumps(
            report,
            indent=2,
            ensure_ascii=False,
            sort_keys=False,
        )
        + "\n",
        encoding="utf-8",
    )

    return path


def _max_local_vertical_speed(
    result: WindResult,
    solid: np.ndarray,
    halo,
) -> float:
    """Return max |w| in air cells around an obstacle."""

    air = ~solid

    local_air = air[halo]

    local_w = np.abs(
        result.w[halo]
    )

    if not np.any(local_air):
        return 0.0

    return float(
        np.max(
            local_w[local_air]
        )
    )


def run_week1_spike(
    *,
    result_json_path=(
        Path("output")
        / "analysis"
        / "wind_spike_result.json"
    ),
    figure_dir=(
        Path("output")
        / "figures"
    ),
) -> WindResult:
    """Run the Week-1 ROADMAP gate and persist its evidence.

    The default result file is ``output/analysis/wind_spike_result.json``.
    It records the answers to the three B1.5 ROADMAP questions, the numerical
    values supporting those answers, and the supplemental robustness check.
    """

    result_json_path = Path(
        result_json_path
    )

    figure_dir = Path(
        figure_dir
    )

    # =========================================================
    # FORMAL ROADMAP CASE
    # =========================================================

    (
        u0,
        v0,
        w0,
        solid,
        dz,
        dy,
        dx,
    ) = build_week1_spike_case()

    air = ~solid

    result = project_mass_consistent(
        u0,
        v0,
        w0,
        solid,
        dx=dx,
        dy=dy,
        dz=dz,
        omega=1.78,
        tolerance=1.0e-4,
        max_iter=10_000,
    )

    max_before = float(
        np.max(
            np.abs(
                result.divergence_before[air]
            )
        )
    )

    max_after = float(
        np.max(
            np.abs(
                result.divergence_after[air]
            )
        )
    )

    mean_after = float(
        np.mean(
            np.abs(
                result.divergence_after[air]
            )
        )
    )

    max_w = _max_local_vertical_speed(
        result,
        solid,
        (
            slice(
                0,
                20,
            ),
            slice(None),
            slice(
                40,
                61,
            ),
        ),
    )

    zero_solid = bool(
        np.all(
            result.u[solid]
            == 0.0
        )
        and np.all(
            result.v[solid]
            == 0.0
        )
        and np.all(
            result.w[solid]
            == 0.0
        )
    )

    q1 = (
        result.sor_residual
        < 1.0e-4
    )

    q2 = (
        max_after
        < 1.0e-3
    )

    q3 = (
        max_w > 1.0e-6
        and zero_solid
    )

    plot_path = save_week1_plot(
        result,
        solid,
        dx=dx,
        dz=dz,
        path=(
            figure_dir
            / "wind_sor_week1_spike.png"
        ),
        title=(
            "Week-1 SOR spike: "
            "one centred ground-connected building"
        ),
    )

    formal_pass = (
        q1
        and q2
        and q3
    )

    report: dict[str, Any] = {
        "task": "B1.5",
        "name": "Week-1 ROADMAP 2D x-z SOR spike",
        "overall_status": (
            "PASS"
            if formal_pass
            else "FAIL"
        ),
        "formal_case": {
            "grid": {
                "nx": int(solid.shape[2]),
                "ny": int(solid.shape[1]),
                "nz": int(solid.shape[0]),
                "dx_m": float(dx),
                "dy_m": float(dy),
                "dz_m": float(dz),
            },
            "solver": {
                "omega": 1.78,
                "tolerance": 1.0e-4,
                "max_iter": 10_000,
            },
            "questions": {
                "q1_sor_converges": {
                    "answer": bool(q1),
                    "iterations": int(result.iterations),
                    "final_sum_abs_delta_lambda": float(
                        result.sor_residual
                    ),
                },
                "q2_divergence_below_threshold_in_every_air_voxel": {
                    "answer": bool(q2),
                    "threshold_1_s": 1.0e-3,
                    "max_abs_div_before_1_s": max_before,
                    "max_abs_div_after_1_s": max_after,
                    "mean_abs_div_after_1_s": mean_after,
                },
                "q3_flow_deflects_around_building": {
                    "answer": bool(q3),
                    "max_abs_vertical_speed_near_block_m_s": max_w,
                    "velocity_zero_inside_solid": zero_solid,
                    "vector_plot": str(plot_path),
                },
            },
        },
        "supplemental_robustness": None,
    }

    # Write the formal result before any exception is raised. Even a failed
    # spike must leave machine-readable evidence instead of terminal-only text.
    save_week1_result_json(
        report,
        result_json_path,
    )

    print("=" * 72)

    print(
        "WEEK-1 ROADMAP SPIKE — "
        "2D x-z SOR"
    )

    print("=" * 72)

    print(
        "grid                  : "
        "100 x 50 cells (x-z), ny=1"
    )

    print(
        f"spacing               : "
        f"dx={dx:.1f}, "
        f"dy={dy:.1f}, "
        f"dz={dz:.1f} m"
    )

    print(
        "SOR omega             : "
        "1.78"
    )

    print(
        "SOR tolerance         : "
        "1.0e-04"
    )

    print()

    print(
        "Q1 — SOR converges?"
    )

    print(
        f"  answer               : "
        f"{'YES' if q1 else 'NO'}"
    )

    print(
        f"  iterations           : "
        f"{result.iterations}"
    )

    print(
        f"  final sum|delta lam| : "
        f"{result.sor_residual:.6e}"
    )

    print()

    print(
        "Q2 — divergence below threshold "
        "in every air voxel?"
    )

    print(
        f"  max |div| before     : "
        f"{max_before:.6e} 1/s"
    )

    print(
        f"  max |div| after      : "
        f"{max_after:.6e} 1/s"
    )

    print(
        f"  mean |div| after     : "
        f"{mean_after:.6e} 1/s"
    )

    print(
        "  gate                 : "
        "< 1.0e-03 1/s"
    )

    print(
        f"  answer               : "
        f"{'YES' if q2 else 'NO'}"
    )

    print()

    print(
        "Q3 — flow deflects around the block?"
    )

    print(
        f"  max |w| near block   : "
        f"{max_w:.6f} m/s"
    )

    print(
        f"  velocity in solid=0  : "
        f"{'YES' if zero_solid else 'NO'}"
    )

    print(
        f"  answer               : "
        f"{'YES' if q3 else 'NO'}"
    )

    print(
        f"  vector plot          : "
        f"{plot_path}"
    )

    print()

    print(
        f"result JSON            : "
        f"{result_json_path}"
    )

    print()

    print(
        f"SPIKE RESULT           : "
        f"{'PASS' if formal_pass else 'FAIL'}"
    )

    print("=" * 72)

    if not formal_pass:
        raise RuntimeError(
            "week-1 SOR spike failed "
            "at least one ROADMAP gate"
        )

    # =========================================================
    # SUPPLEMENTAL ROBUSTNESS CASE
    # =========================================================

    (
        mu0,
        mv0,
        mw0,
        msolid,
        mdz,
        mdy,
        mdx,
    ) = build_week1_multi_obstacle_case()

    mair = ~msolid

    multi = project_mass_consistent(
        mu0,
        mv0,
        mw0,
        msolid,
        dx=mdx,
        dy=mdy,
        dz=mdz,
        omega=1.78,
        tolerance=1.0e-4,
        max_iter=10_000,
    )

    mbefore = float(
        np.max(
            np.abs(
                multi.divergence_before[mair]
            )
        )
    )

    mafter = float(
        np.max(
            np.abs(
                multi.divergence_after[mair]
            )
        )
    )

    mzero = bool(
        np.all(
            multi.u[msolid]
            == 0.0
        )
        and np.all(
            multi.v[msolid]
            == 0.0
        )
        and np.all(
            multi.w[msolid]
            == 0.0
        )
    )

    halos = (
        # Horizontal obstacle
        (
            slice(
                18,
                34,
            ),
            slice(None),
            slice(
                12,
                39,
            ),
        ),

        # Vertical obstacle
        (
            slice(
                6,
                44,
            ),
            slice(None),
            slice(
                43,
                59,
            ),
        ),

        # Rotated obstacle
        (
            slice(
                10,
                39,
            ),
            slice(None),
            slice(
                67,
                90,
            ),
        ),
    )

    local_w = [
        _max_local_vertical_speed(
            multi,
            msolid,
            halo,
        )
        for halo in halos
    ]

    mpass = (
        multi.sor_residual
        < 1.0e-4
        and mafter
        < 1.0e-3
        and mafter
        < mbefore
        and mzero
        and all(
            value > 1.0e-6
            for value in local_w
        )
    )

    multi_plot = save_week1_plot(
        multi,
        msolid,
        dx=mdx,
        dz=mdz,
        path=(
            figure_dir
            / "wind_sor_week1_interior_obstacles.png"
        ),
        title=(
            "Supplemental robustness: "
            "horizontal, vertical and rotated interior obstacles"
        ),
    )

    report["supplemental_robustness"] = {
        "status": (
            "PASS"
            if mpass
            else "FAIL"
        ),
        "solver": {
            "iterations": int(multi.iterations),
            "final_sum_abs_delta_lambda": float(
                multi.sor_residual
            ),
        },
        "max_abs_div_before_1_s": mbefore,
        "max_abs_div_after_1_s": mafter,
        "velocity_zero_inside_all_solids": mzero,
        "max_abs_vertical_speed_near_obstacles_m_s": [
            float(value)
            for value in local_w
        ],
        "vector_plot": str(multi_plot),
    }

    report["overall_status"] = (
        "PASS"
        if formal_pass and mpass
        else "FAIL"
    )

    save_week1_result_json(
        report,
        result_json_path,
    )

    print()

    print("-" * 72)

    print(
        "SUPPLEMENTAL ROBUSTNESS CHECK — "
        "THREE INTERIOR ORIENTATIONS"
    )

    print("-" * 72)

    print(
        "This does not replace the formal "
        "one-building ROADMAP gate above."
    )

    print(
        "Shapes                  : "
        "horizontal | vertical | rotated +35 deg"
    )

    print(
        f"SOR iterations           : "
        f"{multi.iterations}"
    )

    print(
        f"final sum|delta lam|     : "
        f"{multi.sor_residual:.6e}"
    )

    print(
        f"max |div| before         : "
        f"{mbefore:.6e} 1/s"
    )

    print(
        f"max |div| after          : "
        f"{mafter:.6e} 1/s"
    )

    print(
        f"velocity in all solids=0 : "
        f"{'YES' if mzero else 'NO'}"
    )

    print(
        "max |w| near obstacles  : "
        + ", ".join(
            f"{value:.6f}"
            for value in local_w
        )
        + " m/s"
    )

    print(
        f"vector plot              : "
        f"{multi_plot}"
    )

    print(
        f"ROBUSTNESS RESULT        : "
        f"{'PASS' if mpass else 'FAIL'}"
    )

    print("-" * 72)

    if not mpass:
        raise RuntimeError(
            "three-obstacle robustness check failed"
        )

    return result