"""Analysis utilities for concentration and solver diagnostics."""

from __future__ import annotations

import numpy as np


def summary_statistics(concentration: np.ndarray) -> dict[str, float]:
    """Return scalar statistics suitable for CSV or JSON export."""
    values = np.asarray(concentration, dtype=float)
    return {
        "minimum": float(np.nanmin(values)),
        "maximum": float(np.nanmax(values)),
        "mean": float(np.nanmean(values)),
        "total": float(np.nansum(values)),
    }
