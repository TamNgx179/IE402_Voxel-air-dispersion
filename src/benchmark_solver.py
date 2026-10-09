"""Reproducible B3.4 benchmark of the real wind→FV solver path."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import statistics
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

import numpy as np
import pandas as pd
import psutil
import xarray as xr
import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]


def _fixture(root: Path, base_config: Path) -> tuple[Path, Path]:
    scene = root / "scene"
    out = root / "run"
    scene.mkdir()
    out.mkdir()
    grid = {
        "origin_x_m": 0.0, "origin_y_m": 0.0,
        "dx_m": 5.0, "dy_m": 5.0, "dz_m": 2.0,
        "nx": 32, "ny": 24, "nz": 12,
    }
    rows = []
    for j in range(grid["ny"]):
        for i in range(grid["nx"]):
            obstacle = 14 <= i <= 17 and 9 <= j <= 14
            rows.append({
                "i": i, "j": j,
                "solid_from_k": 0 if obstacle else None,
                "solid_to_k": 5 if obstacle else None,
                "wkt": "POLYGON EMPTY",
            })
    cells = scene / "grid_cells.csv"
    pd.DataFrame(rows).to_csv(cells, index=False)
    digest = hashlib.sha256(cells.read_bytes()).hexdigest()
    (scene / "scene_manifest.json").write_text(json.dumps({
        "schema_version": "1.0",
        "study_area": {"name": "B3.4 benchmark", "srid": 32648},
        "grid": grid,
        "files": {"grid_cells.csv": digest},
    }), encoding="utf-8")
    source = np.zeros((12, 24, 32), dtype=np.float64)
    source[0, 12, 3:7] = 2.5e-13
    source_path = root / "source.nc"
    xr.Dataset({"S": (("z", "y", "x"), source, {"units": "kg m-3 s-1"})}).to_netcdf(source_path)
    config = yaml.safe_load(base_config.read_text(encoding="utf-8"))
    config["paths"]["scene_package_dir"] = str(scene)
    config["paths"]["emission_source_transport_netcdf"] = str(source_path)
    config["transport"]["max_simulated_s"] = 60.0
    config["transport"]["stopping_criterion"] = "fixed_time"
    config_path = root / "template.yaml"
    config_path.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
    return config_path, out


def _peak_rss(process: subprocess.Popen[str]) -> int:
    parent = psutil.Process(process.pid)
    peak = 0
    while process.poll() is None:
        try:
            family = [parent, *parent.children(recursive=True)]
            peak = max(peak, sum(item.memory_info().rss for item in family if item.is_running()))
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
        time.sleep(0.02)
    return peak


def benchmark(config_path: Path, repeats: int) -> dict:
    measurements = []
    with tempfile.TemporaryDirectory(prefix="ie402-b34-") as temporary:
        template_path, _ = _fixture(Path(temporary), config_path)
        template = yaml.safe_load(template_path.read_text(encoding="utf-8"))
        for repeat in range(1, repeats + 1):
            run_id = str(uuid.uuid4())
            out = Path(temporary) / f"run-{repeat}"
            out.mkdir()
            template["run"] = {"run_id": run_id, "scenario_id": "dry_nov_apr", "model": "fv"}
            snapshot = out / "config.yaml"
            snapshot.write_text(yaml.safe_dump(template, sort_keys=False), encoding="utf-8")
            command = [sys.executable, "-m", "src.solver", "run", "--run-id", run_id,
                       "--config", str(snapshot), "--out", str(out)]
            started = time.perf_counter()
            process = subprocess.Popen(command, cwd=REPO_ROOT, text=True,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            peak = _peak_rss(process)
            stdout, stderr = process.communicate()
            wall = time.perf_counter() - started
            if process.returncode != 0:
                raise RuntimeError(f"benchmark run failed ({process.returncode}): {stderr}\n{stdout}")
            manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
            metrics = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
            if manifest["verification"]["status"] != "pass":
                raise RuntimeError("benchmark verification did not pass")
            measurements.append({
                "repeat": repeat, "wall_clock_s": wall, "peak_rss_mb": peak / 1024**2,
                "solver_wall_clock_s": metrics["wall_clock_s"], "steps": metrics["steps"],
                "dt_s": metrics["dt_s"], "sor_iterations": metrics["sor_iterations"],
            })
    walls = [item["wall_clock_s"] for item in measurements]
    memory = [item["peak_rss_mb"] for item in measurements]
    return {
        "task": "B3.4", "solver_mode": "real", "grid": {"nx": 32, "ny": 24, "nz": 12, "voxels": 9216},
        "simulated_s": 60.0, "repeats": repeats,
        "environment": {"platform": platform.platform(), "python": platform.python_version(),
                        "cpu": platform.processor() or os.environ.get("PROCESSOR_IDENTIFIER", "unknown")},
        "summary": {"median_wall_clock_s": statistics.median(walls),
                    "max_peak_rss_mb": max(memory)},
        "measurements": measurements,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="config/project.yaml")
    parser.add_argument("--output", default="output/analysis/solver_benchmark_small.json")
    parser.add_argument("--repeats", type=int, default=3)
    args = parser.parse_args()
    if args.repeats < 1:
        raise SystemExit("--repeats must be >= 1")
    result = benchmark((REPO_ROOT / args.config).resolve(), args.repeats)
    destination = (REPO_ROOT / args.output).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"Saved: {destination}")


if __name__ == "__main__":
    main()
