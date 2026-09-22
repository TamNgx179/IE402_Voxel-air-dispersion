"""Integration tests between the wind solver and transport solver.

These tests protect the shared velocity convention across module boundaries:

    (u, v, w) = (x, y, z)

Arrays themselves are stored as [z, y, x]. The distinction matters: a module
that accidentally interprets the tuple as array-axis order (w, v, u) can pass
its own unit tests while rotating a physically x-directed wind into z when the
modules are connected.
"""

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

TRANSPORT_PATH = (
    ROOT
    / "src"
    / "03_transport.py"
)


def _load_module(
    module_name: str,
    path: Path,
):
    """Load a source file whose filename is not a valid Python identifier."""

    spec = importlib.util.spec_from_file_location(
        module_name,
        path,
    )

    if (
        spec is None
        or spec.loader is None
    ):
        raise ImportError(
            f"cannot load {path}"
        )

    module = importlib.util.module_from_spec(
        spec
    )

    sys.modules[
        module_name
    ] = module

    spec.loader.exec_module(
        module
    )

    return module


wind = _load_module(
    "wind_transport_wind",
    WIND_PATH,
)

transport = _load_module(
    "wind_transport_transport",
    TRANSPORT_PATH,
)


DZ = 2.0
DY = 5.0
DX = 5.0


def _centre_of_mass(
    concentration: np.ndarray,
) -> tuple[
    float,
    float,
    float,
]:
    """Return plume centre of mass in index coordinates as (z, y, x)."""

    total = float(
        concentration.sum()
    )

    if total <= 0.0:
        raise ValueError(
            "concentration must contain positive mass"
        )

    z_index = np.arange(
        concentration.shape[0],
        dtype=float,
    )[:, None, None]

    y_index = np.arange(
        concentration.shape[1],
        dtype=float,
    )[None, :, None]

    x_index = np.arange(
        concentration.shape[2],
        dtype=float,
    )[None, None, :]

    z_centre = float(
        (
            concentration
            * z_index
        ).sum()
        / total
    )

    y_centre = float(
        (
            concentration
            * y_index
        ).sum()
        / total
    )

    x_centre = float(
        (
            concentration
            * x_index
        ).sum()
        / total
    )

    return (
        z_centre,
        y_centre,
        x_centre,
    )


def test_x_wind_from_wind_solver_moves_plume_only_along_x() -> None:
    """A clear +x wind from the wind solver must move smoke in +x.

    This is intentionally an integration test. It passes the WindResult tuple
    directly into transport without reordering components in the test.

    If one module changes back to (w, v, u) while the other remains
    (u, v, w), this test fails by showing motion on the wrong physical axis.
    """

    shape = (
        9,
        11,
        40,
    )

    solid = np.zeros(
        shape,
        dtype=bool,
    )

    speed_m_s = 4.0

    # Shared physical convention:
    #
    # u -> x
    # v -> y
    # w -> z
    #
    # This case deliberately contains ONLY x-directed wind.
    u0 = np.full(
        shape,
        speed_m_s,
        dtype=float,
    )

    v0 = np.zeros(
        shape,
        dtype=float,
    )

    w0 = np.zeros(
        shape,
        dtype=float,
    )

    # ---------------------------------------------------------
    # WIND MODULE
    # ---------------------------------------------------------

    wind_result = wind.project_mass_consistent(
        u0,
        v0,
        w0,
        solid,
        dx=DX,
        dy=DY,
        dz=DZ,
    )

    # The output of the wind module must preserve the physical
    # meaning of each component.
    assert np.allclose(
        wind_result.u,
        speed_m_s,
    )

    assert np.allclose(
        wind_result.v,
        0.0,
    )

    assert np.allclose(
        wind_result.w,
        0.0,
    )

    # ---------------------------------------------------------
    # INITIAL SMOKE
    # ---------------------------------------------------------

    concentration = np.zeros(
        shape,
        dtype=float,
    )

    start = (
        4,
        5,
        6,
    )

    concentration[
        start
    ] = 1.0

    source = np.zeros(
        shape,
        dtype=float,
    )

    # ---------------------------------------------------------
    # IMPORTANT INTEGRATION POINT
    # ---------------------------------------------------------
    #
    # Do NOT reorder components here.
    #
    # Wind output goes directly into transport using the shared
    # convention:
    #
    #     (u, v, w)
    #
    velocity = (
        wind_result.u,
        wind_result.v,
        wind_result.w,
    )

    dt = transport.cfl_time_step(
        velocity,
        0.0,
        dz_m=DZ,
        dy_m=DY,
        dx_m=DX,
        courant=0.5,
    )

    steps = 20

    (
        before_z,
        before_y,
        before_x,
    ) = _centre_of_mass(
        concentration
    )

    # ---------------------------------------------------------
    # TRANSPORT MODULE
    # ---------------------------------------------------------

    for _ in range(steps):
        concentration = transport.transport_step(
            concentration,
            velocity,
            source,
            0.0,
            dt,
            dz_m=DZ,
            dy_m=DY,
            dx_m=DX,
            solid=solid,
        )

    (
        after_z,
        after_y,
        after_x,
    ) = _centre_of_mass(
        concentration
    )

    expected_x = (
        before_x
        + speed_m_s
        * dt
        * steps
        / DX
    )

    # ---------------------------------------------------------
    # PHYSICAL ASSERTIONS
    # ---------------------------------------------------------

    # Smoke must move in +x.
    assert after_x == pytest.approx(
        expected_x,
        abs=0.25,
    )

    assert (
        after_x
        > before_x + 1.0
    )

    # There is no y-directed wind.
    assert after_y == pytest.approx(
        before_y,
        abs=1.0e-12,
    )

    # There is no z-directed wind.
    assert after_z == pytest.approx(
        before_z,
        abs=1.0e-12,
    )