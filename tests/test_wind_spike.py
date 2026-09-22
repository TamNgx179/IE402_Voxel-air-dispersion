"""Tests for the ROADMAP Week-1 wind/SOR spike."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest


ROOT = Path(__file__).resolve().parents[1]

WIND_PATH = (
    ROOT
    / "src"
    / "02_wind.py"
)

spec = importlib.util.spec_from_file_location(
    "wind_entry",
    WIND_PATH,
)

wind = importlib.util.module_from_spec(
    spec
)

sys.modules[
    "wind_entry"
] = wind

assert spec.loader is not None

spec.loader.exec_module(
    wind
)


@pytest.fixture(scope="module")
def spike():
    (
        u0,
        v0,
        w0,
        solid,
        dz,
        dy,
        dx,
    ) = wind.build_week1_spike_case()

    result = wind.project_mass_consistent(
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

    return (
        result,
        solid,
    )


@pytest.fixture(scope="module")
def multi_spike():
    (
        u0,
        v0,
        w0,
        solid,
        dz,
        dy,
        dx,
    ) = wind.build_week1_multi_obstacle_case()

    result = wind.project_mass_consistent(
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

    return (
        result,
        solid,
    )


def test_week1_sor_converges(
    spike,
):
    result, _ = spike

    assert (
        result.iterations
        < 10_000
    )

    assert (
        result.sor_residual
        < 1.0e-4
    )


def test_week1_divergence_below_gate(
    spike,
):
    result, solid = spike

    air = ~solid

    before = np.max(
        np.abs(
            result.divergence_before[air]
        )
    )

    after = np.max(
        np.abs(
            result.divergence_after[air]
        )
    )

    assert before > 1.0e-3

    assert after < 1.0e-3

    assert after < before


def test_week1_velocity_zero_inside_building(
    spike,
):
    result, solid = spike

    assert np.all(
        result.u[solid]
        == 0.0
    )

    assert np.all(
        result.v[solid]
        == 0.0
    )

    assert np.all(
        result.w[solid]
        == 0.0
    )


def test_week1_flow_deflects_around_building(
    spike,
):
    result, solid = spike

    air = ~solid

    halo = np.zeros_like(
        solid
    )

    halo[
        0:20,
        :,
        40:61,
    ] = True

    halo &= air

    assert (
        np.max(
            np.abs(
                result.w[halo]
            )
        )
        > 1.0e-3
    )


def test_one_cell_y_axis_is_supported(
    spike,
):
    result, _ = spike

    assert (
        result.u.shape[1]
        == 1
    )

    assert (
        result.v.shape[1]
        == 1
    )

    assert (
        result.w.shape[1]
        == 1
    )

    assert np.allclose(
        result.v,
        0.0,
    )


def test_unconverged_sor_raises_with_residual():
    (
        u0,
        v0,
        w0,
        solid,
        dz,
        dy,
        dx,
    ) = wind.build_week1_spike_case()

    div0 = wind.divergence(
        u0,
        v0,
        w0,
        solid=solid,
        dx=dx,
        dy=dy,
        dz=dz,
    )

    rhs = (
        -2.0
        * div0
    )

    rhs[solid] = 0.0

    with pytest.raises(
        RuntimeError,
        match="residual",
    ):
        wind.sor_poisson(
            rhs,
            solid=solid,
            dx=dx,
            dy=dy,
            dz=dz,
            omega=1.78,
            tolerance=1.0e-20,
            max_iter=1,
        )


def test_multi_obstacle_robustness_converges_and_reduces_divergence(
    multi_spike,
):
    result, solid = multi_spike

    air = ~solid

    before = np.max(
        np.abs(
            result.divergence_before[air]
        )
    )

    after = np.max(
        np.abs(
            result.divergence_after[air]
        )
    )

    assert (
        result.iterations
        < 10_000
    )

    assert (
        result.sor_residual
        < 1.0e-4
    )

    assert after < 1.0e-3

    assert after < before


def test_multi_obstacle_velocity_zero_in_all_solids(
    multi_spike,
):
    result, solid = multi_spike

    assert np.all(
        result.u[solid]
        == 0.0
    )

    assert np.all(
        result.v[solid]
        == 0.0
    )

    assert np.all(
        result.w[solid]
        == 0.0
    )


def test_multi_obstacles_are_detached_and_have_three_orientations():
    (
        _,
        _,
        _,
        solid,
        dz,
        _,
        dx,
    ) = wind.build_week1_multi_obstacle_case()

    # Supplemental obstacles must NOT touch the ground.
    assert not np.any(
        solid[
            0,
            :,
            :,
        ]
    )

    def is_solid(
        x_m: float,
        z_m: float,
    ) -> bool:
        ix = int(
            x_m // dx
        )

        iz = int(
            z_m // dz
        )

        return bool(
            solid[
                iz,
                0,
                ix,
            ]
        )

    # Horizontal obstacle centre.
    assert is_solid(
        125.0,
        52.0,
    )

    # Vertical obstacle centre.
    assert is_solid(
        255.0,
        50.0,
    )

    # Rotated obstacle centre.
    assert is_solid(
        390.0,
        48.0,
    )

    # Rotated obstacle must occupy cells
    # displaced in both x and z.
    assert np.any(
        solid[
            28:36,
            0,
            76:88,
        ]
    )


def test_each_of_three_obstacles_causes_local_deflection(
    multi_spike,
):
    result, solid = multi_spike

    air = ~solid

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

    for halo in halos:
        local_air = air[halo]

        local_w = np.abs(
            result.w[halo]
        )

        assert np.any(
            local_air
        )

        assert (
            np.max(
                local_w[
                    local_air
                ]
            )
            > 1.0e-3
        )