"""
The one entry point the monolith spawns (docs/spec.md, "Hợp đồng v1" · D2).

    python -m src.solver run --run-id <uuid> --config <config.yaml> --out <dir> [--mock]

Exit codes: 0 ok · 2 input · 3 model failed a gate · 4 system. Progress goes to
stdout as one JSON object per line; everything else goes to <out>/solver.log
and stderr. Nothing here opens a port or touches the database.

Without `--mock`, the CLI runs the mass-consistent diagnostic wind and
finite-volume transport path. `--mock` remains available for fast API tests
and always carries a warning saying the field is synthetic.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import importlib.util
import json
import logging
import math
import subprocess
import sys
import time
import tomllib
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr
import yaml

from src.wind import power_law_profile, project_mass_consistent

REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = REPO_ROOT / "config" / "manifest.schema.json"

EXIT_OK = 0
EXIT_INPUT = 2
EXIT_MODEL = 3
EXIT_SYSTEM = 4

MOCK_WARNING = "mock run: synthetic field, not a model result"

LOGGER = logging.getLogger("solver")


def _load_transport_module():
    spec = importlib.util.spec_from_file_location("src._transport_runtime", REPO_ROOT / "src" / "03_transport.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load src/03_transport.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


TRANSPORT = _load_transport_module()


class SolverError(Exception):
    """Carries the exit code the monolith maps to error.kind."""

    def __init__(self, exit_code: int, message: str) -> None:
        super().__init__(message)
        self.exit_code = exit_code


# ---------------------------------------------------------------------------
# I/O helpers
# ---------------------------------------------------------------------------


def progress(stage: str, fraction: float) -> None:
    print(json.dumps({"event": "progress", "stage": stage, "fraction": round(fraction, 3)}), flush=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _repo_path(raw: str) -> Path:
    path = Path(raw)
    return path if path.is_absolute() else REPO_ROOT / path


def model_version() -> str:
    """Package version plus commit; '-dirty' when the working tree has changes."""

    version = tomllib.loads((REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]["version"]
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT, capture_output=True, text=True, timeout=10, check=True
        ).stdout.strip()
        dirty = subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=no"], cwd=REPO_ROOT, capture_output=True, text=True, timeout=10
        ).stdout.strip()
        return f"{version}+{commit}{'-dirty' if dirty else ''}"
    except (OSError, subprocess.SubprocessError):
        return f"{version}+unknown"


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------


def load_inputs(config_path: Path, run_id: str) -> dict:
    """Read and check everything a run needs. Any problem is an input error."""

    try:
        uuid.UUID(run_id)
    except ValueError as exc:
        raise SolverError(EXIT_INPUT, f"--run-id is not a UUID: {run_id!r}") from exc

    if not config_path.is_file():
        raise SolverError(EXIT_INPUT, f"config not found: {config_path}")

    config_bytes = config_path.read_bytes()
    try:
        config = yaml.safe_load(config_bytes)
    except yaml.YAMLError as exc:
        raise SolverError(EXIT_INPUT, f"config is not valid YAML: {exc}") from exc

    if not isinstance(config, dict):
        raise SolverError(EXIT_INPUT, "config root must be a mapping")

    run = config.get("run") or {}
    if run.get("run_id") not in (None, run_id):
        raise SolverError(EXIT_INPUT, f"config run.run_id {run.get('run_id')!r} does not match --run-id")

    scenarios = (config.get("meteorology") or {}).get("scenarios") or {}
    scenario_id = run.get("scenario_id")
    if scenario_id not in scenarios:
        raise SolverError(EXIT_INPUT, f"run.scenario_id {scenario_id!r} is not one of {sorted(scenarios)}")

    model = run.get("model", "fv")
    if model not in ("fv", "gaussian"):
        raise SolverError(EXIT_INPUT, f"run.model must be 'fv' or 'gaussian', got {model!r}")

    thresholds = (config.get("analysis") or {}).get("thresholds_ug_m3") or {}
    if not thresholds:
        raise SolverError(EXIT_INPUT, "config has no analysis.thresholds_ug_m3")

    scene_dir = _repo_path(str((config.get("paths") or {}).get("scene_package_dir", "")))
    scene_manifest_path = scene_dir / "scene_manifest.json"
    if not scene_manifest_path.is_file():
        raise SolverError(EXIT_INPUT, f"scene package not found: {scene_manifest_path} (run src/07_export_scene.py)")

    scene_manifest_bytes = scene_manifest_path.read_bytes()
    scene = json.loads(scene_manifest_bytes)
    cells_path = scene_dir / "grid_cells.csv"
    if sha256(cells_path) != scene["files"]["grid_cells.csv"]:
        raise SolverError(EXIT_INPUT, "grid_cells.csv does not match its checksum in scene_manifest.json")

    # The run_id is identity, not input: two runs of the same scenario on the
    # same data share an input_hash, which is the reproducibility evidence.
    hashed_config = {**config, "run": {k: v for k, v in run.items() if k != "run_id"}}
    canonical = json.dumps(hashed_config, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")
    scene_files = json.dumps(scene["files"], sort_keys=True).encode("utf-8")
    source_raw = (config.get("paths") or {}).get("emission_source_transport_netcdf")
    source_path = _repo_path(str(source_raw)) if source_raw else None
    source_digest = sha256(source_path).encode("ascii") if source_path and source_path.is_file() else b"missing"
    input_digest = hashlib.sha256(canonical + b"\0" + scene_files + b"\0" + source_digest).hexdigest()

    return {
        "config": config,
        "run_id": run_id,
        "model": model,
        "scenario_id": scenario_id,
        "scenario": scenarios[scenario_id],
        "thresholds": thresholds,
        "grid": scene["grid"],
        "crs": f"EPSG:{scene['study_area']['srid']}",
        "cells_path": cells_path,
        "source_path": source_path,
        "input_hash": f"sha256:{input_digest}",
    }


def solid_mask(cells_path: Path, grid: dict) -> np.ndarray:
    """[z, y, x] building mask rebuilt from the scene package's grid cells."""

    cells = pd.read_csv(cells_path, usecols=["i", "j", "solid_from_k", "solid_to_k"])
    solid = np.zeros((grid["nz"], grid["ny"], grid["nx"]), dtype=bool)
    for row in cells.dropna().itertuples(index=False):
        solid[int(row.solid_from_k) : int(row.solid_to_k) + 1, int(row.j), int(row.i)] = True
    return solid


