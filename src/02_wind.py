"""Wind/SOR entry point.

Implementation is organised under:

    src/wind/core.py
        Numerical SOR and mass-consistent wind routines.

    src/wind/spike.py
        Week-1 ROADMAP SOR spike and robustness validation.

Public functions are re-exported here so older code loading
src/02_wind.py continues to work.
"""

from __future__ import annotations

import sys
from pathlib import Path


SRC_DIR = Path(__file__).resolve().parent

if str(SRC_DIR) not in sys.path:
    sys.path.insert(
        0,
        str(SRC_DIR),
    )


from wind import (  # noqa: E402,F401
    DEFAULT_MAX_ITER,
    DEFAULT_OMEGA,
    DEFAULT_TOLERANCE,
    SorResult,
    WindResult,
    apply_correction,
    build_week1_multi_obstacle_case,
    build_week1_spike_case,
    divergence,
    power_law_profile,
    project_mass_consistent,
    run_week1_spike,
    save_week1_plot,
    sor_poisson,
)


if __name__ == "__main__":
    run_week1_spike()