"""
The solver entry point as the monolith sees it: a process with arguments,
stdout progress, an exit code and a run directory (docs/spec.md, D2).
"""

from __future__ import annotations

import gzip
import hashlib
import json
import subprocess
import sys
import uuid
from pathlib import Path

import numpy as np
import pytest
import pandas as pd
import xarray as xr
import yaml
from jsonschema import Draft202012Validator, FormatChecker

REPO_ROOT = Path(__file__).resolve().parents[1]
SCENE = REPO_ROOT / "db" / "seeds" / "scene" / "scene_manifest.json"
SCHEMA = json.loads((REPO_ROOT / "config" / "manifest.schema.json").read_text(encoding="utf-8"))

pytestmark = pytest.mark.skipif(not SCENE.exists(), reason="scene package not exported")


def _run(
    tmp_path: Path,
    *extra: str,
    run_id: str | None = None,
    config_run_id: str | None = None,
    scenario="dry_nov_apr",
    force_missing_source: bool = False,
):
    run_id = run_id or str(uuid.uuid4())
    out = tmp_path / "run"
    out.mkdir(parents=True)
    config = (REPO_ROOT / "config" / "project.yaml").read_text(encoding="utf-8")
    if force_missing_source:
        parsed = yaml.safe_load(config)
        parsed["paths"]["emission_source_transport_netcdf"] = str(
            tmp_path / "deliberately-missing-source.nc"
        )
        config = yaml.safe_dump(parsed, sort_keys=False)
    config += f'\nrun:\n  run_id: "{config_run_id or run_id}"\n  scenario_id: {scenario}\n  model: fv\n'
    (out / "config.yaml").write_text(config, encoding="utf-8")

    result = subprocess.run(
        [sys.executable, "-m", "src.solver", "run", "--run-id", run_id,
         "--config", str(out / "config.yaml"), "--out", str(out), *extra],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=300,
    )
    return result, out


