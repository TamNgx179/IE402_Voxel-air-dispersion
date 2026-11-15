"""Compare vertical voxel spacing with a shared physical source and wind scenario."""
import argparse
import copy
import json
import subprocess
import sys
import uuid
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr
import yaml

from src.demo_bundle import inspect_bundle
from src.production_study import raster_height
from src.solver import _coords, sha256


def run_solver(folder, config):
    run_id = str(uuid.uuid4())
    config["run"] = dict(run_id=run_id, scenario_id="dry_nov_apr", model="fv")
    snapshot = folder / "config.yaml"
    snapshot.write_text(yaml.safe_dump(config), encoding="utf8")
    print(f"Running {folder.name}: {run_id}", flush=True)
    with (folder / "progress.jsonl").open("w") as log, (folder / "stderr.log").open("w") as err:
        subprocess.run([sys.executable, "-m", "src.solver", "run", "--run-id", run_id,
                        "--config", str(snapshot), "--out", str(folder)],
                       check=True, stdout=log, stderr=err)


def collect(out, runs, base, top, metadata):
    results = []
    fields = {}
    for dz, folder in runs.items():
        manifest = json.loads((folder / "manifest.json").read_text(encoding="utf8"))
        metrics = json.loads((folder / "metrics.json").read_text(encoding="utf8"))
        concentration = folder / "concentration.nc"
        with xr.open_dataset(concentration) as dataset:
            fields[dz] = np.repeat(dataset.C.to_numpy(), dz, axis=0)
        results.append(dict(dz_m=dz, run_id=manifest["run_id"], input_hash=manifest["input_hash"],
                            dt_s=metrics["dt_s"], metrics=metrics,
                            concentration_sha256=sha256(concentration)))
    common = np.logical_and.reduce([np.isfinite(field) for field in fields.values()])
    comparisons = []
    for low, high in ((0, 4), (12, 16), (0, top)):
        mask = common[low:high]
        reference = fields[1][low:high][mask].astype(float)
        for dz, field in fields.items():
            actual = field[low:high][mask].astype(float)
            error = actual - reference
            comparisons.append(dict(z_min_m=low, z_max_m=high, dz_m=dz,
                                    common_air_m3=int(mask.sum()) * base["dx_m"] * base["dy_m"],
                                    mean_ug_m3=float(actual.mean()), mae_ug_m3=float(np.abs(error).mean()),
                                    relative_l2=float(np.linalg.norm(error) / np.linalg.norm(reference))))
    report = dict(**metadata, runs=results, comparisons=comparisons)
    (out / "summary.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf8")
    print(json.dumps(comparisons, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--match-time-step-from", type=Path,
                        help="Reuse completed native-CFL inputs and compare at dz=1's time step")
    args = parser.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=False)
    config = yaml.safe_load(Path("config/project.yaml").read_text(encoding="utf8"))
    scene = Path(config["paths"]["scene_package_dir"])
    manifest = json.loads((scene / "scene_manifest.json").read_text(encoding="utf8"))
    base = manifest["grid"]
    top = int(base["dz_m"] * base["nz"])
    if args.match_time_step_from:
        native = args.match_time_step_from.resolve()
        previous = json.loads((native / "summary.json").read_text(encoding="utf8"))
        native_dt = {item["dz_m"]: item["dt_s"] for item in previous["runs"]}
        runs = {1: native / "dz1"}
        for dz in (2, 4):
            folder = out / f"dz{dz}"
            folder.mkdir()
            cfg = yaml.safe_load((native / f"dz{dz}" / "config.yaml").read_text(encoding="utf8"))
            # With identical inputs for this grid, the solver's dt is linear in its CFL target.
            cfg["transport"]["courant_target"] *= native_dt[1] / native_dt[dz]
            run_solver(folder, cfg)
            metrics = json.loads((folder / "metrics.json").read_text(encoding="utf8"))
            np.testing.assert_allclose(metrics["dt_s"], native_dt[1], rtol=1e-12)
            runs[dz] = folder
        metadata = {key: previous[key] for key in (
            "source_rate_kg_s", "source_removed_fraction_before_renormalizing",
            "simulated_time_s", "reference_dz_m")}
        collect(out, runs, base, top, dict(**metadata, time_step_mode="matched"))
        return
    _, inputs = inspect_bundle(Path("deploy/demo-inputs"))
    source_path = out / "original-source.nc"
    source_path.write_bytes(inputs["emission_source_transport.nc"])
    with xr.open_dataset(source_path) as dataset:
        source = dataset.S.load()
    assert source.dims == ("z", "y", "x") and source.attrs["units"] == "kg m-3 s-1"
    assert base["dz_m"] == 2 and np.all(np.isfinite(source)) and np.all(source >= 0) and not np.any(source.values[1:])
    heights = raster_height(scene, base, config["voxelization"]["rasterization"]["all_touched"])
    # Use the same horizontal support at every spacing; 0.5 m is the lowest centre.
    original = source.values[0].astype(float)
    load = np.where(heights <= 0.5, original, 0)
    removed = 1 - load.sum() / original.sum()
    load *= original.sum() / load.sum()
    rate = float(original.sum() * base["dx_m"] * base["dy_m"] * 2)
    runs = {}
    for dz in (1, 2, 4):
        folder = out / f"dz{dz}"
        package = folder / "scene"
        package.mkdir(parents=True)
        grid = {**base, "dz_m": dz, "nz": int(top / dz)}
        centres = _coords(grid)
        solid = centres["z"][:, None, None] < heights
        kmax = solid.sum(axis=0).ravel() - 1
        j, i = np.indices(solid.shape[1:]).reshape(2, -1)
        pd.DataFrame(dict(i=i, j=j,
                          solid_from_k=pd.array(np.where(kmax >= 0, 0, np.nan), dtype="Int64"),
                          solid_to_k=pd.array(np.where(kmax >= 0, kmax, np.nan), dtype="Int64")
                          )).to_csv(package / "grid_cells.csv", index=False)
        for name, digest in manifest["files"].items():
            assert sha256(scene / name) == digest
            if name != "grid_cells.csv":
                (package / name).write_bytes((scene / name).read_bytes())
        (package / "scene_manifest.json").write_text(json.dumps({
            **manifest, "grid": grid, "files": {name: sha256(package / name) for name in manifest["files"]}
        }), encoding="utf8")
        # Integrate the same source over [0, 2 m] and divide by receiving cell depth.
        fractions = np.clip(2 - np.arange(grid["nz"]) * dz, 0, dz) / dz
        emission = fractions[:, None, None] * load
        assert not np.any(emission[solid])
        np.testing.assert_allclose(emission.sum() * base["dx_m"] * base["dy_m"] * dz, rate, rtol=1e-12)
        emissions_path = folder / "source.nc"
        xr.Dataset({"S": (source.dims, emission, source.attrs)}, coords=centres).to_netcdf(emissions_path)
        cfg = copy.deepcopy(config)
        cfg["paths"].update(scene_package_dir=str(package), emission_source_transport_netcdf=str(emissions_path))
        cfg["transport"].update(stopping_criterion="fixed_time", implementation="sparse", max_simulated_s=300,
                                courant_target=0.5)
        run_solver(folder, cfg)
        runs[dz] = folder
    collect(out, runs, base, top,
            dict(source_rate_kg_s=rate, source_removed_fraction_before_renormalizing=float(removed),
                 simulated_time_s=300, reference_dz_m=1, time_step_mode="native_cfl"))


if __name__ == "__main__":
    main()
