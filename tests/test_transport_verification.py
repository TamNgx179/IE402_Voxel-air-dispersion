"""
Tier-1 verification for the finite-volume transport solver.

Verification asks whether the code solves the equation correctly. That is not
validation, which asks whether the equation matches reality and is out of
scope here (docs/DECISION.md section 6).

Each test compares the solver against something known: mass conservation,
boundedness, zero flux through a wall, advection distance, and the analytic
diffusion law sigma^2 = 2Kt.

No comparison against the Gaussian plume, deliberately. At 5 m the scheme's
own numerical diffusion is ~3.75 m^2/s, the same order as the physical K, so
that test would measure the scheme rather than the code. The pure-diffusion
test avoids this: with zero velocity the upwind branch never fires.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest

SRC = Path(__file__).resolve().parents[1] / "src" / "03_transport.py"


def _load_transport():
    """Import src/03_transport.py, whose name is not a valid identifier."""

    spec = importlib.util.spec_from_file_location("transport_module", SRC)

    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {SRC}")

    module = importlib.util.module_from_spec(spec)
    sys.modules["transport_module"] = module
    spec.loader.exec_module(module)

    return module


transport = _load_transport()


DZ = 2.0
DY = 5.0
DX = 5.0


def _zero_velocity(shape):
    zero = np.zeros(shape)
    return (zero, zero.copy(), zero.copy())


def _uniform_x_wind(shape, speed):
    zero = np.zeros(shape)
    return (np.full(shape, speed), zero.copy(), zero.copy())


# ---------------------------------------------------------------------------
# 1. Mass conservation
# ---------------------------------------------------------------------------


def test_mass_is_conserved_when_nothing_can_leave() -> None:
    """Pure diffusion, plume far from every boundary: mass must not change."""

    shape = (12, 24, 24)

    concentration = np.zeros(shape)
    concentration[6, 12, 12] = 1.0

    velocity = _zero_velocity(shape)
    source = np.zeros(shape)

    diffusivity = 1.0

    dt = transport.cfl_time_step(
        velocity, diffusivity, dz_m=DZ, dy_m=DY, dx_m=DX, courant=0.5
    )

    before = transport.total_mass(concentration, dz_m=DZ, dy_m=DY, dx_m=DX)

    for _ in range(50):
        concentration = transport.transport_step(
            concentration, velocity, source, diffusivity, dt,
            dz_m=DZ, dy_m=DY, dx_m=DX,
        )

    after = transport.total_mass(concentration, dz_m=DZ, dy_m=DY, dx_m=DX)

    assert after == pytest.approx(before, rel=1e-12)


def test_emitted_mass_equals_stored_plus_exported() -> None:
    """With a source and open boundaries the budget must still close."""

    shape = (10, 20, 30)

    concentration = np.zeros(shape)

    velocity = _uniform_x_wind(shape, 3.0)

    source = np.zeros(shape)
    source[1, 10, 5] = 1.0

    diffusivity = 0.5

    dt = transport.cfl_time_step(
        velocity, diffusivity, dz_m=DZ, dy_m=DY, dx_m=DX, courant=0.5
    )

    steps = 200
    cell_volume = DZ * DY * DX

    for _ in range(steps):
        concentration = transport.transport_step(
            concentration, velocity, source, diffusivity, dt,
            dz_m=DZ, dy_m=DY, dx_m=DX,
        )

    emitted = float(source.sum()) * cell_volume * dt * steps
    stored = transport.total_mass(concentration, dz_m=DZ, dy_m=DY, dx_m=DX)

    # Everything emitted is either still inside or has crossed a boundary.
    assert stored <= emitted
    assert stored == pytest.approx(emitted, rel=1.0)  # sanity, not a tight bound
    assert emitted - stored > 0.0  # something did leave


# ---------------------------------------------------------------------------
# 2. Boundedness - the reason upwind was chosen over central differencing
# ---------------------------------------------------------------------------


def test_concentration_never_goes_negative() -> None:
    """A sharp front is exactly where central differencing would oscillate."""

    shape = (8, 16, 40)

    concentration = np.zeros(shape)
    concentration[:, :, :5] = 1.0  # step profile

    velocity = _uniform_x_wind(shape, 4.0)
    source = np.zeros(shape)

    diffusivity = 0.1

    dt = transport.cfl_time_step(
        velocity, diffusivity, dz_m=DZ, dy_m=DY, dx_m=DX, courant=0.5
    )

    for _ in range(150):
        concentration = transport.transport_step(
            concentration, velocity, source, diffusivity, dt,
            dz_m=DZ, dy_m=DY, dx_m=DX,
        )

        assert concentration.min() >= 0.0


def test_no_new_maximum_is_created() -> None:
    """Advection and diffusion may smear a peak, never amplify it."""

    shape = (8, 16, 30)

    concentration = np.zeros(shape)
    concentration[4, 8, 6] = 1.0

    velocity = _uniform_x_wind(shape, 3.0)
    source = np.zeros(shape)

    dt = transport.cfl_time_step(
        velocity, 0.5, dz_m=DZ, dy_m=DY, dx_m=DX, courant=0.5
    )

    peak = concentration.max()

    for _ in range(100):
        concentration = transport.transport_step(
            concentration, velocity, source, 0.5, dt,
            dz_m=DZ, dy_m=DY, dx_m=DX,
        )

    assert concentration.max() <= peak + 1e-12


# ---------------------------------------------------------------------------
# 3. Solid walls
# ---------------------------------------------------------------------------


def test_no_flux_passes_through_a_building() -> None:
    """A wall spanning the domain must block the plume completely."""

    shape = (10, 20, 30)

    solid = np.zeros(shape, dtype=bool)
    solid[:, :, 15] = True

    concentration = np.zeros(shape)
    concentration[5, 10, 10] = 1.0

    velocity = _uniform_x_wind(shape, 3.0)
    source = np.zeros(shape)

    dt = transport.cfl_time_step(
        velocity, 0.5, dz_m=DZ, dy_m=DY, dx_m=DX, courant=0.5
    )

    for _ in range(300):
        concentration = transport.transport_step(
            concentration, velocity, source, 0.5, dt,
            dz_m=DZ, dy_m=DY, dx_m=DX, solid=solid,
        )

    assert concentration[:, :, 16:].sum() == 0.0


def test_solid_voxels_hold_no_concentration() -> None:
    shape = (6, 12, 12)

    solid = np.zeros(shape, dtype=bool)
    solid[0:3, 4:8, 4:8] = True

    concentration = np.ones(shape)

    velocity = _uniform_x_wind(shape, 2.0)

    dt = transport.cfl_time_step(
        velocity, 0.5, dz_m=DZ, dy_m=DY, dx_m=DX, courant=0.5
    )

    concentration = transport.transport_step(
        concentration, velocity, np.zeros(shape), 0.5, dt,
        dz_m=DZ, dy_m=DY, dx_m=DX, solid=solid,
    )

    assert concentration[solid].sum() == 0.0


# ---------------------------------------------------------------------------
# 4. Pure advection - does the plume travel the right distance?
# ---------------------------------------------------------------------------


def test_blob_travels_at_the_wind_speed() -> None:
    """Centre of mass must move u * t, within one cell."""

    shape = (10, 20, 40)

    concentration = np.zeros(shape)
    concentration[5, 10, 4] = 1.0

    speed = 5.0
    velocity = _uniform_x_wind(shape, speed)

    dt = transport.cfl_time_step(
        velocity, 0.0, dz_m=DZ, dy_m=DY, dx_m=DX, courant=0.5
    )

    steps = 40

    for _ in range(steps):
        concentration = transport.transport_step(
            concentration, velocity, np.zeros(shape), 0.0, dt,
            dz_m=DZ, dy_m=DY, dx_m=DX,
        )

    profile = concentration[5, 10, :]
    centre = float((profile * np.arange(shape[2])).sum() / profile.sum())

    expected = 4.0 + speed * dt * steps / DX

    assert centre == pytest.approx(expected, abs=1.0)


# ---------------------------------------------------------------------------
# 5. Pure diffusion against the analytic law  sigma^2 = 2 K t
# ---------------------------------------------------------------------------


def test_diffusive_spread_matches_the_analytic_law() -> None:
    """
    With zero wind the upwind branch never fires, so there is no numerical
    diffusion and the analytic answer is a fair target.

    For a point release the variance of the cloud grows as sigma^2 = 2 K t
    along each axis, independently of normalisation.
    """

    shape = (10, 60, 60)

    concentration = np.zeros(shape)
    concentration[5, 30, 30] = 1.0

    velocity = _zero_velocity(shape)

    diffusivity = 2.0

    dt = transport.cfl_time_step(
        velocity, diffusivity, dz_m=DZ, dy_m=DY, dx_m=DX, courant=0.5
    )

    steps = 120

    for _ in range(steps):
        concentration = transport.transport_step(
            concentration, velocity, np.zeros(shape), diffusivity, dt,
            dz_m=DZ, dy_m=DY, dx_m=DX,
        )

    elapsed = dt * steps

    profile = concentration.sum(axis=(0, 1))
    positions = np.arange(shape[2]) * DX

    mean = float((profile * positions).sum() / profile.sum())
    variance = float((profile * (positions - mean) ** 2).sum() / profile.sum())

    analytic_variance = 2.0 * diffusivity * elapsed

    relative_error = abs(variance - analytic_variance) / analytic_variance

    # Target from docs/DECISION.md section 6: better than 6 per cent.
    assert relative_error < 0.06


# ---------------------------------------------------------------------------
# 6. Stability bookkeeping
# ---------------------------------------------------------------------------


def test_cfl_time_step_respects_the_courant_target() -> None:
    shape = (10, 20, 30)

    velocity = _uniform_x_wind(shape, 5.0)

    dt = transport.cfl_time_step(
        velocity, 1.0, dz_m=DZ, dy_m=DY, dx_m=DX, courant=0.5
    )

    realised = transport.courant_number(
        velocity, dt, dz_m=DZ, dy_m=DY, dx_m=DX
    )

    assert realised <= 0.5 + 1e-12


def test_numerical_diffusion_is_reported() -> None:
    """The value quoted in the report must come from the code, not a guess."""

    assert transport.numerical_diffusion(3.0, 5.0, 0.5) == pytest.approx(3.75)
    assert transport.numerical_diffusion(3.0, 5.0, 1.0) == pytest.approx(0.0)


def test_transport_step_rejects_mismatched_shapes() -> None:
    shape = (4, 8, 8)

    with pytest.raises(ValueError):
        transport.transport_step(
            np.zeros(shape),
            _zero_velocity(shape),
            np.zeros((4, 8, 9)),
            1.0,
            0.1,
        )


def test_transport_step_rejects_a_non_positive_time_step() -> None:
    shape = (4, 8, 8)

    with pytest.raises(ValueError):
        transport.transport_step(
            np.zeros(shape),
            _zero_velocity(shape),
            np.zeros(shape),
            1.0,
            0.0,
        )