# ---------------------------------------------------------------------------
# Mock fields
# ---------------------------------------------------------------------------


def wind_vector(scenario: dict) -> tuple[float, float]:
    """Meteorological 'from' direction to (u, v) in m/s, u east, v north."""

    speed = float(scenario["speed_m_s"])
    toward = math.radians(float(scenario["direction_from_deg"]) + 180.0)
    return speed * math.sin(toward), speed * math.cos(toward)


def mock_concentration(grid: dict, scenario: dict, solid: np.ndarray) -> np.ndarray:
    """A synthetic ground-level plume from the domain centre, ug m-3, NaN in buildings."""

    nx, ny, nz = grid["nx"], grid["ny"], grid["nz"]
    x = (np.arange(nx) + 0.5) * grid["dx_m"] - nx * grid["dx_m"] / 2
    y = (np.arange(ny) + 0.5) * grid["dy_m"] - ny * grid["dy_m"] / 2
    z = (np.arange(nz) + 0.5) * grid["dz_m"]

    u, v = wind_vector(scenario)
    speed = math.hypot(u, v) or 1.0
    ex, ey = u / speed, v / speed

    xx, yy = np.meshgrid(x, y)  # [y, x]
    along = xx * ex + yy * ey
    across = -xx * ey + yy * ex
    downwind = np.clip(along, 0.0, None) + 5.0

    sigma_y = 0.25 * downwind + 5.0
    sigma_z = 0.12 * downwind + 2.0
    horizontal = 60.0 * np.exp(-0.5 * (across / sigma_y) ** 2) * (5.0 / downwind) ** 0.5

    field = horizontal[None, :, :] * np.exp(-0.5 * (z[:, None, None] / sigma_z[None, :, :]) ** 2)
    field = field.astype(np.float32)
    field[solid] = np.nan
    return field


