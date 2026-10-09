"""Scale-independent steady-state checks on finite-volume concentration fields."""
from dataclasses import dataclass, field
import numpy as np


@dataclass
class SteadyStateMonitor:
    interval_s: float = 30.0
    minimum_s: float = 600.0
    tolerance: float = 1e-3
    required_checks: int = 3
    previous: np.ndarray | None = None
    last_s: float = 0.0
    consecutive: int = 0
    residual: float = 1.0
    history: list[dict] = field(default_factory=list)

    def __post_init__(self):
        if not (np.isfinite([self.interval_s, self.minimum_s, self.tolerance]).all()
                and self.interval_s > 0 and self.minimum_s >= 0 and self.tolerance > 0
                and isinstance(self.required_checks, int) and self.required_checks >= 2):
            raise ValueError("invalid steady-state settings")

    def observe(self, concentration: np.ndarray, elapsed_s: float) -> bool:
        if elapsed_s - self.last_s < self.interval_s:
            return False
        if not np.isfinite(concentration).all():
            raise ValueError("non-finite concentration in convergence check")
        if self.previous is not None:
            scale = max(float(np.abs(concentration).sum()), np.finfo(float).tiny)
            self.residual = float(np.abs(concentration - self.previous).sum()) / scale
            self.consecutive = self.consecutive + 1 if elapsed_s >= self.minimum_s and self.residual <= self.tolerance else 0
            self.history.append({"simulated_s": elapsed_s, "relative_l1_change": self.residual,
                                 "consecutive": self.consecutive})
        self.previous = concentration.copy()
        self.last_s = elapsed_s
        return self.consecutive >= self.required_checks
