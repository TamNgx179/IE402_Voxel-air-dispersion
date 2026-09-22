"""Core numerical routines for the mass-consistent wind solver.

Convention
----------
Arrays are stored as:

    [z, y, x]

Velocity components are:

    u -> x direction
    v -> y direction
    w -> z direction
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


DEFAULT_OMEGA = 1.78
DEFAULT_TOLERANCE = 1.0e-4
DEFAULT_MAX_ITER = 10_000


@dataclass(frozen=True)
class SorResult:
    """Result returned by the SOR Poisson solver."""

    lam: np.ndarray
    iterations: int
    residual: float


@dataclass(frozen=True)
class WindResult:
    """Mass-consistent wind result."""

    u: np.ndarray
    v: np.ndarray
    w: np.ndarray

    lam: np.ndarray

    divergence_before: np.ndarray
    divergence_after: np.ndarray

    iterations: int
    sor_residual: float


def _check_spacing(
    dx: float,
    dy: float,
    dz: float,
) -> tuple[float, float, float]:
    """Validate grid spacing."""

    dx = float(dx)
    dy = float(dy)
    dz = float(dz)

    if min(dx, dy, dz) <= 0:
        raise ValueError(
            "dx, dy and dz must all be > 0"
        )

    return dx, dy, dz


def _check_fields(
    u,
    v,
    w,
    solid,
):
    """Validate wind and solid-mask arrays."""

    u = np.asarray(
        u,
        dtype=float,
    )

    v = np.asarray(
        v,
        dtype=float,
    )

    w = np.asarray(
        w,
        dtype=float,
    )

    solid = np.asarray(
        solid,
        dtype=bool,
    )

    if u.ndim != 3:
        raise ValueError(
            "velocity arrays must be 3D [z,y,x]"
        )

    if not (
        u.shape
        == v.shape
        == w.shape
        == solid.shape
    ):
        raise ValueError(
            "u, v, w and solid must have identical shapes"
        )

    if not (
        np.isfinite(u).all()
        and np.isfinite(v).all()
        and np.isfinite(w).all()
    ):
        raise ValueError(
            "velocity arrays must contain only finite values"
        )

    if not np.any(~solid):
        raise ValueError(
            "domain contains no air voxels"
        )

    return (
        u,
        v,
        w,
        solid,
    )


def _cell_to_faces(
    u,
    v,
    w,
    solid,
):
    """Convert cell-centred velocity to face-centred velocity.

    Faces between air and solid cells are set to zero so
    solid boundaries remain impermeable.
    """

    (
        u,
        v,
        w,
        solid,
    ) = _check_fields(
        u,
        v,
        w,
        solid,
    )

    nz, ny, nx = u.shape

    air = ~solid

    uf = np.zeros(
        (
            nz,
            ny,
            nx + 1,
        ),
        dtype=float,
    )

    vf = np.zeros(
        (
            nz,
            ny + 1,
            nx,
        ),
        dtype=float,
    )

    wf = np.zeros(
        (
            nz + 1,
            ny,
            nx,
        ),
        dtype=float,
    )

    # =========================================================
    # X faces
    # =========================================================

    uf[..., 0] = np.where(
        air[..., 0],
        u[..., 0],
        0.0,
    )

    uf[..., -1] = np.where(
        air[..., -1],
        u[..., -1],
        0.0,
    )

    if nx > 1:
        open_x = (
            air[..., :-1]
            & air[..., 1:]
        )

        uf[..., 1:-1] = np.where(
            open_x,
            0.5
            * (
                u[..., :-1]
                + u[..., 1:]
            ),
            0.0,
        )

    # =========================================================
    # Y faces
    # =========================================================

    if ny > 1:
        vf[:, 0, :] = np.where(
            air[:, 0, :],
            v[:, 0, :],
            0.0,
        )

        vf[:, -1, :] = np.where(
            air[:, -1, :],
            v[:, -1, :],
            0.0,
        )

        open_y = (
            air[:, :-1, :]
            & air[:, 1:, :]
        )

        vf[:, 1:-1, :] = np.where(
            open_y,
            0.5
            * (
                v[:, :-1, :]
                + v[:, 1:, :]
            ),
            0.0,
        )

    # =========================================================
    # Z faces
    # =========================================================

    if nz > 1:
        open_z = (
            air[:-1, :, :]
            & air[1:, :, :]
        )

        wf[1:-1, :, :] = np.where(
            open_z,
            0.5
            * (
                w[:-1, :, :]
                + w[1:, :, :]
            ),
            0.0,
        )

    # Top boundary remains open.
    wf[-1, :, :] = np.where(
        air[-1, :, :],
        w[-1, :, :],
        0.0,
    )

    # wf[0] intentionally stays zero:
    # impermeable ground.

    return (
        uf,
        vf,
        wf,
    )


def _divergence_faces(
    uf,
    vf,
    wf,
    *,
    dx: float,
    dy: float,
    dz: float,
):
    """Calculate finite-volume divergence from face velocities."""

    dx, dy, dz = _check_spacing(
        dx,
        dy,
        dz,
    )

    return (
        (
            uf[..., 1:]
            - uf[..., :-1]
        )
        / dx
        + (
            vf[:, 1:, :]
            - vf[:, :-1, :]
        )
        / dy
        + (
            wf[1:, :, :]
            - wf[:-1, :, :]
        )
        / dz
    )


def divergence(
    u,
    v,
    w,
    *,
    solid=None,
    dx: float | None = None,
    dy: float | None = None,
    dz: float | None = None,
    spacing: float | None = None,
):
    """Finite-volume divergence of a cell-centred wind field."""

    u = np.asarray(
        u,
        dtype=float,
    )

    if solid is None:
        solid = np.zeros(
            u.shape,
            dtype=bool,
        )

    if spacing is not None:
        if dx is None:
            dx = spacing

        if dy is None:
            dy = spacing

        if dz is None:
            dz = spacing

    if (
        dx is None
        or dy is None
        or dz is None
    ):
        raise ValueError(
            "pass dx, dy and dz explicitly"
        )

    uf, vf, wf = _cell_to_faces(
        u,
        v,
        w,
        solid,
    )

    return _divergence_faces(
        uf,
        vf,
        wf,
        dx=dx,
        dy=dy,
        dz=dz,
    )


def _connections(
    solid: np.ndarray,
):
    """Build air-to-air neighbour masks.

    Returned order:

        +x
        -x
        +y
        -y
        +z
        -z
    """

    air = ~solid

    nz, ny, nx = solid.shape

    xp = np.zeros_like(air)
    xm = np.zeros_like(air)

    yp = np.zeros_like(air)
    ym = np.zeros_like(air)

    zp = np.zeros_like(air)
    zm = np.zeros_like(air)

    if nx > 1:
        q = (
            air[..., :-1]
            & air[..., 1:]
        )

        xp[..., :-1] = q
        xm[..., 1:] = q

    if ny > 1:
        q = (
            air[:, :-1, :]
            & air[:, 1:, :]
        )

        yp[:, :-1, :] = q
        ym[:, 1:, :] = q

    if nz > 1:
        q = (
            air[:-1, :, :]
            & air[1:, :, :]
        )

        zp[:-1, :, :] = q
        zm[1:, :, :] = q

    return (
        xp,
        xm,
        yp,
        ym,
        zp,
        zm,
    )


def _shift(
    a: np.ndarray,
    axis: int,
    positive: bool,
):
    """Shift an array by one cell without wrap-around."""

    out = np.zeros_like(a)

    if axis == 2:
        if positive:
            out[..., :-1] = a[..., 1:]
        else:
            out[..., 1:] = a[..., :-1]

    elif axis == 1:
        if positive:
            out[:, :-1, :] = a[:, 1:, :]
        else:
            out[:, 1:, :] = a[:, :-1, :]

    elif axis == 0:
        if positive:
            out[:-1, :, :] = a[1:, :, :]
        else:
            out[1:, :, :] = a[:-1, :, :]

    else:
        raise ValueError(
            "axis must be 0, 1 or 2"
        )

    return out


def sor_poisson(
    rhs,
    *,
    solid=None,
    dx: float = 1.0,
    dy: float = 1.0,
    dz: float = 1.0,
    alpha1: float = 1.0,
    alpha2: float = 1.0,
    omega: float = DEFAULT_OMEGA,
    tolerance: float = DEFAULT_TOLERANCE,
    max_iter: int = DEFAULT_MAX_ITER,
) -> SorResult:
    """Solve the mass-consistency Poisson equation with red-black SOR."""

    rhs = np.asarray(
        rhs,
        dtype=float,
    )

    if (
        rhs.ndim != 3
        or not np.isfinite(rhs).all()
    ):
        raise ValueError(
            "rhs must be finite 3D [z,y,x]"
        )

    if solid is None:
        solid = np.zeros(
            rhs.shape,
            dtype=bool,
        )

    else:
        solid = np.asarray(
            solid,
            dtype=bool,
        )

        if solid.shape != rhs.shape:
            raise ValueError(
                "solid and rhs must have identical shapes"
            )

    dx, dy, dz = _check_spacing(
        dx,
        dy,
        dz,
    )

    alpha1 = float(alpha1)
    alpha2 = float(alpha2)

    omega = float(omega)
    tolerance = float(tolerance)
    max_iter = int(max_iter)

    if (
        alpha1 <= 0
        or alpha2 <= 0
    ):
        raise ValueError(
            "alpha1 and alpha2 must be > 0"
        )

    if not 0 < omega < 2:
        raise ValueError(
            "SOR omega must satisfy 0 < omega < 2"
        )

    if (
        tolerance <= 0
        or max_iter <= 0
    ):
        raise ValueError(
            "tolerance and max_iter must be > 0"
        )

    air = ~solid

    nz, ny, nx = rhs.shape

    lam = np.zeros_like(rhs)

    cx = (
        1.0 / dx**2
        if nx > 1
        else 0.0
    )

    cy = (
        1.0 / dy**2
        if ny > 1
        else 0.0
    )

    cz = (
        (alpha1 / alpha2) ** 2
        / dz**2
        if nz > 1
        else 0.0
    )

    (
        xp,
        xm,
        yp,
        ym,
        zp,
        zm,
    ) = _connections(
        solid
    )

    denominator = (
        cx
        * (
            xp.astype(float)
            + xm.astype(float)
        )
        + cy
        * (
            yp.astype(float)
            + ym.astype(float)
        )
        + cz
        * (
            zp.astype(float)
            + zm.astype(float)
        )
    )

    # External x/y/top:
    # lambda = 0 Dirichlet.
    #
    # Ground and solid walls:
    # zero normal derivative.

    if nx > 1:
        denominator[..., 0] += (
            cx * air[..., 0]
        )

        denominator[..., -1] += (
            cx * air[..., -1]
        )

    if ny > 1:
        denominator[:, 0, :] += (
            cy * air[:, 0, :]
        )

        denominator[:, -1, :] += (
            cy * air[:, -1, :]
        )

    if nz > 1:
        denominator[-1, :, :] += (
            cz * air[-1, :, :]
        )

    active = (
        air
        & (denominator > 0)
    )

    if not np.any(active):
        raise ValueError(
            "Poisson domain has no active air voxels"
        )

    zz, yy, xx = np.indices(
        rhs.shape
    )

    parity = (
        zz
        + yy
        + xx
    ) & 1

    residual = np.inf

    for iteration in range(
        1,
        max_iter + 1,
    ):
        residual = 0.0

        for colour in (
            0,
            1,
        ):
            neighbour_sum = (
                cx
                * xp
                * _shift(
                    lam,
                    2,
                    True,
                )
                + cx
                * xm
                * _shift(
                    lam,
                    2,
                    False,
                )
                + cy
                * yp
                * _shift(
                    lam,
                    1,
                    True,
                )
                + cy
                * ym
                * _shift(
                    lam,
                    1,
                    False,
                )
                + cz
                * zp
                * _shift(
                    lam,
                    0,
                    True,
                )
                + cz
                * zm
                * _shift(
                    lam,
                    0,
                    False,
                )
            )

            mask = (
                active
                & (parity == colour)
            )

            target = (
                neighbour_sum[mask]
                - rhs[mask]
            ) / denominator[mask]

            old = lam[mask].copy()

            lam[mask] = (
                (1.0 - omega)
                * old
                + omega
                * target
            )

            residual += float(
                np.abs(
                    lam[mask]
                    - old
                ).sum()
            )

        lam[solid] = 0.0

        if (
            not np.isfinite(residual)
            or not np.isfinite(lam).all()
        ):
            raise RuntimeError(
                "SOR became non-finite "
                f"at iteration {iteration}"
            )

        if residual < tolerance:
            return SorResult(
                lam=lam,
                iterations=iteration,
                residual=residual,
            )

    raise RuntimeError(
        "SOR did not converge within "
        f"{max_iter} iterations; "
        f"final residual={residual:.6e}, "
        f"tolerance={tolerance:.6e}"
    )


def _correct_faces(
    uf,
    vf,
    wf,
    lam,
    solid,
    *,
    dx,
    dy,
    dz,
    alpha1,
    alpha2,
):
    """Apply lambda-gradient correction to face velocities."""

    air = ~solid

    nz, ny, nx = lam.shape

    uf = uf.copy()
    vf = vf.copy()
    wf = wf.copy()

    fx = (
        1.0
        / (
            2.0
            * alpha1**2
            * dx
        )
    )

    fy = (
        1.0
        / (
            2.0
            * alpha1**2
            * dy
        )
    )

    fz = (
        1.0
        / (
            2.0
            * alpha2**2
            * dz
        )
    )

    # =========================================================
    # X correction
    # =========================================================

    if nx > 1:
        q = (
            air[..., :-1]
            & air[..., 1:]
        )

        uf[..., 1:-1] += np.where(
            q,
            (
                lam[..., 1:]
                - lam[..., :-1]
            )
            * fx,
            0.0,
        )

        uf[..., 0] += np.where(
            air[..., 0],
            lam[..., 0] * fx,
            0.0,
        )

        uf[..., -1] += np.where(
            air[..., -1],
            -lam[..., -1] * fx,
            0.0,
        )

        uf[..., 1:-1][~q] = 0.0

    # =========================================================
    # Y correction
    # =========================================================

    if ny > 1:
        q = (
            air[:, :-1, :]
            & air[:, 1:, :]
        )

        vf[:, 1:-1, :] += np.where(
            q,
            (
                lam[:, 1:, :]
                - lam[:, :-1, :]
            )
            * fy,
            0.0,
        )

        vf[:, 0, :] += np.where(
            air[:, 0, :],
            lam[:, 0, :] * fy,
            0.0,
        )

        vf[:, -1, :] += np.where(
            air[:, -1, :],
            -lam[:, -1, :] * fy,
            0.0,
        )

        vf[:, 1:-1, :][~q] = 0.0

    # =========================================================
    # Z correction
    # =========================================================

    if nz > 1:
        q = (
            air[:-1, :, :]
            & air[1:, :, :]
        )

        wf[1:-1, :, :] += np.where(
            q,
            (
                lam[1:, :, :]
                - lam[:-1, :, :]
            )
            * fz,
            0.0,
        )

        wf[-1, :, :] += np.where(
            air[-1, :, :],
            -lam[-1, :, :] * fz,
            0.0,
        )

        wf[1:-1, :, :][~q] = 0.0

    # Ground remains impermeable.
    wf[0, :, :] = 0.0

    return (
        uf,
        vf,
        wf,
    )


def _faces_to_cells(
    uf,
    vf,
    wf,
    solid,
):
    """Convert corrected face velocities back to cell centres."""

    u = 0.5 * (
        uf[..., :-1]
        + uf[..., 1:]
    )

    v = 0.5 * (
        vf[:, :-1, :]
        + vf[:, 1:, :]
    )

    w = 0.5 * (
        wf[:-1, :, :]
        + wf[1:, :, :]
    )

    u[solid] = 0.0
    v[solid] = 0.0
    w[solid] = 0.0

    return (
        u,
        v,
        w,
    )


def project_mass_consistent(
    u0,
    v0,
    w0,
    solid,
    *,
    dx: float,
    dy: float,
    dz: float,
    alpha1: float = 1.0,
    alpha2: float = 1.0,
    omega: float = DEFAULT_OMEGA,
    tolerance: float = DEFAULT_TOLERANCE,
    max_iter: int = DEFAULT_MAX_ITER,
) -> WindResult:
    """Project an initial wind field onto a mass-consistent field."""

    (
        u0,
        v0,
        w0,
        solid,
    ) = _check_fields(
        u0,
        v0,
        w0,
        solid,
    )

    dx, dy, dz = _check_spacing(
        dx,
        dy,
        dz,
    )

    uf, vf, wf = _cell_to_faces(
        u0,
        v0,
        w0,
        solid,
    )

    div_before = _divergence_faces(
        uf,
        vf,
        wf,
        dx=dx,
        dy=dy,
        dz=dz,
    )

    # QES mass-consistent formulation:
    #
    # R = -2 * alpha1^2 * div(initial wind)

    rhs = (
        -2.0
        * alpha1**2
        * div_before
    )

    rhs[solid] = 0.0

    sor = sor_poisson(
        rhs,
        solid=solid,
        dx=dx,
        dy=dy,
        dz=dz,
        alpha1=alpha1,
        alpha2=alpha2,
        omega=omega,
        tolerance=tolerance,
        max_iter=max_iter,
    )

    ufc, vfc, wfc = _correct_faces(
        uf,
        vf,
        wf,
        sor.lam,
        solid,
        dx=dx,
        dy=dy,
        dz=dz,
        alpha1=alpha1,
        alpha2=alpha2,
    )

    div_after = _divergence_faces(
        ufc,
        vfc,
        wfc,
        dx=dx,
        dy=dy,
        dz=dz,
    )

    u, v, w = _faces_to_cells(
        ufc,
        vfc,
        wfc,
        solid,
    )

    return WindResult(
        u=u,
        v=v,
        w=w,
        lam=sor.lam,
        divergence_before=div_before,
        divergence_after=div_after,
        iterations=sor.iterations,
        sor_residual=sor.residual,
    )


def apply_correction(
    u0,
    v0,
    w0,
    lam,
    *,
    dx: float,
    dy: float,
    dz: float,
    solid=None,
    alpha1: float = 1.0,
    alpha2: float = 1.0,
):
    """Apply the solved correction using keyword-only grid spacing.

    Grid spacing follows the same public API convention as
    :func:`project_mass_consistent`: ``dx``, ``dy``, ``dz``. Requiring
    keywords prevents anisotropic grids from silently swapping x and z.
    """

    u0 = np.asarray(
        u0,
        dtype=float,
    )

    if solid is None:
        solid = np.zeros(
            u0.shape,
            dtype=bool,
        )

    solid = np.asarray(
        solid,
        dtype=bool,
    )

    uf, vf, wf = _cell_to_faces(
        u0,
        v0,
        w0,
        solid,
    )

    uf, vf, wf = _correct_faces(
        uf,
        vf,
        wf,
        np.asarray(
            lam,
            dtype=float,
        ),
        solid,
        dx=dx,
        dy=dy,
        dz=dz,
        alpha1=alpha1,
        alpha2=alpha2,
    )

    return _faces_to_cells(
        uf,
        vf,
        wf,
        solid,
    )


def power_law_profile(
    z_m,
    *,
    u_ref_m_s: float,
    z_ref_m: float,
    exponent: float,
):
    """Create the power-law inflow profile used by the wind spike."""

    z_m = np.asarray(
        z_m,
        dtype=float,
    )

    if np.any(z_m <= 0):
        raise ValueError(
            "z_m must be > 0"
        )

    if (
        u_ref_m_s < 0
        or z_ref_m <= 0
        or exponent < 0
    ):
        raise ValueError(
            "invalid power-law parameters"
        )

    return (
        float(u_ref_m_s)
        * (
            z_m
            / float(z_ref_m)
        )
        ** float(exponent)
    )