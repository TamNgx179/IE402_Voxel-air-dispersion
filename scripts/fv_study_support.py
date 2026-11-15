"""Run controlled scientific experiments with the production FV operators."""
import numpy as np

from src.solver import TRANSPORT, SparseFVStepper


def stable_dt(wind, diffusivity, spacing):
    dz, dy, dx = spacing
    return TRANSPORT.cfl_time_step_faces(
        (wind.uf, wind.vf, wind.wf), diffusivity, dz_m=dz, dy_m=dy, dx_m=dx, courant=0.5,
    )


def transport(wind, source, solid, diffusivity, spacing, seconds, dt, checkpoints=1):
    """Advance to exact checkpoint times and verify the source/escape mass budget."""
    if dt > stable_dt(wind, diffusivity, spacing) * (1 + 1e-12):
        raise ValueError("Requested time step exceeds the study CFL target")
    faces = (wind.uf, wind.vf, wind.wf)
    stepper = SparseFVStepper(faces, source, diffusivity, solid, spacing, TRANSPORT)
    field = np.zeros(solid.shape)
    ledger = {}
    samples = []
    for duration in np.diff(np.linspace(0, seconds, checkpoints + 1)):
        steps = int(np.ceil(duration / dt))
        for _ in range(steps):
            field = stepper.step(field, duration / steps, ledger)
        samples.append(field)
    emitted = ledger["emitted_kg"]
    escaped = ledger["escaped_kg"]
    remaining = float(field.sum() * np.prod(spacing))
    mass_error = abs(emitted - escaped - remaining) / emitted
    if mass_error > 1e-6 or not np.isfinite(field).all() or field.min() < 0:
        raise ValueError(f"Invalid transport result, mass error {mass_error}")
    return samples, dict(dt_s=float(duration / steps), simulated_s=seconds,
                         steps=steps * checkpoints, emitted=emitted, escaped=escaped,
                         remaining=remaining, relative_mass_error=mass_error)
