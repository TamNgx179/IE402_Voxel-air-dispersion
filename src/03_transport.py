"""
Finite-volume advection-diffusion transport on a voxel grid.

Solves  dC/dt + div(uC) - div(K grad C) = S  with first-order upwind
advection, central diffusion and explicit time stepping.

Upwind, not central differencing: central is unbounded and gives negative
concentrations at a sharp front. The cost is numerical diffusion,
K_num ~ 0.5*u*dx*(1-Cr), reported by numerical_diffusion().

Flux form: fluxes are taken on cell faces and differenced, so mass is
conserved to machine precision. Check it with total_mass().

All 3D arrays are [z, y, x]. Velocity components always follow the shared
project convention (u, v, w) = (x, y, z); they are mapped to array axes
internally before fluxes are computed.
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
    Net outflow per unit volume along one axis: (F[i+1/2] - F[i-1/2]) / spacing.

    Domain faces are open, with clean inflow. `closed_lower_face` makes the
    first face zero-flux, which is how the ground is represented in z.
    Building faces carry zero flux, so air cannot pass through a wall.
    """

    n = concentration.shape[axis]

    # Move the working axis to the front so slicing stays readable.
    c = np.moveaxis(concentration, axis, 0)
    vel = np.moveaxis(velocity_component, axis, 0)

    solid_axis = None if solid is None else np.moveaxis(solid, axis, 0)

    flux = np.zeros((n + 1,) + c.shape[1:], dtype=c.dtype)

    # ---- interior faces: between cell i-1 (left) and cell i (right) -------
    # An axis one cell thick has no interior face. That is the 2D-slice case
    # and is legitimate, so skip rather than refuse.
    if n >= 2:
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
        if n >= 2:
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

    concentration  [z, y, x], kg/m^3
    velocity       (u, v, w) cell-centred, where u->x, v->y, w->z, m/s
    source         [z, y, x] emission rate, kg/m^3/s
    diffusivity    m^2/s; scalar or (Kz, Ky, Kx)
    dt             seconds; choose it with cfl_time_step()
    solid          optional [z, y, x] bool mask, True = building
    """

    if concentration.shape != source.shape:
        raise ValueError("concentration and source must have the same shape")

    if len(velocity) != 3:
        raise ValueError("velocity must be (u, v, w) with u->x, v->y, w->z")

    for component in velocity:
        if component.shape != concentration.shape:
            raise ValueError("each velocity component must match concentration")

    if solid is not None and solid.shape != concentration.shape:
        raise ValueError("solid mask must match concentration")

    if dt <= 0.0:
        raise ValueError("dt must be positive")

    k_z, k_y, k_x = _as_triplet(diffusivity)

    u, v, w = velocity

    # Arrays are stored [z, y, x], but velocity tuples use the physical
    # component convention (u, v, w) = (x, y, z). Map components to array
    # axes explicitly so storage order can never silently redefine meaning.
    axis_components = (w, v, u)
    spacing = (dz_m, dy_m, dx_m)
    diffusivities = (k_z, k_y, k_x)

    net_outflow = np.zeros_like(concentration)

    for axis, (velocity_component, spacing_m, k) in enumerate(
        zip(axis_components, spacing, diffusivities)
    ):
        net_outflow = net_outflow + _face_flux_divergence(
            concentration=concentration,
            velocity_component=velocity_component,
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

    Velocity follows the project convention (u, v, w) = (x, y, z).
    Two limits, smaller wins: Courant dt*(|u|/dx + |v|/dy + |w|/dz) <= 1,
    and von Neumann dt <= 0.5 / (Kz/dz^2 + Ky/dy^2 + Kx/dx^2).
    """

    if not 0.0 < courant <= 1.0:
        raise ValueError("courant must be in (0, 1]")

    u, v, w = velocity

    advective_rate = (
        np.max(np.abs(u)) / dx_m
        + np.max(np.abs(v)) / dy_m
        + np.max(np.abs(w)) / dz_m
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

    u, v, w = velocity

    return float(
        dt
        * (
            np.max(np.abs(u)) / dx_m
            + np.max(np.abs(v)) / dy_m
            + np.max(np.abs(w)) / dz_m
        )
    )


def numerical_diffusion(
    speed_m_s: float,
    spacing_m: float,
    courant: float,
) -> float:
    """
    Artificial diffusivity from first-order upwind: 0.5*u*dx*(1-Cr), m^2/s.

    Report it next to the physical K. When the two are comparable, the plume
    is spread by the scheme as much as by the atmosphere.
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