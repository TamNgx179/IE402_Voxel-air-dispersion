"""Export processed model fields to browser-friendly JSON."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np


def export_concentration(concentration: np.ndarray, output_path: str | Path, scenario: str = "baseline") -> None:
    """Write a compact concentration JSON payload for the web viewer."""
    payload = {"scenario": scenario, "shape": list(concentration.shape), "values": concentration.tolist()}
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload), encoding="utf-8")
