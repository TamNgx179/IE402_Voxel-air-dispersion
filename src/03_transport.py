"""
Finite-volume advection-diffusion transport on a voxel grid.

Model
-----
Solves the scalar transport equation

    dC/dt + div(u C) - div(K grad C) = S

on the project's regular voxel grid, using

    advection  first-order UPWIND
    diffusion  central differences
    time       explicit (forward Euler)

Why upwind rather than central differencing
-------------------------------------------
A central difference for the advective term is second-order accurate but
UNBOUNDED: at high cell Peclet number it produces 2*dx oscillations and
NEGATIVE concentrations, which are not physical for a pollutant field.
First-order upwind is bounded, at the cost of numerical diffusion

    K_num ~ 0.5 * u * dx * (1 - Cr)

which is reported by `numerical_diffusion()` so the error can be quoted in
the report rather than hidden.

Why flux form
-------------
Fluxes are evaluated on cell FACES and differenced, so whatever leaves one
cell enters its neighbour exactly. Mass is therefore conserved to machine
precision, and `total_mass()` makes that checkable.

Array convention
----------------
All 3D arrays are [z, y, x], matching src/voxel/models.py.
Velocity components are CELL-CENTRED and averaged onto faces internally.
"""

from __future__ import annotations

from typing import Iterable

import numpy as np

# Axis index for each spatial direction, in the project's [z, y, x] order.
AXIS_Z = 0
AXIS_Y = 1
AXIS_X = 2


def _as_triplet(value: float | Iterable[float]) -> tuple[float, float, float]:
    """Accept a scalar or a (Kz, Ky, Kx) triplet and return a triplet."""

    if np.isscalar(value):
        return (float(value), float(value), float(value))

    values = tuple(float(item) for item in value)  # type: ignore[arg-type]

    if len(values) != 3:
        raise ValueError(
            "Expected a scalar or three values in (z, y, x) order."
        )

    return values


def _face_flux_divergence(
    concentration: np.ndarray,
    velocity_component: np.ndarray,
    diffusivity: float,
    spacing_m: float,
    axis: int,
    solid: np.ndarray | None,
    closed_lower_face: bool,
) -> np.ndarray:
    """
    Net outflow per unit volume along one axis, in flux form.

    Returns
    -------
    The quantity  ( F[i+1/2] - F[i-1/2] ) / spacing  for every cell, where F
    is the face-normal flux, positive in the +axis direction.

    Boundary treatment
    ------------------
    Domain faces are OPEN: material leaves freely and incoming air is clean
    (background concentration zero). `closed_lower_face` instead makes the
    first face zero-flux, which is how the ground is represented in z.

    Building faces carry zero flux, so air cannot pass through a wall.
    """

    n = concentration.shape[axis]

    if n < 2:
        raise ValueError("Each axis needs at least two cells.")

    # Move the working axis to the front so slicing stays readable.
    c = np.moveaxis(concentration, axis, 0)
    vel = np.moveaxis(velocity_component, axis, 0)

    solid_axis = None if solid is None else np.moveaxis(solid, axis, 0)

    flux = np.zeros((n + 1,) + c.shape[1:], dtype=c.dtype)

    # ---- interior faces: between cell i-1 (left) and cell i (right) -------
    c_left = c[:-1]
    c_right = c[1:]

    vel_face = 0.5 * (vel[:-1] + vel[1:])

    # Upwind: take the value from whichever side the flow comes FROM.
    advective = np.where(vel_face >= 0.0, vel_face * c_left, vel_face * c_right)

    diffusive = -diffusivity * (c_right - c_left) / spacing_m

    flux[1:-1] = advective + diffusive

    # ---- domain faces ------------------------------------------------------
    # Outflow carries material away; inflow brings clean air, so it adds none.
    flux[0] = np.where(vel[0] >= 0.0, 0.0, vel[0] * c[0])
    flux[-1] = np.where(vel[-1] >= 0.0, vel[-1] * c[-1], 0.0)

    if closed_lower_face:
        flux[0] = 0.0

    # ---- walls -------------------------------------------------------------
    if solid_axis is not None:
        blocked = solid_axis[:-1] | solid_axis[1:]
        flux[1:-1] = np.where(blocked, 0.0, flux[1:-1])

        flux[0] = np.where(solid_axis[0], 0.0, flux[0])
        flux[-1] = np.where(solid_axis[-1], 0.0, flux[-1])

    divergence = (flux[1:] - flux[:-1]) / spacing_m

    return np.moveaxis(divergence, 0, axis)