def _coords(grid: dict) -> dict[str, np.ndarray]:
    return {
        "x": grid["origin_x_m"] + (np.arange(grid["nx"]) + 0.5) * grid["dx_m"],
        "y": grid["origin_y_m"] + (np.arange(grid["ny"]) + 0.5) * grid["dy_m"],
        "z": (np.arange(grid["nz"]) + 0.5) * grid["dz_m"],
    }


def write_concentration(path: Path, field: np.ndarray, grid: dict, crs: str, warnings: list[str]) -> None:
    coords = _coords(grid)
    ds = xr.Dataset(
        {"C": (("z", "y", "x"), field, {"units": "ug m-3", "long_name": "PM2.5 concentration"})},
        coords=coords,
        attrs={"Conventions": "CF-1.8", "model_crs": crs, "axis_order": "z,y,x", "warnings": "; ".join(warnings)},
    )
    ds["z"].attrs.update(units="m", positive="up")
    ds.to_netcdf(path, encoding={"C": {"zlib": True, "complevel": 4, "_FillValue": np.float32(np.nan)}})


def write_wind(path: Path, grid: dict, scenario: dict, solid: np.ndarray, crs: str) -> None:
    """Uniform mock wind: cell-centred u,v,w and staggered uf,vf,wf (spec BR-36)."""

    nz, ny, nx = solid.shape
    u, v = wind_vector(scenario)
    air = (~solid).astype(np.float32)
    coords = _coords(grid)
    ds = xr.Dataset(
        {
            "u": (("z", "y", "x"), u * air),
            "v": (("z", "y", "x"), v * air),
            "w": (("z", "y", "x"), np.zeros_like(air)),
            "uf": (("z", "y", "x_face"), np.full((nz, ny, nx + 1), u, dtype=np.float32)),
            "vf": (("z", "y_face", "x"), np.full((nz, ny + 1, nx), v, dtype=np.float32)),
            "wf": (("z_face", "y", "x"), np.zeros((nz + 1, ny, nx), dtype=np.float32)),
        },
        coords=coords,
        attrs={"Conventions": "CF-1.8", "model_crs": crs, "axis_order": "z,y,x", "mock": "true"},
    )
    for name in ("u", "v", "w", "uf", "vf", "wf"):
        ds[name].attrs["units"] = "m s-1"
    ds.to_netcdf(path, encoding={name: {"zlib": True, "complevel": 4} for name in ds.data_vars})


