"""Run controlled scientific experiments with the production FV operators."""
import numpy as np

from src.solver import TRANSPORT, SparseFVStepper


def stable_dt(wind, diffusivity, spacing):
    dz, dy, dx = spacing
    return TRANSPORT.cfl_time_step_faces(
        (wind.uf, wind.vf, wind.wf), diffusivity, dz_m=dz, dy_m=dy, dx_m=dx, courant=0.5,
    )


def mixing_protocol(wind, diffusivity, spacing):
    """Keep horizontal mixing fixed and use the strictest variant's CFL limit.

    FV coefficients are ordered z, y, x. Choosing a separate step for every
    vertical factor would confound the mixing comparison with time error.
    """
    if not np.isfinite(diffusivity) or diffusivity <= 0:
        raise ValueError('diffusivity must be positive and finite')
    variants = {factor: (factor * diffusivity, diffusivity, diffusivity)
                for factor in (0.5, 1.0, 2.0)}
    dt = min(stable_dt(wind, mixing, spacing) for mixing in variants.values())
    return variants, dt


def transport(wind, source, solid, diffusivity, spacing, seconds, dt, checkpoints=1):
    """Advance to exact checkpoint times and verify the source/escape mass budget.

    Every checkpoint interval uses the same number of equal sub-steps, so the
    reported step size and count describe every step actually taken.
    """
    if not (np.isfinite(seconds) and seconds > 0 and np.isfinite(dt) and dt > 0):
        raise ValueError("seconds and dt must be positive and finite")
    if isinstance(checkpoints, bool) or int(checkpoints) != checkpoints or checkpoints < 1:
        raise ValueError("checkpoints must be a positive integer")
    if dt > stable_dt(wind, diffusivity, spacing) * (1 + 1e-12):
        raise ValueError("Requested time step exceeds the study CFL target")
    checkpoints = int(checkpoints)
    faces = (wind.uf, wind.vf, wind.wf)
    stepper = SparseFVStepper(faces, source, diffusivity, solid, spacing, TRANSPORT)
    if not stepper.emission > 0:
        raise ValueError("Source must emit a positive mass for a mass-budget check")
    steps = int(np.ceil(seconds / checkpoints / dt))
    step_dt = seconds / (checkpoints * steps)
    field = np.zeros(solid.shape)
    ledger = {}
    samples = []
    for _ in range(checkpoints):
        for _ in range(steps):
            field = stepper.step(field, step_dt, ledger)
        samples.append(field)
    emitted = ledger["emitted_kg"]
    escaped = ledger["escaped_kg"]
    remaining = float(field.sum() * np.prod(spacing))
    mass_error = abs(emitted - escaped - remaining) / emitted
    if not mass_error <= 1e-6 or not np.isfinite(field).all() or field.min() < 0:
        raise ValueError(f"Invalid transport result, mass error {mass_error}")
    return samples, dict(dt_s=float(step_dt), simulated_s=seconds,
                         steps=steps * checkpoints, emitted=emitted, escaped=escaped,
                         remaining=remaining, relative_mass_error=mass_error)
