"""Mass-consistent wind package.

Modules
-------
core
    Numerical routines for divergence, SOR Poisson solver,
    and mass-consistent wind correction.

spike
    Week-1 ROADMAP SOR spike, obstacle cases,
    plotting and acceptance checks.
"""

from .core import (
    DEFAULT_MAX_ITER,
    DEFAULT_OMEGA,
    DEFAULT_TOLERANCE,
    SorResult,
    WindResult,
    apply_correction,
    divergence,
    power_law_profile,
    project_mass_consistent,
    sor_poisson,
)

from .spike import (
    build_week1_multi_obstacle_case,
    build_week1_spike_case,
    run_week1_spike,
    save_week1_plot,
)


__all__ = [
    "DEFAULT_MAX_ITER",
    "DEFAULT_OMEGA",
    "DEFAULT_TOLERANCE",
    "SorResult",
    "WindResult",
    "apply_correction",
    "divergence",
    "power_law_profile",
    "project_mass_consistent",
    "sor_poisson",
    "build_week1_multi_obstacle_case",
    "build_week1_spike_case",
    "run_week1_spike",
    "save_week1_plot",
]