def test_mock_run_honours_the_whole_contract(tmp_path: Path) -> None:
    result, out = _run(tmp_path, "--mock")

    assert result.returncode == 0, result.stderr

    events = [json.loads(line) for line in result.stdout.splitlines()]
    assert all(event["event"] == "progress" for event in events)
    assert {event["stage"] for event in events} >= {"wind", "transport", "export"}

    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert list(Draft202012Validator(SCHEMA, format_checker=FormatChecker()).iter_errors(manifest)) == []
    assert manifest["verification"]["status"] == "pass"
    assert "mock run: synthetic field, not a model result" in manifest["warnings"]

    for artifact in manifest["artifacts"]:
        path = out / artifact["path"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == artifact["sha256"], artifact["kind"]
        assert path.stat().st_size == artifact["size_bytes"]


def test_columns_hold_one_row_per_voxel_column_and_null_in_buildings(tmp_path: Path) -> None:
    result, out = _run(tmp_path, "--mock")
    assert result.returncode == 0, result.stderr

    grid = json.loads(SCENE.read_text(encoding="utf-8"))["grid"]
    lines = gzip.decompress((out / "columns.csv.gz").read_bytes()).decode("utf-8").splitlines()

    assert lines[0] == "i,j,c_ug_m3"
    assert len(lines) == 1 + grid["nx"] * grid["ny"]

    first = lines[1].split(",", 2)[2].strip('"{}').split(",")
    assert len(first) == grid["nz"]


@pytest.mark.parametrize(("kind", "code"), [("input", 2), ("model", 3), ("system", 4)])
def test_requested_failures_exit_with_the_contract_code(tmp_path: Path, kind: str, code: int) -> None:
    result, out = _run(tmp_path, "--mock", "--mock-fail", kind)

    assert result.returncode == code
    assert (out / "solver.log").read_text(encoding="utf-8").strip()

    if kind == "model":
        manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
        assert manifest["verification"]["status"] == "fail"
    else:
        assert not (out / "manifest.json").exists()


def test_same_inputs_give_the_same_input_hash_whatever_the_run_id(tmp_path: Path) -> None:
    """input_hash is reproducibility evidence, so the run's identity is not part of it."""

    first, out_a = _run(tmp_path / "a", "--mock")
    second, out_b = _run(tmp_path / "b", "--mock")
    other, out_c = _run(tmp_path / "c", "--mock", scenario="wet_may_oct")
    assert first.returncode == second.returncode == other.returncode == 0

    hashes = [
        json.loads((out / "manifest.json").read_text(encoding="utf-8"))["input_hash"]
        for out in (out_a, out_b, out_c)
    ]
    assert hashes[0] == hashes[1]
    assert hashes[0] != hashes[2]


def test_run_id_that_is_not_a_uuid_is_an_input_error(tmp_path: Path) -> None:
    result, _ = _run(tmp_path, "--mock", run_id="not-a-uuid", config_run_id="not-a-uuid")
    assert result.returncode == 2


def test_config_for_another_run_is_an_input_error(tmp_path: Path) -> None:
    result, _ = _run(tmp_path, "--mock", config_run_id=str(uuid.uuid4()))
    assert result.returncode == 2


def test_unknown_scenario_is_an_input_error(tmp_path: Path) -> None:
    result, _ = _run(tmp_path, "--mock", scenario="monsoon")
    assert result.returncode == 2


def test_real_solver_refuses_a_missing_absolute_source(tmp_path: Path) -> None:
    result, out = _run(tmp_path, force_missing_source=True)
    assert result.returncode == 2
    assert "transport source not found" in (out / "solver.log").read_text(encoding="utf-8")
    assert not (out / "manifest.json").exists()


def test_real_solver_is_not_faked(tmp_path: Path) -> None:
    """Without --mock the B4 wind→face-flux→FV path writes real artifacts."""

    run_id = str(uuid.uuid4())
    scene = tmp_path / "scene"
    out = tmp_path / "run"
    scene.mkdir()
    out.mkdir()
    grid = {"origin_x_m": 0.0, "origin_y_m": 0.0, "dx_m": 5.0, "dy_m": 5.0, "dz_m": 2.0,
            "nx": 16, "ny": 12, "nz": 8}
    rows = []
    for j in range(grid["ny"]):
        for i in range(grid["nx"]):
            obstacle = 7 <= i <= 8 and 4 <= j <= 7
            rows.append({"i": i, "j": j, "solid_from_k": 0 if obstacle else None,
                         "solid_to_k": 3 if obstacle else None, "wkt": "POLYGON EMPTY"})
    cells = scene / "grid_cells.csv"
    pd.DataFrame(rows).to_csv(cells, index=False)
    digest = hashlib.sha256(cells.read_bytes()).hexdigest()
    (scene / "scene_manifest.json").write_text(json.dumps({
        "schema_version": "1.0", "study_area": {"name": "smoke", "srid": 32648},
        "grid": grid, "files": {"grid_cells.csv": digest},
    }), encoding="utf-8")

    source = np.zeros((8, 12, 16), dtype=np.float64)
    source[0, 6, 2] = 1e-12
    source_path = tmp_path / "source.nc"
    xr.Dataset({"S": (("z", "y", "x"), source, {"units": "kg m-3 s-1"})}).to_netcdf(source_path)
    config = yaml.safe_load((REPO_ROOT / "config" / "project.yaml").read_text(encoding="utf-8"))
    config["paths"]["scene_package_dir"] = str(scene)
    config["paths"]["emission_source_transport_netcdf"] = str(source_path)
    config["transport"]["max_simulated_s"] = 20.0
    config["run"] = {"run_id": run_id, "scenario_id": "dry_nov_apr", "model": "fv"}
    config_path = out / "config.yaml"
    config_path.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "-m", "src.solver", "run", "--run-id", run_id,
         "--config", str(config_path), "--out", str(out)],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=300,
    )
    assert result.returncode == 0, result.stderr
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["verification"]["status"] == "pass"
    assert "mock run" not in " ".join(manifest["warnings"])
    with xr.open_dataset(out / "wind.nc") as wind:
        assert {"u", "v", "w", "uf", "vf", "wf"}.issubset(wind.data_vars)
        assert wind["uf"].shape == (8, 12, 17)
    metrics = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    assert metrics["emitted_kg"] > 0.0
    assert metrics["correction_kg"] <= 1e-9 * metrics["emitted_kg"]

    # A genuine numerical failure is exit 3 and still leaves gate evidence
    # for the monolith to persist; it must not collapse into system error 4.
    failed_id = str(uuid.uuid4())
    failed_out = tmp_path / "failed"
    failed_out.mkdir()
    config["run"]["run_id"] = failed_id
    config["wind"]["max_iter"] = 1
    config["wind"]["sor_tolerance"] = 1e-20
    failed_config = failed_out / "config.yaml"
    failed_config.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
    failed = subprocess.run(
        [sys.executable, "-m", "src.solver", "run", "--run-id", failed_id,
         "--config", str(failed_config), "--out", str(failed_out)],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=300,
    )
    assert failed.returncode == 3, failed.stderr
    failed_manifest = json.loads((failed_out / "manifest.json").read_text(encoding="utf-8"))
    assert failed_manifest["verification"]["status"] == "fail"
    assert failed_manifest["verification"]["checks"]["sor_convergence"]["status"] == "fail"