def write_columns(path: Path, field: np.ndarray) -> None:
    """i,j,c_ug_m3 with c as a PostgreSQL array literal; NULL marks a solid voxel (spec D1)."""

    nz, ny, nx = field.shape
    lines = ["i,j,c_ug_m3"]
    for j in range(ny):
        for i in range(nx):
            values = ",".join("NULL" if np.isnan(c) else f"{c:.6g}" for c in field[:, j, i])
            lines.append(f'{i},{j},"{{{values}}}"')
    data = ("\n".join(lines) + "\n").encode("utf-8")
    with path.open("wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as handle:
        handle.write(data)


def load_transport_source(inputs: dict, solid: np.ndarray) -> np.ndarray:
    """Load the absolute emission source, enforcing the B2 tensor contract."""

    raw = (inputs["config"].get("paths") or {}).get("emission_source_transport_netcdf")
    if not raw:
        raise SolverError(EXIT_INPUT, "paths.emission_source_transport_netcdf is required for a real run")
    path = _repo_path(str(raw))
    if not path.is_file():
        raise SolverError(EXIT_INPUT, f"transport source not found: {path} (run the B2 emission pipeline)")
    try:
        with xr.open_dataset(path) as ds:
            if "S" not in ds:
                raise SolverError(EXIT_INPUT, f"{path} has no variable S")
            var = ds["S"]
            if tuple(var.dims) != ("z", "y", "x"):
                raise SolverError(EXIT_INPUT, f"S dimensions must be ('z','y','x'), got {var.dims}")
            units = str(var.attrs.get("units", "")).replace(" ", "")
            if units not in {"kgm-3s-1", "kg/m^3/s"}:
                raise SolverError(EXIT_INPUT, f"S units must be kg m-3 s-1, got {var.attrs.get('units')!r}")
            source = var.values.astype(np.float64)
    except SolverError:
        raise
    except Exception as exc:
        raise SolverError(EXIT_INPUT, f"cannot read transport source {path}: {exc}") from exc
    if source.shape != solid.shape:
        raise SolverError(EXIT_INPUT, f"S shape {source.shape} does not match grid {solid.shape}")
    if np.any(~np.isfinite(source)) or np.any(source < 0.0):
        raise SolverError(EXIT_INPUT, "S must be finite and non-negative")
    if np.any(source[solid] > 0.0):
        raise SolverError(EXIT_INPUT, "S contains emission inside solid voxels")
    if not np.any(source > 0.0):
        raise SolverError(EXIT_INPUT, "S contains no positive emission")
    return source


def initial_wind(inputs: dict, solid: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Power-law background wind in meteorological direction, before projection."""

    grid = inputs["grid"]
    cfg = inputs["config"].get("wind") or {}
    exponent = float(cfg.get("profile_exponent", 0.25))
    reference_height = float(cfg.get("reference_height_m", 10.0))
    z = (np.arange(grid["nz"]) + 0.5) * grid["dz_m"]
    speeds = power_law_profile(
        z,
        u_ref_m_s=float(inputs["scenario"]["speed_m_s"]),
        z_ref_m=reference_height,
        exponent=exponent,
    )[:, None, None]
    direction = math.radians(float(inputs["scenario"]["direction_from_deg"]) + 180.0)
    air = (~solid).astype(float)
    u0 = np.broadcast_to(speeds * math.sin(direction), solid.shape).copy() * air
    v0 = np.broadcast_to(speeds * math.cos(direction), solid.shape).copy() * air
    w0 = np.zeros(solid.shape, dtype=float)
    return u0, v0, w0


def write_wind_result(path: Path, result, grid: dict, crs: str) -> None:
    coords = _coords(grid)
    ds = xr.Dataset(
        {
            "u": (("z", "y", "x"), result.u.astype(np.float32)),
            "v": (("z", "y", "x"), result.v.astype(np.float32)),
            "w": (("z", "y", "x"), result.w.astype(np.float32)),
            "uf": (("z", "y", "x_face"), result.uf.astype(np.float32)),
            "vf": (("z", "y_face", "x"), result.vf.astype(np.float32)),
            "wf": (("z_face", "y", "x"), result.wf.astype(np.float32)),
        },
        coords=coords,
        attrs={"Conventions": "CF-1.8", "model_crs": crs, "axis_order": "z,y,x", "wind_model": "mass-consistent diagnostic"},
    )
    for name in ds.data_vars:
        ds[name].attrs["units"] = "m s-1"
    ds["z"].attrs.update(units="m", positive="up")
    ds.to_netcdf(path, encoding={name: {"zlib": True, "complevel": 4} for name in ds.data_vars})


def wall_flux_max(result, solid: np.ndarray) -> float:
    values: list[float] = []
    if solid.shape[2] > 1:
        values.append(float(np.max(np.abs(result.uf[..., 1:-1][solid[..., :-1] | solid[..., 1:]]), initial=0.0)))
    if solid.shape[1] > 1:
        values.append(float(np.max(np.abs(result.vf[:, 1:-1, :][solid[:, :-1, :] | solid[:, 1:, :]]), initial=0.0)))
    if solid.shape[0] > 1:
        values.append(float(np.max(np.abs(result.wf[1:-1][solid[:-1] | solid[1:]]), initial=0.0)))
    return max(values, default=0.0)


def close_log_for_manifest() -> None:
    for handler in list(LOGGER.handlers):
        if isinstance(handler, logging.FileHandler):
            handler.close()
            LOGGER.removeHandler(handler)


def artifact_entries(args: argparse.Namespace, out: Path) -> list[dict]:
    kinds = {
        "config": Path(args.config), "wind": out / "wind.nc", "concentration": out / "concentration.nc",
        "columns": out / "columns.csv.gz", "metrics": out / "metrics.json", "log": out / "solver.log",
    }
    return [
        {"kind": kind, "path": path.name, "sha256": sha256(path), "size_bytes": path.stat().st_size}
        for kind, path in kinds.items() if path.resolve().parent == out.resolve()
    ]


def check(value: float, tolerance: float, passed: bool, detail: str | None = None) -> dict:
    item = {"status": "pass" if passed else "fail", "value": float(value), "tolerance": float(tolerance)}
    if detail:
        item["detail"] = detail
    return item


def write_early_model_failure(
    args: argparse.Namespace, out: Path, started: str, inputs: dict,
    *, failed_check: str, value: float, tolerance: float, detail: str,
) -> int:
    """Write a schema-valid diagnostic manifest for an exit-3 before export."""
    LOGGER.error("%s", detail)
    close_log_for_manifest()
    checks = {
        name: check(0.0, 0.0, False, "not run because an earlier model gate failed")
        for name in ("cfl", "face_divergence", "positivity", "wall_flux", "mass_balance")
    }
    checks[failed_check] = check(value, tolerance, False, detail)
    if failed_check == "sor_convergence":
        checks["sor_convergence"] = check(value, tolerance, False, detail)
    artifacts = []
    for kind, path in (("config", Path(args.config)), ("log", out / "solver.log")):
        if path.is_file() and path.resolve().parent == out.resolve():
            artifacts.append({"kind": kind, "path": path.name, "sha256": sha256(path), "size_bytes": path.stat().st_size})
    manifest = {
        "schema_version": "1.0", "run_id": args.run_id, "model": inputs["model"], "model_version": model_version(),
        "input_hash": inputs["input_hash"],
        "scenario": {"id": inputs["scenario_id"], "wind_from_deg": float(inputs["scenario"]["direction_from_deg"]), "wind_speed_m_s": float(inputs["scenario"]["speed_m_s"])},
        "grid": {"crs": inputs["crs"], "axis_order": "z,y,x", **inputs["grid"]},
        "units": {"concentration": "ug m-3", "velocity": "m s-1"},
        "thresholds": {key: {"value_ug_m3": float(item["value"]), "label": str(item["label"])} for key, item in inputs["thresholds"].items()},
        "stopping": {"criterion": "fixed_time", "simulated_s": 0.0, "steps": 1, "residual": value},
        "artifacts": artifacts,
        "verification": {"status": "fail", "checks": checks},
        "warnings": ["model stopped before artifact export"],
        "started_at": started, "finished_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    # Schema requires simulated_s > 0 even for an early stop.
    manifest["stopping"]["simulated_s"] = np.finfo(float).tiny
    validate_manifest(manifest)
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return EXIT_MODEL


def run_real(args: argparse.Namespace, out: Path, started: str, clock: float) -> int:
    """B4 production code path; smoke grids now, production benchmark in B5."""

    inputs = load_inputs(Path(args.config), args.run_id)
    if inputs["model"] != "fv":
        raise SolverError(EXIT_INPUT, "real CLI currently accepts model=fv; Gaussian remains the labelled B2 baseline")
    grid = inputs["grid"]
    solid = solid_mask(inputs["cells_path"], grid)
    source = load_transport_source(inputs, solid)
    progress("setup", 1.0)

    wind_cfg = inputs["config"].get("wind") or {}
    progress("wind", 0.0)
    try:
        wind = project_mass_consistent(
            *initial_wind(inputs, solid), solid,
            dx=float(grid["dx_m"]), dy=float(grid["dy_m"]), dz=float(grid["dz_m"]),
            alpha1=float(wind_cfg.get("alpha1", 1.0)), alpha2=float(wind_cfg.get("alpha2", 1.0)),
            omega=float(wind_cfg.get("omega", 1.78)),
            tolerance=float(wind_cfg.get("sor_tolerance", 1e-4)),
            max_iter=int(wind_cfg.get("max_iter", 10000)),
        )
    except RuntimeError as exc:
        text = f"wind projection failed: {exc}"
        residual = 1.0
        marker = "final residual="
        if marker in str(exc):
            try:
                residual = float(str(exc).split(marker, 1)[1].split(",", 1)[0])
            except ValueError:
                pass
        return write_early_model_failure(
            args, out, started, inputs, failed_check="sor_convergence", value=residual,
            tolerance=float(wind_cfg.get("sor_tolerance", 1e-4)), detail=text,
        )
    progress("wind", 1.0)

    transport_cfg = inputs["config"].get("transport") or {}
    diffusivity = (
        float(transport_cfg.get("vertical_diffusivity_m2_s", 1.0)),
        float(transport_cfg.get("horizontal_diffusivity_m2_s", 2.0)),
        float(transport_cfg.get("horizontal_diffusivity_m2_s", 2.0)),
    )
    faces = (wind.uf, wind.vf, wind.wf)
    target = float(transport_cfg.get("courant_target", 0.5))
    dt = TRANSPORT.cfl_time_step_faces(
        faces, diffusivity, dz_m=grid["dz_m"], dy_m=grid["dy_m"], dx_m=grid["dx_m"], courant=target
    )
    max_time = float(transport_cfg.get("max_simulated_s", 600.0))
    steps = int(math.ceil(max_time / dt))
    concentration = np.zeros(solid.shape, dtype=np.float64)
    ledger: dict[str, float] = {}
    progress("transport", 0.0)
    try:
        elapsed = 0.0
        for step in range(steps):
            step_dt = min(dt, max_time - elapsed)
            concentration = TRANSPORT.transport_step_faces(
                concentration, faces, source, diffusivity, step_dt,
                dz_m=grid["dz_m"], dy_m=grid["dy_m"], dx_m=grid["dx_m"], solid=solid, ledger=ledger,
            )
            elapsed += step_dt
            if step == steps - 1 or step % max(1, steps // 20) == 0:
                progress("transport", (step + 1) / steps)
    except TRANSPORT.NegativeConcentrationError as exc:
        return write_early_model_failure(
            args, out, started, inputs, failed_check="positivity",
            value=abs(float(exc.min_value)), tolerance=float(exc.tolerance),
            detail=f"transport positivity gate failed: {exc}",
        )

    cell_volume = grid["dx_m"] * grid["dy_m"] * grid["dz_m"]
    remaining = float(concentration.sum()) * cell_volume
    emitted = ledger.get("emitted_kg", 0.0)
    escaped = ledger.get("escaped_kg", 0.0)
    correction = ledger.get("positivity_correction_kg", 0.0)
    mass_error = abs(emitted + correction - remaining - escaped) / max(emitted, np.finfo(float).tiny)
    divergence = float(np.max(np.abs(wind.divergence_after[~solid]), initial=0.0))
    wall = wall_flux_max(wind, solid)
    realised_courant = TRANSPORT.courant_number_faces(
        faces, dt, dz_m=grid["dz_m"], dy_m=grid["dy_m"], dx_m=grid["dx_m"]
    )
    positivity_ratio = correction / max(emitted, np.finfo(float).tiny)
    div_tol = float(wind_cfg.get("divergence_tolerance_s_1", 1e-3))
    mass_tol = float(transport_cfg.get("mass_balance_tolerance", 1e-6))
    positivity_tol = float(transport_cfg.get("positivity_correction_tolerance", 1e-9))
    checks = {
        "cfl": check(realised_courant, target, realised_courant <= target + 1e-12),
        "face_divergence": check(divergence, div_tol, divergence <= div_tol),
        "positivity": check(positivity_ratio, positivity_tol, positivity_ratio <= positivity_tol),
        "wall_flux": check(wall, 0.0, wall == 0.0),
        "mass_balance": check(mass_error, mass_tol, mass_error <= mass_tol),
        "sor_convergence": check(wind.sor_residual, float(wind_cfg.get("sor_tolerance", 1e-4)), True),
    }

    progress("export", 0.0)
    warnings = ["fixed-time M3 run; steady-state convergence is a B5 deliverable"]
    display = concentration * 1e9
    display[solid] = np.nan
    write_wind_result(out / "wind.nc", wind, grid, inputs["crs"])
    write_concentration(out / "concentration.nc", display.astype(np.float32), grid, inputs["crs"], warnings)
    write_columns(out / "columns.csv.gz", display)
    speed = max(float(np.max(np.abs(wind.u))), float(np.max(np.abs(wind.v))), float(np.max(np.abs(wind.w))))
    metrics = {
        "dt_s": dt, "courant": realised_courant, "steps": steps, "simulated_s": elapsed,
        "wall_clock_s": round(time.perf_counter() - clock, 3), "emitted_kg": emitted,
        "remaining_kg": remaining, "escaped_kg": escaped, "correction_kg": correction,
        "solid_removed_kg": ledger.get("solid_removed_kg", 0.0), "stopping_criterion": "fixed_time",
        "sor_iterations": wind.iterations, "sor_residual": wind.sor_residual,
        "face_divergence_max_s_1": divergence, "wall_flux_max_m_s": wall,
        "physical_diffusivity_m2_s": {"vertical": diffusivity[0], "horizontal": diffusivity[1]},
        "numerical_diffusion_m2_s": TRANSPORT.numerical_diffusion(speed, min(grid["dx_m"], grid["dy_m"]), realised_courant),
    }
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    progress("export", 1.0)
    close_log_for_manifest()
    failed = [name for name, item in checks.items() if item["status"] != "pass"]
    manifest = {
        "schema_version": "1.0", "run_id": args.run_id, "model": "fv", "model_version": model_version(),
        "input_hash": inputs["input_hash"],
        "scenario": {"id": inputs["scenario_id"], "wind_from_deg": float(inputs["scenario"]["direction_from_deg"]), "wind_speed_m_s": float(inputs["scenario"]["speed_m_s"])},
        "grid": {"crs": inputs["crs"], "axis_order": "z,y,x", **grid},
        "units": {"concentration": "ug m-3", "velocity": "m s-1"},
        "thresholds": {key: {"value_ug_m3": float(item["value"]), "label": str(item["label"])} for key, item in inputs["thresholds"].items()},
        "stopping": {"criterion": "fixed_time", "simulated_s": elapsed, "steps": steps, "residual": None},
        "artifacts": artifact_entries(args, out),
        "verification": {"status": "fail" if failed else "pass", "checks": checks},
        "warnings": warnings, "started_at": started, "finished_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    validate_manifest(manifest)
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if failed:
        LOGGER.error("verification failed: %s", ", ".join(failed))
        return EXIT_MODEL
    return EXIT_OK


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------


def run_mock(args: argparse.Namespace, out: Path, started: str, clock: float) -> int:
    inputs = load_inputs(Path(args.config), args.run_id)
    LOGGER.info("mock run %s, scenario %s, model %s", args.run_id, inputs["scenario_id"], inputs["model"])
    progress("setup", 1.0)

    if args.mock_fail == "input":
        raise SolverError(EXIT_INPUT, "mock failure requested: input")

    grid = inputs["grid"]
    solid = solid_mask(inputs["cells_path"], grid)

    progress("wind", 0.0)
    write_wind(out / "wind.nc", grid, inputs["scenario"], solid, inputs["crs"])
    progress("wind", 1.0)

    if args.mock_fail == "system":
        raise SolverError(EXIT_SYSTEM, "mock failure requested: system")

    progress("transport", 0.0)
    field = mock_concentration(grid, inputs["scenario"], solid)
    warnings = [MOCK_WARNING]
    progress("transport", 1.0)

    progress("export", 0.0)
    write_concentration(out / "concentration.nc", field, grid, inputs["crs"], warnings)
    write_columns(out / "columns.csv.gz", field)

    transport = inputs["config"].get("transport") or {}
    simulated_s = float(transport.get("max_simulated_s", 600.0))
    model_failed = args.mock_fail == "model"
    mass_error = 0.02 if model_failed else 0.0

    metrics = {
        "dt_s": 0.5,
        "courant": float(transport.get("courant_target", 0.5)),
        "steps": int(simulated_s / 0.5),
        "simulated_s": simulated_s,
        "wall_clock_s": round(time.perf_counter() - clock, 3),
        "emitted_kg": 1.0,
        "remaining_kg": 0.4,
        "escaped_kg": 0.6 - mass_error,
        "correction_kg": 0.0,
        "stopping_criterion": "fixed_time",
        "mock": True,
    }
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")

    def check(value: float, tolerance: float, passed: bool, detail: str | None = None) -> dict:
        entry = {"status": "pass" if passed else "fail", "value": value, "tolerance": tolerance}
        if detail:
            entry["detail"] = detail
        return entry

    checks = {
        "cfl": check(metrics["courant"], 0.5, metrics["courant"] <= 0.5),
        "face_divergence": check(0.0, 1e-5, True),
        "positivity": check(0.0, 1e-9, True),
        "wall_flux": check(0.0, 0.0, True),
        "mass_balance": check(
            mass_error, 1e-9, not model_failed, "|emitted - remaining - escaped - corrections| / emitted"
        ),
    }
    if model_failed:
        LOGGER.error("mass balance check failed (mock)")

    progress("export", 1.0)
    LOGGER.info("artifacts written; finishing manifest")

    # The log is an artifact, so it is closed before it is hashed.
    for handler in list(LOGGER.handlers):
        if isinstance(handler, logging.FileHandler):
            handler.close()
            LOGGER.removeHandler(handler)

    kinds = {
        "config": Path(args.config),
        "wind": out / "wind.nc",
        "concentration": out / "concentration.nc",
        "columns": out / "columns.csv.gz",
        "metrics": out / "metrics.json",
        "log": out / "solver.log",
    }
    artifacts = []
    for kind, path in kinds.items():
        if path.resolve().parent != out.resolve():
            continue  # the config snapshot is only an artifact when it lives in the run dir
        artifacts.append({"kind": kind, "path": path.name, "sha256": sha256(path), "size_bytes": path.stat().st_size})

    manifest = {
        "schema_version": "1.0",
        "run_id": args.run_id,
        "model": inputs["model"],
        "model_version": model_version(),
        "input_hash": inputs["input_hash"],
        "scenario": {
            "id": inputs["scenario_id"],
            "wind_from_deg": float(inputs["scenario"]["direction_from_deg"]),
            "wind_speed_m_s": float(inputs["scenario"]["speed_m_s"]),
        },
        "grid": {"crs": inputs["crs"], "axis_order": "z,y,x", **grid},
        "units": {"concentration": "ug m-3", "velocity": "m s-1"},
        "thresholds": {
            key: {"value_ug_m3": float(item["value"]), "label": str(item["label"])}
            for key, item in inputs["thresholds"].items()
        },
        "stopping": {"criterion": "fixed_time", "simulated_s": simulated_s, "steps": metrics["steps"], "residual": None},
        "artifacts": artifacts,
        "verification": {"status": "fail" if model_failed else "pass", "checks": checks},
        "warnings": warnings,
        "started_at": started,
        "finished_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }

    validate_manifest(manifest)
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return EXIT_MODEL if model_failed else EXIT_OK


def validate_manifest(manifest: dict) -> None:
    """A manifest that breaks the contract is our bug, so it is a system error."""

    from jsonschema import Draft202012Validator, FormatChecker

    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    errors = sorted(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(manifest), key=str)
    if errors:
        raise SolverError(EXIT_SYSTEM, "manifest violates config/manifest.schema.json: " + errors[0].message)


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="python -m src.solver", description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)

    run = commands.add_parser("run", help="run one simulation")
    run.add_argument("--run-id", required=True)
    run.add_argument("--config", required=True, help="config snapshot written by the monolith")
    run.add_argument("--out", required=True, help="run directory, artifacts/<run_id>/")
    run.add_argument("--mock", action="store_true", help="synthetic result with the real contract")
    run.add_argument("--mock-fail", choices=["input", "model", "system"], help="exit 2/3/4 on purpose")

    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)  # bad arguments exit 2 through argparse: an input error
    started = datetime.now(timezone.utc).isoformat(timespec="seconds")
    clock = time.perf_counter()

    out = Path(args.out)
    try:
        out.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        print(f"cannot create --out {out}: {exc}", file=sys.stderr)
        return EXIT_SYSTEM

    LOGGER.setLevel(logging.INFO)
    LOGGER.handlers.clear()
    formatter = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")
    for handler in (logging.FileHandler(out / "solver.log", mode="w", encoding="utf-8"), logging.StreamHandler(sys.stderr)):
        handler.setFormatter(formatter)
        LOGGER.addHandler(handler)

    try:
        if args.mock_fail and not args.mock:
            raise SolverError(EXIT_INPUT, "--mock-fail needs --mock")
        return run_mock(args, out, started, clock) if args.mock else run_real(args, out, started, clock)
    except SolverError as exc:
        LOGGER.error("%s", exc)
        return exc.exit_code
    except Exception:  # anything unexpected is a system error, never a silent success
        LOGGER.error("unexpected failure\n%s", traceback.format_exc())
        return EXIT_SYSTEM
    finally:
        logging.shutdown()


if __name__ == "__main__":
    sys.exit(main())