def transport_step(
    concentration: np.ndarray,
    velocity: tuple[np.ndarray, np.ndarray, np.ndarray],
    source: np.ndarray,
    diffusivity: float | Iterable[float],
    dt: float,
    *,
    dz_m: float = 1.0,
    dy_m: float = 1.0,
    dx_m: float = 1.0,
    solid: np.ndarray | None = None,
    ground_is_reflective: bool = True,
) -> np.ndarray:
    """
    Advance the concentration field by one explicit finite-volume step.

    Parameters
    ----------
    concentration:
        [z, y, x] field, kg/m^3.

    velocity:
        (w, v, u) cell-centred components in [z, y, x] ORDER, m/s.

    source:
        [z, y, x] emission rate, kg/m^3/s.

    diffusivity:
        Eddy diffusivity, m^2/s. Scalar, or (Kz, Ky, Kx).

    dt:
        Time step in seconds. Use `cfl_time_step()` to choose it.

    solid:
        Optional boolean [z, y, x] building mask. True marks a solid voxel.

    ground_is_reflective:
        Zero flux through the bottom face, i.e. no deposition.
    """

    if concentration.shape != source.shape:
        raise ValueError("concentration and source must have the same shape")

    if len(velocity) != 3:
        raise ValueError("velocity must be (w, v, u) in [z, y, x] order")

    for component in velocity:
        if component.shape != concentration.shape:
            raise ValueError("each velocity component must match concentration")

    if solid is not None and solid.shape != concentration.shape:
        raise ValueError("solid mask must match concentration")

    if dt <= 0.0:
        raise ValueError("dt must be positive")

    k_z, k_y, k_x = _as_triplet(diffusivity)

    spacing = (dz_m, dy_m, dx_m)
    diffusivities = (k_z, k_y, k_x)

    net_outflow = np.zeros_like(concentration)

    for axis, (spacing_m, k) in enumerate(zip(spacing, diffusivities)):
        net_outflow = net_outflow + _face_flux_divergence(
            concentration=concentration,
            velocity_component=velocity[axis],
            diffusivity=k,
            spacing_m=spacing_m,
            axis=axis,
            solid=solid,
            closed_lower_face=(axis == AXIS_Z and ground_is_reflective),
        )

    updated = concentration + dt * (source - net_outflow)

    if solid is not None:
        updated = np.where(solid, 0.0, updated)

    # Upwind in flux form is bounded; clip only to absorb round-off.
    return np.maximum(updated, 0.0)


def cfl_time_step(
    velocity: tuple[np.ndarray, np.ndarray, np.ndarray],
    diffusivity: float | Iterable[float],
    *,
    dz_m: float,
    dy_m: float,
    dx_m: float,
    courant: float = 0.5,
) -> float:
    """
    Largest stable explicit time step, times a safety factor.

    Two constraints apply and the smaller one wins:

        advective (Courant)   dt * ( |w|/dz + |v|/dy + |u|/dx ) <= 1
        diffusive (von Neumann)   dt <= 0.5 / ( Kz/dz^2 + Ky/dy^2 + Kx/dx^2 )

    `courant` scales the result; the project default is 0.5.
    """

    if not 0.0 < courant <= 1.0:
        raise ValueError("courant must be in (0, 1]")

    w, v, u = velocity

    advective_rate = (
        np.max(np.abs(w)) / dz_m
        + np.max(np.abs(v)) / dy_m
        + np.max(np.abs(u)) / dx_m
    )

    k_z, k_y, k_x = _as_triplet(diffusivity)

    diffusive_rate = k_z / dz_m**2 + k_y / dy_m**2 + k_x / dx_m**2

    limits = []

    if advective_rate > 0.0:
        limits.append(1.0 / advective_rate)

    if diffusive_rate > 0.0:
        limits.append(0.5 / diffusive_rate)

    if not limits:
        raise ValueError("A zero velocity and zero diffusivity impose no limit.")

    return courant * min(limits)


def courant_number(
    velocity: tuple[np.ndarray, np.ndarray, np.ndarray],
    dt: float,
    *,
    dz_m: float,
    dy_m: float,
    dx_m: float,
) -> float:
    """Courant number actually realised by a given time step."""

    w, v, u = velocity

    return float(
        dt
        * (
            np.max(np.abs(w)) / dz_m
            + np.max(np.abs(v)) / dy_m
            + np.max(np.abs(u)) / dx_m
        )
    )


def numerical_diffusion(
    speed_m_s: float,
    spacing_m: float,
    courant: float,
) -> float:
    """
    Artificial diffusivity introduced by first-order upwind, m^2/s.

        K_num ~ 0.5 * u * dx * (1 - Cr)

    Report this next to the physical eddy diffusivity. When the two are
    comparable, the plume is being spread by the SCHEME as much as by the
    atmosphere, and that belongs in the limitations section.
    """

    if not 0.0 <= courant <= 1.0:
        raise ValueError("courant must be in [0, 1]")

    return 0.5 * abs(speed_m_s) * spacing_m * (1.0 - courant)


def total_mass(
    concentration: np.ndarray,
    *,
    dz_m: float,
    dy_m: float,
    dx_m: float,
) -> float:
    """Total pollutant mass in the domain, kg. Used by the conservation check."""

    return float(np.sum(concentration) * dz_m * dy_m * dx_m)
